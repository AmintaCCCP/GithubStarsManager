<!--
Thank you for contributing! Please read docs/adr/0001-frontend-layering.md before
making changes that touch src/components/**, src/features/**, or src/store/**.
-->

## Summary

<!-- Brief: what changed and why. Reference the PR number from the plan if applicable. -->

## Verification

Run the following locally in this order before pushing:

```bash
npm run check:boundaries   # frontend layering guard (offline, fast)
npm run check:i18n -- --base origin/main
npm run check:pr-release-files -- --base origin/main
npm run lint               # eslint incl. no-restricted-imports boundary rules
npm run typecheck          # tsc -b --noEmit
npm run test:run           # vitest run (contract + unit tests)
npm run build              # vite build + bundle budget (<= 3000 KiB legacy entry)
git diff --check           # whitespace / merge-marker hygiene
```

CI runs the same set (see `.github/workflows/ci.yml`), with `check:boundaries` first so a
layering violation fails the job before the slower steps. Contributor PRs that bump
`package.json` / lockfile root `version` or edit `versions/version-info.xml` fail CI.
New UI copy must go through `src/locales/{zh,en,ja,es,pt-BR,ru,zh-TW,fr,de,ko}/`.

## Scope checklist

- [ ] **Runtime/persistence/UI changes described.** If this PR changes runtime behavior,
      persisted data (Store keys, `version`, `partialize`, `migrate`, `merge` — see
      `src/store/persistence/options.ts` and ADR 0001), or user-visible UI, describe the
      change and its migration impact below. Architecture-enforcement PRs should have none.
- [ ] No new `import` of a business service directly into `src/components/**`
      (the ESLint `no-restricted-imports` / `no-restricted-syntax` rules and
      `check:boundaries` enforce this, including dynamic `import()`; if a component
      genuinely needs a service, add a hook in `src/features/*/hooks/**`).
- [ ] No new `import` of React/JSX/the Store/any service into `src/features/*/application/**`
      (static or dynamic).
- [ ] No inline `eslint-disable` to bypass the boundary rules — fix the layering instead.
- [ ] No app version bump (`package.json` / `server/package.json` / lockfile root `version`) and no `versions/version-info.xml` edit. Releases are owner-only on `main`.
- [ ] New user-facing copy uses `t()` / locale JSON, not hardcoded strings. Every built-in language has a real translation (not an English/zh copy). Brand tokens may use `// i18n-allow-literal`.

### Runtime / persistence / UI changes (if any)

<!-- If this PR touches runtime behavior, persisted data, or UI, describe it here.
If it is a pure architecture-enforcement PR with none, write "None". -->

## Notes for reviewers / CodeRabbit

<!-- If a CodeRabbit finding is out of scope for this PR, reply on the comment with the
reason and leave it unresolved rather than expanding scope. The goal is "no new
unresolved findings", not "zero comments". -->
