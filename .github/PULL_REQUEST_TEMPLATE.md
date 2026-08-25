<!--
Thank you for contributing! Please read docs/adr/0001-frontend-layering.md before
making changes that touch src/components/**, src/features/**, or src/store/**.
-->

## Summary

<!-- Brief: what changed and why. Reference the PR number from the plan if applicable. -->

## Verification

This PR must keep all gates green **and** change no runtime behavior, persisted data, or UI.
Run the following locally in this order before pushing:

```bash
npm run check:boundaries   # frontend layering guard (offline, fast)
npm run lint               # eslint incl. no-restricted-imports boundary rules
npm run typecheck          # tsc -b --noEmit
npm run test:run           # vitest run (contract + unit tests)
npm run build              # vite build + bundle budget (<= 3000 KiB legacy entry)
git diff --check           # whitespace / merge-marker hygiene
```

CI runs the same set (see `.github/workflows/ci.yml`), with `check:boundaries` first so a
layering violation fails the job before the slower steps.

## Scope checklist

- [ ] This PR does **not** change runtime behavior, user-visible UI text, or visual layout.
- [ ] This PR does **not** change Store keys, `version`, `partialize`, `migrate`, or `merge`
      (see `src/store/persistence/options.ts` and the v2 three contracts in ADR 0001).
- [ ] No new `import` of a business service directly into `src/components/**`
      (the ESLint `no-restricted-imports` rule and `check:boundaries` enforce this; if a
      component genuinely needs a service, add a hook in `src/features/*/hooks/**`).
- [ ] No new `import` of React/JSX/the Store/any service into `src/features/*/application/**`.
- [ ] No inline `eslint-disable` to bypass the boundary rules — fix the layering instead.
- [ ] If this PR migrates a component off the allowlist in `eslint.config.js` /
      `scripts/check-boundaries.cjs`, that entry is removed in the same PR.

## Notes for reviewers / CodeRabbit

<!-- If a CodeRabbit finding is out of scope for this PR, reply on the comment with the
reason and leave it unresolved rather than expanding scope. The goal is "no new
unresolved findings", not "zero comments". -->
