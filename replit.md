# Running on Replit

The application is served as one FastAPI web process. The React/Vite frontend is built into
`static/`, which FastAPI serves alongside the `/api` routes.

## Run

The **Start application** workflow runs:

```sh
uvicorn app:app --host 0.0.0.0 --port 5000
```

## Rebuild the frontend

After changing files under `frontend/`, install the dependencies from
`frontend/package-lock.json`, run the frontend `build` script, and restart the workflow.

No external service credentials are required for the current application.