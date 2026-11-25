import re
import pathlib

DIST = pathlib.Path(__file__).parent / "dist"
PROGRAM_IDS = {"p3", "sav", "var", "atom", "ir", "ng"}  # rendered by app.js

pages = sorted(DIST.glob("*.html"))
static_ids = {p.name: set(re.findall(r'id="([^"]+)"', p.read_text(encoding="utf-8"))) for p in pages}
bad = []
for page in pages:
    for href in re.findall(r'href="([^"]+)"', page.read_text(encoding="utf-8")):
        if href.startswith(("http", "mailto:", "#", "data:")):
            continue
        target, _, frag = href.partition("#")
        target = target or page.name
        if not (DIST / target).exists():
            bad.append((page.name, href, "missing file"))
        elif frag and frag not in static_ids.get(target, set()) and frag not in PROGRAM_IDS:
            bad.append((page.name, href, "missing anchor"))

assert not bad, bad
print(f"ok: {len(pages)} pages, every internal link resolves")
