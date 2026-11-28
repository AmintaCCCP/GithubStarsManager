# Docker 部署指南

[English](DOCKER.md) | **简体中文** · [← 返回 README](README_zh.md)

使用 Docker 快速自托管 **GithubStarsManager**。你可以沿用默认的**前后端分离 Compose**（Nginx 前端 + Node.js 后端），也可以选择新增的**全栈单容器镜像**（单个 Node/Express 进程同源提供前端页面、`/api` 与 MCP 服务）。现有镜像、`docker-compose.yml`、API 路径与桌面客户端均保持 100% 兼容。

**快速导航：** [部署方式对比](#部署方式对比) · [镜像与标签](#已发布镜像与标签) · [前后端分离（默认）](#方式一前后端分离-compose默认) · [全栈单容器（可选）](#方式二全栈单容器可选) · [安全加固与 API_SECRET](#安全加固与-api_secret-指南) · [环境变量参考](#环境变量参考) · [多账号与 MCP](#多账号隔离与-mcp-服务) · [持久化、备份与迁移](#数据持久化备份与迁移) · [常见问题排查](#常见问题排查)

---

## 部署方式对比

| 部署方式 | 使用的镜像与 Compose 文件 | 对外端口 | 适用场景 | 兼容性 |
|---|---|---|---|---|
| **前后端分离 Compose** *(默认)* | `github-stars-manager-frontend` + `github-stars-manager-server`（`docker-compose.yml`） | `8080:80`（Nginx → `backend:3000`） | 需要独立升级前后端、自定义 Nginx/反代配置或沿用现有部署 | **保持不变** |
| **全栈单容器** *(可选)* | `github-stars-manager-fullstack`（`docker-compose.fullstack.yml`） | `8080:3000`（单 Node/Express 进程） | 个人服务器、Mac、NAS 或 homelab——一个容器、一个标签、一个数据卷 | 新增方式，复用同一 URL 与 `backend-data` 卷 |
| **独立后端** | `github-stars-manager-backend` *（兼容别名：`-server`）* | `3000:3000` | 仅需自托管同步/MCP 后端以配合桌面端或自定义前端 | 新部署推荐使用规范 `-backend` 镜像 |

> [!TIP]
> 所有已发布的 GHCR 镜像均同时提供 **`linux/amd64`** 与 **`linux/arm64`** 多架构变体。Docker 会根据宿主机架构自动拉取对应版本（支持 x86_64 服务器、Apple Silicon Mac 及 ARM64 NAS/开发板）。

---

## 准备条件

- 已安装 **Docker**
- 推荐使用 **Docker Compose v2**（`docker compose`）；旧版 `docker-compose` 同样兼容 `docker-compose.yml`

如果 GHCR 镜像被设为私有，拉取前请先登录：

```bash
docker login ghcr.io -u YOUR_GITHUB_USERNAME
```

密码填写具有 `read:packages` 权限的 GitHub [Personal Access Token](https://github.com/settings/tokens)。

---

## 已发布镜像与标签

| 角色 | GHCR 镜像地址 | 说明 |
|---|---|---|
| 前端 | `ghcr.io/amintacccp/github-stars-manager-frontend` | Nginx 托管静态 SPA，并反向代理 `/api/`、`/mcp`、`/mcp/`、`/sse`、`/messages` |
| 后端 *(规范名)* | `ghcr.io/amintacccp/github-stars-manager-backend` | 推荐用于新的独立后端部署 |
| 后端 *(兼容别名)* | `ghcr.io/amintacccp/github-stars-manager-server` | 同步发布完全一致的标签，确保现有 `docker-compose.yml` 零改动 |
| 全栈 *(可选)* | `ghcr.io/amintacccp/github-stars-manager-fullstack` | 单 Node/Express 容器（内置 `STATIC_DIR=/app/public`），同源提供 UI + API + MCP |

所有角色镜像采用统一的标签体系（以根目录 `package.json` 版本号为准，当前为 `0.9.1`）：

| 标签 | 含义 |
|---|---|
| `latest` | `main` 分支的最新构建 |
| `v0.9.1` | 与根目录 `package.json` 一致的正式发布标签 |
| `0.9.1`、`0.9`、`0` | 由同一 `v0.9.1` 正式版本派生的便捷语义化标签 |
| `sha-<短提交哈希>` | 指定提交的构建（如 `sha-abc1234`） |

> [!NOTE]
> 根目录 `package.json` 是桌面客户端与 Docker 正式镜像的唯一版本来源。发布工作流会校验 Git 标签必须严格等于 `v<version>`，确保客户端版本与 Docker 镜像标签始终一致。

---

## 方式一：前后端分离 Compose（默认）

`docker-compose.yml` 保持原有结构：前端 Nginx 容器对外暴露 `8080` 端口，后端容器在 Compose 内网监听 `3000` 端口，并由前端自动代理 `/api`、`/mcp` 与 SSE 请求。

### 1. 创建 `.env` 文件（推荐）

在仓库根目录创建 `.env`，显式设置 `API_SECRET` 并按需固定版本标签：

```dotenv
API_SECRET=替换为足够长的随机密钥
# 可选：留空时自动生成并保存到 /app/data/.encryption-key
# ENCRYPTION_KEY=替换为你的加密密钥
# 固定正式版本（不设置则默认跟踪 main 分支的 latest）
BACKEND_IMAGE_TAG=0.9.1
FRONTEND_IMAGE_TAG=0.9.1
# BACKEND_HOST=backend:3000
```

### 2. 启动服务

```bash
docker compose up -d

# 验证健康检查
curl http://localhost:8080/api/health
```

在浏览器访问 **`http://localhost:8080`** 即可使用。

> [!IMPORTANT]
> 如果未设置 `API_SECRET` 直接启动分离部署，后端已**不再默认无认证开放**。首次启动时会自动生成安全随机密钥并持久化到 `/app/data/.api-secret`（密钥值绝不会输出到日志）。运行以下命令取回一次：
> ```bash
> docker compose exec backend cat /app/data/.api-secret
> ```
> 然后将该密钥填入 Web 界面或桌面端的 **API Secret** 配置项。详见 [安全加固与 `API_SECRET` 指南](#安全加固与-api_secret-指南)。

---

## 方式二：全栈单容器（可选）

全栈镜像（`ghcr.io/amintacccp/github-stars-manager-fullstack`）在**单个 Node/Express 进程**中同时提供前端页面、`/api`、MCP 和 SSE 端点，无需在容器内并行运行 Nginx 和进程管理器。`docker-compose.fullstack.yml` 与原有 `docker-compose.yml` 并列存在，互不干扰。

### 使用 Docker Compose 启动

为避免面向网络的新服务意外以无认证状态启动，`docker-compose.fullstack.yml` 强制要求在 `.env` 中配置 `API_SECRET`：

```dotenv
# docker-compose.fullstack.yml 必填
API_SECRET=替换为足够长的随机密钥

# 可选：固定正式版本（默认 latest）
IMAGE_TAG=0.9.1

# 可选：全新部署可省略，由服务端自动生成并保存在 /app/data/.encryption-key。
# 若是从旧部署迁移且旧部署显式设置过 ENCRYPTION_KEY，必须填写完全相同的值。
# ENCRYPTION_KEY=原部署完全一致的加密密钥

# 仅在无 TLS 反向代理、且从其他机器通过纯 HTTP 直接访问时设为 false
# CSP_UPGRADE_INSECURE_REQUESTS=false
```

启动并验证：

```bash
docker compose -f docker-compose.fullstack.yml up -d
curl http://localhost:8080/api/health
```

在浏览器打开 **`http://localhost:8080`**。

### 使用 `docker run` 直接启动

直接运行 `docker run` 不会读取 Compose 的 `.env` 文件。请务必保留 `-v github-stars-data:/app/data`，确保升级或重建容器时 SQLite 数据库与加密密钥不丢失：

```bash
# 固定到 0.9.1 正式版本，或改为 latest 跟踪 main 分支
export IMAGE_TAG=0.9.1

docker run -d \
  --name github-stars-manager-fullstack \
  -p 8080:3000 \
  -v github-stars-data:/app/data \
  -e API_SECRET="替换为足够长的随机密钥" \
  ghcr.io/amintacccp/github-stars-manager-fullstack:${IMAGE_TAG}
```

> [!IMPORTANT]
> **局域网纯 HTTP 访问（`http://<主机IP>:8080`）：** 全栈服务默认通过 Helmet 发送 `upgrade-insecure-requests` CSP 响应头。如果你未在前面配置 TLS 反向代理，而从局域网另一台设备通过纯 HTTP 访问，浏览器会把页面自身资源改写为 `https://`（触发 `ERR_SSL_PROTOCOL_ERROR`），导致白屏。此时请在 `.env` 中设置 `CSP_UPGRADE_INSECURE_REQUESTS=false`（或传入 `-e CSP_UPGRADE_INSECURE_REQUESTS=false`）。若由反向代理终止 TLS，请保持默认值 `true`。

**部署在反向代理（Nginx / Caddy / Traefik）之后：** 分离部署的 `docker-compose.yml` 默认为后端设置了 `TRUST_PROXY=1`，而全栈单容器默认 `trust proxy = false`。如果将全栈容器放在反代之后，请显式传入 `TRUST_PROXY=1`（或实际代理跳数），以便限流与访问日志获取真实客户端 IP。

---

## 独立容器运行与本地构建

### 单独运行后端（`docker run`）

配合桌面客户端、自定义反代或独立托管前端时，推荐使用规范的 `-backend` 镜像：

```bash
# 基础启动（自动生成 /app/data/.api-secret 与 /app/data/.encryption-key）
docker run -d \
  --name github-stars-backend \
  -v github-stars-data:/app/data \
  -p 3000:3000 \
  ghcr.io/amintacccp/github-stars-manager-backend:0.9.1

# 取回自动生成的 API Secret
docker exec github-stars-backend cat /app/data/.api-secret
```

如需显式指定密钥或映射不同宿主机端口：

```bash
docker run -d \
  --name github-stars-backend \
  -v github-stars-data:/app/data \
  -p 8080:3000 \
  -e API_SECRET="your-secret-here" \
  -e ENCRYPTION_KEY="your-encryption-key" \
  ghcr.io/amintacccp/github-stars-manager-backend:0.9.1
```

### 单独运行前端（`docker run`）

通过 `BACKEND_HOST` 指定后端可达地址（Docker Desktop 可用 `host.docker.internal:3000`，同一 Docker 网络下可用后端容器名/IP）：

```bash
docker run -d \
  --name github-stars-frontend \
  -p 8080:80 \
  -e BACKEND_HOST=host.docker.internal:3000 \
  ghcr.io/amintacccp/github-stars-manager-frontend:0.9.1
```

### 本地自行构建镜像

<details>
<summary>展开查看本地构建命令（分离 Compose、前端 Dockerfile、全栈 Dockerfile）</summary>

**分离 Compose 使用覆盖文件（推荐，无需修改 `docker-compose.yml`）：**

在项目根目录创建 `docker-compose.override.yml`（请**不要**提交到 Git）：

```yaml
services:
  backend:
    build: ./server
```

执行构建并启动：

```bash
docker compose up -d --build
```

删除 `docker-compose.override.yml` 即可切回 GHCR 预构建镜像。（也可以直接在 `docker-compose.yml` 中注释 `image:` 并取消注释 `build:`。）

**仅构建前端（`Dockerfile`）：**

```bash
docker build -t github-stars-manager-frontend:local .
docker run -d -p 8080:80 \
  -e BACKEND_HOST=host.docker.internal:3000 \
  --name github-stars-frontend \
  github-stars-manager-frontend:local
```

**构建全栈单容器（`Dockerfile.fullstack`）：**

```bash
docker build -f Dockerfile.fullstack -t github-stars-manager-fullstack:local .
docker run -d \
  --name github-stars-manager-fullstack \
  -p 8080:3000 \
  -v github-stars-data:/app/data \
  -e API_SECRET="your-secret-here" \
  github-stars-manager-fullstack:local
```

</details>

---

## 安全加固与 `API_SECRET` 指南

自 **2026-11-11 安全加固更新**起，后端在未设置 `API_SECRET` 时默认**安全闭环（fail-closed）**：

1. **显式设置了 `API_SECRET`（推荐）：** 后端原样使用该环境变量值（保留首尾空白以兼容旧部署）。
2. **未设置 `API_SECRET`（默认行为）：** 首次启动时原子生成 64 位十六进制随机密钥，并以 `0600` 权限持久化到 `/app/data/.api-secret`。后续重启会复用同一文件，**密钥值绝不会打印到容器日志**。除 `GET /api/health` 外，所有 `/api/*` 请求均需携带 `Authorization: Bearer <secret>`。
3. **显式设置 `ALLOW_INSECURE_NO_AUTH=1`（仅限本地开发）：** 在未配置 `API_SECRET` 时临时恢复旧的无认证开发模式，并在启动时输出醒目警告。

> [!WARNING]
> **切勿**在任何公网可达或不可信网络环境中启用 `ALLOW_INSECURE_NO_AUTH=1` 或 `true`。

### 取回自动生成的密钥

```bash
# 分离 Compose 部署
docker compose exec backend cat /app/data/.api-secret

# 独立后端容器
docker exec github-stars-backend cat /app/data/.api-secret
```

### 从旧版无认证部署升级

如果你的旧部署此前未配置 `API_SECRET`，升级后可任选以下方式之一：

1. **直接使用自动生成的密钥：** 拉取新镜像重启后，运行 `docker compose exec backend cat /app/data/.api-secret` 取出密钥，并在 Web 界面或桌面端的**后端设置 → API Secret**中填写一次即可。
2. **自定义固定密钥（推荐）：** 生成高强度随机密钥（如 `openssl rand -hex 32`），写入 `.env` 的 `API_SECRET=<密钥>`，执行 `docker compose up -d` 重启，并在客户端填入相同密钥。

> [!NOTE]
> 如果 `/app/data` 挂载为只读，或 `.api-secret` 为空/不可读，后端会退回到进程内临时随机密钥（每次重启都会变化）以避免崩溃循环。请修复目录写权限，或显式配置 `API_SECRET` 环境变量以保持重启后认证稳定。

---

## 环境变量参考

### 后端与全栈运行时变量

| 变量 | 分离后端 | 全栈单容器 | 默认值 | 说明 |
|---|---|---|---|---|
| `API_SECRET` | 可选 *(未设则自动生成)* | Compose **必填** | 自动保存至 `data/.api-secret` | 保护 `/api/*`（`/api/health` 除外）的 Bearer Token。分离/独立后端未设置时首次启动自动生成并持久化到 `/app/data/.api-secret`；`docker-compose.fullstack.yml` 强制要求设置。 |
| `ALLOW_INSECURE_NO_AUTH` | 可选 | 不建议 | 未设置 | 设为 `1` 或 `true`（不区分大小写）可在未设置 `API_SECRET` 时关闭 `/api` 认证（仅限本地开发），并输出醒目警告。 |
| `ENCRYPTION_KEY` | 可选 | 可选 | 自动保存至 `data/.encryption-key` | 用于加密存储凭据（GitHub Token、AI 密钥、WebDAV 密码、MCP Token）的 AES-256 密钥。64 位十六进制直接使用，其他格式经 SHA-256 归一化为 32 字节。环境变量优先于密钥文件。 |
| `PORT` | 可选 | 可选 | `3000` | Node/Express 容器内监听端口（全栈 Compose 默认映射宿主机 `8080:3000`）。 |
| `DB_PATH` | 可选 | 可选 | `data/data.db`（`/app/data/data.db`） | 默认账号 SQLite 数据库路径。多账号子数据库位于 `<DB_PATH 所在目录>/profiles/<profileId>.db`。 |
| `TRUST_PROXY` | Compose 默认 `1` | 可选（`false`） | `false` | Express `trust proxy` 配置（`true`、`false`、代理跳数如 `1` 或反代 IP/网段）。部署在 Nginx/Caddy/Traefik 后建议设为 `1`，确保限流识别真实客户端 IP。 |
| `CSP_UPGRADE_INSECURE_REQUESTS` | 可选 | Compose 默认 `true` | `true` | 控制 Helmet 的 `upgrade-insecure-requests` CSP 指令。无 TLS 反代且从局域网纯 HTTP 访问时设为 `false`、`0` 或 `no`。 |
| `CSP_CONNECT_SRC` | 可选 | 可选 | 内置白名单 | 以逗号分隔的额外允许来源，追加到 CSP `connect-src`（用于浏览器直连模式访问自定义 AI 代理或 Cloudflare Worker）。默认允许 `'self'`、GitHub API/raw/gist、GitHubTrendingRSS、OpenAI 与 Gemini。 |
| `STATIC_DIR` | 未设置 | `/app/public` *(内置)* | 未设置 | Express 托管编译后前端静态文件的目录。`Dockerfile.fullstack` 已自动配置；纯后端部署请保持未设置。 |
| `NODE_ENV` | 可选 | `production` *(内置)* | `development` | 设为 `production` 时，错误响应中不暴露堆栈跟踪。 |

### 前端 Nginx 与 Compose 镜像标签变量

| 变量 | 适用范围 | 默认值 | 说明 |
|---|---|---|---|
| `BACKEND_HOST` | 分离前端（`Dockerfile`） | `backend:3000` | Nginx 转发 `/api/`、`/mcp`、`/mcp/`、`/sse` 与 `/messages` 的上游 `主机:端口`。 |
| `RESOLVER` | 分离前端（`Dockerfile`） | `127.0.0.11` | Nginx 运行时 DNS 解析器（默认 Docker 内置 DNS；在 Kubernetes/ECS 等环境按需覆盖）。 |
| `BACKEND_IMAGE_TAG` | `docker-compose.yml` | `latest` | 分离部署后端镜像标签（如 `0.9.1`）。 |
| `FRONTEND_IMAGE_TAG` | `docker-compose.yml` | `latest` | 分离部署前端镜像标签（如 `0.9.1`）。 |
| `IMAGE_TAG` | `docker-compose.fullstack.yml` | `latest` | 全栈单容器镜像标签（如 `0.9.1`）。 |

---

## 多账号隔离与 MCP 服务

### 多账号后端数据隔离

GithubStarsManager 支持在多个 GitHub 账号间切换，并在服务端提供完整的存储边界隔离：

- **默认账号**继续使用 `/app/data/data.db`，零额外开销，现有单账号数据无需迁移。
- **附加账号**自动路由至独立的 SQLite 文件 `/app/data/profiles/<profileId>.db`（合法 Profile ID 匹配 `^p_[a-z0-9_-]{1,32}$`）。
- **API 路由方式：** 客户端在 `/api/*` 请求中附带 `X-GSM-Profile: <profileId>` 请求头。未携带、为空或为 `default` 时访问 `data.db`；非法 ID 返回 `400 INVALID_PROFILE_HEADER`。
- **账号管理接口**（受 `API_SECRET` 保护）：
  - `GET /api/profiles` — 列出服务端已存在的附加账号及其 GitHub 用户元数据
  - `DELETE /api/profiles/:id` — 安全关闭并删除 `profiles/<id>.db`（及 `-wal`/`-shm`）；若有请求正在使用该库，返回 `409 PROFILE_IN_USE`
- **连接池管理：** 后端通过 LRU 连接池（最多同时保持 16 个附加账号句柄）与引用计数回收空闲连接，确保并发请求安全不被中断。

### MCP 服务（AI Agent 接入）

无论是前后端分离 Compose（经 Nginx 代理）还是全栈单容器（由 Express 直接提供），都在 `8080` 端口暴露完全相同的 MCP 地址，无需额外暴露后端端口：

| 传输协议 | Docker 地址（分离 / 全栈通用） | 桌面端（Electron）地址 | 说明 |
|---|---|---|---|
| **Streamable HTTP** *(推荐)* | `http://localhost:8080/mcp` | `http://127.0.0.1:3927/mcp` | 无状态仅支持 POST（`GET`/`DELETE` 返回 `405`），推荐 Claude Code、Cursor 等现代客户端。 |
| **Legacy SSE** | `http://localhost:8080/mcp/sse` | `http://127.0.0.1:3927/sse` | `GET` 建立 `text/event-stream`，随后向 `/mcp/sse/messages?sessionId=…` 发送 POST 消息。 |
| **Legacy SSE（兼容别名）** | `http://localhost:8080/sse` | `http://127.0.0.1:3927/sse` | 兼容旧客户端；消息地址为 `/messages?sessionId=…`。 |

#### 多账号 MCP 路由

每个账号 Profile 拥有独立的 SQLite 数据库、独立的 **MCP 开关**与独立的加密 `mcp_token`。要在 MCP 客户端中指定某个附加账号，可通过以下任一方式路由：

- **URL 查询参数：** `http://localhost:8080/mcp?profile=p_<id>`（同样支持 `/mcp/sse?profile=p_<id>` 与 `/sse?profile=p_<id>`）
- **HTTP 请求头：** `X-GSM-Profile: p_<id>` *（两者同时传入时以请求头为准）*

#### 接入步骤

1. 在应用中切换到目标 GitHub 账号 → 打开 **设置 → MCP 服务**。
2. 开启 **启用 MCP 服务**（需要已连接后端）。
3. 复制生成的 Token 与客户端 JSON 配置（附加账号会自动在 URL 中带好 `?profile=<id>`）。
4. 粘贴至 Claude Code、Cursor 等客户端的 MCP 配置中：

```json
{
  "mcpServers": {
    "github-stars-manager": {
      "url": "http://localhost:8080/mcp",
      "headers": {
        "Authorization": "Bearer gsm_mcp_..."
      }
    }
  }
}
```

接入附加账号示例（可在 URL 中传 `?profile=<id>`，或在 `headers` 中传 `X-GSM-Profile`）：

```json
{
  "mcpServers": {
    "github-stars-manager-work": {
      "url": "http://localhost:8080/mcp?profile=p_work123",
      "headers": {
        "Authorization": "Bearer gsm_mcp_..."
      }
    }
  }
}
```

> [!NOTE]
> - **独立凭据：** MCP 使用独立的 `mcp_token`（支持 `Authorization: Bearer …` 或 `X-MCP-Token: …`），与 `API_SECRET` 相互独立；重置 MCP Token 不会影响应用与后端同步。
> - **稳定持久化：** MCP Token 加密存储在对应账号的 SQLite 数据库中（`mcp_token`），首次开启时生成，仅在点击**重置 Token** 时变更。
> - **安全校验：** 请求不存在的账号数据库会直接返回 `404`（`MCP_DISABLED`），不会创建空 `.db` 文件；非法 Profile ID 返回 `400`。
> - **按需暴露工具：** 仅当当前账号已配置并启用向量搜索时，才会暴露 `gsm_vector_search` 工具。纯前端部署（无后端）不显示 MCP 设置页。

---

## 数据持久化、备份与迁移

### `/app/data` 数据卷内容

请始终为 `/app/data` 挂载持久化数据卷，其中包含以下核心文件：

| `/app/data` 路径 | 用途 |
|---|---|
| `data.db` *（含 `-wal`、`-shm`）* | 默认账号 SQLite 数据库（仓库、AI 摘要、标签、设置、加密凭据与 MCP Token） |
| `profiles/p_<id>.db` *（含 `-wal`、`-shm`）* | 多账号模式下各附加账号的独立 SQLite 数据库 |
| `.encryption-key` | 未设置 `ENCRYPTION_KEY` 环境变量时自动生成的 AES-256 密钥（`0600`） |
| `.api-secret` | 未设置 `API_SECRET` 环境变量时自动生成的 API 密钥（`0600`） |

> [!WARNING]
> **请务必备份 `/app/data/.encryption-key`（或妥善保管你的 `ENCRYPTION_KEY` 环境变量）！** 数据库与 `.encryption-key` 位于同一数据卷内；如果丢失密钥，或在重建/迁移容器时传入了不同的 `ENCRYPTION_KEY`，所有已加密凭据（GitHub Token、AI API Key、WebDAV 密码、MCP Token）都将无法解密。注意：环境变量 `ENCRYPTION_KEY` 始终优先于 `.encryption-key` 文件。

### 备份数据卷

先停止所有写入进程（**切勿添加 `-v`**），确保 SQLite WAL/日志文件完整落盘后再打包：

```bash
# 查看数据卷名称（Compose 默认通常为 <项目名>_backend-data）
docker volume ls

# 停止容器（不删除数据卷）
docker compose down

# 打包备份数据库、profiles/、.encryption-key 与 .api-secret
docker run --rm \
  -v <existing-backend-data-volume>:/data:ro \
  -v "$PWD":/backup \
  alpine tar czf /backup/github-stars-manager-data-backup.tgz -C /data .
```

### 从前后端分离 Compose 迁移到全栈单容器

迁移完全**可选**。两份 Compose 文件声明了相同的 `backend-data` 卷名；只要在**同一目录**并使用相同的 Compose 项目名（如 `-p <project-name>`），全栈容器就会自动复用原有 SQLite 数据、多账号子库与密钥。

1. **停止分离部署并创建备份**（不要加 `-v`）：
   ```bash
   docker compose down
   # 自定义项目名：docker compose -p <project-name> down

   docker run --rm \
     -v <existing-backend-data-volume>:/data:ro \
     -v "$PWD":/backup \
     alpine tar czf /backup/github-stars-manager-data-backup.tgz -C /data .
   ```
2. **配置 `.env`：**
   - 将旧后端的 `API_SECRET` 原样写入 `.env`（若旧分离部署使用的是自动生成的 `.api-secret`，可将其内容填入 `API_SECRET=`；若旧部署此前无认证，请生成新的高强度密钥并在切换后更新客户端）。
   - 如果旧服务显式设置过 `ENCRYPTION_KEY`，务必写入**完全相同的值**。
   - 可选设置 `IMAGE_TAG=0.9.1`。
3. **使用相同目录 / 项目名启动全栈容器：**
   ```bash
   docker compose -f docker-compose.fullstack.yml up -d
   # 自定义项目名：docker compose -p <project-name> -f docker-compose.fullstack.yml up -d
   ```
4. **验证健康检查、页面数据、多账号与 MCP：**
   ```bash
   curl http://localhost:8080/api/health
   ```

### 回滚到前后端分离部署

停止全栈容器（不要加 `-v`）并重新启动原 Compose 即可，数据卷内的所有数据与凭据均保持完好：

```bash
# 若全栈服务通过 Compose 启动：
docker compose -f docker-compose.fullstack.yml down
# 自定义项目名：docker compose -p <project-name> -f docker-compose.fullstack.yml down

# 若全栈服务通过直接 docker run 启动（替代上方 Compose down）：
# docker stop github-stars-manager-fullstack && docker rm github-stars-manager-fullstack

# 恢复前后端分离部署：
docker compose up -d
# 自定义项目名：docker compose -p <project-name> up -d
```

---

## CORS、停止清理与桌面端兼容性

- **CORS 与反代头：** 分离部署中，Nginx 负责代理 `/api/`、`/mcp`、`/mcp/`、`/sse`、`/messages` 到 `BACKEND_HOST` 并为静态路由附加 CORS 头；全栈部署中，Express 同源提供页面与 API，并由 Helmet 管理 CSP（可通过 `CSP_CONNECT_SRC` 为浏览器直连模式追加自定义 AI/Worker 域名）。
- **停止与清理** *（除非已做好备份并明确要销毁数据，否则切勿使用 `docker compose down -v` 或 `docker volume rm`）*：
  ```bash
  # 停止前后端分离部署
  docker compose down

  # 停止全栈单容器部署
  docker compose -f docker-compose.fullstack.yml down

  # 停止并移除直接 docker run 启动的容器
  docker stop github-stars-manager-fullstack && docker rm github-stars-manager-fullstack
  docker stop github-stars-backend && docker rm github-stars-backend
  ```
- **桌面端打包兼容性：** Docker 部署方案与 Electron 桌面端构建/发布流程完全独立，互不影响。

---

## 常见问题排查

| 现象 | 常见原因 | 解决方案 |
|---|---|---|
| 升级后提示 **`401` / `AUTH_NOT_CONFIGURED`** | 安全加固在未设置 `API_SECRET` 时自动生成了 `/app/data/.api-secret` | 执行 `docker compose exec backend cat /app/data/.api-secret` 取回密钥并填入客户端 **API Secret**；或在 `.env` 中显式设置 `API_SECRET` 后重启。 |
| 全栈模式经 `http://<局域网IP>:8080` 访问**白屏** | Helmet 默认 `upgrade-insecure-requests` 将 `http://` 资源改写为 `https://` | 无 TLS 反向代理时，在 `.env`（或 `-e`）中设置 `CSP_UPGRADE_INSECURE_REQUESTS=false` 并重启。 |
| **浏览器直连模式请求自定义 AI 或 Worker 被 CSP 拦截** | 自定义域名不在默认 `connect-src` 白名单中 | 在后端/全栈容器设置 `CSP_CONNECT_SRC=https://your-ai-proxy.example.com,https://your-worker.workers.dev`。 |
| **全栈 Compose 启动报错**（`Set API_SECRET in .env...`） | `docker-compose.fullstack.yml` 强制要求设置非空 `API_SECRET` | 在同目录 `.env` 中添加 `API_SECRET=<高强度随机密钥>` 后重新执行启动命令。 |
| **重建或迁移后已保存的 Token / 密钥无法读取** | `ENCRYPTION_KEY` 发生变化或 `/app/data/.encryption-key` 丢失 | 从备份恢复 `/app/data/.encryption-key`，或传入迁移前完全一致的 `ENCRYPTION_KEY`。 |
| **附加账号的 MCP 请求返回 `404`（`MCP_DISABLED`）** | 该账号尚未启用 MCP，或 `?profile=<id>` 与实际 Profile ID 不匹配 | 在应用中切换到该账号 → **设置 → MCP 服务**开启 MCP，并复制该账号专属的 URL（`?profile=p_…`）与 Token。 |
| **拉取 GHCR 镜像提示 `denied`** | 包权限为私有或本地登录凭据失效 | 使用带 `read:packages` 权限的 GitHub PAT 执行 `docker login ghcr.io -u YOUR_GITHUB_USERNAME`。 |
