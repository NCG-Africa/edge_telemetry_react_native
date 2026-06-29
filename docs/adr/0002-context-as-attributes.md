# Device/network context becomes attributes, not standalone events

In v2 the SDK emitted `device_info` and `network_info` as their own events. The EdgeRum
contract instead merges App/Device/Network/Session/User/SDK fields into the `attributes` of
*every* event and metric (the "Context block"), and emits no standalone context events.

v3 follows the contract: `log()` builds the Context block fresh on each event; the
`device_info`/`network_info` events are deleted. A connectivity *change* is still an event
(`network_change`), but steady-state context is never its own event.

Surprising to a future reader who greps for `device_info` and finds nothing — hence this
record. Trade-off: every event carries ~25 repeated attributes (larger payloads) in exchange
for every event being self-describing and joinable backend-side without correlation.
