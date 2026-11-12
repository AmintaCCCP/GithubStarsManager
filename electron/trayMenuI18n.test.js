const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  FALLBACK_LANGUAGE,
  TRAY_TRANSLATIONS,
  isSupportedLanguage,
  normalizeLanguage,
  getTrayMenuLabels,
} = require('./trayMenuI18n');

describe('trayMenuI18n', () => {
  const REQUIRED_KEYS = ['showMainWindow', 'autoLaunch', 'closeToTray', 'restartApp', 'quit'];

  it('defines valid translations for all supported languages', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      assert.ok(TRAY_TRANSLATIONS[lang], `Missing translations for ${lang}`);
      const labels = TRAY_TRANSLATIONS[lang];
      for (const key of REQUIRED_KEYS) {
        assert.equal(typeof labels[key], 'string', `${lang}.${key} should be a string`);
        assert.ok(labels[key].trim().length > 0, `${lang}.${key} should not be empty`);
      }
    }
  });

  it('isSupportedLanguage validates supported language codes', () => {
    assert.equal(isSupportedLanguage('zh'), true);
    assert.equal(isSupportedLanguage('en'), true);
    assert.equal(isSupportedLanguage('pt-BR'), true);
    assert.equal(isSupportedLanguage('zh-TW'), true);
    assert.equal(isSupportedLanguage('invalid'), false);
    assert.equal(isSupportedLanguage(null), false);
    assert.equal(isSupportedLanguage(123), false);
  });

  it('normalizeLanguage handles case insensitivity and regional variants', () => {
    assert.equal(normalizeLanguage('zh'), 'zh');
    assert.equal(normalizeLanguage('zh-CN'), 'zh');
    assert.equal(normalizeLanguage('zh_CN'), 'zh');
    assert.equal(normalizeLanguage('zh-Hans'), 'zh');
    assert.equal(normalizeLanguage('zh-tw'), 'zh-TW');
    assert.equal(normalizeLanguage('zh-HK'), 'zh-TW');
    assert.equal(normalizeLanguage('zh-Hant'), 'zh-TW');
    assert.equal(normalizeLanguage('en-US'), 'en');
    assert.equal(normalizeLanguage('en-GB'), 'en');
    assert.equal(normalizeLanguage('pt-br'), 'pt-BR');
    assert.equal(normalizeLanguage('ja-JP'), 'ja');
    assert.equal(normalizeLanguage('ko-KR'), 'ko');
    assert.equal(normalizeLanguage('fr-FR'), 'fr');
    assert.equal(normalizeLanguage('de-DE'), 'de');
    assert.equal(normalizeLanguage('es-ES'), 'es');
    assert.equal(normalizeLanguage('ru-RU'), 'ru');
  });

  it('normalizeLanguage falls back to default on empty/invalid and en on unknown', () => {
    assert.equal(normalizeLanguage(''), DEFAULT_LANGUAGE);
    assert.equal(normalizeLanguage(null), DEFAULT_LANGUAGE);
    assert.equal(normalizeLanguage(undefined), DEFAULT_LANGUAGE);
    assert.equal(normalizeLanguage('   '), DEFAULT_LANGUAGE);
    assert.equal(normalizeLanguage('it-IT'), FALLBACK_LANGUAGE);
    assert.equal(normalizeLanguage('sv'), FALLBACK_LANGUAGE);
  });

  it('getTrayMenuLabels returns correct localized labels', () => {
    const zh = getTrayMenuLabels('zh');
    assert.equal(zh.showMainWindow, '显示主窗口');
    assert.equal(zh.autoLaunch, '开机自动启动');
    assert.equal(zh.closeToTray, '关闭时最小化到托盘');
    assert.equal(zh.restartApp, '重启应用');
    assert.equal(zh.quit, '退出');

    const en = getTrayMenuLabels('en');
    assert.equal(en.showMainWindow, 'Show Main Window');
    assert.equal(en.autoLaunch, 'Launch at startup');
    assert.equal(en.closeToTray, 'Minimize to tray on close');
    assert.equal(en.restartApp, 'Restart App');
    assert.equal(en.quit, 'Quit');

    const ja = getTrayMenuLabels('ja');
    assert.equal(ja.showMainWindow, 'メインウィンドウを表示');
    assert.equal(ja.autoLaunch, '起動時に自動的に起動する');
    assert.equal(ja.quit, '終了');

    const zhTw = getTrayMenuLabels('zh-TW');
    assert.equal(zhTw.showMainWindow, '顯示主視窗');
    assert.equal(zhTw.closeToTray, '關閉時最小化到托盤');

    // Unknown language falls back to English
    const fallback = getTrayMenuLabels('unknown-lang');
    assert.deepEqual(fallback, en);
  });
});
