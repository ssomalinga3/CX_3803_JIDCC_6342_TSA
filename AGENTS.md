# Repository Guidelines

## Engineering Ownership

You share ownership and long-term maintenance of this codebase with the human contributors and their agents. Take responsibility for its correctness and maintainability, and own each assigned task from investigation through implementation, verification, and documentation. Consider effects across mobile, backend, data, and offline behavior; address root causes and leave the affected code maintainable.

Within the authorized task scope, make routine implementation decisions and carry the work through to a verified result without waiting for step-by-step direction. Follow the project sources and decision boundaries below. Surface blockers and unresolved product decisions early, continue independent work, and clearly report any remaining gaps or unverified behavior.

Respect Jira task ownership and preserve other contributors' changes. When work overlaps or requires incompatible changes to shared interfaces, surface the conflict and coordinate the affected work before proceeding; continue independent work where possible. Keep refactoring tied to the assigned task, and report broader improvements separately for team prioritization.

## Authoritative Project Sources

Start with [docs/README.md](docs/README.md) for the specification index, source precedence, and links to Figma and Jira. Use Figma for UI design and Jira for task scope and ownership.

Read the relevant specifications before editing: [architecture](docs/architecture.md), [data model](docs/data-model.md), [API](docs/api.md), [security](docs/security.md), and [offline GIS](docs/offline-gis.md). Use [UI specifications](docs/design/ui-spec.md) and [user flows](docs/design/user-flows.md) for interactions and acceptance criteria. Keep solution details in those documents; this file governs how agents work.

## Development & Architectural Constraints

- Use pnpm with the versions pinned in `.nvmrc` and root `package.json`. Install from the workspace root and maintain one root `pnpm-lock.yaml`; do not introduce npm or Yarn lockfiles.
- Add Expo/React Native dependencies through `pnpm --dir mobile exec expo install`. Use development builds for MapLibre; rebuild after native dependency or configuration changes. Keep durable configuration in Expo config/plugins rather than editing generated native projects.

Follow the selected stack and module boundaries in `docs/architecture.md`. Keep spatial SQL in data access, notification transport in its adapter, and device behavior in the mobile application. Validate network input at runtime and enforce authorization on the server.

Keep credentials out of source control and mobile bundles, and exclude GPS coordinates from logs. Apply the guest-reporting and custom-recipient privacy requirements in `docs/security.md` across persistence, APIs, notifications, and offline retries.

## Approach to Nontrivial Tasks

1. Inspect relevant specifications, existing code, repository instructions, and the working tree. Preserve unrelated changes.
2. Outline the implementation steps, affected interfaces, and verification plan before editing.
3. Make focused, reviewable changes that follow nearby naming, indentation, and configured formatting rules. Avoid unrelated refactoring or dependencies.
4. Update affected contracts, migrations, and specifications together. Document new setup or development commands where contributors will find them.

## Testing & Verification

Discover commands from package manifests, repository scripts, and setup documentation; do not guess script names. Run applicable lint, type checks, tests, and builds. Add meaningful regression tests for changed behavior, using backend Jest tests where applicable.

Treat JavaScript bundle checks, native compilation, and device smoke tests as separate evidence; passing one does not establish the others.

Verify affected acceptance paths from `docs/design/user-flows.md`, including permission denial, offline restart/retry, duplicate prevention, and access restrictions. Check mobile changes on iOS and supported Android targets as appropriate.

Run `git diff --check` and review the final diff. Report checks performed, outcomes, and anything unverified.

## Unclear Requirements

Consult [docs/decisions.md](docs/decisions.md); distinguish Baseline, Proposed, and Open requirements. Ask for clarification when ambiguity affects product behavior, privacy, architecture, or scope; continue independent work. Never silently treat a proposal as approval. Record confirmed resolutions and update affected specifications.

## Commits & Pull Requests

Create new pull requests as drafts. Small fixes (such as a rebase) should not reset a PR to draft, but large changes should.

Use concise, action-oriented commit subjects. PRs should describe behavior changes, link relevant J6 issues, report verification, and include screenshots for UI changes.
