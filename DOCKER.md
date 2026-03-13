# Docker Deployment (Monolith)

GitHub Stars Manager is deployed as a single-container **Monolith**. The backend (Express) serves both the API and the static frontend UI.

## 🚀 Quick Start (Docker Hub)

The easiest way to run the application is to pull the pre-built image.

### Using Docker CLI

```bash
docker run -d \
  -p 8080:3000 \
  -v gsm-data:/app/data \
  --name gsm \
  banjuer/github-stars-manager:latest
```

### Using Docker Compose

```yaml
version: '3.8'
services:
  app:
    image: banjuer/github-stars-manager:latest
    ports:
      - "8080:3000"
    volumes:
      - gsm-data:/app/data
    restart: unless-stopped

volumes:
  gsm-data:
```

---

## 🛠 Advanced Usage

### Local Build

If you want to build the image yourself from source:

```bash
docker build -t github-stars-manager .
docker run -d -p 8080:3000 -v $(pwd)/data:/app/data github-stars-manager
```

### Persistence & Volumes

The application stores all data in a SQLite database located at `/app/data/data.db`.
- **Always** mount a volume to `/app/data` to ensure your library, users, and settings are preserved across container restarts.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Port internal to container (default: 3000). Usually mapped to 8080. |
| `ENCRYPTION_KEY` | 32-byte key for sensitive data (auto-generated if missing). |
| `DB_PATH` | Path to the SQLite DB file (default: `/app/data/data.db`). |

### Multi-Platform Support

The Docker Hub image (`banjuer/github-stars-manager`) is built for both `linux/amd64` and `linux/arm64` (Apple Silicon, Raspberry Pi, etc.).

---

## 🔒 Security

- **JWT Authentication**: The monolith handles session security via JWT.
- **First Run**: The first user to register becomes the **SuperAdmin**.
- **Container Isolation**: No external dependencies (like Nginx) are required as Express handles routing and static file serving.