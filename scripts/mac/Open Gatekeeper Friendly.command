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

# 1. Argument passed directly - validate it is an app bundle with Contents/Info.plist
if [ -n "$TARGET_ARG" ]; then
    if [ -d "$TARGET_ARG" ] && [ -f "$TARGET_ARG/Contents/Info.plist" ]; then
        TARGET_APP="$TARGET_ARG"
        echo -e "${BLUE}ℹ${NC} Using specified application: ${BOLD}$TARGET_APP${NC}"
    else
        echo -e "${RED}✗${NC} Target '$TARGET_ARG' is not a valid macOS application bundle (missing Contents/Info.plist)."
        if [ "$NON_INTERACTIVE" -eq 0 ]; then
            read -n 1 -s -r -p "Press any key to exit..."
            echo ""
        fi
        exit 1
    fi
# 2. Installed in /Applications
elif [ -d "/Applications/$APP_NAME" ] && [ -f "/Applications/$APP_NAME/Contents/Info.plist" ]; then
    TARGET_APP="/Applications/$APP_NAME"
    echo -e "${BLUE}ℹ${NC} Found application at: ${BOLD}$TARGET_APP${NC}"
# 3. Installed in ~/Applications
elif [ -d "$HOME/Applications/$APP_NAME" ] && [ -f "$HOME/Applications/$APP_NAME/Contents/Info.plist" ]; then
    TARGET_APP="$HOME/Applications/$APP_NAME"
    echo -e "${BLUE}ℹ${NC} Found application at: ${BOLD}$TARGET_APP${NC}"
# 4. Present next to the script (e.g. inside the mounted DMG)
elif [ -d "$SCRIPT_DIR/$APP_NAME" ] && [ -f "$SCRIPT_DIR/$APP_NAME/Contents/Info.plist" ]; then
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
            if sudo cp -R "$SCRIPT_DIR/$APP_NAME" /Applications/; then
                TARGET_APP="/Applications/$APP_NAME"
            else
                echo -e "${RED}✗${NC} Failed to copy $APP_NAME to /Applications."
                if [ "$NON_INTERACTIVE" -eq 0 ]; then
                    read -n 1 -s -r -p "Press any key to exit..."
                    echo ""
                fi
                exit 1
            fi
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
        # Strip leading/trailing whitespace
        USER_PATH="$(echo "$USER_PATH" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
        # Strip outer matching quotes without compressing multiple internal spaces
        if [[ "$USER_PATH" =~ ^\"(.*)\"$ ]]; then
            USER_PATH="${BASH_REMATCH[1]}"
        elif [[ "$USER_PATH" =~ ^\'(.*)\'$ ]]; then
            USER_PATH="${BASH_REMATCH[1]}"
        fi
        # Handle drag-and-drop backslash-escaped spaces if original path does not exist
        if [ ! -e "$USER_PATH" ]; then
            UNESCAPED_PATH="${USER_PATH//\\ / }"
            if [ -e "$UNESCAPED_PATH" ]; then
                USER_PATH="$UNESCAPED_PATH"
            fi
        fi

        if [ -n "$USER_PATH" ] && [ -d "$USER_PATH" ] && [ -f "$USER_PATH/Contents/Info.plist" ]; then
            TARGET_APP="$USER_PATH"
        elif [ -n "$USER_PATH" ]; then
            echo -e "${RED}✗${NC} The path '$USER_PATH' is not a valid macOS application bundle (missing Contents/Info.plist)."
        fi
    fi
fi

if [ -z "$TARGET_APP" ] || [ ! -d "$TARGET_APP" ]; then
    echo -e "${RED}✗${NC} Could not find a valid $APP_NAME bundle."
    if [ "$NON_INTERACTIVE" -eq 0 ]; then
        read -n 1 -s -r -p "Press any key to exit..."
        echo ""
    fi
    exit 1
fi

echo ""
echo -e "${BLUE}→${NC} Removing quarantine and extended attributes from: ${BOLD}$TARGET_APP${NC}"

# Helper to recursively inspect quarantine attribute names and detect command errors
check_quarantine_remaining() {
    local target="$1"
    local use_sudo="${2:-0}"
    local output
    local rc
    if [ "$use_sudo" -eq 1 ]; then
        if [ "$NON_INTERACTIVE" -eq 1 ]; then
            output="$(sudo -n xattr -r "$target" 2>&1)"
        else
            output="$(sudo xattr -r "$target" 2>&1)"
        fi
        rc=$?
    else
        output="$(xattr -r "$target" 2>&1)"
        rc=$?
    fi
    if echo "$output" | grep -q "com\.apple\.quarantine"; then
        return 1 # quarantine attribute present
    elif [ "$rc" -ne 0 ]; then
        return 2 # xattr command error
    else
        return 0 # clean
    fi
}

# Attempt without sudo first; escalate to sudo only if needed
NEED_SUDO=0
if ! xattr -cr "$TARGET_APP" 2>/dev/null; then
    NEED_SUDO=1
else
    check_quarantine_remaining "$TARGET_APP" 0
    CHECK_STATUS=$?
    if [ "$CHECK_STATUS" -ne 0 ]; then
        NEED_SUDO=1
    fi
fi

if [ "$NEED_SUDO" -eq 1 ]; then
    if [ "$NON_INTERACTIVE" -eq 1 ]; then
        sudo -n xattr -r -d com.apple.quarantine "$TARGET_APP" 2>/dev/null || true
        sudo -n xattr -cr "$TARGET_APP" 2>/dev/null || true
    else
        echo -e "${YELLOW}!${NC} Administrator privileges required to clear extended attributes."
        echo "Please enter your macOS user password when prompted (characters will not display):"
        sudo xattr -r -d com.apple.quarantine "$TARGET_APP" 2>/dev/null || true
        sudo xattr -cr "$TARGET_APP" 2>/dev/null || true
    fi
else
    xattr -r -d com.apple.quarantine "$TARGET_APP" 2>/dev/null || true
    xattr -cr "$TARGET_APP" 2>/dev/null || true
fi

# Re-sign ad-hoc on Apple Silicon / macOS to ensure valid code directory seal while preserving metadata
SIGN_FAILED=0
SIGN_VERIFY_FAILED=0
SIGN_VERIFY_WITH_SUDO=0
if command -v codesign &>/dev/null; then
    echo -e "${BLUE}→${NC} Verifying code signature seal..."
    SUDO_CODESIGN="sudo"
    if [ "$NON_INTERACTIVE" -eq 1 ]; then
        SUDO_CODESIGN="sudo -n"
    fi

    if [ "$NEED_SUDO" -eq 1 ]; then
        if ! $SUDO_CODESIGN codesign --force --deep --preserve-metadata=entitlements,requirements,flags,runtime --sign - "$TARGET_APP" 2>/dev/null; then
            SIGN_FAILED=1
        else
            SIGN_VERIFY_WITH_SUDO=1
        fi
    else
        if codesign --force --deep --preserve-metadata=entitlements,requirements,flags,runtime --sign - "$TARGET_APP" 2>/dev/null; then
            :
        elif $SUDO_CODESIGN codesign --force --deep --preserve-metadata=entitlements,requirements,flags,runtime --sign - "$TARGET_APP" 2>/dev/null; then
            SIGN_VERIFY_WITH_SUDO=1
        else
            SIGN_FAILED=1
        fi
    fi

    if [ "$SIGN_FAILED" -eq 0 ]; then
        if [ "$SIGN_VERIFY_WITH_SUDO" -eq 1 ]; then
            if ! $SUDO_CODESIGN codesign --verify --deep --strict "$TARGET_APP" 2>/dev/null; then
                SIGN_VERIFY_FAILED=1
            fi
        elif ! codesign --verify --deep --strict "$TARGET_APP" 2>/dev/null; then
            SIGN_VERIFY_FAILED=1
        fi
    fi
fi

echo ""
HAS_ERROR=0

# Recursive verification check across entire app bundle
check_quarantine_remaining "$TARGET_APP" "$NEED_SUDO"
QUARANTINE_STATUS=$?

if [ "$QUARANTINE_STATUS" -eq 1 ]; then
    echo -e "${RED}✗${NC} Quarantine attribute is still present on one or more files in the app bundle."
    echo "Please run manually in Terminal:"
    echo "  sudo xattr -cr \"$TARGET_APP\""
    HAS_ERROR=1
elif [ "$QUARANTINE_STATUS" -eq 2 ]; then
    echo -e "${RED}✗${NC} Failed to inspect extended attributes on the app bundle (inspection error)."
    echo "Please run manually in Terminal:"
    echo "  sudo xattr -cr \"$TARGET_APP\""
    HAS_ERROR=1
elif [ "$SIGN_FAILED" -eq 1 ]; then
    echo -e "${RED}✗${NC} Ad-hoc code re-signing failed. The app signature seal could not be refreshed."
    HAS_ERROR=1
elif [ "$SIGN_VERIFY_FAILED" -eq 1 ]; then
    echo -e "${RED}✗${NC} Strict code signature verification failed. The app code seal is invalid."
    HAS_ERROR=1
else
    echo -e "${GREEN}✓ [SUCCESS] Quarantine removed successfully!${NC}"
    echo "GitHub Stars Manager is now ready to run."
fi

if [ "$HAS_ERROR" -eq 1 ]; then
    if [ "$NON_INTERACTIVE" -eq 0 ]; then
        read -n 1 -s -r -p "Press any key to exit..."
        echo ""
    fi
    exit 1
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
