# Docker Deployment

This application can be deployed using Docker with minimal configuration. Existing deployments use separate frontend and backend containers; an additional opt-in full-stack image is available for users who prefer a single container. The existing images and `docker-compose.yml` remain supported and unchanged.

## Prerequisites

- Docker installed on your system
- Docker Compose (optional, but recommended)

## Quick Start (Using Pre-built Images from GHCR)

The fastest way to get started — no build required:

```bash
# Using Docker Compose (pulls images automatically)
docker-compose up -d

# The application will be available at http://localhost:8080
```

> **Note:** If the GHCR package is set to private, you must authenticate before pulling:
> ```bash
> docker login ghcr.io -u YOUR_GITHUB_USERNAME
> ```
> Use a [Personal Access Token](https://github.com/settings/tokens) (with `read:packages` scope) as the password.

Available image tags (all role-specific images share the same tagging scheme):
- `latest` — latest build from the `main` branch
- `v0.7.8` — the exact release tag; it must match the root `package.json` client version
- `0.7.8`, `0.7`, `0` — convenience semver tags derived from the same `v0.7.8` release
- `sha-abc1234` — specific commit builds

The root `package.json` is the single version source for desktop clients and Docker releases. A release workflow rejects a Git tag unless it is exactly `v` plus that file's `version`, so matching release image tags and client versions are published together.

Published images:
- Frontend: `ghcr.io/amintacccp/github-stars-manager-frontend`
- Backend (canonical): `ghcr.io/amintacccp/github-stars-manager-backend`
- Full stack (optional): `ghcr.io/amintacccp/github-stars-manager-fullstack`
- Backend legacy compatibility alias: `ghcr.io/amintacccp/github-stars-manager-server`

The `-frontend`, `-backend`, and `-fullstack` names identify the image role consistently. The existing `-server` backend alias continues to receive the same tags so current `docker-compose.yml` and direct `docker run` deployments remain unchanged.

## Optional Single-Container Full-Stack Deployment

The full-stack image is an additional deployment option. It runs one Node/Express process that serves the web application, `/api`, and MCP endpoints from the same origin. It does **not** replace the standalone backend image, frontend image, or existing `docker-compose.yml` workflow.

Use the dedicated Compose file for the simplest setup. Before starting, create a `.env` file with an API secret; the full-stack Compose file refuses to start without it so a new network-facing deployment is not accidentally unauthenticated.

```bash
API_SECRET=replace-with-a-long-random-secret
# Optional: set this to keep a chosen encryption key rather than generating one in the data volume.
# ENCRYPTION_KEY=replace-with-your-encryption-key

# This leaves docker-compose.yml unchanged for existing deployments.
docker compose -f docker-compose.fullstack.yml up -d

# Open the application at http://localhost:8080
curl http://localhost:8080/api/health
```

You can also run the full-stack image directly. The data volume stores SQLite data and an automatically generated encryption key, so keep the `-v` option when upgrading or recreating the container. A direct `docker run` does not load Compose's `.env` file; export `IMAGE_TAG` (or replace it inline) to pin the image version.

```bash
# Set this to 0.7.8 for a version-pinned deployment, or latest for main.
export IMAGE_TAG=0.7.8

docker run -d \
  --name github-stars-manager-fullstack \
  -p 8080:3000 \
  -v github-stars-data:/app/data \
  -e API_SECRET="your-secret-here" \
  ghcr.io/amintacccp/github-stars-manager-fullstack:${IMAGE_TAG}
```

For a new deployment, omit `ENCRYPTION_KEY` and the service generates a key in the persisted data volume. If an existing deployment already uses `ENCRYPTION_KEY`, always pass the **exact same value** on every recreation and during migration; an environment-provided key overrides the file key, and changing it makes already encrypted credentials unreadable.

For Compose deployments, add `IMAGE_TAG` to the same `.env` file to pin a full-stack version:

```bash
API_SECRET=replace-with-a-long-random-secret
IMAGE_TAG=0.7.8
# Set this only when preserving an existing environment-provided key.
# ENCRYPTION_KEY=the-exact-existing-key
```

### Migrate an Existing Docker Compose Deployment

Migration is optional. Existing frontend-plus-backend deployments continue to work and require no action. If the current backend has an `API_SECRET`, preserve the exact value in the full-stack `.env`; this keeps current browser, API, and MCP clients authenticated without reconfiguration. If the existing backend has no `API_SECRET`, generate a strong new value in the full-stack `.env` and configure every direct API and MCP client with it after cutover; the full-stack Compose file intentionally does not start unauthenticated. If the existing service explicitly sets `ENCRYPTION_KEY`, copy the **same value** into the full-stack `.env` as well. Replace `<existing-backend-data-volume>` with the volume name returned by `docker volume ls`; when Compose is run from this repository with its default project name, it normally ends in `_backend-data`.

```bash
# Stop all SQLite writers without deleting the named data volume.
# Default Compose project name:
docker compose down
# If you use a custom project name, use it for every command below instead:
# docker compose -p <project-name> down

# Create a portable backup only after the database is quiesced.
docker run --rm \
  -v <existing-backend-data-volume>:/data:ro \
  -v "$PWD":/backup \
  alpine tar czf /backup/github-stars-manager-data-backup.tgz -C /data .

# Copy the current API_SECRET into .env before startup; copy the same
# ENCRYPTION_KEY too when the old service set one explicitly.
# Reuse the same Compose project directory and volume name.
docker compose -f docker-compose.fullstack.yml up -d
# For a custom project: docker compose -p <project-name> -f docker-compose.fullstack.yml up -d

# Verify the UI, API, and persisted data.
curl http://localhost:8080/api/health
```

Both Compose files declare the same `backend-data` volume key. When they run from the same directory with the same Compose project name, the full-stack deployment reuses the existing SQLite database and `.encryption-key`. If you normally use `docker compose -p <project>`, pass the same `-p <project>` value for the migration command.

To roll back from a Compose deployment, stop the full-stack service and start the original split deployment again. If the full-stack service was created with direct `docker run`, stop and remove that container instead before starting Compose. Do not add `-v` to any of these commands, because that would delete the persisted data volume.

```bash
# Full-stack service started by Compose:
docker compose -f docker-compose.fullstack.yml down
# For a custom project: docker compose -p <project-name> -f docker-compose.fullstack.yml down

# Full-stack service started by direct docker run (use this instead of Compose down):
# docker stop github-stars-manager-fullstack
# docker rm github-stars-manager-fullstack

# Restore the existing split deployment.
docker compose up -d
# For a custom project: docker compose -p <project-name> up -d
```

To pin specific versions in `docker-compose.yml`, set `BACKEND_IMAGE_TAG` and/or
`FRONTEND_IMAGE_TAG` in your `.env` file:

```bash
BACKEND_IMAGE_TAG=0.7.8
FRONTEND_IMAGE_TAG=0.7.8
```

## Backend Server (docker run)

The backend image is published to GHCR and can be run standalone. New standalone deployments should use the canonical `-backend` image. The legacy `-server` image remains published with identical tags exclusively for existing `docker-compose.yml` and direct deployments, so no current user must change an image reference.

```bash
# Basic — no auth, port 3000, data persisted in volume
docker run -d \
  --name github-stars-backend \
  -v github-stars-data:/app/data \
  -p 3000:3000 \
  ghcr.io/amintacccp/github-stars-manager-backend:latest

# With custom API secret and encryption key
docker run -d \
  --name github-stars-backend \
  -v github-stars-data:/app/data \
  -p 3000:3000 \
  -e API_SECRET="your-secret-here" \
  -e ENCRYPTION_KEY="your-encryption-key" \
  ghcr.io/amintacccp/github-stars-manager-backend:latest

# Map to a different host port (e.g. 8080)
docker run -d \
  --name github-stars-backend \
  -v github-stars-data:/app/data \
  -p 8080:3000 \
  -e API_SECRET="your-secret-here" \
  ghcr.io/amintacccp/github-stars-manager-backend:latest
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_SECRET` | Optional for standalone backend | `null` (auth disabled) | Bearer token for API authentication. It is required by `docker-compose.fullstack.yml` so the new single-container web service cannot start unauthenticated. |
| `ENCRYPTION_KEY` | No | Auto-generated (saved to `data/.encryption-key`) | AES-256 key for encrypting stored secrets. Accepts any format — 64-char hex, shorter hex, base64, or plain text (all normalized via SHA-256) |
| `PORT` | No | `3000` | Server listening port |
| `DB_PATH` | No | `data/data.db` | Path to SQLite database file |

> **Note:** The data volume (`/app/data`) stores both the database and the auto-generated encryption key. Always mount it to persist data across container restarts.

## Full Stack with Docker Compose

`docker-compose.yml` runs both frontend and backend:

```bash
docker-compose up -d
```

To customize secrets and image versions, create a `.env` file in the project root:

```bash
API_SECRET=my-strong-secret
ENCRYPTION_KEY=my-encryption-key
BACKEND_IMAGE_TAG=0.7.8    # pin backend image version (default: latest)
FRONTEND_IMAGE_TAG=0.7.8   # pin frontend image version (default: latest)
# BACKEND_HOST=backend:3000 # target for the frontend's /api proxy (default: backend:3000)
```

Then `docker-compose up -d` reads them automatically.

## Building Locally with Docker

### Using Docker Compose (local build)

**Option A — Edit `docker-compose.yml` directly:**

Comment out the `image:` line and uncomment `build: ./server`, then:

```bash
docker-compose up -d --build
```

**Option B — Use an override file (no editing needed):**

Create `docker-compose.override.yml` in the project root:

```yaml
services:
  backend:
    build: ./server
```

Then run `docker-compose up -d --build`. The override file takes precedence automatically. To switch back to GHCR images, simply delete the override file.

> **Note:** Do NOT commit the override file to git — it would force local builds for all users.

### Using Docker directly (frontend only)

The pre-built frontend image is published to GHCR — no local build required:

```bash
# Pull the published image
docker pull ghcr.io/amintacccp/github-stars-manager-frontend:latest

# Run the container (point /api proxy at your backend)
docker run -d -p 8080:80 \
  -e BACKEND_HOST=host.docker.internal:3000 \
  --name github-stars-manager \
  ghcr.io/amintacccp/github-stars-manager-frontend:latest

# The application will be available at http://localhost:8080
```

> `BACKEND_HOST` sets the upstream the frontend proxies `/api/` to. In Docker Compose
> it defaults to `backend:3000`. When running standalone, point it at your backend's
> reachable address (e.g. `host.docker.internal:3000` on Docker Desktop, or the backend
> container's IP/host on a shared network).

To build the image locally instead (uses the repository `Dockerfile`):

```bash
docker build -t github-stars-manager .
docker run -d -p 8080:80 \
  -e BACKEND_HOST=host.docker.internal:3000 \
  --name github-stars-manager github-stars-manager
```

## CORS Handling

This Docker setup handles CORS in two ways:

1. **Nginx CORS Headers**: The Nginx configuration adds appropriate CORS headers to allow API calls to external services.

2. **Client-Side Handling**: The application is designed to work with any AI or WebDAV service URL configured by the user, without requiring proxying.

## Stopping the Container

```bash
# With Docker Compose
docker-compose down

# With Docker directly
docker stop github-stars-manager && docker rm github-stars-manager

# Stop backend only
docker stop github-stars-backend && docker rm github-stars-backend
```

## Note on Desktop Packaging

This Docker setup does not affect the existing desktop packaging workflows. The GitHub Actions workflow for building desktop applications remains unchanged and continues to work as before.
## MCP Server (Agent access)

With the existing Docker Compose deployment, the backend MCP endpoints are exposed through nginx (frontend container) so agents on the host do not need a published backend port. The optional full-stack Compose deployment exposes the same endpoint URLs directly from its single Node service:

| Endpoint | URL (default compose) | Notes |
|----------|------------------------|--------|
| Streamable HTTP | `http://localhost:8080/mcp` | Same URL for split Compose and optional full-stack Compose; preferred for Claude Code / modern clients |
| Legacy SSE | `http://localhost:8080/mcp/sse` | Same URL for split Compose and optional full-stack Compose; GET opens `text/event-stream`, then clients POST to `/mcp/sse/messages?sessionId=…` |
| Legacy SSE (alias) | `http://localhost:8080/sse` | Same protocol; messages at `/messages?sessionId=…` |

**Desktop (Electron)** after enabling MCP in Settings:

| Endpoint | URL |
|----------|-----|
| Streamable HTTP | `http://127.0.0.1:3927/mcp` |
| Legacy SSE | `http://127.0.0.1:3927/sse` (messages: `/messages?sessionId=…`) |

1. Open the app → **Settings → MCP Server**.
2. Toggle **Enable MCP Server** (requires backend connection).
3. Copy the token (always viewable) and the JSON agent config.
4. Paste into Claude Code / Cursor MCP settings, for example:

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

**Notes**

- MCP uses a **separate token** from `API_SECRET` (backend UI auth). Resetting the MCP token does not break app↔backend sync.
- The MCP bearer is **stable**: stored encrypted in SQLite (`mcp_token`) on the backend, and in IndexedDB with other app state on desktop. It is created once when you first enable MCP and **only changes if you click Reset Token**.
- Pure frontend (no backend) does not show the MCP settings page.
- `gsm_vector_search` appears only when Vector Search is configured and enabled in the app.
- Enabling MCP is additive: existing SQLite data is unchanged; disabling MCP only stops the endpoint.
