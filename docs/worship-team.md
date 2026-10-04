# Worship Team feature — plan

**Status:** all five steps below are built: accounts, join requests and approvals, profiles, the song library, personal song lists, chord charts that change key, stage mode, team-only notifications, Sunday setlists shareable to WhatsApp, and an invite link anyone on the team can send.

Code: `artifacts/api-server/src/routes/worship.ts` (API), `lib/worship*.ts` (auth, rules, notifications), `artifacts/jg-youth/src/pages/worship/` and `components/worship/` (screens). The tables are created when the server starts (`WORSHIP_SCHEMA` in `artifacts/api-server/src/db/index.ts`).

## Goal

Each worship team member has their own profile showing their personal song list, with the key they sing or play each song in and the lyrics. Everyone on the team can view every other member's profile. Only the owner can edit their own. When someone adds a song to their list, the rest of the worship team gets a notification.

## Its own membership, separate from JG Youth

Some worship team members are not JG Youth members, so the worship area is a **separate membership**:

- **Worship accounts are their own accounts.** They are not JG Youth profiles and not Clerk logins. You don't need to be a JG Youth member to join, and being a JG Youth member gives no access.
- If someone is in both, they have a JG Youth account and a separate worship account. The two are never linked, so worship data never appears in JG Youth and JG Youth data never appears in worship.
- **Signing in:** phone number + PIN. The PIN hashing and session code the app already uses for leaders can be reused, but in separate worship tables.
- **Joining:** anyone can tap "Request to join" on the worship sign-in page and enter their name, phone number, role and a PIN. Their request waits until a worship leader approves it.
- **Separate look and entry point.** `/worship` has its own design and no JG Youth header, footer or dashboard links. The only way in is a discreet **"Worship Team"** link in the landing page footer, next to "Leader Portal".
- **Checked on the server.** Every `/api/worship/*` route requires a worship session. A JG Youth login or leader PIN session does not work there, and the reverse is also true.

## Onboarding

The first time someone gets in (the head leader on sign-up, everyone else once accepted), a 7-step welcome opens: what their role means (head leader / leader / member wording), set up their profile (instruments, vocal range, saved straight away), add a first song or pick from the library, how keys and stage mode work, Sunday setlists (leaders get a shortcut to post one), turn on notifications, and invite someone. Skip or finish both mark it done on the server (`onboarded_at`, `POST /api/worship/me/onboarded`), so it shows once per person on any device. **Replay welcome** in the account menu reopens it.

Afterwards a **Getting started** checklist on the team page ticks itself off from real data (role picked, first song added, notifications on) and disappears when done or dismissed.

## Roles: head leader, leaders, members

Shaped like the JG Youth leader system (Super Admin → Leaders → Members). Everyone sees the same pages; leaders just have one extra responsibility.

| Action | Member | Leader | Head leader |
|---|---|---|---|
| Edit own profile and song list | ✅ | ✅ | ✅ |
| View everyone's profiles and songs | ✅ | ✅ | ✅ |
| Add songs to the shared library, edit own songs | ✅ | ✅ | ✅ |
| Get team notifications | ✅ | ✅ | ✅ |
| **Accept or decline join requests** (and get notified of them) | — | ✅ | ✅ |
| Create, edit and delete Sunday setlists | — | ✅ | ✅ |
| View and share setlists, invite people | ✅ | ✅ | ✅ |
| Make someone a leader, or switch a leader back to member | — | — | ✅ |
| Remove someone, reset a forgotten PIN | — | — | ✅ |
| Edit or delete anyone's song | — | — | ✅ |

- The **first person to sign up becomes the head leader** (stored as role `owner`). There is one head leader, who can't be removed, demoted or leave.
- If an account was created before the head-leader role existed, the server makes the earliest approved leader the head leader when it starts.
- Leaders and the head leader see a **"Join requests"** section at the top of the team page. Only the head leader sees the menu on each person.
- When someone is accepted, they get a notification: *"You're in! <name> accepted you onto the worship team 🎉"*. While waiting, they can tap "Notify me when I'm accepted" to get it as a push notification.

## Notifications (worship team only)

- **Trigger:** a member adds a song to their list → every *other* approved worship member gets a push notification, e.g. *"Thabo added 'Way Maker' (key of G) to his list"* (with his/her/their filled in to match the member). Tapping it opens that song.
- **Only worship members receive them.** Worship devices are stored in their own table (`worship_push_subscriptions`, tied to worship accounts). A JG Youth push sign-up never receives worship notifications.
- The existing push sender (`pushSender.ts`, VAPID keys) is reused. Only the list of devices it sends to is different.
- **In-app inbox:** a bell icon on the worship page lists recent activity, so people who haven't turned on push notifications still see what's new.
- Each member can mute notifications in their profile settings.
- The head leader and leaders get a notification when someone requests to join. The person who joined is notified when they are accepted.
- Later: notifications for "new setlist published" and "you've been assigned to lead a song".

## Screens

1. **`/worship`:** for signed-out people, a sign-in page (phone + PIN) plus a "Request to join" option. After requesting, people see "Waiting for a leader to approve you". For approved members it shows the team page.
2. **The team page (`/worship`):** a grid of approved members (photo, name, role such as "Vocals" or "Keys", and a "Leader" badge), a bell icon for notifications, and a "My profile" button. Leaders also see join requests at the top, and a menu on each person with "Make leader" and "Remove".
3. **`/worship/members/:id`, a member profile:** name, role(s) and vocal range, then their song list: each row shows the title, artist, *their* key as a badge, and tempo. On your own profile you get "Add song" and edit controls.
4. **`/worship/songs/:id`, a song:** lyrics with chords above the lines. A key picker transposes the chords live, opening in the viewer's own saved key. Big-text "stage mode" for practice.
5. **`/worship/library`, the shared library:** every song the team knows, searchable. "Add to my list" saves it with your own key and notifies the team.
6. **`/worship/setlists`:** everyone sees upcoming and past setlists. The head leader and leaders create and edit them: a date (defaults to next Sunday), an optional title and notes, and ordered songs, each with who leads it and the key. A key left on "Lead's key" uses that person's own key for the song, else the original. **Share to WhatsApp** (and Copy) sends a formatted list with a link to the chords. Posting one notifies the rest of the team.
7. **Invite:** an "Invite someone to the team" card on the team page plus a button in the header, for everyone. It sends a WhatsApp message explaining the worship area with a link to `/worship?join=1`, which opens straight on "Request to join".

## Data model (Drizzle, `lib/db/src/schema`)

All tables are separate from `profiles`. None have a foreign key to JG Youth tables.

- `worship_accounts`: `id`, `full_name`, `phone` (unique), `pin_hash`, `instruments` (text[]: vocals, keys, guitar, bass, drums…), `vocal_range`, `bio`, `role` (leader / member), `status` (pending / approved; declined or removed accounts are deleted), `notifications_muted`, timestamps
- `worship_sessions`: one row per signed-in device (same pattern as the existing sessions table)
- `worship_push_subscriptions`: `account_id`, `endpoint` (unique), `p256dh`, `auth`
- `worship_notifications`: `id`, `recipient_id`, `actor_id`, `type` (song_added, join_request…), `song_id`, `read_at`, `created_at`, which feeds the in-app inbox
- `worship_songs`: `id`, `title`, `artist`, `original_key`, `tempo_bpm`, `lyrics` (chords inline in brackets, e.g. `[G]Amazing [C]grace`, so they can be transposed), `created_by`
- `worship_member_songs`: `account_id`, `song_id`, `preferred_key`, `notes`, unique on (member, song)
- `worship_setlists`: `id`, `service_date`, `title`, `notes`, `created_by`, timestamps
- `worship_setlist_songs`: `setlist_id`, `song_id`, `lead_id`, `song_key`, `position`

Lyrics are stored once per song. Keys are stored per person.

## API (`lib/api-spec/openapi.yaml` → codegen)

- Auth: `POST /api/worship/auth/login`, `POST /api/worship/auth/join` (creates a pending request), `POST /api/worship/auth/logout`
- `GET /api/worship/members`, `GET /api/worship/members/:id`, `PATCH /api/worship/members/me`
- `GET/POST /api/worship/songs`, `GET/PATCH/DELETE /api/worship/songs/:id`
- `POST/PATCH/DELETE /api/worship/members/me/songs/:songId`. The POST also creates notifications and sends pushes, in the background so adding a song stays fast.
- `GET /api/worship/notifications`, `POST /api/worship/notifications/read`
- `POST/DELETE /api/worship/push/subscribe`
- Leader only: `GET /api/worship/requests`, `POST /api/worship/requests/:id/approve` and `/decline`, `PATCH /api/worship/members/:id` (change role), `DELETE /api/worship/members/:id`
- Setlists: `GET /api/worship/setlists`, `GET /api/worship/setlists/:id` (everyone); `POST`, `PUT /:id`, `DELETE /:id` (head leader + leaders)

## Build order

1. Worship accounts, sign-in, join requests and leader approvals
2. Songs, personal song lists and the profile pages
3. Notifications (push + in-app inbox) when a song is added
4. Song view with transposing, the shared library
5. Setlists

## Open questions

- Should song lyrics only be visible to the team? (Yes for now, since lyrics are often copyrighted.)
- Is there an existing song list (a spreadsheet or WhatsApp notes) we should import?
- Is CCLI / SongSelect integration wanted later?
