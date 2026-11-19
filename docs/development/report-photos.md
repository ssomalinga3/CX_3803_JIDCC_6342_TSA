# Local report-photo processing (J6-29)

The owner authorized photo development without an S3 bucket on November 17, 2026. This slice implements an internal processing service, private storage
interface and Node local-disk adapter. It does not register an HTTP upload route,
accept a report, send email, or expose mobile capture. J6-30 integrates accepted
submissions; J6-31 builds capture/review. This records the original local slice.
The follow-up [S3 adapter guide](s3-report-photos.md) describes the AWS SDK storage
adapter and the current live-verification status.
The [custom-recipient API](custom-reports.md) now connects these components to
local multipart submission and atomic database acceptance.

## Try real files locally

From the workspace root, using the pinned Node/pnpm versions:

```sh
nvm use
pnpm install --frozen-lockfile
pnpm --dir backend photos:check /absolute/path/to/photo.jpg
pnpm --dir backend photos:check /absolute/path/to/first.jpg /absolute/path/to/second.png
```

This validates 1–3 files, sanitizes them, writes private local copies, issues a
short-lived owner access grant, reads the copies back, and deletes them. Output
contains only index, detected type, dimensions and sanitized byte count. The
command does not print paths, guest secrets, keys, raw errors or image metadata.

**Where bytes go:** a private `cascade-photos-*` directory under the OS temporary
directory. Each random key has an `image` file and `metadata.json` with type,
dimensions, hashes and ownership digest. Inputs are unchanged; temporary copies
are removed in `finally`, even on failure. No bytes go to S3, PostgreSQL, the
running API Worker or a map provider.

`createLocalPhotoStore(absoluteDirectory)` also supports persistent copies for
Node development tooling. Pass a private directory; `backend/.local-report-photos/`
is gitignored for that purpose. On the verified macOS host, directories are mode
0700 and files 0600. The adapter rejects traversal and symlinked reads, writes to
a temporary directory and atomically renames a complete object into place. It
refuses to overwrite existing complete objects. Never import this filesystem
adapter into the Worker or mobile bundle. Retention and abrupt-crash recovery
remain operational work: `finally` cannot run after a forced process/host kill.

## Processing contract

`preparePhoto` validates and sanitizes by **rewriting the file's segments/chunks,
without decoding or re-encoding pixels**. It uses only the public
[zlib API supported by Workers](https://developers.cloudflare.com/workers/runtime-apis/nodejs/zlib/)
and no image codec at runtime.

**Why not decode and re-encode:** pure-JS codecs exceed the 128 MB Cloudflare Worker
isolate at the approved limits. Measured on November 19, 2026, a 12 MP PNG held
137–291 MB live during decode/rotate/encode (from a 0.24 MB upload), and jpeg-js's
memory cap rejected ordinary 8 MP camera JPEGs as invalid. Segment rewriting peaks
at a few MB for 12 MP JPEGs and about 32 MB for 12 MP PNGs (an upper bound sampled
without forced garbage collection). Larger-memory re-encoding would require an
external service (for example the Cloudflare Images binding); that is not selected.

- Enforce 1–3 files before consuming streams, stop reads above 5 MiB per file,
  and check 4,096-pixel edges / 12-million-pixel dimensions from headers.
  The HTTP adapter separately enforces the **16 MiB complete multipart request**,
  including metadata and boundaries. This service is not a multipart parser.
- **JPEG:** walk every marker and keep only decoder-required segments: DQT, DHT,
  DRI, one Huffman baseline/extended/progressive 8-bit frame (1, 3 or 4
  components), scans and their entropy-coded data, plus the 12-byte Adobe color
  transform marker. Drop APP0–APP15 (EXIF/GPS, XMP, ICC, IPTC, JFIF, MPF) and
  comments, and discard everything after EOI (including appended secondary
  images). Reject arithmetic, lossless and hierarchical frames as unsupported.
- **PNG:** check structure, CRCs, valid depth/color pairs, palette presence,
  every scanline filter byte and the exact inflated size, streamed in 64 KiB
  pieces. Keep only IHDR, PLTE, tRNS, IDAT and IEND; compressed private
  text/profiles are never inflated. Reject animated PNG rather than silently
  discarding frames. Bit depth, palette, alpha and interlacing are preserved.
- **Orientation:** read only EXIF orientation (never GPS/time) and write a newly
  generated orientation-only EXIF field; nothing else is copied from input EXIF.
  Reported width/height are the displayed (oriented) dimensions. Viewers that
  ignore PNG `eXIf` show such PNGs unrotated; the mobile app always sends JPEG.
- **Trade-off:** pixel data is copied byte-for-byte, not regenerated, so a
  structurally valid file with corrupt image data is stored as received. Color
  appearance can change where an ICC profile was removed (as it did when
  re-encoding). Do not trust filenames or client MIME declarations.
- Hash original upload bytes separately from sanitized bytes. The request
  digest uses original upload hashes and normalized metadata.

## Private staging and access

`createPhotoService(store)` takes a submission UUID and a separate 256-bit guest
secret encoded as 64 lowercase hex characters. It binds objects to a digest of
both and assigns random object keys. Another guest/submission cannot read or
delete them. Staff roles and recipient addresses grant no access. Only guest
context is implemented here; account/recipient authorization remains separate.

The internal adapter exposes create-only `put`, `get`, and idempotent `delete`.
Validate the full batch before writing. On put failure, clean up every attempted
key, including writes with a lost acknowledgement. A failed cleanup raises
`PHOTO_CLEANUP_REQUIRED` with internal keys for retry; never serialize those keys
in public errors or log them with report data. All exposed service errors use
fixed codes rather than decoder/storage messages.

Local grants are HMAC-bound to owner, key and expiry, require owner proof again
on read, and stop working on service restart. The owner can request a new grant
for persisted copies. The maximum five-minute lifetime is a development
safeguard, not a production S3 policy. No token/secret goes in a URL; no HTTP
media endpoint or actual S3 presigned URL is implemented.

Staged objects are **not accepted reports**. J6-30 must reserve submission UUIDs,
manage upload leases, attach private references in PostGIS and commit notification
work safely. Its caller must ensure an attempt cannot commit and no accepted
record refers to the keys before calling `discard`. The helper authorizes
deletion but does not establish that database/lease condition. No automatic
accepted-report retention/deletion policy is selected here.

S3 configuration, real cloud access/expiry, park routing values, retention and
retry/lease bounds remain open. The hosted runtime login is read-only; reporting
writes need separate deployment setup. Mobile durable photos and offline retry
remain J6-33/34; cross-device recovery remains J6-71.

## Verification

```sh
pnpm --dir backend lint
pnpm --dir backend typecheck
pnpm --dir backend build
pnpm --dir backend test --runInBand photos.test.ts local-photo-store.test.ts
pnpm --dir backend test:photos:worker
```

The standalone Worker check uses synthetic files and an in-memory adapter on
**127.0.0.1:18789** (keep this port free). It verifies actual-runtime JPEG/PNG
processing, metadata removal, guest isolation and cleanup without a database,
cloud account or bucket. It stops its child and removes temporary config/state.
The fixture entry point is separate from `src/worker.ts`. The existing
`test:worker` command includes this check.

November 17 verification: all 16 backend suites / 202 tests passed against local
PostGIS, including 29 new photo/storage cases; all three Worker checks passed.
Backend lint, typecheck and TypeScript build passed. The real-file command
detected JPEG content in the repository's `.png`-named screenshot, sanitized it,
verified private access and cleaned it up (598×1324, 171,550 output bytes).

Coverage includes corrupted/spoofed/truncated files, dimensions/byte/expansion
limits, all eight orientations, transparency, compressed metadata, owner
isolation, expired/forged/restart-invalidated grants, validation-before-write,
partial/ambiguous storage failures, cleanup failure, restart persistence,
permissions, traversal and symlinks. Native camera, offline restart/sync, S3
and SES are unverified. Production concurrency still requires measurement on the
selected Worker plan before enabling uploads.

November 19 sanitizer verification: the unit suite adds seeded structural fuzzing
(3,000 mutated files must fail with fixed codes or produce stable output) and
12 MP JPEG/PNG acceptance. Out of tree, 29 encoder variants (Pillow/libjpeg-turbo,
cjpeg restart/progressive/float-DCT, Apple ImageIO, CMYK/Adobe, appended
secondary images, 1/16-bit, palette+tRNS, Adam7) produced pixel-identical
libjpeg-turbo/libpng and Apple ImageIO decodes, unchanged displayed orientation,
no metadata other than orientation and clean `djpeg` decodes; arithmetic JPEG was
rejected as unsupported. A 50,000-case mutation fuzz raised no non-fixed errors,
stayed idempotent and finished each case within 210 ms.

November 19 native check of the unchanged J6-31 form against this sanitizer, local
PostGIS and private S3: iPhone 16e / iOS 26.3 (EAS development build `3e300a21`)
and an Android 16 / API 36 emulator (EAS build `adc8baaa`), both on Metro. Six
synthetic reports covered 1 and 3 photos (6016² JPEGs and an EXIF-6 portrait with
GPS), shared, omitted and denied location, camera denial with library fallback,
repeated Submit taps and Worker interruption before and during upload. Retries
reused one submission, honored `Retry-After` and reached one receipt. Stored
objects held only decoder segments, no EXIF/GPS/ICC/XMP/comments, and upright
pixels; the apps already normalize orientation, so the orientation-only EXIF
path is exercised by the Worker tests, not the apps. All records were cleaned
up. Screenshots: [iOS review](screenshots/reporting/sanitizer-ios-26-review.png),
[iOS accepted](screenshots/reporting/sanitizer-ios-26-accepted.png),
[Android review](screenshots/reporting/sanitizer-android-16-review.png),
[Android retry wait](screenshots/reporting/sanitizer-android-16-retry-wait.png),
[Android accepted](screenshots/reporting/sanitizer-android-16-accepted.png).
