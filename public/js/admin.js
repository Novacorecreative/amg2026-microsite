/* AMG 2026 admin console. */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toDate = (s) => (s ? new Date(/[TZ]/.test(s) ? s : s.replace(' ', 'T') + 'Z') : null);
  const when = (s) => { const d = toDate(s); return d ? d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—'; };
  const root = $('#root');

  function toast(msg, err) {
    const t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : '');
    t.innerHTML = `<span>${err ? '⚠️' : '✅'}</span><div>${esc(msg)}</div>`;
    $('#toasts').append(t);
    setTimeout(() => t.remove(), 4500);
  }
  function notified(n) {
    if (!n) return '';
    return ` Notifying ${n.recipients} people — WhatsApp: ${n.whatsapp}, email: ${n.email}.`;
  }

  let adminToken = localStorage.getItem('amg_admin');
  async function api(path, opts = {}) {
    const isForm = opts.body instanceof FormData;
    const res = await fetch('/api/admin' + path, {
      ...opts,
      headers: { ...(opts.body && !isForm && typeof opts.body !== 'string' ? { 'Content-Type': 'application/json' } : {}), 'x-admin': adminToken || '', ...(opts.headers || {}) },
      body: opts.body && !isForm && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { localStorage.removeItem('amg_admin'); adminToken = null; renderLogin(); throw new Error('auth'); }
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }
  const run = (fn) => async (...a) => { try { await fn(...a); } catch (e) { if (e.message !== 'auth') toast(e.message, true); } };

  // ---------- login ----------
  function renderLogin() {
    root.innerHTML = `<div style="min-height:100vh;display:grid;place-items:center;padding:16px;background:radial-gradient(120% 120% at 100% 0,var(--teal-500),var(--teal-900))">
      <form class="card stack" id="login" style="width:min(380px,100%)">
        ${brand?.logo ? `<img src="${esc(brand.logo)}" alt="${esc(brand.clientName)}" style="max-height:44px;max-width:180px;object-fit:contain">` : ''}
        <div class="muted small" style="letter-spacing:.14em;text-transform:uppercase">Organiser console</div>
        <h2 style="font-size:26px">${esc(brand?.eventName || 'AMG 2026')}</h2>
        <label class="field">Admin password<input class="input" type="password" name="password" required autofocus></label>
        <button class="btn block">Sign in</button>
      </form></div>`;
    $('#login').onsubmit = run(async (e) => {
      e.preventDefault();
      const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: e.target.password.value }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      adminToken = d.token; localStorage.setItem('amg_admin', adminToken);
      shell(); route();
    });
  }

  // ---------- shell ----------
  const pages = {
    dashboard: ['📊', 'Dashboard'], attendees: ['👥', 'Attendees'], updates: ['📣', 'Updates & videos'],
    engage: ['🏆', 'Quizzes & polls'], wheels: ['🎡', 'Spin the wheel'], draws: ['🎁', 'Lucky draw'], stars: ['⭐', 'Star Spotlight'], agenda: ['🗓️', 'Agenda'], gallery: ['📸', 'Gallery'], broadcast: ['📲', 'Broadcast'],
    branding: ['🎨', 'Branding'], screen: ['📺', 'LED screen'],
  };

  // ---------- brand ----------
  let brand = null;
  let eventMeta = '';
  async function loadBrand() {
    const cfg = await fetch('/api/config').then((r) => r.json());
    brand = cfg.branding;
    const day = (d, o) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', o);
    eventMeta = `${cfg.city} · ${day(cfg.startDate, { day: 'numeric', month: 'short' })} – ${day(cfg.endDate, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    window.Brand.apply(brand);
    document.title = `${brand.eventName} · Admin`;
  }
  const titleHtml = (name) => { const [a, b] = String(name).split(/\s+(?=\S+$)/); return b ? `${esc(a)} <span>${esc(b)}</span>` : esc(name); };
  function sideBrand() {
    const el = $('#sideBrand'); if (!el || !brand) return;
    el.innerHTML = `${brand.logo ? `<span class="brand-logo ${brand.logoBadge ? 'badge' : ''}"><img src="${esc(brand.logo)}" alt="${esc(brand.clientName)}"></span>` : ''}
      <div class="sub">Organiser console</div><h1>${titleHtml(brand.eventName)}</h1>`;
  }

  function shell() {
    root.innerHTML = `<div class="admin">
      <aside class="side"><div id="sideBrand"><div class="sub">Organiser console</div><h1>AMG <span>2026</span></h1></div>
        <nav>${Object.entries(pages).map(([k, [i, l]]) => `<a href="#${k}" data-p="${k}">${i} ${l}${k === 'gallery' ? '<span class="count hidden" id="pendCount"></span>' : ''}</a>`).join('')}
          <a href="/live/checkin" target="_blank">📷 Check-in desk</a><a href="/" target="_blank">↗ View microsite</a><a href="#" id="logout">⎋ Sign out</a></nav></aside>
      <section class="content" id="page"></section></div>`;
    $('#logout').onclick = (e) => { e.preventDefault(); localStorage.removeItem('amg_admin'); adminToken = null; renderLogin(); };
    sideBrand();
  }
  function route() {
    if (!adminToken) return renderLogin();
    if (!$('#page')) shell();
    const [p, arg] = (location.hash.replace(/^#/, '') || 'dashboard').split('/');
    const page = pages[p] ? p : 'dashboard';
    $$('.side nav a').forEach((a) => a.classList.toggle('active', a.dataset.p === page));
    run(renderers[page])(arg);
  }
  window.addEventListener('hashchange', route);
  const page = () => $('#page');

  // ---------- dashboard ----------
  async function renderDashboard() {
    const o = await api('/overview');
    setPending(o.counts.pendingMedia);
    const c = o.counts;
    page().innerHTML = `<h2 class="page">Dashboard</h2>
      <div class="stats">
        <div class="stat"><b>${c.attendees}</b><span>Attendees registered</span></div>
        <div class="stat"><b>${c.visited}</b><span>Have opened the microsite</span></div>
        <div class="stat"><b>${c.online}</b><span>Online right now</span></div>
        <div class="stat"><b>${c.liveActivities}</b><span>Live quizzes / polls</span></div>
        <div class="stat"><b>${c.pendingMedia}</b><span>Uploads awaiting approval</span></div>
        <div class="stat"><b>${c.approvedMedia}</b><span>Photos & videos in gallery</span></div>
      </div>
      <div class="two" style="margin-top:16px">
        <div class="card stack">
          <h3>Channels</h3>
          <div>💬 WhatsApp: <b>${esc(o.channels.whatsapp)}</b></div>
          <div>✉️ Email: <b>${esc(o.channels.email)}</b></div>
          <div class="muted small">Links point to <b>${esc(o.channels.baseUrl)}</b>. Set credentials in <code>.env</code> (see README). In dry-run mode every message is logged below but not sent.</div>
          <h3 style="margin-top:12px">Settings</h3>
          <label class="toggle"><input type="checkbox" data-s="auto_approve_uploads" ${o.settings.auto_approve_uploads ? 'checked' : ''}> Auto-approve guest uploads</label>
          <label class="toggle"><input type="checkbox" data-s="leaderboard_visible" ${o.settings.leaderboard_visible ? 'checked' : ''}> Show overall quiz leaderboard to guests</label>
          <label class="toggle"><input type="checkbox" data-s="lounge_enabled" ${o.settings.lounge_enabled ? 'checked' : ''}> Lounge (group chat) open</label>
        </div>
        <div class="card"><h3>Recent notifications</h3>
          ${o.batches.length ? `<div class="tablewrap"><table><tr><th>When</th><th>Message</th><th>Sent</th><th>Dry-run</th><th>Failed</th><th>Skipped</th><th></th></tr>
            ${o.batches.map((b) => `<tr><td>${when(b.created_at)}</td><td>${esc(b.subject)}</td><td>${b.sent}</td><td>${b.dry_run}</td><td style="color:${b.failed ? 'var(--bad)' : ''}">${b.failed}</td><td>${b.skipped}</td>
              <td><button class="btn sm ghost" data-batch="${b.batch}">Details</button></td></tr>`).join('')}</table></div>` : '<p class="muted">Nothing sent yet.</p>'}
          <div id="batchDetail"></div></div>
      </div>`;
    $$('[data-s]').forEach((i) => (i.onchange = run(async () => { await api('/settings', { method: 'PUT', body: { [i.dataset.s]: i.checked } }); toast('Saved'); })));
    $$('[data-batch]').forEach((b) => (b.onclick = run(async () => {
      const rows = await api('/notifications/' + b.dataset.batch);
      $('#batchDetail').innerHTML = `<h3 style="margin-top:16px">Delivery log</h3><div class="tablewrap" style="max-height:360px;overflow:auto"><table><tr><th>Person</th><th>Channel</th><th>Status</th><th>Note</th></tr>
        ${rows.map((r) => `<tr><td>${esc(r.name || '—')}</td><td>${r.channel}</td><td><span class="chip">${r.status}</span></td><td class="small muted">${esc(r.error || '')}</td></tr>`).join('')}</table></div>`;
    })));
  }
  function setPending(n) { const el = $('#pendCount'); if (el) { el.textContent = n; el.classList.toggle('hidden', !n); } }

  // ---------- attendees ----------
  async function renderAttendees() {
    const list = await api('/attendees');
    page().innerHTML = `<h2 class="page">Attendees <span class="muted" style="font-size:16px">${list.length}</span></h2>
      <div class="two">
        <div>
          <form class="card stack" id="addForm"><h3>Add one person</h3>
            <label class="field">Full name<input class="input" name="name" required></label>
            <label class="field">Email<input class="input" name="email" type="email"></label>
            <label class="field">Mobile (WhatsApp)<input class="input" name="phone" placeholder="98xxxxxxxx or +9198xxxxxxxx"></label>
            <label class="field">Company<input class="input" name="company"></label>
            <label class="field">Designation<input class="input" name="designation"></label>
            <button class="btn">Add attendee</button></form>
          <div class="card stack"><h3>Import from Excel / CSV</h3>
            <p class="muted small" style="margin:0">Save your sheet as CSV with columns <b>Name, Email, Phone, Company, Designation</b>. Existing people (same email or phone) are updated, not duplicated.</p>
            <input type="file" id="csvFile" accept=".csv,text/csv" class="input">
            <button class="btn secondary" id="importBtn">Import</button>
            <div id="importOut" class="small"></div></div>
        </div>
        <div class="card">
          <div class="row wrap"><input class="input" id="q" placeholder="Search" style="max-width:260px"><span class="spacer"></span>
            <button class="btn" id="inviteAll">📲 Send personal links to everyone</button></div>
          <p class="muted small">Each person gets a private link — no passwords needed. Send it once before the event; they can ask for it again from the microsite.</p>
          <div class="tablewrap"><table id="attTable"></table></div>
        </div>
      </div>`;
    const draw = (q = '') => {
      q = q.toLowerCase();
      const rows = list.filter((a) => `${a.name} ${a.email} ${a.phone} ${a.company}`.toLowerCase().includes(q));
      $('#attTable').innerHTML = `<tr><th>Name</th><th>Contact</th><th>Company</th><th>Last seen</th><th>Link</th><th></th></tr>` + rows.map((a) => `
        <tr><td><b>${esc(a.name)}</b><div class="muted small">${esc(a.designation || '')}</div></td>
          <td class="small">${esc(a.email || '—')}<br>${a.phone ? '+' + esc(a.phone) : '—'}</td>
          <td>${esc(a.company || '')}</td>
          <td class="small">${a.last_seen ? when(a.last_seen) : '<span class="muted">Not yet</span>'}</td>
          <td><button class="btn sm ghost" data-copy="${esc(a.link)}">Copy link</button></td>
          <td><div class="row"><button class="btn sm secondary" data-send="${a.id}">Send link</button>
            <button class="btn sm ghost" data-reset="${a.id}" title="Invalidate the old link">Reset</button>
            <button class="btn sm ghost" data-del="${a.id}" title="Remove">🗑</button></div></td></tr>`).join('');
      $$('[data-copy]').forEach((b) => (b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy); toast('Link copied'); }));
      $$('[data-send]').forEach((b) => (b.onclick = run(async () => { const n = await api('/send-links', { method: 'POST', body: { ids: [Number(b.dataset.send)] } }); toast('Sending.' + notified(n)); })));
      $$('[data-reset]').forEach((b) => (b.onclick = run(async () => { if (!confirm('Create a new link for this person? The old link stops working.')) return; await api(`/attendees/${b.dataset.reset}/reset-link`, { method: 'POST' }); toast('New link created — send it to them'); renderAttendees(); })));
      $$('[data-del]').forEach((b) => (b.onclick = run(async () => { if (!confirm('Remove this attendee and their answers, messages and uploads link?')) return; await api('/attendees/' + b.dataset.del, { method: 'DELETE' }); renderAttendees(); })));
    };
    draw();
    $('#q').oninput = (e) => draw(e.target.value);
    $('#addForm').onsubmit = run(async (e) => {
      e.preventDefault();
      const out = await api('/attendees', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      toast(out.created ? 'Attendee added' : 'Existing attendee updated'); renderAttendees();
    });
    $('#importBtn').onclick = run(async () => {
      const f = $('#csvFile').files[0]; if (!f) throw new Error('Choose a CSV file first');
      const out = await api('/attendees/import', { method: 'POST', body: await f.text(), headers: { 'Content-Type': 'text/csv' } });
      toast(`Imported: ${out.created} new, ${out.updated} updated`);
      if (out.errors.length) $('#importOut').innerHTML = `<b>Skipped ${out.errors.length} row(s):</b><br>${out.errors.map(esc).join('<br>')}`;
      else renderAttendees();
    });
    $('#inviteAll').onclick = run(async () => {
      if (!confirm(`Send the personal microsite link to all ${list.length} attendees on WhatsApp and email?`)) return;
      const n = await api('/send-links', { method: 'POST', body: {} });
      toast('Invites queued.' + notified(n));
    });
  }

  // ---------- updates ----------
  async function renderUpdates() {
    const posts = await api('/posts');
    page().innerHTML = `<h2 class="page">Updates & videos</h2>
      <div class="two">
        <form class="card stack" id="postForm"><h3>Post an update</h3>
          <label class="field">Headline<input class="input" name="title" required placeholder="e.g. Watch: Opening keynote highlights"></label>
          <label class="field">Message<textarea class="input" name="body" rows="4"></textarea></label>
          <label class="field">Photo or video (optional)<input class="input" type="file" name="media" accept="image/*,video/*"></label>
          <label class="field">Or a link — YouTube links play inside the page<input class="input" name="link_url" placeholder="https://"></label>
          <label class="toggle"><input type="checkbox" name="pinned"> Pin to top</label>
          <label class="toggle"><input type="checkbox" name="notify" checked> Notify all attendees</label>
          <div class="row" style="padding-left:28px"><label class="toggle"><input type="checkbox" name="ch_whatsapp" checked> WhatsApp</label><label class="toggle"><input type="checkbox" name="ch_email" checked> Email</label></div>
          <button class="btn" id="postBtn">Publish</button>
          <div class="progress hidden" id="pprog"><div></div></div>
        </form>
        <div>${posts.map((p) => `<div class="card post ${p.pinned ? 'pinned' : ''}">
            <div class="row"><span class="muted small">${when(p.created_at)}${p.media_type ? ' · ' + p.media_type : ''}</span><span class="spacer"></span>
              <button class="btn sm ghost" data-pin="${p.id}" data-v="${p.pinned ? 0 : 1}">${p.pinned ? 'Unpin' : 'Pin'}</button>
              <button class="btn sm ghost" data-del="${p.id}">Delete</button></div>
            <h3>${esc(p.title)}</h3>${p.body ? `<div class="body small">${esc(p.body)}</div>` : ''}
            ${p.media_type === 'image' ? `<div class="media"><img src="/uploads/${esc(p.media_path)}"></div>` : ''}
            ${p.media_type === 'video' ? `<div class="media"><video src="/uploads/${esc(p.media_path)}" controls preload="metadata"></video></div>` : ''}
            ${p.link_url ? `<div class="small"><a href="${esc(p.link_url)}" target="_blank">${esc(p.link_url)}</a></div>` : ''}
          </div>`).join('') || '<div class="card empty">No updates yet.</div>'}</div>
      </div>`;
    const form = $('#postForm');
    form.onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      fd.set('pinned', form.pinned.checked); fd.set('notify', form.notify.checked);
      fd.set('channels', [form.ch_whatsapp.checked && 'whatsapp', form.ch_email.checked && 'email'].filter(Boolean).join(','));
      fd.delete('ch_whatsapp'); fd.delete('ch_email');
      if (!form.media.files.length) fd.delete('media');
      const xhr = new XMLHttpRequest(); const prog = $('#pprog'); prog.classList.remove('hidden'); $('#postBtn').disabled = true;
      xhr.upload.onprogress = (ev) => ev.lengthComputable && (prog.firstElementChild.style.width = (ev.loaded / ev.total) * 100 + '%');
      xhr.onload = () => {
        const out = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 400) { toast(out.error || 'Failed', true); $('#postBtn').disabled = false; return; }
        toast('Published.' + notified(out.notification)); renderUpdates();
      };
      xhr.open('POST', '/api/admin/posts'); xhr.setRequestHeader('x-admin', adminToken); xhr.send(fd);
    };
    $$('[data-pin]').forEach((b) => (b.onclick = run(async () => { await api('/posts/' + b.dataset.pin, { method: 'PATCH', body: { pinned: b.dataset.v === '1' } }); renderUpdates(); })));
    $$('[data-del]').forEach((b) => (b.onclick = run(async () => { if (!confirm('Delete this update?')) return; await api('/posts/' + b.dataset.del, { method: 'DELETE' }); renderUpdates(); })));
  }

  // ---------- quizzes & polls ----------
  async function renderEngage(arg) {
    if (arg === 'new') return renderBuilder();
    if (arg && arg.startsWith('edit-')) return renderBuilder(Number(arg.slice(5)));
    if (arg) return renderResults(Number(arg));
    const acts = await api('/activities');
    page().innerHTML = `<h2 class="page">Quizzes & polls</h2>
      <div class="row wrap" style="margin-bottom:14px"><a class="btn" href="#engage/new">＋ New quiz or poll</a><a class="btn ghost" href="#engage/leaderboard">🏅 Overall leaderboard</a></div>
      <div class="card tablewrap"><table><tr><th>Title</th><th>Type</th><th>Status</th><th>Questions</th><th>Responses</th><th></th></tr>
        ${acts.map((a) => `<tr><td><a href="#engage/${a.id}"><b>${esc(a.title)}</b></a></td><td>${a.kind}</td>
          <td><span class="pill ${a.status === 'live' ? 'live' : a.status === 'closed' ? '' : 'gold'}">${a.status}</span></td>
          <td>${a.question_count}</td><td>${a.participants}</td>
          <td><div class="row wrap">
            ${a.status !== 'live' ? `<button class="btn sm" data-live="${a.id}">Go live</button>` : `<button class="btn sm secondary" data-close="${a.id}">Close</button>`}
            <a class="btn sm ghost" href="#engage/${a.id}">Results</a>
            ${a.participants ? '' : `<a class="btn sm ghost" href="#engage/edit-${a.id}">Edit</a>`}
            <button class="btn sm ghost" data-del="${a.id}">🗑</button></div></td></tr>`).join('') || '<tr><td colspan="6" class="muted">None yet.</td></tr>'}
      </table></div>`;
    $$('[data-live]').forEach((b) => (b.onclick = run(async () => {
      const notify = confirm('Go live now.\n\nOK = also notify everyone on WhatsApp + email\nCancel = go live quietly (only people on the site see it)');
      const out = await api(`/activities/${b.dataset.live}/status`, { method: 'POST', body: { status: 'live', notify } });
      toast('It’s live.' + notified(out.notification)); renderEngage();
    })));
    $$('[data-close]').forEach((b) => (b.onclick = run(async () => { await api(`/activities/${b.dataset.close}/status`, { method: 'POST', body: { status: 'closed' } }); toast('Closed'); renderEngage(); })));
    $$('[data-del]').forEach((b) => (b.onclick = run(async () => { if (!confirm('Delete this and all its answers?')) return; await api('/activities/' + b.dataset.del, { method: 'DELETE' }); renderEngage(); })));
  }

  // Drag a box over the artwork to mark its button; stored as percentages so it fits any screen size.
  function markButton(pick, box, model) {
    const show = (b) => { Object.assign(box.style, { left: b.x + '%', top: b.y + '%', width: b.w + '%', height: b.h + '%' }); box.classList.remove('hidden'); };
    if (model.cta_box) show(model.cta_box);
    let start = null;
    const pct = (e) => {
      const r = pick.getBoundingClientRect();
      return { x: Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)), y: Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)) };
    };
    const boxFrom = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
    pick.onpointerdown = (e) => { e.preventDefault(); start = pct(e); pick.setPointerCapture(e.pointerId); };
    pick.onpointermove = (e) => { if (start) show(boxFrom(start, pct(e))); };
    pick.onpointerup = (e) => {
      if (!start) return;
      const b = boxFrom(start, pct(e));
      start = null;
      if (b.w < 2 || b.h < 1) { if (!model.cta_box) box.classList.add('hidden'); else show(model.cta_box); return; } // a click, not a drag
      model.cta_box = b;
    };
  }

  async function renderBuilder(id) {
    let model = { kind: 'quiz', title: '', description: '', image_path: null, questions: [{ qtype: 'choice', text: '', options: ['', '', '', ''], correct_index: null, points: 1 }] };
    let artFile = null, artUrl = null, artRemove = false; // artwork picked in this editor, uploaded on save
    if (id) {
      const d = await api('/activities/' + id);
      model = { kind: d.activity.kind, title: d.activity.title, description: d.activity.description || '', image_path: d.activity.image_path, cta_box: d.activity.cta_box ? JSON.parse(d.activity.cta_box) : null, questions: d.questions.map((q) => ({ qtype: q.qtype, text: q.text, options: q.options, correct_index: q.correct_index, points: q.points })) };
    }
    const draw = () => {
      page().innerHTML = `<a href="#engage" class="small">← Back</a><h2 class="page" style="margin-top:8px">${id ? 'Edit' : 'New'} ${model.kind}</h2>
        <div class="card stack">
          <div class="formgrid">
            <label class="field">Type<select class="input" id="kind" ${id ? 'disabled' : ''}><option value="quiz">Quiz — has right answers, picks a winner</option><option value="poll">Poll — opinions, shows the top choice</option></select></label>
            <label class="field">Title<input class="input" id="title" value="${esc(model.title)}"></label>
            <label class="field full">Short description (optional)<input class="input" id="desc" value="${esc(model.description)}"></label>
            <div class="field full">Artwork (optional)
              <div class="row wrap" style="margin-top:6px">
                <input type="file" id="art" accept="image/png,image/jpeg,image/webp">
                ${artSrc() ? '<button class="btn sm ghost" id="artRm">Remove artwork</button>' : ''}
              </div>
              ${artSrc() ? `<div class="muted small" style="margin:8px 0 6px"><b>Make its button glow:</b> drag a box over the button in the artwork. ${model.cta_box ? '<button class="btn sm ghost" id="ctaClear">Clear box</button>' : ''}</div>
                <div class="cta-pick" id="ctaPick"><img src="${esc(artSrc())}" alt="" draggable="false"><span class="cta-box ${model.cta_box ? '' : 'hidden'}" id="ctaBox"></span></div>`
                : '<div class="muted small" style="margin-top:4px">Shown at the top of the page; guests tap it to open the answer box. Portrait images work best on phones.</div>'}
            </div>
          </div>
          <div id="qs">${model.questions.map((q, i) => `
            <div class="qedit" data-i="${i}">
              <div class="row"><b>Q${i + 1}</b><select class="input" data-f="qtype" style="max-width:190px"><option value="choice" ${q.qtype === 'choice' ? 'selected' : ''}>Multiple choice</option><option value="text" ${q.qtype === 'text' ? 'selected' : ''}>Open text answer</option></select>
                ${(model.kind === 'quiz' && q.qtype === 'choice') || q.qtype === 'text' ? `<label class="small muted">${q.qtype === 'text' ? 'Points for answering' : 'Points'} <input class="input" data-f="points" type="number" min="1" value="${q.points}" style="width:70px;display:inline-block"></label>` : ''}
                <span class="spacer"></span>${model.questions.length > 1 ? '<button class="btn sm ghost" data-rm>Remove</button>' : ''}</div>
              <input class="input" data-f="text" placeholder="Question" value="${esc(q.text)}" style="margin-top:8px">
              ${q.qtype === 'choice' ? `${q.options.map((o, oi) => `<div class="optrow">
                  ${model.kind === 'quiz' ? `<input type="radio" name="c${i}" data-correct="${oi}" ${q.correct_index === oi ? 'checked' : ''} title="Correct answer">` : `<span class="muted small" style="width:18px">${String.fromCharCode(65 + oi)}</span>`}
                  <input class="input" data-opt="${oi}" value="${esc(o)}" placeholder="Option ${String.fromCharCode(65 + oi)}">
                  ${q.options.length > 2 ? `<button class="btn sm ghost" data-rmopt="${oi}">✕</button>` : ''}</div>`).join('')}
                ${q.options.length < 8 ? '<button class="btn sm ghost" data-addopt style="margin-top:8px">＋ Option</button>' : ''}
                ${model.kind === 'quiz' ? '<div class="muted small" style="margin-top:6px">Tick the circle next to the correct answer.</div>' : ''}` : ''}
            </div>`).join('')}</div>
          <div class="row wrap"><button class="btn ghost" id="addQ">＋ Add question</button><span class="spacer"></span><button class="btn" id="save">${id ? 'Save changes' : 'Save as draft'}</button></div>
        </div>`;
      $('#art').onchange = (e) => {
        sync(); artFile = e.target.files[0] || null; artRemove = false; model.cta_box = null;
        if (artUrl) URL.revokeObjectURL(artUrl);
        artUrl = artFile && URL.createObjectURL(artFile); draw();
      };
      $('#artRm') && ($('#artRm').onclick = () => { sync(); artFile = null; artRemove = true; model.cta_box = null; draw(); });
      $('#ctaClear') && ($('#ctaClear').onclick = () => { sync(); model.cta_box = null; draw(); });
      if ($('#ctaPick')) markButton($('#ctaPick'), $('#ctaBox'), model);
      $('#kind').value = model.kind;
      $('#kind').onchange = (e) => { sync(); model.kind = e.target.value; draw(); };
      $('#addQ').onclick = () => { sync(); model.questions.push({ qtype: 'choice', text: '', options: ['', '', '', ''], correct_index: null, points: 1 }); draw(); };
      $$('.qedit').forEach((el) => {
        const i = Number(el.dataset.i);
        $('[data-f=qtype]', el).onchange = (e) => { sync(); model.questions[i].qtype = e.target.value; if (e.target.value === 'choice' && model.questions[i].options.length < 2) model.questions[i].options = ['', '']; draw(); };
        $('[data-rm]', el) && ($('[data-rm]', el).onclick = () => { sync(); model.questions.splice(i, 1); draw(); });
        $('[data-addopt]', el) && ($('[data-addopt]', el).onclick = () => { sync(); model.questions[i].options.push(''); draw(); });
        $$('[data-rmopt]', el).forEach((b) => (b.onclick = () => {
          sync(); const oi = Number(b.dataset.rmopt); const q = model.questions[i]; q.options.splice(oi, 1);
          if (q.correct_index === oi) q.correct_index = null; else if (q.correct_index > oi) q.correct_index--; draw();
        }));
      });
      $('#save').onclick = run(async () => {
        sync();
        const body = { kind: model.kind, title: model.title, description: model.description, questions: model.questions };
        let actId = id;
        if (id) await api('/activities/' + id, { method: 'PUT', body }); else actId = (await api('/activities', { method: 'POST', body })).id;
        if (artFile) {
          const fd = new FormData(); fd.append('image', artFile);
          await api(`/activities/${actId}/image`, { method: 'POST', body: fd });
        } else if (artRemove && model.image_path) await api(`/activities/${actId}/image`, { method: 'DELETE' });
        if (artSrc()) await api(`/activities/${actId}/cta`, { method: 'PUT', body: { cta_box: model.cta_box } });
        toast('Saved. Use “Go live” when you’re ready.'); location.hash = '#engage';
      });
    };
    function artSrc() { return artFile ? artUrl : model.image_path && !artRemove ? '/uploads/' + model.image_path : null; }
    function sync() {
      model.title = $('#title').value; model.description = $('#desc').value;
      $$('.qedit').forEach((el) => {
        const q = model.questions[Number(el.dataset.i)];
        q.text = $('[data-f=text]', el).value;
        if ($('[data-f=points]', el)) q.points = Number($('[data-f=points]', el).value) || 1;
        $$('[data-opt]', el).forEach((o) => (q.options[Number(o.dataset.opt)] = o.value));
        const c = $('[data-correct]:checked', el); q.correct_index = c ? Number(c.dataset.correct) : null;
      });
    }
    draw();
  }

  async function renderResults(id) {
    if (Number.isNaN(id)) return renderLeaderboard();
    const r = await api(`/activities/${id}/results`);
    const a = r.activity;
    const fmtS = (ms) => (ms / 1000).toFixed(1) + 's';
    page().innerHTML = `<a href="#engage" class="small">← All quizzes & polls</a>
      <div class="row wrap" style="margin:8px 0 16px"><h2 class="page" style="margin:0">${esc(a.title)}</h2><span class="pill ${a.status === 'live' ? 'live' : ''}">${a.status}</span><span class="spacer"></span>
        ${a.status !== 'live' ? `<button class="btn sm" id="goLive">Go live</button>` : `<button class="btn sm secondary" id="closeIt">Close</button>`}
        <button class="btn sm ${a.results_visible ? 'ghost' : 'secondary'}" id="reveal">${a.results_visible ? 'Hide results from guests' : '🎉 Reveal results to guests'}</button>
        <a class="btn sm ghost" href="/api/admin/activities/${a.id}/results.csv?a=${encodeURIComponent(adminToken)}">⬇ Export CSV</a>
        <button class="btn sm ghost" id="refresh">↻</button></div>
      <div class="stats">
        <div class="stat"><b>${r.participants}</b><span>Responded</span></div>
        <div class="stat"><b>${r.participationPercent}%</b><span>of ${r.totalAttendees} attendees</span></div>
        ${a.kind === 'quiz' ? `<div class="stat"><b>${r.rankings.filter((x) => x.score === r.maxScore).length}</b><span>Got everything right (${r.maxScore}/${r.maxScore})</span></div>` : ''}
      </div>
      ${a.kind === 'quiz' ? (r.winner ? `<div class="winner" style="margin-top:16px"><div class="trophy">🏆</div><div><div class="muted small">Winner</div><h3 style="font-size:22px">${esc(r.winner.name)}</h3>
          <div class="muted">${esc(r.winner.company || '')} · ${r.winner.score}/${r.maxScore} points in ${fmtS(r.winner.duration_ms)}</div></div></div>` : '<div class="card muted" style="margin-top:16px">No winner yet — waiting for answers.</div>') : ''}
      <div class="two" style="margin-top:16px">
        ${a.kind === 'quiz' || r.maxScore > 0 ? `<div class="card"><h3>Ranking</h3><p class="muted small">${a.kind === 'quiz' ? 'Highest score first; ties broken by fastest time.' : 'Points for answering; these count on the overall leaderboard.'}</p>
          <div class="tablewrap" style="max-height:540px;overflow:auto"><table><tr><th>#</th><th>Name</th><th>Score</th><th>Time</th></tr>
          ${r.rankings.map((x) => `<tr><td>${x.rank}</td><td><b>${esc(x.name)}</b><div class="muted small">${esc(x.company || '')}</div></td><td>${x.score}/${r.maxScore}</td><td>${fmtS(x.duration_ms)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No responses yet</td></tr>'}
          </table></div></div>` : ''}
        <div ${a.kind === 'poll' && !(r.maxScore > 0) ? 'style="grid-column:1/-1"' : ''}>${r.questions.map((q, i) => `<div class="card">
          <div class="row wrap"><b>Q${i + 1}. ${esc(q.text)}</b><span class="spacer"></span><span class="muted small">${q.responses} response${q.responses === 1 ? '' : 's'}</span></div>
          ${q.correctPercent != null ? `<div class="pill ok" style="margin-top:6px">${q.correctCount} answered correctly · ${q.correctPercent}%</div>` : ''}
          ${q.qtype === 'choice' && a.kind === 'poll' && q.topOptions.length ? `<div class="pill gold" style="margin-top:6px">Most votes: ${q.topOptions.map((x) => esc(q.options[x])).join(' & ')}</div>` : ''}
          ${q.qtype === 'choice' ? q.options.map((o, oi) => `<div class="chartbar ${q.correct_index === oi ? 'correct' : ''}"><div style="width:${q.percents[oi]}%"></div>
              <span>${String.fromCharCode(65 + oi)}. ${esc(o)} ${q.correct_index === oi ? '✓' : ''}</span><em>${q.counts[oi]} · ${q.percents[oi]}%</em></div>`).join('')
            : `<div class="tablewrap" style="max-height:420px;overflow:auto;margin-top:8px"><table><tr><th>Name</th><th>Answer</th><th>Points</th></tr>
                ${(q.textAnswers || []).map((t) => `<tr><td><b>${esc(t.name)}</b><div class="muted small">${esc(t.company || '')}</div></td><td>“${esc(t.text)}”</td><td>+${q.points}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No answers yet</td></tr>'}
              </table></div>`}
        </div>`).join('')}</div>
      </div>`;
    $('#refresh').onclick = () => renderResults(id);
    $('#goLive') && ($('#goLive').onclick = run(async () => {
      const notify = confirm('OK = also notify everyone on WhatsApp + email\nCancel = go live quietly');
      const out = await api(`/activities/${id}/status`, { method: 'POST', body: { status: 'live', notify } }); toast('Live.' + notified(out.notification)); renderResults(id);
    }));
    $('#closeIt') && ($('#closeIt').onclick = run(async () => { await api(`/activities/${id}/status`, { method: 'POST', body: { status: 'closed' } }); renderResults(id); }));
    $('#reveal').onclick = run(async () => {
      const visible = !a.results_visible;
      const notify = visible && confirm('Reveal results.\n\nOK = also announce the results on WhatsApp + email\nCancel = show on the site only');
      const out = await api(`/activities/${id}/reveal`, { method: 'POST', body: { visible, notify } });
      toast(visible ? 'Results are visible to guests.' + notified(out.notification) : 'Results hidden'); renderResults(id);
    });
    clearTimeout(renderResults.t);
    if (a.status === 'live') renderResults.t = setTimeout(() => location.hash === `#engage/${id}` && renderResults(id), 10000);
  }

  // ---------- spin the wheel ----------
  async function renderWheels(arg) {
    const wheels = await api('/wheels');
    if (arg === 'new') return wheelEditor();
    if (arg && arg.startsWith('edit-')) return wheelEditor(wheels.find((w) => w.id === Number(arg.slice(5))));
    if (arg) return wheelWinners(wheels.find((w) => w.id === Number(arg)));
    const stock = (w) => w.prizes.map((p) => `${esc(p.label)}${p.qty == null ? '' : ` <span class="muted">(${p.left}/${p.qty} left)</span>`}`).join(' · ');
    page().innerHTML = `<h2 class="page">Spin the wheel</h2>
      <p class="muted" style="margin-top:-6px">Each guest gets one spin per wheel. The server picks where it lands, choosing only from segments that still have stock, so limited prizes never run over.</p>
      <div class="row wrap" style="margin-bottom:14px"><a class="btn" href="#wheels/new">＋ New wheel</a></div>
      <div class="card tablewrap"><table><tr><th>Wheel</th><th>Status</th><th>Segments</th><th>Spins</th><th></th></tr>
        ${wheels.map((w) => `<tr><td><a href="#wheels/${w.id}"><b>${esc(w.title)}</b></a></td>
          <td><span class="pill ${w.status === 'live' ? 'live' : w.status === 'closed' ? '' : 'gold'}">${w.status}</span></td>
          <td class="small">${stock(w)}</td><td>${w.spins}</td>
          <td><div class="row wrap">
            ${w.status !== 'live' ? `<button class="btn sm" data-live="${w.id}">Go live</button>` : `<button class="btn sm secondary" data-close="${w.id}">Close</button>`}
            <a class="btn sm ghost" href="#wheels/${w.id}">Winners</a>
            <a class="btn sm ghost" href="#wheels/edit-${w.id}">Edit</a>
            <button class="btn sm ghost" data-del="${w.id}" title="Delete">🗑</button></div></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No wheels yet.</td></tr>'}
      </table></div>`;
    $$('[data-live]').forEach((b) => (b.onclick = run(async () => {
      const notify = confirm('Open this wheel now.\n\nOK = also notify everyone on WhatsApp + email\nCancel = open quietly (only people on the site see it)');
      const out = await api(`/wheels/${b.dataset.live}/status`, { method: 'POST', body: { status: 'live', notify } });
      toast('The wheel is live.' + notified(out.notification)); renderWheels();
    })));
    $$('[data-close]').forEach((b) => (b.onclick = run(async () => { await api(`/wheels/${b.dataset.close}/status`, { method: 'POST', body: { status: 'closed' } }); toast('Closed'); renderWheels(); })));
    $$('[data-del]').forEach((b) => (b.onclick = run(async () => { if (!confirm('Delete this wheel and its list of winners?')) return; await api('/wheels/' + b.dataset.del, { method: 'DELETE' }); renderWheels(); })));
  }

  function wheelEditor(w) {
    const spun = w ? w.spins > 0 : false;
    const m = w ? { title: w.title, description: w.description || '', prizes: w.prizes.map((p) => ({ label: p.label, qty: p.qty, win: p.win !== false })) }
      : { title: 'Lucky Spin', description: '', prizes: [
        { label: 'Goa Goodie Bag', qty: 20, win: true }, { label: 'Better luck next time', qty: null, win: false },
        { label: 'Spa Voucher', qty: 5, win: true }, { label: 'Try again later', qty: null, win: false },
        { label: 'Coffee Mug', qty: 30, win: true }, { label: 'Smart Watch', qty: 1, win: true }] };
    const draw = () => {
      page().innerHTML = `<a href="#wheels" class="small">← Back</a><h2 class="page" style="margin-top:8px">${w ? 'Edit' : 'New'} wheel</h2>
        <div class="card stack">
          <div class="formgrid">
            <label class="field">Title<input class="input" id="wTitle" value="${esc(m.title)}" maxlength="80"></label>
            <label class="field">Short description (optional)<input class="input" id="wDesc" value="${esc(m.description)}" maxlength="200" placeholder="e.g. Collect prizes at the help desk"></label>
          </div>
          <div><b>Segments</b> <span class="muted small">2–12, shown in this order around the wheel.</span>
            ${spun ? '<div class="warn" style="margin-top:6px">People have already spun this wheel, so you can rename segments and change quantities but not add or remove them.</div>' : ''}</div>
          <table><tr><th>Label</th><th>How many</th><th>Counts as a prize</th><th></th></tr>
            ${m.prizes.map((p, i) => `<tr data-i="${i}">
              <td><input class="input" data-f="label" value="${esc(p.label)}" maxlength="40"></td>
              <td><input class="input" data-f="qty" type="number" min="0" value="${p.qty ?? ''}" placeholder="Unlimited" style="max-width:120px"></td>
              <td><input type="checkbox" data-f="win" ${p.win ? 'checked' : ''} style="width:18px;height:18px"></td>
              <td>${!spun && m.prizes.length > 2 ? '<button class="btn sm ghost" data-rm title="Remove">✕</button>' : ''}</td></tr>`).join('')}
          </table>
          <div class="muted small">Leave <i>How many</i> empty for no limit (good for "Better luck next time"). Untick <i>Counts as a prize</i> for segments that aren't a win, so they stay out of the winners list. Once a prize runs out, the wheel stops landing on it.</div>
          <div class="row wrap">${!spun && m.prizes.length < 12 ? '<button class="btn ghost" id="addSeg">＋ Add segment</button>' : ''}<span class="spacer"></span><button class="btn" id="saveWheel">${w ? 'Save changes' : 'Save as draft'}</button></div>
        </div>`;
      const sync = () => {
        m.title = $('#wTitle').value; m.description = $('#wDesc').value;
        $$('tr[data-i]').forEach((tr) => {
          const p = m.prizes[Number(tr.dataset.i)];
          p.label = $('[data-f=label]', tr).value;
          p.qty = $('[data-f=qty]', tr).value === '' ? null : Number($('[data-f=qty]', tr).value);
          p.win = $('[data-f=win]', tr).checked;
        });
      };
      $('#addSeg') && ($('#addSeg').onclick = () => { sync(); m.prizes.push({ label: '', qty: null, win: true }); draw(); });
      $$('[data-rm]').forEach((b) => (b.onclick = () => { sync(); m.prizes.splice(Number(b.closest('tr').dataset.i), 1); draw(); }));
      $('#saveWheel').onclick = run(async () => {
        sync();
        if (w) await api('/wheels/' + w.id, { method: 'PUT', body: m }); else await api('/wheels', { method: 'POST', body: m });
        toast(w ? 'Saved' : 'Saved. Use “Go live” when you’re ready.'); location.hash = '#wheels';
      });
    };
    draw();
  }

  async function wheelWinners(w) {
    if (!w) { location.hash = '#wheels'; return; }
    const spins = await api(`/wheels/${w.id}/spins`);
    const winners = spins.filter((s) => s.win);
    page().innerHTML = `<a href="#wheels" class="small">← Back</a><h2 class="page" style="margin-top:8px">${esc(w.title)}</h2>
      <div class="stats" style="margin-bottom:14px">
        <div class="stat"><b>${spins.length}</b><span>spins</span></div>
        <div class="stat"><b>${winners.length}</b><span>prizes won</span></div>
        ${w.prizes.filter((p) => p.qty != null).map((p) => `<div class="stat"><b>${p.left}/${p.qty}</b><span>${esc(p.label)} left</span></div>`).join('')}
      </div>
      <div class="card tablewrap"><h3 style="margin-bottom:8px">Winners</h3><table><tr><th>Prize</th><th>Name</th><th>Company</th><th>Phone</th><th>Email</th><th>When</th></tr>
        ${winners.map((s) => `<tr><td><b>${esc(s.label)}</b></td><td>${esc(s.name)}</td><td>${esc(s.company || '')}</td><td>${esc(s.phone || '')}</td><td>${esc(s.email || '')}</td><td>${when(s.spun_at)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No winners yet.</td></tr>'}
      </table></div>`;
  }

  // ---------- lucky draw ----------
  async function renderDraws() {
    const draws = await api('/draws');
    const showOnScreen = (id) => api('/screen', { method: 'POST', body: { mode: 'draw', id } });
    page().innerHTML = `<h2 class="page">Lucky draw</h2>
      <p class="muted" style="margin-top:-6px">The server picks winners at random. Only checked-in guests can win (unless you untick it), and nobody can win two draws. Put the draw on the LED screen first, then press Draw: the names shuffle on the wall and land on the winner.</p>
      <form class="card stack" id="dForm" style="margin-bottom:14px"><h3>New draw</h3>
        <div class="formgrid">
          <label class="field">Prize / draw name<input class="input" name="title" required maxlength="80" placeholder="e.g. Weekend for two in Goa"></label>
          <label class="field">Number of winners<input class="input" name="winners_count" type="number" min="1" max="50" value="1" required></label>
        </div>
        <label class="row small"><input type="checkbox" name="checked_in_only" checked style="width:18px;height:18px"> Only guests who have checked in at the event</label>
        <div class="row"><span class="spacer"></span><button class="btn">Create draw</button></div></form>
      ${draws.map((d) => {
        const won = d.winners.filter((w) => w.status === 'won');
        const left = d.winners_count - won.length;
        return `<div class="card stack" style="margin-bottom:12px">
          <div class="row wrap"><h3>🎁 ${esc(d.title)}</h3><span class="muted small">${won.length}/${d.winners_count} drawn · ${d.pool} can still win${d.checked_in_only ? ' (checked in)' : ''}</span><span class="spacer"></span>
            <button class="btn sm secondary" data-screen="${d.id}">📺 Show on LED</button>
            ${left > 0 ? `<button class="btn sm" data-draw="${d.id}">${won.length ? `Draw ${left} more` : 'Draw'}</button>` : ''}
            <button class="btn sm ghost" data-del="${d.id}" title="Delete">🗑</button></div>
          ${d.winners.length ? `<table><tr><th>Winner</th><th>Company</th><th>Phone</th><th></th></tr>${d.winners.map((w) => `<tr style="${w.status === 'absent' ? 'opacity:.5;text-decoration:line-through' : ''}">
            <td><b>${esc(w.name)}</b></td><td>${esc(w.company || '')}</td><td>${esc(w.phone || '')}</td>
            <td>${w.status === 'won' ? `<button class="btn sm ghost" data-absent="${d.id}/${w.attendee_id}">Not here: redraw</button>` : 'absent'}</td></tr>`).join('')}</table>` : ''}
        </div>`;
      }).join('') || '<div class="card muted">No draws yet.</div>'}`;
    $('#dForm').onsubmit = run(async (e) => {
      e.preventDefault();
      const f = e.target;
      const { id } = await api('/draws', { method: 'POST', body: { title: f.title.value, winners_count: Number(f.winners_count.value), checked_in_only: f.checked_in_only.checked } });
      if (confirm('Draw created. Put it on the LED screen now?')) await showOnScreen(id);
      renderDraws();
    });
    $$('[data-screen]').forEach((b) => (b.onclick = run(async () => { await showOnScreen(Number(b.dataset.screen)); toast('On the LED screen now'); })));
    $$('[data-draw]').forEach((b) => (b.onclick = run(async () => {
      const out = await api(`/draws/${b.dataset.draw}/draw`, { method: 'POST' });
      toast('Winner: ' + out.picked.join(', ')); renderDraws();
    })));
    $$('[data-absent]').forEach((b) => (b.onclick = run(async () => {
      if (!confirm('Mark this winner as not here? Then press Draw to pick a replacement.')) return;
      await api('/draws/' + b.dataset.absent.replace('/', '/absent/'), { method: 'POST' }); renderDraws();
    })));
    $$('[data-del]').forEach((b) => (b.onclick = run(async () => { if (!confirm('Delete this draw and its winners?')) return; await api('/draws/' + b.dataset.del, { method: 'DELETE' }); renderDraws(); })));
  }

  // ---------- Star Spotlight ----------
  async function renderStars() {
    const stars = await api('/stars');
    const pending = stars.filter((s) => s.status === 'pending');
    const setStatus = (ids, status) => api('/stars/status', { method: 'POST', body: { ids, status } });
    const row = (s) => `<tr><td><b>${esc(s.to_name)}</b><div class="muted small">from ${esc(s.from_name)} · ${when(s.created_at)}</div></td><td>${esc(s.message)}</td>
      <td><div class="row">${s.status !== 'approved' ? `<button class="btn sm" data-set="approved" data-id="${s.id}">Approve</button>` : ''}${s.status !== 'rejected' ? `<button class="btn sm ghost" data-set="rejected" data-id="${s.id}">Hide</button>` : ''}</div></td></tr>`;
    const table = (list, empty) => `<div class="card tablewrap"><table><tr><th>To</th><th>Message</th><th></th></tr>${list.map(row).join('') || `<tr><td colspan="3" class="muted">${empty}</td></tr>`}</table></div>`;
    page().innerHTML = `<h2 class="page">Star Spotlight</h2>
      <p class="muted" style="margin-top:-6px">Guests send appreciation messages to colleagues from the Play tab. Nothing is shown until you approve it; once you do, the colleague is told straight away. Approved stars rotate on the LED screen.</p>
      <div class="row wrap" style="margin:14px 0 8px"><h3>Waiting for approval (${pending.length})</h3><span class="spacer"></span>
        ${pending.length ? '<button class="btn sm" id="approveAll">Approve all</button>' : ''}
        <button class="btn sm secondary" id="starScreen">📺 Show on LED</button></div>
      ${table(pending, 'Nothing waiting.')}
      <h3 style="margin:18px 0 8px">Approved</h3>${table(stars.filter((s) => s.status === 'approved'), 'None yet.')}
      <h3 style="margin:18px 0 8px">Hidden</h3>${table(stars.filter((s) => s.status === 'rejected'), 'None.')}`;
    $('#approveAll') && ($('#approveAll').onclick = run(async () => { await setStatus(pending.map((s) => s.id), 'approved'); toast('Approved'); renderStars(); }));
    $('#starScreen').onclick = run(async () => { await api('/screen', { method: 'POST', body: { mode: 'spotlight' } }); toast('On the LED screen now'); });
    $$('[data-set]').forEach((b) => (b.onclick = run(async () => { await setStatus([Number(b.dataset.id)], b.dataset.set); renderStars(); })));
  }

  // ---------- LED screen ----------
  async function renderScreen() {
    const [cur, acts, wheels, draws] = await Promise.all([api('/screen'), api('/activities'), api('/wheels'), api('/draws')]);
    const on = (mode, id = null) => cur.mode === mode && (cur.id ?? null) === id;
    const btn = (label, mode, id = null) => on(mode, id)
      ? '<span class="pill live">On screen</span>'
      : `<button class="btn sm" data-mode="${mode}" ${id ? `data-id="${id}"` : ''}>${label}</button>`;
    const shown = acts.filter((a) => a.status !== 'draft');
    page().innerHTML = `<h2 class="page">LED screen</h2>
      <p class="muted" style="margin-top:-6px">Open the screen page on the laptop connected to the LED wall, sign in once and press Full screen. Whatever you pick here appears on it within 2 seconds, and results update live as people vote.</p>
      <div class="row wrap" style="margin-bottom:14px"><a class="btn secondary" href="/live/screen" target="_blank">📺 Open the screen page</a></div>
      <div class="card tablewrap"><table>
        <tr><td><b>Welcome</b><div class="muted small">Event artwork with what's on now and next</div></td><td>${btn('Show', 'welcome')}</td></tr>
        <tr><td><b>Arrivals</b><div class="muted small">Live check-in count and the latest names</div></td><td>${btn('Show', 'arrivals')}</td></tr>
        <tr><td><b>Overall leaderboard</b><div class="muted small">Top 10 across every quiz</div></td><td>${btn('Show', 'leaderboard')}</td></tr>
        <tr><td><b>⭐ Star Spotlight</b><div class="muted small">Approved appreciation messages, one at a time</div></td><td>${btn('Show', 'spotlight')}</td></tr>
        ${draws.map((d) => `<tr><td><b>🎁 ${esc(d.title)}</b><div class="muted small">Lucky draw · press Draw on the Lucky draw page</div></td><td>${btn('Show', 'draw', d.id)}</td></tr>`).join('')}
        ${shown.map((a) => `<tr><td><b>${a.kind === 'quiz' ? '🏆' : '📊'} ${esc(a.title)}</b> <span class="pill ${a.status === 'live' ? 'live' : ''}">${a.status}</span>
          <div class="muted small">${a.kind === 'quiz' ? (a.status === 'closed' ? 'Shows the winners' : 'Shows how many are playing; the winners appear once you close it') : 'Live vote results'} · ${a.participants} taken part</div></td>
          <td>${btn('Show results', 'activity', a.id)}</td></tr>`).join('')}
        ${wheels.filter((w) => w.status !== 'draft').map((w) => `<tr><td><b>🎡 ${esc(w.title)}</b><div class="muted small">Latest prize winners · ${w.spins} spins</div></td><td>${btn('Show winners', 'wheel', w.id)}</td></tr>`).join('')}
      </table></div>
      ${shown.length ? '' : '<p class="muted small">Quizzes and polls appear here once they are live.</p>'}`;
    $$('[data-mode]').forEach((b) => (b.onclick = run(async () => {
      await api('/screen', { method: 'POST', body: { mode: b.dataset.mode, id: b.dataset.id ? Number(b.dataset.id) : null } });
      toast('On the LED screen now'); renderScreen();
    })));
  }

  async function renderLeaderboard() {
    const rows = await api('/leaderboard');
    page().innerHTML = `<a href="#engage" class="small">← Back</a><h2 class="page" style="margin-top:8px">Overall leaderboard</h2>
      <p class="muted">Total points across every quiz, plus points for typed answers in quizzes and polls; ties broken by total time. Toggle guest visibility on the Dashboard.</p>
      <div class="card tablewrap"><table><tr><th>#</th><th>Name</th><th>Company</th><th>Played</th><th>Points</th><th>Total time</th></tr>
      ${rows.map((r) => `<tr><td>${r.rank}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.company || '')}</td><td>${r.quizzes}</td><td><b>${r.points}</b></td><td>${(r.time_ms / 1000).toFixed(1)}s</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No points scored yet</td></tr>'}</table></div>`;
  }

  // ---------- agenda ----------
  async function renderAgenda(editId) {
    const list = await api('/sessions');
    const cur = list.find((s) => s.id === Number(editId)) || {};
    page().innerHTML = `<h2 class="page">Agenda</h2>
      <div class="two">
        <form class="card stack" id="sForm"><h3>${cur.id ? 'Edit session' : 'Add a session'}</h3>
          <div class="formgrid">
            <label class="field full">Title<input class="input" name="title" required value="${esc(cur.title || '')}"></label>
            <label class="field full">Date<input class="input" type="date" name="day" required value="${esc(cur.day || list[list.length - 1]?.day || '')}"></label>
            <label class="field">Starts<input class="input" type="time" name="start_time" required value="${esc(cur.start_time || '')}"></label>
            <label class="field">Ends<input class="input" type="time" name="end_time" required value="${esc(cur.end_time || '')}"></label>
            <label class="field">Speaker / host<input class="input" name="speaker" value="${esc(cur.speaker || '')}"></label>
            <label class="field">Location<input class="input" name="location" value="${esc(cur.location || '')}"></label>
            <label class="field full">Details<textarea class="input" name="description" rows="3">${esc(cur.description || '')}</textarea></label>
          </div>
          <div class="row">${cur.id ? '<a class="btn ghost" href="#agenda">Cancel</a>' : ''}<span class="spacer"></span><button class="btn">${cur.id ? 'Save' : 'Add session'}</button></div>
          <p class="muted small">Times are India time (IST). Guests see changes instantly.</p></form>
        <div class="card tablewrap"><table><tr><th>Date</th><th>Time</th><th>Session</th><th></th></tr>
          ${list.map((s) => `<tr><td class="small">${esc(s.day)}</td><td class="small">${esc(s.start_time)}–${esc(s.end_time)}</td><td><b>${esc(s.title)}</b><div class="muted small">${esc([s.speaker, s.location].filter(Boolean).join(' · '))}</div></td>
            <td><div class="row"><a class="btn sm ghost" href="#agenda/${s.id}">Edit</a><button class="btn sm ghost" data-del="${s.id}">🗑</button></div></td></tr>`).join('') || '<tr><td colspan="4" class="muted">No sessions yet</td></tr>'}
        </table></div>
      </div>`;
    $('#sForm').onsubmit = run(async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      if (cur.id) await api('/sessions/' + cur.id, { method: 'PUT', body }); else await api('/sessions', { method: 'POST', body });
      toast('Agenda updated'); cur.id ? (location.hash = '#agenda') : renderAgenda();
    });
    $$('[data-del]').forEach((b) => (b.onclick = run(async () => { if (!confirm('Delete this session?')) return; await api('/sessions/' + b.dataset.del, { method: 'DELETE' }); renderAgenda(); })));
  }

  // ---------- gallery ----------
  let galleryFilter = 'pending';
  async function renderGallery() {
    const items = await api('/media' + (galleryFilter === 'all' ? '' : '?status=' + galleryFilter));
    const all = await api('/media?status=pending'); setPending(all.length);
    page().innerHTML = `<h2 class="page">Gallery</h2>
      <div class="two">
        <div class="stack">
          <form class="card stack" id="offForm"><h3>Upload official photos & videos</h3>
            <p class="muted small" style="margin:0">These go straight into the “Official” section of the gallery.</p>
            <input class="input" type="file" name="files" multiple accept="image/*,video/*" required>
            <input class="input" name="caption" placeholder="Caption (optional)">
            <button class="btn">Upload</button><div class="progress hidden" id="gprog"><div></div></div></form>
          <div class="card stack"><h3>Tell everyone</h3>
            <p class="muted small" style="margin:0">After the event, send one message on WhatsApp + email pointing people to the gallery.</p>
            <button class="btn secondary" id="announce">📲 Announce the gallery</button></div>
        </div>
        <div>
          <div class="row wrap" style="margin-bottom:12px">${['pending', 'approved', 'rejected', 'all'].map((f) => `<button class="btn sm ${f === galleryFilter ? '' : 'ghost'}" data-f="${f}">${f[0].toUpperCase() + f.slice(1)}${f === 'pending' ? ` (${all.length})` : ''}</button>`).join('')}
            <span class="spacer"></span>${galleryFilter === 'pending' && items.length ? '<button class="btn sm secondary" id="approveAll">Approve all</button>' : ''}</div>
          <div class="modgrid">${items.map((m) => `<div class="moditem">
              <a class="thumb" href="/uploads/${esc(m.file_path)}" target="_blank" style="display:block">${m.media_type === 'video' ? `<video src="/uploads/${esc(m.file_path)}#t=0.5" muted preload="metadata"></video>` : `<img src="/uploads/${esc(m.file_path)}" loading="lazy">`}</a>
              <div class="meta"><b>${m.official ? 'Official' : esc(m.uploader || 'Guest')}</b> <span class="chip">${m.status}</span>
                ${m.caption ? `<div class="muted">${esc(m.caption)}</div>` : ''}<div class="muted small">${when(m.created_at)}</div>
                <div class="row wrap" style="margin-top:8px">
                  ${m.status !== 'approved' ? `<button class="btn sm" data-st="approved" data-id="${m.id}">Approve</button>` : ''}
                  ${m.status !== 'rejected' ? `<button class="btn sm ghost" data-st="rejected" data-id="${m.id}">Reject</button>` : ''}
                  <button class="btn sm ghost" data-del="${m.id}">🗑</button></div></div></div>`).join('') || '<div class="card empty">Nothing here.</div>'}</div>
        </div>
      </div>`;
    $$('[data-f]').forEach((b) => (b.onclick = () => { galleryFilter = b.dataset.f; renderGallery(); }));
    $$('[data-st]').forEach((b) => (b.onclick = run(async () => { await api('/media/' + b.dataset.id, { method: 'PATCH', body: { status: b.dataset.st } }); renderGallery(); })));
    $$('[data-del]').forEach((b) => (b.onclick = run(async () => { if (!confirm('Delete this file permanently?')) return; await api('/media/' + b.dataset.del, { method: 'DELETE' }); renderGallery(); })));
    $('#approveAll') && ($('#approveAll').onclick = run(async () => { for (const m of items) await api('/media/' + m.id, { method: 'PATCH', body: { status: 'approved' } }); toast(`Approved ${items.length}`); renderGallery(); }));
    $('#announce').onclick = run(async () => { if (!confirm('Send the gallery announcement to every attendee?')) return; const n = await api('/gallery/announce', { method: 'POST', body: {} }); toast('Announcement queued.' + notified(n)); });
    $('#offForm').onsubmit = (e) => {
      e.preventDefault();
      const xhr = new XMLHttpRequest(); const prog = $('#gprog'); prog.classList.remove('hidden');
      xhr.upload.onprogress = (ev) => ev.lengthComputable && (prog.firstElementChild.style.width = (ev.loaded / ev.total) * 100 + '%');
      xhr.onload = () => { const out = JSON.parse(xhr.responseText || '{}'); if (xhr.status >= 400) return toast(out.error || 'Failed', true); toast(`Uploaded ${out.count} file(s)`); galleryFilter = 'approved'; renderGallery(); };
      xhr.open('POST', '/api/admin/media'); xhr.setRequestHeader('x-admin', adminToken); xhr.send(new FormData(e.target));
    };
  }

  // ---------- broadcast ----------
  async function renderBroadcast() {
    page().innerHTML = `<h2 class="page">Broadcast a message</h2>
      <form class="card stack" id="bForm" style="max-width:640px">
        <p class="muted small" style="margin:0">Sends to every attendee. WhatsApp uses your approved template: “Hi {name}, <b>{headline}</b> on the AMG 2026 microsite. Open it here: {link}”.</p>
        <label class="field">Headline<input class="input" name="title" required placeholder="e.g. the bus to the venue leaves at 8:45 AM from the lobby"></label>
        <label class="field">Longer message (email only)<textarea class="input" name="message" rows="5"></textarea></label>
        <label class="field">Open which page?<select class="input" name="path">
          <option value="/">Home</option><option value="/#agenda">Agenda</option><option value="/#engage">Quizzes & polls</option><option value="/#gallery">Gallery</option><option value="/#chat">Chat</option></select></label>
        <div class="row"><label class="toggle"><input type="checkbox" name="wa" checked> WhatsApp</label><label class="toggle"><input type="checkbox" name="em" checked> Email</label></div>
        <button class="btn">Send to everyone</button>
      </form>`;
    $('#bForm').onsubmit = run(async (e) => {
      e.preventDefault();
      const f = e.target;
      const channels = [f.wa.checked && 'whatsapp', f.em.checked && 'email'].filter(Boolean);
      if (!channels.length) throw new Error('Pick at least one channel');
      if (!confirm('Send this to all attendees now?')) return;
      const n = await api('/broadcast', { method: 'POST', body: { title: f.title.value, message: f.message.value, path: f.path.value, channels } });
      toast('Queued.' + notified(n)); f.reset();
    });
  }

  // ---------- branding ----------
  const PRESETS = [
    { name: 'Goa coast (default)', colorPrimary: '#0d4f4a', colorAccent: '#e8704a', colorHighlight: '#f2b84b' },
    { name: 'Corporate blue', colorPrimary: '#0b3a75', colorAccent: '#1e88e5', colorHighlight: '#ffc72c' },
    { name: 'Industrial red', colorPrimary: '#2b2d33', colorAccent: '#d62f2f', colorHighlight: '#f5b301' },
    { name: 'Navy & gold', colorPrimary: '#14213d', colorAccent: '#c8102e', colorHighlight: '#e5b53f' },
    { name: 'Forest', colorPrimary: '#1f4d2b', colorAccent: '#e07a2f', colorHighlight: '#d9c45a' },
  ];

  async function renderBranding() {
    await loadBrand();
    const m = { ...brand, logoFile: null, heroFile: null, artFile: null, removeLogo: false, removeHero: false, removeTitleArt: false,
      partnerFiles: [], removePartners: [] };
    // Object URLs for picked files are made once, so redrawing the preview doesn't leak them.
    const blob = new Map();
    const fileUrl = (f) => { if (!blob.has(f)) blob.set(f, URL.createObjectURL(f)); return blob.get(f); };
    const logoUrl = () => (m.logoFile ? fileUrl(m.logoFile) : m.removeLogo ? null : brand.logo);
    const heroUrl = () => (m.heroFile ? fileUrl(m.heroFile) : m.removeHero ? null : brand.heroImage);
    const artUrl = () => (m.artFile ? fileUrl(m.artFile) : m.removeTitleArt ? null : brand.titleArt);
    const partnerList = () => [
      ...brand.partnerLogos.filter((u) => !m.removePartners.includes(u)).map((u) => ({ url: u, saved: u })),
      ...m.partnerFiles.map((f) => ({ url: fileUrl(f), file: f })),
    ];
    const colorRow = (key, label, hint) => `<div class="colorrow">
        <input type="color" data-c="${key}" value="${m[key]}">
        <input class="input" data-hex="${key}" value="${m[key]}" maxlength="7">
        <div><b>${label}</b><div class="muted small">${hint}</div></div></div>`;

    page().innerHTML = `<h2 class="page">Branding</h2>
      <div class="two brandgrid">
        <div class="stack">
          <div class="card stack"><h3>Names &amp; type</h3>
            <div class="formgrid">
              <label class="field">Client name<input class="input" data-t="clientName" value="${esc(m.clientName)}" maxlength="60"></label>
              <label class="field">Event name<input class="input" data-t="eventName" value="${esc(m.eventName)}" maxlength="40"></label>
              <label class="field full">Tagline / theme line (optional)<input class="input" data-t="tagline" value="${esc(m.tagline)}" maxlength="120" placeholder="e.g. Sharper Together · Annual Meet of Growth"></label>
            </div>
            <label class="field">Heading font<select class="input" id="fontSel">${Object.entries(window.Brand.FONTS).map(([k, f]) => `<option value="${k}" ${m.font === k ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select></label>
            <p class="muted small" style="margin:0">The event name is used in email subjects and WhatsApp messages. On the site, its last word is shown in the highlight colour (e.g. AMG <b>2026</b>) unless you upload title artwork below.</p></div>

          <div class="card stack"><h3>Logo</h3>
            <div class="assetbox"><div class="thumb" id="logoThumb"></div>
              <div class="stack" style="flex:1">
                <input type="file" class="input" id="logoFile" accept="image/png,image/jpeg,image/webp,image/svg+xml">
                <div class="row wrap"><label class="toggle"><input type="checkbox" id="logoBadge" ${m.logoBadge ? 'checked' : ''}> Show the logo on a white badge</label>
                  <button class="btn sm ghost" id="rmLogo">Remove logo</button></div>
                <div class="muted small">Use a PNG with a transparent background, about 600px wide. Keep the white badge on for a full-colour logo; turn it off if the logo is all white. Email apps don't show SVG logos, so PNG is safest.</div>
              </div></div></div>

          <div class="card stack"><h3>Title artwork (optional)</h3>
            <div class="assetbox"><div class="thumb" id="artThumb"></div>
              <div class="stack" style="flex:1">
                <input type="file" class="input" id="artFile" accept="image/png,image/webp">
                <div class="row"><button class="btn sm ghost" id="rmArt">Remove artwork</button></div>
                <div class="muted small">The event's title lockup as a transparent PNG with light lettering. It replaces the typed event name at the top of the site and in emails.</div>
              </div></div></div>

          <div class="card stack"><h3>Partner &amp; group logos (optional)</h3>
            <div class="row wrap" id="partnerThumbs"></div>
            <input type="file" class="input" id="partnerFile" accept="image/png,image/jpeg,image/webp,image/svg+xml" multiple>
            <div class="muted small">Up to 4 logos (e.g. group brand, programme logo), shown on a white strip at the bottom of the site and the emails. Use PNGs on transparent or white backgrounds.</div></div>

          <div class="card stack"><h3>Colours</h3>
            <div class="swatches">${PRESETS.map((p, i) => `<button title="${esc(p.name)}" data-preset="${i}" style="background:linear-gradient(135deg, ${p.colorPrimary} 50%, ${p.colorAccent} 50%)"></button>`).join('')}
              <span class="muted small" style="align-self:center;margin-left:4px">Quick starting points; fine-tune below with the client's exact brand colours.</span></div>
            ${colorRow('colorPrimary', 'Primary', 'Header, menus, chat bubbles. Use a deep shade.')}
            ${colorRow('colorAccent', 'Accent', 'Buttons and calls to action.')}
            ${colorRow('colorHighlight', 'Highlight', 'Event year, badges, winner trophy.')}
            <div id="warnings" class="stack"></div></div>

          <div class="card stack"><h3>Header image (optional)</h3>
            <div class="assetbox"><div class="thumb photo" id="heroThumb"></div>
              <div class="stack" style="flex:1">
                <input type="file" class="input" id="heroFile" accept="image/png,image/jpeg,image/webp">
                <div class="row wrap"><label class="field" style="display:flex;align-items:center;gap:8px;margin:0">Tint
                  <select class="input" id="tintSel" style="width:auto;margin:0;padding:6px 10px">
                    <option value="strong" ${m.heroTint === 'strong' ? 'selected' : ''}>Strong (photos)</option>
                    <option value="light" ${m.heroTint === 'light' ? 'selected' : ''}>Light (artwork)</option>
                    <option value="none" ${m.heroTint === 'none' ? 'selected' : ''}>None</option></select></label>
                  <button class="btn sm ghost" id="rmHero">Remove image</button></div>
                <div class="muted small">A wide photo or the event's background artwork, at least 1600px wide. Use a strong tint for photos so the text stays readable; a light tint lets designed artwork show through.</div>
              </div></div></div>

          <div class="row"><span class="spacer"></span><button class="btn" id="saveBrand">Save branding</button></div>
        </div>

        <div class="stack" style="position:sticky;top:16px">
          <div class="muted small" style="font-weight:700;text-transform:uppercase;letter-spacing:.08em">Guest site preview</div>
          <div class="preview" id="preview"></div>
          <div class="muted small" style="font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-top:10px">Notification email <span style="text-transform:none;font-weight:400">(updates after you save)</span></div>
          <iframe class="emailframe" id="emailFrame" title="Email preview"></iframe>
        </div>
      </div>`;

    const drawPreview = () => {
      const el = $('#preview');
      const b = { ...m, logo: logoUrl(), heroImage: heroUrl(), titleArt: artUrl(), partnerLogos: partnerList().map((p) => p.url) };
      window.Brand.apply(b, el);
      el.innerHTML = `
        <header class="hero ${b.heroImage ? 'has-photo' : ''}">
          <div class="hero-inner">
            <div class="top"><div class="brand">
              ${b.logo ? `<span class="brand-logo ${b.logoBadge ? 'badge' : ''}"><img src="${esc(b.logo)}" alt=""></span>` : ''}
              <div class="client">${b.logo ? 'presents' : esc(b.clientName) + ' presents'}</div></div>
              <button class="avatar-btn" style="margin-left:auto">AM</button></div>
            ${b.titleArt ? `<h1 class="has-art"><img class="title-art" src="${esc(b.titleArt)}" alt="" style="width:230px"></h1>` : `<h1>${titleHtml(b.eventName || 'Event')}</h1>`}
            ${b.tagline ? `<div class="tagline">${esc(b.tagline)}</div>` : ''}
            <div class="meta">${esc(eventMeta)}</div>
          </div>
          <svg class="wave" viewBox="0 0 1440 60" preserveAspectRatio="none"><path fill="currentColor" d="M0 40c160-22 320-22 480 0s320 22 480 0 320-22 480 0v20H0z"/></svg>
        </header>
        <div class="body">
          <a class="banner" style="margin-top:0"><div class="icon">🏆</div><div><div class="small" style="opacity:.85">Live quiz</div><b>Goa Warm-up Quiz</b></div><span class="go">Play →</span></a>
          <div class="card" style="margin-top:12px">
            <span class="pill live">Live</span>
            <div class="options"><button class="option selected"><span class="bar" style="width:62%"></span><span>A.</span><span>Goan Carnival</span><span class="pct">62%</span></button>
              <button class="option"><span class="bar" style="width:38%"></span><span>B.</span><span>Black &amp; Gold</span><span class="pct">38%</span></button></div>
            <button class="btn block" style="margin-top:12px">Submit</button>
          </div>
          ${b.partnerLogos.length ? `<div class="partners" style="margin:12px 0 0;padding:12px;gap:12px 20px">${b.partnerLogos.map((u) => `<img src="${esc(u)}" alt="" style="height:30px">`).join('')}</div>` : ''}
        </div>`;
      $('#logoThumb').innerHTML = b.logo ? `<img src="${esc(b.logo)}" style="${b.logoBadge ? 'background:#fff;padding:6px;border-radius:8px' : ''}">` : 'No logo';
      // Set as a property: the background contains url("…"), which would break a quoted style attribute.
      $('.hero', el).style.background = window.Brand.heroBackground(b);
      $('#heroThumb').innerHTML = b.heroImage ? `<img src="${esc(b.heroImage)}">` : 'No image';
      $('#artThumb').innerHTML = b.titleArt ? `<img src="${esc(b.titleArt)}">` : 'No artwork';
      $('#partnerThumbs').innerHTML = partnerList().map((p, i) => `<div class="assetbox" style="padding:6px;gap:6px">
          <div class="thumb" style="width:96px;height:48px;background:#fff"><img src="${esc(p.url)}" alt=""></div>
          <button class="btn sm ghost" data-rmp="${i}" title="Remove">✕</button></div>`).join('') || '<span class="muted small">No partner logos</span>';
      $$('[data-rmp]').forEach((btn) => (btn.onclick = () => {
        const p = partnerList()[Number(btn.dataset.rmp)];
        if (p.saved) m.removePartners.push(p.saved); else m.partnerFiles = m.partnerFiles.filter((f) => f !== p.file);
        drawPreview();
      }));
      $('#warnings').innerHTML = window.Brand.warnings(m).map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join('');
    };
    const refreshEmail = () => { $('#emailFrame').src = `/api/admin/branding/email-preview?a=${encodeURIComponent(adminToken)}&v=${Date.now()}`; };

    $$('[data-t]').forEach((i) => (i.oninput = () => { m[i.dataset.t] = i.value; drawPreview(); }));
    const setColor = (key, v) => {
      m[key] = v.toLowerCase();
      $(`[data-c="${key}"]`).value = m[key];
      $(`[data-hex="${key}"]`).value = m[key];
    };
    $$('[data-c]').forEach((i) => (i.oninput = () => { setColor(i.dataset.c, i.value); drawPreview(); }));
    $$('[data-hex]').forEach((i) => (i.oninput = () => {
      const v = i.value.trim().startsWith('#') ? i.value.trim() : '#' + i.value.trim();
      if (/^#[0-9a-f]{6}$/i.test(v)) { m[i.dataset.hex] = v.toLowerCase(); $(`[data-c="${i.dataset.hex}"]`).value = m[i.dataset.hex]; drawPreview(); }
    }));
    $$('[data-preset]').forEach((b) => (b.onclick = () => {
      const p = PRESETS[Number(b.dataset.preset)];
      ['colorPrimary', 'colorAccent', 'colorHighlight'].forEach((k) => setColor(k, p[k]));
      drawPreview();
    }));
    $('#logoFile').onchange = (e) => { m.logoFile = e.target.files[0] || null; m.removeLogo = false; drawPreview(); };
    $('#heroFile').onchange = (e) => { m.heroFile = e.target.files[0] || null; m.removeHero = false; drawPreview(); };
    $('#logoBadge').onchange = (e) => { m.logoBadge = e.target.checked; drawPreview(); };
    $('#rmLogo').onclick = () => { m.logoFile = null; m.removeLogo = true; $('#logoFile').value = ''; drawPreview(); };
    $('#rmHero').onclick = () => { m.heroFile = null; m.removeHero = true; $('#heroFile').value = ''; drawPreview(); };
    $('#artFile').onchange = (e) => { m.artFile = e.target.files[0] || null; m.removeTitleArt = false; drawPreview(); };
    $('#rmArt').onclick = () => { m.artFile = null; m.removeTitleArt = true; $('#artFile').value = ''; drawPreview(); };
    $('#partnerFile').onchange = (e) => {
      const room = 4 - partnerList().length;
      const picked = [...e.target.files];
      if (picked.length > room) toast(`Only ${room} more logo${room === 1 ? '' : 's'} can be added (4 max)`);
      m.partnerFiles.push(...picked.slice(0, Math.max(0, room)));
      e.target.value = '';
      drawPreview();
    };
    $('#tintSel').onchange = (e) => { m.heroTint = e.target.value; drawPreview(); };
    $('#fontSel').onchange = (e) => { m.font = e.target.value; drawPreview(); };

    $('#saveBrand').onclick = run(async () => {
      const fd = new FormData();
      for (const k of ['clientName', 'eventName', 'tagline', 'colorPrimary', 'colorAccent', 'colorHighlight']) fd.append(k, m[k] || '');
      fd.append('logoBadge', m.logoBadge);
      if (m.logoFile) fd.append('logo', m.logoFile);
      if (m.heroFile) fd.append('hero', m.heroFile);
      fd.append('removeLogo', m.removeLogo);
      fd.append('removeHero', m.removeHero);
      if (m.artFile) fd.append('titleArt', m.artFile);
      fd.append('removeTitleArt', m.removeTitleArt);
      m.partnerFiles.forEach((f) => fd.append('partners', f));
      fd.append('removePartners', JSON.stringify(m.removePartners));
      fd.append('heroTint', m.heroTint);
      fd.append('font', m.font);
      $('#saveBrand').disabled = true;
      try {
        brand = await api('/branding', { method: 'PUT', body: fd });
      } finally { $('#saveBrand').disabled = false; }
      window.Brand.apply(brand); sideBrand();
      toast('Branding saved — guests see it right away');
      renderBranding();
    });

    drawPreview();
    refreshEmail();
  }

  const renderers = { dashboard: renderDashboard, attendees: renderAttendees, updates: renderUpdates, engage: renderEngage, agenda: renderAgenda, gallery: renderGallery, broadcast: renderBroadcast, branding: renderBranding, wheels: renderWheels, screen: renderScreen, draws: renderDraws, stars: renderStars };
  loadBrand().catch(() => {}).finally(route);
})();
