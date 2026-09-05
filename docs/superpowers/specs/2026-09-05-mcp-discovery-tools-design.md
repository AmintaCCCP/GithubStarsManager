# MCP discovery tools design

Status: approved for implementation
Base: upstream `main` at `7b9a622ee64dedfc73ddbbb93de9e7e4bc8b4ae5`

## Goal

Expose deterministic, read-only discovery primitives for an agent working with a
personal GithubStarsManager corpus. The backend MCP server and the Electron local
MCP server must expose the same ten-tool surface when vector search is available:

1. `gsm_status`
2. `gsm_search_repos`
3. `gsm_get_repo`
4. `gsm_get_repos`
5. `gsm_get_repo_evidence`
6. `gsm_list_categories`
7. `gsm_list_repos_by_category`
8. `gsm_stats`
9. `gsm_find_similar_repos`
10. `gsm_vector_search`

The two vector-dependent tools remain conditionally listed under the existing
"vector search must be configured and enabled" policy. Without vector search,
the two new non-vector tools still remain available.

## Scope and non-goals

- The contribution is based on the upstream commit above and is developed in a
  separate contribution workspace.
- GithubStarsManager remains local-first. No hosted service, tunnel, Docker,
  Ollama, Worker, or production database change is part of this contribution.
- No database migration or new dependency is required.
- The existing Worker `/query` contract is unchanged. It continues to receive
  only `vector`, `topK`, and `threshold`.
- MCP remains read-only. No tool mutates stars, analysis, release cache,
  categories, vector indexes, or settings.
- The existing no-filter `gsm_vector_search` request and result behavior remains
  unchanged. New filtering metadata is emitted only when at least one new filter
  is active.

## Tool contracts

### `gsm_get_repos`

Input:

```json
{"idsOrFullNames":["owner/repo","123"]}
```

The array is required, non-empty, and bounded to 50 entries. Every input entry
produces one result entry in input order. A duplicate input produces a duplicate
result entry; it is not silently deduplicated. Each item has:

```json
{
  "input":"owner/repo",
  "status":"found",
  "repository":{}
}
```

or, for a partial miss:

```json
{
  "input":"missing/repo",
  "status":"not_found",
  "repository":null
}
```

The envelope reports `requested`, `foundCount`, `notFoundCount`, and a
`notFound` list. Counts are occurrence counts, so duplicates are counted in the
same way as the returned entries. Lookups are DB/snapshot-only and bounded by
the input limit.

### `gsm_get_repo_evidence`

Input:

```json
{"idOrFullName":"owner/repo"}
```

The repository is resolved from the local database or Electron snapshot. The
result includes the compact repository projection plus deterministic evidence
from the `repositories` table/snapshot and the latest locally cached row in
`releases`. The latest release selection is stable (`published_at` descending,
then release id descending). If no cached release exists, `latest_release` is
`null`.

The evidence uses `null` for values that are not stored locally. In particular,
`archived` is always `null` because the current repository schema does not store
that value. The response explicitly identifies the local database and release
cache as its sources and states that release evidence is cache-only.

No remote GitHub request is made, and no unbounded per-repository API fan-out is
allowed. The tool does not return an ADOPT/ADAPT/REFERENCE/REJECT decision or
any inferred value.

### `gsm_find_similar_repos`

Input:

```json
{"idOrFullName":"owner/source","topK":10,"threshold":0.35}
```

The tool reuses the existing vector query path. It builds the query from the
same structured repository metadata fields used by the app's embedding text
format (repository name, descriptions, summary, topics/tags, language, and
license). It does not create a second semantic engine and does not fetch a
README or call GitHub remotely. The source repository is excluded by id, stale
or unknown vector ids are ignored, duplicate vector ids are collapsed, and
results are sorted deterministically by score descending and `full_name`.

The response includes the source projection, `sourceExcluded: true`, and
similar matches in the same compact match shape as vector search. If the source
is not in the local corpus, the tool returns the existing `not_found` error
shape. Vector availability/error behavior follows `gsm_vector_search`.

### Enhanced `gsm_vector_search`

The existing `query`, `topK`, and `threshold` inputs remain. The following
optional filters are added:

- `languages`
- `tags`
- `platforms`
- `licenses`
- `category`
- `minStars`
- `maxStars`
- `isAnalyzed`
- `isSubscribed`

With no new filter, the Worker is queried with the requested topK exactly as
before. When any filter is active, the Worker is queried once with at most 50
semantic candidates, and the existing local repository projection/filter logic
is applied deterministically in score order. The filtered list is then
truncated to the requested topK.

This is intentionally **not** an exact filtered topK over the entire Vectorize
corpus. It is a filtered topK within the retrieved candidate set (maximum 50).
The limitation is present in implementation comments, public MCP documentation,
and tests. No Worker metadata filter is added in this change.

## Backend/Electron parity

The two implementations keep matching tool names, required inputs, optional
input property names, read-only semantics, compact repository projection, and
the ten-tool conditional listing policy. Electron receives the existing local
release snapshot in addition to repositories/categories so that its evidence
tool has the same cache-only behavior. Secrets continue to remain in runtime
memory/IPC configuration and are never included in snapshots, projections,
responses, logs, or committed files.

Parity tests compare the tool inventory and input-property contracts and cover
the new batch, evidence, similarity, and candidate-set filtering behavior on
both implementations.

## Reuse-discovery guardrail

The personal GitHub Stars corpus was used only as advisory design input. The
following candidates are classified without auto-adoption:

- REFERENCE: `DeusData/codebase-memory-mcp`,
  `punkpeye/awesome-mcp-servers` — useful examples of tool discovery and
  repository metadata presentation.
- ADAPT (future commerce-engine work, not this contribution):
  `apify/crawlee`, `firecrawl/firecrawl`, `scrapy/scrapy`,
  `unclecode/crawl4ai`, and `D4Vinci/Scrapling` — possible crawler/retrieval
  patterns, but introducing their dependencies here would exceed scope.
- REJECT for this contribution: importing an external crawler/MCP framework,
  changing the Worker, or making GithubStarsManager decide business adoption.

GithubStarsManager remains an advisory corpus, not an authority or business,
runtime, or implementation source of truth.

## Verification

The contribution must pass the repository's existing boundary check, lint,
typecheck, frontend tests, backend tests, frontend build, backend build, and
`git diff --check`. Additional MCP contract/smoke tests must exercise both
implementations without touching a production database, tunnel, Docker volume,
Ollama binding, or vector index.
