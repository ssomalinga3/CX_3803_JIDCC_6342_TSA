# Private S3 report-photo adapter (J6-29)

This continues the [photo foundation](report-photos.md) from PR #51. The AWS SDK
v3 adapter stores sanitized bytes in S3 behind the existing guest-ownership
boundary. Email is separate: its adapter will use SMTP credentials, not S3 keys.
The adapter alone does not deploy an endpoint. The follow-up
[custom-only development API](custom-reports.md) now connects local HTTP submissions.

## Server configuration and permissions

Keep `AWS_REGION`, `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and
optional `AWS_SESSION_TOKEN` in ignored `backend/.env` for Node tooling. The
adapter requires explicit credentials and never falls back to shared machine
profiles or instance metadata. Never use Expo public variables, log the settings,
or commit/paste secrets into issues and PRs.

The SDK uses the AWS region's HTTPS endpoints and the fetch HTTP transport with
a 15-second timeout. Automatic SDK retries are disabled so the reporting service
can account for ambiguous writes. For a deployed Worker, supply server secret
bindings and construct `createS3PhotoStore(s3PhotoConfig(bindings))` at the
authorized reporting boundary. A local `.env` is not a deployment mechanism.

The following example is for the verification identity. Replace `BUCKET_NAME`.
A production object-only identity can omit the privacy-check read permission.
No bucket management, public ACL or unrestricted listing permission is needed.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "VerifyBucketPrivacy",
      "Effect": "Allow",
      "Action": "s3:GetBucketPublicAccessBlock",
      "Resource": "arn:aws:s3:::BUCKET_NAME"
    },
    {
      "Sid": "ReportPhotoObjects",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::BUCKET_NAME/report-photos/*"
    }
  ]
}
```

Keep all four bucket Block Public Access settings enabled. Explicit denies and
organization/encryption policies may also affect access. The adapter requests
SSE-S3 (`AES256`); a KMS-only bucket needs a separately reviewed configuration
and permission change. This code does not modify IAM or bucket settings.

SMTP host, port, username, password and sender remain separate configuration.
Do not treat AWS access keys as SMTP credentials. Actual email delivery is J6-32.

## Object and access behavior

- Stable object names are `report-photos/<opaque UUID>`; database references
  remain stable keys, never expiring URLs. Keys and metadata contain no filename,
  recipient address, location or raw guest secret.
- Writes include sanitized type/size, dimensions, owner digest and original/
  sanitized SHA-256 hashes, `private, no-store`, AES256 encryption and
  `If-None-Match: *`. A confirmed overwrite conflict is distinguished from an
  ambiguous write failure: cleanup preserves the existing key while removing
  earlier keys belonging to this failed batch.
- Reads validate metadata, dimensions, bounded length and sanitized-content hash.
  Only `NoSuchKey` becomes missing; permission errors fail closed. Without
  ListBucket, S3 may return 403 for missing objects, so absence is not inferred
  from AccessDenied. DELETE itself is idempotent; the later acceptance/cleanup
  journal must authorize its keys independently of this missing-key ambiguity.
- `issueDownload` verifies guest ownership before SDK presigning. Another
  guest/submission cannot mint a URL; staff roles and recipient addresses alone
  do not authorize access. A presigned URL is a capability usable by its holder
  until expiry: never persist, log or publish it. Deletion removes availability.
- Signed downloads are bounded to 1–300 seconds for this integration slice.
  Local HMAC grants remain distinct. Production media authorization, retention,
  cache and recipient-delivery policies still require the reporting contract.

## Verification

```sh
nvm use
pnpm --dir backend photos:s3:check
pnpm --dir backend photos:s3:check --write
pnpm --dir backend test --runInBand s3-photo-store.test.ts photos.test.ts local-photo-store.test.ts
pnpm --dir backend test:photos:worker
```

The default live check reads public-access-block configuration without enumerating
objects. `--write` requires all four blocks before creating a small synthetic
image. It checks sanitization, owner-authorized signed access, guest isolation,
anonymous denial, one-second URL expiry and deletion. Cleanup is retried in
`finally`. No real visitor image, credential, signed URL, object key, raw SDK
message or server XML is printed. No configuration is changed. A forced kill or
denied deletion may require operator cleanup of the synthetic object under
`report-photos/`; this script does not claim a durable crash-recovery journal.

On November 18, the initial saved key returned `InvalidAccessKeyId`; after the
owner replaced it, the privacy read initially returned `AccessDenied`. No upload
occurred during those failed checks. After the owner granted the missing
permission, the live Node/AWS SDK check passed: all four bucket public-access
blocks, synthetic sanitized upload/read, owner isolation, anonymous denial,
actual signed-URL expiry and object deletion. No visitor image or email was used.

All 17 backend suites / 208 tests passed against local PostGIS. Lint, typecheck,
TypeScript build, production Worker dry-run build and the isolated Worker SDK
fixture passed. The Worker fixture uses a fake transport; it is separate from
the successful live Node/S3 test. Nothing was deployed. The local development
reporting Worker now supports acceptance/replay. Object deletion removes the current key; if
versioning is enabled, retention of older versions needs its own lifecycle policy.

Unit tests exercise the actual SDK serializer/signer with synthetic credentials
and fake fetch responses. The isolated Worker fixture runs the SDK storage and
presigning paths against a fake transport, without real AWS credentials/network.
Regression coverage includes overwrite-conflict cleanup, ownership, malformed
metadata, corrupt bytes, missing objects, traversal and fixed service errors.

J6-30 now supplies a bounded local multipart boundary, development categories,
upload leases and atomic database acceptance/pending notification work. Approved
production categories/destinations and hosted write setup remain open.
J6-31 adds mobile capture. J6-32 adds SMTP delivery and ambiguous-send recovery.
Staged S3 photos alone are neither accepted reports nor delivered notifications.
