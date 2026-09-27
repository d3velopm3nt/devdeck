#!/usr/bin/env python3
"""What actually happened, read back out of the event log.

The event bus is the only place that knows whether a manager woke, whether a
worker was handed anything, and whether the work moved. Until now the only way
to find out was to watch the panel while it happened -- which is no use at all
the morning after, and no use for answering "did that work?".

So this reads the same rows the panel reads, and says in plain sentences what
the app did. It is deliberately read-only, and deliberately pessimistic: where
it cannot tell, it says so rather than printing a tick.

    python scripts/trial-report.py            # this run of the app
    python scripts/trial-report.py --all      # everything ever kept
    python scripts/trial-report.py --watch    # keep printing as rows arrive
"""

import argparse
import json
import os
import sqlite3
import sys
import time
from datetime import datetime

DB = os.path.join(
    os.environ.get("APPDATA", os.path.expanduser("~")), "devdeck", "devdeck.sqlite"
)

# The links in the chain a trial run is meant to prove, in the order they
# should happen. Naming them here is the point: a run that skips one is a
# result, not a gap in the script.
CHAIN = [
    ("a manager woke", ("bot.woke", "schedule.ran", "work.updated")),
    ("work was handed over", ("work.claimed",)),
    ("something started", ("agent.started", "session.started", "run.started")),
    ("it reported back", ("agent.completed", "session.completed", "run.finished")),
    ("work moved", ("work.completed",)),
]


def clock(ms):
    return datetime.fromtimestamp(ms / 1000).strftime("%H:%M:%S")


def connect():
    if not os.path.exists(DB):
        sys.exit(f"no database at {DB} -- has DevDeck ever run?")
    # Read-only, so a running app is never disturbed. WAL lets us read while
    # it writes.
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    try:
        con.execute("SELECT 1 FROM events LIMIT 1")
    except sqlite3.Error:
        sys.exit("the events table is not there -- this build predates the event log")
    return con


def latest_session(con):
    row = con.execute(
        "SELECT session FROM events ORDER BY at DESC, seq DESC LIMIT 1"
    ).fetchone()
    return row[0] if row else None


def summarise(kind, payload):
    """One line a person can read, from whatever the payload happens to hold."""
    try:
        d = json.loads(payload)
    except Exception:
        return ""
    if not isinstance(d, dict):
        return ""
    for key in ("summary", "title", "intent", "what", "name", "error", "reason"):
        v = d.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip().replace("\n", " ")[:100]
    if "count" in d:
        return f"{d['count']} item(s)"
    return ""


def report(con, session, show_all):
    where, args = "", []
    if not show_all and session:
        where, args = "WHERE session = ?", [session]

    rows = con.execute(
        f"SELECT at, kind, agent_id, feature_id, payload FROM events {where} "
        "ORDER BY at ASC, seq ASC",
        args,
    ).fetchall()

    if not rows:
        print("Nothing in the log.")
        print()
        print("That is itself a result: either nothing has happened since the app")
        print("started, or events are not reaching the database at all. Publish")
        print("something (wake a manager) and run this again -- if it stays empty,")
        print("the sink is not firing.")
        return 1

    scope = "everything ever kept" if show_all else f"this run of the app ({session})"
    print(f"{len(rows)} event(s) -- {scope}")
    print(f"from {clock(rows[0][0])} to {clock(rows[-1][0])}")
    print()

    # --- the chain -------------------------------------------------------
    seen = {r[1] for r in rows}
    print("The chain a trial run is meant to prove:")
    broke = False
    for label, kinds in CHAIN:
        hit = sorted(seen & set(kinds))
        if hit:
            print(f"  yes  {label:<24} ({', '.join(hit)})")
        else:
            print(f"  no   {label:<24} -- nothing of kind {'/'.join(kinds)}")
            broke = True
    print()

    # --- what went wrong -------------------------------------------------
    bad = [r for r in rows if r[1].endswith((".failed", ".denied", ".refused"))]
    if bad:
        print(f"{len(bad)} failure(s):")
        counts = {}
        for at, kind, who, feat, payload in bad:
            counts[summarise(kind, payload) or kind] = (
                counts.get(summarise(kind, payload) or kind, 0) + 1
            )
        for msg, n in sorted(counts.items(), key=lambda kv: -kv[1])[:8]:
            print(f"  {n:3d}  {msg}")
        print()

    # --- the story -------------------------------------------------------
    # Tool chatter is most of the volume and none of the story, so it is
    # counted rather than listed.
    noise = sum(1 for r in rows if r[1].startswith("tool."))
    print("What happened, in order:")
    for at, kind, who, feat, payload in rows:
        if kind.startswith("tool."):
            continue
        msg = summarise(kind, payload)
        actor = who or "--"
        line = f"  {clock(at)}  {kind:<26} {actor:<12} {feat or ''}"
        print(line.rstrip())
        if msg:
            print(f"                {msg}")
    if noise:
        print(f"  ... plus {noise} tool call(s), not listed")
    print()

    return 1 if broke else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="every session, not just this one")
    ap.add_argument("--watch", action="store_true", help="reprint as new rows arrive")
    args = ap.parse_args()

    while True:
        con = connect()
        session = latest_session(con)
        code = report(con, session, args.all)
        con.close()
        if not args.watch:
            return code
        time.sleep(5)
        print("\n" + "-" * 70 + "\n")


if __name__ == "__main__":
    sys.exit(main())
