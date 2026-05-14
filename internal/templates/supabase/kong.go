package supabase

// kongDeclarativeYAML wires Kong API gateway routes for the Supabase services.
// Loaded by the kong container in DB-less mode via the volume mount in compose.
const kongDeclarativeYAML = `_format_version: "1.1"

consumers:
  - username: anon
    keyauth_credentials:
      - key: ${ANON_KEY}
  - username: service_role
    keyauth_credentials:
      - key: ${SERVICE_ROLE_KEY}
  - username: dashboard
    basicauth_credentials:
      - username: ${DASHBOARD_USERNAME}
        password: ${DASHBOARD_PASSWORD}

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
  - name: realtime-v1
    url: http://realtime:4000/socket/
    routes:
      - name: realtime-v1-all
        strip_path: true
        paths:
          - /realtime/v1/
    plugins:
      - name: cors
      - name: key-auth
        config:
          hide_credentials: false
  - name: storage-v1
    url: http://storage:5000/
    routes:
      - name: storage-v1-all
        strip_path: true
        paths:
          - /storage/v1/
    plugins:
      - name: cors
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
