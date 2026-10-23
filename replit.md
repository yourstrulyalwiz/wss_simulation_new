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

## After task merges

The configured `scripts/post-merge.sh` installs all four npm projects from their
lockfiles, installs `requirements.txt` into Replit's managed Python user directory,
checks Python dependency compatibility, and rebuilds the main frontend and
component preview sandbox. The platform then reconciles running workflows.
The hook does not change database schemas or saved simulations, and does not
publish the application.

## Sign-in and saved simulations

The active setup is `WSS_AUTH_PROVIDER=replit` with
`WSS_PUBLIC_READ_ONLY=false`. Replit Auth uses the viewer's existing Replit
account, which can already be protected by the WB workspace's institutional SSO.
It does not require a separate app password or a new WB identity-provider tenant.
Signed-in users can create private simulations, duplicate examples, and save and
resume their own work. Preserved examples stay read only.

**Publishing must use Workspace only or Invite only inside the WB organization.**
Replit Auth proves account identity, not WB workspace membership. The publishing
access gate enforces approved workspace viewers. Never treat a Replit account,
a client-supplied identity header, or an email-domain guess as proof of membership.
App sign-out ends only the app session, not the person's WB workspace session.

The Clerk implementation remains available with `WSS_AUTH_PROVIDER=clerk`,
but requires its own configuration. Do not remap old Clerk-owned drafts to Replit
users by email; any ownership migration needs an explicit verified process.

For temporary read-only rollout, `WSS_PUBLIC_READ_ONLY=true` disables
all account identities regardless of the provider. Visitors
can select featured examples and explicitly published simulation versions without
signing in. Private drafts, version history, saving and publishing remain protected.
Never replace this with a fabricated authenticated user or make all drafts public.

`SESSION_SECRET` and the existing PostgreSQL `DATABASE_URL` are required in both
modes. Replit Auth also uses the platform-managed `REPL_ID`. Do not expose secret
values. Apply `simulation_management/schema.sql` to the
development database and include its schema when publishing; startup imports the
preserved examples idempotently and does not perform schema changes. Authentication
sessions are stored server-side in PostgreSQL, not browser localStorage.

The publishing build rebuilds the frontend rather than relying on an old static
bundle. Restart the workflow after code or access-mode configuration changes.