# Docker 部署指南

GithubStarsManager 提供两种 Docker 部署方式。原有的前后端分离方式继续得到完整支持；同时新增了一个**可选的全栈单镜像**，供希望以一个容器完成部署的用户使用。新增方式不会替换、重命名或改变任何现有镜像、`docker-compose.yml`、API 地址或客户端行为。

| 部署方式 | 使用的镜像 / 文件 | 适用场景 | 兼容性 |
|---|---|---|---|
| 前后端分离（现有） | `github-stars-manager-frontend`、`github-stars-manager-server`、`docker-compose.yml` | 需要独立升级、独立部署或自行配置前端反向代理的用户 | **保持不变** |
| 全栈单容器（可选） | `github-stars-manager-fullstack`、`docker-compose.fullstack.yml` | 希望只运行一个容器、一个镜像标签和一个数据卷的个人服务器、Mac 或 homelab 用户 | 新增，不影响现有方式 |

规范镜像名称使用明确的角色后缀：`-frontend`、`-backend` 与 `-fullstack`。原有 `-server` 后端镜像会继续发布同样的标签，作为现有 `docker-compose.yml` 和直接部署用户的兼容别名。

## 准备条件

请先安装 Docker。建议使用 Docker Compose v2（命令为 `docker compose`）；已有用户仍可继续使用原有的 `docker-compose` 命令和 `docker-compose.yml`。

如果 GHCR 镜像被设为私有，请先登录：

```bash
docker login ghcr.io -u YOUR_GITHUB_USERNAME
```

密码应使用具有 `read:packages` 权限的 [GitHub Personal Access Token](https://github.com/settings/tokens)。

所有角色镜像均使用相同的标签语义：`latest` 表示 `main` 的最新构建；`v0.7.8` 表示与客户端完全一致的正式发布标签；`0.7.8`、`0.7`、`0` 是由该正式标签派生的便捷标签；`sha-abc1234` 表示指定提交。根目录 `package.json` 的 `version` 是客户端和 Docker 正式发布的唯一版本来源；只有与该版本完全匹配的 `v<version>` Git 标签才能发布正式镜像。发布镜像同时包含 `linux/amd64` 与 `linux/arm64` 变体，Docker 会根据宿主机架构自动选择 x86_64 或 ARM64 版本。

## 方式一：继续使用现有前后端分离部署

这是现有用户的默认路径，无需为全栈镜像做任何修改。`docker-compose.yml` 保持原样：前端容器对外暴露 8080 端口，后端容器在 Compose 网络中监听 3000 端口，并把 `/api`、`/mcp` 和 SSE 请求由前端代理到后端。

```bash
# 在仓库根目录执行
docker-compose up -d

# 或使用 Docker Compose v2
docker compose up -d
```

应用入口为 `http://localhost:8080`。要固定前后端版本，请在项目根目录创建或修改 `.env`：

```bash
API_SECRET=your-api-secret
ENCRYPTION_KEY=your-encryption-key
BACKEND_IMAGE_TAG=0.7.0
FRONTEND_IMAGE_TAG=0.7.0
# BACKEND_HOST=backend:3000
```

也可以单独运行后端，适用于自行部署前端或只需要 API/MCP 的场景。新部署建议使用规范的 `-backend` 镜像；原有的 `-server` 镜像仍会同步发布相同标签，因此现有用户不需要修改部署：

```bash
docker run -d \
  --name github-stars-backend \
  -p 3000:3000 \
  -v github-stars-data:/app/data \
  -e API_SECRET="your-api-secret" \
  -e ENCRYPTION_KEY="your-encryption-key" \
  ghcr.io/amintacccp/github-stars-manager-backend:latest
```

`/app/data` 中保存 SQLite 数据库和自动生成的 `.encryption-key`。请始终挂载此卷；不要在升级或清理容器时删除它。

## 方式二：可选的全栈单容器部署

全栈镜像 `ghcr.io/amintacccp/github-stars-manager-fullstack` 在**一个 Node/Express 进程**中提供前端页面、`/api`、MCP 和 SSE 端点。它不在一个容器中并行管理 nginx 和 Node，因此无需额外的进程管理器。浏览器仍通过同源 `/api` 访问服务端，MCP 地址也保持为 `http://localhost:8080/mcp`。

最简单的部署方式是使用新增的 Compose 文件。该文件与原来的 `docker-compose.yml` 并列存在，不会覆盖或修改原文件。为避免新增的网络服务意外以无认证状态启动，Compose 会要求先在 `.env` 设置 `API_SECRET`：

```bash
# 在仓库根目录的 .env 中设置
API_SECRET=替换为足够长的随机密钥
# 可选：不设置时会在数据卷中自动生成并保存。
# ENCRYPTION_KEY=替换为你的加密密钥

# 启动全栈单容器
docker compose -f docker-compose.fullstack.yml up -d

# 验证健康检查
curl http://localhost:8080/api/health
```

容器对外暴露 `8080:3000`；对客户端而言，页面、`/api`、`/mcp`、`/mcp/sse`、`/sse` 和 `/messages` 的 URL 语义与分离 Compose 部署保持一致。

如需固定版本，在 `.env` 中设置：

```bash
IMAGE_TAG=0.7.0
API_SECRET=your-api-secret
ENCRYPTION_KEY=your-encryption-key
```

不使用 Compose 时，可直接运行镜像：

```bash
docker run -d \
  --name github-stars-manager-fullstack \
  -p 8080:3000 \
  -v github-stars-data:/app/data \
  -e API_SECRET="your-api-secret" \
  -e ENCRYPTION_KEY="your-encryption-key" \
  ghcr.io/amintacccp/github-stars-manager-fullstack:latest
```

本地构建全栈镜像时，请明确指定新的 Dockerfile：

```bash
docker build -f Dockerfile.fullstack -t github-stars-manager-fullstack:local .
docker run -d \
  --name github-stars-manager-fullstack \
  -p 8080:3000 \
  -v github-stars-data:/app/data \
  github-stars-manager-fullstack:local
```

## 从现有 Compose 部署迁移到单容器

迁移是**可选的**。如果当前前后端分离部署运行正常，您无需执行任何操作。只有在希望简化为一个容器时才迁移。

### 1. 识别并备份现有数据卷

先查看数据卷。默认从本仓库目录启动 Compose 时，卷名通常类似 `<项目名>_backend-data`；如果您使用了 `docker compose -p <项目名>`，卷名会使用该项目名作为前缀。

```bash
docker volume ls
```

将下方的 `<existing-backend-data-volume>` 替换为实际卷名。以下命令会在当前目录创建一个同时包含 SQLite 数据库和 `.encryption-key` 的归档：

```bash
docker run --rm \
  -v <existing-backend-data-volume>:/data:ro \
  -v "$PWD":/backup \
  alpine tar czf /backup/github-stars-manager-data-backup.tgz -C /data .
```

请确认 `github-stars-manager-data-backup.tgz` 已生成，再继续下一步。

### 2. 停止分离部署，但不要删除卷

```bash
# 不要添加 -v；该参数会删除具名数据卷。
docker compose down
```

### 3. 使用相同 Compose 项目名启动全栈容器

两个 Compose 文件都声明了 `backend-data` 卷。只要在**同一目录**下执行，并沿用相同的 Compose 项目名，全栈部署会复用原有 SQLite 数据和加密密钥。

```bash
# 默认项目名
docker compose -f docker-compose.fullstack.yml up -d

# 如原部署使用自定义项目名，请保持一致
docker compose -p <project-name> -f docker-compose.fullstack.yml up -d
```

### 4. 验证迁移结果

```bash
curl http://localhost:8080/api/health
```

随后在浏览器中打开 `http://localhost:8080`，检查仓库、分类、设置和跨设备同步数据。启用 MCP 的用户可继续使用同一个端点：

| 端点 | 默认地址 | 用途 |
|---|---|---|
| Streamable HTTP | `http://localhost:8080/mcp` | 推荐用于 Claude Code、Cursor 等现代客户端 |
| Legacy SSE | `http://localhost:8080/mcp/sse` | 兼容旧式 SSE 客户端 |
| Legacy SSE alias | `http://localhost:8080/sse` | 消息发送地址为 `/messages?sessionId=…` |

MCP Token 和 `API_SECRET` 仍是两个独立的凭据。迁移只更换容器打包方式，不会重置 SQLite 中保存的 MCP Token。

## 回滚到前后端分离部署

如果需要回滚，停止全栈容器后重新启动原有 Compose 服务即可。不要使用 `-v`，这样同一数据卷仍会被保留。

```bash
docker compose -f docker-compose.fullstack.yml down
docker compose up -d
```

若部署时使用了自定义 Compose 项目名，请在两条命令中都添加同一个 `-p <project-name>`。只要保留 `/app/data` 对应的具名卷，回滚后现有数据、加密密钥与 MCP 配置都会继续可用。

## 环境变量

| 变量 | 分离部署 | 全栈部署 | 说明 |
|---|---:|---:|---|
| `API_SECRET` | 可选 | 全栈 Compose 必填 | 后端 API 的 Bearer Token；独立后端未设置时禁用认证。全栈 Compose 必须设置，以避免新服务无认证启动。 |
| `ENCRYPTION_KEY` | 可选 | 可选 | 用于加密服务端保存的密钥；未设置时生成并保存至数据卷。 |
| `DB_PATH` | 可选 | 可选 | SQLite 文件路径，默认位于 `data/data.db`。 |
| `PORT` | 可选 | 可选 | Node 服务端口，默认 3000；全栈 Compose 默认将宿主机 8080 映射至容器 3000。 |
| `BACKEND_HOST` | 可选 | 不需要 | 仅分离前端 nginx 镜像用于指定 `/api` 上游；全栈镜像不使用。 |
| `IMAGE_TAG` | 不使用 | 可选 | `docker-compose.fullstack.yml` 使用的全栈镜像标签，默认 `latest`。 |
| `BACKEND_IMAGE_TAG` | 可选 | 不使用 | 现有 `docker-compose.yml` 后端镜像标签。 |
| `FRONTEND_IMAGE_TAG` | 可选 | 不使用 | 现有 `docker-compose.yml` 前端镜像标签。 |

## 停止和清理

```bash
# 停止原有前后端分离部署
docker compose down

# 停止可选全栈部署
docker compose -f docker-compose.fullstack.yml down

# 删除全栈容器（直接 docker run 时）
docker stop github-stars-manager-fullstack
docker rm github-stars-manager-fullstack
```

除非您已经完成备份并明确希望销毁所有服务端数据，否则请不要使用 `docker volume rm` 或 `docker compose down -v` 删除 `backend-data` 卷。

## 客户端与部署兼容性说明

全栈镜像是新增入口，不会影响任何现有用户：现有前端镜像、后端镜像、`docker-compose.yml`、桌面客户端、API 地址和 MCP 客户端均继续按原方式工作。选择全栈镜像的用户使用同源 URL；选择分离部署的用户无需改动任何命令、端口、环境变量或客户端设置。
