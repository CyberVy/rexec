use std::{
    env, fs, io,
    io::Write,
    path::{Path, PathBuf},
    time::SystemTime,
};

use clap::{Parser, Subcommand};
use idevice::{
    IdeviceService,
    lockdown::LockdownClient,
    usbmuxd::{Connection, UsbmuxdAddr, UsbmuxdConnection},
};
use isideload::{
    anisette::remote_v3::RemoteV3AnisetteProvider,
    auth::apple_account::{AppleAccount, TwoFactorCallbackParams, TwoFactorCallbackResponse},
    dev::{certificates::DevelopmentCertificate, teams::DeveloperTeam},
    sideload::{
        SideloaderBuilder, TeamSelection,
        builder::{ExtensionsBehavior, ExtensionsBehaviorSelection, MaxCertsBehavior},
    },
    util::{callbacks::ExtensionsBehaviorCallbackBox, fs_storage::FsStorage},
};
use tracing::Level;
use tracing_subscriber::FmtSubscriber;

#[derive(Parser)]
#[command(
    name = "rexec-ios",
    about = "Sign an unsigned iOS IPA with an Apple ID and install it on a connected device"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// List iPhones and iPads visible to usbmuxd.
    Devices,
    /// Sign an IPA and install it on a selected device.
    Install {
        /// Unsigned `.ipa` or `.app`. Defaults to the newest IPA under src-tauri.
        ipa: Option<PathBuf>,
        /// Apple ID email. Prompted when omitted.
        #[arg(long)]
        apple_id: Option<String>,
        /// Device number from the list, or a UDID prefix.
        #[arg(long)]
        device: Option<String>,
        /// Anisette server URL. Defaults to the isideload provider.
        #[arg(long, env = "REXEC_ANISETTE_URL")]
        anisette: Option<String>,
    },
}

struct ListedDevice {
    udid: String,
    name: String,
    version: String,
    connection: String,
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

    match Cli::parse().command {
        Command::Devices => match list_devices().await {
            Ok(devices) => print_devices(&devices),
            Err(error) => fail(error),
        },
        Command::Install {
            ipa,
            apple_id,
            device,
            anisette,
        } => {
            if let Err(error) = install(ipa, apple_id, device, anisette).await {
                fail(error);
            }
        }
    }
}

async fn install(
    ipa: Option<PathBuf>,
    apple_id: Option<String>,
    device: Option<String>,
    anisette: Option<String>,
) -> Result<(), String> {
    let app_path = match ipa {
        Some(path) => {
            if !path.exists() {
                return Err(format!("IPA not found: {}", path.display()));
            }
            path
        }
        None => find_ipa().ok_or_else(|| {
            "no IPA found. Build one with: npm run tauri ios build -- --ci --target aarch64 --no-sign"
                .to_string()
        })?,
    };
    println!("IPA: {}", app_path.display());

    let devices = list_devices().await?;
    if devices.is_empty() {
        return Err(
            "no device found. Unlock the phone, connect it, and tap Trust This Computer."
                .to_string(),
        );
    }
    print_devices(&devices);
    let selected = select_device(&devices, device.as_deref())?;
    println!("Device: {} ({})", selected.name, selected.udid);

    let apple_id = match apple_id {
        Some(email) => email,
        None => prompt_line("Apple ID: ")?,
    }
    .trim()
    .to_lowercase();
    if apple_id.is_empty() {
        return Err("Apple ID is empty".to_string());
    }
    let password = rpassword::prompt_password("Password: ").map_err(|error| error.to_string())?;

    let mut anisette_provider = RemoteV3AnisetteProvider::default()
        .map_err(|error| error.to_string())?
        .set_serial_number("rexec".to_string());
    if let Some(url) = anisette {
        anisette_provider = anisette_provider.set_url(&url);
    }

    let mut account = AppleAccount::builder(&apple_id)
        .anisette_provider(anisette_provider)
        .login(&password, prompt_2fa)
        .await
        .map_err(|error| error.to_string())?;
    let dev_session =
        isideload::dev::developer_session::DeveloperSession::from_account(&mut account)
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
            .storage(Box::new(FsStorage::new(storage_dir())))
            .machine_name("rexec".to_string())
            .build();

    println!("Signing and installing…");
    sideloader
        .install_app(
            &provider,
            app_path,
            false,
            None::<fn(f32) -> std::future::Ready<()>>,
            None,
        )
        .await
        .map_err(|error| error.to_string())?;
    println!("Installed. On the phone, trust the developer and enable Developer Mode if iOS asks.");
    Ok(())
}

fn prompt_2fa(
    params: TwoFactorCallbackParams,
) -> impl Future<Output = Result<TwoFactorCallbackResponse, rootcause::Report>> {
    async move {
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
            println!("Enter the verification code sent to your devices.");
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
            println!("Type d to send the code to your devices.");
        }
        if !params.unknown {
            println!("Type r to resend the code.");
        }

        let answer = prompt_line("> ").unwrap_or_default();
        let answer = answer.trim();
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
}

fn prompt_team(teams: &Vec<DeveloperTeam>) -> Option<String> {
    println!("Select a developer team:");
    for (index, team) in teams.iter().enumerate() {
        println!(
            "  {}. {} ({})",
            index + 1,
            team.name.as_deref().unwrap_or("Personal Team"),
            team.team_id
        );
    }
    let answer = prompt_line("Team number: ").ok()?;
    let selection = answer.trim().parse::<usize>().ok()?;
    teams
        .get(selection.checked_sub(1)?)
        .map(|team| team.team_id.clone())
}

fn prompt_certs(
    certs: Vec<DevelopmentCertificate>,
) -> impl Future<Output = Result<Option<Vec<String>>, rootcause::Report>> {
    async move {
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
        let answer = prompt_line("Revoke: ").unwrap_or_default();
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
}

async fn list_devices() -> Result<Vec<ListedDevice>, String> {
    let mut usbmuxd = UsbmuxdConnection::default()
        .await
        .map_err(|error| format!("cannot connect to usbmuxd: {error}"))?;
    let attached = usbmuxd
        .get_devices()
        .await
        .map_err(|error| format!("cannot list devices: {error}"))?;
    let address = UsbmuxdAddr::from_env_var().map_err(|error| error.to_string())?;

    let mut devices = Vec::new();
    for device in attached {
        let connection = match device.connection_type {
            Connection::Usb => "USB",
            Connection::Network(_) => "Wi-Fi",
            Connection::Unknown(_) => "Unknown",
        };
        let provider = device.to_provider(address.clone(), "rexec-ios");
        let udid = device.udid.clone();
        match device_details(&provider).await {
            Ok((name, version)) => devices.push(ListedDevice {
                udid,
                name,
                version,
                connection: connection.to_string(),
            }),
            Err(error) => eprintln!("skipping {udid}: {error}"),
        }
    }
    Ok(devices)
}

async fn device_details(
    provider: &idevice::provider::UsbmuxdProvider,
) -> Result<(String, String), String> {
    let mut lockdown = LockdownClient::connect(provider)
        .await
        .map_err(|error| format!("lockdown connection failed: {error}"))?;
    let name = lockdown
        .get_value(Some("DeviceName"), None)
        .await
        .map_err(|error| format!("cannot read device name: {error}"))?;
    let version = lockdown
        .get_value(Some("ProductVersion"), None)
        .await
        .map_err(|error| format!("cannot read iOS version: {error}"))?;
    Ok((
        plist_string(&name).unwrap_or_else(|| "iOS device".to_string()),
        plist_string(&version).unwrap_or_else(|| "unknown".to_string()),
    ))
}

async fn device_provider(udid: &str) -> Result<idevice::provider::UsbmuxdProvider, String> {
    let mut usbmuxd = UsbmuxdConnection::default()
        .await
        .map_err(|error| error.to_string())?;
    let device = usbmuxd
        .get_device(udid)
        .await
        .map_err(|error| format!("device disappeared: {error}"))?;
    let address = UsbmuxdAddr::from_env_var().map_err(|error| error.to_string())?;
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
        println!(
            "  {}. {}    iOS {}    {}    {}",
            index + 1,
            device.name,
            device.version,
            device.connection,
            device.udid
        );
    }
}

fn find_ipa() -> Option<PathBuf> {
    let root = repo_root();
    let mut found = Vec::new();
    for directory in [
        root.join("src-tauri/gen/apple"),
        root.join("src-tauri/target"),
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

fn repo_root() -> PathBuf {
    if let Ok(manifest) = env::var("CARGO_MANIFEST_DIR") {
        let candidate = PathBuf::from(manifest).join("../..");
        if candidate.join("src-tauri").is_dir() {
            return candidate;
        }
    }
    env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn plist_string(value: &plist::Value) -> Option<String> {
    value.as_string().map(str::to_string)
}

fn prompt_line(label: &str) -> Result<String, String> {
    print!("{label}");
    io::stdout().flush().map_err(|error| error.to_string())?;
    let mut line = String::new();
    io::stdin()
        .read_line(&mut line)
        .map_err(|error| error.to_string())?;
    Ok(line)
}

fn fail(error: String) -> ! {
    eprintln!("error: {error}");
    std::process::exit(1);
}
