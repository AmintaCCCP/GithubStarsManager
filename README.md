<div align="center">

![Logo](upload/logo.png)

# GithubStarsManager

![100% 本地数据](https://img.shields.io/badge/数据存储-100%25本地-success?style=flat&logo=database&logoColor=white) ![AI 支持](https://img.shields.io/badge/AI-支持多模型-blue?style=flat&logo=openai&logoColor=white) ![全平台](https://img.shields.io/badge/平台-Windows%20%7C%20macOS%20%7C%20Linux-purple?style=flat&logo=electron&logoColor=white) [![zread](https://img.shields.io/badge/Ask_Zread-_.svg?style=flat&color=00b0aa&labelColor=000000&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTQuOTYxNTYgMS42MDAxSDIuMjQxNTZDMS44ODgxIDEuNjAwMSAxLjYwMTU2IDEuODg2NjQgMS42MDE1NiAyLjI0MDFWNC45NjAxQzEuNjAxNTYgNS4zMTM1NiAxLjg4ODEgNS42MDAxIDIuMjQxNTYgNS42MDAxSDQuOTYxNTZDNS4zMTUwMiA1LjYwMDEgNS42MDE1NiA1LjMxMzU2IDUuNjAxNTYgNC45NjAxVjIuMjQwMUM1LjYwMTU2IDEuODg2NjQgNS4zMTUwMiAxLjYwMDEgNC45NjE1NiAxLjYwMDFaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00Ljk2MTU2IDEwLjM5OTlIMi4yNDE1NkMxLjg4ODEgMTAuMzk5OSAxLjYwMTU2IDEwLjY4NjQgMS42MDE1NiAxMS4wMzk5VjEzLjc1OTlDMS42MDE1NiAxNC4xMTM0IDEuODg4MSAxNC4zOTk5IDIuMjQxNTYgMTQuMzk5OUg0Ljk2MTU2QzUuMzE1MDIgMTQuMzk5OSA1LjYwMTU2IDE0LjExMzQgNS42MDE1NiAxMy43NTk5VjExLjAzOTlDNS42MDE1NiAxMC42ODY0IDUuMzE1MDIgMTAuMzk5OSA0Ljk2MTU2IDEwLjM5OTlaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik0xMy43NTg0IDEuNjAwMUgxMS4wMzg0QzEwLjY4NSAxLjYwMDEgMTAuMzk4NCAxLjg4NjY0IDEwLjM5ODQgMi4yNDAxVjQuOTYwMUMxMC4zOTg0IDUuMzEzNTYgMTAuNjg1IDUuNjAwMSAxMS4wMzg0IDUuNjAwMUgxMy43NTg0QzE0LjExMTkgNS42MDAxIDE0LjM5ODQgNS4zMTM1NiAxNC4zOTg0IDQuOTYwMVYyLjI0MDFDMTQuMzk4NCAxLjg4NjY0IDE0LjExMTkgMS42MDAxIDEzLjc1ODQgMS42MDAxWiIgZmlsbD0iI2ZmZiIvPgo8cGF0aCBkPSJNNCAxMkwxMiA0TDQgMTJaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00IDEyTDEyIDQiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4K&logoColor=ffffff)](https://zread.ai/AmintaCCCP/GithubStarsManager) <a href="https://linux.do" alt="LINUX DO"><img src="https://img.shields.io/badge/LINUX-DO-FFB003.svg?logo=data:image/svg%2bxml;base64,DQo8c3ZnIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiPjxwYXRoIGQ9Ik00Ni44Mi0uMDU1aDYuMjVxMjMuOTY5IDIuMDYyIDM4IDIxLjQyNmM1LjI1OCA3LjY3NiA4LjIxNSAxNi4xNTYgOC44NzUgMjUuNDV2Ni4yNXEtMi4wNjQgMjMuOTY4LTIxLjQzIDM4LTExLjUxMiA3Ljg4NS0yNS40NDUgOC44NzRoLTYuMjVxLTIzLjk3LTIuMDY0LTM4LjAwNC0yMS40M1EuOTcxIDY3LjA1Ni0uMDU0IDUzLjE4di02LjQ3M0MxLjM2MiAzMC43ODEgOC41MDMgMTguMTQ4IDIxLjM3IDguODE3IDI5LjA0NyAzLjU2MiAzNy41MjcuNjA0IDQ2LjgyMS0uMDU2IiBzdHlsZT0ic3Ryb2tlOm5vbmU7ZmlsbC1ydWxlOmV2ZW5vZGQ7ZmlsbDojZWNlY2VjO2ZpbGwtb3BhY2l0eToxIi8+PHBhdGggZD0iTTQ3LjI2NiAyLjk1N3EyMi41My0uNjUgMzcuNzc3IDE1LjczOGE0OS43IDQ5LjcgMCAwIDEgNi44NjcgMTAuMTU3cS00MS45NjQuMjIyLTgzLjkzIDAgOS43NS0xOC42MTYgMzAuMDI0LTI0LjM4N2E2MSA2MSAwIDAgMSA5LjI2Mi0xLjUwOCIgc3R5bGU9InN0cm9rZTpub25lO2ZpbGwtcnVsZTpldmVub2RkO2ZpbGw6IzE5MTkxOTtmaWxsLW9wYWNpdHk6MSIvPjxwYXRoIGQ9Ik03Ljk4IDcwLjkyNmMyNy45NzctLjAzNSA1NS45NTQgMCA4My45My4xMTNRODMuNDI2IDg3LjQ3MyA2Ni4xMyA5NC4wODZxLTE4LjgxIDYuNTQ0LTM2LjgzMi0xLjg5OC0xNC4yMDMtNy4wOS0yMS4zMTctMjEuMjYyIiBzdHlsZT0ic3Ryb2tlOm5vbmU7ZmlsbC1ydWxlOmV2ZW5vZGQ7ZmlsbDojZjlhZjAwO2ZpbGwtb3BhY2l0eToxIi8+PC9zdmc+" /></a>



An app for managing github starred repositories.

<a href="https://www.producthunt.com/products/githubstarsmanager?embed=true&utm_source=badge-featured&utm_medium=badge&utm_source=badge-githubstarsmanager" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1001489&theme=light&t=1754373322417" alt="GithubStarsManager - AI&#0032;organizes&#0032;GitHub&#0032;stars&#0032;for&#0032;easy&#0032;find | Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" /></a> <a href="https://trendshift.io/repositories/28489?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-28489" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/28489/daily?language=TypeScript" alt="AmintaCCCP%2FGithubStarsManager | Trendshift" width="250" height="55"/></a>

</div>

**[中文文档](README_zh.md)** | English  


## ✨ Features

> Tired of starring everything and finding nothing?

GitHub Stars Manager automatically syncs your starred repos, uses AI to summarize and categorize them, and lets you find anything with semantic search. Track releases, filter assets, and one‑click download—smarter than manual tags, simpler than GitHub.

### Core Features

| Feature | Description |
|---------|-------------|
| **Auto-sync Stars** | Connect your GitHub token to automatically pull all starred repositories |
| **AI Summaries & Categories** | Generate tags, topics, and short README overviews using AI |
| **Semantic Search** | Find repos by intent, not exact names |
| **Vector Semantic Search** | Embed repo descriptions/READMEs into a Cloudflare Vectorize index; query with natural language for high-precision semantic matching |
| **MCP Server** | Optional Streamable HTTP / SSE endpoint so agents (Claude Code, Cursor, etc.) can search AI-enriched stars; toggle in Settings, no extra install |
| **Release Tracking** | Subscribe to repos and see new versions in one unified timeline |
| **One‑click Downloads** | Expand release assets and download instantly |
| **Smart Asset Filters** | Match assets by keywords (dmg / mac / arm64 / aarch64) |
| **Fork Management** | View, sync upstream, and trigger GitHub Actions workflows on forked repos |
| **Gist Management** | Browse, create, edit, and delete Gists; AI-powered summaries and semantic search |
| **Network Proxy** | HTTP / SOCKS5 proxy with protocol-level connection testing |
| **Remote Download (aria2)** | Send release assets to aria2 for download via JSON-RPC |
| **Diagnostic Logs** | Unified frontend/backend log viewer with debug capture mode |
| **Bilingual Wiki Jump** | Deepwiki (EN) or zread (ZH) based on repository language |
| **Packaged Client** | No environment setup required—download and run |

### Optional Backend Server

Deploy an Express + SQLite backend for:

- **Cross-device Sync** — Share data between browsers and devices
- **CORS-free API Proxying** — AI and WebDAV calls route through the server
- **Encrypted Token Storage** — API keys stored securely, never exposed to browser
- **Network Proxy Forwarding** — Route all outbound requests (GitHub, AI, WebDAV) through HTTP/SOCKS5 proxy
- **RPC Download Proxy** — Forward aria2 download requests through the server with encrypted secret storage

---

## 🔍 Interface Preview

### 1. Repository Management (`Stars` View)

**Features:**
- **AI Batch Analysis** — Select multiple repos and use AI to auto-generate descriptions, tags, and categories; supports pause/resume
- **Repo Card Display** — Shows stars, forks, language, default branch status; supports expanding README preview
- **Category Sidebar** — Drag to reorder categories, custom category colors, collapse/expand sidebar; supports locking categories to prevent AI overrides
- **Bulk Action Toolbar** — Bulk categorize to a specified category, bulk restore AI analysis results
- **Multi-layout Support** — Adapts layout for desktop and tablet
- **Subscription Indicators** — Shows which repos have Release update subscriptions
- **AI Analysis Status** — Shows analyzed / not analyzed / analysis failed; filter by analysis status

**Screenshot:**
![Repository Management Interface](upload/repo.png)

---

### 2. Release Timeline (`Releases` View)

**Features:**
- **Release Subscription Management** — Subscribe/unsubscribe to repo releases; supports bulk unsubscribe
- **Timeline Display** — Lists all new releases in reverse chronological order; shows read/unread status
- **Smart Asset Filtering** — Filter by platform (macOS / Windows / Linux / ARM); filter by file type (dmg / zip / deb / rpm / apk)
- **Custom Filter Rules** — Save custom keyword filter rules
- **Expand & Download** — Expand release assets list, one-click copy download links; shows file size
- **Release Details** — Displays version number, release name, time since release
- **Multi-view Modes** — List view / Grid view toggle
- **Paginated Loading** — Load historical release records page by page
- **Refresh Status Indicator** — Shows last refresh time

**Screenshot:**
![Release Timeline Interface](upload/release.png)

---

### 3. Discovery / Trending (`Discover` View)

**Features:**
- **Five Discovery Channels** — Trending / Hot Release / Most Popular / Topic / Search
- **Trending Time Range** — Three time dimensions: Today / This Week / This Month
- **Trending Filtering Rules** — Updated within 30 days, 50+ stars, sorted by stars descending
- **Platform Filtering** — Filter by OS (All / macOS / Windows / Linux / Browser)
- **Programming Language Filtering** — Filter by language (JavaScript / TypeScript / Python / Go / Rust, etc.)
- **AI Repo Analysis** — One-click AI analysis for trending repos
- **Subscribe to Trending Repos** — Add interesting trending repos to subscription list
- **Mobile Tab Navigation** — Channel switching adapted for mobile devices

**About Trending:**
> Trending data is sourced from GitHub's trending RSS feed, auto-updated every 30 minutes. Perfect for discovering emerging hot projects, tracking tech trends, and finding learning directions.

**Screenshot:**
![Discovery Trending Interface](upload/discovery.png)

---

### 4. Fork Management (`Forks` View)

**Features:**
- **Fork Listing** — Automatically fetches all your forked repos with upstream update detection
- **One-click Sync** — Merge upstream changes into any branch with conflict handling
- **GitHub Actions** — View and trigger workflow runs directly from fork cards
- **Read/Unread Tracking** — Pulse indicator for forks with new upstream commits
- **Search & Pagination** — Full-text search, configurable page sizes

**Screenshot:**
![Fork](upload/fork.png)

---

### 5. Gist Management (`Gist` View)

**Features:**
- **Gist Listing** — Automatically syncs all your Gists and starred Gists with category filtering (All / Mine / Starred)
- **Create & Edit** — Multi-file Gist editor with syntax-highlighted code blocks; supports adding, renaming, and deleting files
- **AI Analysis** — One-click AI summarization for Gist content; batch analysis with pause/resume
- **Semantic Search** — AI-powered search reranking to find Gists by intent, not just filename
- **Detail View** — Expandable Gist detail modal with file content, syntax highlighting, and copy-to-clipboard
- **Star & Unstar** — Star/unstar Gists directly from the card
- **Smart Filtering** — Filter by analysis status, language, and sort by name/date/file count

**Screenshot:**
![Gist Management Interface](upload/gist.png)

---

### 6. Search & Filters

**Features:**
- **Multi-dimensional Search** — Keyword search, repo status filter, tag filter, language filter, platform filter
- **AI Analysis Status Filter** — Analyzed / Not Analyzed / Analysis Failed / Edited
- **Release Subscription Filter** — Subscribed / Not Subscribed to Release
- **Category Status Filter** — Category Locked / Not Locked
- **Shortcut Keys Support** — Displays search shortcut hints
- **Search Statistics** — Shows result count and filter conditions
- **Search Demo Mode** — Demonstrates semantic search capabilities

**Screenshot:**
![Search Interface](upload/search.png)

---

### 7. Settings Panel

**Settings Groups:**

| Group | Features |
|-------|----------|
| **General** | Language toggle (ZH/EN), theme settings |
| **AI Config** | Configure OpenAI / Anthropic / Ollama / compatible APIs; supports custom endpoints and keys |
| **WebDAV** | Backup config for Jianguoyun, Nextcloud, ownCloud, and standard WebDAV services |
| **Backup** | Backup history, manual backup/restore, incremental backup |
| **Backend Server** | Connect to self-hosted backend, API key authentication, sync status indicator |
| **Network** | HTTP/SOCKS5 proxy config with protocol-level testing; aria2 RPC remote download setup |
| **Category** | Category management, category sorting, default category override rules |
| **Data Management** | Data import/export, clear local data, reset all data |
| **Vector Search** | Configure Cloudflare Vectorize worker, embedding model, index mode (description / README), and manage index rebuild |

**Screenshot:**
![Settings Panel Interface](upload/settings.png)

---

### 8. Custom AI Models

**Features:**
- **Multi AI Provider Support** — OpenAI (GPT-3.5/GPT-4), Anthropic (Claude), Ollama (local models), any OpenAI-compatible API
- **Custom Endpoints** — Supports privately deployed AI services
- **Connection Testing** — Test API connection after configuration
- **AI Model Selection** — Choose the specific model to use

**Screenshot:**
![AI Configuration Interface](upload/ai.png)

## 🛠 Tech Stack

- **Frontend**: React 18 + TypeScript + Tailwind CSS
- **State Management**: Zustand
- **Icons**: Lucide React + Font Awesome
- **Build Tool**: Vite

## 👋🏻 How to Use

### 💻 Desktop Client (Recommended)

You can download desktop client here:
https://github.com/AmintaCCCP/GithubStarsManager/releases

### 🤖 Run With code

1. Download the source code, or clone the repository
2. Navigate to the directory, and open a Terminal window at the downloaded folder.
3. Run `npm install` to install dependencies and `npm run dev` to build

> 💡 When running the project locally using `npm run dev`, calls to AI services and WebDAV may fail due to CORS restrictions. To avoid this issue, use the prebuilt client application or build the client yourself. Alternatively, run the backend server (`cd server && npm run dev`) to proxy API calls and avoid CORS entirely.

### 🐳 Run With Docker

Pre-built backend **and frontend** images are available on GHCR — no local build required:

```bash
docker pull ghcr.io/amintacccp/github-stars-manager-server:latest
docker pull ghcr.io/amintacccp/github-stars-manager-frontend:latest
docker-compose up -d
```

> If the package is private, run `docker login ghcr.io` first (use a [PAT](https://github.com/settings/tokens) with `read:packages` scope).

See [DOCKER.md](DOCKER.md) for detailed instructions. The Docker setup handles CORS properly and allows you to configure any AI or WebDAV service URLs directly in the application.

### 🖥️ Backend Server (Optional)

The app works fully without a backend (pure frontend, localStorage). An optional Express + SQLite backend adds:
- **Cross-device sync**: Share data between browsers/devices
- **CORS-free proxying**: AI and WebDAV calls go through the server, avoiding browser CORS issues
- **Token security**: API keys stored encrypted on server, never exposed to browser network tab

#### Quick Start (Docker — recommended)
```bash
docker-compose up -d
```
Frontend on port 8080, backend on port 3000. Data persisted in a Docker volume.

To customize, create a `.env` file:
```bash
API_SECRET=your-secret
ENCRYPTION_KEY=your-key
BACKEND_IMAGE_TAG=0.6.2   # pin backend image version (default: latest)
FRONTEND_IMAGE_TAG=0.6.2  # pin frontend image version (default: latest)
```

#### Backend only (docker run)
```bash
# Basic — no auth, port 3000
docker run -d --name github-stars-backend \
  -v github-stars-data:/app/data \
  -p 3000:3000 \
  ghcr.io/amintacccp/github-stars-manager-server:latest

# With custom secret and encryption key
docker run -d --name github-stars-backend \
  -v github-stars-data:/app/data \
  -p 3000:3000 \
  -e API_SECRET="your-secret" \
  -e ENCRYPTION_KEY="your-key" \
  ghcr.io/amintacccp/github-stars-manager-server:latest
```

#### Manual Setup
```bash
cd server
npm install
npm run dev
```

#### Environment Variables
| Variable | Required | Description |
|----------|----------|-------------|
| `API_SECRET` | No | Bearer token for API authentication. If unset, auth is disabled. |
| `ENCRYPTION_KEY` | No | AES-256 key for encrypting stored secrets. Auto-generated if unset. |
| `PORT` | No | Server port (default: 3000) |

#### Connecting Frontend to Backend
1. Open Settings panel in the app
2. Find "Backend Server" section
3. Enter API Secret (if configured)
4. Click "Test Connection" — green indicator means connected
5. Use "Sync to Backend" / "Sync from Backend" to transfer data

## 🤖 AI Service Configuration

The app supports multiple AI providers. Configure yours in the Settings panel:

- **OpenAI**: GPT-3.5 / GPT-4
- **Anthropic**: Claude
- **Ollama**: local models with no API key needed
- **Any OpenAI-compatible API**: custom endpoint + key

Steps: open Settings, add an AI config, enter your endpoint and key, pick a model, then test the connection.

## 🌐 Network Proxy Configuration

The app supports routing all outbound requests through a proxy:

- **HTTP Proxy** — Standard HTTP CONNECT tunneling with optional authentication
- **SOCKS5 Proxy** — Full SOCKS5 support including username/password auth (RFC 1929)
- **Protocol-level Testing** — Connection test performs actual protocol handshakes, not just TCP connect
- **Encrypted Storage** — Proxy passwords are encrypted at rest with AES-256-GCM

Configure in Settings → Network tab (available in Electron client or with backend server).

![network](upload/network.png)

## ⬇️ Remote Download (aria2 RPC)

Send release download links directly to an aria2 daemon:

1. Start aria2 with RPC enabled: `aria2c --enable-rpc --rpc-listen-port=6800`
2. Open Settings → Network → Remote Download
3. Enter host, port, and optional secret
4. Test connection, then save
5. Release asset buttons will now queue downloads to aria2

Works in both backend-proxied mode and client-only mode (direct browser→aria2 connection).

## 🧠 Vector Semantic Search (Optional)

Vector Semantic Search uses [Cloudflare Vectorize](https://developers.cloudflare.com/vectorize/) to provide high-precision, natural-language search over your starred repositories. Instead of keyword matching, it embeds repo descriptions (or full README content) into vectors and searches by semantic similarity.

![vectorize](upload/vectorize.png)

**How it works:**
1. Frontend generates embeddings via your configured provider (OpenAI, Gemini, Cohere, Ollama, SiliconFlow, or any OpenAI-compatible API)
2. A lightweight Cloudflare Worker acts as a pure Vectorize proxy (store / query / delete)
3. On search, the query is embedded and matched against the vector index; results are optionally reranked by your AI service
4. When disabled or on failure, the app automatically falls back to keyword-based AI search

**Supported Embedding Providers:**

| Provider | Models | Dimensions |
|----------|--------|------------|
| OpenAI | text-embedding-3-small / large | 1536 / 3072 |
| Gemini | text-embedding-004 | 768 |
| Cohere | embed-multilingual-v3.0 | 1024 |
| Ollama | nomic-embed-text / bge-m3 | 768 / 1024 |
| SiliconFlow | BAAI/bge-large-zh-v1.5 | 1024 |
| OpenAI-compatible | (custom) | (custom) |

**Quick setup:**
1. Deploy the Cloudflare Worker — see [cloudflare-worker/README.md](cloudflare-worker/README.md) for step-by-step deployment instructions
2. In the app: **Settings → Vector Search** — enter the Worker URL and auth token
3. Configure an embedding provider (API key + model)
4. Click **Rebuild Index** to embed and upload all repos
5. Use the **AI Search** button — it will automatically use vector search when enabled

> ⚠️ After changing the embedding model, you must rebuild the index — different models produce incompatible vector dimensions.

## 💾 WebDAV Backup Configuration

Back up and sync your data via any standard WebDAV service:

- **Jianguoyun (坚果云)**: recommended for users in China
- **Nextcloud**: self-hosted cloud storage
- **ownCloud**: enterprise-grade option
- **Any standard WebDAV server**

Steps: open Settings, add a WebDAV config, enter the server URL, username, password, and path, test the connection, then enable auto-backup.

## 🚀 Deployment

The build output is a static site, so it deploys anywhere static hosting is supported:

- **Netlify**: connect your fork, set build command `npm run build`, publish directory `dist`
- **Vercel**: same as Netlify — import repo, build runs automatically
- **GitHub Pages**: push the `dist` folder to a `gh-pages` branch
- **Cloudflare Pages**: connect repo, build command `npm run build`, output `dist`
- **Self-hosted**: serve the `dist` folder with any HTTP server (nginx, Caddy, etc.)

For Docker deployment see the [Backend Server](#️-backend-server-optional) section above.

## Who it's for

Developers with hundreds/thousands of stars
People who systematically track releases
"Lazy-efficient" users who don't want manual tagging

## Additional Notes

1. The backend is optional but recommended for web deployment. Without it, all data is stored in your browser's localStorage — back up important data regularly.
2. I can't write code, this app is entirely written by the AI, mainly for my personal requirment. If you have a new feature or meet a bug, I can only try to do it, but I can't guarantee it, because it depends on the AI to do it successfully.😹

## 🤝 Contributing

Contributions are welcome!

1. Fork the project
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

MIT — see [LICENSE](LICENSE) for details.

## StarMapper

<a href="https://starmapper.bruniaux.com/AmintaCCCP/GithubStarsManager?utm_source=map-embed&utm_medium=readme&utm_campaign=stargazer-map">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://starmapper.bruniaux.com/api/map-image/AmintaCCCP/GithubStarsManager?theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://starmapper.bruniaux.com/api/map-image/AmintaCCCP/GithubStarsManager?theme=light" />
    <img alt="StarMapper" src="https://starmapper.bruniaux.com/api/map-image/AmintaCCCP/GithubStarsManager" />
  </picture>
</a>

## Star History

<a href="https://www.star-history.com/?type=date&repos=AmintaCCCP%2FGithubStarsManager">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=AmintaCCCP/GithubStarsManager&type=date&theme=dark&legend=top-left&sealed_token=46W7TFJ9FB1XLxW3s1C_cCrjYJUnm_7182jR7SStg1gxmkU35yXXh0-aIkUyu1QNemgFVXRedHbBj3jdmi1xHLfq1MAn0UNCc_4xCTriY7CxWA9fo8zbQsGym6oHvRqDXGkNfII64VHVbR7vXVYorXXVXYk577vK_0MF8o9L96i6CtrW_vSrPbBq_4RP" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=AmintaCCCP/GithubStarsManager&type=date&legend=top-left&sealed_token=46W7TFJ9FB1XLxW3s1C_cCrjYJUnm_7182jR7SStg1gxmkU35yXXh0-aIkUyu1QNemgFVXRedHbBj3jdmi1xHLfq1MAn0UNCc_4xCTriY7CxWA9fo8zbQsGym6oHvRqDXGkNfII64VHVbR7vXVYorXXVXYk577vK_0MF8o9L96i6CtrW_vSrPbBq_4RP" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=AmintaCCCP/GithubStarsManager&type=date&legend=top-left&sealed_token=46W7TFJ9FB1XLxW3s1C_cCrjYJUnm_7182jR7SStg1gxmkU35yXXh0-aIkUyu1QNemgFVXRedHbBj3jdmi1xHLfq1MAn0UNCc_4xCTriY7CxWA9fo8zbQsGym6oHvRqDXGkNfII64VHVbR7vXVYorXXVXYk577vK_0MF8o9L96i6CtrW_vSrPbBq_4RP" />
 </picture>
</a>
