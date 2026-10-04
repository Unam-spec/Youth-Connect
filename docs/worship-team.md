# Worship Team feature — plan

Branch: `feature/worship-team`. Right now only a "Coming soon" page exists at `/worship`, linked from the member dashboard (`/my`).

## Goal

Each worship team member has their own profile showing their personal song list, with the key they sing or play each song in and the lyrics. Everyone on the team can view every other member's profile. Only the owner can edit their own.

## Who can do what

| Action | Worship member | Worship leader | Everyone else |
|---|---|---|---|
| Edit own worship profile and song list | ✅ | ✅ | — |
| View other members' profiles | ✅ (read-only) | ✅ | — |
| Add songs to the shared song library | ✅ | ✅ | — |
| Edit or delete any song in the library | — | ✅ | — |
| Add or remove people from the team | — | ✅ | — |
| Build Sunday setlists | — | ✅ | — |

Being on the worship team is a flag on the existing `profiles` row (Clerk stays identity-only, as it is today). Super admins can grant the worship leader role.

## Screens

1. **`/worship`, the team page.** A grid of team members (photo, name, role such as "Vocals" or "Keys"). Tap a person to open their profile. A "My profile" button sits at the top.
2. **`/worship/members/:id`, a member profile.** The header shows name, role(s) and vocal range. Below it is their song list: each row has the song title, artist, *their* key as a badge (e.g. `G`), and tempo. Tap a song to open it. If it's your own profile, you get "Add song" and edit controls.
3. **`/worship/songs/:id`, a song.** Lyrics with chords above the lines. A key picker transposes the chords live. It opens in the viewer's own saved key when they have one, otherwise in the original key. Big-text "stage mode" for reading on a phone or tablet during practice.
4. **`/worship/library`, the shared library.** Every song the team knows, searchable. "Add to my list" saves it to your profile with your own key.
5. *(Phase 2)* **`/worship/setlists`.** A leader picks the songs for a date and assigns who leads each one. That person's key fills in automatically. The team gets a push notification through the existing notifications setup.

## Data model (Drizzle, `lib/db/src/schema`)

- `worship_members`: `profile_id` (FK, unique), `roles` (text[] such as vocals, keys, guitar, bass, drums), `vocal_range`, `is_worship_leader`, `bio`
- `songs`: `id`, `title`, `artist`, `original_key`, `tempo_bpm`, `lyrics_chordpro` (text, in ChordPro format so chords can be transposed), `created_by`
- `member_songs`: `worship_member_id`, `song_id`, `preferred_key`, `notes`, unique on (member, song)
- *(Phase 2)* `setlists` (`date`, `title`, `created_by`) and `setlist_songs` (`setlist_id`, `song_id`, `lead_member_id`, `key`, `position`)

Lyrics are stored once per song, so fixing a typo fixes it for everyone. Keys are stored per person.

## API (`lib/api-spec/openapi.yaml` → codegen)

- `GET /api/worship/members`, `GET /api/worship/members/:id` (includes their songs)
- `PATCH /api/worship/members/me`
- `GET/POST /api/worship/songs`, `GET/PATCH/DELETE /api/worship/songs/:id`
- `POST/PATCH/DELETE /api/worship/members/me/songs/:songId` (add, change key, remove)
- Leader only: `POST/DELETE /api/worship/members` (manage the roster), setlist endpoints

Every route checks that the caller is on the worship team. Write routes also check ownership or the leader role.

## Build order

1. Schema, migrations and API, with member and song CRUD
2. Team page, member profile and song view with transposing
3. Shared library and "add to my list"
4. Setlists and notifications

## Open questions

- Should song lyrics only be visible to the team, or to every member? (Copyrighted lyrics point toward team-only.)
- Do you already have a song list somewhere (a spreadsheet or WhatsApp notes) that we should import?
- Is CCLI / SongSelect integration wanted later?
