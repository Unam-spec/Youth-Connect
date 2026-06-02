# Visual Redesign — "Editorial Light" — Design

**Date:** 2026-06-02
**Sub-project:** 5 of N (Youth-Connect end-to-end overhaul)
**Status:** Approved (direction); spec under review
**Branch:** `visual-redesign`

## Direction

A full ground-up restyle from the current dark/glass theme to a bright **editorial
magazine** aesthetic. Distinctive, high-contrast, type-led. Built with the
`frontend-design` skill's craft principles. Committed and intentional — not the current
look refined.

## Design system

### Canvas & ink
- Background: warm paper `#FAF8F4` (not stark white). Optional very-subtle grain overlay.
- Ink (text): `#15130F` near-black; muted ink `#6B665C`.
- Surfaces: flat, separated by **hairline rules** (`1px` warm gray `#E5E0D8`) and spacing —
  NOT glass/blur. Cards = paper with a hairline border and generous padding; elevation only
  via subtle shadow on interactive/raised elements.

### Accent
- Single accent: **electric cobalt `#2640FF`** (hover/active `#1B2FCC`). Used for primary
  buttons, links, active states, key marks. Restraint: one accent over paper+ink.
- Functional status colors retained but desaturated to fit: success green, warning amber,
  destructive red — used only for status, not decoration.

### Typography
- Display: **Fraunces** (variable, optical sizing) — large editorial headlines, tight
  leading, used for page titles, section heads, big numerals.
- Body/UI: **Hanken Grotesk** (variable) — body, labels, buttons, inputs.
- Devices: small-caps numbered section labels (e.g. "01 — Upcoming"), oversized numerals
  for stats, generous headline sizes, hairline-underline links.
- Fonts added via `@fontsource` packages (mirroring the existing Inter/Sora setup), wired
  into the Tailwind theme as `--font-display` / `--font-sans`.

### Layout & motion
- Asymmetric, grid-breaking, generous margins; index-style lists with hairline dividers;
  stats as oversized numerals; thin-bordered media.
- Motion: one orchestrated staggered reveal on load (small translate+fade); subtle hover
  (underline grow, marker). No glow/neon.

### Tokens (implementation anchor)
Redefine the theme tokens in `artifacts/jg-youth/src/index.css` (Tailwind v4 `@theme` /
CSS vars) for the light palette: `--background`, `--foreground`, `--card`, `--border`,
`--primary` (cobalt), `--muted`, `--muted-foreground`, `--destructive`, etc. Most shadcn
UI components read these tokens, so retheming the tokens flips a large share automatically.
The remaining work is sweeping **hardcoded dark classes** (`bg-slate-*`, `text-white`,
`bg-card/40 backdrop-blur`, `from-[#...]` dark gradients, etc.) across pages/panels.

## Scope: pages & components

Every user-facing surface, restyled to the system above. While touching each page, also
satisfy the original overhaul spec's page requirements where not already met:

- **Shared:** `index.css` tokens + fonts; `components/layout.tsx` (header/nav/footer);
  shared UI primitives in `components/ui/*` and `components/panels/shared.tsx`
  (DashCard, SectionTitle, RoleBadge, EmptyState).
- **Home (`home.tsx`):** editorial hero; "Register as First Timer" + "Login"; remove any
  Self Check-In CTA; Total Members stat must include members + leaders + super_admins;
  upcoming events in an editorial card grid.
- **Member (`my.tsx`):** profile masthead, single Check-In card, My Check-ins index,
  Events/RSVP — all restyled.
- **Leader dashboard (`dashboard.tsx`) + all panels:** Today's Check-ins, Members,
  Events, Manage; chat panel; merge/badges retained, restyled.
- **Check-in (`checkin.tsx`):** restyle; keep the SAST Friday-window banners and the
  scan/search toggle; friendly camera-permission fallback.
- **Session QR (`session-qr.tsx`):** full-screen QR on a white card, download PNG,
  regenerate, URL in monospace.
- **Auth/register (`leader-login.tsx`, `register.tsx`, `become-member.tsx`,
  `not-found.tsx`):** restyled forms.

## Approach (phased, ships incrementally; app never breaks)

1. **Phase 1 — Foundation:** add fonts; redefine `index.css` tokens to Editorial Light;
   restyle the shared primitives (`layout.tsx`, `components/ui` buttons/inputs/cards/dialog,
   `panels/shared.tsx`). After this, most screens already shift toward the new look via
   tokens; verify nothing is illegible (dark-on-dark/!light).
2. **Phase 2 — Page sweeps:** one focused pass per page to replace hardcoded dark classes
   and apply editorial layout. Order: home → my → checkin → session-qr → auth/register →
   dashboard + panels (largest last).
3. Each phase builds, is committed, and is independently shippable.

## Verification

- `pnpm --filter=@workspace/jg-youth run typecheck` and `run build` after each phase.
- No regressions: every interactive control keeps its handler; no functionality removed
  except the explicitly-specified Home Self-Check-In CTA.
- Manual visual QA per page after deploy (light theme, contrast/legibility, mobile).
- Grep gate: after the sweep, `bg-slate-`, `text-white`, and `backdrop-blur` should be
  essentially gone from `artifacts/jg-youth/src` (allowing intentional exceptions like the
  white session-QR card).

## Out of scope
- Backend/behavioral changes beyond the Home stat fix and any already-specced page logic.
- New features (those were sub-project #4).

## Commit plan
Phase-based commits, e.g. `feat(web): Editorial Light design tokens + fonts`,
`feat(web): restyle shared layout + UI primitives`, then `feat(web): restyle <page>` per page.
