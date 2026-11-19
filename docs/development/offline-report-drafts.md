# Durable private drafts (J6-33)

The owner selected installation-only retention until an authorized receipt or
explicit deletion on November 19, 2026. One active draft keeps its category,
explicit custom recipients, notes, reviewed location, photos, submission UUID,
and reference to its report-scoped SecureStore ownership key.

Native Expo Crypto AES-GCM encrypts the complete snapshot, including photo bytes.
The encryption key uses SecureStore with iOS WHEN_UNLOCKED_THIS_DEVICE_ONLY.
Documents contain authenticated ciphertext. A backup without its installation key
cannot recover private contents. Plaintext photo files exist only in app cache
while editing or sending. They are recreated from encrypted bytes after restart.
The modules already belong to the J6-31 development build.

Two bounded 22 MiB snapshot slots retain the last complete generation. Writes
serialize, authenticate a temporary file before publishing, and replace the older
slot. Recovery selects the newest valid snapshot. An interrupted write can recover
the prior generation. Saving is debounced while editing, and the UI distinguishes
saving, saved, and failed storage. A process killed before the saved indication
may recover the preceding snapshot.

Before a network attempt, the exact reviewed report is durably saved as attempted.
A SecureStore attempted marker also prevents an older recovered review from
becoming editable. Retry preserves its UUID, secret, metadata and photo bytes.
A receipt is persisted before temporary photos are removed. Invalid snapshots,
missing keys, missing photo files and a changed API server retain the snapshot
and show a recovery error. No new identity replaces an attempted credential.
The explicit Discard action explains that a server-accepted report may still be
delivered after its local copy is removed.

Preload reporting options once online. The saved catalog supports capture on
later offline launches, and the server revalidates it when submitting. No
production category or park destination is invented for first launch offline.
Map-cache removal is separate from report storage.

Native verification remains required on Android and iOS 26. Capture synthetic
content, wait for Saved, force quit in airplane mode, reopen and compare photos,
recipients, note and reviewed location. Test storage failure and interruption,
then repeat an attempted report with a lost response and confirm one server
observation and one notification per recipient. Record screenshots using test
content. Loss of the installation/secure key has no recovery path in this release.
