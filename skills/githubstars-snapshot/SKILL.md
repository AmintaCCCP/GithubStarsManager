# GitHub Stars Snapshot Skill

Use the local snapshot helper tool for low-risk repository automation against the client-maintained snapshot layer.

## Scope
- Search repositories from local snapshot data
- Set repository category
- Add repository tags
- Answer repo questions with progressive disclosure

## Progressive disclosure
1. Read local snapshot data first
2. If insufficient, read repository README
3. If still insufficient, inspect repository code

## Tool script
- `./scripts/githubstars-snapshot-tool.mjs`

## Commands
- `node ./skills/githubstars-snapshot/scripts/githubstars-snapshot-tool.mjs search "mcp server" --snapshot <path>`
- `node ./skills/githubstars-snapshot/scripts/githubstars-snapshot-tool.mjs category set --repo owner/name --category ai-tools --snapshot <path>`
- `node ./skills/githubstars-snapshot/scripts/githubstars-snapshot-tool.mjs tags add --repo owner/name --tags mcp,agent --snapshot <path>`

## Notes
- Prefer snapshot-backed answers over network/API calls when possible
- Use `--dry-run` for non-destructive previews when appropriate
- The client should keep a stable snapshot mirror for agent-side consumption
- This is a lightweight local helper script, not a separately distributed CLI
