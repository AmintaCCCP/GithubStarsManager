/**
 * Tray menu internationalization for the desktop shell.
 *
 * Keeps tray menu labels in sync with the user's selected app language (#601).
 * Pure functions with zero Electron dependencies so they can be unit-tested.
 */

const SUPPORTED_LANGUAGES = Object.freeze([
  'zh',
  'en',
  'ja',
  'es',
  'pt-BR',
  'ru',
  'zh-TW',
  'fr',
  'de',
  'ko',
]);

const DEFAULT_LANGUAGE = 'zh';
const FALLBACK_LANGUAGE = 'en';

const TRAY_TRANSLATIONS = Object.freeze({
  zh: Object.freeze({
    showMainWindow: '显示主窗口',
    autoLaunch: '开机自动启动',
    closeToTray: '关闭时最小化到托盘',
    restartApp: '重启应用',
    quit: '退出',
  }),
  'zh-TW': Object.freeze({
    showMainWindow: '顯示主視窗',
    autoLaunch: '開機自動啟動',
    closeToTray: '關閉時最小化到托盤',
    restartApp: '重啟應用',
    quit: '退出',
  }),
  en: Object.freeze({
    showMainWindow: 'Show Main Window',
    autoLaunch: 'Launch at startup',
    closeToTray: 'Minimize to tray on close',
    restartApp: 'Restart App',
    quit: 'Quit',
  }),
  ja: Object.freeze({
    showMainWindow: 'メインウィンドウを表示',
    autoLaunch: '起動時に自動的に起動する',
    closeToTray: '閉じるときにトレイに最小化する',
    restartApp: 'アプリを再起動',
    quit: '終了',
  }),
  es: Object.freeze({
    showMainWindow: 'Mostrar ventana principal',
    autoLaunch: 'Iniciar automáticamente al arrancar',
    closeToTray: 'Minimizar a bandeja al cerrar',
    restartApp: 'Reiniciar aplicación',
    quit: 'Salir',
  }),
  'pt-BR': Object.freeze({
    showMainWindow: 'Mostrar janela principal',
    autoLaunch: 'Iniciar automaticamente na inicialização',
    closeToTray: 'Minimizar para a bandeja ao fechar',
    restartApp: 'Reiniciar aplicativo',
    quit: 'Sair',
  }),
  ru: Object.freeze({
    showMainWindow: 'Показать главное окно',
    autoLaunch: 'Автоматический запуск при загрузке',
    closeToTray: 'Свернуть в трей при закрытии',
    restartApp: 'Перезапустить приложение',
    quit: 'Выйти',
  }),
  fr: Object.freeze({
    showMainWindow: 'Afficher la fenêtre principale',
    autoLaunch: 'Démarrer automatiquement au démarrage',
    closeToTray: 'Réduire dans le bac lors de la fermeture',
    restartApp: "Redémarrer l'application",
    quit: 'Quitter',
  }),
  de: Object.freeze({
    showMainWindow: 'Hauptfenster anzeigen',
    autoLaunch: 'Beim Booten automatisch starten',
    closeToTray: 'Beim Schließen auf das Fach minimieren',
    restartApp: 'App neu starten',
    quit: 'Beenden',
  }),
  ko: Object.freeze({
    showMainWindow: '메인 창 표시',
    autoLaunch: '부팅 시 자동으로 시작',
    closeToTray: '닫을 때 트레이로 최소화',
    restartApp: '앱 다시 시작',
    quit: '종료',
  }),
});

const LANGUAGE_MATCHERS = [
  ['zh-TW', /^zh[-_](?:tw|hk|mo|hant)\b/i],
  ['ja', /^ja\b/i],
  ['ko', /^ko\b/i],
  ['ru', /^ru\b/i],
  ['fr', /^fr\b/i],
  ['de', /^de\b/i],
  ['es', /^es\b/i],
  ['pt-BR', /^pt\b/i],
  ['en', /^en\b/i],
  ['zh', /^zh\b/i],
];

/**
 * Check if the given code is exactly one of the supported languages.
 * @param {unknown} code
 * @returns {boolean}
 */
function isSupportedLanguage(code) {
  return typeof code === 'string' && SUPPORTED_LANGUAGES.includes(code);
}

/**
 * Normalize an arbitrary locale or language tag into a supported AppLanguage.
 * Defaults to 'zh' on empty/non-string input; falls back to 'en' on unknown locales.
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeLanguage(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return DEFAULT_LANGUAGE;
  }
  const trimmed = raw.trim();
  const directMatch = SUPPORTED_LANGUAGES.find(
    (lang) => lang.toLowerCase() === trimmed.toLowerCase(),
  );
  if (directMatch) return directMatch;

  const normalizedTag = trimmed.replace(/_/g, '-');
  for (const [code, pattern] of LANGUAGE_MATCHERS) {
    if (pattern.test(normalizedTag)) return code;
  }
  return FALLBACK_LANGUAGE;
}

/**
 * Retrieve tray menu labels for the specified language.
 * @param {unknown} language
 * @returns {{ showMainWindow: string, autoLaunch: string, closeToTray: string, restartApp: string, quit: string }}
 */
function getTrayMenuLabels(language) {
  const normalized = normalizeLanguage(language);
  return TRAY_TRANSLATIONS[normalized] || TRAY_TRANSLATIONS[FALLBACK_LANGUAGE];
}

module.exports = {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  FALLBACK_LANGUAGE,
  TRAY_TRANSLATIONS,
  isSupportedLanguage,
  normalizeLanguage,
  getTrayMenuLabels,
};
