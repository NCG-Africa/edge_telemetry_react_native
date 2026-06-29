# Clean break to the EdgeRum wire contract in v3.0.0

The RN SDK's v2 wire format (`{ events }`, ms timestamps, `network_request`-style names,
standalone `device_info` events) diverges from the shared EdgeTelemetryProcessor backend at
every layer. Rather than dual-emit both shapes behind a flag, v3.0.0 cuts over wholesale to
the EdgeRum contract — new envelope, ISO timestamps, renamed events, context-as-attributes.

Chosen because the backend is shared across SDKs: dual-emitting doubles ingestion for no
consumer's benefit, and one backend code path is the whole point of parity. Cost: v3 is a
breaking change; consumers upgrade once. Reversal would mean re-supporting the old shape,
which nothing downstream wants.
