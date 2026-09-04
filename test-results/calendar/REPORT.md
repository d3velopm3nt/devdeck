# Calendar — what was built and what was proved

4 September 2026 · branch `feat/ai-workspace`

The roadmap entry *Time — a calendar, a day, and a bot that keeps you to it*
named three things that had to exist before any view was worth drawing. All
three are built, the four views are on top of them, and this is what was run
to check it.

## What the roadmap said was missing, and what it is now

**1. The scheduler knew rhythms, not moments.** `every` was
daily/weekdays/weekly/hourly plus a minute of the day: a 2pm meeting on the
11th could not be said at all. `every = "once"` with `at_ms` says it, and
`duration_min` gives it a length, so an hour-long meeting is an hour rather
than an instant. Catching up, running and recording are untouched — a moment
is a recurrence that recurs no more than once.

**2. Work items had no dates.** A work item was `id, title, status, assignee,
areas`, so a calendar of work had nothing to plot. It has `due:` now, in
`work.md` beside the item it is about — the project's own truth, in the vault,
shared with whoever has the repository. Your day is the other side of that
split and does not go there.

**3. Nothing turned a deadline into a reminder.** `check_deadlines` runs on
the clock the scheduler already ticks: an item that is not done and is due
inside 48 hours reaches the Inbox by the same road every other reminder takes.
Once per item per day, tracked in `deadline_pings` — a reminder that arrives
every thirty seconds is a reason to switch reminders off.

## What it is

One query — `calendar_range(from, to)` — answers every view. Day, week, month
and year differ in the window they ask for and how they draw the answer, never
in what they ask, so a day and the month containing it cannot disagree about
the same afternoon. Occurrences are expanded for the window and thrown away;
writing them down would mean keeping them in step with the rule that made
them, and the rule is the truth.

Two sources answer it: schedules of both kinds, and work items with a `due:`
read from every space's `.devdeck`. A bot's wake and your evening reminder sit
on the same grid because they are both things that happen at a time.

## What was run

Everything below happened in the running app against real data — the real
schedules on this machine, the real `work.md` of the `node-as-conversation`
feature, and one-off events created through `schedule_save`, the same command
the interface calls.

### The four views · `screenshots/01-week.png` … `04-year.png`

| View | What it showed |
|---|---|
| **Week** | 27 items across 31 Aug–6 Sep. Four bots waking daily at 07:00 and 08:00, a weekly *Golf Practice*, the three one-offs, and two deadlines — one red (overdue), one amber (ahead). |
| **Day** | Saturday 5 September on a 15-minute grid, *Design review* at 14:00 carrying `60m` and *Ship v0.3.2* at 16:00 carrying `30m`. The grid is settable to 5, 15, 30 or 60 minutes. |
| **Month** | September 2026, 117 items, whole weeks padded either side and dimmed, today outlined, `+N more` where a day overflows. |
| **Year** | 1155 items, a count and a bar per month, and every deadline in the year listed with its space and status. |

### Deadlines remind themselves · `screenshots/05-deadline-inbox.png`

Four deadlines were written into `work.md`: 2 Sept (overdue, blocked), 5 Sept
(tomorrow, in-progress), 13 Sept and 27 Sept.

The two inside the 48-hour lead fired, once each, and the two beyond it stayed
silent — which is the assertion that matters, because a deadline reminder that
fires for everything is noise:

```
deadline_pings
  12:node-as-conversation:w13-what-happened                      2026-09-04
  12:node-as-conversation:w16-add-a-splash-screen…               2026-09-04

activity
  "Collapse 'what happened'… — overdue"        ok = 0   → the Inbox
  "Add a splash screen… — due in 1d"           ok = 1   → Home
```

An overdue item is recorded as *not ok*, so it lands in **Needs you**; one
that is merely coming is recorded as fine and goes to Home. The screenshot is
the Inbox with the overdue one at the top; the toast for the other is visible
in `01-week.png`.

### Unit tests · 344 → 349 passing

Five new tests in `calendar.rs`, all green:

- a daily rhythm occurs once a day inside the window, at its own minute, and
  stops at both ends of it;
- **weekdays are five days, not seven** — asserted because the two day-numbering
  schemes in that file are one apart and the bug would be invisible until a
  Saturday;
- a moment lands in exactly one window: the day it is on, not the day after,
  and once in the month rather than once a day;
- a disabled schedule does not occur;
- **a date with no time is the end of that day.** "Due Friday" means by the
  time Friday is over. Midnight-as-it-begins would make every deadline arrive
  already overdue.

## Two defects found by running it, and fixed

**The month grid had a thirty-sixth cell** containing the 5th of October on its
own. A month's span was divided by 86,400,000 to count its days, and a day is
not always that many milliseconds. The grids step by calendar day now, which
also makes them right on the two days a year the clocks change.

**The day view opened at midnight**, hiding the whole working day below the
fold. It scrolls to now — or to the first thing on the day, when the day being
looked at is not today.

## The event page · `screenshots/07-event-page.png`

Added 4 September. Clicking an occurrence opens *that occurrence* rather than
the page that owns the rule behind it: what it is, when, did it happen, what
you wrote, and the last few times. Entries are one file per date in the
personal store — `%APPDATA%\devdeckssistant\events6-08-31.md` — because
your Tuesday is yours and never goes near a repository. A deadline still opens
Work: its record is the work item, in the vault, and there is nothing personal
to write down beside it.

`done` is three-valued on purpose. A week you never answered is not a week you
skipped, and collapsing the two would turn every busy fortnight into a failed
one.

Verified with three real entries written through the same command the page
calls: two rounds of golf and a rained-off Monday, showing "2 of the last 3".

### Two bugs it took a white window to find

**The app rendered nothing and said nothing.** A throw in one component
unmounts the whole tree, and a desktop shell has no console you can reach — so
a single bad property produced a blank window with no explanation. There is an
error boundary now: it names the error, the component stack, and offers a
reload and a copy button. Never let a failure look like a state.

**And the throw itself:** `notes` had `#[serde(skip)]` to keep it out of the
file's frontmatter, which also kept it out of the IPC payload — the page got
`undefined` and called `.trim()` on it. The file's frontmatter and the wire
type are two structs now: `Meta` for what is written beside the words, `Entry`
for what the interface is sent.

**Worth knowing about this session:** `devUrl` is baked into debug builds, so
the running app loads `http://localhost:5173` when a Vite is up. One had been
running since 2 September, which meant frontend rebuilds were largely
irrelevant to what appeared on screen until it choked on a new file. Kill port
5173 before trusting a debug build's UI.

## What is deliberately not here

- **No personal day-plan blocks yet.** The day view places what the calendar
  knows about; typing your own routine into it is the next piece, and by the
  store split it belongs in the personal store, never in a repository.
- **No editing from the calendar.** Clicking a deadline goes to Work, clicking
  a schedule goes to Settings. Creating a one-off goes through
  `schedule_save`; there is no form on this page yet.
- **No syncing with a real calendar.** Google, Outlook and ICS were left as an
  open question in the roadmap because they change the foundation, and that is
  a decision rather than a detail.
- **The life bot is untouched.** It is a bot, and this was the calendar.
