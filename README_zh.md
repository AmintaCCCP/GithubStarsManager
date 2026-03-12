<div align="center">

![Logo](upload/logo.png)

# GithubStarsManager

![100% 本地数据](https://img.shields.io/badge/数据存储-100%25本地-success?style=flat&logo=database&logoColor=white) ![AI 支持](https://img.shields.io/badge/AI-支持多模型-blue?style=flat&logo=openai&logoColor=white) ![全平台](https://img.shields.io/badge/平台-Windows%20%7C%20macOS%20%7C%20Linux-purple?style=flat&logo=electron&logoColor=white)

基于 AI 的智能 GitHub 星标仓库管理工具。优化了大规模星标收藏、软件发现和版本追踪体验。

<a href="https://www.producthunt.com/products/githubstarsmanager?embed=true&utm_source=badge-featured&utm_medium=badge&utm_source=badge-githubstarsmanager" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1001489&theme=light&t=1754373322417" alt="GithubStarsManager - AI&#0032;organizes&#0032;GitHub&#0032;stars&#0032;for&#0032;easy&#0032;find | Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" /></a>

</div>

中文 | **[English](README.md)**

## ✨ 功能特性

- **🚀 单体架构 (Monolith)**: 单容器部署，后端在 3000 端口（映射至 8080）同时提供前端界面和 API。
- **📱 PWA 支持**: 支持作为桌面或手机 App 安装，获得原生应用体验。
- **🤖 AI 智能分析**: 自动生成仓库摘要，智能提取项目标签。
- **📂 智能分类**: 支持基于 AI 的自动分类和自定义文件夹管理。
- **🔔 Release 追踪**: 订阅仓库更新，并通过 **Apprise** 接收推送通知。
- **🔍 语义搜索**: 支持通过自然语言意图搜索仓库（按 `回车` 触发）。
- **👥 多用户支持**: 支持 JWT 认证下的多用户数据隔离及超级管理员权限。
- **💾 本地持久化**: 所有数据存储在服务端的 `/app/data/data.db` (SQLite)。

## 🚀 快速开始 (部署)

### 🐳 使用 Docker 运行 (推荐)

您可以直接从 Docker Hub 拉取预构建的镜、，快速启动应用。

#### 方式 1: Docker CLI (最快)

```bash
docker run -d -p 8080:3000 \
  -v gsm-data:/app/data \
  --name gsm \
  banjuer/github-stars-manager:latest
```

#### 方式 2: Docker Compose

创建 `docker-compose.yml`:

```yaml
version: '3.8'
services:
  app:
    image: banjuer/github-stars-manager:latest
    ports:
      - "8080:3000"
    volumes:
      - app-data:/app/data
    restart: unless-stopped

volumes:
  app-data:
```

运行:
```bash
docker-compose up -d
```

- **访问地址**: `http://localhost:8080`
- **初始化**: 第一个注册的用户将自动成为 **超级管理员 (SuperAdmin)**。
- **持久化**: 数据保存在 `app-data` 卷中。

---

### 💻 桌面客户端

可以直接下载适用于 Windows、macOS 和 Linux 的预构建客户端：
[最新版本下载](https://github.com/AmintaCCCP/GithubStarsManager/releases)

### 📲 渐进式 Web 应用 (PWA)

在服务器部署后（如通过 Docker），使用 Chrome 或 Edge 浏览器访问。点击地址栏的 **安装图标**，即可将应用添加到桌面或手机主屏幕。

---

## 🛠 技术栈

- **前端**: React 18 + TypeScript + Vite + Tailwind CSS
- **PWA**: `vite-plugin-pwa`
- **后端**: Node.js + Express + SQLite
- **通知系统**: Apprise 集成
- **自动化**: node-cron 后台任务监控 Release 更新

## 📊 核心特性展示

### 星标仓库管理
AI 自动分析仓库质量，生成摘要，匹配您的兴趣。
![仓库管理](upload/repo.jpg)

### Release 监控
不错过任何工具更新。订阅后通过 Apprise 接收实时推送。
![Release 追踪](upload/release.jpg)

### AI 服务配置
支持 OpenAI, Claude, Ollama 以及任何兼容 OpenAI 规范的 API 提供商。
![AI 配置](upload/SCR-20250629-qldc.png)

## 🤖 开发与调试

1. **克隆**: `git clone ...`
2. **安装**: `npm install && cd server && npm install`
3. **运行**: 在根目录运行 `npm run dev:all` (前端访问 5174, 已配置代理至后端 3000)。

---

## 目标用户

- 拥有 1000+ 星标，难以查找旧项目的开发者。
- 需要系统化追踪软件发布版本的用户。
- 希望利用 AI 辅助管理和发现工具的效率爱好者。
 Ollama等本地AI服务
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
您也可以使用 Docker 来运行此应用程序。请参阅 [DOCKER.md](DOCKER.md) 获取详细的构建和部署说明。Docker 设置正确处理了 API 代理，并允许您直接在应用程序中配置任何 AI 或 WebDAV 服务。

#### 快速启动（推荐使用 Docker）
```bash
docker run -d -p 8080:3000 banjuer/github-stars-manager:latest
```
访问 `http://localhost:8080` 即可。第一个用户注册即为管理员。

#### 环境变量
| 变量 | 必填 | 说明 |
|----------|----------|-------------|
| `API_SECRET` | 否 | JWT 签名密钥（如不设置将使用默认值）。 |
| `ENCRYPTION_KEY` | 否 | 用于加密存储密钥的 AES-256 密钥。未设置时自动生成。 |
| `PORT` | 否 | 服务器端口（默认：3000） |

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
