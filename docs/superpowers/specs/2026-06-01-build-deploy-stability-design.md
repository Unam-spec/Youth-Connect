# Build & Deploy Stability — Design

**Date:** 2026-06-01
**Sub-project:** 1 of N (Youth-Connect end-to-end overhaul)
**Status:** Approved

## Context

Youth-Connect is a pnpm monorepo deployed as two units:

- **Frontend** (`artifacts/jg-youth`) → Vercel, auto-deploys from `main`.
- **Backend** (`artifacts/api-server`) → Railway, auto-deploys from `main`.
- Database: Supabase Postgres. Auth: Clerk.

The larger overhaul spec is being delivered as sequenced sub-projects, each with its
own design → plan → implementation cycle. This is sub-project #1. Per decision, build
and deploy stability ships first: nothing else matters if the app will not deploy
reliably.

This design is grounded in a fresh audit of the *current* code, not the overhaul
spec's bug descriptions (several of which describe an older snapshot).

## Goal

Make Vercel and Railway builds reliable and warning-free:

- Exactly one lockfile as source of truth.
- No accidental embedded git repositories (no submodule warning on clone).
- A deterministic frontend build output.
- Deploy-time type safety retained.

## Audit findings (current state)

1. **Accidental embedded repo.** `Youth-Connect/` (nested inside the repo root) is its
   own git repository — it has its own `.git/`. The outer repo tracks it as a gitlink
   (mode 160000); `git status` shows `M Youth-Connect`. There is no `.gitmodules`, so it
   is an *accidental* embedded repo, not an intentional submodule. This is the cause of
   the "submodule"/"embedded git repository" warning on every Vercel clone. The folder
   is a stale (May 28) full-project snapshot.
2. **Stray tracked lockfile.** `pnpm-lock.yaml.3469179071` is committed to git
   (`git ls-files` confirms). No `package-lock.json` exists. So the real lockfile noise
   is this committed pnpm backup file, not an npm/pnpm lockfile conflict.
3. **vercel.json.** `installCommand` is already `pnpm install --no-frozen-lockfile`
   (correct). `buildCommand` is
   `pnpm -w run typecheck:libs && pnpm --filter=@workspace/jg-youth run build`,
   `outputDirectory` is `public`.
4. **build-vercel.cjs.** Runs `vite build` (output to `dist/public`) then copies that
   output into 4 candidate destinations (`public`, `dist`, `../../public`, `../../dist`),
   swallowing per-destination copy errors. A "shotgun" approach to satisfy whatever root
   Vercel uses.
5. **railway.toml.** Already correct: separate `buildCommand`
   (`pnpm --filter=@workspace/api-server run build`) and `startCommand`
   (`pnpm --filter=@workspace/api-server run start`).

## Changes

### 1. Remove the accidental embedded repo (fixes submodule warning)

- `git rm --cached Youth-Connect` — remove the gitlink entry from the index.
- Delete the working-tree folder `Youth-Connect/` (including its nested `.git/`).

Decision: untrack **and** delete. It is a duplicate snapshot of the repo we are already
in; keeping it serves no purpose.

### 2. Single source-of-truth lockfile (fixes lockfile noise)

- `git rm pnpm-lock.yaml.3469179071` (remove the committed backup).
- Confirm `pnpm-lock.yaml` is the only remaining lockfile.
- Add `pnpm-lock.yaml.*` to `.gitignore` so future pnpm backup files are never committed.

### 3. vercel.json — keep, retain the typecheck gate

- `installCommand`: keep `pnpm install --no-frozen-lockfile`.
- `buildCommand`: keep
  `pnpm -w run typecheck:libs && pnpm --filter=@workspace/jg-youth run build`.
- `outputDirectory`: keep `public`.

Decision: deviate from the overhaul spec's simpler `pnpm --filter @workspace/jg-youth
build` on purpose. Retaining `typecheck:libs` catches shared-lib type errors at deploy
time rather than shipping broken code.

### 4. build-vercel.cjs — make output deterministic

- Narrow the copy targets to the single correct destination: repo-root `public/`
  (`../../public` relative to the package), matching `vercel.json`'s
  `outputDirectory: public`.
- Remove the per-destination `try/catch` that silently swallows copy failures; a failed
  copy must fail the build loudly (non-zero exit).
- Keep the outer `try/catch` only insofar as it already exits non-zero on `vite build`
  failure.

### 5. railway.toml — no change

Already correct. The overhaul spec's suggestion to merge build and start into one
`buildCommand` would break Railway's start phase. Documented as an intentional
non-change.

## Verification

- `git status` shows neither `Youth-Connect` (gitlink) nor `pnpm-lock.yaml.3469179071`.
- A fresh `git clone` emits no embedded-repo / submodule warning.
- `pnpm install --no-frozen-lockfile` succeeds.
- `pnpm -w run typecheck:libs && pnpm --filter=@workspace/jg-youth run build` produces
  `public/index.html` at the repo root.
- `pnpm --filter=@workspace/api-server run build` produces `dist/index.mjs`.
- Work on a branch; final real-world check is the Vercel/Railway deploy after the user
  pushes.

## Out of scope (later sub-projects)

- Backend auth consolidation onto `resolveAuth`, new endpoints, cascading delete.
- Schema migrations (phone uniqueness, etc.).
- The 12 known UI bugs against current code.
- Feature additions (duplicate prevention UX, profile completeness, attendance history,
  notification banners, first-timer → member flow).
- Full iOS/glass-morphism visual redesign.

## Commit

Single commit on a branch:
`chore(build): remove embedded repo and stray lockfile, harden build output`
