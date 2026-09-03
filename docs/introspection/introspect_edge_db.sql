-- Wayfinder #85 — live introspection of edge_db (READ ONLY).
-- Run:  psql "postgresql://<user>:<pw>@<host>:<port>/edge_db" -f introspect_edge_db.sql > edge_db_introspection.txt
\pset pager off
\pset format aligned

\echo '===== 0. WHERE AM I ====='
SELECT current_database() AS db, current_user AS usr, inet_server_addr() AS host, version() AS pg;

\echo ''
\echo '===== 1. information_schema.columns — public schema, rum_*/processor_* tables ====='
SELECT table_name, ordinal_position AS pos, column_name, data_type, udt_name,
       character_maximum_length AS maxlen, numeric_precision AS numprec,
       is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

\echo ''
\echo '===== 1b. every table in public, with row estimate ====='
SELECT c.relname AS table_name, c.reltuples::bigint AS est_rows
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;

\echo ''
\echo '===== 2. ENUM TYPES and their labels (incl. trace_injection) ====='
SELECT n.nspname AS schema, t.typname AS enum_type,
       string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder) AS labels
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
JOIN pg_namespace n ON n.oid = t.typnamespace
GROUP BY 1, 2
ORDER BY 1, 2;

\echo ''
\echo '===== 2b. which columns actually USE a user-defined (enum/domain/composite) type ====='
SELECT table_name, column_name, data_type, udt_schema, udt_name
FROM information_schema.columns
WHERE table_schema = 'public' AND data_type = 'USER-DEFINED'
ORDER BY table_name, column_name;

\echo ''
\echo '===== 3. rum_geo_locations — does it exist, and does it have rows? ====='
SELECT to_regclass('public.rum_geo_locations') AS relation;
SELECT count(*) AS rum_geo_locations_rows FROM public.rum_geo_locations;
SELECT count(*) AS http_rows_with_geo
FROM public.rum_http_requests
WHERE geo_location_id IS NOT NULL;

\echo ''
\echo '===== 4. #67 ask targets — do these columns exist live? ====='
WITH want(table_name, column_name) AS (VALUES
  ('rum_performance_metrics','unit'),
  ('rum_performance_metrics','memory_type'),
  ('rum_performance_metrics','memory_source'),
  ('rum_performance_metrics','frame_build_duration_ms'),
  ('rum_performance_metrics','frame_raster_duration_ms'),
  ('rum_performance_metrics','frame_type'),
  ('rum_performance_metrics','frame_dropped'),
  ('rum_http_requests','geo_location_id'),
  ('rum_http_requests','trace_id'),
  ('rum_http_requests','span_id'),
  ('rum_http_requests','parent_span_id'),
  ('rum_http_requests','url'),
  ('rum_telemetry_events','trace_id'),
  ('rum_telemetry_events','span_id'),
  ('rum_telemetry_events','parent_span_id'),
  ('rum_telemetry_events','rum_action_id'),
  ('rum_telemetry_events','trace_root_type'),
  ('rum_telemetry_events','span_start_time'),
  ('rum_telemetry_events','span_duration_ms'),
  ('rum_telemetry_events','user_action_id'),
  ('rum_telemetry_events','trace_adopted'),
  ('rum_telemetry_events','trace_injection'),
  ('rum_apps','tenant_id'),
  ('rum_devices','device_id'),
  ('rum_devices','fingerprint'),
  ('rum_ui_interactions','ui_direction'),
  ('rum_ui_interactions','ui_name_source')
)
SELECT w.table_name, w.column_name,
       COALESCE(c.data_type, '** MISSING **') AS data_type,
       c.udt_name, c.is_nullable
FROM want w
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public' AND c.table_name = w.table_name AND c.column_name = w.column_name
ORDER BY w.table_name, w.column_name;

\echo ''
\echo '===== 5. sdk.version / sdk.platform in the bag — what is actually arriving? ====='
SELECT attributes->>'sdk.platform' AS sdk_platform,
       attributes->>'sdk.version'  AS sdk_version,
       count(*) AS events
FROM public.rum_telemetry_events
WHERE timestamp > now() - interval '30 days'
GROUP BY 1, 2
ORDER BY events DESC
LIMIT 50;
