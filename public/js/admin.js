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
    engage: ['🏆', 'Quizzes & polls'], agenda: ['🗓️', 'Agenda'], gallery: ['📸', 'Gallery'], broadcast: ['📲', 'Broadcast'],
    branding: ['🎨', 'Branding'],
  };

  // ---------- brand ----------
  let brand = null;
  async function loadBrand() {
    const cfg = await fetch('/api/config').then((r) => r.json());
    brand = cfg.branding;
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
          <a href="/" target="_blank">↗ View microsite</a><a href="#" id="logout">⎋ Sign out</a></nav></aside>
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

  async function renderBuilder(id) {
    let model = { kind: 'quiz', title: '', description: '', questions: [{ qtype: 'choice', text: '', options: ['', '', '', ''], correct_index: null, points: 1 }] };
    if (id) {
      const d = await api('/activities/' + id);
      model = { kind: d.activity.kind, title: d.activity.title, description: d.activity.description || '', questions: d.questions.map((q) => ({ qtype: q.qtype, text: q.text, options: q.options, correct_index: q.correct_index, points: q.points })) };
    }
    const draw = () => {
      page().innerHTML = `<a href="#engage" class="small">← Back</a><h2 class="page" style="margin-top:8px">${id ? 'Edit' : 'New'} ${model.kind}</h2>
        <div class="card stack">
          <div class="formgrid">
            <label class="field">Type<select class="input" id="kind" ${id ? 'disabled' : ''}><option value="quiz">Quiz — has right answers, picks a winner</option><option value="poll">Poll — opinions, shows the top choice</option></select></label>
            <label class="field">Title<input class="input" id="title" value="${esc(model.title)}"></label>
            <label class="field full">Short description (optional)<input class="input" id="desc" value="${esc(model.description)}"></label>
          </div>
          <div id="qs">${model.questions.map((q, i) => `
            <div class="qedit" data-i="${i}">
              <div class="row"><b>Q${i + 1}</b><select class="input" data-f="qtype" style="max-width:190px"><option value="choice" ${q.qtype === 'choice' ? 'selected' : ''}>Multiple choice</option><option value="text" ${q.qtype === 'text' ? 'selected' : ''}>Open text answer</option></select>
                ${model.kind === 'quiz' && q.qtype === 'choice' ? `<label class="small muted">Points <input class="input" data-f="points" type="number" min="1" value="${q.points}" style="width:70px;display:inline-block"></label>` : ''}
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
        if (id) await api('/activities/' + id, { method: 'PUT', body }); else await api('/activities', { method: 'POST', body });
        toast('Saved. Use “Go live” when you’re ready.'); location.hash = '#engage';
      });
    };
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
        ${a.kind === 'quiz' ? `<div class="card"><h3>Ranking</h3><p class="muted small">Highest score first; ties broken by fastest time.</p>
          <div class="tablewrap" style="max-height:540px;overflow:auto"><table><tr><th>#</th><th>Name</th><th>Score</th><th>Time</th></tr>
          ${r.rankings.map((x) => `<tr><td>${x.rank}</td><td><b>${esc(x.name)}</b><div class="muted small">${esc(x.company || '')}</div></td><td>${x.score}/${r.maxScore}</td><td>${fmtS(x.duration_ms)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No responses yet</td></tr>'}
          </table></div></div>` : ''}
        <div ${a.kind === 'poll' ? 'style="grid-column:1/-1"' : ''}>${r.questions.map((q, i) => `<div class="card">
          <div class="row wrap"><b>Q${i + 1}. ${esc(q.text)}</b><span class="spacer"></span><span class="muted small">${q.responses} response${q.responses === 1 ? '' : 's'}</span></div>
          ${q.correctPercent != null ? `<div class="pill ok" style="margin-top:6px">${q.correctCount} answered correctly · ${q.correctPercent}%</div>` : ''}
          ${q.qtype === 'choice' && a.kind === 'poll' && q.topOptions.length ? `<div class="pill gold" style="margin-top:6px">Most votes: ${q.topOptions.map((x) => esc(q.options[x])).join(' & ')}</div>` : ''}
          ${q.qtype === 'choice' ? q.options.map((o, oi) => `<div class="chartbar ${q.correct_index === oi ? 'correct' : ''}"><div style="width:${q.percents[oi]}%"></div>
              <span>${String.fromCharCode(65 + oi)}. ${esc(o)} ${q.correct_index === oi ? '✓' : ''}</span><em>${q.counts[oi]} · ${q.percents[oi]}%</em></div>`).join('')
            : `<div style="max-height:260px;overflow:auto;margin-top:8px">${(q.textAnswers || []).map((t) => `<div style="padding:6px 0;border-bottom:1px solid var(--sand-100)">“${esc(t)}”</div>`).join('') || '<div class="muted">No answers yet</div>'}</div>`}
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

  async function renderLeaderboard() {
    const rows = await api('/leaderboard');
    page().innerHTML = `<a href="#engage" class="small">← Back</a><h2 class="page" style="margin-top:8px">Overall leaderboard</h2>
      <p class="muted">Total points across every quiz; ties broken by total time. Toggle guest visibility on the Dashboard.</p>
      <div class="card tablewrap"><table><tr><th>#</th><th>Name</th><th>Company</th><th>Quizzes</th><th>Points</th><th>Total time</th></tr>
      ${rows.map((r) => `<tr><td>${r.rank}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.company || '')}</td><td>${r.quizzes}</td><td><b>${r.points}</b></td><td>${(r.time_ms / 1000).toFixed(1)}s</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No quiz answers yet</td></tr>'}</table></div>`;
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
            <div class="meta">Goa · 10 Dec – 12 Dec 2026</div>
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

  const renderers = { dashboard: renderDashboard, attendees: renderAttendees, updates: renderUpdates, engage: renderEngage, agenda: renderAgenda, gallery: renderGallery, broadcast: renderBroadcast, branding: renderBranding };
  loadBrand().catch(() => {}).finally(route);
})();
