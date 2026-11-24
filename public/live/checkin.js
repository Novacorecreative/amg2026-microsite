/* Check-in desk: scans guests' QR passes (or finds them by name) and marks them as arrived. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const time = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const app = $('#app');
  let adminToken = localStorage.getItem('amg_admin'); // shared with the admin panel on this site
  let cfg, people = [], filter = '', show = 'all';

  async function api(path, opts = {}) {
    const res = await fetch('/api/admin' + path, {
      method: opts.method || 'GET',
      headers: { 'x-admin': adminToken, 'Content-Type': 'application/json' },
      body: opts.body && JSON.stringify(opts.body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { localStorage.removeItem('amg_admin'); adminToken = null; login(); throw new Error('auth'); }
    if (!res.ok && res.status !== 404) throw new Error(data.error || 'Something went wrong');
    return { status: res.status, ...data };
  }

  function login(msg) {
    stopCamera();
    app.innerHTML = `<form class="panel login stack" id="lf"><h2>Check-in desk</h2>
      <p class="muted small">Sign in with the organiser password.</p>
      ${msg ? `<div class="small" style="color:#b42318">${esc(msg)}</div>` : ''}
      <input class="input" type="password" name="password" placeholder="Organiser password" autocomplete="current-password" required>
      <button class="btn block">Sign in</button></form>`;
    $('#lf').onsubmit = async (e) => {
      e.preventDefault();
      const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: e.target.password.value }) });
      const d = await r.json();
      if (!d.token) return login('That password is not right.');
      adminToken = d.token; localStorage.setItem('amg_admin', adminToken); desk();
    };
  }

  async function desk() {
    const b = cfg.branding;
    app.innerHTML = `<header class="desk">
        ${b.logo ? `<img src="${esc(b.logo)}" alt="${esc(b.clientName)}">` : ''}
        <div><div class="sub">${esc(b.eventName)}</div><h1>Check-in desk</h1></div>
        <div class="count"><b id="cnt">–</b> <span id="tot"></span><div class="bar"><i id="bar" style="width:0"></i></div></div>
      </header>
      <div class="grid">
        <div class="panel">
          <div class="cam"><video id="vid" playsinline muted></video><div class="frame"></div><div class="msg" id="camMsg">Starting camera…</div></div>
          <div class="result" id="res"><div class="muted">Point the camera at the guest's QR pass.</div></div>
        </div>
        <div class="panel">
          <input class="input" id="q" placeholder="No QR? Search name, phone or company" autocomplete="off">
          <div class="tabs"><button class="btn sm" data-show="all">Everyone</button><button class="btn sm ghost" data-show="waiting">Not arrived</button><button class="btn sm ghost" data-show="in">Arrived</button></div>
          <div class="list" id="list"></div>
        </div>
      </div>`;
    $('#q').oninput = (e) => { filter = e.target.value.trim().toLowerCase(); drawList(); };
    app.querySelectorAll('[data-show]').forEach((btn) => (btn.onclick = () => {
      show = btn.dataset.show;
      app.querySelectorAll('[data-show]').forEach((x) => x.classList.toggle('ghost', x !== btn));
      drawList();
    }));
    $('#list').onclick = async (e) => {
      const inBtn = e.target.closest('[data-in]'), undo = e.target.closest('[data-undo]');
      if (inBtn) result(await api('/checkin', { method: 'POST', body: { id: Number(inBtn.dataset.in) } }));
      if (undo && confirm('Undo this check-in?')) { await api('/checkin/' + undo.dataset.undo, { method: 'DELETE' }); await refresh(); }
    };
    await refresh();
    startCamera();
  }

  async function refresh() {
    const d = await api('/checkin');
    const changed = JSON.stringify(d.attendees) !== JSON.stringify(people);
    people = d.attendees;
    $('#cnt').textContent = d.checkedIn;
    $('#tot').textContent = `/ ${d.total} arrived`;
    $('#bar').style.width = (d.total ? (100 * d.checkedIn) / d.total : 0) + '%';
    if (changed) drawList(); // redraw only on change, so the list doesn't jump under a staff member's finger
  }

  function drawList() {
    const digits = filter.replace(/\D/g, '');
    const rows = people.filter((p) => (show === 'all' || (show === 'in') === !!p.checked_in_at)
      && (!filter || [p.name, p.company].some((x) => String(x || '').toLowerCase().includes(filter)) || (digits.length >= 4 && String(p.phone || '').includes(digits))));
    $('#list').innerHTML = rows.slice(0, 200).map((p) => `<div class="person">
        <div class="who"><b>${esc(p.name)}</b><span class="muted small">${esc([p.designation, p.company].filter(Boolean).join(', '))}</span></div>
        ${p.checked_in_at
          ? `<span class="done">✓ ${time(p.checked_in_at)}</span><button class="btn sm ghost" data-undo="${p.id}" title="Undo check-in">↺</button>`
          : `<button class="btn sm" data-in="${p.id}">Check in</button>`}
      </div>`).join('') || '<div class="muted" style="padding:12px 4px">Nobody matches.</div>';
  }

  function result(r) {
    const el = $('#res');
    const a = r.attendee;
    if (r.status === 'ok') {
      el.className = 'result ok';
      el.innerHTML = `<h2>✅ Welcome, ${esc(a.name)}</h2><div class="muted">${esc([a.designation, a.company].filter(Boolean).join(', '))}</div>`;
      navigator.vibrate?.(120);
    } else if (r.status === 'already') {
      el.className = 'result already';
      el.innerHTML = `<h2>Already checked in</h2><div><b>${esc(a.name)}</b> arrived at ${time(a.checked_in_at)}.</div>`;
      navigator.vibrate?.([80, 60, 80]);
    } else {
      el.className = 'result err';
      el.innerHTML = `<h2>Not recognised</h2><div>${esc(r.error || 'This QR is not an event pass.')} Search the guest's name instead.</div>`;
      navigator.vibrate?.([200, 80, 200]);
    }
    refresh();
  }

  // ---------- camera scanner ----------
  let stream, timer, paused = false;
  async function startCamera() {
    const msg = $('#camMsg');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch {
      msg.textContent = 'Camera not available. Allow camera access for this site, or use the search on the right.';
      return;
    }
    const vid = $('#vid');
    vid.srcObject = stream;
    await vid.play();
    msg.textContent = '';
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    timer = setInterval(async () => {
      if (paused || !vid.videoWidth) return;
      const scale = Math.min(1, 640 / vid.videoWidth); // decode a smaller frame: fast enough on desk phones
      canvas.width = vid.videoWidth * scale; canvas.height = vid.videoHeight * scale;
      ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
      const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
      if (!code?.data) return;
      paused = true; // one scan at a time; wait before reading the next pass
      try { result(await api('/checkin', { method: 'POST', body: { code: code.data } })); } catch (e) { if (e.message !== 'auth') result({ error: e.message }); }
      setTimeout(() => { paused = false; }, 2500);
    }, 200);
  }
  function stopCamera() { clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); }

  // Other desks check people in too: keep the numbers and list current.
  setInterval(() => { if (adminToken && $('#list') && !document.hidden) refresh().catch(() => {}); }, 5000);

  fetch('/api/config').then((r) => r.json()).then((c) => {
    cfg = c;
    Brand.apply(c.branding);
    adminToken ? desk() : login();
  });
})();
