# UI preview

`.github/workflows/ui-preview.yml` shows reviewers what a pull request does to
the UI. When a commit touches UI code (or the PR carries the `ui-preview`
label), the workflow:

1. **detect** decides whether the commit has UI adjustments and maps them to
   the exact affected pages.
   - Non-UI paths (tests, docs, backend services, store persistence, types,
     non-UI utilities, and tooling configs such as `tsconfig.json`) are ignored.
     If no UI adjustments exist, `ui` is set to `false` and subsequent jobs are skipped.
   - On `synchronize` (new push), `detect` inspects the commit/push diff so
     commits that don't adjust the UI don't trigger unnecessary runs.
   - Changed files are mapped to the affected scenes with page granularity:
     - each Settings panel component maps to its own Settings tab scene
       (`settings-general`, `settings-appearance`, `settings-plugins`, … — one
       scene per tab, 15 in total);
     - example plugin UI/manifest changes map to that plugin only
       (`plugin:<slug>`, expanded by shoot.mjs into one screenshot per
       contributed page); plugin host code (`src/plugins/`,
       `src/features/plugins/`) maps to the Plugins settings tab plus the
       repository list where plugin actions render;
     - changed locale files are content-diffed between base and head: only the
       top-level keys that actually changed are mapped, so a string addition
       for one panel no longer shoots every view. Keys that cannot be placed
       fall back conservatively to their namespace's scope;
     - i18n module wiring (`src/i18n/*.ts`) is content-diffed too: a change
       confined to desktop-bridge lines (`desktopBridge`/`electronProxy`,
       bare braces) renders nothing in the web preview — the web bundle's
       `desktopBridge` no-ops every method outside Electron — so such a diff
       is inert (a desktop-only tray/language sync change shoots nothing
       instead of every page). Any other wiring change still triggers all
       scenes, because boot-time language resolution could re-render anything;
     - changes to global elements (`App.tsx`, `Header.tsx`,
       `WorkspacePageHeader.tsx`, shared UI primitives under
       `src/components/ui/`, `src/lib/utils.ts`, theme tokens, or
       styling/bundling configs like `tailwind.config.js`, `postcss.config.js`,
       and `vite.config.ts`) trigger all view + settings scenes. Plugin pages
       are standalone documents and are only shot when their own files changed;
     - store slices / state containers are "deferred": when components change
       in the same PR the components decide the scenes; a state-only diff
       falls back to all scenes. The same policy governs conditional overlays
       (update dialogs/banners, dialog shells, error boundaries, hover
       tooltips, scroll affordances, markdown renderers) — they render only on
       runtime state the demo never provides, so a default-page screenshot
       would show no difference. Settings feature hooks are deferred too: a
       hook follows the panel that invokes it.
     - the login page has its own scene (`login`, seeded logged out); it
       renders instead of the app shell, so global chrome changes do not
       reach it and it is only shot when login-specific files change. Because
       `GitHubTokenPermissions` reads the `login` namespace in both hosts,
       `login.json` changes also map to the settings token-guide dialog and
       both interaction variants.
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
view has a scene, every Settings tab has its own scene (navigated via the
`gsm:pending-settings-tab` sessionStorage key the panel reads on mount), and
every example plugin page can be shot through the `plugin:<slug>` spec, which
shoot.mjs resolves against the plugin manifest in the built bundle:

```js
const VIEW_SCENES = [
  { name: 'repositories-light', currentView: 'repositories', themeMode: 'light' },
  { name: 'repositories-dark', currentView: 'repositories', themeMode: 'dark' },
  { name: 'gists', currentView: 'gists', themeMode: 'light' },
  { name: 'releases', currentView: 'releases', themeMode: 'light' },
  { name: 'forks', currentView: 'forks', themeMode: 'light' },
  { name: 'discovery', currentView: 'subscription', themeMode: 'light', selectedDiscoveryChannel: 'trending', settleMs: 4000 },
];
// Settings scenes are generated from SETTINGS_TABS in detect.mjs: one scene
// per tab (settings-general, settings-appearance, …, settings-mcp). The
// Electron-only tabs (network, plugins, mcp) render behind a minimal
// window.electronAPI stub whose plugin registry is built from the manifests
// in the served bundle (dist/plugins/index.json, emitted by the build job).
```

### Interaction variants

Some changed UI is invisible in a default render: dialogs and sheets are
closed, tabs sit on their default selection. `SCENE_VARIANTS` in detect.mjs
names such states as extra scene specs (`<scene>-<name>`); `COMPONENT_VARIANTS`
maps the components that render only inside those states to their specs, and
`VARIANT_ACTIONS` in shoot.mjs holds the open recipe (one or more clicks, a
readiness wait). After the base scene's screenshot, shoot.mjs applies the
recipe in the same browser context and takes one more shot. Variants never
trigger through `global` expansion, and a variant that cannot reach its state
is skipped with a warning while the base screenshot still publishes.

Covered states (the click target is resolved from the built bundle's zh locale
where possible, so renamed strings keep working):

| Variant spec | State |
|---|---|
| `settings-general-token-guide` | Token-guide dialog (General tab) |
| `login-token-finegrained` | Token permissions' fine-grained tab (login) |
| `settings-plugins-marketplace` | Plugin marketplace dialog |
| `settings-plugins-sources` | Plugin sources dialog (chained on the open marketplace) |
| `settings-plugins-icon-picker` | Plugin icon picker (first installed plugin) |
| `settings-star-sync-push-modal` | Push-categories modal |
| `settings-ai-config-form` | AI provider add/edit form |
| `settings-webdav-config-form` | WebDAV add/edit form |
| `settings-vector-search-deploy-guide` | Deploy guide expanded + manual tab |
| `repositories-edit-modal` | Edit-repository modal (first card) |
| `repositories-release-sheet` | Release sheet (first card) |
| `repositories-release-sheet-notes` | Release sheet's notes tab |
| `repositories-chat-sheet` | Repository chat sheet (first card) |
| `repositories-chat-history-sheet` | Global chat history sheet |
| `repositories-readme-modal` | Readme modal (first card body click) |
| `repositories-category-edit-modal` | Add-category modal (sidebar) |
| `repositories-batch-star-import` | Batch star import dialog |
| `gists-gist-detail` | Gist detail modal (first gist card) |
| `gists-new-gist` | New-gist editor |
| `releases-filter-modal` | Asset filter modal (new filter) |
| `releases-source-settings` | Release source settings modal |

Deliberately NOT covered, and why: destructive confirmations (plugin
uninstall, data deletion, WebDAV/category deletes, unstar, plugin enable —
generic shells with interpolated or gated triggers; their confirm buttons are
never auto-clicked); state-gated overlays (update dialog, sync-mode choice,
login conflict, import preview — they open only on runtime state the demo
never provides, consistent with the deferred policy); selection-gated bulk
modals (need multi-select plus a double-click-to-confirm toolbar);
discovery channel-gated settings and feed-item modals (triggers render only
on non-default channels); the diagnostic-log detail modal (the fixture has no
log entries); `SearchShortcutsHelp` (dead code, no instantiation).

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
cp -r src/locales dist/locales
if [ -d examples/plugins ]; then
  mkdir -p dist/plugins && cp -r examples/plugins/. dist/plugins/
  node -e "const fs=require('node:fs');fs.writeFileSync('dist/plugins/index.json',JSON.stringify(fs.readdirSync('examples/plugins',{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name).sort())+'\n')"
fi
npx vite preview --host 127.0.0.1 --port 4173 &

# 2. Install the pipeline deps (from this directory)
cd .github/ui-preview && npm ci && npx playwright install chromium

# 3. Shoot (add --only settings-plugins,plugin:repo-info-card to limit scenes;
#    variant specs like settings-general-token-guide shoot their base scene
#    plus the driven state)
node shoot.mjs --url http://127.0.0.1:4173 --out /tmp/ui-shots
```

## Mapping experiments

`experiment.mjs` probes the mapping the way a reviewer would: it applies a
minimal synthetic change to EVERY UI-relevant file (and to every top-level
locale key, one at a time) in the working tree, runs the real detect pipeline
on each probe, and compares the resulting scene set with the consumers of the
changed file/key. Use it to validate new mapping rules before shipping them:

```sh
node experiment.mjs                 # full matrix (file probes + locale key probes)
node experiment.mjs --only Update   # only targets matching the filter
```

The probe changes are reverted automatically; run it on a clean tree.

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
