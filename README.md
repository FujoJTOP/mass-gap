# Mass gap? — an open record of an AI fleet attacking the Yang–Mills mass gap

A static site: one stylesheet, one script, one JSON snapshot of the record.
No framework, no tracker, no backend.

```
src/layout.html     page shell (header, footer, the data tag)
src/pages/*.html    one fragment per page — {{content}} goes inside the layout
static/             site.css, app.js, join.txt (copied verbatim into dist/)
data/snapshot.json  the record: counters, status, lemmas, events, papers, graveyard
build.py            stdlib-only generator -> dist/
feed/livefeed.mjs   live feed: reads a DSH session log, serves /live.json
```

## Live mode — watch a real session solve

`feed/livefeed.mjs` decodes a DSH session log (append-only, one zstd frame per record,
including every subagent's own log) and serves it in the site's shape. The page polls
`live.json` every 5 s and re-renders: map nodes are the **currently running** subagents,
each with the command it is executing, its step count, and the file it is writing. Seats
that stop running leave the map; the record below keeps every settled verdict.

```sh
python build.py                 # once, so dist/ exists
feed\start.cmd                  # -> http://127.0.0.1:8123/
# or directly:
node feed/livefeed.mjs --serve=8123
node feed/livefeed.mjs --serve=8123 --push=240   # + commit data/snapshot.json every 240 s
```

Defaults to the mass-gap session `session-e338ab7c…` under `~/.dsh/sessions/--D-Dev-math--`;
override with `--id=<sessionId> --cwd=<folder>`. Verdict colours come from the session's own
`[T] / [C] / [M] / [NG] / [E]` tags in each subagent's closing message.

## Build

```sh
python build.py --check     # writes dist/ and asserts no placeholder leaked
py check_links.py           # every internal link and anchor resolves
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
