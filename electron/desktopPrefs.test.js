const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_DESKTOP_PREFS,
  normalizeDesktopPrefs,
  getPrefsPath,
  loadDesktopPrefs,
  saveDesktopPrefs,
  getLinuxAutostartPath,
  buildLinuxDesktopEntry,
  LINUX_DESKTOP_FILENAME,
} = require('./desktopPrefs');

describe('desktopPrefs defaults (#345)', () => {
  it('auto-launch defaults OFF, close-to-tray defaults ON', () => {
    assert.equal(DEFAULT_DESKTOP_PREFS.autoLaunch, false);
    assert.equal(DEFAULT_DESKTOP_PREFS.closeToTray, true);
    assert.equal(DEFAULT_DESKTOP_PREFS.minimizeToTray, true);
  });

  it('normalizeDesktopPrefs falls back per-key on garbage input', () => {
    assert.deepEqual(normalizeDesktopPrefs(null), { ...DEFAULT_DESKTOP_PREFS });
    assert.deepEqual(normalizeDesktopPrefs(undefined), { ...DEFAULT_DESKTOP_PREFS });
    assert.deepEqual(normalizeDesktopPrefs('nope'), { ...DEFAULT_DESKTOP_PREFS });
    assert.deepEqual(normalizeDesktopPrefs({ autoLaunch: true }), {
      autoLaunch: true,
      closeToTray: true,
      minimizeToTray: true,
    });
    assert.deepEqual(
      normalizeDesktopPrefs({ autoLaunch: 'yes', closeToTray: 0, minimizeToTray: false }),
      { autoLaunch: false, closeToTray: true, minimizeToTray: false },
    );
  });

  it('getPrefsPath nests under userData', () => {
    assert.equal(
      getPrefsPath('/tmp/user-data', path),
      path.join('/tmp/user-data', 'desktop-prefs.json'),
    );
  });
});

describe('desktopPrefs persistence', () => {
  it('loadDesktopPrefs returns defaults when file is missing', () => {
    const fs = { existsSync: () => false };
    assert.deepEqual(
      loadDesktopPrefs({ fs, pathModule: path, userDataPath: '/nope' }),
      { ...DEFAULT_DESKTOP_PREFS },
    );
  });

  it('loadDesktopPrefs returns defaults on corrupt JSON', () => {
    const fs = { existsSync: () => true, readFileSync: () => '{broken' };
    assert.deepEqual(
      loadDesktopPrefs({ fs, pathModule: path, userDataPath: '/nope' }),
      { ...DEFAULT_DESKTOP_PREFS },
    );
  });

  it('saveDesktopPrefs normalizes before writing', () => {
    let written = null;
    const fs = {
      writeFileSync: (p, content) => {
        written = { p, content };
      },
    };
    const saved = saveDesktopPrefs(
      { fs, pathModule: path, userDataPath: '/tmp/ud' },
      { autoLaunch: true, closeToTray: 'bad' },
    );
    assert.deepEqual(saved, { autoLaunch: true, closeToTray: true, minimizeToTray: true });
    assert.equal(written.p, path.join('/tmp/ud', 'desktop-prefs.json'));
    assert.deepEqual(JSON.parse(written.content), saved);
  });
});

describe('linux autostart entry', () => {
  it('getLinuxAutostartPath targets ~/.config/autostart', () => {
    const got = getLinuxAutostartPath({ homeDir: os.homedir(), pathModule: path });
    assert.equal(got, path.join(os.homedir(), '.config', 'autostart', LINUX_DESKTOP_FILENAME));
  });

  it('buildLinuxDesktopEntry quotes spaced exec paths and starts hidden', () => {
    const entry = buildLinuxDesktopEntry({ execPath: '/opt/My App/app', iconPath: '/opt/icon.png' });
    assert.match(entry, /^\[Desktop Entry\]/m);
    assert.match(entry, /^Type=Application$/m);
    assert.match(entry, /^Exec="\/opt\/My App\/app" --hidden$/m);
    assert.match(entry, /^Icon=\/opt\/icon\.png$/m);
    assert.match(entry, /^X-GNOME-Autostart-enabled=true$/m);
  });

  it('buildLinuxDesktopEntry omits Icon when not provided', () => {
    const entry = buildLinuxDesktopEntry({ execPath: '/usr/bin/app', hidden: false });
    assert.match(entry, /^Exec=\/usr\/bin\/app$/m);
    assert.doesNotMatch(entry, /^Icon=/m);
  });
});
