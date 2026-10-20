# Running on Replit

An Express gateway serves port 5000 and starts FastAPI on loopback port 5001.
The React/Vite frontend is built into `static/`, which FastAPI serves alongside
the `/api` routes.

## Run

The **Start application** workflow runs:

```sh
npx tsx server/index.ts
```

## Rebuild the frontend

After changing files under `frontend/`, install the dependencies from
`frontend/package-lock.json`, run the frontend `build` script, and restart the workflow.

## Temporary public access

`WSS_PUBLIC_READ_ONLY=true` disables Clerk and all account identities. Visitors
can select featured examples and explicitly published simulation versions without
signing in. Private drafts, version history, saving and publishing remain protected.
Never replace this with a fabricated authenticated user or make all drafts public.

Set the flag to `false` and configure Clerk before re-enabling account access.
WB institutional SSO still needs institutional identity-provider configuration.
`SESSION_SECRET` and the existing PostgreSQL `DATABASE_URL` are required in both
modes. Do not expose either value. Apply `simulation_management/schema.sql` to the
development database and include its schema when publishing; startup imports the
preserved examples idempotently and does not perform schema changes.

The publishing build rebuilds the frontend rather than relying on an old static
bundle. Restart the workflow after code or access-mode configuration changes.