# Code signing (SignPath Foundation)

DevDeck's Windows installer is signed for free by the **[SignPath Foundation](https://signpath.org/)**
open-source program. A trusted signature is what removes the Windows SmartScreen
"Unknown publisher / Windows protected your PC" warning for people who download
the installer.

The release pipeline is **already wired for it**. Signing is plug-and-play:

- **Not configured yet** → releases publish **unsigned** (still work, just show the
  SmartScreen warning).
- **Configured** (the repo variables + secret below exist) → the release workflow
  automatically submits the built installer to SignPath, waits for the signed
  binary, and publishes **that** instead.

No code changes are needed to turn it on — only the repo settings in step 3.

---

## 1. Apply to SignPath Foundation

Apply at **https://signpath.org/apply**. Suggested answers:

| Field | Value |
|---|---|
| Project name | **DevDeck** |
| Repository | https://github.com/d3velopm3nt/devdeck |
| License | MIT |
| Description | A local-first development command center for Windows — start, monitor and jump into all your dev services and terminals from one window (Tauri + Rust + React). |
| Build system | GitHub Actions (`.github/workflows/release.yml`) |
| Artifact | Windows NSIS installer, `DevDeck_<version>_x64-setup.exe` (Authenticode) |
| Maintainer | Develtech (you) |

SignPath verifies that published binaries come from **this public repo's CI** —
there's no personal-identity check, no USB token, and no per-signature fee.
Approval typically takes a few days.

## 2. Configure the project in SignPath (after approval)

In the SignPath web app you'll set up (their onboarding walks you through it):

1. Your **Organization ID** (a GUID) — copy it.
2. A **Project** — use slug **`devdeck`**.
3. An **Artifact configuration** for the NSIS installer (Authenticode signing of the `*-setup.exe`).
4. A **Signing policy** — use slug **`release-signing`**.
5. A **Trusted build system** linked to this GitHub repo + the `Release` workflow
   (this is how SignPath confirms the artifact came from CI).
6. A **CI user** and its **API token**.

> Keep the slugs exactly `devdeck` / `release-signing`, or update the matching
> repository variables in step 3 to whatever you chose.

## 3. Add the repo secret + variables

GitHub → repo **Settings → Secrets and variables → Actions**:

**Secret** (tab: *Secrets*)
- `SIGNPATH_API_TOKEN` = the SignPath CI user API token

**Variables** (tab: *Variables*)
- `SIGNPATH_ORGANIZATION_ID` = your SignPath organization GUID
- `SIGNPATH_PROJECT_SLUG` = `devdeck`
- `SIGNPATH_SIGNING_POLICY_SLUG` = `release-signing`

The workflow keys off `SIGNPATH_PROJECT_SLUG`: set it and signing turns on; leave
it empty and releases stay unsigned.

## 4. Release

Cut a release as usual — push a tag:

```bash
git tag v0.1.2
git push origin v0.1.2
```

The `Release` workflow will: build the installer → upload it → **SignPath signs it**
→ publish the **signed** installer to the GitHub Release.

## 5. Verify

Download the released `*-setup.exe`, right-click → **Properties → Digital
Signatures** — you should see the SignPath Foundation certificate (issued for
DevDeck). SmartScreen no longer shows "Unknown publisher".

---

### Notes

- **Reputation:** even with a valid signature, a brand-new certificate can take a
  little while to build SmartScreen reputation; it clears much faster than an
  unsigned binary and never resets to "Unknown publisher".
- **Updater:** DevDeck doesn't ship an auto-updater yet. If one is added later,
  Tauri's updater uses a **separate, free** minisign keypair (`tauri signer
  generate`) — unrelated to the Authenticode signing above.
- **Self-signed alternative:** a self-signed certificate is free but is **not**
  publicly trusted (SmartScreen still warns except on machines that import your
  cert). It's only useful for internal/enterprise distribution or testing — which
  is why we use SignPath Foundation instead.
