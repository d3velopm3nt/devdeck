# Learn run, Your Life, Home: test report

Branch `feat/mail-learn-run`, 14 September 2026. Goal:
`design/goals/learn-life-home.md`.

Everything on screen below came from a **throwaway profile** with a made-up
mailbox (`DEVDECK_HOME` override, nine invented contacts, 45 invented
messages) and the **mock provider**. Nothing was sent anywhere, and your real
mailbox was never read. The names on the screens are not real people.

## Automated

| Suite | Result |
|---|---|
| Rust, `cargo test --lib` | **567 passed, 0 failed** |
| Frontend, `npx tsc -b` | clean |

New tests, by rule:

- `what_is_known_about_a_space_reaches_every_feature_in_it` — a kept fact
  in `knowledge/` reaches an agent's context, inherited like a rule.
- `a_thread_an_earlier_run_read_is_not_read_again_unless_new_mail_arrived`
  — a second run skips read threads; a new message in one goes.
- `nothing_from_a_business_is_lent_into_a_personal_space_and_its_manager_is_lent_nowhere`
  — the Personal gate, six cases.
- `a_heavy_model_is_stepped_down_for_bulk_reading`,
  `same_generation_means_the_same_generation`,
  `a_model_it_does_not_recognise_is_left_exactly_as_chosen` — Opus 5 reads
  with Sonnet 5, never Sonnet 4.5, never an unknown model.
- `a_message_carrying_a_login_code_is_skipped_whole`,
  `talking_about_two_factor_is_not_carrying_a_code` — codes are skipped
  whole; a conversation about 2FA is not.
- `one_heavy_correspondent_cannot_starve_the_others` — the 400,000-character
  ceiling is spent round-robin.
- `what_you_turned_down_is_carried_into_the_next_prompt` — a No is told to
  the model next time.
- `clicking_an_account_shows_only_the_people_in_that_mailbox`,
  `a_contact_shows_every_message_with_them_not_only_what_they_sent`.

## The base, step by step

| # | Step | State | Evidence |
|---|---|---|---|
| 1 | Managers and the assistant read `knowledge/` | done | test; `12-home-known.png` shows exactly what the Home manager reads |
| 2 | A run does not re-read | done | test; the estimate lists "already read by an earlier run" when it applies |
| 3 | Personal tag, enforced | done | test; gate at hand-over and hand-on; `12-home-known.png` shows the tag |
| 4 | People as records | done | `11-life-page.png`; `<personal>/people/person_….md` written |
| 5 | Inbox as the one queue | done in code | proposed facts are Inbox rows with Keep / No; Life shows "18 to confirm, in Inbox". **No screenshot** — see below |
| 6 | Onboarding, live | done | `03` to `08b` |
| 7 | Your Life page | done | `11-life-page.png` |
| 8 | Home space tabs | partly | a **Known** tab on every space (`12-home-known.png`). House / Routines / Upkeep as separate tabs are not built; the notes are grouped by subject instead |
| 9 | Senders you pay | **not built** | still on the list |

## Screens

| File | What it shows |
|---|---|
| `00-vault.png` | First launch on a fresh profile: choose where DevDeck keeps things |
| `01-voice.png` | First run, voice step (unchanged) |
| `03-learn-sorting.png` | Learn step, sorting on this machine: Inbox 38 · Sent 7 · Drafts 0; 6 people you write back to; 29 automated, ignored; 2 codes skipped whole; "Nothing has left this machine" |
| `04-learn-approve.png` | One approval: 7 threads, 16 messages, 6 people, 734 tokens; not included 29 / 29 / 2; Who; Read them / Not now; the mock's own note that its facts are scripted |
| `05-learn-reading.png` | Reading live: 2 of 6 people, 7 facts so far, ticks per person, spinner on the current one, Keep / Dismiss on each fact, As they come / At the end, Stop |
| `05b-learn-reading-later.png` | Same run, 5 of 6 people, 17 facts |
| `06-learn-done.png` | Done: 0 kept · 18 waiting · 0 dismissed; receipt: sent 16 messages in 7 threads, 772 tokens, to mock-1; held back 31; ignored 29; kept in the personal store |
| `07-life.png` | Life step: the six people from mail with role chips, "anyone I missed?", free text |
| `08-home.png` | Home step, empty |
| `08b-home-made.png` | Home step filled with sample answers (the harness typed them) a moment before it made the space |
| `12-home-known.png` | The Home space: tagged Personal, Pool / Garden / House, a Home manager, and the Known tab with the five notes the setup wrote |
| `12b-home-thread.png` | The Home space's thread: the Home manager, its Monday routine "What is due at home", its files |
| `11-life-page.png` | Your life: Grace under "Who helps", and "18 to confirm, in Inbox" |

**Not captured:** the Inbox with proposed facts, and Today with "Finish
setting up" and "Your life". The capture harness could not switch the rail on
the throwaway profile in the time I had; the code paths are the same ones the
buttons use and the counts on the Life page come from that Inbox query.

## What I changed that you should know about

- **`DEVDECK_HOME`** now moves the whole profile (database, personal store,
  attachments). It exists so a throwaway profile can run beside yours. Unset,
  nothing changes.
- **The mock is a provider for the learn run too.** It answers with facts
  marked "(scripted by the mock provider)". The estimate says so in words.
- **Facts arrive one per line.** The prompt asks for one JSON object per
  line, so the real provider can show each fact as it is written.
- **A run's automated count is the mailbox's.** "Skipped whole" counts codes
  across the whole inbox, not only among the chosen people's mail.
- **Capture flags** in `src/lib/devCapture.ts` are all empty again.

## For you to test tomorrow

1. Launch. Today shows **Finish setting up**. Click it: the learn step runs
   against your real Gmail on **Sonnet 5**, about $0.39, only after you press
   Read them.
2. Facts arrive one at a time; Keep, Dismiss, or leave them for the Inbox.
3. The Life step proposes your home from your mail; correct it.
4. The Home step makes the Home space, tagged Personal.
5. Your life is on Today; the Home space is in Spaces with a Known tab.

## Not done

- Senders you pay (step 9), so Home's upkeep is not learned from invoices yet.
- House / Routines / Upkeep as tabs: a Known tab with grouped notes instead.
- Inbox and Today screenshots.
- Your Life workspace is still tagged **Business** in your tree; I did not
  touch your data.
