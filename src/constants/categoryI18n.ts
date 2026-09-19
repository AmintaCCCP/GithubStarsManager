import type { AppLanguage } from '../i18n/languages';

/**
 * 内置分类的多语言显示名（按稳定 id 键）。`zh` 是规范身份名（schema.defaultCategories
 * 与 GitHub list 历史名一致）；`en` 与旧 translateCategoryName 逐值相等（fixture 锁定）。
 * 其余语言由 AI 初稿生成，欢迎社区校对。
 */
export const CATEGORY_NAMES: Record<string, { zh: string } & Partial<Record<AppLanguage, string>>> = {
  all: { zh: '全部分类', en: 'All Categories', ja: 'すべて', es: 'Todas las categorías', 'pt-BR': 'Todas as categorias', ru: 'Все категории', 'zh-TW': '全部分類', fr: 'Toutes les catégories', de: 'Alle Kategorien', ko: '전체 카테고리' },
  web: { zh: 'Web应用', en: 'Web Apps', ja: 'Webアプリ', es: 'Aplicaciones web', 'pt-BR': 'Aplicativos web', ru: 'Веб-приложения', 'zh-TW': '網頁應用', fr: 'Applications web', de: 'Web-Apps', ko: '웹 앱' },
  mobile: { zh: '移动应用', en: 'Mobile Apps', ja: 'モバイルアプリ', es: 'Aplicaciones móviles', 'pt-BR': 'Aplicativos móveis', ru: 'Мобильные приложения', 'zh-TW': '行動應用', fr: 'Applications mobiles', de: 'Mobile Apps', ko: '모바일 앱' },
  desktop: { zh: '桌面应用', en: 'Desktop Apps', ja: 'デスクトップアプリ', es: 'Aplicaciones de escritorio', 'pt-BR': 'Aplicativos de desktop', ru: 'Настольные приложения', 'zh-TW': '桌面應用', fr: 'Applications de bureau', de: 'Desktop-Apps', ko: '데스크톱 앱' },
  database: { zh: '数据库', en: 'Database', ja: 'データベース', es: 'Bases de datos', 'pt-BR': 'Bancos de dados', ru: 'Базы данных', 'zh-TW': '資料庫', fr: 'Bases de données', de: 'Datenbanken', ko: '데이터베이스' },
  ai: { zh: 'AI/机器学习', en: 'AI/Machine Learning', ja: 'AI・機械学習', es: 'IA y machine learning', 'pt-BR': 'IA e machine learning', ru: 'ИИ и машинное обучение', 'zh-TW': 'AI／機器學習', fr: 'IA et machine learning', de: 'KI & Machine Learning', ko: 'AI·머신러닝' },
  devtools: { zh: '开发工具', en: 'Development Tools', ja: '開発ツール', es: 'Herramientas de desarrollo', 'pt-BR': 'Ferramentas de desenvolvimento', ru: 'Инструменты разработки', 'zh-TW': '開發工具', fr: 'Outils de développement', de: 'Entwicklungstools', ko: '개발 도구' },
  security: { zh: '安全工具', en: 'Security Tools', ja: 'セキュリティツール', es: 'Herramientas de seguridad', 'pt-BR': 'Ferramentas de segurança', ru: 'Инструменты безопасности', 'zh-TW': '資安工具', fr: 'Outils de sécurité', de: 'Sicherheitstools', ko: '보안 도구' },
  game: { zh: '游戏', en: 'Games', ja: 'ゲーム', es: 'Juegos', 'pt-BR': 'Jogos', ru: 'Игры', 'zh-TW': '遊戲', fr: 'Jeux', de: 'Spiele', ko: '게임' },
  design: { zh: '设计工具', en: 'Design Tools', ja: 'デザインツール', es: 'Herramientas de diseño', 'pt-BR': 'Ferramentas de design', ru: 'Инструменты дизайна', 'zh-TW': '設計工具', fr: 'Outils de design', de: 'Design-Tools', ko: '디자인 도구' },
  productivity: { zh: '效率工具', en: 'Productivity Tools', ja: '生産性ツール', es: 'Herramientas de productividad', 'pt-BR': 'Ferramentas de produtividade', ru: 'Инструменты продуктивности', 'zh-TW': '效率工具', fr: 'Outils de productivité', de: 'Produktivitätstools', ko: '생산성 도구' },
  education: { zh: '教育学习', en: 'Education', ja: '教育・学習', es: 'Educación y aprendizaje', 'pt-BR': 'Educação e aprendizado', ru: 'Образование и обучение', 'zh-TW': '教育學習', fr: 'Éducation et apprentissage', de: 'Bildung & Lernen', ko: '교육·학습' },
  social: { zh: '社交网络', en: 'Social Network', ja: 'ソーシャルネットワーク', es: 'Redes sociales', 'pt-BR': 'Redes sociais', ru: 'Социальные сети', 'zh-TW': '社群網路', fr: 'Réseaux sociaux', de: 'Soziale Netzwerke', ko: '소셜 네트워크' },
  analytics: { zh: '数据分析', en: 'Data Analytics', ja: 'データ分析', es: 'Análisis de datos', 'pt-BR': 'Análise de dados', ru: 'Аналитика данных', 'zh-TW': '資料分析', fr: 'Analyse de données', de: 'Datenanalyse', ko: '데이터 분석' },
};

/** 内置分类在某语言的显示名；缺译文回退 en，再回退中文规范名。 */
export const categoryName = (id: string, language: AppLanguage): string => {
  const entry = CATEGORY_NAMES[id];
  if (!entry) return id;
  if (language === 'zh') return entry.zh;
  return entry[language] ?? entry.en ?? entry.zh;
};

const ID_BY_ANY_NAME = new Map<string, string>();
for (const [id, entry] of Object.entries(CATEGORY_NAMES)) {
  for (const name of Object.values(entry)) {
    if (name) ID_BY_ANY_NAME.set(name, id);
  }
}

/**
 * 某内置分类在全部语言下的显示名集合（含用户 override）。
 * 用于锁定分类的跨语言匹配与 GitHub List 的名称变体匹配。
 */
export const builtinCategoryNameVariants = (originalZhName: string, overrideName?: string): string[] => {
  const variants = new Set<string>([originalZhName]);
  const id = ID_BY_ANY_NAME.get(originalZhName);
  if (id) {
    const entry = CATEGORY_NAMES[id];
    for (const name of Object.values(entry)) {
      if (name) variants.add(name);
    }
  }
  if (overrideName && overrideName !== originalZhName) {
    variants.add(overrideName);
  }
  return [...variants];
};

/** 判断名称是否是任意内置分类在任意语言下的显示名。 */
export const isBuiltinCategoryDisplayName = (name: string): boolean => ID_BY_ANY_NAME.has(name);

/**
 * 内置分类的扩展关键词（按语言补充）。zh/en 关键词已在 schema.defaultCategories
 * 内置，这里只为新语言补充，保证新语言 AI tags 能归入内置分类。
 */
export const CATEGORY_EXTRA_KEYWORDS: Record<string, Partial<Record<AppLanguage, string[]>>> = {
  // 各语言的典型 AI tags 关键词（AI tags 语言跟随 UI 语言，见 aiLanguage.ts）。
  // 匹配逻辑为双向 includes，短词干即可命中；zh/en 关键词已内置于 schema.defaultCategories。
  all: {},
  web: {
    'zh-TW': ['網頁應用', '網站'],
    ja: ['ウェブアプリ', 'webアプリ'],
    ko: ['웹 앱', '웹앱'],
    es: ['aplicaciones web', 'aplicación web'],
    'pt-BR': ['aplicativos web', 'aplicativo web'],
    fr: ['applications web', 'application web'],
    de: ['web-apps', 'webanwendungen'],
    ru: ['веб-приложения', 'веб-приложение'],
  },
  mobile: {
    'zh-TW': ['行動應用'],
    ja: ['モバイルアプリ'],
    ko: ['모바일 앱', '모바일'],
    es: ['aplicaciones móviles', 'aplicación móvil'],
    'pt-BR': ['aplicativos móveis', 'aplicativo móvel'],
    fr: ['applications mobiles', 'application mobile'],
    de: ['mobile apps', 'mobilapps'],
    ru: ['мобильные приложения', 'мобильное приложение'],
  },
  desktop: {
    'zh-TW': ['桌面應用'],
    ja: ['デスクトップアプリ'],
    ko: ['데스크톱 앱', '데스크톱'],
    es: ['aplicaciones de escritorio', 'aplicación de escritorio'],
    'pt-BR': ['aplicativos de desktop', 'aplicativo de desktop'],
    fr: ['applications de bureau', 'application de bureau'],
    de: ['desktop-apps', 'desktop-anwendungen'],
    ru: ['настольные приложения', 'настольное приложение'],
  },
  database: {
    'zh-TW': ['資料庫'],
    ja: ['データベース'],
    ko: ['데이터베이스'],
    es: ['bases de datos', 'base de datos'],
    'pt-BR': ['banco de dados', 'bancos de dados'],
    fr: ['bases de données', 'base de données'],
    de: ['datenbanken', 'datenbank'],
    ru: ['базы данных', 'база данных'],
  },
  ai: {
    'zh-TW': ['ai工具', '機器學習'],
    ja: ['aiツール', '機械学習'],
    ko: ['ai 도구', '머신러닝'],
    es: ['herramientas de ia', 'herramienta de ia'],
    'pt-BR': ['ferramentas de ia', 'ferramenta de ia'],
    fr: ['outils ia', 'outil ia'],
    de: ['ki-tools', 'ki-tool'],
    ru: ['ии-инструменты', 'ии-инструмент'],
  },
  devtools: {
    'zh-TW': ['開發工具'],
    ja: ['開発ツール'],
    ko: ['개발 도구'],
    es: ['herramientas de desarrollo', 'herramienta de desarrollo'],
    'pt-BR': ['ferramentas de desenvolvimento', 'ferramenta de desenvolvimento'],
    fr: ['outils de développement', 'outil de développement'],
    de: ['entwicklungstools', 'entwicklungswerkzeuge'],
    ru: ['инструменты разработки', 'инструмент разработки'],
  },
  security: {
    'zh-TW': ['資訊安全', '安全工具'],
    ja: ['セキュリティツール', 'セキュリティ'],
    ko: ['보안 도구', '보안'],
    es: ['herramientas de seguridad', 'seguridad'],
    'pt-BR': ['ferramentas de segurança', 'segurança'],
    fr: ['outils de sécurité', 'sécurité'],
    de: ['sicherheitstools', 'sicherheit'],
    ru: ['инструменты безопасности', 'безопасность'],
  },
  game: {
    'zh-TW': ['遊戲'],
    ja: ['ゲーム'],
    ko: ['게임'],
    es: ['juegos', 'juego'],
    'pt-BR': ['jogos', 'jogo'],
    fr: ['jeux', 'jeu'],
    de: ['spiele', 'spiel'],
    ru: ['игры', 'игра'],
  },
  design: {
    'zh-TW': ['設計工具'],
    ja: ['デザインツール', 'デザイン'],
    ko: ['디자인 도구', '디자인'],
    es: ['herramientas de diseño', 'diseño'],
    'pt-BR': ['ferramentas de design', 'design'],
    fr: ['outils de design', 'design'],
    de: ['design-tools', 'designtools'],
    ru: ['инструменты дизайна', 'дизайн'],
  },
  productivity: {
    'zh-TW': ['效率工具', '生產力'],
    ja: ['生産性ツール', 'プロダクティビティ'],
    ko: ['생산성 도구', '생산성'],
    es: ['herramientas de productividad', 'productividad'],
    'pt-BR': ['ferramentas de produtividade', 'produtividade'],
    fr: ['outils de productivité', 'productivité'],
    de: ['produktivitätstools', 'produktivität'],
    ru: ['инструменты продуктивности', 'продуктивность'],
  },
  education: {
    'zh-TW': ['教育學習', '教育'],
    ja: ['教育ツール', '教育'],
    ko: ['교육 도구', '교육'],
    es: ['educación', 'educacion'],
    'pt-BR': ['educação', 'educacao'],
    fr: ['éducation', 'apprentissage'],
    de: ['bildung', 'lernen'],
    ru: ['образование', 'обучение'],
  },
  social: {
    'zh-TW': ['社交網絡', '社群'],
    ja: ['ソーシャルネットワーク', 'ソーシャル'],
    ko: ['소셜 네트워크', '소셜'],
    es: ['redes sociales', 'red social'],
    'pt-BR': ['redes sociais', 'rede social'],
    fr: ['réseaux sociaux', 'réseau social'],
    de: ['soziale netzwerke', 'soziales netzwerk'],
    ru: ['социальные сети', 'соцсети'],
  },
  analytics: {
    'zh-TW': ['數據分析'],
    ja: ['データ分析', '分析ツール'],
    ko: ['데이터 분석', '분석 도구'],
    es: ['análisis de datos', 'analítica'],
    'pt-BR': ['análise de dados', 'análise'],
    fr: ['analyse de données', 'analytique'],
    de: ['datenanalyse', 'analytik'],
    ru: ['анализ данных', 'аналитика'],
  },
};

/** 某内置分类在指定语言下的附加关键词（追加在 schema 关键词之后）。 */
export const categoryExtraKeywords = (id: string, language: AppLanguage): string[] =>
  CATEGORY_EXTRA_KEYWORDS[id]?.[language] ?? [];
