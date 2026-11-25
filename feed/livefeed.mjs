// Live feed: reads DSH session logs (append-only, one zstd frame per record) and turns
// them into the site's snapshot shape — including what every subagent is doing right now.
//
//   node feed/livefeed.mjs --serve=8123             # http server for dist/ + /live.json
//   node feed/livefeed.mjs --write                  # write data/snapshot.json + dist/live.json
//   node feed/livefeed.mjs --serve=8123 --push=240  # + commit/push for the Pages build
//
// Session: --id=<sessionId> (defaults to the mass-gap main session), --cwd=<folder name>
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const DIST = path.join(ROOT, 'dist');
const DATA = path.join(ROOT, 'data');
const SESSIONS = 'C:\\Users\\hooya\\.dsh\\sessions';
const CWD_FOLDER = '--D-Dev-math--';

const arg = (name, dflt) => {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  const v = hit.split('=')[1];
  return v === undefined ? true : v;
};

const SESSION_ID = arg('id', 'session-e338ab7c-8382-4ce4-8e26-c7acfcfc89d6');
const CWD_DIR = path.join(SESSIONS, arg('cwd', CWD_FOLDER));   // child sessions live here, next to the main one
const SESSION_DIR = path.join(CWD_DIR, SESSION_ID);
const LOG = path.join(SESSION_DIR, 'session.v4.jsonl.zstd');

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const isoFull = ms => new Date(ms).toISOString().replace('.000Z', 'Z');
const iso = ms => isoFull(ms).slice(0, 19).replace('T', ' ');

/* ---------- text helpers ---------- */

const strip = s => String(s ?? '')
  .replace(/<\|im_start\|>[\s\S]*/g, '')      // leaked control tokens: drop the tail
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/\*\*|`|^#+\s*/gm, '')             // markdown emphasis noise
  .replace(/[|]/g, ' ')                       // table pipes read as noise in a one-line card
  .replace(/-{2,}|={2,}/g, ' ')               // table rules too
  .replace(/\s+/g, ' ')
  .trim();

function textOf(rec) {
  const d = rec?.data ?? {};
  const blocks = d.message?.content ?? d.content ?? [];
  if (!Array.isArray(blocks)) return '';
  return blocks.filter(b => b.type === 'text' || b.type === 'reasoning')
    .map(b => b.text ?? '').join('\n').trim();
}
const visibleText = rec => {
  const blocks = rec?.data?.message?.content ?? [];
  if (!Array.isArray(blocks)) return '';
  return blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n').trim();
};

const FILE_RE = /(?:[A-Za-z]:\\[^\s"'`]+|[a-z]+\/[^\s"'`]+)\.(?:md|tex|py|log|json|lean|txt)/g;

function filesIn(s) {
  const out = [];
  for (const m of String(s ?? '').matchAll(FILE_RE)) {
    const p = m[0].replace(/[.,;:)]+$/, '');
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/* ---------- session streams ---------- */

class Stream {
  constructor(file) { this.file = file; this.pos = 0; this.records = []; }
  poll() {
    if (!fs.existsSync(this.file)) return 0;
    const buf = fs.readFileSync(this.file);
    if (buf.length <= this.pos) return 0;
    const offsets = [];
    for (let i = buf.indexOf(MAGIC, this.pos); i >= 0; i = buf.indexOf(MAGIC, i + 4)) offsets.push(i);
    let added = 0;
    for (let i = 0; i < offsets.length; i++) {
      const start = offsets[i];
      const end = i + 1 < offsets.length ? offsets[i + 1] : buf.length;
      let text;
      try { text = zlib.zstdDecompressSync(buf.subarray(start, end)).toString('utf8'); }
      catch { break; }                       // frame still being written
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try { this.records.push(JSON.parse(line)); added++; } catch {}
      }
      this.pos = end;
      if (i === offsets.length - 1) break;
    }
    if (this.records.length > 9000) this.records = this.records.slice(-7000);
    return added;
  }
}

const main = new Stream(LOG);

/* ---------- one subagent's current activity ---------- */

const childCache = new Map();

function tailRecords(file, bytes = 320 * 1024, keep = 60) {
  const size = fs.statSync(file).size;
  const start = Math.max(0, size - bytes);
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  const offsets = [];
  for (let i = buf.indexOf(MAGIC); i >= 0; i = buf.indexOf(MAGIC, i + 4)) offsets.push(i);
  const from = offsets.slice(-keep);
  const out = [];
  for (let i = 0; i < from.length; i++) {
    const s = from[i];
    const e = i + 1 < from.length ? from[i + 1] : buf.length;
    try {
      for (const l of zlib.zstdDecompressSync(buf.subarray(s, e)).toString('utf8').split('\n')) {
        if (!l.trim()) continue;
        try { out.push(JSON.parse(l)); } catch {}
      }
    } catch {}
  }
  return out;
}

function toolSummary(rec) {
  const d = rec?.data ?? {};
  const name = d.name ?? d.tool ?? 'tool';
  let args = d.arguments;
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = { raw: args }; } }
  const file = args?.file_path ?? args?.path ?? args?.notebook_path;
  const cmd = args?.command ?? args?.cmd;
  const q = args?.pattern ?? args?.query ?? args?.url;
  let detail = '';
  if (file) detail = String(file).replace(/^[A-Za-z]:\\Dev\\math\\?/, '');
  else if (cmd) detail = strip(cmd).slice(0, 90);
  else if (q) detail = strip(q).slice(0, 70);
  else if (args && typeof args === 'object') detail = strip(Object.keys(args).join(',')).slice(0, 60);
  return { name, detail, file: file ? String(file) : '' };
}

function childState(childId) {
  const file = path.join(CWD_DIR, childId, 'session.v4.jsonl.zstd');
  if (!fs.existsSync(file)) return null;
  const st = fs.statSync(file);
  const cached = childCache.get(childId);
  if (cached && cached.mtime === st.mtimeMs && cached.size === st.size) return cached;

  const recs = tailRecords(file);
  const last = recs[recs.length - 1];
  let steps = 0, tools = 0, job = null, tool = null, said = '', wrote = '';
  for (const r of recs) {
    if (r.type === 'step/start') steps = Math.max(steps, r.data?.step ?? 0);
    if (r.type === 'tool/call') {
      tools++;
      tool = toolSummary(r);
      if (tool.file) wrote = tool.file;
    }
    if (r.type === 'job/registered') job = { kind: r.data?.kind, label: strip(r.data?.label).slice(0, 110) };
    if (r.type === 'assistant/message') { const t = visibleText(r); if (t) said = t; }
  }

  let doing;
  if (tool?.name === 'pwsh' || job) doing = `$ ${job?.label ?? tool?.detail ?? ''}`.slice(0, 150);
  else if (tool) doing = `${tool.name}${tool.detail ? ': ' + tool.detail : ''}`.slice(0, 150);
  else if (said) doing = `says: ${strip(said).slice(0, 130)}`;
  else if (last?.type === 'step/start') doing = `step ${steps} · thinking`;
  else doing = String(last?.type ?? 'idle');

  const out = {
    mtime: st.mtimeMs, size: st.size,
    lastType: last?.type ?? '?', lastAt: last?.time ?? st.mtimeMs,
    steps, tools, doing, said: strip(said).slice(0, 220),
    wrote, files: filesIn(JSON.stringify(recs.slice(-8))).slice(0, 4),
    ended: last?.type === 'turn/end',
  };
  childCache.set(childId, out);
  return out;
}

/* ---------- verdict + fronts ---------- */

const head = (text, n = 400) => strip(text).slice(0, n);

const VERDICT = text => {
  const t = head(text);
  if (!t) return null;
  if (/\bno-go\b|判死|\[NG\]/i.test(t)) return 'dead';
  if (/\[T\]/.test(t)) return 'checked';
  if (/否证|refut|撤回|被否定/.test(t)) return 'refuted';
  if (/\[M\]|未判定|缺步/.test(t)) return 'in-work';
  return 'conjecture';
};

const FRONTS = [
  [/^h1/, 'H1', '主条件 H1'],
  [/^mu/, 'MU', 'μ² 接触项'],
  [/^rv|^fig8/, 'RV', '两变量约化'],
  [/^sp-/, 'SP', '第六物种六路'],
  [/^kw/, 'KW', 'W 的允许衰减类'],
  [/^q\d/, 'Q', '环方程判据'],
  [/^a\d+/, 'A', 'a-标度与谱桥'],
  [/^l\d+/, 'L', '文献核验'],
  [/^c\d+/, 'C', '连续极限'],
  [/^s\d+/, 'S', '审计与台账'],
  [/^t\d+/, 'T', '回合任务'],
  [/^r\d+/, 'R', '桥与率'],
  [/^dsh-/, 'DIAG', '工具自身诊断'],
  [/^paper|^ch1\d|^registry|^synthesis|^reconcile|^closest|^template/, 'PAPER', '论文与总账'],
  [/^na-|^quant-|^beyond-|^kramers|^dirichlet|^tci-|^ratio-|^w-align|^auditor|^gevp|^chain-|^no-sub/, 'NA', '非退化与谱证书'],
  [/^lit-|^bethe|^balaban|^liouville|^quantum-graph|^polchinski|^sdp|^tensor-rg|^sector-|^attack-|^ss-|^metric-|^u-comp|^implication|^deform-|^szz|^ds-ratio|^meta-|^last-four|^data-mode|^setwise|^falsifier/, 'IMP', '进口与分类'],
  [/^hc-|^lorentzian|^tropical|^pseudospectral/, 'SP0', '首批物种'],
];

const frontOf = name => {
  for (const [re, id, title] of FRONTS) if (re.test(name)) return { id, title };
  const m = String(name).match(/^([a-z0-9]+)-/i);          // new naming keeps working: gpp-structure → GPP
  if (m) return { id: m[1].toUpperCase(), title: '' };
  return { id: String(name).slice(0, 4).toUpperCase(), title: '' };
};

const sha = s => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
};

/* ---------- snapshot ---------- */

function buildSnapshot() {
  main.poll();
  const recs = main.records;
  const now = Date.now();

  const children = new Map();
  for (const r of recs.filter(r => r.type === 'subagent/catalog')) {
    if (!r.data?.childId) continue;
    children.set(r.data.childId, { ...children.get(r.data.childId), ...r.data });
  }

  const settled = new Map();
  for (const r of recs.filter(r => r.type === 'user/message' && r.data?.source?.kind === 'subagent-settled')) {
    const t = textOf(r);
    const m = t.match(/subagent (\S+) finished/);
    if (m) settled.set(m[1], {
      at: r.time,
      text: t.replace(/^[\s\S]*?closing message:\s*/, '').trim(),
    });
  }

  const nodes = [];
  for (const c of children.values()) {
    const st = childState(c.childId);
    const stl = settled.get(c.name);
    const running = !stl && st && (now - st.mtime < 6 * 60 * 1000) && !st.ended;
    const front = frontOf(c.name);
    const verdict = stl ? VERDICT(stl.text) : null;
    const status = stl ? (verdict ?? 'conjecture') : (running ? 'in-work' : 'conjecture');
    const isPaper = /^paper|^ch1\d/.test(c.name);
    nodes.push({
      id: c.name,
      front: front.id,
      status: isPaper && !verdict ? 'checked' : status,
      title: c.label || c.name,
      note: stl ? head(stl.text, 240)
        : running ? st.doing
          : st ? `idle since ${iso(st.mtime)} · ${st.lastType}`
            : 'no log',
      doing: running ? st.doing : (st?.doing ?? null),
      steps: st?.steps ?? 0,
      tools: st?.tools ?? 0,
      wrote: st?.wrote ? st.wrote.replace(/^[A-Za-z]:\\Dev\\math\\?/, '') : '',
      said: st?.said ?? '',
      lastAt: st?.lastAt ?? (stl?.at ?? c.childCreatedAt),
      createdAt: c.childCreatedAt,
      running: Boolean(running),
      settledAt: stl?.at ?? null,
      frontTitle: front.title,
    });
  }

  // programs = fronts
  const frontIds = [...new Set(nodes.map(n => n.front))];
  const programs = frontIds.map(id => {
    const members = nodes.filter(n => n.front === id);
    const runningNow = members.filter(n => n.running).length;
    const counts = ['checked', 'refuted', 'dead', 'conjecture'].map(k => members.filter(m => m.status === k).length);
    return {
      id,
      name: id,
      title: members[0].frontTitle || '',
      aim: `${members.length} subagents · ${runningNow} running`,
      goal: `${counts[0]} [T] · ${counts[1]} refuted · ${counts[2]} [NG] · ${counts[3]} open`,
      label: runningNow ? 'live front' : 'quiet',
      members: members.length,
      running: runningNow,
    };
  }).sort((a, b) => b.members - a.members);

  // hub-spoke edges inside a front
  for (const p of programs) {
    const group = nodes.filter(n => n.front === p.id).sort((a, b) => a.createdAt - b.createdAt);
    group.forEach((n, i) => { n.deps = i === 0 ? [] : [group[0].id]; });
  }

  // events
  const events = [];
  const push = (at, kind, program, text, seq) => events.push({ seq: seq ?? 0, at: isoFull(at), kind, program, text: head(text, 280) });
  for (const r of recs.slice(-2500)) {
    const d = r.data ?? {};
    if (r.type === 'user/message') {
      const kind = d.source?.kind;
      const t = textOf(r);
      if (kind === 'subagent-settled') {
        const name = t.match(/subagent (\S+) finished/)?.[1] ?? '';
        const body = t.replace(/^[\s\S]*?closing message:\s*/, '');
        push(r.time, VERDICT(body) ?? 'conjecture', frontOf(name).id, `${name} settled · ${body}`, r.seq);
      } else if (kind === 'agent-message') {
        const m = t.match(/Agent (\S+) sent a message:\s*([\s\S]*)/);
        push(r.time, 'note', frontOf(m?.[1] ?? '').id, `${m?.[1] ?? 'agent'}: ${m?.[2] ?? t}`, r.seq);
      } else if (kind === 'user' && t) {
        push(r.time, 'status', 'X', `you: ${t}`, r.seq);
      }
    } else if (r.type === 'subagent/catalog' && d.name) {
      push(r.time, 'started', frontOf(d.name).id, `${d.name} spawned · ${d.label ?? ''}`, r.seq);
    } else if (r.type === 'team/task') {
      push(r.time, 'status', frontOf(d.task?.ownerName ?? '').id,
        `task ${d.task?.id} → ${d.task?.status} · ${d.task?.subject ?? ''}`, r.seq);
    }
  }
  events.sort((a, b) => b.at.localeCompare(a.at) || b.seq - a.seq);

  // papers: files the fleet is quoting
  const papers = new Map();
  for (const r of recs.slice(-2500)) {
    if (r.type !== 'user/message') continue;
    const t = textOf(r);
    for (const m of t.matchAll(/(?:research|docs)\/[^\s`"'）)，。]+\.(?:md|tex)/g)) {
      const p = m[0].replace(/[.,;:]$/, '');
      if (papers.has(p)) continue;
      papers.set(p, {
        id: `P-${sha(p)}`,
        title: p,
        program: /paper|main/.test(p) ? 'PAPER' : frontOf(path.basename(p)).id,
        status: /main\.tex|paper/.test(p) ? 'in-review' : 'checked',
        when: isoFull(r.time).slice(0, 10),
        blurb: `written by the fleet · ${filesIn(t).length} files cited in that message`,
      });
    }
  }

  const graveyard = nodes.filter(n => n.status === 'dead' && n.settledAt)
    .sort((a, b) => b.settledAt - a.settledAt).slice(0, 14)
    .map(n => ({ name: n.id, program: n.front, died: isoFull(n.settledAt).slice(0, 10), why: n.note }));

  const lastHuman = [...recs].reverse().find(r => r.type === 'user/message' && r.data?.source?.kind === 'user');
  const lastAssistant = [...recs].reverse().find(r => r.type === 'assistant/message' && textOf(r));
  const turns = recs.filter(r => r.type === 'turn/start').length;
  const running = nodes.filter(n => n.running).sort((a, b) => b.lastAt - a.lastAt);
  const statusText = strip(visibleText(lastAssistant ?? {}) || textOf(lastAssistant ?? {}) || textOf(lastHuman ?? {}));
  const statusPick = statusText || '(no message yet)';

  return {
    schema_version: 'live-2',
    generated_at: isoFull(now),
    events_through_seq: recs.length,
    source: {
      session: SESSION_ID, log: LOG, turns, subagents: nodes.length,
      settled: nodes.filter(n => n.settledAt).length, running: running.length,
      main_last_record: main.records[main.records.length - 1]?.type ?? null,
    },
    status: {
      at: isoFull(lastAssistant?.time ?? now),
      seat: `turn ${turns} · ${nodes.length} subagents`,
      turn: turns,
      subagents: nodes.length,
      program: null,
      text: statusPick.length > 320 ? statusPick.slice(0, 318) + ' …' : statusPick,
    },
    counters: {
      agents_working_now: running.length,
      spawned: nodes.length,
      settled: nodes.filter(n => n.settledAt).length,
      agent_sessions_total: nodes.length,
      checked: nodes.filter(n => n.status === 'checked').length,
      refuted: nodes.filter(n => n.status === 'refuted').length,
      dead: nodes.filter(n => n.status === 'dead').length,
      in_work: running.length,
    },
    vocab: {
      zh: {
        sessions: '累计派出的子代理，实时',
        working: '此刻在跑',
        checked: '结案判 [T] 的子代理',
        refuted: '记录里的否证',
        dead: '判死 [NG]',
        map_count: '在跑',
        map_work: '累计派出',
        live: '实时 · 每 6 秒读一次会话日志',
        snapshot: '会话日志 · 本地快照',
        board_title: '每个子代理，按战线与结案判定',
        idle: '此刻没有子代理在跑',
      },
      en: {
        sessions: 'subagents spawned so far, live',
        working: 'running right now',
        checked: 'subagents with a [T] verdict',
        refuted: 'refutations on the record',
        dead: 'no-go rulings [NG]',
        map_count: 'running',
        map_work: 'spawned',
        live: 'live · reading the session log every 6s',
        snapshot: 'session log · local snapshot',
        board_title: 'Every subagent, by front and verdict',
        idle: 'no subagent is running this second',
      },
    },
    running: running.slice(0, 12).map(n => ({
      id: n.id,
      front: n.front,
      doing: n.doing ?? '',
      steps: n.steps,
      tools: n.tools,
      wrote: n.wrote,
      lastAt: isoFull(n.lastAt),
      since: Math.round((now - n.lastAt) / 1000),
      running: true,
    })),
    activity: running.slice(0, 12).map(n => ({     // live only: settled seats leave the panel
      id: n.id,
      front: n.front,
      doing: n.doing || (n.said ? `says: ${n.said}` : 'no action on record'),
      steps: n.steps,
      tools: n.tools,
      wrote: n.wrote,
      lastAt: isoFull(n.lastAt),
      running: true,
    })),
    idle_since: running.length ? null : isoFull(Math.max(...nodes.map(n => n.lastAt))),
    programs,
    lemmas: running.map(n => ({                    // the map holds running seats only
      id: n.id, program: n.front, status: 'in-work',
      title: `${n.id} · ${n.title}`,
      note: n.doing || n.note,
      doing: n.doing, steps: n.steps, tools: n.tools, wrote: n.wrote,
      running: true, lastAt: isoFull(n.lastAt),
      deps: [],
    })),
    archive: nodes.filter(n => n.settledAt).map(n => ({
      id: n.id, program: n.front, status: n.status, title: `${n.id} · ${n.title}`,
      note: n.note, doing: n.doing || (n.said ? n.said : ''), steps: n.steps, tools: n.tools,
      running: false, lastAt: isoFull(n.lastAt), deps: n.deps,
    })),
    events: events.slice(0, 240),
    papers: [...papers.values()].slice(-8),
    graveyard,
  };
}

/* ---------- modes ---------- */

let cached = { at: 0, snap: null };
function snapshot(force = false) {
  if (!force && cached.snap && Date.now() - cached.at < 4000) return cached.snap;
  cached = { at: Date.now(), snap: buildSnapshot() };
  return cached.snap;
}

function write() {
  const snap = snapshot(true);
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'snapshot.json'), JSON.stringify(snap, null, 2));
  if (fs.existsSync(DIST)) fs.writeFileSync(path.join(DIST, 'live.json'), JSON.stringify(snap));
  return snap;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};

function serve(port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/live.json' || url.pathname === '/data/live.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify(snapshot()));
      return;
    }
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.join(DIST, rel);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(fs.readFileSync(file));
  });
  server.listen(port, '127.0.0.1', () => console.log(`live: http://127.0.0.1:${port}/  ← ${LOG}`));
  return server;
}

if (arg('write')) {
  const s = write();
  console.log(`wrote data/snapshot.json · ${s.source.subagents} subagents · ${s.source.settled} settled · ${s.source.running} running · ${s.events.length} events`);
}

if (arg('serve')) serve(Number(arg('serve')));

if (Number(arg('push', 0)) > 0) {
  let last = '';
  setInterval(() => {
    const s = write();
    const sig = JSON.stringify(s.counters) + (s.events[0]?.text ?? '');
    if (sig === last) return;
    last = sig;
    try {
      execFileSync('git', ['add', 'data/snapshot.json'], { cwd: ROOT });
      execFileSync('git', ['-c', 'user.name=fujo', '-c', 'user.email=hooyan2024@gmail.com', 'commit', '-q',
        '-m', `live: ${s.counters.agents_working_now} running · ${s.counters.checked} [T] · ${s.events[0]?.text.slice(0, 64) ?? ''}`], { cwd: ROOT });
      execFileSync('git', ['push', '-q'], { cwd: ROOT });
      console.log(`pushed ${s.generated_at}`);
    } catch (e) { console.log('push skipped:', String(e.message).split('\n')[0]); }
  }, Number(arg('push')) * 1000);
  console.log(`pages sync every ${arg('push')}s`);
}

if (!arg('serve') && !arg('write') && !(Number(arg('push', 0)) > 0)) {
  const s = snapshot(true);
  console.log(JSON.stringify({
    counters: s.counters,
    subagents: s.source.subagents, settled: s.source.settled,
    running: s.running, status: s.status.text.slice(0, 160),
    programs: s.programs.map(p => `${p.name}:${p.members}`).join(' '),
  }, null, 1));
}
