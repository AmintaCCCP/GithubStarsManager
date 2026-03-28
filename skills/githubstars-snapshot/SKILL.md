---
name: githubstars-snapshot
description: >
  Query, categorize, and tag your GitHub starred repositories using a local
  snapshot maintained by the GithubStarsManager desktop app. Use when: searching
  your GitHub stars for specific topics, answering questions about your own
  starred repos, organizing or labeling stars, finding repos by name/description/topic/language.
  Trigger phrases: "哪些仓库…", "有没有…", "我的stars里", "搜一下我的仓库", any question
  about the user's own GitHub starred repositories.
---

# GitHub Stars Snapshot

Query and manage your GitHub starred repositories via a local snapshot file maintained by the desktop app.

## Snapshot file location

The GithubStarsManager desktop app writes a snapshot to a fixed path. Pass this path to the tool with `--snapshot`:

**macOS:** `~/Library/Application Support/github-stars-manager-desktop/github-stars.snapshot.json`
**Linux:** `~/.config/github-stars-manager-desktop/github-stars.snapshot.json`
**Windows:** `%APPDATA%/github-stars-manager-desktop/github-stars.snapshot.json`

## Tool

**Script:** `./scripts/githubstars-snapshot-tool.mjs`

## Commands

```bash
# Search repositories (returns ranked results by relevance)
node ./scripts/githubstars-snapshot-tool.mjs search "mcp server" --snapshot ~/Library/Application\ Support/github-stars-manager-desktop/github-stars.snapshot.json

# Set a repository's category
node ./scripts/githubstars-snapshot-tool.mjs category set --repo owner/name --category ai-tools --snapshot <path>

# Add tags to a repository (comma-separated, duplicates are deduplicated)
node ./scripts/githubstars-snapshot-tool.mjs tags add --repo owner/name --tags mcp,agent --snapshot <path>

# Preview changes without writing (dry-run)
node ./scripts/githubstars-snapshot-tool.mjs tags add --repo owner/name --tags mcp,agent --snapshot <path> --dry-run
node ./scripts/githubstars-snapshot-tool.mjs category set --repo owner/name --category ai-tools --snapshot <path> --dry-run
```

## Workflow

1. **Find the snapshot file** — the desktop app maintains it at the paths above. If multiple platforms are in use, the snapshot lives in the user home of whichever machine ran the desktop app most recently.
2. **Search first** — always start with `search` to locate the target repository by name, topic, description, or language.
3. **Act if needed** — use `category set` or `tags add` to organize. Prefer `--dry-run` first to preview.
4. **Progressive disclosure** — if a search result's metadata is insufficient, the next step is reading the repository README, not the source code. Only escalate to code inspection when the question genuinely requires it.

## Snapshot schema

```json
{
  "version": 1,
  "exportedAt": "2026-03-29T00:00:00.000Z",
  "repositories": [
    {
      "id": 1,
      "name": "repo-name",
      "full_name": "owner/repo-name",
      "description": "What this repo does",
      "html_url": "https://github.com/owner/repo-name",
      "stargazers_count": 1234,
      "language": "TypeScript",
      "topics": ["mcp", "ai"],
      "ai_summary": "AI-generated description",
      "ai_tags": ["server", "agent"],
      "custom_tags": ["infra"],
      "custom_category": "ai-tools"
    }
  ],
  "categories": []
}
```

## Notes

- If the snapshot file does not exist yet, the desktop app has not been run or no repositories have been synced. Ask the user to open the app and sync their stars first.
- The `--snapshot` flag is required unless running from the repo root with a default path configured.
- The tool writes changes directly to the snapshot file. Use `--dry-run` to preview without modifying.
