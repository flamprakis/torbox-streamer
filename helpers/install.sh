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
echo ""

GECKO_ID="torbox-streamer@flamprakis.com"

# Temporary manifest files
GECKO_TMP=$(mktemp)
cat <<EOF > "$GECKO_TMP"
{
  "name": "com.torbox_streamer.host",
  "description": "TorBox Streamer Native Messaging Host",
  "path": "$FINAL_EXEC",
  "type": "stdio",
  "allowed_extensions": [
    "$GECKO_ID"
  ]
}
EOF

CHROMIUM_TMP=$(mktemp)
cat <<EOF > "$CHROMIUM_TMP"
{
  "name": "com.torbox_streamer.host",
  "description": "TorBox Streamer Native Messaging Host",
  "path": "$FINAL_EXEC",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://*/"
  ]
}
EOF

# Detect installed browsers
DETECTED_NAMES=()
DETECTED_PATHS=()
DETECTED_TYPES=()

check_browser() {
    local name="$1"
    local btype="$2"
    local check_dir="$3"
    local target_dir="$4"

    if [ -d "$check_dir" ]; then
        DETECTED_NAMES+=("$name")
        DETECTED_TYPES+=("$btype")
        DETECTED_PATHS+=("$target_dir")
    fi
}

if [ "$(uname -s)" = "Darwin" ]; then
    APP_SUPP="$HOME/Library/Application Support"
    check_browser "Firefox" "gecko" "$APP_SUPP/Mozilla" "$APP_SUPP/Mozilla/NativeMessagingHosts"
    check_browser "Waterfox" "gecko" "$APP_SUPP/Waterfox" "$APP_SUPP/Waterfox/NativeMessagingHosts"
    check_browser "Zen Browser" "gecko" "$APP_SUPP/Zen" "$APP_SUPP/Zen/NativeMessagingHosts"
    check_browser "Google Chrome" "chromium" "$APP_SUPP/Google/Chrome" "$APP_SUPP/Google/Chrome/NativeMessagingHosts"
    check_browser "Brave" "chromium" "$APP_SUPP/BraveSoftware/Brave-Browser" "$APP_SUPP/BraveSoftware/Brave-Browser/NativeMessagingHosts"
else
    check_browser "Firefox" "gecko" "$HOME/.mozilla" "$HOME/.mozilla/native-messaging-hosts"
    check_browser "Waterfox" "gecko" "$HOME/.waterfox" "$HOME/.waterfox/native-messaging-hosts"
    check_browser "Waterfox Current" "gecko" "$HOME/.waterfox-current" "$HOME/.waterfox-current/native-messaging-hosts"
    check_browser "LibreWolf" "gecko" "$HOME/.librewolf" "$HOME/.librewolf/native-messaging-hosts"
    check_browser "Zen Browser" "gecko" "$HOME/.zen" "$HOME/.zen/native-messaging-hosts"
    check_browser "Google Chrome" "chromium" "$HOME/.config/google-chrome" "$HOME/.config/google-chrome/NativeMessagingHosts"
    check_browser "Chromium" "chromium" "$HOME/.config/chromium" "$HOME/.config/chromium/NativeMessagingHosts"
    check_browser "Brave" "chromium" "$HOME/.config/BraveSoftware/Brave-Browser" "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
fi

if [ ${#DETECTED_NAMES[@]} -eq 0 ]; then
    echo "⚠️ No existing browser profile directories detected."
    echo "Fallback: Registering for default Firefox location..."
    DETECTED_NAMES+=("Firefox")
    DETECTED_TYPES+=("gecko")
    DETECTED_PATHS+=("$HOME/.mozilla/native-messaging-hosts")
fi

SELECTED_INDICES=()

# Interactive prompt if TTY and no --all flag
if [ -t 0 ] && [ "$1" != "--all" ]; then
    echo "🔍 Detected installed browsers on your system:"
    for i in "${!DETECTED_NAMES[@]}"; do
        echo "  [$((i+1))] ${DETECTED_NAMES[$i]} (${DETECTED_TYPES[$i]})"
    done
    echo "  [A] Install for All Detected Browsers (Default)"
    echo ""
    read -rp "Select an option [1-${#DETECTED_NAMES[@]} or A]: " CHOICE
    CHOICE=$(echo "$CHOICE" | tr '[:lower:]' '[:upper:]')

    if [ "$CHOICE" = "A" ] || [ -z "$CHOICE" ]; then
        for i in "${!DETECTED_NAMES[@]}"; do SELECTED_INDICES+=("$i"); done
    elif [[ "$CHOICE" =~ ^[0-9]+$ ]] && [ "$CHOICE" -ge 1 ] && [ "$CHOICE" -le ${#DETECTED_NAMES[@]} ]; then
        SELECTED_INDICES+=("$((CHOICE-1))")
    else
        for i in "${!DETECTED_NAMES[@]}"; do SELECTED_INDICES+=("$i"); done
    fi
else
    for i in "${!DETECTED_NAMES[@]}"; do SELECTED_INDICES+=("$i"); done
fi

INSTALLED_COUNT=0
for idx in "${SELECTED_INDICES[@]}"; do
    target="${DETECTED_PATHS[$idx]}"
    btype="${DETECTED_TYPES[$idx]}"
    bname="${DETECTED_NAMES[$idx]}"

    mkdir -p "$target"
    if [ "$btype" = "gecko" ]; then
        cp "$GECKO_TMP" "$target/com.torbox_streamer.host.json"
    else
        cp "$CHROMIUM_TMP" "$target/com.torbox_streamer.host.json"
    fi
    echo "  ✅ Installed manifest for $bname ($btype) -> $target"
    INSTALLED_COUNT=$((INSTALLED_COUNT + 1))
done

rm -f "$GECKO_TMP" "$CHROMIUM_TMP"

echo ""
echo "======================================================"
echo " 🎉 [SUCCESS] Native Host installed across $INSTALLED_COUNT browser(s)!"
echo " You can now launch MPV / VLC directly from TorBox Streamer."
echo "======================================================"
