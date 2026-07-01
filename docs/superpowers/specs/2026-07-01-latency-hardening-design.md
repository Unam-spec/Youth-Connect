# Part C — Latency hardening

**Date:** 2026-07-01
**Status:** Approved design (scope: Part C — done first, before Parts A & B)
**Part of:** Gender targeting + analytics initiative (A = event/broadcast gender targeting, B = gender analytics). Part C is the app-wide performance base those two will land on.

## Goal

Bring the app to a **measured** sub-0.5s experience for South-African (Limpopo) users, on the **current TypeScript/Node stack** — no language rewrite, no new storage vendor. Concretely:

1. **Prove it, don't guess it** — add latency measurement so "under 0.5s" is a number we can see before and after.
2. **Fix the avatar payload** — the single biggest browser-side egress leak. Existing base64 avatars get compressed to **50–100 KB** on the way into Storage; new uploads are guaranteed small too.
3. **Cache hot reads** — using the Redis you already have installed.
4. **Settle hosting/region** — kill cold-starts and shorten the distance to users (needs a few facts from you; see *Inputs needed*).

### Latency budget (definition of done)
- **p95 API server-time < 150 ms** for hot GETs (`/dashboard/kpis`, `/dashboard/analytics-data`, `/profiles` directory page, `/events`), measured via `Server-Timing`.
- **End-to-end < 500 ms** for those from a South-African connection (server-time + network + render), with cold-starts eliminated.
- **Every avatar object ≤ 100 KB** (target band 50–100 KB; smaller is fine).

## 1. Measurement (do this FIRST — it's the baseline)

**Already present:** Sentry is initialised in `app.ts` with `tracesSampleRate: 1.0`, so per-route p95/latency data is *already being captured* — the baseline exists in the Sentry dashboard today.

Part C adds only the piece that's missing — **direct in-browser visibility**:
- Add a small Express middleware that times each request and emits a `Server-Timing: total;dur=…` response header (extensible to `db;dur=…` later). This shows up in the browser Network panel, so we can see the before/after on the directory + avatar loads without leaving devtools.
- Capture a short **baseline note** (current p95s from Sentry for the hot routes) before the avatar changes, so the wins are provable.

Rationale: the whole point of "optimize the current stack" is that we change what the numbers tell us to change. No optimization ships without a before/after.

## 2. Avatar pipeline

Today: `POST /profiles/avatar/upload` → multer (2 MB cap) → `uploadAvatar()` → Supabase Storage `avatars` bucket, returning the raw public object URL (`avatarUpload.ts`, `profiles.ts:743`). The migration script `migrateAvatarsToStorage.ts` moves base64 rows into Storage **verbatim** — no compression. So fat images stay fat. This section fixes that.

### 2a. Shared downscale util (`sharp`)
- Add `sharp` to `@workspace/api-server` deps. It is a **native module** — but `build.mjs` **already lists `sharp` in the esbuild `external` array**, so no build change is needed there. Just add it to root `package.json` `pnpm.onlyBuiltDependencies` (per the known pnpm-build gotcha) so its binary is allowed to build. Render builds on linux and installs the matching prebuilt binary.
- New `src/storage/downscaleAvatar.ts`: `downscaleAvatar(buffer) => Buffer` — resize so the longest edge ≤ **512 px**, auto-orient (honor EXIF rotation), re-encode **JPEG** with quality auto-tuned to land **≤ 100 KB** (start ~q82, step quality down if over; typical photos land 50–90 KB; simple images may fall under 50 KB, which is acceptable). One util, used by both the migration and the live upload path so behaviour is identical.

### 2b. Compress the images that are already there (the explicit ask)
- Rewrite `migrateAvatarsToStorage.ts` so that for each profile whose `avatar_url` is a `data:` URI, it decodes → **`downscaleAvatar()`** → uploads the compressed buffer → updates the row to the Storage URL.
- Make it **idempotent and re-runnable**: skip rows already pointing at Storage; log before/after byte sizes per profile and a final summary (`N migrated, total X MB → Y KB`).
- Add a `migrate:avatars` script to `api-server/package.json`. **Run it locally against production** (with prod `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) so `sharp` never has to run on Render for the backfill. Verify each resulting object is ≤ 100 KB.

### 2c. Guarantee new uploads stay small
- **Server (guarantee):** run every upload through `downscaleAvatar()` before storing, so no client can plant a fat image regardless of what it sends.
- **Client (bandwidth saver, for SA mobile data):** downscale in the browser via canvas to ~512 px / JPEG ~0.8 before POST, so users aren't uploading 2 MB over a slow link in the first place. (`my.tsx` already captures/handles the avatar image; this hooks into that path.)

### 2d. Serving
- Because objects are now ≤ 100 KB, the directory can serve the **stored object directly** and already be fast — no dependency on paid features.
- **Progressive enhancement (only if your Supabase plan includes Image Transformations):** request `…/render/image/public/avatars/<file>?width=128&quality=75` at each display site for pixel-perfect thumbnails. Gated on the plan check in *Inputs needed*; if the plan doesn't include it, we simply skip this and rely on the small originals.

## 3. Caching hot reads — ALREADY BUILT (no code)

This turned out to be done already:
- `src/lib/redis.ts` provides `getCache` / `setCache` / `invalidateCache` around Upstash Redis, env-gated (no-ops when `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are unset).
- `GET /api/dashboard/analytics-data` **already** checks `getCache(\`dashboard:analytics:<date>\`)` and returns the cached aggregate on hit (`routes/dashboard.ts:255`).

**Part C action:** operational only — confirm the two `UPSTASH_*` env vars are set in the Render prod environment (an unset value silently disables the cache — correct but slow). Part B's gender analytics will reuse this exact helper. No new code.

## 4. Hosting / region

The two things I can't see from the repo and that dominate real-world latency:
- **Cold-starts:** if the Render service is on a scale-to-zero tier, the first request after idle pays 30 s+. A warm/always-on instance removes that cliff.
- **Distance:** a US-region server serving Limpopo adds ~150–300 ms round-trip before any work runs. Server and Supabase DB should sit in the **same** region, as close to South Africa as the providers offer (EU regions are typically the nearest well-supported option).

Recommendation once we have the facts: warm instance + co-located API/DB region. This is config/billing, not code — I'll make the specific recommendation inside implementation once you confirm the *Inputs needed*.

## Inputs needed from you
1. **Render service:** plan/tier (does it sleep when idle?) and region.
2. **Supabase project region** (to co-locate with Render).
3. **Supabase plan:** does it include **Image Transformations**? (Decides §2d — thumbnails vs. small originals only.)
4. **Confirm the `avatars` bucket exists and is public**, and that `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set on Render (uploads silently fail without them).
5. **Confirm `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set on Render** — otherwise the already-built analytics cache silently no-ops.

## Testing
- **Unit:** `downscaleAvatar()` — output ≤ 100 KB and longest edge ≤ 512 px for a large fixture; EXIF orientation respected; already-small input stays valid. Cache helper — hit/miss and TTL behaviour; no-op when Redis unconfigured.
- **Migration:** dry-run count of `data:` rows; after run, every migrated object ≤ 100 KB and the row points at a Storage URL; re-running is a no-op.
- **Measurement:** `Server-Timing` header present on hot routes; baseline vs. post-change p95 recorded.
- **Manual:** upload a 4 MB photo → stored object ≤ 100 KB and displays correctly; directory initial load payload drops substantially (compare Network panel before/after).

## Surfaces
- `artifacts/api-server/src/storage/downscaleAvatar.ts` (new) + test.
- `artifacts/api-server/src/storage/avatarUpload.ts` — run buffer through `downscaleAvatar` before upload.
- `artifacts/api-server/src/scripts/migrateAvatarsToStorage.ts` — compress + idempotent + logging.
- Caching: no new file — `src/lib/redis.ts` + `routes/dashboard.ts` already implement it.
- `artifacts/api-server/src/lib/serverTiming.ts` (new middleware) + wired in `app.ts`.
- `artifacts/api-server/package.json` (+ `sharp` dep, `tsx` dev-dep, `migrate:avatars` script), root `package.json` (`onlyBuiltDependencies`). `build.mjs` already externalises `sharp` — no change.
- `artifacts/jg-youth/src/pages/my.tsx` — client-side canvas downscale before upload; optional thumbnail query params at avatar display sites if transforms are available.

## Non-goals (this part)
- No gender fields, targeting, or gender analytics (those are Parts A & B).
- No language/runtime rewrite; no storage-vendor change.
- The `profiles(gender)` index moves to **Part A**, where the queries that need it live.
