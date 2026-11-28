# Docker Deployment Guide

**English** | [简体中文](DOCKER_zh.md) · [← Back to README](README.md)

Deploy **GithubStarsManager** with Docker in minutes. You can run the default **Split Compose** setup (separate Nginx frontend + Node.js backend) or the optional **Full-Stack Single Container** (one Node/Express process serving the web UI, `/api`, and MCP endpoints from the same origin). Existing images, `docker-compose.yml`, API paths, and desktop clients remain 100% compatible.

**Quick Navigation:** [Choose a Mode](#choose-a-deployment-mode) · [Image Tags](#published-images--tags) · [Split Compose](#option-1-split-compose-default) · [Full-Stack Container](#option-2-full-stack-single-container-optional) · [Auth Hardening](#security-hardening--api_secret-guide) · [Env Reference](#environment-variables) · [Multi-Account & MCP](#multi-account--mcp-server) · [Backup & Migration](#data-persistence-backup--migration) · [Troubleshooting](#troubleshooting)

---

## Choose a Deployment Mode

| Deployment Mode | Image(s) & Compose File | Exposed Port | Best For | Compatibility |
|---|---|---|---|---|
| **Split Compose** *(Default)* | `github-stars-manager-frontend` + `github-stars-manager-server` (`docker-compose.yml`) | `8080:80` (Nginx → `backend:3000`) | Independent frontend/backend upgrades, custom Nginx/proxy setups, existing deployments | Existing default — unchanged |
| **Full-Stack Single Container** *(Optional)* | `github-stars-manager-fullstack` (`docker-compose.fullstack.yml`) | `8080:3000` (Single Node/Express process) | Personal servers, Mac/homelab, NAS — one container, one image tag, one volume | Additive — same URLs & `backend-data` volume |
| **Standalone Backend** | `github-stars-manager-backend` *(legacy alias: `-server`)* | `3000:3000` | Self-hosted sync/MCP backend for the Desktop app or a custom frontend | Canonical `-backend` recommended for new setups |

> [!TIP]
> All published GHCR images include multi-architecture manifests for **`linux/amd64`** and **`linux/arm64`**. Docker automatically pulls the right build for x86_64 servers, Apple Silicon Macs, and ARM64 SBCs/NAS devices.

---

## Prerequisites

- **Docker** installed on your host
- **Docker Compose v2** (`docker compose`) recommended — legacy `docker-compose` also works with `docker-compose.yml`

If the GHCR package is private, authenticate before pulling:

```bash
docker login ghcr.io -u YOUR_GITHUB_USERNAME
```

Use a GitHub [Personal Access Token](https://github.com/settings/tokens) with the `read:packages` scope as the password.

---

## Published Images & Tags

| Role | GHCR Image | Notes |
|---|---|---|
| Frontend | `ghcr.io/amintacccp/github-stars-manager-frontend` | Static SPA served by Nginx; proxies `/api/`, `/mcp`, `/mcp/`, `/sse`, `/messages` |
| Backend *(canonical)* | `ghcr.io/amintacccp/github-stars-manager-backend` | Recommended for new standalone backend deployments |
| Backend *(legacy alias)* | `ghcr.io/amintacccp/github-stars-manager-server` | Receives identical tags for backward compatibility with `docker-compose.yml` |
| Full-Stack *(optional)* | `ghcr.io/amintacccp/github-stars-manager-fullstack` | Single Node/Express container (`STATIC_DIR=/app/public`) serving UI + API + MCP |

All role images share the same tagging scheme (derived from root `package.json`, currently `0.9.1`):

| Tag | Meaning |
|---|---|
| `latest` | Latest build from the `main` branch |
| `v0.9.1` | Exact release tag matching `v<version>` in root `package.json` |
| `0.9.1`, `0.9`, `0` | Convenience semver tags derived from the same `v0.9.1` release |
| `sha-<short-sha>` | Specific commit build (e.g., `sha-abc1234`) |

> [!NOTE]
> Root `package.json` is the single version source for desktop releases and Docker release builds. The release workflow enforces that Git tags match `v<version>` so desktop clients and Docker image tags stay in sync.

---

## Option 1: Split Compose (Default)

`docker-compose.yml` runs the Nginx frontend on port `8080` and the Node.js backend internally on port `3000`, proxying `/api`, `/mcp`, and SSE endpoints automatically.

### 1. Create a `.env` file (recommended)

Create `.env` in the repository root to set an explicit `API_SECRET` and optionally pin image versions:

```dotenv
API_SECRET=replace-with-a-long-random-secret
# Optional: omit to auto-generate and persist in /app/data/.encryption-key
# ENCRYPTION_KEY=replace-with-your-encryption-key
# Pin release versions (omit to track latest from main)
BACKEND_IMAGE_TAG=0.9.1
FRONTEND_IMAGE_TAG=0.9.1
# BACKEND_HOST=backend:3000
```

### 2. Start the stack

```bash
docker compose up -d

# Verify health
curl http://localhost:8080/api/health
```

Open **`http://localhost:8080`** in your browser.

> [!IMPORTANT]
> If you start Split Compose **without** setting `API_SECRET`, the backend no longer runs unauthenticated. On first start it generates a random secret and writes it to `/app/data/.api-secret` (never printed to logs). Retrieve it once with:
> ```bash
> docker compose exec backend cat /app/data/.api-secret
> ```
> Then paste it into the Web UI / Desktop **API Secret** field. See [Security Hardening & `API_SECRET` Guide](#security-hardening--api_secret-guide) for details.

---

## Option 2: Full-Stack Single Container (Optional)

The full-stack image (`ghcr.io/amintacccp/github-stars-manager-fullstack`) serves the web SPA, `/api`, MCP, and SSE endpoints from **one Node/Express process** — no Nginx or process supervisor inside the container. It sits alongside `docker-compose.yml` and does not modify your existing split setup.

### With Docker Compose

`docker-compose.fullstack.yml` requires `API_SECRET` in `.env` so a network-facing deployment cannot start unauthenticated:

```dotenv
# Required by docker-compose.fullstack.yml
API_SECRET=replace-with-a-long-random-secret

# Optional: pin release version (default: latest)
IMAGE_TAG=0.9.1

# Optional: omit for new installs so the server generates /app/data/.encryption-key.
# If migrating an existing deployment that set ENCRYPTION_KEY, keep the EXACT same value.
# ENCRYPTION_KEY=the-exact-existing-key

# Only set to false when accessing directly over plain HTTP from another machine (no TLS reverse proxy)
# CSP_UPGRADE_INSECURE_REQUESTS=false
```

Start and verify:

```bash
docker compose -f docker-compose.fullstack.yml up -d
curl http://localhost:8080/api/health
```

Open **`http://localhost:8080`** in your browser.

### With `docker run`

Direct `docker run` does not load Compose's `.env` file. Always keep `-v github-stars-data:/app/data` so your SQLite databases and encryption key survive upgrades:

```bash
# Use 0.9.1 for a version-pinned release, or latest for main
export IMAGE_TAG=0.9.1

docker run -d \
  --name github-stars-manager-fullstack \
  -p 8080:3000 \
  -v github-stars-data:/app/data \
  -e API_SECRET="replace-with-a-long-random-secret" \
  ghcr.io/amintacccp/github-stars-manager-fullstack:${IMAGE_TAG}
```

> [!IMPORTANT]
> **Plain HTTP LAN Access (`http://<host-ip>:8080`):** The full-stack server sends Helmet's `upgrade-insecure-requests` CSP directive by default. If you access it directly over plain HTTP from another device without a TLS reverse proxy, browsers will rewrite the app's own assets to `https://` (`ERR_SSL_PROTOCOL_ERROR`) and render a blank page. Set `CSP_UPGRADE_INSECURE_REQUESTS=false` in `.env` (or `-e CSP_UPGRADE_INSECURE_REQUESTS=false`) for plain-HTTP LAN access. Keep the default `true` whenever a reverse proxy terminates TLS.

**Deploying behind a reverse proxy (Nginx / Caddy / Traefik):** `docker-compose.yml` sets `TRUST_PROXY=1` on the split backend automatically, whereas the full-stack image defaults to `trust proxy = false`. Add `TRUST_PROXY=1` (or your proxy hop count) to the full-stack environment when sitting behind a reverse proxy so rate limiting and logs record real client IPs.

---

## Standalone Containers & Local Builds

### Standalone Backend (`docker run`)

Use the canonical `-backend` image when pairing with the Desktop app, a custom reverse proxy, or an externally hosted frontend:

```bash
# Minimal (auto-generates /app/data/.api-secret and /app/data/.encryption-key)
docker run -d \
  --name github-stars-backend \
  -v github-stars-data:/app/data \
  -p 3000:3000 \
  ghcr.io/amintacccp/github-stars-manager-backend:0.9.1

# Retrieve the auto-generated API secret
docker exec github-stars-backend cat /app/data/.api-secret
```

With explicit secrets or a custom host port:

```bash
docker run -d \
  --name github-stars-backend \
  -v github-stars-data:/app/data \
  -p 8080:3000 \
  -e API_SECRET="your-secret-here" \
  -e ENCRYPTION_KEY="your-encryption-key" \
  ghcr.io/amintacccp/github-stars-manager-backend:0.9.1
```

### Standalone Frontend (`docker run`)

Point `BACKEND_HOST` at a reachable backend address (`host.docker.internal:3000` on Docker Desktop, or the backend container name/IP on a shared Docker network):

```bash
docker run -d \
  --name github-stars-frontend \
  -p 8080:80 \
  -e BACKEND_HOST=host.docker.internal:3000 \
  ghcr.io/amintacccp/github-stars-manager-frontend:0.9.1
```

### Building Locally

<details>
<summary>Local build commands (Split Compose, Frontend Dockerfile, Full-Stack Dockerfile)</summary>

**Split Compose with an override file (recommended — keeps `docker-compose.yml` clean):**

Create `docker-compose.override.yml` in the repo root (do **not** commit it to git):

```yaml
services:
  backend:
    build: ./server
```

Then build and start:

```bash
docker compose up -d --build
```

Delete `docker-compose.override.yml` to switch back to GHCR images. (Alternatively, comment out `image:` and uncomment `build:` directly in `docker-compose.yml`.)

**Frontend only (`Dockerfile`):**

```bash
docker build -t github-stars-manager-frontend:local .
docker run -d -p 8080:80 \
  -e BACKEND_HOST=host.docker.internal:3000 \
  --name github-stars-frontend \
  github-stars-manager-frontend:local
```

**Full-Stack single container (`Dockerfile.fullstack`):**

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

## Security Hardening & `API_SECRET` Guide

Starting with the **2026-11-11 auth-hardening release**, the backend **fails closed** when `API_SECRET` is omitted:

1. **`API_SECRET` is set (recommended):** The backend uses the exact environment variable value unchanged (preserving any leading/trailing whitespace for legacy compatibility).
2. **`API_SECRET` is unset (default):** On first start, the backend atomically generates a 64-character hex random secret and saves it to `/app/data/.api-secret` (`0600`). Subsequent restarts reuse the same file. **The secret value is never printed to container logs.** All `/api/*` endpoints (except `GET /api/health`) require `Authorization: Bearer <secret>`.
3. **`ALLOW_INSECURE_NO_AUTH=1` (dev escape hatch only):** Explicitly opts back into the legacy unauthenticated mode when `API_SECRET` is unset, logging a prominent startup warning.

> [!WARNING]
> **Never** set `ALLOW_INSECURE_NO_AUTH=1` or `true` on any deployment reachable from the internet or an untrusted network.

### Retrieving an Auto-Generated Secret

```bash
# Split Compose deployment
docker compose exec backend cat /app/data/.api-secret

# Standalone backend container
docker exec github-stars-backend cat /app/data/.api-secret
```

### Upgrading an Older Unauthenticated Deployment

If your existing deployment ran without `API_SECRET` before upgrading, choose one of two paths:

1. **Use the auto-generated secret:** Pull and restart the updated image, run `docker compose exec backend cat /app/data/.api-secret`, and enter that secret once in the Web UI / Desktop **Backend Settings → API Secret**.
2. **Pin your own secret (recommended):** Generate a strong secret (e.g., `openssl rand -hex 32`), add `API_SECRET=<secret>` to `.env`, restart with `docker compose up -d`, and enter the same secret in your clients.

> [!NOTE]
> If the `/app/data` directory is read-only or `.api-secret` is empty/unreadable, the backend falls back to a temporary per-process in-memory secret (which changes on every restart) instead of crash-looping. Fix volume permissions or set `API_SECRET` explicitly to keep clients connected across restarts.

---

## Environment Variables

### Backend & Full-Stack Runtime

| Variable | Split Backend | Full-Stack | Default | Description |
|---|---|---|---|---|
| `API_SECRET` | Optional *(auto-generated)* | **Required** in Compose | Auto-generated in `data/.api-secret` | Bearer token protecting `/api/*` (except `/api/health`). If unset in standalone/split mode, generated once and persisted to `/app/data/.api-secret`. Required by `docker-compose.fullstack.yml`. |
| `ALLOW_INSECURE_NO_AUTH` | Optional | Not recommended | unset | Set to `1` or `true` (case-insensitive) to disable `/api` auth when `API_SECRET` is unset (local dev only). Logs a loud warning. |
| `ENCRYPTION_KEY` | Optional | Optional | Auto-generated in `data/.encryption-key` | AES-256 key encrypting stored secrets (GitHub token, AI keys, WebDAV passwords, MCP token). Accepts 64-char hex as-is, or any other string (normalized to 32 bytes via SHA-256). Env var overrides the file key. |
| `PORT` | Optional | Optional | `3000` | Internal Node/Express listening port (`docker-compose.fullstack.yml` maps host `8080:3000`). |
| `DB_PATH` | Optional | Optional | `data/data.db` (`/app/data/data.db`) | Default-profile SQLite database path. Multi-account profile DBs are stored in `<dirname(DB_PATH)>/profiles/<profileId>.db`. |
| `TRUST_PROXY` | Set to `1` in Compose | Optional (`false`) | `false` | Express `trust proxy` setting (`true`, `false`, hop count like `1`, or proxy IP/subnet). Set to `1` when behind Nginx/Caddy/Traefik so rate limiting sees real client IPs. |
| `CSP_UPGRADE_INSECURE_REQUESTS` | Optional | Default `true` in Compose | `true` | Controls Helmet's `upgrade-insecure-requests` CSP directive. Set to `false`, `0`, or `no` for direct plain-HTTP LAN access without a TLS reverse proxy. |
| `CSP_CONNECT_SRC` | Optional | Optional | Built-in allowlist | Comma-separated extra origins appended to CSP `connect-src` for browser-direct mode (e.g., custom AI proxies or Cloudflare Worker URLs). Built-in origins include `'self'`, GitHub API/raw/gist, GitHubTrendingRSS, OpenAI, and Gemini. |
| `STATIC_DIR` | Unset | `/app/public` *(built-in)* | unset | Directory of compiled SPA assets served by Express. Set automatically in `Dockerfile.fullstack`; leave unset for API-only backend. |
| `NODE_ENV` | Optional | `production` *(built-in)* | `development` | When `production`, hides error stack traces in API responses. |

### Frontend Nginx & Compose Tag Variables

| Variable | Applies To | Default | Description |
|---|---|---|---|
| `BACKEND_HOST` | Split Frontend (`Dockerfile`) | `backend:3000` | Upstream `host:port` that Nginx proxies `/api/`, `/mcp`, `/mcp/`, `/sse`, and `/messages` to. |
| `RESOLVER` | Split Frontend (`Dockerfile`) | `127.0.0.11` | DNS resolver used by Nginx for runtime upstream resolution (Docker embedded DNS; override in Kubernetes/ECS). |
| `BACKEND_IMAGE_TAG` | `docker-compose.yml` | `latest` | Backend image tag (e.g., `0.9.1`). |
| `FRONTEND_IMAGE_TAG` | `docker-compose.yml` | `latest` | Frontend image tag (e.g., `0.9.1`). |
| `IMAGE_TAG` | `docker-compose.fullstack.yml` | `latest` | Full-stack image tag (e.g., `0.9.1`). |

---

## Multi-Account & MCP Server

### Multi-Account Backend Isolation

GithubStarsManager supports switching between multiple GitHub accounts with full storage-boundary isolation:

- **Default account** continues using `/app/data/data.db` with zero overhead and no migration required.
- **Additional accounts** are routed to isolated SQLite databases at `/app/data/profiles/<profileId>.db` (valid profile IDs match `^p_[a-z0-9_-]{1,32}$`).
- **API profile routing:** Clients send the `X-GSM-Profile: <profileId>` header on `/api/*` requests. Missing, empty, or `default` targets `data.db`; invalid IDs return `400 INVALID_PROFILE_HEADER`.
- **Profile management endpoints** (protected by `API_SECRET`):
  - `GET /api/profiles` — lists secondary profile databases and stored GitHub user metadata
  - `DELETE /api/profiles/:id` — safely closes and removes `profiles/<id>.db` (plus `-wal`/`-shm`); returns `409 PROFILE_IN_USE` if requests are active
- **Connection pool:** The server manages secondary profile DBs in an LRU pool (up to 16 open handles) with reference-counted idle eviction so active requests are never interrupted.

### MCP Server (AI Agent Access)

Both Split Compose (proxied via Nginx) and Full-Stack Compose (served directly by Express) expose the exact same MCP URLs on port `8080` — no extra backend port needs to be published:

| Transport | Docker URL (Split & Full-Stack) | Desktop (Electron) URL | Notes |
|---|---|---|---|
| **Streamable HTTP** *(recommended)* | `http://localhost:8080/mcp` | `http://127.0.0.1:3927/mcp` | Stateless POST-only (`GET`/`DELETE` return `405`). Preferred for Claude Code & modern clients. |
| **Legacy SSE** | `http://localhost:8080/mcp/sse` | `http://127.0.0.1:3927/sse` | `GET` opens `text/event-stream`; `POST` messages to `/mcp/sse/messages?sessionId=…`. |
| **Legacy SSE (alias)** | `http://localhost:8080/sse` | `http://127.0.0.1:3927/sse` | Backward-compatible alias; `POST` messages to `/messages?sessionId=…`. |

#### Multi-Account MCP Profile Routing

Each account profile has its own SQLite database, its own **Enable MCP Server** toggle, and its own encrypted `mcp_token`. To target a secondary account from an MCP client, pass either:

- **Query parameter:** `http://localhost:8080/mcp?profile=p_<id>` (also supported on `/mcp/sse?profile=p_<id>` and `/sse?profile=p_<id>`)
- **HTTP header:** `X-GSM-Profile: p_<id>` *(takes precedence over `?profile=` if both are sent)*

#### Setup Steps

1. Open the app → switch to the target GitHub account → go to **Settings → MCP Server**.
2. Toggle **Enable MCP Server** (requires a connected backend).
3. Copy the token and ready-to-paste agent JSON config (for secondary accounts, the UI automatically includes `?profile=<id>` in the URL).
4. Paste into Claude Code, Cursor, or another MCP client:

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

For a secondary account profile (either `?profile=<id>` in the URL or `X-GSM-Profile` in `headers`):

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
> - **Separate credentials:** MCP uses its own `mcp_token` (`Authorization: Bearer …` or `X-MCP-Token: …`), independent from `API_SECRET`. Resetting the MCP token will not break app↔backend sync.
> - **Stable token:** Encrypted in that profile's SQLite DB (`mcp_token`), minted once on first enable, and only changes if you click **Reset Token**.
> - **Fail-closed profile lookup:** Requesting a non-existent profile DB returns `404` (`MCP_DISABLED`) without creating phantom `.db` files; invalid profile IDs return `400`.
> - **Dynamic tools:** `gsm_vector_search` is advertised only when Vector Search is configured and enabled for that profile. Pure frontend deployments (no backend) hide the MCP settings page.

---

## Data Persistence, Backup & Migration

### What Lives in `/app/data`

Always mount a persistent volume at `/app/data`. Inside this volume, the backend stores:

| Path inside `/app/data` | Purpose |
|---|---|
| `data.db` *(+ `-wal`, `-shm`)* | Default account SQLite database (stars, summaries, tags, settings, encrypted credentials, MCP token) |
| `profiles/p_<id>.db` *(+ `-wal`, `-shm`)* | Isolated SQLite databases for additional multi-account profiles |
| `.encryption-key` | Auto-generated AES-256 key (`0600`) used when `ENCRYPTION_KEY` env var is unset |
| `.api-secret` | Auto-generated API secret (`0600`) used when `API_SECRET` env var is unset |

> [!WARNING]
> **Back up `/app/data/.encryption-key` (or your `ENCRYPTION_KEY` env var)!** Both your SQLite databases and `.encryption-key` live on the same volume. If you lose the key—or pass a different `ENCRYPTION_KEY` env var when recreating/migrating—all encrypted credentials (GitHub token, AI keys, WebDAV passwords, MCP tokens) become unreadable. Note that an explicit `ENCRYPTION_KEY` environment variable always overrides the `.encryption-key` file.

### Backing Up the Data Volume

Stop all SQLite writers first (without `-v`!) so WAL/journal files are flushed cleanly:

```bash
# Find your volume name (typically <project-name>_backend-data for Compose)
docker volume ls

# Stop containers without deleting the volume
docker compose down

# Create a portable archive of databases, profiles/, .encryption-key, and .api-secret
docker run --rm \
  -v <existing-backend-data-volume>:/data:ro \
  -v "$PWD":/backup \
  alpine tar czf /backup/github-stars-manager-data-backup.tgz -C /data .
```

### Migrating Split Compose → Full-Stack Single Container

Migration is completely **optional** — both Compose files declare the same `backend-data` volume key, so running from the same directory (and same `-p <project-name>`, if used) reuses all existing databases, secondary profiles, and keys automatically.

1. **Stop the split stack and back up the volume** (never pass `-v`):
   ```bash
   docker compose down
   # Custom project name: docker compose -p <project-name> down

   docker run --rm \
     -v <existing-backend-data-volume>:/data:ro \
     -v "$PWD":/backup \
     alpine tar czf /backup/github-stars-manager-data-backup.tgz -C /data .
   ```
2. **Prepare `.env`:**
   - Copy your existing `API_SECRET` unchanged (or if the old split backend used auto-generated `.api-secret`, copy its value into `API_SECRET=` in `.env`; if it had no auth previously, generate a strong new `API_SECRET` and update your clients after cutover).
   - If the old service explicitly set `ENCRYPTION_KEY`, copy the **exact same value** into `.env`.
   - Optionally set `IMAGE_TAG=0.9.1`.
3. **Start the full-stack container** using the same directory / project name:
   ```bash
   docker compose -f docker-compose.fullstack.yml up -d
   # Custom project name: docker compose -p <project-name> -f docker-compose.fullstack.yml up -d
   ```
4. **Verify** health, UI, synced repos/profiles, and MCP:
   ```bash
   curl http://localhost:8080/api/health
   ```

### Rolling Back to Split Compose

Stop the full-stack container (without `-v`) and bring the split stack back up:

```bash
# If started with Compose:
docker compose -f docker-compose.fullstack.yml down
# Custom project name: docker compose -p <project-name> -f docker-compose.fullstack.yml down

# If started with direct docker run (use instead of Compose down):
# docker stop github-stars-manager-fullstack && docker rm github-stars-manager-fullstack

# Restore Split Compose:
docker compose up -d
# Custom project name: docker compose -p <project-name> up -d
```

---

## CORS, Stopping & Desktop Compatibility

- **CORS & Proxy Headers:** In Split mode, Nginx proxies `/api/`, `/mcp`, `/mcp/`, `/sse`, and `/messages` to `BACKEND_HOST` and adds CORS headers for static routes. In Full-Stack mode, Express serves the SPA and API from the same origin and sets Helmet CSP (`CSP_CONNECT_SRC` can extend browser-direct origins for custom AI/Worker endpoints).
- **Stopping Containers** *(never add `-v` unless you intend to permanently erase `/app/data`)*:
  ```bash
  # Split Compose
  docker compose down

  # Full-Stack Compose
  docker compose -f docker-compose.fullstack.yml down

  # Standalone docker run containers
  docker stop github-stars-manager-fullstack && docker rm github-stars-manager-fullstack
  docker stop github-stars-backend && docker rm github-stars-backend
  ```
- **Desktop Packaging:** Docker deployment files and workflows are completely independent of the Electron desktop packaging pipeline.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| **`401` / `AUTH_NOT_CONFIGURED`** after upgrading | Auth hardening auto-generated `/app/data/.api-secret` because `API_SECRET` was unset | Run `docker compose exec backend cat /app/data/.api-secret` and enter it in client **API Secret**, or set `API_SECRET` explicitly in `.env` and restart. |
| **Blank page** over `http://<LAN-IP>:8080` in Full-Stack mode | Helmet's `upgrade-insecure-requests` rewrites `http://` assets to `https://` | Set `CSP_UPGRADE_INSECURE_REQUESTS=false` in `.env` (or `-e`) when accessing directly over plain HTTP without a TLS reverse proxy. |
| **Browser-direct AI or Vector Worker requests blocked by CSP** | Custom endpoint origin not in default `connect-src` allowlist | Set `CSP_CONNECT_SRC=https://your-ai-proxy.example.com,https://your-worker.workers.dev` on the backend/full-stack container. |
| **Full-Stack Compose refuses to start** (`Set API_SECRET in .env...`) | `docker-compose.fullstack.yml` enforces non-empty `API_SECRET` | Add `API_SECRET=<long-random-secret>` to `.env` in the same directory before running `docker compose -f docker-compose.fullstack.yml up -d`. |
| **Stored tokens/keys unreadable after recreate or migration** | `ENCRYPTION_KEY` changed or `/app/data/.encryption-key` was lost | Restore `/app/data/.encryption-key` from backup, or pass the exact previous `ENCRYPTION_KEY` value. |
| **MCP returns `404` (`MCP_DISABLED`) for a secondary account** | MCP is disabled for that profile, or `?profile=<id>` doesn't match an existing profile DB | Switch to that account in the app → **Settings → MCP Server**, enable MCP, and copy the generated URL (`?profile=p_…`) and profile-specific token. |
| **`denied` when pulling GHCR images** | Package visibility or stale registry credentials | Run `docker login ghcr.io -u YOUR_GITHUB_USERNAME` with a PAT containing `read:packages`. |
