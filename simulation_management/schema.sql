CREATE TABLE IF NOT EXISTS wss_users (
 id text PRIMARY KEY, email text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 last_seen timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wss_sources (
 source_id text PRIMARY KEY, sha256 text NOT NULL, raw_payload jsonb NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wss_country_cache (
 id integer PRIMARY KEY CHECK(id=1), countries jsonb NOT NULL,
 retrieved_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wss_simulations (
 id uuid PRIMARY KEY, owner_id text REFERENCES wss_users(id), name text NOT NULL,
 country_code text NOT NULL, country_name text NOT NULL, area_label text NOT NULL DEFAULT '',
 bundle jsonb NOT NULL, scope jsonb NOT NULL, country_metadata jsonb NOT NULL DEFAULT '{}',
 scenarios jsonb NOT NULL DEFAULT '[]', location jsonb NOT NULL DEFAULT '{}',
 schema_version integer NOT NULL DEFAULT 1, revision integer NOT NULL DEFAULT 1,
 visibility text NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public')),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','calculated')),
 is_seed boolean NOT NULL DEFAULT false, source_id text UNIQUE REFERENCES wss_sources(source_id),
 published_version_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz,
 CHECK ((is_seed AND owner_id IS NULL) OR (NOT is_seed AND owner_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS wss_versions (
 id uuid PRIMARY KEY, simulation_id uuid NOT NULL REFERENCES wss_simulations(id),
 label text NOT NULL, bundle jsonb NOT NULL, scope jsonb NOT NULL,
 scenarios jsonb NOT NULL DEFAULT '[]', country_metadata jsonb NOT NULL DEFAULT '{}',
 input_hash text NOT NULL, model_version text NOT NULL, results jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wss_simulation_owner ON wss_simulations(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS wss_simulation_public ON wss_simulations(visibility, updated_at DESC);
-- Server-side Replit Auth sessions; application startup never creates tables.
CREATE TABLE IF NOT EXISTS wss_auth_sessions (
 sid varchar PRIMARY KEY,
 sess json NOT NULL,
 expire timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS wss_auth_session_expiry ON wss_auth_sessions(expire);
