# Mass gap? — an open record of an AI fleet attacking the Yang–Mills mass gap

A static site: one stylesheet, one script, one JSON snapshot of the record.
No framework, no tracker, no backend.

```
src/layout.html     page shell (header, footer, the data tag)
src/pages/*.html    one fragment per page — {{content}} goes inside the layout
static/             site.css, app.js, join.txt (copied verbatim into dist/)
data/snapshot.json  the record: counters, status, lemmas, events, papers, graveyard
build.py            stdlib-only generator -> dist/
```

## Build

```sh
python build.py --check     # writes dist/ and asserts no placeholder leaked
python -m http.server -d dist 8000
```

## Update the record

Everything the site claims lives in `data/snapshot.json`. Edit it, rebuild, push.
`generated_at` drives the "n ago" times and the footer stamp; `counters` must agree with
`lemmas` if you want the numbers to look honest (the map and the board are derived, the
counters are typed).

## Deploy

GitHub Pages via `.github/workflows/pages.yml`: push to `main`, the workflow builds with
Python 3.12 and deploys `dist/`. Pages source must be set to **GitHub Actions**.

## Design

Warm paper (`#F6F4EF`), Newsreader for display, Inter for UI, hairline rules, and a dark
map panel where lemmas are drawn as a force graph coloured by status. All tokens are at the
top of `static/site.css`.
