# ADR 0001 — Frontend layering and dependency direction

Status: Accepted
Date: 2026-08-26
Supersedes: none
Applies to: `src/components/**`, `src/features/**`, `src/store/**`, `src/services/**`

## Context

PRs 0–8 of the architecture-tidy programme completed a non-breaking migration:
repository state transitions became pure commands under `src/features/repositories/application`,
`RepositoryCard` / `RepositoryList` operations moved into domain hooks under `src/features/*/hooks`,
settings controllers dissolved into `src/features/settings/hooks/*` action hooks, the monolithic
Store was modularized behind one persistence shell, and typed selectors plus a `useBackendLifecycle`
effect replaced ad-hoc whole-store subscriptions.

The migration is done, but nothing currently *enforces* it. A new component could tomorrow reach
straight back into `services/githubApi` and the linter would say nothing. This ADR records the
boundaries the migration established so they survive contributor turnover, and feeds the ESLint
rules and `scripts/check-boundaries.cjs` added in PR 9.

## Decision

The frontend is layered five tiers deep. A module may only import from a tier **below** it, never
above, and never sideways into a sibling feature's internals. Cross-feature coordination goes
through the Store, not direct imports.

```
┌─────────────────────────────────────────────────────────┐
│ View          src/components/**                          │  React, JSX, DOM. UI only.
│               renders, formats, forwards user intent      │  No business service imports.
├─────────────────────────────────────────────────────────┤
│ Hook /        src/features/*/hooks/**                     │  ViewModel + orchestration.
│ ViewModel     useRepositoryCardActions, useBackendSettings│  Calls business services, Store.
├─────────────────────────────────────────────────────────┤
│ Application    src/features/*/application/**             │  Pure state-transition commands.
│ command       repositoryPatches.ts                        │  No React, no JSX, no DOM.
├─────────────────────────────────────────────────────────┤
│ Service        src/services/**                            │  GitHub API, AI, vector, WebDAV,
│               githubApi, aiService, autoSync…             │  backendAdapter, rpcDownload…
├─────────────────────────────────────────────────────────┤
│ Store          src/store/**                               │  One persisted entry, slices,
│               useAppStore (+ slices/selectors)            │  selectors, normalizers.
└─────────────────────────────────────────────────────────┘
```

### Allowed dependency direction

| From → To        | View | Hook | Application | Service | Store |
|------------------|:----:|:----:|:----------:|:-------:|:-----:|
| **View**         |  ✓   |  ✓   |    ✗       |   ✗¹    |  ✓   |
| **Hook**         |  ✗   |  ✓²  |    ✓       |   ✓     |  ✓   |
| **Application**  |  ✗   |  ✗   |    ✗       |   ✗     |  ✗³  |
| **Service**      |  ✗   |  ✗   |    ✗       |   ✓⁴    |  ✓⁵  |
| **Store**        |  ✗   |  ✗   |    ✗       |   ✗     |  ✓   |

¹ Views must not import business services directly. The one carve-out is *infrastructure* that is
not business orchestration — `logger`, `isElectron`/`electronProxy`, `indexedDbStorage` — which
remain importable from anywhere because they are tools, not controllers. `updateService` /
`translateService` are business services and are *not* infrastructure.

² A hook may call another hook in its *own* feature, or a shared hook in `src/hooks/**`. Hooks
must not reach into another feature's `hooks/**` directory directly; cross-feature reads go
through Store selectors.

³ Application commands are pure `(state, input) => state` functions. They take a `Repository`
(or similar) and return a new one. They must not import React, JSX, `window`, `document`, the
Store, or any service — that is exactly the responsibility split the migration paid for.

⁴ Services may import other services (e.g. `autoSync` imports `githubApi`, `backendAdapter`).

⁵ Services may read Store state through `useAppStore.getState()` (non-reactive) but must not
subscribe reactively. This is the existing pattern; nothing changes here.

### Why one persisted Store is retained

The Store is split into *slices* for readability, but there is exactly **one** `create<AppStoreState>()(persist(...))`
shell in `src/store/useAppStore.ts`, one `appPersistenceOptions`, one `partialize` / `migrate` /
`merge`. Splitting persistence into per-slice stores would fragment the `migrate` chain that
upgrades `github-stars-manager` snapshots across versions, and would break the atomic hydration
`merge` performs. Slices contribute state+actions; persistence stays centralized. **Do not
introduce a second persisted store.** A slice that needs no persistence simply does not appear in
`partialize`.

### Safe data-migration rules (the migrate function)

`appPersistenceOptions.migrate` is the only path that transforms a persisted snapshot. When
adding or changing persisted fields:

1. Bump `version` exactly once, by one.
2. Make `migrate` **idempotent and total** — re-running `migrate(snapshot, version)` on an
   already-migrated snapshot must be a no-op, and any field that is missing/`undefined` must
   fall back to a default, never throw.
3. Never delete or rename a persisted key without a migrate step that rewrites old snapshots;
   orphaned keys break the contract for users who upgrade mid-stream.
4. Never widen `partialize` to include a key that was previously excluded (see `discoveryRepos`
   below) without the matching migrate step that strips it from old snapshots.

The modularization test (`src/store/useAppStore.modularization.test.ts`) freezes the
`version`/`partialize`/`migrate`/`merge` shape; a change to any of them must update that test in
the same PR.

### The v2 three persistence contracts

These three facts are load-bearing and must not drift; they are the "data does not get lost"
guarantee for the v2 backend/electron split.

| # | Contract | Where | Why |
|---|----------|-------|-----|
| 1 | `discoveryRepos` is **never persisted** | `partialize` omits it (the comment in `src/store/persistence/options.ts` next to the discovery block + the omitted key) | It is an extremely large JSON object. Re-fetching on load is cheaper than rehydrating megabytes from IndexedDB. Migrate must never add it to `partialize`. |
| 2 | `backendApiSecret` is stored in **three** places, by design | (a) `sessionStorage` key `github-stars-manager-backend-secret` via `readSessionBackendSecret`/`writeSessionBackendSecret`; (b) `localStorage` auth mirror `github-stars-manager-auth` via `writeAuthMirror`; (c) persisted in the IndexedDB snapshot via `partialize` | The session copy is the live source the UI reads first; the localStorage mirror survives a tab close to restore auth on reopen; the IndexedDB copy is the durable fallback when browsers block the other two. `migrate` v9→v10 initializes it to `null` for old snapshots. Do not collapse this into one location — each covers a failure mode the others don't. |
| 3 | Proxy and RPC download are **asymmetric** | `electronProxy` calls go through `window.electronAPI` (IPC to main process) for proxy set/get/test; `rpcDownloadService` calls go through HTTP `fetch` to either `http://host:port/jsonrpc` (direct) or `${backendBase}/settings/rpc-download/test` (backend-proxied) | The proxy is an Electron-only capability with no backend equivalent; RPC download works in both SPA and Electron via HTTP. They are not interchangeable. Do not route proxy calls through `fetch` or RPC calls through IPC to "unify" them — that removes a capability. |

### Infrastructure vs business service — the import carve-out

`no-restricted-imports` (PR 9) bans `src/components/**` from importing these **business services**:
`githubApi`, `aiService`, `aiAnalysisHelper`, `aiAnalysisOptimizer`, `vectorSearchService`,
`autoSync`, `webdavService`, `backendAdapter`, `rpcDownloadService`, `githubApiFactory`.

These remain importable from components because they are **tools, not orchestration**:
`logger`, `electronProxy` (`isElectron`), `indexedDbStorage`, `mcpElectronBridge`,
`aiRequestLimiter`, `discoveryAnalysisStorage`.

> Rule of thumb: if the module owns an async call to a remote system or mutates Store state, it is
> a business service and belongs behind a hook. If it is a sync utility (`logger`, `isElectron`,
> `indexedDBStorage`), it is infrastructure and may be imported anywhere.

This PR's ban list is the ten services above. Two further services — `updateService` and
`translateService` — are business services by the same rule (they make remote calls) but are
*not* banned in this PR; `BilingualMarkdownRenderer`, `UpdateChecker`, and
`UpdateNotificationBanner` still import them directly. They are phased out alongside the
component tail below. The ban list is deliberately the set the migration already covered;
expanding it is a follow-up PR, not this one.

### Phased enforcement

PR 4–8 migrated the high-traffic components (`RepositoryCard`, `RepositoryList`, the settings
panels, the timeline views). A snapshot at the `7337df0` baseline showed 33 components importing
services; after the migration that number is down, but a tail of components (e.g.
`SearchBar`, `ReadmeModal`, `LoginScreen`, `GistCard`, `ReleaseCard`, `SubscriptionRepoCard`,
`CategorySidebar`, `RepositoryEditModal`, `DebugModeIndicator`, `SettingsPanel`,
`ReleaseSourceSettingsModal`, `GistEditorModal`, `GistDetailModal`) still import business
services directly.

PR 9 enforces the rule only on **already-migrated** component directories and the
`src/components/ui/**` primitives (which should never touch a business service), and leaves the
un-migrated tail on an explicit allowlist for a later PR. One-shot banning all remaining imports
would light up a dozen files at once and force a rushed migration in a boundary-PR — exactly the
"don't mask 33 violations in one go" failure mode. The allowlist is the phasing mechanism; each
later PR that migrates a tail component also removes it from the allowlist.

## Consequences

- New components in migrated directories that try to import a business service fail lint **and**
  the `check-boundaries.cjs` CI step.
- New code in `src/features/*/application/**` that imports React/JSX/DOM fails the same gates.
- A reviewer can point at this ADR instead of re-arguing the layering on every PR.
- The allowlist is technical debt with an expiration date: each entry is a component that still
  needs its operations lifted into a `src/features/*/hooks/*` hook.

## Open issues / follow-up

- Migrate the allowlist tail components into hooks, one feature per PR, removing each from the
  allowlist as it lands. This ADR does not schedule that work; it only forbids *new* direct
  imports.
- If a future PR genuinely needs a component to call a business service (e.g. a throwaway debug
  component), the answer is a new hook in the right feature, not an `eslint-disable` comment.
