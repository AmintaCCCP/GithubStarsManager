/**
 * Desktop prefs (auto-launch + tray behavior) — pure, testable helpers.
 *
 * Main process (`main.js`) owns persistence under `app.getPath('userData')`.
 * This module exposes defaults, normalization, and the Linux autostart
 * entry builder so they can be unit-tested without Electron.
 */

const APP_SLUG = 'github-stars-manager';
const PREFS_FILENAME = 'desktop-prefs.json';
const LINUX_DESKTOP_FILENAME = `${APP_SLUG}.desktop`;

const DEFAULT_DESKTOP_PREFS = Object.freeze({
  // #345 decisions: auto-launch OFF by default, close-to-tray ON by default.
  autoLaunch: false,
  closeToTray: true,
  minimizeToTray: true,
});

/**
 * Normalize unknown persisted input into a valid prefs object.
 * Unknown/missing keys fall back to defaults; never throws.
 * @param {unknown} raw
 * @returns {{ autoLaunch: boolean, closeToTray: boolean, minimizeToTray: boolean }}
 */
function normalizeDesktopPrefs(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    autoLaunch:
      typeof source.autoLaunch === 'boolean'
        ? source.autoLaunch
        : DEFAULT_DESKTOP_PREFS.autoLaunch,
    closeToTray:
      typeof source.closeToTray === 'boolean'
        ? source.closeToTray
        : DEFAULT_DESKTOP_PREFS.closeToTray,
    minimizeToTray:
      typeof source.minimizeToTray === 'boolean'
        ? source.minimizeToTray
        : DEFAULT_DESKTOP_PREFS.minimizeToTray,
  };
}

/**
 * @param {string} userDataPath value of `app.getPath('userData')`
 * @param {{ join: (...parts: string[]) => string }} pathModule injectable `path`
 */
function getPrefsPath(userDataPath, pathModule) {
  return pathModule.join(userDataPath, PREFS_FILENAME);
}

/**
 * Load prefs from disk. Missing/corrupt files yield defaults (never throws).
 */
function loadDesktopPrefs({ fs, pathModule, userDataPath }) {
  try {
    const prefsPath = getPrefsPath(userDataPath, pathModule);
    if (!fs.existsSync(prefsPath)) return { ...DEFAULT_DESKTOP_PREFS };
    const raw = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
    return normalizeDesktopPrefs(raw);
  } catch {
    return { ...DEFAULT_DESKTOP_PREFS };
  }
}

/**
 * Persist prefs to disk. Throws on I/O failure so callers can surface errors.
 */
function saveDesktopPrefs({ fs, pathModule, userDataPath }, prefs) {
  const normalized = normalizeDesktopPrefs(prefs);
  const prefsPath = getPrefsPath(userDataPath, pathModule);
  fs.writeFileSync(prefsPath, JSON.stringify(normalized, null, 2));
  return normalized;
}

/**
 * Linux autostart entry path: `~/.config/autostart/github-stars-manager.desktop`.
 */
function getLinuxAutostartPath({ homeDir, pathModule }) {
  return pathModule.join(homeDir, '.config', 'autostart', LINUX_DESKTOP_FILENAME);
}

/**
 * Build the freedesktop `.desktop` entry used for Linux auto-launch.
 * @param {{ execPath: string, iconPath?: string, hidden?: boolean }} options
 */
function buildLinuxDesktopEntry({ execPath, iconPath, hidden = true }) {
  const quotedExec = execPath.includes(' ') ? `"${execPath}"` : execPath;
  const lines = [
    '[Desktop Entry]',
    'Type=Application',
    `Name=GitHub Stars Manager`,
    `Exec=${quotedExec}${hidden ? ' --hidden' : ''}`,
    iconPath ? `Icon=${iconPath}` : null,
    'Terminal=false',
    'Categories=Office;',
    'X-GNOME-Autostart-enabled=true',
  ].filter(Boolean);
  return `${lines.join('\n')}\n`;
}

module.exports = {
  APP_SLUG,
  PREFS_FILENAME,
  LINUX_DESKTOP_FILENAME,
  DEFAULT_DESKTOP_PREFS,
  normalizeDesktopPrefs,
  getPrefsPath,
  loadDesktopPrefs,
  saveDesktopPrefs,
  getLinuxAutostartPath,
  buildLinuxDesktopEntry,
};
