"""Fold a space's loose facts into the subjects they are about.

Learn wrote one file per fact, named by truncating the fact to sixty
characters, so everything known about a client sat in five files none of which
could be read from its own name. This puts each fact inside the subject it is
about, as a dated line with where it came from, and leaves the original folder
alone so the two can be compared.

Anything it cannot place confidently goes to unfiled.md, verbatim. Guessing a
home for a fact is worse than saying it has none.
"""

import io
import os
import re
import sys
import collections

ALIAS = {
    "fleet-aid": "fleetaid",
    "anglo-american": "angloamerican",
    "kevin-o-neill": "kevin-oneill",
    "kevin": "kevin-oneill",
    "latlou-logistics": "latloulogistics",
}
NEW = {
    "bosch": "supplier",
    "protovin": "supplier",
    "simera-trace": "supplier",
    "jayjay": "person",
    "lalit-chordia": "person",
    "rory-fitzmaurice": "person",
    "tyrex": "product",
    "minex": "product",
    "trackx": "product",
    "assetx": "product",
    "rosond": "partner",
}
FOLDER = {
    "client": "clients",
    "supplier": "suppliers",
    "partner": "partners",
    "person": "people",
    "product": "products",
    "topic": "topics",
    "about": "",
}


def parse(path):
    raw = io.open(path, encoding="utf-8", errors="replace").read()
    fm, body = {}, raw
    if raw.startswith("---"):
        end = raw.find("\n---", 3)
        if end > 0:
            for line in raw[3:end].splitlines():
                if ":" in line:
                    k, v = line.split(":", 1)
                    fm[k.strip()] = v.strip()
            body = raw[end + 4 :]
    return fm, body.strip()


def split(folder):
    """Subjects name themselves; a fact's name is its own sentence."""
    subs, facts = {}, []
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".md"):
            continue
        fm, body = parse(os.path.join(folder, name))
        stem = name[:-3]
        if len(stem) <= 25 and "learned_at" not in fm:
            subs[stem] = (fm, body)
        else:
            facts.append((stem, fm, body))
    return subs, facts


def owner_of(stem, names):
    """The first entity named in the sentence, which is usually its subject.

    Matching *any* mention let the most-mentioned person swallow everything:
    "kevin proposed that bosch cover the VAT" is not a fact about Kevin.
    """
    hay = stem.replace("-", " ")
    best, at = None, 10**6
    for key, needle in names.items():
        i = hay.find(needle)
        if 0 <= i < at and key != "about-the-business":
            at, best = i, key
    if best is None:
        return "about-the-business" if hay.startswith("innotrack") else None
    return ALIAS.get(best, best)


def bullet(fm, body):
    when = fm.get("learned_at", "")
    src = fm.get("source", "")
    lines = [l.strip() for l in body.splitlines() if l.strip()]
    fact = " ".join(l for l in lines if not l.startswith(">")).strip()
    where = next((l.lstrip("> ").strip() for l in lines if l.startswith(">")), "")
    head = " · ".join(x for x in (when, src) if x)
    out = f"- {head} — {fact}" if head else f"- {fact}"
    return out + (f"\n  <sub>{where}</sub>" if where else "")


def run(space_dir, out_dir, write):
    src = os.path.join(space_dir, ".devdeck", "knowledge")
    if not os.path.isdir(src):
        return None
    subs, facts = split(src)
    role = {k: (fm.get("role") or fm.get("kind") or "topic") for k, (fm, _) in subs.items()}
    role.update(NEW)
    role["about-the-business"] = "about"
    role.setdefault("kevin-oneill", "person")
    if "kevin-oneill" in role:
        role["kevin-oneill"] = "person"

    names = {s: s.replace("-", " ") for s in list(subs) + list(NEW)}
    names.update({a: a.replace("-", " ") for a in ALIAS})

    held = collections.defaultdict(list)
    unfiled = []
    for stem, fm, body in facts:
        who = owner_of(stem, names)
        if who:
            held[who].append((stem, fm, body))
        else:
            unfiled.append((stem, fm, body))

    made = []
    for who in sorted(set(list(subs) + list(held))):
        kind = role.get(who, "topic")
        folder = os.path.join(out_dir, FOLDER.get(kind, "topics"))
        name = ("about" if who == "about-the-business" else who).lower() + ".md"
        fm, body = subs.get(who, ({}, ""))

        meta = dict(fm)
        meta.setdefault("id", who)
        meta["kind"] = kind
        meta.pop("role", None)
        newest = max((f[1].get("learned_at", "") for f in held.get(who, [])), default="")
        if newest:
            meta["updated"] = newest

        head = "---\n" + "".join(f"{k}: {v}\n" for k, v in meta.items()) + "---\n\n"
        text = head + (body if body else f"# {who.replace('-', ' ').title()}\n")
        if held.get(who):
            items = sorted(held[who], key=lambda f: f[1].get("learned_at", ""), reverse=True)
            text += "\n\n## What we know\n\n" + "\n".join(bullet(fm, b) for _, fm, b in items) + "\n"
        if write:
            os.makedirs(folder, exist_ok=True)
            io.open(os.path.join(folder, name), "w", encoding="utf-8", newline="").write(text)
        made.append((os.path.join(FOLDER.get(kind, "topics"), name), len(held.get(who, []))))

    if unfiled:
        text = (
            "---\nid: unfiled\nkind: topic\n---\n\n# Unfiled\n\n"
            "Facts that name no subject clearly enough to file. Left whole rather than\n"
            "guessed at — move them by hand, or let a worker do it.\n\n"
            + "\n".join(bullet(fm, b) for _, fm, b in unfiled)
            + "\n"
        )
        if write:
            os.makedirs(os.path.join(out_dir, "topics"), exist_ok=True)
            io.open(os.path.join(out_dir, "topics", "unfiled.md"), "w", encoding="utf-8", newline="").write(text)
        made.append((os.path.join("topics", "unfiled.md"), len(unfiled)))
    return made, len(facts), len(subs)


if __name__ == "__main__":
    write = "--write" in sys.argv
    vault = r"C:\Users\d3vel\DevDeck"
    total = 0
    for space in ("Innotrack", "Home", "Life", os.path.join("Develtech", "DevDeck")):
        d = os.path.join(vault, space)
        got = run(d, os.path.join(d, "knowledge"), write)
        if not got:
            continue
        made, nfacts, nsubs = got
        print(f"\n{space}: {nsubs} subjects + {nfacts} facts  ->  {len(made)} files")
        for path, n in sorted(made):
            print(f"   {path:<34} {n:>2} fact{'' if n == 1 else 's'}")
        total += len(made)
    print(f"\n{'WROTE' if write else 'DRY RUN'} — {total} files")
