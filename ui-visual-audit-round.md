# UI visual audit — official shadcn parity round

Date: 2026-08-22.

> **Historical pre-remediation snapshot.** The observations below document the audit state before the shadcn/Radix remediation and are retained for traceability. They are not a statement of the current implementation; see `audit-summary.md`, `ui-refactor-summary.md`, and `final-browser-verification.md` for the remediation and final verification evidence.

## External baseline

The official shadcn/ui documentation recommends semantic CSS variable pairs (`background`/`foreground`, `card`/`card-foreground`, `popover`/`popover-foreground`, `primary`/`primary-foreground`, `muted`/`muted-foreground`, `accent`/`accent-foreground`, `border`, `input`, and `ring`) and explicit Button `variant`/`size` APIs. See the source notes in `shadcn-visual-baseline.md`.

## Historical implementation evidence (pre-remediation snapshot)

The style scan found 163 `bg-white`, 54 `text-white`, 31 `text-gray-*`, 34 `border-gray-*`, 526 `dark:bg-*`, 1,115 `dark:text-*`, and 269 `dark:border-*` occurrences under `src`. `src/index.css` is approximately 38 KB and contains repeated legacy prose/highlight rules, handcrafted `btn-*` and `input-*` classes, a second Linear-style token layer, and duplicated focus/scrollbar rules. The application shell still uses legacy `bg-light-bg`, `text-gray-900`, `dark:bg-marketing-black`, and `dark:text-text-primary` classes in the hydration and authenticated App branches. High-visibility pages such as LoginScreen, Header, CategorySidebar, RepositoryCard, SearchBar, DiscoveryView, SettingsPanel, and GistView layer bespoke `ui-*`/`linear-*` classes and raw color utilities on top of shared Radix primitives.

The shared Button primitive has a stock-like base (`text-sm font-medium`, `rounded-md`, semantic foreground/background tokens) and explicit default/sm/lg/icon sizes, but many consumers override its height, padding, colors, radius, and dark-mode colors. The shared Input and Select primitives are closer to the official semantic-token model; consumer-side `ui-field` and raw utility overrides are the main drift source. The shared Card primitive still uses an older fixed spacing/typography model (`p-6`/`p-5`, `CardTitle text-2xl`) and should be aligned to the project’s chosen official shadcn version before page-level overrides are removed.

A local browser visit to `http://localhost:5173/` initially rendered a blank white viewport with an empty interactive-element list. The generated HTML contained the root mount and `/src/main.tsx`; no browser console output was reported. This needs a follow-up runtime check before relying on screenshot-based visual comparison.

## Scope decision

The remediation will preserve all stores, services, API semantics, synchronization flows, AI behavior, and data flows. It will prioritize the global token/base layer, shared primitives, App shell, LoginScreen, Header, CategorySidebar, SearchBar, RepositoryCard/List, SettingsPanel, DiscoveryView, and GistView. Component-specific raw colors that express syntax highlighting, release status, or data visualization will remain semantically reviewed rather than blindly replaced.

## Historical production preview observation (pre-remediation snapshot)

The production preview at `http://localhost:4173/` mounted successfully after the dev-server page remained blank. The rendered login screen confirms the semantic token layer is active, but also exposes remaining parity work: the dark canvas is very deep navy while the card/input surfaces are noticeably blue-gray; the card content is visually dense; the top language/theme controls and input/button heights still feel more bespoke than the official shadcn examples; and the primary button is a light surface in dark mode because the project intentionally inverts `primary`/`primary-foreground`. The text is readable, but the visual hierarchy can be brought closer to shadcn by using consistent `bg-background`/`bg-card`, standard `h-10` inputs and buttons, `rounded-md` controls, fewer custom shadows, and more explicit muted/foreground pairings.

The blank dev-server viewport was an environment/runtime observation only; the production build preview renders the application correctly and is the valid basis for visual regression.

The light-theme preview is materially closer to shadcn than the previous custom styling: white background, white card with a thin neutral border, compact dark text hierarchy, and standard-height input. The primary button still renders as a muted gray block because the dark/light token inversion makes `primary` light in dark mode and dark in light mode; in the light screenshot this is readable but visually low-emphasis compared with the official default button. The top controls are visually compact, while the login card’s outer spacing and helper panel can still be simplified further if needed.
