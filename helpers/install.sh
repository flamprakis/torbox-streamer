#!/usr/bin/env bash
set -e

echo "======================================================"
echo "   TorBox Streamer - Native Host Installer (Linux/macOS)"
echo "======================================================"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$HOME/.local/bin"
mkdir -p "$TARGET_DIR"

HOST_BIN=""
if [ -f "$SCRIPT_DIR/torbox-host-linux" ] && [ "$(uname -s)" = "Linux" ]; then
    HOST_BIN="$SCRIPT_DIR/torbox-host-linux"
elif [ -f "$SCRIPT_DIR/torbox-host-macos" ] && [ "$(uname -s)" = "Darwin" ]; then
    HOST_BIN="$SCRIPT_DIR/torbox-host-macos"
elif [ -f "$SCRIPT_DIR/torbox-host" ]; then
    HOST_BIN="$SCRIPT_DIR/torbox-host"
elif [ -f "$SCRIPT_DIR/native_host.py" ]; then
    HOST_BIN="$SCRIPT_DIR/native_host.py"
fi

if [ -z "$HOST_BIN" ]; then
    echo "❌ Error: Could not find torbox-host binary or native_host.py!"
    exit 1
fi

chmod +x "$HOST_BIN"
FINAL_EXEC="$TARGET_DIR/torbox-host"
cp "$HOST_BIN" "$FINAL_EXEC"
chmod +x "$FINAL_EXEC"

echo "✅ Installed host executable to: $FINAL_EXEC"

# Create manifest JSON
# NOTE: Do NOT add "allowed_origins" — that is a Chrome-only field.
# Firefox/Waterfox schema validation silently rejects manifests with unknown properties.
MANIFEST_TMP=$(mktemp)
cat <<EOF > "$MANIFEST_TMP"
{
  "name": "com.torbox_streamer.host",
  "description": "TorBox Streamer Native Messaging Host",
  "path": "$FINAL_EXEC",
  "type": "stdio",
  "allowed_extensions": [
    "torbox-streamer@flamprakis.com"
  ]
}
EOF

# Directories to register manifest
TARGET_DIRS=()
if [ "$(uname -s)" = "Darwin" ]; then
    APP_SUPP="$HOME/Library/Application Support"
    TARGET_DIRS+=(
        "$APP_SUPP/Mozilla/NativeMessagingHosts"
        "$APP_SUPP/Waterfox/NativeMessagingHosts"
        "$APP_SUPP/Zen/NativeMessagingHosts"
        "$APP_SUPP/Google/Chrome/NativeMessagingHosts"
        "$APP_SUPP/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    )
else
    TARGET_DIRS+=(
        "$HOME/.mozilla/native-messaging-hosts"
        "$HOME/.waterfox/native-messaging-hosts"
        "$HOME/.waterfox-current/native-messaging-hosts"
        "$HOME/.librewolf/native-messaging-hosts"
        "$HOME/.zen/native-messaging-hosts"
        "$HOME/.config/google-chrome/NativeMessagingHosts"
        "$HOME/.config/chromium/NativeMessagingHosts"
        "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    )
fi

INSTALLED_COUNT=0
for dir in "${TARGET_DIRS[@]}"; do
    mkdir -p "$dir"
    cp "$MANIFEST_TMP" "$dir/com.torbox_streamer.host.json"
    INSTALLED_COUNT=$((INSTALLED_COUNT + 1))
done

rm -f "$MANIFEST_TMP"

echo ""
echo "======================================================"
echo " 🎉 [SUCCESS] Native Host installed across $INSTALLED_COUNT browser directories!"
echo " You can now launch MPV / VLC directly from TorBox Streamer."
echo "======================================================"
