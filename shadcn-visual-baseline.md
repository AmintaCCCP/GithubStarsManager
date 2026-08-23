# Official shadcn/ui visual baseline

Research date: 2026-08-22.

The official shadcn/ui documentation describes a token-first system: components should use semantic pairs such as `background`/`foreground`, `card`/`card-foreground`, `popover`/`popover-foreground`, `primary`/`primary-foreground`, `secondary`/`secondary-foreground`, `muted`/`muted-foreground`, `accent`/`accent-foreground`, `destructive`, `border`, `input`, and `ring`. Dark mode should override the same semantic tokens under `.dark`, rather than requiring each component to duplicate hard-coded light/dark colors.

The official Button API uses explicit `variant` and `size` props. Its documented sizes include default, small, large, and icon; icon-only controls should use the icon size rather than compensating with arbitrary padding. The official Card composition uses Card, CardHeader, CardTitle, CardDescription, CardContent, and CardFooter, with a shared radius/spacing scale and `card` surface tokens.

For this audit, the acceptance baseline is: the global body uses `bg-background text-foreground`; elevated surfaces use `bg-card text-card-foreground`; floating menus/dialog surfaces use `bg-popover text-popover-foreground`; controls use the shared Button/Input/Select/Switch variants and size props; borders use `border-border`; focus uses `ring-ring`; and component-local raw `bg-white`, `text-gray-*`, `border-gray-*`, oversized `rounded-*`, or duplicate `dark:*` overrides are removed unless they are semantically required.

References:

1. [shadcn/ui Components](https://ui.shadcn.com/docs/components)
2. [shadcn/ui Theming](https://ui.shadcn.com/docs/theming)
3. [shadcn/ui Button](https://ui.shadcn.com/docs/components/button)
4. [shadcn/ui Card](https://ui.shadcn.com/docs/components/card)
