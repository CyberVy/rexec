use std::{
    env, fs,
    io::{self, Write},
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::{Command as ProcessCommand, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

use clap::{Parser, Subcommand};
use futures_util::{SinkExt, StreamExt};
use idevice::{
    IdeviceService,
    lockdown::LockdownClient,
    provider::{IdeviceProvider, UsbmuxdProvider},
    usbmuxd::{Connection, UsbmuxdAddr},
};
use isideload::{
    anisette::remote_v3::RemoteV3AnisetteProvider,
    auth::apple_account::{AppleAccount, TwoFactorCallbackParams, TwoFactorCallbackResponse},
    dev::{
        certificates::DevelopmentCertificate, developer_session::DeveloperSession,
        teams::DeveloperTeam,
    },
    sideload::{
        SideloaderBuilder, TeamSelection,
        builder::{ExtensionsBehavior, ExtensionsBehaviorSelection, MaxCertsBehavior},
    },
    util::{callbacks::ExtensionsBehaviorCallbackBox, fs_storage::FsStorage},
};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;
use tracing::Level;
use tracing_subscriber::FmtSubscriber;

const KEYCHAIN_SERVICE: &str = "dev.workers.edgetool.rexec.ios-sideload";
const XCODE_PROJECT_RELATIVE_PATH: &str = "src-tauri/gen/apple/app.xcodeproj";
const DEFAULT_IPA_RELATIVE_PATH: &str = "src-tauri/target/ios/Rexec.ipa";
const XCODE_SYMROOT_RELATIVE_PATH: &str = "src-tauri/target/ios/build";
const XCODE_OBJROOT_RELATIVE_PATH: &str = "src-tauri/target/ios/obj";
const STAGING_RELATIVE_PATH: &str = "src-tauri/target/ios/staging";

#[derive(Parser)]
#[command(
    name = "rexec-ios",
    about = "Build an unsigned iOS IPA, sign it with an Apple ID, and install it on a connected device"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// List connected iPhones and iPads visible to usbmuxd and verify pairing status.
    Devices,
    /// Build an unsigned iOS IPA via xcodebuild without opening Xcode GUI.
    Build {
        /// Build the debug configuration instead of release.
        #[arg(long)]
        debug: bool,
        /// Skip running frontend build scripts before xcodebuild.
        #[arg(long)]
        skip_frontend: bool,
        /// Output path for the generated unsigned IPA.
        #[arg(long)]
        output: Option<PathBuf>,
    },
    /// Sign an unsigned IPA and install it on a connected iOS device.
    Install {
        /// Unsigned `.ipa` or `.app`. Defaults to src-tauri/target/ios/Rexec.ipa (auto-builds if missing).
        ipa: Option<PathBuf>,
        /// Force building a fresh unsigned IPA before signing and installing.
        #[arg(long)]
        build: bool,
        /// When building, use the debug configuration instead of release.
        #[arg(long)]
        debug: bool,
        /// When building, skip running frontend build scripts.
        #[arg(long)]
        skip_frontend: bool,
        /// Apple ID email. Defaults to saved config or prompts interactively.
        #[arg(long, env = "REXEC_APPLE_ID")]
        apple_id: Option<String>,
        /// 1-based device number from `devices`, or a UDID prefix.
        #[arg(long, env = "REXEC_IOS_DEVICE")]
        device: Option<String>,
        /// Anisette v3 server URL. Defaults to the isideload provider.
        #[arg(long, env = "REXEC_ANISETTE_URL")]
        anisette: Option<String>,
        /// Ignore cached Keychain password and prompt again.
        #[arg(long)]
        reauth: bool,
    },
}

struct ListedDevice {
    udid: String,
    name: String,
    version: String,
    connection: String,
    paired: bool,
    pairing_error: Option<String>,
}

#[derive(Default, Serialize, Deserialize)]
struct IosConfig {
    apple_id: Option<String>,
    team_id: Option<String>,
}

struct TempFileGuard(Option<PathBuf>);

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        if let Some(path) = self.0.take() {
            let _ = fs::remove_file(path);
        }
    }
}

struct TauriOptionsServerGuard {
    addr_file: PathBuf,
    task_handle: tokio::task::JoinHandle<()>,
}

impl Drop for TauriOptionsServerGuard {
    fn drop(&mut self) {
        self.task_handle.abort();
        let _ = fs::remove_file(&self.addr_file);
    }
}

#[tokio::main]
async fn main() {
    rustls::crypto::ring::default_provider()
        .install_default()
        .ok();
    isideload::init().expect("failed to initialize isideload error reporting");
    tracing::subscriber::set_global_default(
        FmtSubscriber::builder()
            .with_max_level(Level::INFO)
            .finish(),
    )
    .ok();

    let result = match Cli::parse().command {
        Command::Devices => list_devices().await.map(|devices| print_devices(&devices)),
        Command::Build {
            debug,
            skip_frontend,
            output,
        } => build_unsigned_ipa(debug, skip_frontend, output)
            .await
            .map(|path| {
                println!("Unsigned IPA ready: {}", path.display());
            }),
        Command::Install {
            ipa,
            build,
            debug,
            skip_frontend,
            apple_id,
            device,
            anisette,
            reauth,
        } => {
            install(
                ipa,
                build,
                debug,
                skip_frontend,
                apple_id,
                device,
                anisette,
                reauth,
            )
            .await
        }
    };

    if let Err(error) = result {
        fail(&error);
    }
}

#[allow(clippy::too_many_arguments)]
async fn install(
    ipa: Option<PathBuf>,
    force_build: bool,
    debug: bool,
    skip_frontend: bool,
    requested_apple_id: Option<String>,
    requested_device: Option<String>,
    anisette_url: Option<String>,
    reauth: bool,
) -> Result<(), String> {
    let (install_path, _temp_ipa_guard) =
        resolve_install_target(ipa, force_build, debug, skip_frontend).await?;
    println!("IPA: {}", install_path.display());

    let devices = list_devices().await?;
    if devices.is_empty() {
        return Err(
            "no iOS device found. Connect your device, unlock it, and tap Trust This Computer."
                .to_string(),
        );
    }
    print_devices(&devices);
    let selected = select_device(&devices, requested_device.as_deref())?;
    println!("Selected device: {} ({})", selected.name, selected.udid);

    if !selected.paired {
        let detail = selected
            .pairing_error
            .as_deref()
            .unwrap_or("device is not paired");
        return Err(format!(
            "device {} is not paired ({detail}). Unlock the phone, connect via USB, and tap Trust This Computer before installing.",
            selected.name
        ));
    }

    let storage_dir = ensure_storage_dir()?;
    let mut config = load_config(&storage_dir);
    let apple_id = resolve_apple_id(requested_apple_id, &config)?;

    let mut account =
        login_with_keychain(&apple_id, anisette_url.as_deref(), &storage_dir, reauth).await?;

    if config.apple_id.as_deref() != Some(apple_id.as_str()) {
        config.apple_id = Some(apple_id.clone());
        config.team_id = None;
        save_config(&storage_dir, &config)?;
    }

    let dev_session = DeveloperSession::from_account(&mut account)
        .await
        .map_err(|error| error.to_string())?;

    let provider = device_provider(&selected.udid).await?;
    let mut sideloader =
        SideloaderBuilder::<_, ExtensionsBehaviorCallbackBox>::new(dev_session, apple_id)
            .team_selection(TeamSelection::PromptOnce(prompt_team))
            .max_certs_behavior(MaxCertsBehavior::Prompt(prompt_certs))
            .extensions_behavior(ExtensionsBehaviorSelection::Fixed(
                ExtensionsBehavior::ReuseMain,
            ))
            .storage(Box::new(FsStorage::new(storage_dir)))
            .machine_name("rexec".to_string())
            .build();

    println!("Signing and installing…");
    sideloader
        .install_app(
            &provider,
            install_path,
            false,
            None::<fn(f32) -> std::future::Ready<()>>,
            None,
        )
        .await
        .map_err(|error| error.to_string())?;
    println!(
        "Installed. On the phone, trust the developer profile (Settings > General > VPN & Device Management) and enable Developer Mode if iOS asks."
    );
    Ok(())
}

async fn resolve_install_target(
    ipa: Option<PathBuf>,
    force_build: bool,
    debug: bool,
    skip_frontend: bool,
) -> Result<(PathBuf, TempFileGuard), String> {
    if force_build && ipa.is_some() {
        return Err("--build cannot be combined with an explicit IPA or .app path".to_string());
    }

    if let Some(path) = ipa {
        if !path.exists() {
            return Err(format!("input not found: {}", path.display()));
        }
        if path.is_dir() {
            if !path.join("Info.plist").is_file() {
                return Err(format!(
                    "directory {} does not look like an .app bundle (missing Info.plist)",
                    path.display()
                ));
            }
            let temp_ipa = unique_temp_ipa_path();
            package_app_as_ipa(&path, &temp_ipa)?;
            return Ok((temp_ipa.clone(), TempFileGuard(Some(temp_ipa))));
        }
        return Ok((path, TempFileGuard(None)));
    }

    if force_build {
        let built = build_unsigned_ipa(debug, skip_frontend, None).await?;
        return Ok((built, TempFileGuard(None)));
    }

    if let Some(existing) = find_existing_ipa() {
        return Ok((existing, TempFileGuard(None)));
    }

    println!("No existing IPA found; building unsigned IPA first…");
    let built = build_unsigned_ipa(debug, skip_frontend, None).await?;
    Ok((built, TempFileGuard(None)))
}

async fn build_unsigned_ipa(
    debug: bool,
    skip_frontend: bool,
    output: Option<PathBuf>,
) -> Result<PathBuf, String> {
    let root = repo_root();
    let project_path = root.join(XCODE_PROJECT_RELATIVE_PATH);
    if !project_path.exists() {
        return Err(format!(
            "Xcode project not found at {}. Run `npm run tauri ios init` first.",
            project_path.display()
        ));
    }
    ensure_ios_runtime_available()?;

    if !skip_frontend {
        println!("Building frontend assets and WebView injection script…");
        run_checked(
            ProcessCommand::new("npm")
                .args(["run", "build:injection"])
                .current_dir(&root),
            "npm run build:injection",
        )?;
        run_checked(
            ProcessCommand::new("npm")
                .args(["run", "build"])
                .current_dir(&root),
            "npm run build",
        )?;
    }

    let configuration = if debug { "debug" } else { "release" };
    let symroot_dir = root.join(XCODE_SYMROOT_RELATIVE_PATH);
    let objroot_dir = root.join(XCODE_OBJROOT_RELATIVE_PATH);
    let _options_server = start_tauri_options_server(&root).await?;
    println!("Compiling unsigned iOS app ({configuration}) via xcodebuild…");

    let xcode_root = root.clone();
    let xcode_project = project_path.clone();
    let xcode_symroot = symroot_dir.clone();
    let xcode_objroot = objroot_dir.clone();
    let xcode_config = configuration.to_string();
    tokio::task::spawn_blocking(move || {
        run_checked(
            ProcessCommand::new("xcodebuild")
                .arg("-project")
                .arg(&xcode_project)
                .args(["-target", "app_iOS"])
                .args(["-configuration", &xcode_config])
                .args(["-sdk", "iphoneos"])
                .arg(format!("SYMROOT={}", xcode_symroot.display()))
                .arg(format!("OBJROOT={}", xcode_objroot.display()))
                .args([
                    "CODE_SIGNING_ALLOWED=NO",
                    "CODE_SIGNING_REQUIRED=NO",
                    "CODE_SIGN_IDENTITY=",
                    "AD_HOC_CODE_SIGNING_IDENTITY=",
                    "build",
                ])
                .env("TAURI_APP_PATH", xcode_root.join("src-tauri"))
                .env("TAURI_FRONTEND_PATH", &xcode_root)
                .current_dir(&xcode_root),
            "xcodebuild",
        )
    })
    .await
    .map_err(|error| format!("xcodebuild task panicked: {error}"))??;

    let products_dir = symroot_dir.join(format!("{configuration}-iphoneos"));
    let app_bundle = find_built_app(&products_dir).ok_or_else(|| {
        format!(
            "compiled .app bundle not found under {}",
            products_dir.display()
        )
    })?;

    let output_ipa = output.unwrap_or_else(|| root.join(DEFAULT_IPA_RELATIVE_PATH));
    println!("Packaging unsigned IPA at {}…", output_ipa.display());
    package_app_as_ipa(&app_bundle, &output_ipa)?;
    Ok(output_ipa)
}

fn ensure_ios_runtime_available() -> Result<(), String> {
    let Ok(output) = ProcessCommand::new("xcrun")
        .args(["simctl", "list", "runtimes", "--json"])
        .output()
    else {
        return Ok(());
    };
    if !output.status.success() {
        return Ok(());
    }
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(&output.stdout) else {
        return Ok(());
    };
    let Some(runtimes) = json.get("runtimes").and_then(|value| value.as_array()) else {
        return Ok(());
    };

    let has_ios_runtime = runtimes.iter().any(|runtime| {
        let is_ios = runtime
            .get("name")
            .and_then(|value| value.as_str())
            .is_some_and(|name| name.starts_with("iOS"));
        let is_available = runtime
            .get("isAvailable")
            .and_then(|value| value.as_bool())
            .unwrap_or(true);
        is_ios && is_available
    });
    if has_ios_runtime {
        return Ok(());
    }

    let unmounted_images = find_ios_runtime_disk_images();
    if !unmounted_images.is_empty() {
        return Err(format!(
            "no active iOS Simulator runtime found in `xcrun simctl list runtimes`, even though runtime disk image(s) exist on disk ({}). Xcode's `actool` requires a mounted iOS runtime to compile Assets.xcassets. Restart CoreSimulator (`killall -9 com.apple.CoreSimulator.CoreSimulatorService`), check Xcode > Settings > Platforms, or reboot before retrying.",
            unmounted_images.join(", ")
        ));
    }

    Err(
        "no iOS Simulator runtime is installed (`xcrun simctl list runtimes` is empty). Xcode's `actool` requires an iOS runtime to compile Assets.xcassets; run `xcodebuild -downloadPlatform iOS` or install it in Xcode > Settings > Platforms."
            .to_string(),
    )
}

fn find_ios_runtime_disk_images() -> Vec<String> {
    let Ok(output) = ProcessCommand::new("xcrun")
        .args(["simctl", "runtime", "list", "-j"])
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let Ok(serde_json::Value::Object(map)) =
        serde_json::from_slice::<serde_json::Value>(&output.stdout)
    else {
        return Vec::new();
    };

    let mut descriptions = Vec::new();
    for entry in map.values() {
        let platform = entry
            .get("platformIdentifier")
            .and_then(|value| value.as_str());
        if platform != Some("com.apple.platform.iphonesimulator") {
            continue;
        }
        let version = entry
            .get("version")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown");
        let build = entry
            .get("build")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown");
        let state = entry
            .get("state")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown");
        descriptions.push(format!("iOS {version} ({build}, state: {state})"));
    }
    descriptions
}

async fn start_tauri_options_server(root: &Path) -> Result<TauriOptionsServerGuard, String> {
    let identifier = read_tauri_identifier(root);
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("failed to bind Tauri options server: {error}"))?;
    let addr = listener
        .local_addr()
        .map_err(|error| format!("failed to read Tauri options server address: {error}"))?;

    let addr_file = env::temp_dir().join(format!("{identifier}-server-addr"));
    fs::write(&addr_file, addr.to_string()).map_err(|error| {
        format!(
            "failed to write Tauri options addr file {}: {error}",
            addr_file.display()
        )
    })?;

    let task_handle = tokio::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                break;
            };
            tokio::spawn(async move {
                let Ok(mut ws) = tokio_tungstenite::accept_async(stream).await else {
                    return;
                };
                while let Some(Ok(message)) = ws.next().await {
                    match message {
                        Message::Text(text) => {
                            let Ok(req) = serde_json::from_str::<serde_json::Value>(&text) else {
                                continue;
                            };
                            let id = req.get("id").cloned().unwrap_or(serde_json::Value::Null);
                            let method = req.get("method").and_then(|value| value.as_str());
                            let response = if method == Some("options") {
                                serde_json::json!({
                                    "jsonrpc": "2.0",
                                    "id": id,
                                    "result": {
                                        "dev": false,
                                        "features": [],
                                        "args": [],
                                        "noise_level": "Polite",
                                        "vars": {},
                                        "config": [],
                                        "target_device": null,
                                    }
                                })
                            } else {
                                serde_json::json!({
                                    "jsonrpc": "2.0",
                                    "id": id,
                                    "error": {
                                        "code": -32601,
                                        "message": "Method not found"
                                    }
                                })
                            };
                            if ws
                                .send(Message::Text(response.to_string().into()))
                                .await
                                .is_err()
                            {
                                break;
                            }
                        }
                        Message::Ping(payload) => {
                            if ws.send(Message::Pong(payload)).await.is_err() {
                                break;
                            }
                        }
                        Message::Close(_) => break,
                        _ => {}
                    }
                }
            });
        }
    });

    Ok(TauriOptionsServerGuard {
        addr_file,
        task_handle,
    })
}

fn read_tauri_identifier(root: &Path) -> String {
    let conf_path = root.join("src-tauri/tauri.conf.json");
    fs::read_to_string(conf_path)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|json| {
            json.get("identifier")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "dev.workers.edgetool.rexec".to_string())
}

fn find_built_app(products_dir: &Path) -> Option<PathBuf> {
    let preferred = products_dir.join("Rexec.app");
    if preferred.is_dir() {
        return Some(preferred);
    }
    let entries = fs::read_dir(products_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && path.extension().and_then(|ext| ext.to_str()) == Some("app") {
            return Some(path);
        }
    }
    None
}

fn package_app_as_ipa(app_bundle: &Path, output_ipa: &Path) -> Result<(), String> {
    let root = repo_root();
    let app_name = app_bundle
        .file_name()
        .ok_or_else(|| format!("invalid .app bundle path: {}", app_bundle.display()))?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let staging_dir = root
        .join(STAGING_RELATIVE_PATH)
        .join(format!("pkg-{}-{timestamp}", std::process::id()));
    let payload_dir = staging_dir.join("Payload");
    fs::create_dir_all(&payload_dir)
        .map_err(|error| format!("failed to create staging directory: {error}"))?;

    let result = (|| {
        let staged_app = payload_dir.join(app_name);
        run_checked(
            ProcessCommand::new("/usr/bin/ditto")
                .arg(app_bundle)
                .arg(&staged_app),
            "ditto stage .app",
        )?;

        if let Some(parent) = output_ipa.parent()
            && !parent.as_os_str().is_empty()
        {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create IPA output directory: {error}"))?;
        }
        if output_ipa.exists() {
            fs::remove_file(output_ipa)
                .map_err(|error| format!("failed to replace existing IPA: {error}"))?;
        }

        run_checked(
            ProcessCommand::new("/usr/bin/ditto")
                .args(["-c", "-k", "--sequesterRsrc"])
                .arg(&staging_dir)
                .arg(output_ipa),
            "ditto create .ipa",
        )?;
        Ok(())
    })();

    let _ = fs::remove_dir_all(&staging_dir);
    result
}

fn run_checked(command: &mut ProcessCommand, label: &str) -> Result<(), String> {
    let status = command
        .status()
        .map_err(|error| format!("failed to run `{label}`: {error}"))?;
    if !status.success() {
        return Err(format!("`{label}` exited with status {status}"));
    }
    Ok(())
}

async fn login_with_keychain(
    apple_id: &str,
    anisette_url: Option<&str>,
    storage_dir: &Path,
    reauth: bool,
) -> Result<AppleAccount, String> {
    if !reauth
        && let Some(cached_password) = read_keychain_password(apple_id)
        && !cached_password.is_empty()
    {
        println!("Using Apple ID password from macOS Keychain…");
        match authenticate_apple_account(apple_id, &cached_password, anisette_url, storage_dir)
            .await
        {
            Ok(account) => return Ok(account),
            Err(error) => {
                eprintln!("Cached Keychain login failed ({error}). Please re-enter your password.");
            }
        }
    }

    let password = prompt_apple_password()?;
    let account =
        authenticate_apple_account(apple_id, &password, anisette_url, storage_dir).await?;
    if let Err(error) = save_keychain_password(apple_id, &password) {
        eprintln!("warning: could not save password to macOS Keychain: {error}");
    } else {
        println!("Saved Apple ID password to macOS Keychain.");
    }
    Ok(account)
}

async fn authenticate_apple_account(
    apple_id: &str,
    password: &str,
    anisette_url: Option<&str>,
    storage_dir: &Path,
) -> Result<AppleAccount, String> {
    let mut anisette_provider = RemoteV3AnisetteProvider::default()
        .map_err(|error| error.to_string())?
        .set_storage(Box::new(FsStorage::new(storage_dir.to_path_buf())))
        .set_serial_number("rexec".to_string());
    if let Some(url) = anisette_url {
        anisette_provider = anisette_provider.set_url(url);
    }

    AppleAccount::builder(apple_id)
        .anisette_provider(anisette_provider)
        .login(password, prompt_2fa)
        .await
        .map_err(|error| error.to_string())
}

fn prompt_apple_password() -> Result<String, String> {
    let password = rpassword::prompt_password("Apple ID Password: ")
        .map_err(|error| format!("failed to read password: {error}"))?;
    if password.is_empty() {
        return Err("Apple ID password is empty".to_string());
    }
    Ok(password)
}

fn read_keychain_password(apple_id: &str) -> Option<String> {
    let output = ProcessCommand::new("/usr/bin/security")
        .args([
            "find-generic-password",
            "-s",
            KEYCHAIN_SERVICE,
            "-a",
            apple_id,
            "-w",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let password = String::from_utf8(output.stdout).ok()?;
    Some(password.trim_end_matches(['\r', '\n']).to_string())
}

fn save_keychain_password(apple_id: &str, password: &str) -> Result<(), String> {
    if apple_id.contains(['\n', '\r', '\0']) {
        return Err("Apple ID contains invalid control characters".to_string());
    }
    let escaped_account = apple_id.replace('\\', "\\\\").replace('"', "\\\"");
    let hex_password = encode_hex(password.as_bytes());
    let script = format!(
        "add-generic-password -U -s \"{KEYCHAIN_SERVICE}\" -a \"{escaped_account}\" -X {hex_password}\n"
    );

    let mut child = ProcessCommand::new("/usr/bin/security")
        .arg("-i")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to launch /usr/bin/security: {error}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(script.as_bytes())
            .map_err(|error| format!("failed to write to security stdin: {error}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("failed waiting for /usr/bin/security: {error}"))?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() || stderr.contains("returned ") || stderr.contains("security:") {
        return Err(stderr.trim().to_string());
    }
    Ok(())
}

fn encode_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(out, "{byte:02x}");
    }
    out
}

async fn prompt_2fa(
    params: TwoFactorCallbackParams,
) -> Result<TwoFactorCallbackResponse, rootcause::Report> {
    if let Some(last_error) = &params.last_error {
        eprintln!("2FA error: {last_error}");
    }

    if params.unknown {
        println!("The last verification attempt failed. Try another method.");
    } else if params.sms {
        let number = params
            .numbers
            .iter()
            .find(|number| Some(number.id) == params.selected_number_id)
            .map(|number| number.number_with_dial_code.as_str())
            .unwrap_or("your phone");
        println!("Enter the verification code sent to {number}.");
    } else {
        println!("Enter the verification code sent to your trusted devices.");
    }

    let other_numbers: Vec<_> = params
        .numbers
        .iter()
        .filter(|number| Some(number.id) != params.selected_number_id)
        .collect();
    if !other_numbers.is_empty() {
        println!("Or type p<id> to text a different number:");
        for number in other_numbers {
            println!("  p{}  {}", number.id, number.number_with_dial_code);
        }
    }
    if params.sms || params.unknown {
        println!("Type d to send the code to your trusted devices.");
    }
    if !params.unknown {
        println!("Type r to resend the code.");
    }
    println!("Type q (or press Ctrl-D) to abort.");

    let Some(answer) = prompt_line_eof("> ").map_err(|e| rootcause::report!("{e}"))? else {
        return Ok(TwoFactorCallbackResponse::Abort);
    };
    let answer = answer.trim();
    if answer.is_empty() || answer.eq_ignore_ascii_case("q") {
        return Ok(TwoFactorCallbackResponse::Abort);
    }
    if let Some(id) = answer.strip_prefix('p') {
        let id = id.parse::<u32>().unwrap_or(0);
        return Ok(TwoFactorCallbackResponse::SendSms(id));
    }
    if answer == "d" {
        return Ok(TwoFactorCallbackResponse::SendToDevices);
    }
    if answer == "r" && !params.unknown {
        return Ok(TwoFactorCallbackResponse::ResendCode);
    }
    Ok(TwoFactorCallbackResponse::SubmitCode(answer.to_string()))
}

#[allow(clippy::ptr_arg)]
fn prompt_team(teams: &Vec<DeveloperTeam>) -> Option<String> {
    let dir = storage_dir();
    let mut config = load_config(&dir);
    if let Some(saved_team_id) = &config.team_id
        && let Some(matched) = teams.iter().find(|team| &team.team_id == saved_team_id)
    {
        println!(
            "Using saved developer team: {} ({})",
            matched.name.as_deref().unwrap_or("Personal Team"),
            matched.team_id
        );
        return Some(matched.team_id.clone());
    }

    println!("Select a developer team:");
    for (index, team) in teams.iter().enumerate() {
        println!(
            "  {}. {} ({})",
            index + 1,
            team.name.as_deref().unwrap_or("Personal Team"),
            team.team_id
        );
    }
    let answer = prompt_line_eof("Team number: ").ok()??;
    let selection = answer.trim().parse::<usize>().ok()?;
    let chosen = teams.get(selection.checked_sub(1)?)?;

    config.team_id = Some(chosen.team_id.clone());
    if let Err(error) = save_config(&dir, &config) {
        eprintln!("warning: could not save selected team: {error}");
    }
    Some(chosen.team_id.clone())
}

async fn prompt_certs(
    certs: Vec<DevelopmentCertificate>,
) -> Result<Option<Vec<String>>, rootcause::Report> {
    println!("This Apple ID already has the maximum number of development certificates.");
    for (index, cert) in certs.iter().enumerate() {
        println!(
            "  {}. {} — {}",
            index + 1,
            cert.name.as_deref().unwrap_or("certificate"),
            cert.machine_name.as_deref().unwrap_or("unknown machine")
        );
    }
    println!("Enter the numbers to revoke, separated by commas. Leave empty to cancel.");
    let answer = prompt_line_eof("Revoke: ")
        .map_err(|e| rootcause::report!("{e}"))?
        .unwrap_or_default();
    let selected: Vec<String> = answer
        .split(',')
        .filter_map(|part| part.trim().parse::<usize>().ok())
        .filter_map(|number| certs.get(number.checked_sub(1)?))
        .filter_map(|cert| cert.serial_number.clone())
        .collect();
    if selected.is_empty() {
        Ok(None)
    } else {
        Ok(Some(selected))
    }
}

async fn list_devices() -> Result<Vec<ListedDevice>, String> {
    let address = UsbmuxdAddr::from_env_var().map_err(|error| error.to_string())?;
    let mut usbmuxd = address
        .connect(0)
        .await
        .map_err(|error| format!("cannot connect to usbmuxd: {error}"))?;
    let attached = usbmuxd
        .get_devices()
        .await
        .map_err(|error| format!("cannot list devices: {error}"))?;

    let mut devices = Vec::new();
    for device in attached {
        let connection = match device.connection_type {
            Connection::Usb => "USB",
            Connection::Network(_) => "Wi-Fi",
            Connection::Unknown(_) => "Unknown",
        };
        let provider = device.to_provider(address.clone(), "rexec-ios");
        let udid = device.udid.clone();
        let details = device_details(&provider).await;
        devices.push(ListedDevice {
            udid,
            name: details.name,
            version: details.version,
            connection: connection.to_string(),
            paired: details.paired,
            pairing_error: details.pairing_error,
        });
    }
    Ok(devices)
}

struct DeviceDetails {
    name: String,
    version: String,
    paired: bool,
    pairing_error: Option<String>,
}

async fn device_details(provider: &UsbmuxdProvider) -> DeviceDetails {
    let mut lockdown = match LockdownClient::connect(provider).await {
        Ok(client) => client,
        Err(error) => {
            return DeviceDetails {
                name: "iOS device".to_string(),
                version: "unknown".to_string(),
                paired: false,
                pairing_error: Some(format!("lockdown connection failed: {error}")),
            };
        }
    };

    let pairing_error = match provider.get_pairing_file().await {
        Ok(pairing) => match lockdown.start_session(&pairing).await {
            Ok(_) => None,
            Err(error) => Some(format!("lockdown TLS session failed: {error}")),
        },
        Err(error) => Some(format!("no pairing record: {error}")),
    };

    let name = lockdown
        .get_value(Some("DeviceName"), None)
        .await
        .ok()
        .and_then(|value| plist_string(&value))
        .unwrap_or_else(|| "iOS device".to_string());
    let version = lockdown
        .get_value(Some("ProductVersion"), None)
        .await
        .ok()
        .and_then(|value| plist_string(&value))
        .unwrap_or_else(|| "unknown".to_string());

    DeviceDetails {
        name,
        version,
        paired: pairing_error.is_none(),
        pairing_error,
    }
}

async fn device_provider(udid: &str) -> Result<UsbmuxdProvider, String> {
    let address = UsbmuxdAddr::from_env_var().map_err(|error| error.to_string())?;
    let mut usbmuxd = address
        .connect(0)
        .await
        .map_err(|error| format!("cannot connect to usbmuxd: {error}"))?;
    let device = usbmuxd
        .get_device(udid)
        .await
        .map_err(|error| format!("device disappeared: {error}"))?;
    Ok(device.to_provider(address, "rexec-ios"))
}

fn select_device<'a>(
    devices: &'a [ListedDevice],
    requested: Option<&str>,
) -> Result<&'a ListedDevice, String> {
    if let Some(requested) = requested {
        if let Ok(number) = requested.parse::<usize>() {
            return devices
                .get(number.checked_sub(1).unwrap_or(usize::MAX))
                .ok_or_else(|| format!("there is no device {number}"));
        }
        let matches: Vec<_> = devices
            .iter()
            .filter(|device| device.udid.starts_with(requested))
            .collect();
        return match matches.as_slice() {
            [device] => Ok(*device),
            [] => Err(format!("no device matches {requested}")),
            _ => Err(format!("{requested} matches more than one device")),
        };
    }
    if devices.len() == 1 {
        return Ok(&devices[0]);
    }
    let answer = prompt_line("Device number: ")?;
    let number = answer
        .trim()
        .parse::<usize>()
        .map_err(|_| format!("enter a device number, not {answer:?}"))?;
    devices
        .get(number.checked_sub(1).unwrap_or(usize::MAX))
        .ok_or_else(|| format!("there is no device {number}"))
}

fn print_devices(devices: &[ListedDevice]) {
    if devices.is_empty() {
        println!("No connected devices.");
        return;
    }
    println!("Connected devices:");
    for (index, device) in devices.iter().enumerate() {
        let trust_status = if device.paired {
            "paired"
        } else {
            "unpaired — tap Trust This Computer"
        };
        println!(
            "  {}. {}    iOS {}    {}    {}    {}",
            index + 1,
            device.name,
            device.version,
            device.connection,
            trust_status,
            device.udid
        );
    }
}

fn resolve_apple_id(requested: Option<String>, config: &IosConfig) -> Result<String, String> {
    let raw = if let Some(email) = requested {
        email
    } else if let Some(saved) = config.apple_id.as_deref().filter(|s| !s.is_empty()) {
        println!("Apple ID: {saved} (saved)");
        saved.to_string()
    } else {
        prompt_line("Apple ID: ")?
    };

    let normalized = raw.trim().to_lowercase();
    if normalized.is_empty() {
        return Err("Apple ID is empty".to_string());
    }
    Ok(normalized)
}

fn find_existing_ipa() -> Option<PathBuf> {
    let root = repo_root();
    let default_ipa = root.join(DEFAULT_IPA_RELATIVE_PATH);
    if default_ipa.is_file() {
        return Some(default_ipa);
    }

    let mut found = Vec::new();
    for directory in [
        root.join("src-tauri/target"),
        root.join("src-tauri/gen/apple"),
    ] {
        collect_ipas(&directory, &mut found);
    }
    found.sort_by_key(|path| {
        fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH)
    });
    found.pop()
}

fn collect_ipas(directory: &Path, found: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_ipas(&path, found);
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("ipa") {
            found.push(path);
        }
    }
}

fn storage_dir() -> PathBuf {
    let home = env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".rexec/ios")
}

fn ensure_storage_dir() -> Result<PathBuf, String> {
    let dir = storage_dir();
    fs::create_dir_all(&dir)
        .map_err(|error| format!("failed to create {}: {error}", dir.display()))?;
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("failed to set permissions on {}: {error}", dir.display()))?;
    Ok(dir)
}

fn load_config(storage_dir: &Path) -> IosConfig {
    let path = storage_dir.join("config.json");
    let Ok(bytes) = fs::read(path) else {
        return IosConfig::default();
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

fn save_config(storage_dir: &Path, config: &IosConfig) -> Result<(), String> {
    let _ = ensure_storage_dir()?;
    let path = storage_dir.join("config.json");
    let contents = serde_json::to_vec_pretty(config)
        .map_err(|error| format!("failed to serialize config: {error}"))?;
    fs::write(&path, contents)
        .map_err(|error| format!("failed to write {}: {error}", path.display()))?;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("failed to set permissions on {}: {error}", path.display()))?;
    Ok(())
}

fn unique_temp_ipa_path() -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    env::temp_dir().join(format!("rexec-ios-{}-{timestamp}.ipa", std::process::id()))
}

fn repo_root() -> PathBuf {
    if let Ok(manifest) = env::var("CARGO_MANIFEST_DIR") {
        let candidate = PathBuf::from(manifest).join("../..");
        if candidate.join("src-tauri").is_dir() {
            return fs::canonicalize(&candidate).unwrap_or(candidate);
        }
    }
    env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn plist_string(value: &plist::Value) -> Option<String> {
    value.as_string().map(str::to_string)
}

fn prompt_line(label: &str) -> Result<String, String> {
    match prompt_line_eof(label)? {
        Some(line) => Ok(line),
        None => Err("unexpected end of input".to_string()),
    }
}

fn prompt_line_eof(label: &str) -> Result<Option<String>, String> {
    print!("{label}");
    io::stdout().flush().map_err(|error| error.to_string())?;
    let mut line = String::new();
    let bytes = io::stdin()
        .read_line(&mut line)
        .map_err(|error| error.to_string())?;
    if bytes == 0 {
        println!();
        return Ok(None);
    }
    Ok(Some(line))
}

fn fail(error: &str) -> ! {
    eprintln!("error: {error}");
    std::process::exit(1);
}
