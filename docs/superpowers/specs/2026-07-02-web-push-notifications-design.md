# Web Push Notifications — Design

**Date:** 2026-07-02
**Status:** Approved
**Goal:** Reach members *outside* the app for free — no Twilio, no per-message fees — so they return to the app without being personally asked.

## Problem

The in-app check-in reminder banner only helps members who already opened the app. The real problem is re-engagement: members don't come back unless a leader personally messages them. Paid messaging (Twilio SMS/WhatsApp API) is not affordable. We need a free outbound channel.

## Decision

**Web Push notifications (VAPID)**, sent directly from the existing Render api-server via the `web-push` npm package. Apple/Google push servers carry the messages for free; we sign and send them. Chosen over building on Supabase Edge Functions (migration incomplete; would delay shipping) and over Telegram/email (wrong channels for this audience).

**Audience reality:** mostly iPhone with a large Android minority.

- Android / desktop: push works after a single permission prompt.
- iPhone iOS 16.4+: push works only after the app is added to the Home Screen (PWA install), then permission is granted inside the installed app.
- iPhone below iOS 16.4: no push possible — covered by the in-app banner and WhatsApp follow-up ladder (both remain as fallback layers).

**Phase 1 triggers (this project):**
1. Check-in window opens → automatic push to all subscribed members.
2. Event announcement → leader explicitly taps "Notify members" (option 2 chosen; no auto-blast on event creation), respecting the event's `target_gender`, capped at one blast per event per 24h.

**Phase 2 (later, reuses the same pipes):** inactivity nudges (1/2/4-week ladder) and birthday notifications — each is just another caller of `sendPushToProfiles()`.

## Backend (artifacts/api-server)

### Table `push_subscriptions`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| profile_id | FK → profiles | one member, many devices |
| endpoint | text, unique | push service URL from the browser |
| p256dh | text | client encryption key |
| auth | text | client auth secret |
| user_agent | text | debugging aid |
| created_at | timestamptz | |

Schema kept deliberately plain to port 1:1 to Supabase later.

### `lib/pushSender.ts`
Wraps `web-push`. Core function `sendPushToProfiles(profileIds, payload)` where payload = `{ title, body, url }`. On `404`/`410 Gone` responses the subscription row is deleted (self-cleaning). VAPID keys from env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto).

### `routes/push.ts`
- `POST /api/push/subscribe` — member-facing via `resolveAccount()` (supports Clerk *and* username+PIN accounts). Upserts by endpoint.
- `POST /api/push/unsubscribe` — removes by endpoint.
- `GET /api/push/public-key` — frontend fetches the VAPID public key (avoids duplicating env vars on Vercel).
- `POST /api/push/test` — authenticated; sends a "🎉 Notifications are working!" push to the caller's own devices. Used for verification.

### `POST /api/events/:id/notify` (routes/events.ts)
Leader-only (`requireLeaderSession("leader")`). Loads the event, filters subscribed members by the event's `target_gender`, sends the event push, records `last_notified_at` on the event, and rejects if last notified < 24h ago. Response includes how many members were reached.

### Check-in push (jobs)
Hooks into the existing follow-up generator tick (`jobs/followUpGenerator.ts`), which already computes check-in windows. When the tick detects the window just opened, push "Check-in is open! Tap to check in 🙌" to all subscribed members. Uses the same fired-once-per-window dedupe marker pattern already in the job so Render restarts cannot double-send.

## Frontend (artifacts/jg-youth)

- **PWA manifest + icons** (192px / 512px PNG generated from the existing logo) so the app installs to the home screen with a proper name and icon.
- **Service worker `public/sw.js`** (~40 lines): `push` event → `showNotification`; `notificationclick` → focus or open the payload's `url`.
- **`NotificationSetupCard`** on the member dashboard (`pages/my.tsx`), platform-aware:
  - Android/desktop: one tap → permission prompt → subscribe → done.
  - iPhone, not installed: illustrated steps ("Share → Add to Home Screen → open from home screen"), enable button appears once running in standalone mode.
  - iPhone below iOS 16.4 (no push API): card hides itself.
  - Already subscribed: card collapses to a small "notifications on" state with a disable option.
- **"Notify members" button** for leaders on the event form/detail page — shows reach count and last-sent time, disabled during the 24h cap.

## Notification content

| Trigger | Message | Tap opens |
|---|---|---|
| Check-in window opens | "Check-in is open! Tap to check in 🙌" | `/checkin` |
| Leader notifies event | "📅 {title} — {day, time}. Tap for details" | `/my` (no event-detail page exists; the dashboard lists events) |

Tone: short and warm. Channel trust is protected by leader-initiated-only event blasts and the 24h cap.

## Relationship to existing work

The in-progress in-app reminder plan is unchanged and complementary:
- In-app check-in banner (tasks 1–3) = fallback layer for members without push.
- WhatsApp `[Link]` template tasks (4–6) = human backstop layer.
- Push = top layer. Nobody falls through all three.

## Error handling & edge cases

- Expired/revoked subscriptions: deleted on 404/410 from the push service.
- Duplicate check-in pushes across restarts: prevented by the DB-backed fired-once-per-window marker.
- Permission denied: card shows a gentle "notifications blocked — enable in browser settings" state; never re-prompts aggressively.
- Multiple devices per member: all receive the push; each failing endpoint is cleaned up independently.
- Payload size: kept under the 4KB web-push limit (title + body + url only).

## Verification

1. Unit tests: gender-targeting recipient query; once-per-window dedupe; 24h event-notify cap.
2. `npx web-push generate-vapid-keys` → keys into Render env.
3. Deploy; enable notifications on one Android device and one iPhone (via home-screen install); hit `POST /api/push/test`.
4. Trigger a real check-in window open and a leader event notify; confirm phones buzz with the app closed and taps deep-link correctly.

## Out of scope

- Inactivity nudges and birthday pushes (Phase 2).
- Notification preferences/granular opt-outs per category (revisit if members ask).
- Supabase port of the push tables/sender (happens with the broader migration).
