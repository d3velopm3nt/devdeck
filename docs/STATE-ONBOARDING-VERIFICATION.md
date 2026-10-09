# State repository onboarding recovery — 7 October 2026

Recovered the uncommitted state onboarding changes on `fix/state-repo-onboarding`.

## Behavior

- Onboarding offers GitHub device sign-in when configured, a PAT fallback, or an existing local folder/clone.
- The repository picker lists the authenticated user's repositories without example data. Cloning and Deck fetching use the saved credential for GitHub HTTPS without storing it in repository configuration.
- Explorer and Deck use the same selected vault root. Root selection and its index update share a transaction; old independent watcher settings are removed.
- Shared state repositories show marked top-level spaces, excluding unmarked canvas and skills folders. The existing repository layout stays intact.
- A successful clone can be reused after indexing fails. Reuse requires both the same repository URL and destination parent.
- Release builds can embed the repository variable `DEVDECK_GITHUB_CLIENT_ID`. The code does not register an OAuth app or populate that variable; device sign-in remains unavailable without configuration. PAT/local setup stays available.

## Verification

- Frontend lint passed, with existing advisory warnings.
- `npx tsc -b` passed.
- Production frontend bundle (`npx vite build`) passed, with existing chunk warnings. This does not establish a Windows installer build.
- `git diff --check` passed.
- Full `npm run build` could not stage the native sidecar: this sandbox has no Rust toolchain.
- Added native regression tests for shared-state filtering and transactional selection rollback. They require the Windows CI Rust job and have not run locally.
- Added `harness/check-onboarding.mjs` for PAT/repository selection, retry, clone failure, invalid URLs, local setup, and configured OAuth availability. Local Chromium launch was blocked by the sandbox's socket restrictions. GitHub CI runs these with mocked native IPC; they do not test live GitHub authentication or Windows Credential Manager.

## Windows follow-up

After CI passes, check real PAT authentication against the private state repository, confirm Life and Work appear, switch Storage and verify Deck follows it, and verify a remote update refreshes Explorer. OAuth additionally requires an OAuth app with Device Flow enabled and its client ID configured for the build. No new release tag or published installer was created during this recovery.
