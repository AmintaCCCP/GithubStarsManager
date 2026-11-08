import {
  Activity,
  BarChart3,
  Bell,
  Blocks,
  BookOpen,
  Bookmark,
  Bot,
  BrainCircuit,
  Cable,
  Camera,
  CheckCircle,
  Clapperboard,
  Cloud,
  Code2,
  Compass,
  Cpu,
  Database,
  Download,
  ExternalLink,
  Eye,
  FileText,
  FlaskConical,
  Folder,
  FolderKanban,
  Gamepad2,
  GitBranch,
  Globe,
  GraduationCap,
  Heart,
  Key,
  Layers,
  Lock,
  MessageSquare,
  Music,
  Network,
  Newspaper,
  Package,
  Palette,
  Plug,
  Printer,
  Rocket,
  Rss,
  Search,
  Send,
  Settings,
  Share2,
  ShieldCheck,
  Sliders,
  Sparkles,
  Star,
  Tag,
  Terminal,
  Timer,
  TrendingUp,
  Users,
  Video,
  WandSparkles,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import type { AppLanguage } from '../i18n/languages';

export { PluginIcon, type PluginIconProps } from './PluginIcon';

export interface PluginIconChoice {
  key: string;
  labels: Record<AppLanguage, string>;
  keywords: string;
  icon: LucideIcon;
}

export const getPluginIconLabel = (
  choice: PluginIconChoice,
  language: string | undefined,
): string =>
  language && language in choice.labels
    ? choice.labels[language as AppLanguage]
    : choice.labels.en;

export const PLUGIN_ICON_CHOICES: readonly PluginIconChoice[] = [
  { key: 'plug', labels: { zh: '插头 (默认)', en: 'Plug', 'zh-TW': '插頭 (預設)', ja: 'プラグ（デフォルト）', ko: '플러그(기본)', es: 'Enchufe (predeterminado)', fr: 'Prise (par défaut)', de: 'Stecker (Standard)', ru: 'Разъём (по умолчанию)', 'pt-BR': 'Plugue (padrão)' }, keywords: 'plug connect 插头 默认 default', icon: Plug },
  { key: 'bot', labels: { zh: '机器人', en: 'Bot', 'zh-TW': '機器人', ja: 'ボット', ko: '봇', es: 'Bot', fr: 'Bot', de: 'Bot', ru: 'Бот', 'pt-BR': 'Bot' }, keywords: 'bot robot ai agent 智能体 机器人', icon: Bot },
  { key: 'brain-circuit', labels: { zh: '人工智能', en: 'AI', 'zh-TW': '人工智慧', ja: '人工知能', ko: '인공지능', es: 'Inteligencia artificial', fr: 'Intelligence artificielle', de: 'Künstliche Intelligenz', ru: 'Искусственный интеллект', 'pt-BR': 'Inteligência artificial' }, keywords: 'brain circuit ai ml 人工智能 神经', icon: BrainCircuit },
  { key: 'sparkles', labels: { zh: '魔法星光', en: 'Sparkles', 'zh-TW': '魔法星光', ja: 'スパークル', ko: '반짝임', es: 'Destellos', fr: 'Étincelles', de: 'Funkeln', ru: 'Искры', 'pt-BR': 'Brilhos' }, keywords: 'sparkles magic ai clean 闪亮 星光 魔法', icon: Sparkles },
  { key: 'wand', labels: { zh: '魔杖', en: 'Wand', 'zh-TW': '魔杖', ja: '魔法の杖', ko: '마법 지팡이', es: 'Varita mágica', fr: 'Baguette magique', de: 'Zauberstab', ru: 'Волшебная палочка', 'pt-BR': 'Varinha mágica' }, keywords: 'wand magic generate 魔法棒 生成', icon: WandSparkles },
  { key: 'zap', labels: { zh: '雷电 / 效率', en: 'Zap', 'zh-TW': '閃電 / 效率', ja: '稲妻 / 効率', ko: '번개 / 효율', es: 'Rayo / Eficiencia', fr: 'Éclair / Efficacité', de: 'Blitz / Effizienz', ru: 'Молния / Эффективность', 'pt-BR': 'Raio / Eficiência' }, keywords: 'zap lightning fast energy 闪电 效率 极速', icon: Zap },
  { key: 'rocket', labels: { zh: '火箭 / 发布', en: 'Rocket', 'zh-TW': '火箭 / 發布', ja: 'ロケット / リリース', ko: '로켓 / 릴리스', es: 'Cohete / Publicación', fr: 'Fusée / Publication', de: 'Rakete / Veröffentlichung', ru: 'Ракета / Публикация', 'pt-BR': 'Foguete / Publicação' }, keywords: 'rocket launch deploy release 火箭 发布 启动', icon: Rocket },
  { key: 'code', labels: { zh: '代码', en: 'Code', 'zh-TW': '程式碼', ja: 'コード', ko: '코드', es: 'Código', fr: 'Code', de: 'Code', ru: 'Код', 'pt-BR': 'Código' }, keywords: 'code program dev 开发 代码 编程', icon: Code2 },
  { key: 'terminal', labels: { zh: '终端 / 命令行', en: 'Terminal', 'zh-TW': '終端機 / 命令列', ja: 'ターミナル / コマンドライン', ko: '터미널 / 명령줄', es: 'Terminal / Línea de comandos', fr: 'Terminal / Ligne de commande', de: 'Terminal / Kommandozeile', ru: 'Терминал / Командная строка', 'pt-BR': 'Terminal / Linha de comando' }, keywords: 'terminal console cli shell 终端 命令行', icon: Terminal },
  { key: 'wrench', labels: { zh: '工具', en: 'Tools', 'zh-TW': '工具', ja: 'ツール', ko: '도구', es: 'Herramientas', fr: 'Outils', de: 'Werkzeuge', ru: 'Инструменты', 'pt-BR': 'Ferramentas' }, keywords: 'wrench tools fix utility 工具 维护', icon: Wrench },
  { key: 'settings', labels: { zh: '设置', en: 'Settings', 'zh-TW': '設定', ja: '設定', ko: '설정', es: 'Ajustes', fr: 'Paramètres', de: 'Einstellungen', ru: 'Настройки', 'pt-BR': 'Configurações' }, keywords: 'settings gear config 配置 设置 选项', icon: Settings },
  { key: 'sliders', labels: { zh: '参数控制', en: 'Sliders', 'zh-TW': '參數控制', ja: 'スライダー / 調整', ko: '슬라이더 / 조정', es: 'Controles / Ajuste', fr: 'Curseurs / Réglage', de: 'Regler / Steuerung', ru: 'Ползунки / Управление', 'pt-BR': 'Controles / Ajuste' }, keywords: 'sliders filter control 调优 参数 滑块', icon: Sliders },
  { key: 'cpu', labels: { zh: '芯片 / 硬件', en: 'Hardware', 'zh-TW': '晶片 / 硬體', ja: 'チップ / ハードウェア', ko: '칩 / 하드웨어', es: 'Chip / Hardware', fr: 'Puce / Matériel', de: 'Chip / Hardware', ru: 'Чип / Оборудование', 'pt-BR': 'Chip / Hardware' }, keywords: 'cpu chip processor 处理器 芯片 性能', icon: Cpu },
  { key: 'database', labels: { zh: '数据库', en: 'Database', 'zh-TW': '資料庫', ja: 'データベース', ko: '데이터베이스', es: 'Base de datos', fr: 'Base de données', de: 'Datenbank', ru: 'База данных', 'pt-BR': 'Banco de dados' }, keywords: 'database storage sql data 数据库 存储', icon: Database },
  { key: 'globe', labels: { zh: '网络 / 网页', en: 'Web', 'zh-TW': '網路 / 網頁', ja: 'ウェブ / ネットワーク', ko: '웹 / 네트워크', es: 'Web / Red', fr: 'Web / Réseau', de: 'Web / Netzwerk', ru: 'Веб / Сеть', 'pt-BR': 'Web / Rede' }, keywords: 'globe web internet 全球 网页 浏览器', icon: Globe },
  { key: 'network', labels: { zh: '网络连接', en: 'Network', 'zh-TW': '網路連線', ja: 'ネットワーク接続', ko: '네트워크 연결', es: 'Conexión de red', fr: 'Connexion réseau', de: 'Netzwerkverbindung', ru: 'Сетевое подключение', 'pt-BR': 'Conexão de rede' }, keywords: 'network connection api 网关 网络 节点', icon: Network },
  { key: 'cable', labels: { zh: '接口 / 协议', en: 'Interface', 'zh-TW': '介面 / 協定', ja: 'インターフェース / プロトコル', ko: '인터페이스 / 프로토콜', es: 'Interfaz / Protocolo', fr: 'Interface / Protocole', de: 'Schnittstelle / Protokoll', ru: 'Интерфейс / Протокол', 'pt-BR': 'Interface / Protocolo' }, keywords: 'cable wire interface mcp 接口 协议 线缆', icon: Cable },
  { key: 'blocks', labels: { zh: '积木 / 组件', en: 'Blocks', 'zh-TW': '積木 / 元件', ja: 'ブロック / コンポーネント', ko: '블록 / 컴포넌트', es: 'Bloques / Componentes', fr: 'Blocs / Composants', de: 'Bausteine / Komponenten', ru: 'Блоки / Компоненты', 'pt-BR': 'Blocos / Componentes' }, keywords: 'blocks lego component puzzle 积木 组件 拼装', icon: Blocks },
  { key: 'package', labels: { zh: '软件包', en: 'Package', 'zh-TW': '軟體套件', ja: 'パッケージ', ko: '패키지', es: 'Paquete', fr: 'Paquet', de: 'Paket', ru: 'Пакет', 'pt-BR': 'Pacote' }, keywords: 'package bundle npm artifact 软件包 依赖', icon: Package },
  { key: 'layers', labels: { zh: '图层 / 架构', en: 'Layers', 'zh-TW': '圖層 / 架構', ja: 'レイヤー / アーキテクチャ', ko: '레이어 / 아키텍처', es: 'Capas / Arquitectura', fr: 'Calques / Architecture', de: 'Ebenen / Architektur', ru: 'Слои / Архитектура', 'pt-BR': 'Camadas / Arquitetura' }, keywords: 'layers stack architecture 图层 堆栈 架构', icon: Layers },
  { key: 'folder', labels: { zh: '文件夹', en: 'Folder', 'zh-TW': '資料夾', ja: 'フォルダー', ko: '폴더', es: 'Carpeta', fr: 'Dossier', de: 'Ordner', ru: 'Папка', 'pt-BR': 'Pasta' }, keywords: 'folder directory 文件夹 目录 组织', icon: Folder },
  { key: 'folder-kanban', labels: { zh: '项目看板', en: 'Kanban', 'zh-TW': '專案看板', ja: 'プロジェクトボード', ko: '프로젝트 보드', es: 'Tablero de proyecto', fr: 'Tableau de projet', de: 'Projektboard', ru: 'Доска проекта', 'pt-BR': 'Quadro de projeto' }, keywords: 'folder kanban project board 看板 项目 管理', icon: FolderKanban },
  { key: 'file-text', labels: { zh: '文档', en: 'Document', 'zh-TW': '文件', ja: 'ドキュメント', ko: '문서', es: 'Documento', fr: 'Document', de: 'Dokument', ru: 'Документ', 'pt-BR': 'Documento' }, keywords: 'file text document report 文档 报告 文件', icon: FileText },
  { key: 'book-open', labels: { zh: '知识库', en: 'Knowledge', 'zh-TW': '知識庫', ja: 'ナレッジベース', ko: '지식 베이스', es: 'Base de conocimiento', fr: 'Base de connaissances', de: 'Wissensdatenbank', ru: 'База знаний', 'pt-BR': 'Base de conhecimento' }, keywords: 'book knowledge read wiki 书本 阅读 知识', icon: BookOpen },
  { key: 'newspaper', labels: { zh: '资讯 / 简报', en: 'News', 'zh-TW': '資訊 / 簡報', ja: 'ニュース / レポート', ko: '뉴스 / 브리핑', es: 'Noticias / Boletín', fr: 'Actualités / Bulletin', de: 'Nachrichten / Briefing', ru: 'Новости / Дайджест', 'pt-BR': 'Notícias / Boletim' }, keywords: 'newspaper news feed 资讯 新闻 简报', icon: Newspaper },
  { key: 'tag', labels: { zh: '标签', en: 'Tag', 'zh-TW': '標籤', ja: 'タグ', ko: '태그', es: 'Etiqueta', fr: 'Étiquette', de: 'Tag', ru: 'Тег', 'pt-BR': 'Etiqueta' }, keywords: 'tag label category 标签 标记 归类', icon: Tag },
  { key: 'bookmark', labels: { zh: '书签', en: 'Bookmark', 'zh-TW': '書籤', ja: 'ブックマーク', ko: '북마크', es: 'Marcador', fr: 'Signet', de: 'Lesezeichen', ru: 'Закладка', 'pt-BR': 'Marcador' }, keywords: 'bookmark favorite save 书签 收藏 保存', icon: Bookmark },
  { key: 'star', labels: { zh: '星标', en: 'Star', 'zh-TW': '星號', ja: 'スター', ko: '별표', es: 'Estrella', fr: 'Étoile', de: 'Stern', ru: 'Звезда', 'pt-BR': 'Estrela' }, keywords: 'star favorite rating 星标 喜爱 评级', icon: Star },
  { key: 'heart', labels: { zh: '喜爱', en: 'Heart', 'zh-TW': '喜愛', ja: 'お気に入り', ko: '즐겨찾기', es: 'Favorito', fr: 'Favori', de: 'Favorit', ru: 'Избранное', 'pt-BR': 'Favorito' }, keywords: 'heart love like 喜欢 收藏 爱心', icon: Heart },
  { key: 'shield', labels: { zh: '安全 / 防护', en: 'Security', 'zh-TW': '安全 / 防護', ja: 'セキュリティ / 保護', ko: '보안 / 보호', es: 'Seguridad / Protección', fr: 'Sécurité / Protection', de: 'Sicherheit / Schutz', ru: 'Безопасность / Защита', 'pt-BR': 'Segurança / Proteção' }, keywords: 'shield security protect audit 安全 防护 审核', icon: ShieldCheck },
  { key: 'lock', labels: { zh: '私密 / 锁定', en: 'Lock', 'zh-TW': '私密 / 鎖定', ja: 'プライベート / ロック', ko: '비공개 / 잠금', es: 'Privado / Bloqueo', fr: 'Privé / Verrouillage', de: 'Privat / Sperre', ru: 'Приватность / Блокировка', 'pt-BR': 'Privado / Bloqueio' }, keywords: 'lock private secure 锁定 权限 私密', icon: Lock },
  { key: 'key', labels: { zh: '密钥 / 认证', en: 'Key', 'zh-TW': '金鑰 / 驗證', ja: 'キー / 認証', ko: '키 / 인증', es: 'Clave / Autenticación', fr: 'Clé / Authentification', de: 'Schlüssel / Authentifizierung', ru: 'Ключ / Аутентификация', 'pt-BR': 'Chave / Autenticação' }, keywords: 'key auth secret token 钥匙 密钥 认证', icon: Key },
  { key: 'search', labels: { zh: '搜索 / 发现', en: 'Search', 'zh-TW': '搜尋 / 探索', ja: '検索 / 発見', ko: '검색 / 탐색', es: 'Buscar / Descubrir', fr: 'Rechercher / Découvrir', de: 'Suchen / Entdecken', ru: 'Поиск / Обзор', 'pt-BR': 'Pesquisar / Descobrir' }, keywords: 'search query find 搜索 查询 发现', icon: Search },
  { key: 'chart', labels: { zh: '统计图表', en: 'Chart', 'zh-TW': '統計圖表', ja: 'グラフ / 統計', ko: '차트 / 통계', es: 'Gráfico / Estadísticas', fr: 'Graphique / Statistiques', de: 'Diagramm / Statistik', ru: 'График / Статистика', 'pt-BR': 'Gráfico / Estatísticas' }, keywords: 'chart analytics graph metrics 统计 分析 图表', icon: BarChart3 },
  { key: 'trending-up', labels: { zh: '趋势', en: 'Trending', 'zh-TW': '趨勢', ja: 'トレンド', ko: '트렌드', es: 'Tendencias', fr: 'Tendances', de: 'Trends', ru: 'Тренды', 'pt-BR': 'Tendências' }, keywords: 'trending growth rise 趋势 增长 上升', icon: TrendingUp },
  { key: 'activity', labels: { zh: '活跃度 / 监控', en: 'Activity', 'zh-TW': '活躍度 / 監控', ja: 'アクティビティ / 監視', ko: '활동 / 모니터링', es: 'Actividad / Monitorización', fr: 'Activité / Surveillance', de: 'Aktivität / Überwachung', ru: 'Активность / Мониторинг', 'pt-BR': 'Atividade / Monitoramento' }, keywords: 'activity pulse monitor health 动态 活跃 健康 监控', icon: Activity },
  { key: 'users', labels: { zh: '社区 / 协作', en: 'Community', 'zh-TW': '社群 / 協作', ja: 'コミュニティ / コラボ', ko: '커뮤니티 / 협업', es: 'Comunidad / Colaboración', fr: 'Communauté / Collaboration', de: 'Community / Zusammenarbeit', ru: 'Сообщество / Сотрудничество', 'pt-BR': 'Comunidade / Colaboração' }, keywords: 'users team community social 团队 成员 社区 协作', icon: Users },
  { key: 'message', labels: { zh: '聊天 / 讨论', en: 'Chat', 'zh-TW': '聊天 / 討論', ja: 'チャット / ディスカッション', ko: '채팅 / 토론', es: 'Chat / Debate', fr: 'Chat / Discussion', de: 'Chat / Diskussion', ru: 'Чат / Обсуждение', 'pt-BR': 'Bate-papo / Discussão' }, keywords: 'message chat comment talk 对话 讨论 消息', icon: MessageSquare },
  { key: 'send', labels: { zh: '发送 / 推送', en: 'Send', 'zh-TW': '傳送 / 推送', ja: '送信 / プッシュ', ko: '보내기 / 푸시', es: 'Enviar / Notificar', fr: 'Envoyer / Notification', de: 'Senden / Push', ru: 'Отправить / Уведомление', 'pt-BR': 'Enviar / Notificação' }, keywords: 'send webhook push 传递 发送 推送', icon: Send },
  { key: 'rss', labels: { zh: '动态源', en: 'Feed', 'zh-TW': '動態來源', ja: 'フィード', ko: '피드', es: 'Fuente', fr: 'Flux', de: 'Feed', ru: 'Лента', 'pt-BR': 'Feed' }, keywords: 'rss feed subscribe 订阅 广播 动态', icon: Rss },
  { key: 'bell', labels: { zh: '通知 / 提醒', en: 'Notification', 'zh-TW': '通知 / 提醒', ja: '通知 / リマインダー', ko: '알림 / 리마인더', es: 'Notificación / Recordatorio', fr: 'Notification / Rappel', de: 'Benachrichtigung / Erinnerung', ru: 'Уведомление / Напоминание', 'pt-BR': 'Notificação / Lembrete' }, keywords: 'bell alert notice 提醒 通知 订阅', icon: Bell },
  { key: 'clapperboard', labels: { zh: '媒体 / 影音', en: 'Media', 'zh-TW': '媒體 / 影音', ja: 'メディア / 動画・音声', ko: '미디어 / 영상·음악', es: 'Medios / Vídeo y audio', fr: 'Médias / Vidéo et audio', de: 'Medien / Video und Audio', ru: 'Медиа / Видео и аудио', 'pt-BR': 'Mídia / Vídeo e áudio' }, keywords: 'clapperboard movie video media 电影 媒体 影音', icon: Clapperboard },
  { key: 'music', labels: { zh: '音频 / 音乐', en: 'Music', 'zh-TW': '音訊 / 音樂', ja: '音楽 / オーディオ', ko: '음악 / 오디오', es: 'Música / Audio', fr: 'Musique / Audio', de: 'Musik / Audio', ru: 'Музыка / Аудио', 'pt-BR': 'Música / Áudio' }, keywords: 'music audio sound 音乐 音频 声音', icon: Music },
  { key: 'video', labels: { zh: '视频', en: 'Video', 'zh-TW': '影片', ja: '動画', ko: '비디오', es: 'Vídeo', fr: 'Vidéo', de: 'Video', ru: 'Видео', 'pt-BR': 'Vídeo' }, keywords: 'video record stream 视频 录屏 直播', icon: Video },
  { key: 'camera', labels: { zh: '快照 / 截图', en: 'Snapshot', 'zh-TW': '快照 / 截圖', ja: 'スナップショット / スクリーンショット', ko: '스냅샷 / 스크린샷', es: 'Instantánea / Captura', fr: 'Instantané / Capture', de: 'Momentaufnahme / Screenshot', ru: 'Снимок / Скриншот', 'pt-BR': 'Instantâneo / Captura de tela' }, keywords: 'camera photo screenshot 相机 拍照 截图', icon: Camera },
  { key: 'palette', labels: { zh: '设计 / 主题', en: 'Design', 'zh-TW': '設計 / 主題', ja: 'デザイン / テーマ', ko: '디자인 / 테마', es: 'Diseño / Tema', fr: 'Design / Thème', de: 'Design / Thema', ru: 'Дизайн / Тема', 'pt-BR': 'Design / Tema' }, keywords: 'palette art theme color 画板 设计 主题', icon: Palette },
  { key: 'gamepad', labels: { zh: '游戏 / 互动', en: 'Gaming', 'zh-TW': '遊戲 / 互動', ja: 'ゲーム / インタラクティブ', ko: '게임 / 인터랙티브', es: 'Juego / Interactivo', fr: 'Jeu / Interactif', de: 'Spiel / Interaktiv', ru: 'Игра / Интерактив', 'pt-BR': 'Jogo / Interativo' }, keywords: 'gamepad game play 游戏 娱乐 互动', icon: Gamepad2 },
  { key: 'graduation', labels: { zh: '教育 / 学习', en: 'Education', 'zh-TW': '教育 / 學習', ja: '教育 / 学習', ko: '교육 / 학습', es: 'Educación / Aprendizaje', fr: 'Éducation / Apprentissage', de: 'Bildung / Lernen', ru: 'Образование / Обучение', 'pt-BR': 'Educação / Aprendizagem' }, keywords: 'graduation study learn course 学习 教育 课程', icon: GraduationCap },
  { key: 'flask', labels: { zh: '实验 / 测试', en: 'Experiment', 'zh-TW': '實驗 / 測試', ja: '実験 / テスト', ko: '실험 / 테스트', es: 'Experimento / Prueba', fr: 'Expérience / Test', de: 'Experiment / Test', ru: 'Эксперимент / Тест', 'pt-BR': 'Experimento / Teste' }, keywords: 'flask lab test experiment 实验 试用 测试', icon: FlaskConical },
  { key: 'compass', labels: { zh: '导航 / 探索', en: 'Explore', 'zh-TW': '導覽 / 探索', ja: 'ナビゲーション / 探索', ko: '탐색 / 길잡이', es: 'Navegación / Explorar', fr: 'Navigation / Explorer', de: 'Navigation / Erkunden', ru: 'Навигация / Исследование', 'pt-BR': 'Navegação / Explorar' }, keywords: 'compass navigate explore 导航 探索 指南', icon: Compass },
  { key: 'timer', labels: { zh: '计时 / 定时', en: 'Timer', 'zh-TW': '計時 / 定時', ja: 'タイマー / スケジュール', ko: '타이머 / 예약', es: 'Temporizador / Programación', fr: 'Minuteur / Planification', de: 'Timer / Zeitplan', ru: 'Таймер / Расписание', 'pt-BR': 'Cronômetro / Agendamento' }, keywords: 'timer clock time schedule 计时 定时 任务', icon: Timer },
  { key: 'cloud', labels: { zh: '云端同步', en: 'Cloud', 'zh-TW': '雲端同步', ja: 'クラウド同期', ko: '클라우드 동기화', es: 'Sincronización en la nube', fr: 'Synchronisation cloud', de: 'Cloud-Synchronisierung', ru: 'Облачная синхронизация', 'pt-BR': 'Sincronização na nuvem' }, keywords: 'cloud sync backup 云端 备份 同步', icon: Cloud },
  { key: 'git-branch', labels: { zh: '分支 / 工作流', en: 'Git Branch', 'zh-TW': '分支 / 工作流程', ja: 'ブランチ / ワークフロー', ko: '브랜치 / 워크플로', es: 'Rama / Flujo de trabajo', fr: 'Branche / Flux de travail', de: 'Branch / Workflow', ru: 'Ветка / Рабочий процесс', 'pt-BR': 'Branch / Fluxo de trabalho' }, keywords: 'git branch workflow 分支 流程 源码', icon: GitBranch },
  { key: 'external-link', labels: { zh: '外链跳转', en: 'External Link', 'zh-TW': '外部連結跳轉', ja: '外部リンク', ko: '외부 링크', es: 'Enlace externo', fr: 'Lien externe', de: 'Externer Link', ru: 'Внешняя ссылка', 'pt-BR': 'Link externo' }, keywords: 'external link open visit 跳转 外链 打开', icon: ExternalLink },
  { key: 'download', labels: { zh: '下载 / 导出', en: 'Download', 'zh-TW': '下載 / 匯出', ja: 'ダウンロード / エクスポート', ko: '다운로드 / 내보내기', es: 'Descargar / Exportar', fr: 'Télécharger / Exporter', de: 'Herunterladen / Exportieren', ru: 'Скачать / Экспорт', 'pt-BR': 'Baixar / Exportar' }, keywords: 'download export save 下载 导出 保存', icon: Download },
  { key: 'share', labels: { zh: '分享 / 广播', en: 'Share', 'zh-TW': '分享 / 廣播', ja: '共有 / 配信', ko: '공유 / 배포', es: 'Compartir / Difundir', fr: 'Partager / Diffuser', de: 'Teilen / Verteilen', ru: 'Поделиться / Распространение', 'pt-BR': 'Compartilhar / Divulgar' }, keywords: 'share export distribute 分享 转发 扩散', icon: Share2 },
  { key: 'printer', labels: { zh: '打印 / 生成', en: 'Print', 'zh-TW': '列印 / 產生', ja: '印刷 / 生成', ko: '인쇄 / 생성', es: 'Imprimir / Generar', fr: 'Imprimer / Générer', de: 'Drucken / Erzeugen', ru: 'Печать / Создание', 'pt-BR': 'Imprimir / Gerar' }, keywords: 'printer print pdf export 打印 导出 输出', icon: Printer },
  { key: 'eye', labels: { zh: '预览 / 查阅', en: 'Preview', 'zh-TW': '預覽 / 檢視', ja: 'プレビュー / 表示', ko: '미리보기 / 보기', es: 'Vista previa / Consulta', fr: 'Aperçu / Consultation', de: 'Vorschau / Ansicht', ru: 'Предпросмотр / Просмотр', 'pt-BR': 'Pré-visualização / Consulta' }, keywords: 'eye view preview 预览 查阅 查看', icon: Eye },
  { key: 'check-circle', labels: { zh: '校验 / 完成', en: 'Check', 'zh-TW': '校驗 / 完成', ja: 'チェック / 完了', ko: '확인 / 완료', es: 'Verificación / Completado', fr: 'Vérification / Terminé', de: 'Prüfung / Abgeschlossen', ru: 'Проверка / Готово', 'pt-BR': 'Verificação / Concluído' }, keywords: 'check circle verified success 校验 成功 完成', icon: CheckCircle },
];

export const PLUGIN_ICON_MAP: Record<string, LucideIcon> = Object.fromEntries(
  PLUGIN_ICON_CHOICES.map((choice) => [choice.key, choice.icon]),
);

export const normalizePluginIconKey = (value: string | undefined | null): string => {
  if (!value) return '';
  return value.trim().toLowerCase().replace(/^lucide:/, '');
};

export const getPluginIcon = (iconKey?: string | null): LucideIcon => {
  const normalized = normalizePluginIconKey(iconKey);
  if (normalized && Object.prototype.hasOwnProperty.call(PLUGIN_ICON_MAP, normalized)) {
    return PLUGIN_ICON_MAP[normalized];
  }
  return Plug;
};
