# Guest reporting contract

**Status: proposed for team review.** [J6-27](https://gatech-team-f1s41wh9.atlassian.net/browse/J6-27) is the decision record for reporting. The request and response examples below describe proposed behavior. Guest submission and the privacy of custom-recipient reports are established requirements. [API](api.md) · [Security](security.md) · [Open decisions](decisions.md) · [Offline queue](offline-gis.md)

## Guest ownership and submission identity

- Generate a random UUID for each submission and a separate cryptographically random 256-bit guest secret on the device before the first upload. Keep both across retries. A guest sends the secret in the HTTPS authorization header. An authenticated reporter uses their verified account session.
- Scope guest access to that report. The server stores a digest of the secret and checks it on replay and any owner detail or media request. The report ID, submission UUID, and recipient address carry no authority. Keep the secret out of URLs, receipts, notifications, analytics, and logs.
- Store the guest secret in platform secure storage. The proposed first release supports access from the originating installation. Cross-device recovery and account linking require a separate decision. Confirm the user-facing recovery expectation before approving D-01.
- A submission UUID identifies one accepted report. A caller with valid owner proof receives the original receipt for an identical replay. A different payload from the same owner returns `409 SUBMISSION_CONFLICT`. A caller with different owner proof receives a generic failure without receipt or report details.

## Request and receipt

Proposed submission is `POST /api/v1/observations` using multipart form data. Send a single JSON `metadata` part and one or more ordered `images` parts. Category IDs come from the approved public reporting options catalog. Keep authorization and coordinates out of the URL.

Example metadata for a custom report where the visitor declined location access:

```json
{
  "client_submission_id": "616d1c6c-3780-4eb2-a45d-1d6781990a90",
  "category_id": "example-trail-erosion",
  "captured_at": "2026-11-12T17:30:00Z",
  "location": null,
  "location_unavailable_reason": "permission_denied",
  "delivery_mode": "custom",
  "custom_recipients": ["visitor@example.com"],
  "note": "Erosion beside the trail."
}
```

- For a consented fix, use a GeoJSON Point with finite longitude and latitude in that order and omit `location_unavailable_reason`. For a missing fix, use `location: null` and one of `permission_denied`, `unavailable`, or `not_shared`. The proposed flow lets the visitor review and submit a report without coordinates. Keep capture time and server acceptance time separate.
- For `park` mode, the server looks up the category's approved destination and rejects a client-supplied custom recipient list. For `custom` mode, accept only the explicitly reviewed, nonempty list. Validate and deduplicate the addresses consistently. Persist the effective destination with the accepted report so configuration changes cannot alter an existing delivery.
- Keep custom reports and attachments outside staff lists, search, details, exports, mutations, and notifications, including for park administrators. Send each custom recipient a separate notification so addresses remain private. A delivery failure preserves the original mode and recipients.
- Use `201` for first acceptance and `200` for an identical authorized replay. Both return the same receipt. A receipt confirms storage. Notification delivery has its own state and may still be pending.

```json
{
  "observation_id": "67f936e6-37ad-4eca-9f33-3ba860cc8b38",
  "client_submission_id": "616d1c6c-3780-4eb2-a45d-1d6781990a90",
  "status": "accepted",
  "accepted_at": "2026-11-12T17:31:00Z"
}
```

## Photo handling

The proposed starting limits for review are **1–3 photos**, **5 MiB per photo**, **16 MiB total request**, **4,096 pixels per edge**, and **12 million pixels per decoded image**. Confirm these limits and whether text-only reports belong in the first release under D-04. Enforce request and decode limits on the server and surface validation before upload where possible.

Accept JPEG and PNG by decoded content. Convert unsupported device formats to JPEG on the device when possible, and let the user replace the photo if conversion fails. Keep the approved converted files for retries. Strip image metadata before storage. Use the user-reviewed location field as the source of report coordinates. Store stable references to private objects and issue expiring media access only after authorization.

## Acceptance, retries, and local storage

1. Validate and bound the request. Compare the normalized metadata and hashes of the ordered upload bytes for replay. For an accepted UUID, verify owner proof and compare the request before applying current category or routing configuration.
2. Reserve the submission UUID for the verified owner before writing private photos. Serialize competing attempts for that UUID and use attempt-specific object keys. The transaction must verify that its attempt still owns the lease before accepting. An interrupted attempt can be reclaimed by the same owner once its lease expires. Clean up abandoned attempt objects only after the attempt can no longer commit and no accepted record references them.
3. In one database transaction, finalize the report, photos, destination, receipt, and durable notification work. Accept only after the objects are stored and the transaction commits. A lost response can be recovered by replay. Create one logical notification per accepted report and recipient. A delivery worker tracks attempts and sends ambiguous provider acknowledgements for reconciliation before another send.
4. Write metadata, the submission UUID, secure-storage reference, and durable local photo references before showing the report as pending. Store report files in app-private storage and exclude drafts and secrets from backups. Confirm platform storage protection and the retention policy under D-09.
5. Retry transport failures, `429`, and temporary `5xx` responses with backoff and any supplied `Retry-After` value. Preserve the same metadata, photos, UUID, and owner proof on replay. Put validation errors and conflicting submissions in a state that requires user attention. Give corrected submissions a new UUID after confirming that the prior submission was rejected. Resolve an uncertain outcome using the original request first.
6. Keep pending reports through app restarts until an authorized receipt or explicit deletion. Release the queued photo copies after receipt confirmation and retain only the local access information permitted by the agreed retention policy.

Example validation error with `Cache-Control: no-store`:

```json
{
  "error": {
    "code": "INVALID_REPORT",
    "message": "Check the report fields.",
    "fields": { "custom_recipients": "At least one recipient is required." }
  }
}
```

Use `400` for malformed requests, `401` for missing authorization, a generic `404` for unauthorized access to an existing private report, `409` for conflicting authorized reuse, `413` for size limits, and `415` for unsupported image types. Error fields describe the correction without echoing request values. Apply `no-store` to private receipts and errors. Keep secrets, coordinates, addresses, and raw upload content out of application and hosting logs.

## Decisions for review

| Decision | Review outcome needed                                                                                           |
| -------- | --------------------------------------------------------------------------------------------------------------- |
| D-01     | Approve report-scoped guest access and the recovery experience.                                                 |
| D-03     | Confirm park categories and destinations, custom recipient rules, and who may access report media.              |
| D-04     | Confirm photo limits, conversion, text-only behavior, and submission with missing GPS.                          |
| D-07     | Approve the replay and acceptance rules, retry bounds, and handling of uncertain notification delivery.         |
| D-09     | Confirm device protection, access-log settings, retention and deletion for drafts, accepted records, and media. |

Record approvals in [the decision register](decisions.md). The dependent tickets should verify concurrent replay, guest isolation, hidden custom reports and media, missing GPS, failed uploads, lost receipts, and offline restart against the agreed contract.
