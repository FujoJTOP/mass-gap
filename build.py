#!/usr/bin/env python3
"""Build the static site into dist/. Standard library only.

    python build.py            # build dist/
    python build.py --check    # build, then verify no placeholder leaked
"""
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent
SRC, STATIC, DATA, DIST = ROOT / "src", ROOT / "static", ROOT / "data", ROOT / "dist"

# slug, nav label, href — one place for the nav, the footer and the build order
NAV = [
    ("index", "Map", "index.html"),
    ("live", "Live", "live.html"),
    ("board", "Board", "board.html"),
    ("programs", "Programs", "programs.html"),
    ("papers", "Papers", "papers.html"),
    ("graveyard", "Graveyard", "graveyard.html"),
    ("how", "How it works", "how.html"),
    ("about", "What this is", "about.html"),
]

PAGES = {
    "index": ("Does Yang–Mills have a mass gap? An AI fleet is attacking it, live",
              "A coordinated AI agent fleet works the Yang–Mills mass gap in the open. "
              "Nothing is a result until the checker accepts it."),
    "live": ("Live · every change of state", "The fleet's record as it is published: lemmas "
             "checked, claims refuted, approaches ruled dead."),
    "board": ("Board · every lemma, by program and status", "All lemmas the fleet has stated, "
              "grouped by program, with what rests on what."),
    "programs": ("Programs · the fronts", "Each program is a line of attack with a goal in plain words."),
    "papers": ("Papers · written up for human readers", "Results written up as papers, with their review state."),
    "graveyard": ("Graveyard · every approach that died, and why", "No-go classes, each with the reason it cannot work."),
    "how": ("How it works · many agents, one judge", "Orchestrators, the checker, the red team, and how to read this site."),
    "about": ("What this is · a public attempt, running now", "What this attempt is, what it is not, and who is behind it."),
}


def nav_html(slug):
    out = []
    for s, label, href in NAV:
        current = ' aria-current="page"' if s == slug else ""
        out.append(f'<a href="{href}"{current}>{label}</a>')
    return "".join(out)


def atom(snap):
    """Minimal Atom feed from the event record."""
    def esc(s):
        return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                 .replace('"', "&quot;"))
    updated = snap["generated_at"]
    entries = []
    for e in snap["events"][:30]:
        entries.append(
            "  <entry>\n"
            f"    <id>tag:ym-mass-gap,{e['seq']}</id>\n"
            f"    <title>{esc(e['kind'] + ' · ' + e['program'])}</title>\n"
            f"    <updated>{e['at']}</updated>\n"
            f"    <content type=\"text\">{esc(e['text'])}</content>\n"
            "  </entry>"
        )
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<feed xmlns="http://www.w3.org/2005/Atom">\n'
        "  <title>Yang–Mills mass gap · the record</title>\n"
        "  <subtitle>Every real change of state in the fleet.</subtitle>\n"
        "  <link href=\"feed.xml\" rel=\"self\"/>\n"
        "  <link href=\"index.html\"/>\n"
        f"  <updated>{updated}</updated>\n"
        "  <id>tag:ym-mass-gap,record</id>\n"
        + "\n".join(entries) + "\n</feed>\n"
    )


def build(check=False):
    snap = json.loads((DATA / "snapshot.json").read_text(encoding="utf-8"))
    data_tag = ('<script id="fleet-data" type="application/json">'
                + json.dumps(snap, ensure_ascii=False, separators=(",", ":")) + "</script>")

    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)

    layout = (SRC / "layout.html").read_text(encoding="utf-8")
    stamp = datetime.fromisoformat(snap["generated_at"].replace("Z", "+00:00")) \
        .astimezone(timezone.utc).strftime("%d %b %Y, %H:%M UTC")

    written = []
    for slug, (title, desc) in PAGES.items():
        body = (SRC / "pages" / f"{slug}.html").read_text(encoding="utf-8")
        html = (layout
                .replace("{{title}}", title)
                .replace("{{desc}}", desc)
                .replace("{{page}}", slug)
                .replace("{{nav}}", nav_html(slug))
                .replace("{{stamp}}", stamp)
                .replace("{{data}}", data_tag)
                .replace("{{content}}", body))
        out = DIST / f"{slug}.html"
        out.write_text(html, encoding="utf-8")
        written.append(out)

    for f in STATIC.rglob("*"):
        if f.is_file():
            target = DIST / f.relative_to(STATIC)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, target)

    (DIST / "feed.xml").write_text(atom(snap), encoding="utf-8")
    (DIST / ".nojekyll").write_text("", encoding="utf-8")

    if check:
        for out in written:
            text = out.read_text(encoding="utf-8")
            assert "{{" not in text, f"unfilled placeholder in {out.name}"
            assert "<h1" in text, f"no h1 in {out.name}"
        print(f"ok: {len(written)} pages, {len(snap['lemmas'])} lemmas, "
              f"{len(snap['events'])} events")
    return written


if __name__ == "__main__":
    build(check="--check" in sys.argv)
    print(f"built -> {DIST}")
