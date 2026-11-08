# UI preview

`.github/workflows/ui-preview.yml` shows reviewers what a pull request does to
the UI. When a commit touches UI code (or the PR carries the `ui-preview`
label), the workflow:

1. **detect** decides whether the commit has UI adjustments and maps them to
   specific scenes.
   - Non-UI paths (tests, docs, backend services, store persistence, types,
     utils, and build configs) are ignored. If no UI adjustments exist, `ui` is
     set to `false` and subsequent jobs are skipped.
   - On `synchronize` (new push), `detect` inspects the commit/push diff so
     commits that don't adjust the UI don't trigger unnecessary runs.
   - Modified UI files are mapped to the affected views/scenes (`gists`,
     `releases`, `forks`, `discovery`, `settings`, plugin UI in `examples/plugins/**/ui/**` /
     `manifest.json` to `repositories-light`, `repositories-dark`, and `settings`).
     Changes to global elements (`App.tsx`, `Header.tsx`, global styles, primitives)
     trigger all scenes.
2. **build** checks out the PR and builds it with `npx vite build`; the
   static bundle is uploaded as an artifact. **shoot** then runs on a clean
   runner with zero PR code: it serves the downloaded bundle and runs
   `shoot.mjs` with `--only <scenes>` — Playwright loads only the affected
   scenes in fresh browser contexts seeded with demo data from
   `fixtures/demo-state.json` and takes 2x screenshots.
3. **publish** pushes the screenshots to the `ui-previews` branch under
   `pr-<n>/<sha>/` and upserts a single PR comment (located by the
   `<!-- ui-preview:begin -->` marker) embedding them. New commits replace the
   screenshots and refresh the same comment; a failed run updates the comment
   with a failure notice instead.

Every new commit that touches the UI re-runs only for the affected pages,
keeping comments concise and CI fast.

## Scenes

`shoot.mjs` renders one browser context per scene from the same base fixture,
overriding persisted store fields (`currentView`, `themeMode`, …). Every app
view has a scene; adding a screenshot is usually one line in `SCENES`:

```js
const SCENES = [
  { name: 'repositories-light', currentView: 'repositories', themeMode: 'light' },
  { name: 'repositories-dark', currentView: 'repositories', themeMode: 'dark' },
  { name: 'gists', currentView: 'gists', themeMode: 'light' },
  { name: 'releases', currentView: 'releases', themeMode: 'light' },
  { name: 'forks', currentView: 'forks', themeMode: 'light' },
  { name: 'discovery', currentView: 'subscription', themeMode: 'light', selectedDiscoveryChannel: 'trending', settleMs: 4000 },
  { name: 'settings', currentView: 'settings', themeMode: 'light' },
];
```

To change what the previews show, edit `fixtures/demo-state.json` — a plain
snapshot of the app's persisted state shape (repositories, gists, releases,
forks, starred gists, subscription status…). It contains no real credentials;
avatars are inline SVG data URIs so screenshots are fully hermetic.

Views that fetch on mount are kept offline by an in-page mock: `shoot.mjs`
answers `api.github.com` calls from the fixture (repo details, search, gists,
orgs) and the trending channel's RSS feed with generated XML, and aborts every
other external request. The seeded `githubToken` is a placeholder string that
never leaves the browser.

## Security model

- `pull_request_target` is required to cover fork PRs, so the pipeline is
  split three ways: **build** runs the PR's code (`npm ci`, `vite build`) and
  holds no secrets and no write permissions — its only output is the static
  web bundle; **shoot** never executes PR code (tools from the default
  branch, bundle from an artifact), so PR scripts cannot touch the recorder,
  its browser, or the screenshots; **publish** can write but only ever runs
  scripts from the default branch. Checking out the fork head needs
  `allow-unsafe-pr-checkout: true` (actions/checkout ≥ v7 refuses it
  otherwise); it is safe here precisely because the build job has nothing to
  steal and nothing it could modify.
- The shots directory is recreated empty on every run and `publish.mjs`
  accepts only file names shoot.mjs produces, verifies the complete PNG
  structure (chunk chain, CRCs, sane IHDR, IEND) and enforces per-file and
  total size limits before anything is committed or embedded in a comment.
- Screenshots live on the `ui-previews` branch (per PR only the latest
  commit's directory survives) and are referenced from the comment via
  `raw.githubusercontent.com`. Note the branch's git history still grows by
  one commit per publish; squash it occasionally if that ever matters.

## Manual runs

Re-run for an existing PR (requires the `ui-preview.yml` workflow to exist on
the default branch):

```sh
gh workflow run ui-preview.yml -f pr=<number>
```

Labeling a PR `ui-preview` also (re)triggers it even for non-UI changes.
Create the label once with:

```sh
gh label create ui-preview --description "Force the UI preview workflow" --color 0e8a16
```

## Run locally

```sh
# 1. Build and serve the app (from the repo root)
npx vite build
npx vite preview --host 127.0.0.1 --port 4173 &

# 2. Install the pipeline deps (from this directory)
cd .github/ui-preview && npm ci && npx playwright install chromium

# 3. Shoot (add --only gists,releases to limit scenes)
node shoot.mjs --url http://127.0.0.1:4173 --out /tmp/ui-shots
```

Screenshots land in `/tmp/ui-shots/<scene>.png`.

## Maintenance notes

- `seed.mjs` pins `PERSIST_VERSION = 16`, which must match `version` in
  `src/store/persistence/options.ts`. Bumping the app's persist version stays
  safe while the migrate chain covers 16 → latest (the app migrates the seeded
  legacy snapshot on first launch); prune this constant's history only if the
  migrate chain is ever rewritten.
- The seeding path writes the legacy single-key snapshot (IndexedDB key
  `github-stars-manager`, localStorage fallback), which the storage layer's
  hydrate path consumes when no shard meta exists — the same path an upgrade
  launch takes.
- CI installs `fonts-noto-cjk`; without it the Chinese UI renders as tofu
  boxes on ubuntu runners.
