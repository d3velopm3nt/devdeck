# A real provider, or nothing

A goal for DevDeck, written 24 Sep 2026. Paste the block at the bottom into
`/goal`; everything above it is why.

---

## What is wrong

A manager or a worker can be pointed at something that cannot do the work, and
nothing says so until you have paid for the silence. The roster on this machine
right now:

| agent | provider | what that means |
|---|---|---|
| `architect` | `mock` | answers from a script; looks like work, is not |
| `qa` | `mock` | same |
| `reviewer` | `mock` | same |
| `dev-a` | `scripted` | **no such provider** — the wake said "unknown provider 'scripted'" and stopped |
| `dev-b` | `openai-compatible` | real, if an endpoint and key are set |
| `assistant` | `anthropic` | real |

Three of six produce nothing real, one names a provider that does not exist, and
the two that work only work if credentials happen to be in place. The provider
dropdown's first entry is `Mock (no AI)`, so a manager made without thinking is
made on a mock.

This is what made the trial runs so hard to read: one manager ran 13 turns and
touched no files, another 24 turns and touched no files. Some of that was
permissions; some of it was a provider that was never going to do anything.

## What this changes, and what it does not

**A mock is not something real work can be pointed at.** It stops appearing in
the provider list, no manager or worker may name it, and an agent file that
still does is reported rather than run.

**The mock stays in the codebase.** It is what the offline tests use — 639 of
them run with no key and no network — and deleting it would mean deleting the
ability to test the assembly at all. `CLAUDE.md` says *"the mock is a provider,
not a bypass"*, and that stays true where it was always true: in tests. What
changes is that it is no longer offered to a person as though it were a choice.

That distinction is the whole design of this goal. Removing the mock outright
is a much larger, worse change; removing it from the list of things you can
choose is the one that removes the confusion.

**A provider has to be set up before it can be chosen.** One modal, used
everywhere a provider is picked — the agent editor, a manager, a worker, the
first-run path — that tests the credentials before it closes and says plainly
what failed if they do not work. Nothing offers a provider it has not confirmed.

## Done when

1. No screen offers `mock` as a provider for a manager, a worker or an agent.
2. Every agent file on disk names a provider that exists and has credentials, or
   the app says which one does not and refuses to wake it.
3. One modal sets a provider up, and it is the same modal in every place.
4. Every dead link and every control that cannot do what it says is gone.
5. A new space — a goal tracker, built from nothing — is taken from an empty
   plan to working code by a manager and a worker, and the receipt shows real
   turns, real files and a real bill.

---

## The goal prompt

> Make DevDeck refuse to pretend. No manager, worker or agent may be pointed at
> a mock provider any more: take it out of every list a person chooses from,
> report any agent file that still names it or names a provider that does not
> exist, and refuse to wake one rather than running it into silence. Keep the
> mock itself — the offline tests are built on it — but it stops being a choice.
>
> Build one reusable modal for setting a provider up, and use it everywhere a
> provider is chosen. It checks the credentials before it closes, and when they
> do not work it says which call failed and what came back, never "something
> went wrong".
>
> Then walk the app and remove what is not true: dead links, buttons that do
> nothing, counts that are always zero, tabs that open on an empty room.
>
> Prove it on something new. Make a space for a goal tracker, give a manager a
> plan for it and a worker to hand the work to, and take it from nothing to
> working code. Write down what actually happened — turns, files, cost, and
> anything it could not do — and do not call it working until the receipt says
> so.
