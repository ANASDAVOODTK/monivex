package supabase

// kongDeclarativeYAML wires Kong API gateway routes for the Supabase services.
// Loaded by the kong container in DB-less mode via the volume mount in compose.
const kongDeclarativeYAML = `_format_version: "1.1"

consumers:
  - username: anon
    keyauth_credentials:
      - key: "{{ .Config.anon_key }}"
  - username: service_role
    keyauth_credentials:
      - key: "{{ .Config.service_role_key }}"
  - username: dashboard
    basicauth_credentials:
      - username: "{{ .Config.dashboard_user }}"
        password: "{{ .Config.dashboard_password }}"

acls:
  - consumer: anon
    group: anon
  - consumer: service_role
    group: admin

services:
  - name: dashboard
    url: http://studio:3000/
    routes:
      - name: dashboard-all
        strip_path: false
        paths:
          - /
    plugins:
      - name: basic-auth
        config:
          hide_credentials: true
      - name: cors
  - name: auth-v1
    url: http://auth:9999/
    routes:
      - name: auth-v1-all
        strip_path: true
        paths:
          - /auth/v1/
    plugins:
      - name: cors
  - name: rest-v1
    url: http://rest:3000/
    routes:
      - name: rest-v1-all
        strip_path: true
        paths:
          - /rest/v1/
    plugins:
      - name: cors
      - name: key-auth
        config:
          hide_credentials: true
      - name: acl
        config:
          hide_groups_header: true
          allow:
            - admin
            - anon
  # Realtime. The upstream host must start with the tenant id ("realtime-dev.")
  # because Realtime derives the tenant from the Host header; plain "realtime"
  # fails with TenantNotFound and a WebSocket 403. See the network alias on the
  # realtime service in docker-compose.yml.
  - name: realtime-v1-ws
    url: http://{{ .RealtimeHost }}:4000/socket
    protocol: ws
    routes:
      - name: realtime-v1-ws-all
        strip_path: true
        paths:
          - /realtime/v1/
    plugins:
      - name: cors
      - name: key-auth
        config:
          hide_credentials: false
      - name: acl
        config:
          hide_groups_header: true
          allow:
            - admin
            - anon
  # REST (e.g. /realtime/v1/api/broadcast). A separate service so /api/...
  # is not rewritten to /socket/api/... (404). Kong matches the longest path
  # first, so the two admin endpoints below are blocked before the generic
  # /realtime/v1/api route can serve them.
  - name: realtime-v1-rest-openapi-block
    url: http://{{ .RealtimeHost }}:4000/api/openapi
    routes:
      - name: realtime-v1-rest-openapi-block-all
        strip_path: true
        paths:
          - /realtime/v1/api/openapi
    plugins:
      - name: request-termination
        config:
          status_code: 403
          message: "Access is forbidden."
  - name: realtime-v1-rest-tenants-block
    url: http://{{ .RealtimeHost }}:4000/api/tenants
    routes:
      - name: realtime-v1-rest-tenants-block-all
        strip_path: true
        paths:
          - /realtime/v1/api/tenants
    plugins:
      - name: request-termination
        config:
          status_code: 403
          message: "Access is forbidden."
  - name: realtime-v1-rest
    url: http://{{ .RealtimeHost }}:4000/api
    routes:
      - name: realtime-v1-rest-all
        strip_path: true
        paths:
          - /realtime/v1/api
    plugins:
      - name: cors
      - name: key-auth
        config:
          hide_credentials: false
      - name: acl
        config:
          hide_groups_header: true
          allow:
            - admin
            - anon
  - name: storage-v1
    url: http://storage:5000/
    routes:
      - name: storage-v1-all
        strip_path: true
        paths:
          - /storage/v1/
    plugins:
      - name: cors
{{- if .FunctionsEnabled }}
  # Edge Functions: /functions/v1/<name> -> main worker -> /home/deno/functions/<name>.
  # Auth is enforced by the main worker (VERIFY_JWT), as in upstream Supabase.
  - name: functions-v1
    url: http://functions:9000/
    routes:
      - name: functions-v1-all
        strip_path: true
        paths:
          - /functions/v1/
    plugins:
      - name: cors
{{- end }}
  - name: meta
    url: http://meta:8080/
    routes:
      - name: meta-all
        strip_path: true
        paths:
          - /pg/
    plugins:
      - name: key-auth
        config:
          hide_credentials: false
      - name: acl
        config:
          hide_groups_header: true
          allow:
            - admin
`
