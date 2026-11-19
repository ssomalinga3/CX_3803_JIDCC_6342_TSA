# Guest report capture and submission (J6-31)

The mobile form connects Map → category → details → recipients → review → explicit
submit to the custom-only development API. No account or park fallback is added.
A receipt confirms private storage and queued notification work, not email delivery.

## Design and tap-count decision

The live Figma frames were read with design context and screenshots:
[route/category](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=51-91),
[details](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=51-93),
[recipients](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=66-260),
[review](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=66-262),
[submitting](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=51-95),
[accepted](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=51-97)
and [failure](https://www.figma.com/design/zotPKNdYIDv72Bc1mc57CQ/mid-fidelity-prototype?node-id=66-266).

Use native safe areas/status bars, back/title navigation, scrollable content,
rounded cards, blue actions and removable recipient chips. Downloaded Figma SVGs
retain their 104×104 and 64×64 dimensions; the success check is a separate text
layer over the green-circle asset. Photos are dynamic device content. Prototype
test buttons, addresses, park destinations and My Reports links are omitted.
Missing-GPS controls, development labels and storage/email wording implement the
approved contract; My Reports is J6-42.

The owner confirmed route-first Figma and **actual tap measurement**, counting
permission/camera interactions separately. Start at **Report an Issue** on Map;
end at **Submit report**. The one-photo/custom-recipient path has eight app taps:
entry, category, Add photo, source choice, Choose recipients, Add recipient,
Review report, Submit report. Native library selection adds one interaction;
camera shutter/confirmation and permission dialogs are counted separately.
Keystrokes and scrolling are not navigation taps. GPS, extra photos/recipients,
corrections and retries add actions. This does not claim three taps.

## Runtime boundaries

- `/report` is a root-stack route. A root provider retains the draft during map
  browsing and return. Only a validated custom-only development options catalog
  enables the form; unavailable options show retry, not an invented catalog.
- The system picker supports camera or one library photo at a time, up to three.
  Do not request EXIF, base64 or microphone access. Convert on device to JPEG,
  resize to a 2,048-pixel longest edge, and compress at 0.85 (0.65/0.4 fallbacks)
  to fit 5 MiB. Native source dimensions are bounded before conversion. Server
  validation, sanitization and complete multipart limits remain authoritative.
- Remove only app-owned `report-<uuid>.jpg` cache copies, explicitly or after a
  valid receipt. Preserve files on uncertain results; never delete library originals.
- Location is opt-in and separate from map following. One foreground subscription
  validates ranges/freshness and stops after a fix, 15-second timeout, blur,
  background or cancellation. Denial/unavailability yields an explicit reason;
  never substitute EXIF or stale map coordinates. Review the fix before submit.
- Before uploading, save and verify a native-random UUID/256-bit guest secret in
  SecureStore, using `WHEN_UNLOCKED_THIS_DEVICE_ONLY` on iOS. The ordinary draft
  retains only the UUID. Read the existing secret for each send; never replace a
  missing credential for an attempted UUID. Secrets stay out of routes and receipts.
- Freeze detached reviewed metadata, first-photo capture/selection time and file
  order. Synchronous guards prevent concurrent send/preparation. SDK 57 installs
  Expo fetch globally: use real `expo-file-system` File/Blob multipart parts,
  not legacy URI dictionaries. Let fetch set the boundary and reject redirects.
- Validate receipt shape, UUIDs, accepted state and time. Unconfirmed results
  retain identity/files and require retry of the same request. Honor Retry-After.
  Only definitive 400/413/415 rejection permits correction with a fresh UUID.

**Drafts are session-only.** J6-33 owns durable metadata/photo restart recovery;
J6-34 owns automatic reconnect/background sending. The error screen explicitly
says closing the app does not yet save the draft. SecureStore alone is not photo
recovery. Owner history and cross-device recovery remain J6-42/J6-71.

## Build and local use

New SDK-compatible modules are image-picker, image-manipulator, secure-store and
crypto. Config plugins set photo/camera permission copy and disable microphone
access; foreground location copy now includes reviewed reporting. Shared EAS
project/package identifiers and generated native projects are unchanged.
**A new development build is required** for these native dependencies/configuration.

The installed iOS simulator build is
[3e300a21-a1a2-4f5c-a747-fc3590e180dd](https://expo.dev/accounts/cx3803jidcc6342tsa/projects/cascade-springs/builds/3e300a21-a1a2-4f5c-a747-fc3590e180dd).
Run current JavaScript through Metro and the [reporting Worker](custom-reports.md):

```sh
source "$HOME/.nvm/nvm.sh"
nvm use
CASCADE_DB_PORT=55434 pnpm --dir backend reports:dev
# Another terminal, with nvm loaded:
pnpm --dir mobile start --port 8082 --localhost
```

The ignored mobile setting is `EXPO_PUBLIC_API_URL=http://localhost:8787/api/v1`.
AWS credentials remain only on the backend. Development HTTP is allowed only on
loopback/emulator hosts; production transport requires HTTPS.

## Evidence and limits

Contract/component/native-adapter tests cover options, metadata, explicit
recipients, denied permissions, cancellation, conversion, secure-storage failure,
location cleanup, duplicate taps, uncertain retry, rejected-payload correction
and receipt validation. A regression calls the installed SDK multipart encoder:
URI dictionaries fail before transmission, while File parts produce JPEG bytes.

Verification passed: 239 mobile tests across 31 suites, 60 backend
submission/privacy tests, 28 backend photo tests, mobile/backend lint and type
checks, repository formatting, and an iOS JavaScript bundle export. The installed
cloud build supplies separate native compilation evidence.

The location-review correction replaces both draft location fields on each
capture result, clearing any earlier missing-location reason after a successful
fix. Regression tests submit consented coordinates after all three missing-location
states and verify that the visitor can still omit a captured fix before submission.
The three successful-fix cases failed before the correction. Follow-up verification
passed all 243 mobile tests, mobile lint/type checks, formatting, iOS/Android
JavaScript exports and `git diff --check`. Native device checks and live S3 submission
were not rerun for this correction.

iPhone 16e / iOS 26.3 runs the rebuilt client with local Metro/PostGIS and real
private S3. The first native synthetic report covered optional GPS, explicit
omission, invalid email feedback, review, failure retention and retry to a real
receipt. Verification confirmed one observation, private JPEG content and one
pending, unsent notification, then removed those synthetic records/objects.
Camera and location denial preserve entered notes and offer library fallback;
Settings can be opened and returning retains the draft. A second synthetic report
verified library cancellation, attachment after camera denial, explicit missing-GPS
review, recipient removal and repeated Submit taps producing one accepted report.
Both reports passed the storage/outbox checks and were cleaned up. No SMTP was sent.
Network timeout semantics are covered by automated tests; a paused-Worker native
run recovered to acceptance and does not establish a native timeout result.

Screenshots: [review](screenshots/reporting/ios-26-review.png) and
[accepted receipt](screenshots/reporting/ios-26-accepted.png), using synthetic
content and a test recipient. The simulator is left at a fresh category form.

```sh
CASCADE_DB_PORT=55434 pnpm --dir backend reports:mobile:check <synthetic-observation-uuid>
CASCADE_DB_PORT=55434 pnpm --dir backend reports:mobile:check <synthetic-observation-uuid> --cleanup
```

The helper refuses non-loopback databases and reports without the exact J6-31
synthetic note/recipient pattern. It checks unique note/observation, private
attachments and exactly one unsent recipient notification. Cleanup failure leaves
the database intent. Output contains no secrets, coordinates, object keys or URLs.

Android verification was explicitly deferred by the owner; its build completed,
but Android form interaction is not claimed. Physical iPhone camera capture,
offline restart/background sync, SMTP and production deployment remain separate.
The existing floating development gear and intermittent online-basemap errors
were observed and are outside this reporting change.
