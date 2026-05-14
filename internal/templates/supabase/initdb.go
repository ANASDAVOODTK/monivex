package supabase

// These init scripts are mounted into /docker-entrypoint-initdb.d/ of the
// supabase/postgres container. They run once on first boot of an empty data
// directory and bring all internal Supabase roles in line with the
// POSTGRES_PASSWORD chosen for this deployment. Without rolesSQL the auth /
// storage / rest containers fail SASL auth as observed in the wild
// ("password authentication failed for user supabase_auth_admin").

// rolesSQL aligns every Supabase-managed role's password with
// POSTGRES_PASSWORD provided through the .env. The role accounts themselves
// are created by the supabase/postgres image's own bootstrap, so we just
// ALTER them.
const rolesSQL = `\set pgpass ` + "`" + `echo "$POSTGRES_PASSWORD"` + "`" + `

ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER pgbouncer WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_functions_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_storage_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_read_only_user WITH PASSWORD :'pgpass';
ALTER USER supabase_replication_admin WITH PASSWORD :'pgpass';
`

// jwtSQL publishes the JWT secret + expiry as Postgres GUCs so RLS policies
// using auth.jwt() resolve correctly.
const jwtSQL = `\set jwt_secret ` + "`" + `echo "$JWT_SECRET"` + "`" + `
\set jwt_exp ` + "`" + `echo "$JWT_EXP"` + "`" + `

ALTER DATABASE postgres SET "app.settings.jwt_secret" TO :'jwt_secret';
ALTER DATABASE postgres SET "app.settings.jwt_exp" TO :'jwt_exp';
`

// realtimeSQL ensures the _realtime schema exists. The realtime service
// then owns it and runs its own migrations inside.
const realtimeSQL = `CREATE SCHEMA IF NOT EXISTS _realtime;
ALTER SCHEMA _realtime OWNER TO supabase_admin;
`

// webhooksSQL bootstraps the supabase_functions schema used by Database
// Webhooks / Edge Functions.
const webhooksSQL = `CREATE SCHEMA IF NOT EXISTS supabase_functions;

GRANT USAGE ON SCHEMA supabase_functions TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA supabase_functions
  GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA supabase_functions
  GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA supabase_functions
  GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;

ALTER SCHEMA supabase_functions OWNER TO supabase_admin;
`
