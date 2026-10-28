#!/usr/bin/env sh
set -e

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

DIST_DIR="$REPO_ROOT/dist"
INSTALL_DIR="$DIST_DIR/install"

mkdir -p "$INSTALL_DIR"

generate_installer() {
    ROUTE_NAME="$1"
    BIN_NAME="$2"
    BUNDLE_FILE="$3"
    OUT_FILE="$INSTALL_DIR/$ROUTE_NAME"

    if [ ! -f "$BUNDLE_FILE" ]; then
        echo "Error: Bundle $BUNDLE_FILE not found. Run esbuild first." >&2
        exit 1
    fi

    # 1. Output installer header
    cat << 'HEADER' > "$OUT_FILE"
#!/usr/bin/env sh
set -e

# Detect node
if ! command -v node >/dev/null 2>&1; then
    echo "Error: Node.js is required but not installed." >&2
    echo "Please install Node.js (v20 or higher) first: https://nodejs.org/" >&2
    exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ] 2>/dev/null; then
    echo "Warning: Node.js v20+ recommended, detected $(node -v)" >&2
fi

# Detect writable install directory
if [ -n "$REXEC_INSTALL_DIR" ]; then
    INSTALL_DIR="$REXEC_INSTALL_DIR"
elif [ -w "/usr/local/bin" ]; then
    INSTALL_DIR="/usr/local/bin"
else
    INSTALL_DIR="${HOME}/.local/bin"
fi

mkdir -p "$INSTALL_DIR"
HEADER

    # 2. Output target file variable and opening of embedded bundle
    cat << EOF >> "$OUT_FILE"
TARGET_FILE="\${INSTALL_DIR}/$BIN_NAME"
echo "Installing $BIN_NAME to \${TARGET_FILE}..."

cat << 'BUNDLE_EOF' > "\$TARGET_FILE"
EOF

    # 3. Embed the actual JS bundle directly
    cat "$BUNDLE_FILE" >> "$OUT_FILE"

    # 4. Output closing delimiter and PATH configuration logic
    cat << EOF >> "$OUT_FILE"
BUNDLE_EOF

chmod 755 "\$TARGET_FILE"
echo "$BIN_NAME successfully installed to \${TARGET_FILE}"

# Check PATH
case ":\$PATH:" in
    *":\$INSTALL_DIR:"*)
        ;;
    *)
        echo ""
        echo "Notice: \${INSTALL_DIR} is not in your current PATH."
        PROFILE=""
        if [ -n "\$ZSH_VERSION" ] || [ "\$(basename "\$SHELL" 2>/dev/null)" = "zsh" ]; then
            PROFILE="\$HOME/.zshrc"
        elif [ -n "\$BASH_VERSION" ] || [ "\$(basename "\$SHELL" 2>/dev/null)" = "bash" ]; then
            PROFILE="\$HOME/.bashrc"
        fi
        if [ -n "\$PROFILE" ] && [ -f "\$PROFILE" ]; then
            echo "export PATH=\\"\${INSTALL_DIR}:\\\$PATH\\"" >> "\$PROFILE"
            echo "Added \${INSTALL_DIR} to \${PROFILE}."
            echo "Run 'source \${PROFILE}' or open a new terminal window to use $BIN_NAME."
        else
            echo "Please add \${INSTALL_DIR} to your PATH:"
            echo "  export PATH=\\"\${INSTALL_DIR}:\\\$PATH\\""
        fi
        ;;
esac
EOF

    chmod 755 "$OUT_FILE"
    echo "[build:installers] Generated dist/install/$ROUTE_NAME"
}

generate_installer "caller" "rexec" "$DIST_DIR/rexec.mjs"
generate_installer "agent" "rexec-agent" "$DIST_DIR/rexec-agent.mjs"
