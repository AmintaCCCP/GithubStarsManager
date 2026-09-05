# MCP discovery tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three deterministic read-only MCP discovery tools and candidate-set filters to `gsm_vector_search`, while keeping backend and Electron MCP surfaces aligned and preserving the local-first runtime boundaries.

**Architecture:** Keep the existing MCP registration, SQLite provider, Electron snapshot server, and Worker `/query` transport. Add bounded DB/snapshot discovery helpers, a cache-only release evidence projection, and local vector candidate filtering. The backend and Electron implementations mirror the same contracts; contract tests compare their listed tools and properties. No Worker, schema, Docker, tunnel, or vector-index code changes are allowed.

**Tech Stack:** TypeScript, Node.js, Express, SQLite via better-sqlite3, Zod MCP schemas, Electron CommonJS local MCP server, Vitest, existing Vite/TypeScript build.

**Spec:** `docs/superpowers/specs/2026-09-05-mcp-discovery-tools-design.md`

## Global Constraints

- Work only in the contribution workspace on branch `feat/mcp-discovery-tools`, based on upstream `7b9a622ee64dedfc73ddbbb93de9e7e4bc8b4ae5`.
- Do not modify the production Mirror, Worker, Docker, tunnel, Ollama, or production Stars database.
- Do not add a database migration, new dependency, remote GitHub fan-out, or second semantic engine.
- Do not write secrets, tokens, credentials, or machine-specific paths to tracked files.
- Every production behavior change follows a red → green → refactor test cycle.
- Keep the existing no-filter vector request/result behavior and Worker request contract unchanged.

---

## 1. Establish dependency/runtime baseline

**Files:** no source changes.

- [ ] Install the existing root and server lockfile dependencies with `npm ci` and `cd server && npm ci` in the contribution workspace.
- [ ] Confirm the contribution branch, exact base commit, remotes, and clean status before code changes.
- [ ] Confirm the production Mirror remains detached at its prior HEAD with no diff; do not run mutating Git commands there.

## 2. Backend pure filter and evidence contracts (TDD)

**Files:**

- `server/tests/mcp/repoSearch.test.ts`
- `server/tests/mcp/discovery.test.ts` (new)
- `server/src/mcp/repoSearch.ts`
- `server/src/mcp/evidence.ts` (new)

- [ ] Add failing tests for `matchesRepoFilters` covering every approved vector filter, including inclusive star bounds, successful-analysis semantics, subscriptions, license normalization, and empty filters.
- [ ] Add failing tests for the structured similarity query text, including deterministic field order and omission of an unknown license.
- [ ] Add failing tests for bounded batch result shaping: input order, duplicate occurrence preservation, found/not-found counts, and explicit per-item `not_found` status.
- [ ] Add failing tests for cache-only evidence: deterministic repository fields, latest release selection, null release when absent, `archived: null`, and absence of adoption decisions.
- [ ] Implement the smallest pure helpers and types. Refactor `applyRepoFilters` to reuse the predicate without changing existing keyword-search semantics or sort behavior.
- [ ] Implement the evidence projection with no time-dependent field and no network dependency.
- [ ] Run the focused server tests and confirm green.

## 3. Backend provider and vector behavior (TDD)

**Files:**

- `server/tests/mcp/provider.test.ts` (new)
- `server/src/mcp/provider.ts`

- [ ] Add failing provider tests with mocked DB/fetch for `getRepositories`, including a maximum input batch and duplicate lookup behavior.
- [ ] Add failing tests for latest release lookup using a single bounded SQL query per evidence request.
- [ ] Add failing tests for `gsm_vector_search` filters: filtered calls request no more than 50 Worker candidates, apply local filters in score order, truncate after filtering, and mark the candidate-set limitation.
- [ ] Add a regression test proving the no-filter path sends the requested topK rather than the 50-candidate path and preserves its existing envelope.
- [ ] Add failing tests for `findSimilarRepositories`: reuse the vector path, overfetch only within the 50 limit, exclude the source, collapse duplicate IDs, and sort ties by `full_name`.
- [ ] Implement provider functions and the vector option type. Keep Worker payload fields limited to `vector`, `topK`, and `threshold`.
- [ ] Run the focused provider tests and confirm green.

## 4. Backend MCP registration and contract (TDD)

**Files:**

- `server/tests/mcp/tools.test.ts` (new)
- `server/src/mcp/tools.ts`

- [ ] Add failing tests for the ten-tool inventory when vector search is available and the eight-tool inventory when it is not.
- [ ] Add failing tests for backend input properties and required fields, especially `idsOrFullNames` max 50 and all nine vector filters.
- [ ] Add failing tool-handler tests for the three new tools and the enhanced vector filter forwarding.
- [ ] Register `gsm_get_repos` and `gsm_get_repo_evidence` unconditionally, and register `gsm_find_similar_repos` beside `gsm_vector_search` only when vector availability is true.
- [ ] Keep handlers read-only and return JSON text through the existing result helper.
- [ ] Run the focused backend MCP tests and confirm green.

## 5. Electron parity helpers and snapshot (TDD)

**Files:**

- `electron/mcpDiscovery.js` (new)
- `electron/mcpLocalServer.js`
- `electron/mcpLocalServer.test.js` (new)
- `src/services/electronProxy.ts`
- `src/services/mcpElectronBridge.ts`

- [ ] Add failing Electron tests for the same pure filter/evidence/similarity behavior, including release-cache-only evidence and duplicate batch results.
- [ ] Add failing tests for tool definitions: names, required properties, optional filter properties, and conditional vector tools must match the backend contract.
- [ ] Add the local `releases` array to the in-memory MCP snapshot type and bridge updates; keep runtime secrets IPC-only.
- [ ] Extract/implement Electron discovery helpers without changing loopback binding, auth, lifecycle, or transport behavior.
- [ ] Update Electron keyword search/category/stats handlers only as needed to keep the MCP contract and approved filter semantics aligned.
- [ ] Implement candidate-set vector filtering and `gsm_find_similar_repos` using the existing embedding + Worker query path.
- [ ] Run the focused Electron parity tests and confirm green.

## 6. Backend/Electron tool parity regression (TDD)

**Files:**

- `server/tests/mcp/parity.test.ts` (new)
- `electron/mcpLocalServer.test.js`

- [ ] Add a failing parity assertion comparing the backend registration inventory with the Electron JSON tool definitions for vector-enabled and vector-disabled states.
- [ ] Add exact property-set assertions for `gsm_search_repos`, `gsm_list_repos_by_category`, `gsm_vector_search`, and the three new tools.
- [ ] Add a smoke request test for initialize → tools/list → each new handler in a disposable in-memory/snapshot fixture; do not use a production DB or runtime endpoint.
- [ ] Run both backend and Electron parity tests and confirm green.

## 7. Public MCP documentation (TDD not applicable)

**Files:**

- `README.md`
- `README_zh.md` (only the matching MCP table/notes)

- [ ] Update both MCP tool tables from seven to ten tools.
- [ ] Document all vector filters and the exact “maximum 50 retrieved candidates, then local filtering” limitation.
- [ ] Document that evidence is local DB/release-cache-only, missing fields are null, and no adoption decision is returned.
- [ ] Document bounded batch behavior and duplicate/input-order guarantees.
- [ ] Do not document or alter private tunnel endpoints, tokens, local machine paths, or deployment instructions.

## 8. Full verification and review

**Files:** no further source changes unless verification identifies a scoped defect.

- [ ] Run server tests, root tests, Electron MCP tests, boundary checks, lint, typecheck, frontend build, backend build, and `git diff --check`.
- [ ] Review the final diff and tracked-file list for unrelated changes, secrets, credentials, hardcoded machine paths, Worker changes, migration changes, and runtime artifacts.
- [ ] Re-run the relevant tests after any review fix and record exact command outcomes.
- [ ] Confirm the production Mirror status/HEAD/diff is unchanged.

## 9. Commit, publish, and upstream PR

**Files:** no new files beyond the scoped implementation/docs/tests.

- [ ] Create logical commits after verification, preserving the already-created specification commit `9c0afb7`.
- [ ] Push `feat/mcp-discovery-tools` to the authorized `ke-1t/GithubStarsManager` fork without force.
- [ ] Create an upstream PR against `AmintaCCCP/GithubStarsManager:main` with a concise, secret-free description of the ten-tool MCP contract and verification.
- [ ] Read back the PR metadata, changed files, commit list, and CI checks.
- [ ] If CI is pending, wait in bounded intervals and report its exact final state; do not claim green without a green check result.
