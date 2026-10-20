# StudyQuest — CLAUDE.md

Study-library SaaS. Next.js 16 (App Router) · React 19 · TS · Tailwind v4 · Mongoose (MongoDB replica set) · TanStack Query · Zustand · RHF + Zod. npm (not yarn).

## Token rules (follow every prompt)
- Do the task directly. No plans, recaps, or explanations unless asked. Reply in ≤3 lines.
- Don't explore broadly. Use the map below, then `Grep` for the symbol; read only the needed line range (`offset`/`limit`).
- Never read: `artifacts/`, `package-lock.json`, `public/icons/`, `PROGRESS.md`, `RELEASE_READINESS.md`, `docs/` — unless the task is about them.
- Edit with small `Edit`s; don't rewrite whole files. Don't re-read files after editing.
- Verify only what you touched: `npx tsc --noEmit`, and `npx tsx --test tests/<area>.test.ts` for the related test. Skip `build`/full suites unless asked.
- No subagents, no new docs/README files, no refactors beyond the request.
- Next 16 differs from training data (see AGENTS.md): check `node_modules/next/dist/docs/` only when using an unfamiliar Next API.

## Map
- `src/app/[[...slug]]/page.tsx` — single catch-all page; screens are client components in `src/components/`.
- `src/app/api/<feature>/route.ts` — API routes (auth, punch, join, billing, crm, prep, saas-admin, …).
- `src/app/l/[slug]` — public library page.
- `src/components/<feature>.tsx` — UI per feature (saas-owner = owner dashboard, experience = student, auth, join, prep, community…). Shared bits: `ui-bits.tsx`, `providers.tsx`.
- `src/lib/` — server logic per feature (same names as routes). Models: `models.ts`, `saas-models.ts`, `ops-models.ts`. DB: `db.ts`. Auth/session: `auth.ts`. Env: `env.ts`. Security/rate limit: `security.ts`.
- `tests/<feature>.test.ts` — node test runner via tsx.
- `scripts/` — seed, worker, backup, admin bootstrap.

## Conventions
- Money = integer paise; shift times = minutes from midnight; timestamps UTC; display INR.
- Validate API input with Zod; multi-doc writes use Mongo transactions.
- Commands: `npm run dev | typecheck | lint | test | format`.
