# DevDeck scoop bucket

Install DevDeck (and keep it updated) with [scoop](https://scoop.sh):

```powershell
scoop bucket add devdeck https://github.com/d3velopm3nt/devdeck
scoop install devdeck
```

Update to the latest release:

```powershell
scoop update devdeck
```

Uninstall:

```powershell
scoop uninstall devdeck
```

## Notes

- DevDeck installs **per-user** via its official signed installer — **no admin
  (UAC)** prompt.
- The manifest lives at [`bucket/devdeck.json`](devdeck.json); this repo *is* the
  bucket, so `scoop bucket add devdeck <repo-url>` is all you need.
- New releases: bump `version`, `url`, and `hash` in the manifest (or run
  `scoop checkver devdeck -u` in a clone of this bucket).

## The meta-test 🥚

Once the bucket is added, DevDeck's own **Machine Setup** can install/update
DevDeck through scoop — the app installing itself.
