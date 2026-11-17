# Local report-photo processing (J6-29)

The owner authorized photo development without an S3 bucket on November 17, 2026. This slice implements an internal processing service, private storage
interface and Node local-disk adapter. It does not register an HTTP upload route,
accept a report, send email, or expose mobile capture. J6-30 integrates accepted
submissions; J6-31 builds capture/review. J6-29's S3 setup remains outstanding.

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

`preparePhoto` decodes actual content using [jpeg-js](https://github.com/jpeg-js/jpeg-js)
and [fast-png](https://github.com/image-js/fast-png), without native image binaries.
PNG preflight uses the public [zlib API supported by Workers](https://developers.cloudflare.com/workers/runtime-apis/nodejs/zlib/)
to bound expansion before invoking the codec. No private zlib internals are used.

- Enforce 1–3 files before consuming streams, stop reads above 5 MiB per file,
  and check 4,096-pixel edges / 12-million-pixel dimensions before decoding.
  Re-encoded output must also fit 5 MiB. The future HTTP adapter must separately
  enforce the **16 MiB complete multipart request**, including metadata and
  boundaries. This service is not a multipart parser.
- Check PNG structure/CRCs and exact decompressed scanline size. Discard ancillary
  metadata before decoding; compressed private text/profiles are never inflated.
  Support static PNG including packed/indexed/grayscale/16-bit input and Adam7.
  Reject animated PNG as unsupported rather than silently discarding frames.
- Read only EXIF orientation, rotate/mirror pixels, and freshly encode without
  EXIF, comments, profiles or text. Do not collect EXIF GPS/time. PNG becomes
  8-bit RGBA with alpha; JPEG is re-encoded at quality 90. Color/quality and byte
  size can change. Report location/time remain separate reviewed report fields.
- Hash original upload bytes separately from sanitized bytes. The future request
  digest must use original upload hashes and normalized metadata, independent
  of codec re-encoding. Do not trust filenames or client MIME declarations.

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
and SES are unverified. Production maximum-size CPU/memory/concurrency still
requires measurement on the selected Worker plan before enabling uploads;
small synthetic runtime checks do not establish production load capacity.
