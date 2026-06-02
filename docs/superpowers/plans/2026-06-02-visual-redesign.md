# Editorial Light Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`). Apply the frontend-design craft, committing fully to the Editorial Light system below.

**Goal:** Restyle the entire frontend from dark/glass to a bright editorial-magazine aesthetic (paper + ink + electric cobalt, Fraunces + Hanken Grotesk), shipping phase by phase without breaking functionality.

**Architecture:** Phase 1 retokenizes `index.css` (light palette) and swaps fonts, then restyles shared layout + UI primitives — flipping most screens at once since shadcn components read the tokens. Phase 2 sweeps each page/panel to replace hardcoded dark classes (`bg-slate-*`, `text-white`, `backdrop-blur`, dark `from-[#...]` gradients) and apply editorial layout.

**Tech Stack:** React 19, Tailwind v4 (`@theme inline` + HSL CSS vars), shadcn/ui, @fontsource, wouter.

**Spec:** `docs/superpowers/specs/2026-06-02-visual-redesign-design.md`
**Branch:** `visual-redesign` (checked out; spec committed).

## Editorial Light token values (HSL triplets, for `index.css` vars)

- `--background: 40 30% 97%` (paper #FAF8F4)
- `--foreground: 40 16% 7%` (ink #15130F)
- `--card: 0 0% 100%` (white cards on paper)
- `--card-foreground: 40 16% 7%`
- `--border / --card-border / --input: 40 20% 87%` (hairline #E5E0D8)
- `--ring: 233 100% 57%` (cobalt)
- `--primary: 233 100% 57%` (electric cobalt #2640FF); `--primary-foreground: 0 0% 100%`
- `--secondary: 40 20% 92%`; `--secondary-foreground: 40 16% 7%`
- `--muted: 40 24% 94%`; `--muted-foreground: 40 8% 38%` (muted ink #6B665C)
- `--accent: 233 100% 57%`; `--accent-foreground: 0 0% 100%`
- `--popover: 0 0% 100%`; `--popover-foreground: 40 16% 7%`; `--popover-border: 40 20% 87%`
- `--destructive: 0 72% 48%`; `--destructive-foreground: 0 0% 100%`
- `--sidebar: 0 0% 100%`; `--sidebar-foreground: 40 16% 7%`; `--sidebar-border: 40 20% 87%`; `--sidebar-primary: 233 100% 57%`; `--sidebar-primary-foreground: 0 0% 100%`; `--sidebar-accent: 40 24% 94%`; `--sidebar-accent-foreground: 40 16% 7%`; `--sidebar-ring: 233 100% 57%`
- Fonts: `--app-font-sans: 'Hanken Grotesk', sans-serif;` `--app-font-heading: 'Fraunces', Georgia, serif;` `--app-font-serif: 'Fraunces', Georgia, serif;` (mono unchanged)
- Shadows: soften to warm low-opacity (e.g. `hsl(40 16% 7% / 0.06)`); elevate vars to dark-on-light: `--elevate-1: rgba(0,0,0,.03); --elevate-2: rgba(0,0,0,.06); --button-outline: rgba(0,0,0,.10); --badge-outline: rgba(0,0,0,.06);`

## Class-mapping cheatsheet (Phase 2 sweeps)

| Dark pattern | Editorial Light replacement |
|---|---|
| `bg-slate-800/90`, `bg-slate-950/…`, `bg-card/40 backdrop-blur` | `bg-card border border-border` (flat) |
| `text-white`, `text-slate-100/200/300` | `text-foreground` (or `text-muted-foreground` for secondary) |
| `text-slate-400/500`, `text-muted-foreground` | keep `text-muted-foreground` |
| `border-slate-700/800`, `border-white/10` | `border-border` |
| dark gradient `from-[#0A84FF]/10 to-…` | flat `bg-card` + cobalt accent border/text, or `bg-primary/5` |
| teal accents (`text-teal-400`, `bg-teal-500`) | cobalt: `text-primary`, `bg-primary text-primary-foreground` |
| glass `backdrop-blur` | remove; use solid `bg-card` |
| big titles | `font-[family-name:var(--app-font-heading)]` (Fraunces), larger, tracking-tight |

Keep functional status colors (green/amber/red) for status only, slightly muted.

---

### Task 1: Fonts + light design tokens (foundation)

**Files:** Modify `artifacts/jg-youth/src/index.css`; modify `artifacts/jg-youth/package.json`.

- [ ] **Step 1: Add the font packages**

In `artifacts/jg-youth/package.json` devDependencies add:
```json
    "@fontsource-variable/fraunces": "^5.2.5",
    "@fontsource-variable/hanken-grotesk": "^5.2.5",
```
Run: `pnpm install --no-frozen-lockfile`. Expected: installs both.

- [ ] **Step 2: Swap the font imports in index.css**

Replace the Sora/Inter `@import` lines (1–9) with:
```css
@import "@fontsource-variable/fraunces";
@import "@fontsource-variable/hanken-grotesk";
```

- [ ] **Step 3: Apply the light token values**

In `:root` (and mirror the same values in `.dark` so an accidental `.dark` class can't reintroduce dark), set every variable to the Editorial Light values listed in "token values" above (background, foreground, card, border, input, ring, primary, secondary, muted, accent, popover, destructive, sidebar*, elevate/outline). Set `--app-font-sans: 'Hanken Grotesk Variable', 'Hanken Grotesk', sans-serif;` and `--app-font-heading`/`--app-font-serif: 'Fraunces Variable', 'Fraunces', Georgia, serif;`. Soften the shadow vars to warm low-opacity.

- [ ] **Step 4: Add a base body rule + grain (append after the theme block)**
```css
@layer base {
  body {
    background-color: hsl(var(--background));
    color: hsl(var(--foreground));
    font-family: var(--app-font-sans);
  }
  h1, h2, h3, .font-display {
    font-family: var(--app-font-heading);
    letter-spacing: -0.02em;
  }
}
```

- [ ] **Step 5: Build + visual sanity**

Run: `pnpm --filter=@workspace/jg-youth run build`. Expected: success.
Then `pnpm --filter=@workspace/jg-youth run typecheck`. Expected: success.

- [ ] **Step 6: Commit**
```bash
git add artifacts/jg-youth/package.json artifacts/jg-youth/src/index.css pnpm-lock.yaml
git commit -m "feat(web): Editorial Light design tokens + Fraunces/Hanken Grotesk fonts"
```

---

### Task 2: Restyle shared layout (`components/layout.tsx`)

**Files:** Modify `artifacts/jg-youth/src/components/layout.tsx`.

- [ ] **Step 1: Read the file, then restyle the header/nav/footer** using the cheatsheet: paper background, ink text, hairline bottom border on the header (`border-b border-border`), remove any dark/glass classes, brand wordmark in Fraunces (`font-[family-name:var(--app-font-heading)]`), cobalt for the active/CTA. Preserve all links, routes, auth conditionals, and the mobile menu behavior — only classes/markup styling change.
- [ ] **Step 2:** `pnpm --filter=@workspace/jg-youth run build` → success.
- [ ] **Step 3:** Commit `git commit -m "feat(web): restyle app layout to Editorial Light"`.

---

### Task 3: Restyle core UI primitives

**Files:** Modify, under `artifacts/jg-youth/src/components/ui/`: `button.tsx`, `card.tsx`, `input.tsx`, `dialog.tsx`, `tabs.tsx`, `badge.tsx`.

- [ ] **Step 1:** For each, read it and adjust only the variant class strings to the light system: buttons — primary = `bg-primary text-primary-foreground` (cobalt), outline = `border border-border text-foreground hover:bg-muted`, ghost = `hover:bg-muted`; cards — `bg-card text-card-foreground border border-border rounded-2xl` (drop any blur/dark); inputs — `bg-card border-border` focus ring cobalt; dialog/popover — `bg-popover text-popover-foreground border border-border` (remove dark slate); tabs — active = `bg-primary text-primary-foreground` or an editorial underline; badge — light variants. Keep all component APIs/props unchanged.
- [ ] **Step 2:** `pnpm --filter=@workspace/jg-youth run build` → success.
- [ ] **Step 3:** Commit `git commit -m "feat(web): restyle UI primitives to Editorial Light"`.

---

### Task 4: Restyle shared panel primitives (`components/panels/shared.tsx`)

**Files:** Modify `artifacts/jg-youth/src/components/panels/shared.tsx`.

- [ ] **Step 1:** Restyle `DashCard` (flat white card, hairline border, generous padding), `SectionTitle` (Fraunces, small-caps numbered label option), `RoleBadge` (light token-based colors), `EmptyState`, `SkeletonRows` per the cheatsheet. Keep exports/props identical.
- [ ] **Step 2:** `pnpm --filter=@workspace/jg-youth run build` → success.
- [ ] **Step 3:** Commit `git commit -m "feat(web): restyle dashboard shared primitives"`.

---

### Task 5: Restyle Home (`pages/home.tsx`) + behavioral fixes

**Files:** Modify `artifacts/jg-youth/src/pages/home.tsx` (and the KPIs/stat source if needed).

- [ ] **Step 1:** Read `home.tsx`. Apply editorial layout: large Fraunces hero headline, paper bg, asymmetric layout, hairline-divided sections, events in an editorial card grid.
- [ ] **Step 2 (behavioral):** Remove any **Self Check-In** CTA from the landing page. Keep **Register as First Timer** + **Login**.
- [ ] **Step 3 (behavioral):** Ensure the **Total Members** stat counts members + leaders + super_admins. Inspect where the stat comes from (the home page query / KPIs). If it currently excludes leaders/admins, fix the source so it counts all three roles. If it already does, leave it.
- [ ] **Step 4:** `pnpm --filter=@workspace/jg-youth run build` → success.
- [ ] **Step 5:** Commit `git commit -m "feat(web): restyle home + remove self-checkin CTA + total-members stat"`.

---

### Task 6: Restyle Member dashboard (`pages/my.tsx`)

**Files:** Modify `artifacts/jg-youth/src/pages/my.tsx`.

- [ ] **Step 1:** Restyle profile masthead, the single Check-In card, My Check-ins index list, Events/RSVP tabs, and both dialogs (profile prompt, avatar) per the cheatsheet — including the dark `bg-slate-800/95` dialogs → `bg-popover` light. Keep all handlers/logic.
- [ ] **Step 2:** `pnpm --filter=@workspace/jg-youth run build` → success.
- [ ] **Step 3:** Commit `git commit -m "feat(web): restyle member dashboard to Editorial Light"`.

---

### Task 7: Restyle Check-in (`pages/checkin.tsx`)

**Files:** Modify `artifacts/jg-youth/src/pages/checkin.tsx`.

- [ ] **Step 1:** Restyle per cheatsheet. Preserve: the SAST Friday time-window banners (locked/closed/Fridays-only), the scan/search pill toggle, and the camera-permission fallback. Banners become editorial callouts (hairline + accent), not glass.
- [ ] **Step 2:** `pnpm --filter=@workspace/jg-youth run build` → success.
- [ ] **Step 3:** Commit `git commit -m "feat(web): restyle check-in page"`.

---

### Task 8: Restyle Session-QR + auth/register pages

**Files:** Modify `pages/session-qr.tsx`, `pages/leader-login.tsx`, `pages/register.tsx`, `pages/become-member.tsx`, `pages/not-found.tsx`.

- [ ] **Step 1:** Restyle each per cheatsheet (editorial forms, hairline cards, cobalt CTAs). Session-QR: keep the QR on a **white** card (intentional exception), download-PNG + regenerate buttons, URL in mono. Preserve all form logic/handlers.
- [ ] **Step 2:** `pnpm --filter=@workspace/jg-youth run build` → success.
- [ ] **Step 3:** Commit `git commit -m "feat(web): restyle session-qr and auth/register pages"`.

---

### Task 9: Restyle Leader dashboard + panels

**Files:** Modify `pages/dashboard.tsx` and `components/panels/*` (AttendancePanel, MemberDirectoryPanel, LeaderManagementPanel, PinManagementPanel, RequestsPanel, EventsPanel, RSVPPanel, AdminSlotsPanel, ChatPanel, DeleteConfirmPanel, CheckInWaitingState, coming-soon).

- [ ] **Step 1:** Sweep each panel for dark/glass classes → light per cheatsheet. ChatPanel: paper conversation, ink bubbles, cobalt for own-message bubbles, hairline input bar — keep the polling logic untouched. Tabs/badges use the restyled primitives. Keep all handlers/props/logic.
- [ ] **Step 2:** `pnpm --filter=@workspace/jg-youth run build` → success.
- [ ] **Step 3:** Commit `git commit -m "feat(web): restyle leader dashboard + panels"`.

---

### Task 10: Final sweep + verification gate

- [ ] **Step 1: Grep gate** — `grep -rn "bg-slate-\|text-white\|backdrop-blur\|text-teal-\|bg-teal-" artifacts/jg-youth/src` should return essentially nothing (allow documented exceptions: the white session-QR card). Fix stragglers.
- [ ] **Step 2:** `pnpm --filter=@workspace/jg-youth run typecheck && pnpm --filter=@workspace/jg-youth run build` → success.
- [ ] **Step 3:** Manual visual QA notes: each page legible (no light-on-light/dark-on-dark), mobile layout intact, cobalt used sparingly, Fraunces on headings.
- [ ] **Step 4:** Commit any straggler fixes `git commit -m "chore(web): final Editorial Light sweep"`.

## Notes
- Do NOT change behavior except: Home Self-Check-In removal + Total Members stat. Everything else is styling only — preserve every handler, route, and query.
- Ship phase by phase; each task builds green and is independently deployable.
