/* LED big screen: shows whatever the organisers pick in the admin (Screen page), updating live. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hm12 = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
  const fmtDay = (d) => new Date(d + 'T00:00:00+05:30').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  const app = $('#app');
  let adminToken = localStorage.getItem('amg_admin'); // same sign-in as the admin panel and check-in desk
  let cfg, lastJson = '', lastKey = '', qIndex = 0, qTimer;

  function login(msg) {
    app.innerHTML = `<form class="card login stack" id="lf"><h2>LED screen</h2>
      <p class="muted small">Sign in once with the organiser password. This screen then follows what you pick on the admin's Screen page.</p>
      ${msg ? `<div class="small" style="color:#b42318">${esc(msg)}</div>` : ''}
      <input class="input" type="password" name="password" placeholder="Organiser password" required>
      <button class="btn block">Start screen</button></form>`;
    $('#lf').onsubmit = async (e) => {
      e.preventDefault();
      const d = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: e.target.password.value }) }).then((r) => r.json());
      if (!d.token) return login('That password is not right.');
      adminToken = d.token; localStorage.setItem('amg_admin', adminToken); start();
    };
  }

  function frame(inner) {
    const b = cfg.branding;
    return `<div class="stage">
      <div class="head">${b.logo ? `<img src="${esc(b.logo)}" alt="">` : ''}<div class="ev">${esc(b.eventName)}</div><div class="tag">${esc(b.tagline || '')}</div></div>
      <main>${inner}</main></div>`;
  }

  const views = {
    welcome(d) {
      const b = cfg.branding;
      const slot = (label, s) => `<div><div class="kicker">${label}</div>${s ? `<h3>${esc(s.title)}</h3><div class="when">${fmtDay(s.day)}${s.start_time ? ' · ' + hm12(s.start_time) : ''}${s.location ? ' · ' + esc(s.location) : ''}</div>` : '<h3>Nothing scheduled</h3>'}</div>`;
      return `${b.titleArt ? `<img class="title-art" src="${esc(b.titleArt)}" alt="${esc(b.eventName)}">` : `<h1 class="big">${esc(b.eventName)}</h1>`}
        <div class="muted2" style="margin-top:2vmin">${esc(cfg.city)} · ${fmtDay(cfg.startDate)} – ${fmtDay(cfg.endDate)}</div>
        <div class="nn">${slot(d.current ? '● Happening now' : 'Right now', d.current)}${slot('Up next', d.next)}</div>`;
    },
    arrivals(d) {
      return `<div class="kicker">Welcome to ${esc(cfg.branding.eventName)}</div>
        <div class="count">${d.checkedIn}<small> / ${d.total} arrived</small></div>
        <div class="prog"><i style="width:${d.total ? (100 * d.checkedIn) / d.total : 0}%"></i></div>
        <div class="names">${d.recent.map((p) => `<span>${esc(p.name)}</span>`).join('')}</div>`;
    },
    leaderboard(d) {
      return `<div class="kicker">Overall leaderboard</div>${rankList(d.rows, (r) => `${r.points} pts`)}`;
    },
    wheel(d) {
      return `<div class="kicker">${esc(d.title)} · ${d.spins} spins</div><h2 class="q">Latest winners</h2>
        ${d.winners.length ? `<div class="cols">${d.winners.map((w) => `<div class="rank"><span class="n">🎁</span><div><b>${esc(w.name)}</b><div class="co">${esc(w.company || '')}</div></div><span class="pts">${esc(w.label)}</span></div>`).join('')}</div>` : '<div class="muted2">Spin the wheel on your phone. Winners appear here!</div>'}`;
    },
    draw(d) {
      const shownW = d.winners.slice(0, revealed);
      return `<div class="kicker">Lucky draw · ${d.winnersCount} winner${d.winnersCount === 1 ? '' : 's'}</div><h1 class="big">🎁 ${esc(d.title)}</h1>
        <div class="slot" id="slot">${revealed < d.winners.length ? '' : shownW.length < d.winnersCount ? 'Who will it be?' : ''}</div>
        <div class="names win">${shownW.map((w) => `<span>🏆 ${esc(w.name)}${w.company ? ` <small>${esc(w.company)}</small>` : ''}</span>`).join('')}</div>`;
    },
    spotlight(d) {
      const m = d.messages[qIndex % Math.max(1, d.messages.length)];
      return `<div class="spot"><div>
          <div class="kicker">⭐ Star Spotlight</div>
          ${m ? `<h2 class="q" style="margin-bottom:2vmin">To ${esc(m.to_name)}${m.to_company ? ` <span class="co">· ${esc(m.to_company)}</span>` : ''}</h2>
            <div class="quote">“${esc(m.message)}”</div><div class="muted2" style="margin-top:3vmin">— ${esc(m.from_name)}</div>`
            : '<h1 class="big">Appreciate a colleague</h1><div class="muted2" style="margin-top:2vmin">Open the microsite → Play → Star Spotlight</div>'}
        </div>
        ${d.top.length ? `<div class="most"><div class="kicker">Most appreciated</div>${d.top.map((t, i) => `<div class="rank"><span class="n">${i + 1}</span><b>${esc(t.name)}</b><span class="pts">${t.stars}⭐</span></div>`).join('')}</div>` : ''}
      </div>`;
    },
    activity(d) {
      const played = `${d.participants} of ${d.totalAttendees} have ${d.kind === 'quiz' ? 'played' : 'voted'}`;
      if (!d.reveal) {
        return `<div class="kicker">Live quiz</div><h1 class="big">${esc(d.title)}</h1>
          <div class="count" style="margin-top:4vmin">${d.participants}<small> playing</small></div><div class="muted2">Open the microsite on your phone to join. Results appear when the quiz closes.</div>`;
      }
      if (d.kind === 'quiz') {
        return `<div class="kicker">${esc(d.title)} · ${played}</div><h2 class="q">Winners</h2>
          ${rankList(d.rankings, (r) => `${r.score}/${d.maxScore}<span class="co"> · ${(r.duration_ms / 1000).toFixed(1)}s</span>`)}`;
      }
      const q = d.questions[qIndex % Math.max(1, d.questions.length)];
      if (!q) return `<h1 class="big">${esc(d.title)}</h1>`;
      const max = Math.max(0, ...q.counts);
      const body = q.qtype === 'text'
        ? `<div class="wall">${q.textAnswers.map((t) => `<span>${esc(t)}</span>`).join('') || '<span>Waiting for answers…</span>'}</div>`
        : `<div class="bars">${q.options.map((o, i) => `<div class="opt ${max && q.counts[i] === max ? 'top' : ''}" data-i="${i}">
            <div class="lab"><span>${esc(o)}</span><span><span class="pct">${q.percents[i]}%</span> <span class="co" style="opacity:.6">(${q.counts[i]})</span></span></div>
            <div class="track"><i data-w="${q.percents[i]}"></i></div></div>`).join('')}</div>`;
      return `<div class="kicker">Live poll · ${played}${d.questions.length > 1 ? ` · question ${(qIndex % d.questions.length) + 1} of ${d.questions.length}` : ''}</div>
        <h2 class="q">${esc(q.text)}</h2>${body}`;
    },
  };

  function rankList(rows, right) {
    if (!rows.length) return '<div class="muted2">No scores yet.</div>';
    const item = (r) => `<div class="rank ${r.rank === 1 ? 'first' : ''}"><span class="n">${r.rank}</span><div><b>${esc(r.name)}</b><div class="co">${esc(r.company || '')}</div></div><span class="pts">${right(r)}</span></div>`;
    return `<div class="cols"><div>${rows.slice(0, 5).map(item).join('')}</div><div>${rows.slice(5, 10).map(item).join('')}</div></div>`;
  }

  // Grow bars from their old width, so new votes animate instead of the page flashing.
  function growBars() { requestAnimationFrame(() => app.querySelectorAll('.track i').forEach((i) => (i.style.width = i.dataset.w + '%'))); }

  function draw(s) {
    const key = `${s.mode}:${s.id}:${qIndex}`;
    const html = views[s.mode](s.data);
    if (key === lastKey && $('main')) {
      const old = [...app.querySelectorAll('.track i')].map((i) => i.style.width);
      $('main').innerHTML = html; // same view: swap content in place, no entry animation
      app.querySelectorAll('.track i').forEach((i, n) => (i.style.width = old[n] || '0'));
    } else {
      app.innerHTML = frame(html);
    }
    lastKey = key;
    growBars();
  }

  // ---------- lucky draw reveal ----------
  // Winners already drawn when the screen opens are shown straight away; new ones get the shuffle.
  let revealed = 0, drawId = null, revealing = false;
  async function revealNext() {
    if (revealing || current?.mode !== 'draw') return;
    const d = current.data;
    if (revealed >= d.winners.length) return;
    revealing = true;
    const slot = $('#slot');
    const names = d.pool.length ? d.pool : [d.winners[revealed].name];
    const winner = d.winners[revealed];
    // Spin through names, slowing down, then land on the winner.
    for (let delay = 50; delay < 420; delay *= 1.09) {
      slot.textContent = names[Math.floor(Math.random() * names.length)];
      await new Promise((r) => setTimeout(r, delay));
    }
    slot.innerHTML = `<span class="landed">🎉 ${esc(winner.name)}</span>`;
    await new Promise((r) => setTimeout(r, 3500));
    revealed++;
    revealing = false;
    draw(current);
    revealNext();
  }

  let current;
  async function poll() {
    try {
      const res = await fetch('/api/admin/screen', { headers: { 'x-admin': adminToken } });
      if (res.status === 401) { localStorage.removeItem('amg_admin'); adminToken = null; return login(); }
      const s = await res.json();
      const json = JSON.stringify(s);
      if (json !== lastJson) {
        if (!current || current.mode !== s.mode || current.id !== s.id) qIndex = 0;
        if (s.mode === 'draw' && drawId !== s.id) { drawId = s.id; revealed = s.data.winners.length; }
        if (s.mode === 'draw' && s.data.winners.length < revealed) revealed = s.data.winners.length; // a winner was marked absent
        lastJson = json; current = s;
        if (!revealing) { draw(s); revealNext(); }
      }
    } catch { /* venue Wi-Fi blip: keep showing the last screen and try again */ }
    setTimeout(poll, 2000); // shortcut: polls every 2s; switch to server push if the screen ever needs sub-second updates
  }

  // A poll with several questions shows each one for 12 seconds; Star Spotlight shows each message for 10.
  qTimer = setInterval(() => {
    if (current?.mode === 'activity' && current.data.kind === 'poll' && current.data.questions.length > 1) { qIndex++; draw(current); }
  }, 12000);
  setInterval(() => {
    if (current?.mode === 'spotlight' && current.data.messages.length > 1) { qIndex++; draw(current); }
  }, 10000);

  function start() { lastJson = ''; lastKey = ''; poll(); }

  // Full-screen button appears when the mouse moves and hides again.
  const fs = $('#fs');
  let hide;
  document.addEventListener('mousemove', () => {
    document.body.classList.add('cursor');
    fs.classList.toggle('hidden', !!document.fullscreenElement);
    clearTimeout(hide);
    hide = setTimeout(() => { document.body.classList.remove('cursor'); fs.classList.add('hidden'); }, 2500);
  });
  fs.onclick = () => document.documentElement.requestFullscreen?.();

  fetch('/api/config').then((r) => r.json()).then((c) => {
    cfg = c;
    Brand.apply(c.branding);
    document.body.style.background = Brand.heroBackground(c.branding); // the event artwork behind every view
    adminToken ? start() : login();
  });
})();
