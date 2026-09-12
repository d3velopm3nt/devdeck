# The first run

`feat/assistant-meet`. Captured against a real DevDeck with 17 projects and
6 agents, on a personal store that had never been asked anything.

| Shot | What it proves |
|---|---|
| `1-first-run.png` | The screen exists at all. It had never existed before — every previous launch dropped you into an empty tree. |
| `2-shield-footer.png` | Same screen, with the shield on the two-stores promise instead of a second sparkle. |

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

## One thing worth knowing about capturing this

The first capture came back pure white and looked like the white-screen
crash from the `Icon name` bug. It was not. React had not mounted yet. The
second capture of the same unchanged build was correct.

The harness's "2 distinct sample colours" line said `ok` for the blank one
and `ok` for the good one. The counter cannot tell them apart. Open the
image.
