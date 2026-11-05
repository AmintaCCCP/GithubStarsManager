#!/bin/bash
# ==============================================================================
# Open Gatekeeper Friendly.command
#
# Fix "GitHub Stars Manager is damaged and can't be opened" on macOS.
# Removes the com.apple.quarantine attribute and refreshes local ad-hoc signatures.
# ==============================================================================

# Terminal colors
BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

APP_NAME="GitHub Stars Manager.app"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Parse arguments
NON_INTERACTIVE=0
TARGET_ARG=""

for arg in "$@"; do
    case "$arg" in
        --help|-h)
            echo "Usage: $0 [--non-interactive|-y] [path/to/GitHub Stars Manager.app]"
            echo ""
            echo "Removes macOS quarantine attributes from GitHub Stars Manager to resolve"
            echo "Gatekeeper 'app is damaged' errors."
            exit 0
            ;;
        --non-interactive|-y)
            NON_INTERACTIVE=1
            ;;
        *)
            if [ -z "$TARGET_ARG" ]; then
                TARGET_ARG="$arg"
            fi
            ;;
    esac
done

if [ -n "$CI" ] || [ ! -t 0 ]; then
    NON_INTERACTIVE=1
fi

# Set terminal window title
printf "\033]0;%s\007" "GitHub Stars Manager - Gatekeeper Fix" 2>/dev/null || true

if [ "$NON_INTERACTIVE" -eq 0 ]; then
    clear 2>/dev/null || true
fi

cat << "EOF"
==============================================================================
            GitHub Stars Manager - Gatekeeper & Quarantine Fix
==============================================================================
EOF
echo ""
echo "This helper removes the macOS quarantine attribute from GitHub Stars Manager."
echo "It resolves the following macOS Gatekeeper security prompts:"
echo "  • \"GitHub Stars Manager is damaged and can't be opened.\""
echo "  • \"macOS cannot verify that this app is free from malware.\""
echo ""

# Find target app
TARGET_APP=""

# 1. Argument passed directly
if [ -n "$TARGET_ARG" ] && [ -d "$TARGET_ARG" ]; then
    TARGET_APP="$TARGET_ARG"
    echo -e "${BLUE}ℹ${NC} Using specified application: ${BOLD}$TARGET_APP${NC}"
# 2. Installed in /Applications
elif [ -d "/Applications/$APP_NAME" ]; then
    TARGET_APP="/Applications/$APP_NAME"
    echo -e "${BLUE}ℹ${NC} Found application at: ${BOLD}$TARGET_APP${NC}"
# 3. Installed in ~/Applications
elif [ -d "$HOME/Applications/$APP_NAME" ]; then
    TARGET_APP="$HOME/Applications/$APP_NAME"
    echo -e "${BLUE}ℹ${NC} Found application at: ${BOLD}$TARGET_APP${NC}"
# 4. Present next to the script (e.g. inside the mounted DMG)
elif [ -d "$SCRIPT_DIR/$APP_NAME" ]; then
    echo -e "${YELLOW}!${NC} GitHub Stars Manager has not been copied to /Applications yet."
    echo ""
    copy_choice="Y"
    if [ "$NON_INTERACTIVE" -eq 0 ]; then
        read -r -p "Would you like to install it to /Applications now? [Y/n] " user_choice
        if [ -n "$user_choice" ]; then
            copy_choice="$user_choice"
        fi
    fi
    if [[ "$copy_choice" =~ ^[Yy]$ ]]; then
        echo -e "${BLUE}→${NC} Copying $APP_NAME to /Applications/..."
        if cp -R "$SCRIPT_DIR/$APP_NAME" /Applications/ 2>/dev/null; then
            TARGET_APP="/Applications/$APP_NAME"
        else
            echo -e "${YELLOW}!${NC} Administrator privileges required to copy to /Applications."
            sudo cp -R "$SCRIPT_DIR/$APP_NAME" /Applications/
            TARGET_APP="/Applications/$APP_NAME"
        fi
        echo -e "${GREEN}✓${NC} Copied to $TARGET_APP"
    else
        echo ""
        echo "Please drag '$APP_NAME' to Applications, then re-run this script."
        echo ""
        if [ "$NON_INTERACTIVE" -eq 0 ]; then
            read -n 1 -s -r -p "Press any key to exit..."
            echo ""
        fi
        exit 0
    fi
fi

# Fallback: prompt user if not located automatically
if [ -z "$TARGET_APP" ] || [ ! -d "$TARGET_APP" ]; then
    echo -e "${YELLOW}?${NC} Could not locate $APP_NAME automatically."
    if [ "$NON_INTERACTIVE" -eq 0 ]; then
        echo "Please drag and drop your installed $APP_NAME into this window, then press Enter:"
        read -r USER_PATH
        # Strip outer quotes and whitespace
        USER_PATH="${USER_PATH%\"}"
        USER_PATH="${USER_PATH#\"}"
        USER_PATH="${USER_PATH%\'}"
        USER_PATH="${USER_PATH#\'}"
        USER_PATH="$(echo "$USER_PATH" | xargs 2>/dev/null || echo "$USER_PATH")"

        if [ -n "$USER_PATH" ] && [ -d "$USER_PATH" ]; then
            TARGET_APP="$USER_PATH"
        fi
    fi
fi

if [ -z "$TARGET_APP" ] || [ ! -d "$TARGET_APP" ]; then
    echo -e "${RED}✗${NC} Could not find $APP_NAME."
    if [ "$NON_INTERACTIVE" -eq 0 ]; then
        read -n 1 -s -r -p "Press any key to exit..."
        echo ""
    fi
    exit 1
fi

echo ""
echo -e "${BLUE}→${NC} Removing quarantine and extended attributes from: ${BOLD}$TARGET_APP${NC}"

# Attempt without sudo first; escalate to sudo only if needed
NEED_SUDO=0
if ! xattr -cr "$TARGET_APP" 2>/dev/null; then
    NEED_SUDO=1
elif xattr -p com.apple.quarantine "$TARGET_APP" 2>/dev/null; then
    NEED_SUDO=1
fi

if [ "$NEED_SUDO" -eq 1 ]; then
    echo -e "${YELLOW}!${NC} Administrator privileges required to clear extended attributes."
    echo "Please enter your macOS user password when prompted (characters will not display):"
    sudo xattr -r -d com.apple.quarantine "$TARGET_APP" 2>/dev/null || true
    sudo xattr -cr "$TARGET_APP" 2>/dev/null || true
else
    xattr -r -d com.apple.quarantine "$TARGET_APP" 2>/dev/null || true
    xattr -cr "$TARGET_APP" 2>/dev/null || true
fi

# Re-sign ad-hoc on Apple Silicon / macOS to ensure valid code directory seal
if command -v codesign &>/dev/null; then
    echo -e "${BLUE}→${NC} Verifying code signature seal..."
    if [ "$NEED_SUDO" -eq 1 ]; then
        sudo codesign --force --deep --sign - "$TARGET_APP" 2>/dev/null || true
    else
        codesign --force --deep --sign - "$TARGET_APP" 2>/dev/null || sudo codesign --force --deep --sign - "$TARGET_APP" 2>/dev/null || true
    fi
fi

echo ""
# Verification check
if xattr -p com.apple.quarantine "$TARGET_APP" 2>/dev/null; then
    echo -e "${RED}✗${NC} Quarantine attribute is still present. Please run manually in Terminal:"
    echo "  sudo xattr -cr \"$TARGET_APP\""
else
    echo -e "${GREEN}✓ [SUCCESS] Quarantine removed successfully!${NC}"
    echo "GitHub Stars Manager is now ready to run."
fi

echo ""
if [ "$NON_INTERACTIVE" -eq 0 ]; then
    read -r -p "Would you like to launch GitHub Stars Manager now? [Y/n] " launch_choice
    launch_choice="${launch_choice:-Y}"
    if [[ "$launch_choice" =~ ^[Yy]$ ]]; then
        echo -e "${GREEN}→${NC} Launching GitHub Stars Manager..."
        open "$TARGET_APP"
    fi

    echo ""
    echo "Done! You can close this Terminal window."
    echo ""
    read -n 1 -s -r -p "Press any key to exit..."
    echo ""
fi

exit 0
