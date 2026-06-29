# Reconcile RN on the iOS contract shape, with event names frozen to the reference doc

Reviewing the iOS sibling SDK (`edge_telemetry_ios_sdk`) revealed it diverges from the
Angular payload RN was first modelled against: iOS omits `tenant_id`, `sdk.contract_version`,
`session.is_first_session`/`total_sessions`, and `network.connected`/`downlinkMbps`; adds an
optional envelope `location`; enforces a strict 12-name event allowlist; and uses richer
per-event attributes. iOS is the newest, strictest, and (like RN-native) a native sibling.

Decision: RN v3 takes its **envelope, identity model, ID formats, and structure from the iOS
canonical contract**, but **freezes event/metric names to the EdgeRum Data Capture Reference**
(those names are already backend-supported — confirmed consistent with the iOS allowlist).
RN may emit **richer attributes** than the reference baseline; every such addition is recorded
in `docs/backend-additions-ledger.md` for the backend team to wire up later.

Chosen over mirroring the older Angular shape (carries fields iOS deliberately dropped) and
over inventing a fresh RN contract (breaks cross-platform joins). `sdk.platform = "react-native"`
is a new value needing backend sign-off, mirroring the iOS team's `ios-native` ask. The two
genuinely conflicting per-event shapes (`navigation`, `resource_timing`) stay open pending
backend confirmation of which keys it dashboards on — tracked in the ledger.
