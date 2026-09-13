# Goal: the learn run, Your Life, and Home — built to completion

Branch `feat/mail-learn-run`. Designs: `design/onboarding-learn`, `design/life`,
`design/home`. Decisions taken on 13–14 Sep 2026:

- Gmail is personal. Nothing learned from it is a client fact; everything goes
  to the personal store. Clients wait for a business mailbox.
- Automated mail: option A. Counted, never read, never sent, never raised.
- Home is a **space**, tagged Personal, so it can grow as folders and files
  without ever having to be moved out of Life.
- Life is the **people**, in the personal store. Home refers to them; it never
  copies anything private.
- Only the assistant reads Life. Managers never do.
- Questions live in the Inbox. Pages show a count and link.
- The vault is not synced, for now.
- The user runs the real learn run themselves, during onboarding, on Sonnet.
  Nothing is sent overnight. Live screens are tested on a made-up mailbox
  with the mock provider.

## The base, in order

Each step is done when its tests pass, `npx tsc -b` is clean, and the report
has a screenshot where there is a screen.

1. **Managers and the assistant read `knowledge/`.** A kept fact about a space
   reaches whoever works there. Today nothing reads that folder.
2. **A learn run does not re-read.** Threads a past run read are skipped
   unless a newer message arrived in them. The estimate's "run it again and
   they are next" becomes true.
3. **Personal tag, enforced.** A space labelled Personal: no manager or agent
   lent in from a business space, its own manager lent nowhere, and no
   business manager may read it. Fails closed.
4. **People, as records.** `<personal>/people/<id>.md` with name, kind
   (person | pet), role, birthday, notes. The learn run files "you" facts
   about a named person against their record. Health is a private field.
5. **Inbox as the one queue.** Proposed facts and to-confirm questions are
   Inbox items with Keep / No / Not quite. Life and Home show counts and link.
6. **Onboarding, live.** After Mail: sorting on this machine as it happens,
   one approval, reading one person at a time with facts streaming in, done.
   Then **Life**: the assistant proposes your home from mail, you correct it,
   free text for the rest. Then **Home**: address, who works there, pool,
   garden — creates the Home space tagged Personal with Pool / Garden / House.
7. **Your Life page.** Home, family, friends, pets from the records; a
   person's page as sentences grouped by subject plus the few dated fields.
8. **Home space tabs.** House, Routines, Upkeep, People, reading the space's
   files. Start as sentences grouped by subject; dates only where they matter.
9. **Senders you pay.** For Home, the learn run counts suppliers you pay,
   not only people you reply to.

## Out of scope tonight

Paying for anything. PDF and Office extraction. Clients on business mail.
Automated mail cleanup. Anything that sends mail.

## Test report

`test-results/learn-life-home/REPORT.md`: per step, what passed, what was
skipped and why, and the screenshots. Made-up mailbox only; the user's real
mail is never sent.
