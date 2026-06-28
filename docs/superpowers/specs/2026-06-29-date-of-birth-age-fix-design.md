# Part 1 — Date of birth & always-correct ages

**Date:** 2026-06-29
**Status:** Approved design (scope: Part 1 only)
**Related (future):** Part 2 — Happy Birthday feature, Part 3 — Member directory split. Both build on this; neither is in scope here.

## Problem

The app stores a member's **age as a frozen integer** captured once at sign-up. There is no date of birth anywhere. Consequences observed in production:

- **"Everyone is 18."** The sign-up form (`register.tsx`) defaults `age: 18` and `gender: "male"`; people click past without changing them, so most records are literally `18` / `male`. The leader profile dialog also falls back to `18` when age is null (`dashboard.tsx:271` `setEditAge(profile.age ?? 18)`), reinforcing it.
- **"Some say 0."** Direct Clerk sign-ups create a profile with `age: 0` (`profiles.ts` `/profiles/me`), and other records have a blank age.
- **Ages never update.** Even a correct age is wrong a year later, because nothing recomputes it.

Root cause: a static `age` number cannot stay correct and cannot tell us *when* a birthday is. The fix is to capture **date of birth** and compute age live.

## Goals

1. Capture **date of birth (DOB)** for new sign-ups instead of a typed age.
2. Compute age **live from DOB** everywhere age is shown, so it is always correct.
3. Let **existing members add their birthday** via a gentle, optional one-time prompt — without inventing data for anyone.
4. Remove the silent `18` / `0` / `male` defaults so the problem can't recur.
5. Keep the **under-13 parental-consent** rule working (now based on computed age).

Non-goals (later parts): the birthday celebration UI, the leaders' birthday list, and the directory split/sort.

## Data model

Add a nullable date-of-birth column; **keep the existing `age` column** as a fallback/display value for records that don't have a DOB yet.

- `profiles.date_of_birth date NULL`
- `visitors.date_of_birth date NULL`

Migration is **additive and non-destructive** (no backfill, nothing dropped). Apply via Supabase migration (the project's migration path) and mirror into the Drizzle schema (`lib/db/src/schema/index.ts`) and the Supabase shared schema (`supabase/functions/_shared/schema.ts`).

**Write rule:** whenever a DOB is provided (sign-up or profile edit), derive `age = computeAge(dob)` and store **both** `date_of_birth` and `age`. This keeps the legacy `age` column consistent for any code still reading it, while DOB becomes the source of truth for live display.

## Age utility

A single pure helper, used by frontend and backend:

```ts
// computeAge("2008-06-29", today) -> integer years, or null if dob is null/invalid
function computeAge(dob: string | null, today = nowSAST()): number | null
```

- "Today" is computed in **South Africa time (UTC+2 / SAST)** to match the rest of the app.
- Years complete only after the birthday has passed this year (standard age math).
- `null` DOB → `null` (caller shows the stored `age` fallback, or "—").

Lives in a shared module importable by the api-server and the web app; the Supabase functions get a mirrored copy. (Birthday-detection helpers — "is it their birthday today/this week" — are added in Part 2.)

## Capture points (DOB in, age derived)

1. **Sign-up form** (`artifacts/jg-youth/src/pages/register.tsx`): replace the Age number field (and its `age: 18` default) with a **date-of-birth picker**. Validate: DOB is a real past date yielding age 5–100. Submit `date_of_birth` instead of `age`.
2. **Register backend** (`artifacts/api-server/src/routes/register.ts`): accept `date_of_birth`, validate (past date, age 5–100), derive `age`, store both on the visitor row. Remove reliance on a raw `age` field.
3. **Leader profile edit** (`DialogManager.tsx` + `dashboard.tsx`): replace the editable Age number input with a **DOB picker**, and show the resulting age **read-only** ("Age: 17"). Remove the `?? 18` and `"male"` fallbacks (`dashboard.tsx:271-272`) — blank stays blank.
4. **Leader profile PATCH** (`artifacts/api-server/src/routes/profiles.ts` `PATCH /profiles/:id`): accept `date_of_birth`, derive and store `age`.
5. **Self-update** (`PATCH /profiles/me` + `UpdateMyProfileBody` in `lib/api-zod`): allow `date_of_birth`; derive `age` on write.
6. **Direct Clerk auto-create** (`profiles.ts` `/profiles/me`): stop forcing `age: 0` / `gender: "other"` — leave `date_of_birth` null and `age` null so it reads as unknown, not a fake 0.

## Existing-member prompt

In the member home (`artifacts/jg-youth/src/pages/my.tsx`), reuse the existing optional-prompt pattern (same mechanism as the school/phone prompt) to show a one-time **"Add your birthday 🎂"** card to members whose `date_of_birth` is null. It is **dismissible** (not blocking). Saving calls `PATCH /profiles/me` with `date_of_birth`. Once set, the prompt never shows again for them.

## Display points (age computed live)

- Leader profile view/edit dialog → computed age (read-only), "—" when no DOB and no stored age.
- Anywhere `profile.age` is currently shown falls back to: `computeAge(date_of_birth) ?? stored age ?? "—"`.
- No analytics age chart exists today, so nothing else to update.

## Under-13 consent

`membershipConsent.ts` keeps `CONSENT_AGE = 13`. Its callers (promotion path) compute the subject's age as `computeAge(date_of_birth) ?? stored age` and pass that into `canGrantMembership`. Behaviour is unchanged for anyone with a known age; unknown age still requires consent (existing rule).

## Validation rules

- DOB must parse to a real calendar date and be **in the past**.
- Resulting age must be **5–100** (adjustable). Out of range → clear error on the form / 400 from the API.
- Existing records with no DOB are untouched and remain valid.

## Surfaces to keep in sync

- `lib/db/src/schema/index.ts` (Drizzle) + new migration.
- `supabase/functions/_shared/schema.ts` and the `register` / `profiles` Supabase functions (parity, even though Render is live).
- `lib/api-zod` body schema(s) for `date_of_birth`.

## Testing

- **Unit (`computeAge`):** birthday already passed this year; birthday later this year; birthday is today; day before birthday; **Feb 29** DOB in a non-leap year (treated as Feb 28); null/invalid input → null.
- **Validation:** future DOB rejected; age >100 / <5 rejected.
- **Consent:** under-13 (by computed age) still requires parent details + consent; 13+ passes; unknown age still requires consent.
- **Backend write:** posting a DOB stores both `date_of_birth` and a correctly derived `age`.

## Rollout

1. Migration (add columns) — safe, additive.
2. Backend (api-server) + shared schema + zod.
3. Frontend (sign-up DOB picker, edit dialog, member prompt).
4. Supabase parity.
5. Verify on the live app; existing members see the birthday prompt and their ages start correcting as they fill it in.
