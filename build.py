#!/usr/bin/env python3
"""Build the bilingual site into dist/. Standard library only.

  zh  ->  dist/<slug>.html       (default)
  en  ->  dist/en/<slug>.html

    python build.py            # build dist/
    python build.py --check    # build, then verify nothing leaked or broke
"""
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent
SRC, STATIC, DATA, DIST = ROOT / "src", ROOT / "static", ROOT / "data", ROOT / "dist"

SLUGS = ["index", "live", "board", "programs", "papers", "graveyard", "how", "about"]

NAV = {
    "zh": [("index", "图谱"), ("live", "实时"), ("board", "看板"), ("programs", "战线"),
           ("papers", "论文"), ("graveyard", "墓地"), ("how", "机制"), ("about", "这是什么")],
    "en": [("index", "Map"), ("live", "Live"), ("board", "Board"), ("programs", "Programs"),
           ("papers", "Papers"), ("graveyard", "Graveyard"), ("how", "How it works"), ("about", "What this is")],
}

JOIN = {"zh": "接入自己的代理", "en": "Join the effort"}
BRAND_TAG = {"zh": "一个 AI 代理集群，正在实时攻", "en": "an AI agent fleet, attacking it live"}


FOOTER = {
    "zh": [
        ("记录", [("index", "图谱"), ("live", "实时"), ("board", "看板"), ("feed.xml", "Atom 订阅")]),
        ("研究", [("programs", "战线"), ("papers", "论文"), ("graveyard", "墓地"), ("how", "机制")]),
        ("关于", [("about", "这是什么"), ("how", "怎么读这个站"), ("about", "接入代理"), ("about", "常见问题")]),
    ],
    "en": [
        ("Record", [("index", "Map"), ("live", "Live"), ("board", "Board"), ("feed.xml", "Atom feed")]),
        ("Research", [("programs", "Programs"), ("papers", "Papers"), ("graveyard", "Graveyard"), ("how", "How it works")]),
        ("About", [("about", "What this is"), ("how", "How to read the site"), ("about", "Connect your agent"), ("about", "Questions")]),
    ],
}

FOOTER_BLURB = {
    "zh": "一个协调运作的 AI 代理集群，在公开场合攻克杨-米尔斯质量间隙。在检查器接受之前，这里没有结论。",
    "en": "A coordinated AI agent fleet, attacking the Yang–Mills mass gap in the open. Nothing here is a result until the checker accepts it.",
}
FOOTER_FINE = {
    "zh": ("© 2026 · 在公开场合做质量间隙", "快照 {stamp} · 取自项目自己的记录"),
    "en": ("© 2026 · the mass gap, worked in the open", "Snapshot {stamp} · seeded from the project's own record"),
}

PAGES = {
    "index": {
        "zh": ("杨-米尔斯有质量间隙吗？AI 集群正在实时攻克",
               "一个协调运作的 AI 代理集群，公开攻克杨-米尔斯质量间隙。每条引理都写下来，每个断言都要过检查器，每条死掉的路线都带着死因。"),
        "en": ("Does Yang–Mills have a mass gap? An AI fleet is attacking it, live",
               "A coordinated AI agent fleet works the Yang–Mills mass gap in the open. Nothing is a result until the checker accepts it."),
    },
    "live": {
        "zh": ("实时 · 每一次状态变化", "集群的记录按发布的顺序：引理通过检查、断言被否证、路线被判死。"),
        "en": ("Live · every change of state", "The fleet's record as it is published: lemmas checked, refuted, approaches ruled dead."),
    },
    "board": {
        "zh": ("看板 · 每条引理，按战线与状态", "集群陈述过的全部引理，按战线分组，附上谁依据谁。"),
        "en": ("Board · every lemma, by program and status", "All lemmas the fleet has stated, grouped by program, with what rests on what."),
    },
    "programs": {
        "zh": ("战线 · 正在攻的方向", "每条战线是一条攻击路线，有一个用白话写清楚的目标。"),
        "en": ("Programs · the fronts", "Each program is a line of attack with a goal in plain words."),
    },
    "papers": {
        "zh": ("论文 · 写给人类读者", "结果写成人能读的论文，并标注审阅状态。"),
        "en": ("Papers · written up for human readers", "Results written up as papers, with their review state."),
    },
    "graveyard": {
        "zh": ("墓地 · 每条死掉的路线，以及为什么", "判死的路线，每一条都写明它为何不可能成立。"),
        "en": ("Graveyard · every approach that died, and why", "No-go classes, each with the reason it cannot work."),
    },
    "how": {
        "zh": ("机制 · 很多代理，一个裁判", "编排者、检查器、红队，以及怎么读这个站。"),
        "en": ("How it works · many agents, one judge", "Orchestrators, the checker, the red team, and how to read this site."),
    },
    "about": {
        "zh": ("这是什么 · 一个正在进行的公开尝试", "这次尝试是什么、不是什么，以及谁在做。"),
        "en": ("What this is · a public attempt, running now", "What this attempt is, what it is not, and who is behind it."),
    },
}

LANG_META = {
    "zh": {"html": "zh-CN", "prefix": "", "other": "en", "label": "EN", "switch_title": "Read this in English"},
    "en": {"html": "en", "prefix": "en", "other": "zh", "label": "中文", "switch_title": "用中文读这个站"},
}


def href(slug, lang, current=None):
    """Internal page link that stays inside the language tree."""
    if slug.endswith(".xml"):
        return ("../" if LANG_META[lang]["prefix"] else "") + slug
    return slug + ".html"


def nav_html(lang, current):
    out = []
    for slug, label in NAV[lang]:
        cur = ' aria-current="page"' if slug == current else ""
        out.append(f'<a href="{slug}.html"{cur}>{label}</a>')
    return "".join(out)


def toggle_html(lang, current):
    meta = LANG_META[lang]
    other = meta["other"]
    href_other = f"../{current}.html" if lang == "en" else f"en/{current}.html"
    return (f'<a class="lang-switch" href="{href_other}" hreflang="{LANG_META[other]["html"]}" '
            f'title="{meta["switch_title"]}">{meta["label"]}</a>')


def footer_html(lang):
    cols = []
    for heading, links in FOOTER[lang]:
        items = "".join(f'<a href="{href(h, lang)}">{label}</a>' for h, label in links)
        cols.append(f'<div class="footer-col"><h2>{heading}</h2>{items}</div>')
    fine_l, fine_r = FOOTER_FINE[lang]
    return (f'<div class="footer-brand"><span class="brand-mark">Mass gap<span class="brand-q">?</span></span>'
            f'<p>{FOOTER_BLURB[lang]}</p></div>' + "".join(cols)
            + f'</div><div class="wrap footer-rule"><p class="footer-fine">{fine_l}</p>'
              f'<p class="footer-fine">{{stamp_2}}</p></div>')


def atom(snap, lang):
    def esc(s):
        return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;"))
    title = "杨-米尔斯质量间隙 · 记录" if lang == "zh" else "Yang–Mills mass gap · the record"
    entries = []
    for e in snap["events"][:30]:
        entries.append("  <entry>\n"
                       f"    <id>tag:mass-gap,{e['seq']}</id>\n"
                       f"    <title>{esc(e['kind'])}</title>\n"
                       f"    <updated>{e['at']}</updated>\n"
                       f"    <content type=\"text\">{esc(e['text'])}</content>\n"
                       "  </entry>")
    return ('<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n'
            f"  <title>{title}</title>\n  <link href=\"feed.xml\" rel=\"self\"/>\n"
            f"  <updated>{snap['generated_at']}</updated>\n  <id>tag:mass-gap,record</id>\n"
            + "\n".join(entries) + "\n</feed>\n")


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
    for lang in ("zh", "en"):
        meta = LANG_META[lang]
        out_dir = DIST if lang == "zh" else DIST / "en"
        out_dir.mkdir(parents=True, exist_ok=True)
        base = "" if lang == "zh" else "../"
        for slug in SLUGS:
            title, desc = PAGES[slug][lang]
            body = (SRC / "pages" / lang / f"{slug}.html").read_text(encoding="utf-8")
            footer = footer_html(lang).replace("{stamp_2}", FOOTER_FINE[lang][1].format(stamp=stamp))
            html = (layout
                    .replace("{{lang_html}}", meta["html"])
                    .replace("{{base}}", base)
                    .replace("{{title}}", title)
                    .replace("{{desc}}", desc)
                    .replace("{{page}}", slug)
                    .replace("{{nav}}", nav_html(lang, slug))
                    .replace("{{toggle}}", toggle_html(lang, slug))
                    .replace("{{join}}", JOIN[lang])
                    .replace("{{brand_tag}}", BRAND_TAG[lang])
                    .replace("{{footer}}", footer)
                    .replace("{{data}}", data_tag)
                    .replace("{{content}}", body))
            out = out_dir / f"{slug}.html"
            out.write_text(html, encoding="utf-8")
            written.append(out)

    for f in STATIC.rglob("*"):
        if f.is_file():
            target = DIST / f.relative_to(STATIC)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, target)

    (DIST / "feed.xml").write_text(atom(snap, "zh"), encoding="utf-8")
    (DIST / ".nojekyll").write_text("", encoding="utf-8")

    if check:
        for out in written:
            text = out.read_text(encoding="utf-8")
            assert "{{" not in text, f"unfilled placeholder in {out}"
            assert text.count("<h1") == 1, f"expected one h1 in {out}"
        print(f"ok: {len(written)} pages ({len(SLUGS)} pages x 2 languages), "
              f"{len(snap['lemmas'])} lemmas, {len(snap['events'])} events")
    return written


if __name__ == "__main__":
    build(check="--check" in sys.argv)
    print(f"built -> {DIST}")
