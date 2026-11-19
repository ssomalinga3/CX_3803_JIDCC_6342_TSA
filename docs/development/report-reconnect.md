# Foreground report sync (J6-34)

The owner approved automatic retries only after the visitor explicitly submits
a reviewed report. Editable drafts never send merely because connectivity changes.
The existing single active draft flow uses the persisted submission UUID, guest
secret and exact reviewed payload across reconnect and restart.

Expo Network listens for connectivity changes. Pending retryable reports attempt
again while the app is active and a connection is available. Automatic backoff
starts at 30 seconds, doubles to a five-minute cap, and honors a longer server
Retry-After. Manual retry retains its existing server-specified waiting period.
Connectivity alone does not establish API availability or acceptance.

Transport loss, temporary service failure, an upload lease in progress and an
unconfirmed receipt are retryable. Ownership, payload conflict, validation and
storage failures require attention. Retry timing and eligibility persist with the
draft. Backgrounding aborts the active upload, retains the exact request, and
rechecks connectivity on foregrounding. The native OS can suspend the app, so
this implementation schedules no background execution task.

The draft provider's upload mutex prevents concurrent connectivity events and
button taps from creating parallel sends. Server-side submission identity and the
acceptance transaction remain authoritative for a lost response and notification
deduplication. Receipt confirmation releases durable pending photo content.
Custom recipients never acquire park fallback.

Expo Network is a new native dependency. Rebuild Android and iOS development
clients with the existing EAS profiles before testing this branch on a device.
Expo configuration and project identifiers are preserved.

Verify with synthetic content on Android and iOS 26. Submit while offline,
force quit, reopen offline, then reconnect with the app active. Confirm one
observation and one notification per recipient after repeated network transitions,
foregrounding and manual retries. Interrupt a photo upload and lose a response
after server acceptance. Also verify permanent rejection and unavailable ownership
stop automatic retries while retaining the draft. These backend/device checks
remain pending until the local backend and rebuilt clients are available.
