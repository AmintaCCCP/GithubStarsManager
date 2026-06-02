# Docker Deployment

This application can be deployed using Docker with minimal configuration. The Docker setup serves the static frontend files via Nginx and handles CORS properly.

## Prerequisites

- Docker installed on your system
- Docker Compose (optional, but recommended)

## Quick Start (Using Pre-built Images from GHCR)

The fastest way to get started — no build required:

```bash
# Pull the latest backend image
docker pull ghcr.io/amintacccp/github-stars-manager-server:latest

# Using Docker Compose (pulls images automatically)
docker-compose up -d

# The application will be available at http://localhost:8080
```

Available image tags:
- `latest` — latest build from the `main` branch
- `v0.6.2`, `0.6.2` — specific version tags
- `sha-abc1234` — specific commit builds

## Building Locally with Docker

### Using Docker Compose (local build)

Edit `docker-compose.yml` — comment out the `image:` line and uncomment `build: ./server`, then:

```bash
docker-compose up -d --build

# The application will be available at http://localhost:8080
```

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

## Configuration

No special configuration is needed for the Docker container itself. All application settings (API URLs, credentials, etc.) are configured through the application UI.

## Environment Variables

While not required, you can pass environment variables to the container if needed:

```bash
docker run -d -p 8080:80 -e NODE_ENV=production --name github-stars-manager github-stars-manager
```

## Stopping the Container

```bash
# With Docker Compose
docker-compose down

# With Docker directly
docker stop github-stars-manager
docker rm github-stars-manager
```

## Note on Desktop Packaging

This Docker setup does not affect the existing desktop packaging workflows. The GitHub Actions workflow for building desktop applications remains unchanged and continues to work as before.