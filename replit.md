# Jeremiah Generation

A full-stack church youth registration and attendance tracking web app for Jeremiah Generation (JG Youth AFM). Internal tool for youth group leaders to manage members, events, attendance, and RSVPs.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/jg-youth run dev` — run the frontend (auto-port, serves at `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required env: `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` — auto-provisioned via Clerk

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Wouter + TanStack Query + Tailwind CSS v4
- Auth: Clerk (Replit-managed, role-based)
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (zod/v4), drizzle-zod
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for API contracts
- `lib/db/src/schema/index.ts` — database schema (Drizzle)
- `lib/api-client-react/src/generated/` — generated React Query hooks (do not edit)
- `lib/api-zod/src/generated/` — generated Zod schemas for server (do not edit)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/jg-youth/src/` — React frontend

## Role Hierarchy

1. **Super Admin** — max 3 accounts, controls everything
2. **Leader** — access controlled by Super Admin, can create events/manage attendance
3. **Member** — registered returning youth, has personal dashboard, can RSVP
4. **Visitor** — first-time registrant, can request to become member
5. **Guest** — unregistered, sees only public landing page

## Architecture decisions

- PIN-based auth for leaders alongside Clerk (leaders may not have Clerk accounts)
- Leader PIN session stored in localStorage with 8h expiry
- QR codes are slugs in DB, evergreen (regeneratable) via /api/qrcodes/regenerate
- Role stored in `profiles` table, not in Clerk (Clerk is identity only)
- All public pages (landing, register, checkin) are accessible without auth
- Bcrypt used for PIN hashing server-side

## Product

- Public landing page with live KPIs and event listing
- First-timer registration with kiosk mode support
- Self check-in via name/phone search
- Leader PIN login (rate-limiting scaffold included)
- Member personal dashboard with RSVP management
- Leader dashboard: attendance, members, events, membership requests, leader management, settings
- QR code generation (public + leader) with slug-based routing

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Always run `pnpm --filter @workspace/api-spec run codegen` after changing `lib/api-spec/openapi.yaml`
- Always run `pnpm run typecheck:libs` after changing `lib/db/src/schema/index.ts` to rebuild declarations
- Then run `pnpm --filter @workspace/db run push` to sync the schema to the database
- Clerk proxy middleware must be mounted before body parsers in app.ts
- tailwindcss({ optimize: false }) in vite.config.ts is required for Clerk UI to work in production
- The @layer declaration must come before @import 'tailwindcss' in index.css

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
