# Docker Deployment

This application can be deployed using Docker with minimal configuration. The Docker setup serves the static frontend files via Nginx and handles CORS properly.

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

Available image tags:
- `latest` — latest build from the `main` branch
- `v0.6.2`, `0.6.2` — specific version tags
- `sha-abc1234` — specific commit builds

To pin a specific version in `docker-compose.yml`, set `BACKEND_IMAGE_TAG` in your `.env` file:

```bash
BACKEND_IMAGE_TAG=v0.6.2
```

## Backend Server (docker run)

The backend image is published to GHCR and can be run standalone:

```bash
# Basic — no auth, port 3000, data persisted in volume
docker run -d \
  --name github-stars-backend \
  -v github-stars-data:/app/data \
  -p 3000:3000 \
  ghcr.io/amintacccp/github-stars-manager-server:latest

# With custom API secret and encryption key
docker run -d \
  --name github-stars-backend \
  -v github-stars-data:/app/data \
  -p 3000:3000 \
  -e API_SECRET="your-secret-here" \
  -e ENCRYPTION_KEY="your-encryption-key" \
  ghcr.io/amintacccp/github-stars-manager-server:latest

# Map to a different host port (e.g. 8080)
docker run -d \
  --name github-stars-backend \
  -v github-stars-data:/app/data \
  -p 8080:3000 \
  -e API_SECRET="your-secret-here" \
  ghcr.io/amintacccp/github-stars-manager-server:latest
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_SECRET` | No | `null` (auth disabled) | Bearer token for API authentication |
| `ENCRYPTION_KEY` | No | Auto-generated (saved to `data/.encryption-key`) | AES-256 key for encrypting stored secrets. Accepts any format — 64-char hex, shorter hex, base64, or plain text (all normalized via SHA-256) |
| `PORT` | No | `3000` | Server listening port |
| `DB_PATH` | No | `data/data.db` | Path to SQLite database file |

> **Note:** The data volume (`/app/data`) stores both the database and the auto-generated encryption key. Always mount it to persist data across container restarts.

## Full Stack with Docker Compose

`docker-compose.yml` runs both frontend and backend:

```bash
docker-compose up -d
```

To customize secrets, create a `.env` file in the project root:

```bash
API_SECRET=my-strong-secret
ENCRYPTION_KEY=my-encryption-key
BACKEND_IMAGE_TAG=v0.6.2    # pin backend image version (default: latest)
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

```bash
# Build the image
docker build -t github-stars-manager .

# Run the container
docker run -d -p 8080:80 --name github-stars-manager github-stars-manager

# The application will be available at http://localhost:8080
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