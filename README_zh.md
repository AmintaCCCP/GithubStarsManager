# GitHub Stars Manager

一个基于AI的GitHub星标仓库管理工具，帮助您更好地组织和管理您的GitHub星标项目。

An AI-powered GitHub starred repositories management tool to help you better organize and manage your GitHub starred projects.

## 功能特性 / Features

### 🔐 多种登录方式 / Multiple Login Methods
- **GitHub OAuth**: 安全便捷的一键授权登录
- **Personal Access Token**: 适合高级用户的token登录方式

### 🤖 AI智能分析 / AI-Powered Analysis
- 自动分析仓库内容并生成中文摘要
- 智能提取项目标签和支持平台
- 基于AI的自然语言搜索功能

### 📂 智能分类管理 / Smart Category Management
- 预设14个常用应用分类
- 支持自定义分类创建和管理
- 基于AI标签的自动分类匹配

### 🔔 Release订阅追踪 / Release Subscription & Tracking
- 订阅感兴趣仓库的Release更新
- 智能解析下载链接和支持平台
- Release时间线视图和已读状态管理

### 🔍 强大的搜索功能 / Powerful Search Features
- AI驱动的自然语言搜索
- 多维度过滤（语言、平台、标签、状态）
- 高级搜索和排序选项

### 💾 数据备份同步 / Data Backup & Sync
- WebDAV云存储备份支持
- 跨设备数据同步
- 本地数据持久化存储

### 🎨 现代化界面 / Modern UI
- 响应式设计，支持移动端
- 深色/浅色主题切换
- 中英文双语支持

## 技术栈 / Tech Stack

- **Frontend**: React 18 + TypeScript + Tailwind CSS
- **State Management**: Zustand
- **Icons**: Lucide React + Font Awesome
- **Build Tool**: Vite
- **Deployment**: Netlify

## 快速开始 / Quick Start

### 1. 克隆项目 / Clone Repository
```bash
git clone https://github.com/AmintaCCCP/GithubStarsManager.git
cd GithubStarsManager
```

### 2. 安装依赖 / Install Dependencies
```bash
npm install
```

### 3. 配置环境变量 / Configure Environment Variables

创建 `.env` 文件并配置以下变量：

```env
# GitHub OAuth App配置 (可选)
REACT_APP_GITHUB_CLIENT_ID=your_github_client_id
REACT_APP_GITHUB_CLIENT_SECRET=your_github_client_secret
```

### 4. 启动开发服务器 / Start Development Server
```bash
npm run dev
```

### 5. 构建生产版本 / Build for Production
```bash
npm run build
```

## GitHub OAuth配置 / GitHub OAuth Setup

如果要使用OAuth登录功能，需要在GitHub上创建OAuth App：

1. 访问 [GitHub Developer Settings](https://github.com/settings/developers)
2. 点击 "New OAuth App"
3. 填写应用信息：
   - **Application name**: GitHub Stars Manager
   - **Homepage URL**: `https://your-domain.com`
   - **Authorization callback URL**: `https://your-domain.com/auth/callback`
4. 获取 Client ID 和 Client Secret
5. 将它们配置到环境变量中

**注意**: 出于安全考虑，在生产环境中应该通过后端服务器处理OAuth token交换，而不是在前端直接使用Client Secret。

## AI服务配置 / AI Service Configuration

应用支持多种AI服务提供商：

- **OpenAI**: GPT-3.5/GPT-4
- **Anthropic**: Claude
- **本地部署**: Ollama等本地AI服务
- **其他**: 任何兼容OpenAI API的服务

在设置页面中配置您的AI服务：
1. 添加AI配置
2. 输入API端点和密钥
3. 选择模型
4. 测试连接

## WebDAV备份配置 / WebDAV Backup Configuration

支持多种WebDAV服务：
- **坚果云**: 国内用户推荐
- **Nextcloud**: 自建云存储
- **ownCloud**: 企业级解决方案
- **其他**: 任何标准WebDAV服务

配置步骤：
1. 在设置页面添加WebDAV配置
2. 输入服务器URL、用户名、密码和路径
3. 测试连接
4. 启用自动备份

## 部署 / Deployment

### Netlify部署
1. Fork本项目到您的GitHub账户
2. 在Netlify中连接您的GitHub仓库
3. 配置构建设置：
   - Build command: `npm run build`
   - Publish directory: `dist`
4. 配置环境变量（如果使用OAuth）
5. 部署

### 其他平台
项目构建后生成静态文件，可以部署到任何静态网站托管服务：
- Vercel
- GitHub Pages
- Cloudflare Pages
- 自建服务器

## 贡献 / Contributing

欢迎提交Issue和Pull Request！

1. Fork项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启Pull Request

## 许可证 / License

本项目采用MIT许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 支持 / Support

如果您觉得这个项目有用，请给它一个⭐️！

如有问题或建议，请提交Issue或联系作者。

---

**Live Demo**: [https://soft-stroopwafel-2b73d1.netlify.app](https://soft-stroopwafel-2b73d1.netlify.app)

**GitHub Repository**: [https://github.com/AmintaCCCP/GithubStarsManager](https://github.com/AmintaCCCP/GithubStarsManager)