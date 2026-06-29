# apiKey-only auth; backend derives tenant_id

The captured Angular payload carries `tenant_id` in the batch body. The RN SDK instead takes
only `apiKey: "edge_..."` at `createTelemetry()`, sends it as `X-API-Key`, and omits
`tenant_id` from the body — the backend resolves the tenant from the key.

Chosen to keep the public API to a single credential and avoid consumers having to know their
tenant UUID. Surprising because it deviates from what the Angular SDK puts on the wire — a
reader comparing payloads will notice RN has no `tenant_id`. Depends on the backend deriving
tenant from the key (confirmed); if that ever stops being true, add `tenantId` to opts.
