# Build & Deploy Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Vercel and Railway builds reliable and warning-free — one lockfile, no accidental embedded git repo, deterministic frontend build output.

**Architecture:** Remove a stale embedded git repository and a stray committed lockfile backup, guard against future lockfile backups via `.gitignore`, and narrow the frontend build's output-copy step from a 4-target "shotgun" to the single correct destination that fails loudly. `vercel.json` and `railway.toml` are already correct and stay as-is (one verified, one unchanged by design).

**Tech Stack:** pnpm monorepo, Git, Vite (frontend build), esbuild (backend build), Vercel, Railway.

**Spec:** `docs/superpowers/specs/2026-06-01-build-deploy-stability-design.md`

**Branch:** `build-deploy-stability` (already created and checked out; spec already committed there).

---

### Task 1: Remove the accidental embedded git repository

**Files:**
- Delete (working tree): `Youth-Connect/` (the nested folder, including its `.git/`)
- Untrack (git index): the `Youth-Connect` gitlink entry

This nested folder is its own git repo (mode-160000 gitlink in the parent), which causes
the "embedded git repository" / submodule warning on every Vercel clone. There is no
`.gitmodules`, so it is accidental. It is a stale duplicate of the repo we are in.

- [ ] **Step 1: Confirm the current bad state**

Run: `git status --porcelain`
Expected: a line `M Youth-Connect` (or ` M Youth-Connect`) is present, confirming the gitlink.

Also confirm it is a gitlink, not a normal tracked tree:
Run: `git ls-files --stage Youth-Connect`
Expected: a single entry beginning with mode `160000` (commit gitlink), e.g.
`160000 <sha> 0	Youth-Connect`.

- [ ] **Step 2: Untrack the gitlink**

Run: `git rm --cached Youth-Connect`
Expected: output `rm 'Youth-Connect'`. This removes the gitlink from the index without
touching the working-tree files yet.

- [ ] **Step 3: Delete the working-tree folder (including its nested .git)**

PowerShell:
```powershell
Remove-Item -Recurse -Force "C:\Users\Cash\Youth-Connect\Youth-Connect"
```
Expected: no output, no error. The nested folder is gone.

- [ ] **Step 4: Verify the gitlink is gone and the folder is gone**

Run: `git status --porcelain`
Expected: NO line referencing `Youth-Connect` as a gitlink. The staged deletion may show
as `D  Youth-Connect` in `git status` (long form) — that is correct (a staged removal).

Run (PowerShell): `Test-Path "C:\Users\Cash\Youth-Connect\Youth-Connect"`
Expected: `False`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(build): remove accidental embedded Youth-Connect git repo"
```
Expected: commit succeeds; the diff shows deletion of the `Youth-Connect` gitlink.

---

### Task 2: Remove the stray committed lockfile backup

**Files:**
- Delete (git + working tree): `pnpm-lock.yaml.3469179071`

`pnpm-lock.yaml.3469179071` is a pnpm backup file that was committed to git. Only
`pnpm-lock.yaml` should exist as the single source of truth.

- [ ] **Step 1: Confirm it is tracked**

Run: `git ls-files pnpm-lock.yaml.3469179071`
Expected: prints `pnpm-lock.yaml.3469179071` (confirming it is tracked).

- [ ] **Step 2: Confirm exactly one real lockfile exists**

Run (PowerShell): `Get-ChildItem -Force "C:\Users\Cash\Youth-Connect" -Filter "pnpm-lock.yaml*" | Select-Object Name`
Expected: shows `pnpm-lock.yaml` and `pnpm-lock.yaml.3469179071`. (No `package-lock.json`
should exist anywhere at root — confirm with `git ls-files package-lock.json` returning nothing.)

- [ ] **Step 3: Remove the backup from git and disk**

Run: `git rm pnpm-lock.yaml.3469179071`
Expected: output `rm 'pnpm-lock.yaml.3469179071'`.

- [ ] **Step 4: Verify only the canonical lockfile remains**

Run (PowerShell): `Get-ChildItem -Force "C:\Users\Cash\Youth-Connect" -Filter "pnpm-lock.yaml*" | Select-Object Name`
Expected: shows only `pnpm-lock.yaml`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(build): remove stray committed pnpm-lock backup"
```
Expected: commit succeeds.

---

### Task 3: Prevent future lockfile backups from being committed

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add an ignore rule for pnpm lock backups**

Append to `.gitignore` (after the existing `# dependencies` / `node_modules` block, a new section):

```gitignore
# pnpm lockfile backups (never commit these; keep only pnpm-lock.yaml)
pnpm-lock.yaml.*
```

- [ ] **Step 2: Verify the rule works**

Create a throwaway backup-named file and confirm git ignores it:
```bash
touch pnpm-lock.yaml.testignore
git status --porcelain pnpm-lock.yaml.testignore
```
Expected: NO output (file is ignored). Then remove it:
```bash
rm pnpm-lock.yaml.testignore
```

Confirm the canonical lockfile is NOT accidentally ignored:
Run: `git check-ignore -v pnpm-lock.yaml`
Expected: NO output and exit code 1 (i.e. `pnpm-lock.yaml` is tracked, not ignored).
The rule `pnpm-lock.yaml.*` requires a trailing dot+suffix, so `pnpm-lock.yaml` itself
does not match.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore(build): gitignore pnpm-lock.yaml backups"
```
Expected: commit succeeds.

---

### Task 4: Verify vercel.json (no change expected)

**Files:**
- Verify only: `vercel.json`

The spec keeps `vercel.json` as-is, including the `typecheck:libs` gate. This task is a
verification gate, not an edit.

- [ ] **Step 1: Confirm the three relevant fields**

Read `vercel.json` and confirm exactly:
- `"installCommand": "pnpm install --no-frozen-lockfile"`
- `"buildCommand": "pnpm -w run typecheck:libs && pnpm --filter=@workspace/jg-youth run build"`
- `"outputDirectory": "public"`

Expected: all three match. If any differ, STOP and re-confirm with the spec author —
do not silently edit.

- [ ] **Step 2: No commit**

No change is made in this task. Nothing to commit.

---

### Task 5: Make the frontend build output deterministic

**Files:**
- Modify: `artifacts/jg-youth/build-vercel.cjs`

The script currently copies `dist/public` into 4 candidate destinations (`public`,
`dist`, `../../public`, `../../dist`) and swallows per-destination copy errors. Vercel's
root is the repo root and `outputDirectory` is `public`, so the one correct destination
is repo-root `public/` — which is `../../public` relative to the package directory
(`artifacts/jg-youth`). Narrow to that single target and fail loudly on copy error.

- [ ] **Step 1: Replace the script body with the deterministic version**

Overwrite `artifacts/jg-youth/build-vercel.cjs` with exactly:

```js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Run the Vite build. Vite is configured to emit into dist/public.
execSync('vite build --config vite.config.ts', { stdio: 'inherit' });

const source = path.resolve(__dirname, 'dist/public');

// Vercel's Root Directory is the repo root and outputDirectory is "public",
// so the one correct destination is repo-root/public.
const dest = path.resolve(__dirname, '../../public');

if (!fs.existsSync(source)) {
  console.error(`Build output not found at ${source}`);
  process.exit(1);
}

// Replace any previous output, then copy. Any failure here must fail the build.
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(source, dest, { recursive: true });
console.log(`Copied build output to ${dest}`);
```

Rationale for choices:
- No outer `try/catch`: `execSync` with a non-zero exit already throws and exits non-zero,
  and `cpSync`/`rmSync` failures now propagate (loud failure) instead of being swallowed.
- `fs.rmSync(dest, ...)` clears stale output before copying so removed source files do not
  linger in `public/`.

- [ ] **Step 2: Run the frontend build and confirm deterministic output**

Run: `pnpm --filter=@workspace/jg-youth run build`
Expected: Vite build logs, then `Copied build output to <repo-root>/public`. Exit code 0.

Run (PowerShell): `Test-Path "C:\Users\Cash\Youth-Connect\public\index.html"`
Expected: `True`.

- [ ] **Step 3: Commit**

```bash
git add artifacts/jg-youth/build-vercel.cjs
git commit -m "chore(build): copy frontend output to the single correct dir, fail loudly"
```
Expected: commit succeeds.

---

### Task 6: Full build verification gate

No files change in this task. It is the end-to-end verification that both build targets
succeed after all the above changes.

- [ ] **Step 1: Clean install with the single lockfile**

Run: `pnpm install --no-frozen-lockfile`
Expected: completes without lockfile conflict errors; exit code 0.

- [ ] **Step 2: Frontend typecheck + build (mirrors Vercel)**

Run: `pnpm -w run typecheck:libs && pnpm --filter=@workspace/jg-youth run build`
Expected: typecheck passes, Vite build succeeds, `public/index.html` exists at repo root.

- [ ] **Step 3: Backend build (mirrors Railway)**

Run: `pnpm --filter=@workspace/api-server run build`
Expected: esbuild succeeds; `artifacts/api-server/dist/index.mjs` exists.

Run (PowerShell): `Test-Path "C:\Users\Cash\Youth-Connect\artifacts\api-server\dist\index.mjs"`
Expected: `True`.

- [ ] **Step 4: Final git cleanliness check**

Run: `git status --porcelain`
Expected: no `Youth-Connect` gitlink line, no `pnpm-lock.yaml.3469179071` line. Only
expected build artifacts (which are gitignored: `dist`, `public` — note `public` is the
Vercel output dir; confirm whether it is gitignored and, if it appears as untracked,
leave it — it is build output, not source).

- [ ] **Step 5: No commit**

This task only verifies. The branch `build-deploy-stability` now contains: the spec, the
embedded-repo removal, the lockfile-backup removal, the `.gitignore` rule, and the
`build-vercel.cjs` change.

---

## Notes for the implementer

- `railway.toml` is intentionally unchanged (separate `buildCommand`/`startCommand` is the
  correct Railway pattern). Do not merge them.
- The real-world final check is the Vercel and Railway deploy after the user pushes the
  branch / merges to `main`. The user triggers that; do not push or merge without being
  asked.
