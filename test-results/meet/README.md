# The first run

`feat/assistant-meet`. Captured against a real DevDeck with 17 projects and
6 agents, on a personal store that had never been asked anything.

| Shot | What it proves |
|---|---|
| `1-first-run.png` | The screen exists at all. It had never existed before — every previous launch dropped you into an empty tree. |
| `2-shield-footer.png` | Same screen, with the shield on the two-stores promise instead of a second sparkle. |
| `3-gmail-setup.png` | The two walls of a Gmail connection, in the order you hit them. Shown only when this build has no Google client. |
| `4-google-signin.png` | One click instead, when a client is configured. Captured with a dummy client id, so nothing ever reached Google. |

## What the screenshot actually verifies

The three voice cards are **not** in the frontend. They come from
`aiw_voices`, which reads `persona::voices()` in Rust — so a rendered card
with a sample in it is proof the command is registered, reachable and
returning. An empty row would have meant the opposite, which is why the
component reports a failure there rather than rendering nothing.

`Next` is disabled because there is no name yet. That is the whole of the
validation: a voice always has a default, a name never does.

## What it does not verify

Nobody clicked Next. This session has no interactive desktop, so the submit
path is covered by tests instead of by a picture:

- `aiw::persona::tests` — 5 tests. A voice carries a sample and an
  instruction, a body is voice + duties and never says "developer's
  assistant" again, custom words beat the presets, changing voice keeps a
  duty added by hand, and a hand-written file is left alone.
- `aiw::personal::tests::who_you_are_survives_a_round_trip_through_the_file`
  — every new field is `skip_serializing_if` + `default`, the combination
  that drops a value silently. If it ever fails, the symptom is being asked
  who you are on every launch.
- `aiw::personal::tests::editing_a_preference_does_not_erase_your_name` —
  guards a bug I wrote and fixed in the same slice. `aiw_save_profile` built
  a fresh `ProfileMeta` from its two arguments, so saving a preference would
  have wiped your name and the fact you had been introduced.

Full suite: 496 passed, 0 failed.

## Gmail

`3-gmail-setup.png` is the answer to "make the Gmail connection easy". There
are exactly two walls and the form now names both:

1. Google has not accepted account passwords over IMAP since 2022.
2. The page that makes app passwords is a 404 until 2-Step Verification is on.

Both buttons open the real Google pages. The refusal is also translated in
`mail.rs`: Gmail answers a wrong password and a correct-but-wrong-*kind*
password with the same eight words, so `explain_login` says which one it is
and still prints what the server said. Three tests cover it, including one
that a dropped connection is **not** reported as a password problem.

## Google sign-in

`4-google-signin.png` is the flow proper: system browser, loopback redirect on
a port the OS picks, PKCE, refresh token into Windows Credential Manager,
XOAUTH2 for both IMAP and SMTP. No password reaches DevDeck.

The button is disabled in the shot because the address field is empty, which
is deliberate: without it Google shows an account chooser with a blank entry.

**Why the free route is real.** The 7-day refresh-token expiry is tied to a
publishing status of *Testing*, not to being unverified. A project set to *In
production* issues refresh tokens that last. What an unverified app does pay
is a consent screen saying Google has not verified it, and a **100-user
lifetime cap on the project that cannot be reset**. Right for one person on
their own mailbox; wrong for shipping to strangers, and that is when
verification earns its money.

Twelve tests in `gauth.rs` cover the parts that can be tested without Google:
the challenge really is the SHA-256 of the verifier, two sign-ins never share
one, the auth URL asks for a refresh token explicitly, a favicon request is
not read as a callback, a form body escapes the `/` and `+` that a real
authorization code contains, and an `invalid_grant` names the Testing-status
trap.

Nothing here has been run against a real Google account. That needs a client
id, which is configuration this repository deliberately does not carry.

## One thing worth knowing about capturing this

A capture taken before WebView2 paints returns pure white, which is
indistinguishable from the white-screen crash the `Icon name` bug used to
cause. It cost two cold restarts here before the third capture of an
unchanged build came back correct.

The harness's sample-colour line says `ok` either way. `scripts/shoot.ps1`
now retries until the frame has more than two colours, which answers "has it
drawn" but never "is it right". Still open the image.
