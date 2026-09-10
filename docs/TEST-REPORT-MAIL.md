# Mail module — test report

**Date:** 6 September 2026 · **Branch:** `claude/email-manager-contacts-xrr32d`

What was built, what was actually verified, and — the part that matters — what
was **not**. This report follows the house rule from `CLAUDE.md`: *never let a
failed check look like a success.*

---

## The honest headline

Every screen was built and every screen was driven and photographed. But this
work was done in a **Linux cloud container**, and DevDeck is a **Windows Tauri
app**. So:

| | |
|---|---|
| ✅ Verified by running it | Rust unit tests, `cargo check`, `tsc -b`, all UI screens rendered and interacted with in a real browser |
| ❌ **Never executed** | The actual `devdeck.exe`. No Windows, no WebView2, no desktop session |
| ❌ **Never executed** | Windows Credential Manager (`creds.rs` is a stub on non-Windows — `set()` returns an error, `get()` returns `None`) |
| ❌ **Never executed** | A real IMAP fetch or SMTP send against a live mail server |

**The screenshots below are the real React components and the real zustand
store, rendered in Chromium against a mocked `invoke` boundary.** They are not
photographs of DevDeck running on Windows. Everything above the IPC call is
shipping code; the Rust behind it is compile-checked and unit-tested but has
not been driven by a real mailbox.

**Before trusting this on a real account, do the three things at the bottom of
this report.**

---

## What was verified, and how

### 1. Rust — compiles and passes unit tests

```
cargo check          0 errors, 0 warnings from src/mail.rs
cargo test --lib     55 passed; 0 failed
```

The toolchain in the container was rustc 1.94.1, which is **older than the
project's own lockfile requires** (`sysinfo 0.39.6` needs 1.95). That is a
pre-existing condition, not something this branch introduced — it was fixed
locally by installing 1.95.0. `cargo check` also needed GTK/webkit dev headers
installed, which a Windows build never does.

Nine of the 55 tests are new and cover the parts most likely to be wrong:

| Test | What it pins down |
|---|---|
| `thread_key_strips_reply_prefixes` | `Re:`/`Fwd:` chains collapse to one thread; "Refund please" is *not* treated as a `Re:` prefix |
| `mailbox_names_map_to_local_folders` | `[Gmail]/Sent Mail`, `INBOX.Drafts` etc. land in the right local folder |
| `automated_senders_are_recognised` | `noreply@`, `Auto-Submitted`, `Precedence: bulk` are detected; a human is not |
| `preview_strips_html_when_there_is_no_text_part` | HTML-only mail still gets a readable list preview |
| `parses_a_multipart_message_with_an_attachment` | Real MIME: From/Subject/Date parsed, body extracted, attachment named |
| `storing_a_message_creates_its_contact_and_upserts_on_resync` | Sender becomes a contact; the **same UID does not duplicate** |
| `a_local_read_survives_the_next_sync` | Marking read here is **not undone** by the server still reporting it unseen |
| `attachments_are_replaced_not_duplicated_on_resync` | Re-syncing does not multiply attachment rows |
| `credential_target_is_scoped_per_account` | Mail credentials cannot collide with connection credentials |

### 2. TypeScript — clean

```
npx tsc -b           exit 0
```

(Run with `tsc -b`, not `tsc -p tsconfig.json` — per `CLAUDE.md`, the root
config is references-only and `-p` would exit 0 while compiling nothing.)

### 3. The screens — rendered and driven in a browser

A harness (`harness/`, `vite.harness.config.ts`) swaps **only** the Tauri IPC
boundary for a mock and renders the real `App`. Components, store slice, and
`lib/ipc` wrappers are all production code; the fixture returns payloads shaped
exactly like the Rust structs.

```
node harness/shoot.mjs
```

**14 assertions, all passing, 0 console errors, 0 page errors:**

```
PASS  inbox renders list + sidebar
PASS  attachments listed with sizes
PASS  source shows real headers
PASS  assistant notes render
PASS  compose shows the sending host
PASS  reply prefills subject + recipient
PASS  account editor offers both providers
PASS  contacts list + link groups
PASS  Inbox: sidebar says 7, list shows 7
PASS  Bot & automated: sidebar says 2, list shows 2
PASS  Clients: sidebar says 3, list shows 3
PASS  Flagged: sidebar says 1, list shows 1
PASS  search narrows, both Sable addresses match (sable=2, nonsense=0)
PASS  unread badge reflects the fixture (3)
```

The count assertions check the invariant that actually bites: **the number on a
sidebar row must equal the number of rows in the list it filters to.** A badge
that lies is worse than no badge.

Three defects were found and fixed by this harness while building it:

1. A `null` from an unmocked command surfaced as `states is not iterable` three
   frames from the cause — the mock fallback now returns an empty list.
2. The fixture's hardcoded `clients: 4` disagreed with its own message list (3).
   Counts are now derived from the data, which is what made the invariant above
   worth asserting.
3. Contact→client links rendered blank because the harness seeded `node_list`
   instead of `tree_list`. Caught by looking at the screenshot, not by a test.

---

## Screenshots

All at 1440×900, dark theme, real components. The log panel is collapsed and
the update banner dismissed so the mail surface gets full height.

| Screen | Shot |
|---|---|
| Inbox — groups, filters, HTML body in a sandboxed frame | [`01-inbox.png`](screenshots/01-inbox.png) |
| Attachments tab, with sizes and types | [`02-attachments.png`](screenshots/02-attachments.png) |
| Source tab — the headers that actually arrived, with SPF/DKIM/DMARC | [`03-source.png`](screenshots/03-source.png) |
| Assistant — summary, suggested reply, and the action it took | [`04-assistant.png`](screenshots/04-assistant.png) |
| A plain-text message with an attachment | [`05-plain-body.png`](screenshots/05-plain-body.png) |
| Reply — prefilled from the address it arrived at | [`06-reply.png`](screenshots/06-reply.png) |
| Compose — recipients autocompleting from the address book | [`07-compose.png`](screenshots/07-compose.png) |
| Editing the develtech.co.za IMAP + SMTP account | [`08-account-edit.png`](screenshots/08-account-edit.png) |
| Adding an account — Gmail or IMAP + SMTP | [`09-account-new.png`](screenshots/09-account-new.png) |
| Contacts, linked to clients and projects | [`10-contacts.png`](screenshots/10-contacts.png) |

---

## Design decisions worth challenging

- **Contacts live inside Mail**, behind a Mail/Contacts switch in the sidebar,
  rather than taking a rail slot. Cheap to promote if you disagree.
- **Archive and delete are local only.** DevDeck is not the only client on your
  mailbox; archiving here should not surprise you on your phone. Same for
  marking read — the local read wins and is never undone by a sync.
- **Attachments are metadata until you save one.** Syncing a mailbox must not
  quietly fill the disk.
- **Remote images are blocked.** The HTML body renders in an iframe with
  `sandbox=""` and a CSP of `default-src 'none'; style-src 'unsafe-inline';
  img-src data:`. No scripts, no network, no same-origin access — a tracking
  pixel is a read receipt you never agreed to.
- **rustls, not native-tls.** native-tls means SChannel on Windows but OpenSSL
  headers everywhere else; a mail client that only builds on one machine is not
  a mail client.
- **200 messages per mailbox per sync.** Older mail stays on the server until
  you go looking.

---

## What to check first on a real Windows machine

These are the three places the container could not reach, in the order they are
likely to bite:

1. **Credential Manager round-trip.** Add the develtech.co.za account with a
   password, restart DevDeck, confirm the account still shows *"password
   stored"* and that a sync works. `creds.rs` is a no-op stub on Linux, so this
   path has **never executed**.
2. **A real IMAP sync.** Press *Test connection* first — IMAP and SMTP are
   reported separately precisely because one can work while the other does not.
   Then sync and check: are threads grouped sensibly, do `[Gmail]/Sent Mail`
   and friends land in the right folders, do attachments list correctly?
   Gmail needs an **app password**, not your Google password.
3. **A real send.** Send to yourself from each account. Confirm the copy filed
   under Sent, and that a reply goes out from the address the original arrived
   at rather than the default account.

Also worth an eye: the HTML body iframe under WebView2 specifically. The CSP
and `sandbox=""` behave the same in Chromium and WebView2 in principle, but
"in principle" is doing work in that sentence.
