# Native emits a platform-honest subset; web-only metrics live in the RN-Web build

Much of the EdgeRum contract is DOM/PerformanceObserver-shaped: Web Vitals (LCP/FCP/CLS/
INP/TTFB), `page_load`, `resource_timing`, `long_task`. These have no truthful native
equivalent. `user.interaction` likewise depends on DOM `target_tag`/`target_class`.

Decision: RN-native emits only what it can honestly measure (`http.request`, `navigation`,
`screen.duration`, `network_change`, `app.crash`, `session.*`, `app_lifecycle`,
`memory_usage`, `frame_render_time`, `user.profile.update`, `custom_event`).
`user.interaction` on native is best-effort taps without DOM target fields. The web-only
metrics are emitted **only** by the RN-Web build.

Chosen over synthesizing fake native equivalents, which would feed the dashboards
approximations they can't trust. The backend already tolerates a per-platform event subset.
Surprising because the contract lists these events globally — this records that their absence
on native is deliberate, not an oversight.
