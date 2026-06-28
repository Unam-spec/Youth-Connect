# Part 3 — Member directory split

**Date:** 2026-06-29
**Status:** Approved design (scope: Part 3)
**Builds on:** Parts 1 & 2 (directory endpoint already returns `gender`/`age`/`date_of_birth`).

## Goal

Split the leader-facing Member Directory into two tabs and add sorting:

- **Leaders** tab → roles `leader` + `super_admin`.
- **Members** tab → roles `member` + `visitor` (kept together, as requested).
- Within each tab: default **A–Z by name**, plus a **Sort** control offering **Newest first** and **Oldest first** (by join date / `created_at`).
- Search works within the active tab. Default tab: **Members**.

Currently the directory's `GET /api/profiles` returns rows in no defined order and mixes all roles, so this needs both backend (filter group + sort + ORDER BY) and frontend (tabs + sort control) work.

Non-goals: changing what a row displays, adding age/gender columns to the list, or touching the separate `/profiles/members-directory` endpoint.

## Backend — `GET /api/profiles`

Add two optional query params (backward compatible — omitting them preserves today's behaviour aside from a stable default order):

- `group`: `"leaders"` → roles `[leader, super_admin]`; `"members"` → roles `[member, visitor]`. When set, it determines the role filter (overriding the legacy single `role` param).
- `sort`: `"name"` (default) → `full_name ASC`; `"newest"` → `created_at DESC`; `"oldest"` → `created_at ASC`.

Combine with the existing `search` (name/phone ilike) and pagination. The role-group + sort resolution lives in a pure, unit-tested helper `resolveDirectoryListParams(query)` returning `{ roles?, sort, search?, page, pageSize, offset }`; the route applies `inArray(role, roles)`, the search filter, `ORDER BY`, and limit/offset.

Ordering note: `full_name` is compared case-insensitively (`lower(full_name)`) so "alice" and "Bob" sort naturally; ties broken by `created_at` for stable paging.

## Frontend — `MemberDirectoryPanel`

- Add a two-option tab control (**Members** | **Leaders**) and a **Sort** dropdown (**A–Z**, **Newest**, **Oldest**) above the list.
- State: `group` (default `"members"`), `sort` (default `"name"`). Both feed the existing infinite-scroll query: the query key becomes `[...profilesKey, "infinite", group, sort, debouncedSearch]`, and the fetch URL gains `group` and `sort` params.
- Switching tab or sort resets to page 1 (new query key) — the existing infinite-scroll/sentinel logic is unchanged otherwise.
- The Super-Admin slots banner and per-row menus/behaviour stay as-is.

## Testing

- **Unit (`resolveDirectoryListParams`):** `group=leaders` → `[leader,super_admin]`; `group=members` → `[member,visitor]`; no group → `roles` undefined (legacy); `sort` maps to name/newest/oldest with `name` as the fallback for missing/invalid; pagination math (page→offset, clamped pageSize).
- **Frontend:** typecheck + build; manual check that each tab shows only its roles and the three sort orders reorder correctly, with search still filtering within a tab.

## Surfaces

- New `artifacts/api-server/src/lib/directoryListParams.ts` (+ test).
- `artifacts/api-server/src/routes/profiles.ts` — `GET /profiles` uses the helper + `orderBy`.
- `artifacts/jg-youth/src/components/panels/MemberDirectoryPanel.tsx` — tabs + sort control + query wiring.

No database or schema changes.
