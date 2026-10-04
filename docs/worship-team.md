# Worship Team feature — plan

Branch: `feature/worship-team`. Right now only a "Coming soon" page exists at `/worship`.

## Goal

Each worship team member has their own profile showing their personal song list, with the key they sing or play each song in and the lyrics. Everyone on the team can view every other member's profile. Only the owner can edit their own. When someone adds a song to their list, the rest of the worship team gets a notification.

## Its own membership, separate from JG Youth

Some worship team members are not JG Youth members, so the worship area is a **separate membership**:

- **Worship accounts are their own accounts.** They are not JG Youth profiles and not Clerk logins. You don't need to be a JG Youth member to join, and being a JG Youth member gives no access.
- If someone is in both, they have a JG Youth account and a separate worship account. The two are never linked, so worship data never appears in JG Youth and JG Youth data never appears in worship.
- **Signing in:** phone number + PIN. The PIN hashing and session code the app already uses for leaders can be reused, but in separate worship tables.
- **Joining:** a worship leader shares an invite link or code. A new person signs up with it, and their account stays *pending* until a worship leader approves it.
- **Separate look and entry point.** `/worship` has its own design and no JG Youth header, footer or dashboard links. The only way in is a discreet **"Worship Team"** link in the landing page footer, next to "Leader Portal".
- **Checked on the server.** Every `/api/worship/*` route requires a worship session. A JG Youth login or leader PIN session does not work there, and the reverse is also true.

## Who can do what

| Action | Worship member | Worship leader | Anyone else (incl. JG Youth members) |
|---|---|---|---|
| Edit own worship profile and song list | ✅ | ✅ | — |
| View other members' profiles | ✅ (read-only) | ✅ | — |
| Add songs to the shared song library | ✅ | ✅ | — |
| Receive worship notifications | ✅ | ✅ | — |
| Edit or delete any song in the library | — | ✅ | — |
| Invite, approve or remove team members | — | ✅ | — |
| Build Sunday setlists | — | ✅ | — |

A super admin creates the first worship leader account. From then on, the worship team manages itself.

## Notifications (worship team only)

- **Trigger:** a member adds a song to their list → every *other* approved worship member gets a push notification, e.g. *"Thabo added 'Way Maker' (key of G) to his list"* (with his/her/their filled in to match the member). Tapping it opens that song.
- **Only worship members receive them.** Worship devices are stored in their own table (`worship_push_subscriptions`, tied to worship accounts). A JG Youth push sign-up never receives worship notifications.
- The existing push sender (`pushSender.ts`, VAPID keys) is reused. Only the list of devices it sends to is different.
- **In-app inbox:** a bell icon on the worship page lists recent activity, so people who haven't turned on push notifications still see what's new.
- Each member can mute notifications in their profile settings.
- Later: notifications for "new setlist published" and "you've been assigned to lead a song".

## Screens

1. **`/worship`:** a sign-in page (phone + PIN), plus a "Join with an invite code" option.
2. **`/worship/team`, the team page:** a grid of approved members (photo, name, role such as "Vocals" or "Keys"), a bell icon for notifications, and a "My profile" button.
3. **`/worship/members/:id`, a member profile:** name, role(s) and vocal range, then their song list: each row shows the title, artist, *their* key as a badge, and tempo. On your own profile you get "Add song" and edit controls.
4. **`/worship/songs/:id`, a song:** lyrics with chords above the lines. A key picker transposes the chords live, opening in the viewer's own saved key. Big-text "stage mode" for practice.
5. **`/worship/library`, the shared library:** every song the team knows, searchable. "Add to my list" saves it with your own key and notifies the team.
6. **`/worship/admin`, worship leader only:** invite codes, pending approvals, and removing members.
7. *(Phase 2)* **`/worship/setlists`:** a leader builds the songs for a date and chooses who leads each one. Each leader's key fills in automatically.

## Data model (Drizzle, `lib/db/src/schema`)

All tables are separate from `profiles`. None have a foreign key to JG Youth tables.

- `worship_accounts`: `id`, `full_name`, `phone` (unique), `pin_hash`, `photo_url`, `roles` (text[]: vocals, keys, guitar, bass, drums…), `vocal_range`, `bio`, `is_worship_leader`, `status` (pending / approved / removed), `notifications_muted`, timestamps
- `worship_sessions`: one row per signed-in device (same pattern as the existing sessions table)
- `worship_invites`: `code`, `created_by`, `expires_at`, `uses_left`
- `worship_push_subscriptions`: `worship_account_id`, `endpoint` (unique), `p256dh`, `auth`
- `worship_notifications`: `id`, `recipient_id`, `actor_id`, `type` (song_added…), `song_id`, `read_at`, `created_at`, which feeds the in-app inbox
- `songs`: `id`, `title`, `artist`, `original_key`, `tempo_bpm`, `lyrics_chordpro` (ChordPro text, so chords can be transposed), `created_by`
- `member_songs`: `worship_account_id`, `song_id`, `preferred_key`, `notes`, unique on (member, song)
- *(Phase 2)* `setlists`, `setlist_songs`

Lyrics are stored once per song. Keys are stored per person.

## API (`lib/api-spec/openapi.yaml` → codegen)

- Auth: `POST /api/worship/auth/login`, `POST /api/worship/auth/join` (invite code), `POST /api/worship/auth/logout`
- `GET /api/worship/members`, `GET /api/worship/members/:id`, `PATCH /api/worship/members/me`
- `GET/POST /api/worship/songs`, `GET/PATCH/DELETE /api/worship/songs/:id`
- `POST/PATCH/DELETE /api/worship/members/me/songs/:songId`. The POST also creates notifications and sends pushes, in the background so adding a song stays fast.
- `GET /api/worship/notifications`, `POST /api/worship/notifications/read`
- `POST/DELETE /api/worship/push/subscribe`
- Leader only: invites, approvals, removing members, setlists

## Build order

1. Worship accounts, sign-in, invites and approvals
2. Songs, personal song lists and the profile pages
3. Notifications (push + in-app inbox) when a song is added
4. Song view with transposing, the shared library
5. Setlists

## Open questions

- Should song lyrics only be visible to the team? (Yes for now, since lyrics are often copyrighted.)
- Is there an existing song list (a spreadsheet or WhatsApp notes) we should import?
- Is CCLI / SongSelect integration wanted later?
