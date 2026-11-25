/* Mass gap? — one script. Reads the snapshot embedded by build.py and renders
   counters, the record, the board, programs, papers, the graveyard, and the map. */
(() => {
  const tag = document.getElementById('fleet-data');
  if (!tag) return;
  const snap = JSON.parse(tag.textContent);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const fmt = n => n.toLocaleString('en-US');
  const KIND = {
    checked: 'checked', refuted: 'refuted', dead: 'dead', 'in-work': 'in-work',
    started: 'started', status: 'status', note: 'note',
  };
  const STATUS_LABEL = {
    checked: 'checked', refuted: 'refuted', 'in-work': 'in work',
    conjecture: 'conjecture', dead: 'dead',
  };
  const PROG = Object.fromEntries(snap.programs.map(p => [p.id, p]));

  const ago = iso => {
    const s = (new Date(snap.generated_at) - new Date(iso)) / 1000;
    if (!isFinite(s) || s < 0) return 'now';
    if (s < 90) return `${Math.max(1, Math.round(s))}s ago`;
    if (s < 5400) return `${Math.round(s / 60)}m ago`;
    if (s < 172800) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  };
  const chip = (kind, text) =>
    `<span class="chip chip--${KIND[kind] || 'status'}"><i class="dot"></i>${text || kind}</span>`;

  function countUp(node, to) {
    if (reduced) { node.textContent = fmt(to); return; }
    const start = performance.now(), dur = 700;
    const step = now => {
      const k = Math.min(1, (now - start) / dur);
      node.textContent = fmt(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* counters ------------------------------------------------------------- */

  function renderCounters() {
    $$('[data-count]').forEach(node => {
      const key = node.dataset.count;
      const value = snap.counters[key];
      if (typeof value === 'number') countUp(node, value);
    });
    $$('[data-total]').forEach(node => { node.textContent = fmt(snap.events_through_seq); });
  }

  /* status --------------------------------------------------------------- */

  function renderStatus() {
    $$('[data-status]').forEach(root => {
      const p = PROG[snap.status.program];
      root.innerHTML = `
        <div class="seat">${snap.status.seat} · ${p ? p.name + ' · ' + p.title : ''}</div>
        <p>${snap.status.text}</p>
        <div class="meta">
          <span>${ago(snap.status.at)}</span>
          <span>snapshot ${snap.generated_at.slice(0, 16).replace('T', ' ')} UTC</span>
          <span>${fmt(snap.counters.agents_working_now)} seats working now</span>
        </div>`;
    });
  }

  /* feed ----------------------------------------------------------------- */

  function renderFeed() {
    $$('[data-feed]').forEach(root => {
      const limit = Number(root.dataset.limit || snap.events.length);
      const kindFilter = root.dataset.filter || 'all';
      const list = snap.events
        .filter(e => kindFilter === 'all' || e.kind === kindFilter)
        .slice(0, limit);
      root.innerHTML = list.map((e, i) => {
        const p = PROG[e.program];
        return `<li class="${i === 0 && limit < snap.events.length ? 'is-new' : ''}">
          <span class="t">${ago(e.at)}<br>#${e.seq}</span>
          ${chip(e.kind, p ? p.name : e.kind)}
          <span class="txt">${e.text}</span>
        </li>`;
      }).join('');
    });
  }

  function wireFilters() {
    const root = $('[data-feed-full]');
    if (!root) return;
    const buttons = $$('.filters button');
    const draw = kind => {
      root.dataset.filter = kind;
      buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
      renderFeed();
    };
    buttons.forEach(b => b.addEventListener('click', () => draw(b.dataset.kind)));
    draw('all');
  }

  /* board ---------------------------------------------------------------- */

  function renderBoard() {
    const root = $('[data-board]');
    if (!root) return;

    const counts = {};
    snap.lemmas.forEach(l => { counts[l.status] = (counts[l.status] || 0) + 1; });

    root.innerHTML = snap.programs.map(p => {
      const rows = snap.lemmas.filter(l => l.program === p.id);
      if (!rows.length) return '';
      const c = {};
      rows.forEach(l => { c[l.status] = (c[l.status] || 0) + 1; });
      const tally = ['checked', 'in-work', 'conjecture', 'refuted', 'dead']
        .filter(k => c[k]).map(k => `${c[k]} ${STATUS_LABEL[k]}`).join(' · ');
      return `<section class="prog-block" id="${p.id}">
        <header>
          <h2>${p.name} · ${p.title}</h2>
          <span class="aim">${p.aim}</span>
          <span class="counts">${tally}</span>
        </header>
        ${rows.map(l => `<article class="lemma-row" data-status="${l.status}"
            data-hay="${(l.id + ' ' + l.title + ' ' + l.note + ' ' + p.name).toLowerCase()}">
          <span class="id">${l.id}</span>
          <span>${chip(l.status, STATUS_LABEL[l.status])}</span>
          <div>
            <h3>${l.title}</h3>
            <p>${l.note}</p>
            ${l.deps.length ? `<div class="deps">rests on ${l.deps.join(' · ')}</div>` : ''}
          </div>
        </article>`).join('')}
      </section>`;
    }).join('') + `<p class="board-empty" hidden>No lemma matches that.</p>`;

    const search = $('[data-board-search]');
    if (search) {
      const rows = $$('.lemma-row', root);
      const empty = $('.board-empty', root);
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        let shown = 0;
        rows.forEach(r => {
          const hit = !q || r.dataset.hay.includes(q);
          r.hidden = !hit;
          if (hit) shown++;
        });
        $$('.prog-block', root).forEach(block => {
          block.hidden = !$$('.lemma-row', block).some(r => !r.hidden);
        });
        empty.hidden = shown > 0;
      });
    }
  }

  /* programs / papers / graveyard ---------------------------------------- */

  function renderPrograms() {
    $$('[data-programs]').forEach(root => {
      root.innerHTML = snap.programs.map(p => {
        const rows = snap.lemmas.filter(l => l.program === p.id);
        const c = k => rows.filter(l => l.status === k).length;
        return `<article class="prog-card" id="${p.id}">
          <div class="pc-top">
            <span class="pc-mark">${p.name}</span>
            <span class="pc-label">${p.label}</span>
          </div>
          <h2>${p.title}</h2>
          <div class="aim">${p.aim}</div>
          <p>${p.goal}</p>
          <div class="pc-foot">
            <span>${c('checked')} checked</span>
            <span>${c('in-work')} in work</span>
            <span>${c('refuted')} refuted</span>
            <span>${c('dead')} dead</span>
            <a href="board.html#${p.id}">See the lemmas</a>
          </div>
        </article>`;
      }).join('');
    });
  }

  function renderPapers() {
    $$('[data-papers]').forEach(root => {
      root.innerHTML = snap.papers.slice(0, Number(root.dataset.limit || snap.papers.length)).map(pp => {
        const prog = PROG[pp.program];
        return `<article class="paper">
          <div class="pid">${pp.id}</div>
          <div>
            <h2>${pp.title}</h2>
            <p>${pp.blurb}</p>
            <div class="pmeta">
              ${chip(pp.status === 'checked' ? 'checked' : 'in-work', pp.status === 'checked' ? 'checked by the checker' : 'in human review')}
              <span>${prog ? prog.name + ' · ' + prog.title : ''}</span>
              <span>${pp.when}</span>
            </div>
          </div>
        </article>`;
      }).join('');
    });
  }

  function renderGraveyard() {
    $$('[data-graveyard]').forEach(root => {
      root.innerHTML = snap.graveyard
        .slice(0, Number(root.dataset.limit || snap.graveyard.length)).map(g => {
        const p = PROG[g.program];
        return `<article class="grave">
          <div>
            <h2>${g.name}</h2>
            <p>${g.why}</p>
          </div>
          <div class="gd">${p ? p.name : ''}<br>${g.died}</div>
        </article>`;
      }).join('');
    });
  }

  /* map ------------------------------------------------------------------ */

  const COLORS = {
    checked: { fill: '#7BC79A', ring: 'rgba(61,170,110,0.55)' },
    'in-work': { fill: '#BFE8FF', ring: 'rgba(127,209,255,0.55)' },
    conjecture: { fill: '#8B8F98', ring: 'rgba(139,143,152,0.4)' },
    refuted: { fill: '#E0705C', ring: 'rgba(224,112,92,0.45)' },
    dead: { fill: '#575C66', ring: 'rgba(87,92,102,0.45)' },
  };
  const RADIUS = { checked: 8, 'in-work': 7, conjecture: 5.5, refuted: 6, dead: 4.5 };

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function setupMap() {
    const canvas = $('#fleet-map');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const card = $('[data-map-card]');
    const legendCount = $('[data-map-nodes]');
    const rand = mulberry32(20261125);

    const nodes = snap.lemmas.map((l, i) => ({
      ...l,
      r: RADIUS[l.status] || 5,
      cx: 0, cy: 0,
      x: 0, y: 0, vx: 0, vy: 0,
    }));
    const index = Object.fromEntries(nodes.map(n => [n.id, n]));
    const links = [];
    nodes.forEach(n => n.deps.forEach(d => { if (index[d]) links.push({ a: index[d], b: n }); }));

    // anchor each program in a ring; jitter seeded so the map is stable across loads
    const r0 = 330;
    snap.programs.forEach((p, pi) => {
      const a = (pi / snap.programs.length) * Math.PI * 2 - Math.PI / 2;
      const cx = Math.cos(a) * r0, cy = Math.sin(a) * r0 * 0.62;
      nodes.filter(n => n.program === p.id).forEach(n => {
        n.cx = cx; n.cy = cy;
        const j = Math.sqrt(rand()) * 104, ja = rand() * Math.PI * 2;
        n.x = cx + Math.cos(ja) * j;
        n.y = cy + Math.sin(ja) * j;
      });
    });

    const view = { k: 1, x: 0, y: 0 };
    let W = 0, H = 0, dpr = 1;
    let hovered = null, selected = null, query = '', interacted = false;

    const toScreen = n => ({ x: W / 2 + (n.x + view.x) * view.k, y: H / 2 + (n.y + view.y) * view.k });
    const toWorld = (px, py) => ({ x: (px - W / 2) / view.k - view.x, y: (py - H / 2) / view.k - view.y });

    const clusters = snap.programs
      .map(p => ({ p, nodes: nodes.filter(n => n.program === p.id) }))
      .filter(c => c.nodes.length);

    function fit() {
      if (!W || !H) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      nodes.forEach(n => {
        minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
        minY = Math.min(minY, n.y - 26); maxY = Math.max(maxY, n.y);
      });
      const pad = 58;
      const kx = (W - pad * 2) / Math.max(1, maxX - minX);
      const ky = (H - pad * 2) / Math.max(1, maxY - minY);
      view.k = Math.max(0.62, Math.min(1.9, Math.min(kx, ky)));
      view.x = -(minX + maxX) / 2;
      view.y = -(minY + maxY) / 2;
    }

    function tick(alpha = 1) {
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = (rand() - 0.5); dy = (rand() - 0.5); d2 = 1; }
          const d = Math.sqrt(d2);
          const f = Math.min(1000, 6200 / d2) * alpha;
          const ux = dx / d, uy = dy / d;
          a.vx -= ux * f; a.vy -= uy * f;
          b.vx += ux * f; b.vy += uy * f;
        }
        a.vx += (a.cx - a.x) * 0.020 * alpha;
        a.vy += (a.cy - a.y) * 0.026 * alpha;
      }
      links.forEach(l => {
        const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y;
        const d = Math.hypot(dx, dy) || 1;
        const f = (d - 74) * 0.014 * alpha;
        const ux = dx / d, uy = dy / d;
        l.a.vx += ux * f; l.a.vy += uy * f;
        l.b.vx -= ux * f; l.b.vy -= uy * f;
      });
      nodes.forEach(n => {
        n.vx *= 0.86; n.vy *= 0.86;
        n.x += n.vx; n.y += n.vy;
      });
    }

    function size() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      W = rect.width; H = rect.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!interacted) fit();
      draw();
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.lineCap = 'round';

      // edges
      links.forEach(l => {
        const a = toScreen(l.a), b = toScreen(l.b);
        const live = selected && (l.a === selected || l.b === selected);
        ctx.strokeStyle = live ? 'rgba(191,232,255,0.5)' : 'rgba(255,255,255,0.12)';
        ctx.lineWidth = live ? 1.3 : 0.9;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      });

      // label space already spent, so no two labels collide
      const taken = [];
      const free = (x, y, w, h) => {
        for (const r of taken) {
          if (x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y) return false;
        }
        for (const n of nodes) {
          const q = toScreen(n);
          const rr = Math.max(3.4, n.r * view.k) + 2;
          if (x < q.x + rr && x + w > q.x - rr && y < q.y + rr && y + h > q.y - rr) return false;
        }
        return true;
      };

      // program captions, above each cluster
      if (view.k > 0.55) {
        ctx.font = '600 10px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        clusters.forEach(c => {
          const cx = c.nodes.reduce((s, n) => s + n.x, 0) / c.nodes.length;
          const top = Math.min(...c.nodes.map(n => n.y)) - 26;
          const p = toScreen({ x: cx, y: top });
          const text = `${c.p.name} · ${c.p.title.toUpperCase()}`;
          const w = ctx.measureText(text).width;
          const x = Math.min(W - w / 2 - 10, Math.max(w / 2 + 10, p.x));
          if (!free(x - w / 2, p.y - 11, w, 13)) return;
          taken.push({ x: x - w / 2, y: p.y - 11, w, h: 13 });
          ctx.fillStyle = 'rgba(255,255,255,0.34)';
          ctx.fillText(text, x, p.y);
        });
      }

      // nodes
      nodes.forEach(n => {
        const p = toScreen(n);
        const dim = query && !n.title.toLowerCase().includes(query) && !n.id.toLowerCase().includes(query);
        const c = COLORS[n.status] || COLORS.conjecture;
        ctx.globalAlpha = dim ? 0.16 : 1;

        if (n.status === 'in-work' && !reduced) {
          const t = (Date.now() / 1400 + n.x * 0.01) % 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, n.r * view.k + 6 + t * 7, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(127,209,255,${0.22 * (1 - t)})`;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(3.4, n.r * view.k), 0, Math.PI * 2);
        if (n.status === 'conjecture' || n.status === 'dead') {
          ctx.fillStyle = 'rgba(10,12,17,0.9)';
          ctx.fill();
          ctx.strokeStyle = c.ring;
          ctx.lineWidth = 1.1;
          ctx.stroke();
        } else {
          ctx.fillStyle = c.fill;
          ctx.fill();
          ctx.strokeStyle = 'rgba(6,7,10,0.65)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        if (n === hovered || n === selected) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(3.4, n.r * view.k) + 4, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(242,184,75,0.85)';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }

        if (!dim && (n.r >= 8 || view.k > 1.2 || n === hovered || n === selected)) {
          ctx.font = '10px Inter, system-ui, sans-serif';
          ctx.textAlign = 'center';
          const label = n.title.length > 30 ? n.title.slice(0, 28) + '…' : n.title;
          const w = ctx.measureText(label).width;
          const ly = p.y + Math.max(3.4, n.r * view.k) + 13;
          if (n === hovered || n === selected || free(p.x - w / 2, ly - 10, w, 13)) {
            taken.push({ x: p.x - w / 2, y: ly - 10, w, h: 13 });
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = '#C9C4B8';
            ctx.fillText(label, p.x, ly);
          }
        }
        ctx.globalAlpha = 1;
      });
    }

    function nearest(px, py) {
      let best = null, bestD = 18;
      nodes.forEach(n => {
        const p = toScreen(n);
        const d = Math.hypot(p.x - px, p.y - py);
        if (d < bestD) { bestD = d; best = n; }
      });
      return best;
    }

    function showCard(n) {
      if (!card) return;
      if (!n) { card.hidden = true; return; }
      const p = PROG[n.program];
      card.hidden = false;
      card.innerHTML = `
        <div class="mc-id">${n.id} · ${p ? p.name : ''} ${p ? p.title : ''}</div>
        <h3>${n.title}</h3>
        <p>${n.note}</p>
        <div class="mc-foot">
          ${chip(n.status, STATUS_LABEL[n.status])}
          <span>${n.deps.length ? 'rests on ' + n.deps.join(', ') : 'rests on nothing'}</span>
        </div>`;
    }

    let drag = null;
    canvas.addEventListener('pointerdown', e => {
      interacted = true;
      canvas.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: 0 };
      canvas.classList.add('is-dragging');
    });
    canvas.addEventListener('pointermove', e => {
      const rect = canvas.getBoundingClientRect();
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
        view.x = drag.vx + dx / view.k;
        view.y = drag.vy + dy / view.k;
        draw();
        return;
      }
      const n = nearest(e.clientX - rect.left, e.clientY - rect.top);
      if (n !== hovered) { hovered = n; if (!selected) showCard(n); draw(); }
      canvas.style.cursor = n ? 'pointer' : '';
    });
    canvas.addEventListener('pointerup', e => {
      canvas.classList.remove('is-dragging');
      if (drag && drag.moved < 5) {
        const rect = canvas.getBoundingClientRect();
        const n = nearest(e.clientX - rect.left, e.clientY - rect.top);
        selected = n;
        showCard(n);
        draw();
      }
      drag = null;
    });
    canvas.addEventListener('pointerleave', () => {
      hovered = null;
      if (!selected) showCard(null);
      draw();
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      interacted = true;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      const before = toWorld(px, py);
      view.k = Math.min(2.8, Math.max(0.55, view.k * (e.deltaY < 0 ? 1.12 : 0.89)));
      const after = toWorld(px, py);
      view.x += after.x - before.x;
      view.y += after.y - before.y;
      draw();
    }, { passive: false });
    canvas.addEventListener('dblclick', () => {
      interacted = false; fit();
      selected = null; showCard(null); draw();
    });

    const search = $('[data-map-search]');
    if (search) {
      search.addEventListener('input', () => {
        query = search.value.trim().toLowerCase();
        draw();
      });
    }

    for (let i = 0; i < 320; i++) tick(1);
    nodes.forEach(n => { n.vx = 0; n.vy = 0; });
    size();
    addEventListener('resize', size);

    if (!reduced) {
      let last = 0;
      const loop = t => {
        if (t - last > 45) { last = t; draw(); }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    if (legendCount) legendCount.textContent = nodes.length;
  }

  renderCounters();
  renderStatus();
  renderPrograms();
  renderPapers();
  renderGraveyard();
  renderBoard();
  renderFeed();
  wireFilters();
  setupMap();

  // the year in the footer
  $$('[data-year]').forEach(n => { n.textContent = new Date().getFullYear(); });
})();
