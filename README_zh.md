<div align="center">

![Logo](upload/logo.png)

# GithubStarsManager

![100% 本地数据](https://img.shields.io/badge/数据存储-100%25本地-success?style=flat&logo=database&logoColor=white) ![AI 支持](https://img.shields.io/badge/AI-支持多模型-blue?style=flat&logo=openai&logoColor=white) ![全平台](https://img.shields.io/badge/平台-Windows%20%7C%20macOS%20%7C%20Linux-purple?style=flat&logo=electron&logoColor=white)

一个基于AI的GitHub星标仓库管理工具，帮助您更好地组织和管理您的GitHub星标项目。

<a href="https://www.producthunt.com/products/githubstarsmanager?embed=true&utm_source=badge-featured&utm_medium=badge&utm_source=badge-githubstarsmanager" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1001489&theme=light&t=1754373322417" alt="GithubStarsManager - AI&#0032;organizes&#0032;GitHub&#0032;stars&#0032;for&#0032;easy&#0032;find | Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" /></a>

</div>

中文 | **[English](README.md)**

## 功能特性

### 🤖 AI智能分析
- 自动分析仓库内容并生成中文摘要
- 智能提取项目标签和支持平台
- 基于AI的自然语言搜索功能

### 📂 智能分类管理
- 预设14个常用应用分类
- 支持自定义分类创建和管理
- 基于AI标签的自动分类匹配

### ⭐ 星标仓库管理

自动拉取您GitHub账户下的星标仓库，通过AI自动分析并生成仓库描述、标签和分类。支持过滤、关键词搜索，快速定位任意仓库。

![SCR-20250629-qkjk](upload/repo.jpg)

### 🔔 Release订阅追踪
- 订阅感兴趣仓库的Release更新
- 智能解析下载链接和支持平台
- Release时间线视图和已读状态管理

订阅星标仓库的发布通知，文件发布后即可快速查看和下载。

![SCR-20250629-qkea](upload/release.jpg)

### 🔍 强大的搜索功能
- AI驱动的自然语言搜索
- 多维度过滤（语言、平台、标签、状态）
- 高级搜索和排序选项

### 💾 数据备份同步
- WebDAV云存储备份支持
- 跨设备数据同步
- 本地数据持久化存储

### 🎨 现代化界面
- 响应式设计，支持移动端
- 深色/浅色主题切换
- 中英文双语支持

### 🖥️ 可选后端服务
- 可选的 Express + SQLite 后端，支持跨设备数据同步
- AI 和 WebDAV 请求通过服务器代理，避免浏览器 CORS 限制
- API 密钥加密存储在服务器，增强安全性

### 🤖 自定义AI模型

使用您自己的AI模型API，支持OpenAI兼容接口。

![SCR-20250629-qldc](upload/SCR-20250629-qldc.png)

## 技术栈

- **前端**: React 18 + TypeScript + Tailwind CSS
- **状态管理**: Zustand
- **图标**: Lucide React + Font Awesome
- **构建工具**: Vite
- **部署**: Netlify

## 💻 桌面客户端（推荐）

直接下载桌面客户端，无需配置环境：

https://github.com/AmintaCCCP/GithubStarsManager/releases

## 快速开始

### 1. 克隆项目
```bash
git clone https://github.com/AmintaCCCP/GithubStarsManager.git
cd GithubStarsManager
```

### 2. 安装依赖
```bash
npm install
```

### 3. 启动开发服务器
```bash
npm run dev
```

> 💡 本地使用 `npm run dev` 运行项目时，AI 服务和 WebDAV 的调用可能因浏览器 CORS 限制而失败。建议使用预编译客户端，或启动后端服务器（`cd server && npm run dev`）代理 API 请求以完全避免 CORS 问题。

### 4. 构建生产版本
```bash
npm run build
```

## 🤖 AI服务配置

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

## 💾 WebDAV备份配置

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

## 🚀 部署

### Netlify部署
1. Fork本项目到您的GitHub账户
2. 在Netlify中连接您的GitHub仓库
3. 配置构建设置：
   - Build command: `npm run build`
   - Publish directory: `dist`
4. 部署

### 其他平台
项目构建后生成静态文件，可以部署到任何静态网站托管服务：
- Vercel
- GitHub Pages
- Cloudflare Pages
- 自建服务器

### Docker 部署
您也可以使用 Docker 来运行此应用程序。请参阅 [DOCKER.md](DOCKER.md) 获取详细的构建和部署说明。Docker 设置正确处理了 CORS，并允许您直接在应用程序中配置任何 AI 或 WebDAV 服务 URL。

### 🖥️ 后端服务器（可选）

应用在没有后端的情况下也能完整运行（纯前端，使用 localStorage）。可选的 Express + SQLite 后端提供以下额外功能：

- **跨设备同步**: 在不同浏览器和设备间共享数据
- **无 CORS 代理**: AI 和 WebDAV 请求通过服务器转发，避免浏览器 CORS 限制
- **令牌安全**: API 密钥加密存储在服务器，不会暴露在浏览器网络请求中

#### 快速启动（推荐使用 Docker）
```bash
docker-compose up --build
```
前端运行在 8080 端口，后端运行在 3000 端口。数据持久化存储在 Docker 卷中。

#### 手动启动
```bash
cd server
npm install
npm run dev
```

#### 环境变量
| 变量 | 必填 | 说明 |
|----------|----------|-------------|
| `API_SECRET` | 否 | API 认证令牌。未设置时禁用认证。 |
| `ENCRYPTION_KEY` | 否 | 用于加密存储密钥的 AES-256 密钥。未设置时自动生成。 |
| `PORT` | 否 | 服务器端口（默认：3000） |

#### 前端连接后端
1. 打开应用中的设置面板
2. 找到「后端服务器」部分
3. 输入 API Secret（如已配置）
4. 点击「测试连接」，绿色指示灯表示连接成功
5. 使用「同步到后端」/「从后端同步」来传输数据

## 目标用户

- 拥有数百甚至数千星标的开发者
- 系统性追踪软件发布的用户
- 不想手动打标签的「懒效率」用户

## 补充说明

1. 后端为可选项，但对于网页部署推荐启用。不启用时，所有数据存储在浏览器 localStorage 中，请定期备份重要数据。
2. 我不会写代码，这个应用完全由AI编写，主要满足我个人需求。如果您有新功能需求或遇到Bug，我只能尽力尝试，但无法保证成功，因为这取决于AI能否完成。😹

## 贡献

欢迎提交Issue和Pull Request！

1. Fork项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启Pull Request

## 许可证

本项目采用MIT许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 支持

如果您觉得这个项目有用，请给它一个⭐️！

如有问题或建议，请提交Issue或联系作者。

## 星标历史

[![Star History Chart](https://api.star-history.com/svg?repos=AmintaCCCP/GithubStarsManager&type=Date)](https://www.star-history.com/#AmintaCCCP/GithubStarsManager&Date)

---

**在线演示**: [https://soft-stroopwafel-2b73d1.netlify.app](https://soft-stroopwafel-2b73d1.netlify.app)

**GitHub 仓库**: [https://github.com/AmintaCCCP/GithubStarsManager](https://github.com/AmintaCCCP/GithubStarsManager)
