/* AMG 2026 attendee microsite — vanilla JS single page app. */
(() => {
  'use strict';

  // ---------- helpers ----------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  const toDate = (s) => (s ? new Date(/[TZ]/.test(s) ? s : s.replace(' ', 'T') + 'Z') : null);
  const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
  const TZ = 'Asia/Kolkata';
  const fmtTime = (d) => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
  const fmtDay = (iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(iso + 'T12:00:00+05:30').toLocaleDateString('en-IN', { ...opts, timeZone: TZ });
  function ago(s) {
    const d = toDate(s); if (!d) return '';
    const m = Math.round((Date.now() - d) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: TZ });
  }
  // "Now" in IST as {day:'YYYY-MM-DD', hm:'HH:MM'}
  function istNow() {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).map((x) => [x.type, x.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
  }
  const hm12 = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

  function toast(msg, opts = {}) {
    const t = document.createElement('div');
    t.className = 'toast' + (opts.error ? ' err' : '');
    t.innerHTML = `<span>${opts.icon || (opts.error ? '⚠️' : '🔔')}</span><div>${esc(msg)}</div>`;
    if (opts.href) t.onclick = () => { location.hash = opts.href; t.remove(); };
    $('#toasts').append(t);
    setTimeout(() => t.remove(), opts.ms || 5000);
  }

  // ---------- auth / api ----------
  const url = new URL(location.href);
  if (url.searchParams.get('t')) {
    localStorage.setItem('amg_token', url.searchParams.get('t'));
    url.searchParams.delete('t');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  let token = localStorage.getItem('amg_token');

  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, {
      ...opts,
      headers: { ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), 'x-token': token || '', ...(opts.headers || {}) },
      body: opts.body && !(opts.body instanceof FormData) && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token) { localStorage.removeItem('amg_token'); token = null; renderGate(data.error); throw new Error('auth'); }
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }

  // ---------- state ----------
  const state = { cfg: null, me: null, agenda: [], activities: [], gallery: [], unread: 0, chatPeer: null, chatMsgs: [], galleryIndex: 0 };
  const view = $('#view');

  // ---------- header ----------
  function applyBranding(b) {
    if (!b) return;
    state.cfg.branding = b;
    state.cfg.eventName = b.eventName;
    state.cfg.clientName = b.clientName;
    window.Brand.apply(b);
    const hero = $('.hero');
    hero.style.background = window.Brand.heroBackground(b);
    hero.classList.toggle('has-photo', !!b.heroImage);
    const logo = $('#brandLogo');
    logo.classList.toggle('hidden', !b.logo);
    logo.classList.toggle('badge', b.logoBadge);
    if (b.logo) { $('img', logo).src = b.logo; $('img', logo).alt = b.clientName; }
    // With a logo the client's name is already visible, so the label just says "presents".
    $('#clientName').textContent = b.logo ? 'presents' : `${b.clientName} presents`;
    $('#tagline').textContent = b.tagline;
    $('#tagline').classList.toggle('hidden', !b.tagline);
    // Title: the client's artwork if uploaded, otherwise the event name with the last word highlighted.
    const [first, last] = b.eventName.split(/\s+(?=\S+$)/);
    $('#eventTitle').classList.toggle('has-art', !!b.titleArt);
    $('#eventTitle').innerHTML = b.titleArt
      ? `<img class="title-art" src="${esc(b.titleArt)}" alt="${esc(b.eventName)}">`
      : last ? `${esc(first)} <span>${esc(last)}</span>` : esc(b.eventName);
    const partners = $('#partners');
    partners.innerHTML = b.partnerLogos.map((src) => `<img src="${esc(src)}" alt="">`).join('');
    partners.classList.toggle('hidden', !b.partnerLogos.length);
    document.body.classList.toggle('has-partners', b.partnerLogos.length > 0);
  }

  function renderHeader() {
    const c = state.cfg;
    applyBranding(c.branding);
    document.title = `${c.eventName} · ${c.city}`;
    const range = c.startDate === c.endDate ? fmtDay(c.startDate, { day: 'numeric', month: 'long', year: 'numeric' })
      : `${fmtDay(c.startDate, { day: 'numeric', month: 'short' })} – ${fmtDay(c.endDate, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    $('#eventMeta').textContent = `${c.city} · ${range}`;
    tickCountdown();
  }
  function tickCountdown() {
    const c = state.cfg; if (!c) return;
    const start = new Date(c.startDate + 'T00:00:00+05:30');
    const ms = start - Date.now();
    const el = $('#countdown');
    if (ms <= 0) { el.classList.add('hidden'); return; }
    const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60;
    el.innerHTML = `<div><b>${d}</b><small>days</small></div><div><b>${h}</b><small>hours</small></div><div><b>${m}</b><small>mins</small></div>`;
    el.classList.remove('hidden');
  }
  setInterval(tickCountdown, 30000);

  // ---------- gate (no token) ----------
  function renderGate(msg) {
    $('#tabs').classList.add('hidden');
    $('#meBtn').classList.add('hidden');
    view.innerHTML = `
      <div class="card gate stack">
        <h2>Welcome 👋</h2>
        <p class="muted">${esc(msg || 'This microsite is for invited guests. Please open it using the personal link we sent you on WhatsApp or email.')}</p>
        <form id="resendForm" class="stack">
          <label class="field">Lost your link? Enter your registered email or mobile number
            <input class="input" name="contact" required placeholder="name@company.com or 98xxxxxxxx" autocomplete="email">
          </label>
          <button class="btn block">Send me my link</button>
        </form>
      </div>`;
    $('#resendForm').onsubmit = async (e) => {
      e.preventDefault();
      const contact = e.target.contact.value.trim();
      await fetch('/api/resend-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contact }) });
      e.target.outerHTML = `<p class="pill ok">If you're on the guest list, your link is on its way to ${esc(contact)}.</p>`;
    };
  }

  // ---------- router ----------
  const routes = { feed: renderFeed, agenda: renderAgenda, engage: renderEngage, gallery: renderGallery, chat: renderChat };
  function route() {
    if (!token) return renderGate();
    const raw = location.hash.replace(/^#/, '') || 'feed';
    let [tab, arg] = raw.split('/');
    if (tab.startsWith('post-')) { arg = tab.slice(5); tab = 'feed'; }
    if (!routes[tab]) tab = 'feed';
    $$('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
    routes[tab](arg).catch((e) => e.message !== 'auth' && toast(e.message, { error: true }));
  }
  window.addEventListener('hashchange', () => { route(); window.scrollTo({ top: 0, behavior: 'instant' }); });

  // ---------- HOME ----------
  function nowNext() {
    const { day, hm } = istNow();
    const list = state.agenda;
    const current = list.find((s) => s.day === day && s.start_time <= hm && hm < s.end_time);
    const next = list.find((s) => s.day > day || (s.day === day && s.start_time > hm));
    return { current, next };
  }
  function sessionLine(s) {
    return `<div class="muted small">${fmtDay(s.day)} · ${hm12(s.start_time)}–${hm12(s.end_time)}${s.location ? ' · ' + esc(s.location) : ''}</div>`;
  }
  function youtubeEmbed(link) {
    const m = String(link || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|live\/|embed\/|shorts\/))([\w-]{11})/);
    return m ? `<div class="embed"><iframe src="https://www.youtube.com/embed/${m[1]}" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture"></iframe></div>` : '';
  }
  function postHtml(p) {
    let media = '';
    if (p.media_type === 'image') media = `<div class="media"><img src="/uploads/${esc(p.media_path)}" alt="" loading="lazy"></div>`;
    if (p.media_type === 'video') media = `<div class="media"><video src="/uploads/${esc(p.media_path)}" controls playsinline preload="metadata"></video></div>`;
    const yt = youtubeEmbed(p.link_url);
    const link = p.link_url && !yt ? `<p><a class="btn sm secondary" href="${esc(p.link_url)}" target="_blank" rel="noopener">Open link ↗</a></p>` : '';
    return `<article class="card post ${p.pinned ? 'pinned' : ''}" id="post-${p.id}">
      <div class="row"><span class="when">${p.pinned ? '📌 Pinned · ' : ''}${ago(p.created_at)}</span></div>
      <h3 style="margin-top:4px">${esc(p.title)}</h3>
      ${p.body ? `<div class="body">${linkify(p.body)}</div>` : ''}
      ${media}${yt}${link}
    </article>`;
  }

  async function renderFeed(postId) {
    const [posts, agenda, acts] = await Promise.all([api('/feed'), api('/agenda'), api('/activities')]);
    state.agenda = agenda; state.activities = acts;
    updateEngageDot();
    const { current, next } = nowNext();
    const live = acts.filter((a) => a.status === 'live' && !a.my_submitted_at);
    const inAt = state.me.checked_in_at;
    view.innerHTML = `
      <div class="card pass ${inAt ? 'in' : ''}">
        ${inAt ? '' : `<button class="qr" id="passQr" aria-label="Show my event pass full screen"><img src="${passSrc()}" alt="Your event pass QR code"></button>`}
        <div>
          <div class="label">${inAt ? '✅ Checked in' : 'Your event pass'}</div>
          <h3>${inAt ? `Welcome, ${esc(state.me.name.split(' ')[0])}!` : esc(state.me.name)}</h3>
          <div class="muted small">${inAt ? `Checked in ${fmtTime(new Date(inAt))}. Keep this pass handy for the games.` : 'Show this QR at the registration desk. Tap it to make it bigger.'}</div>
          ${inAt ? '<button class="btn sm secondary" id="passShow" style="margin-top:8px">Show my pass</button>' : ''}
        </div>
      </div>
      <div class="card">
        <div class="now-card">
          <div class="slot ${current ? 'on' : ''}">
            <div class="label">${current ? '● Happening now' : 'Right now'}</div>
            ${current ? `<h3>${esc(current.title)}</h3>${sessionLine(current)}` : `<h3>${state.cfg && new Date(state.cfg.startDate + 'T00:00:00+05:30') > Date.now() ? 'See you in ' + esc(state.cfg.city) + '!' : 'Free time'}</h3><div class="muted small">Nothing scheduled this minute</div>`}
          </div>
          <div class="slot">
            <div class="label">Up next</div>
            ${next ? `<h3>${esc(next.title)}</h3>${sessionLine(next)}` : '<h3>That’s a wrap</h3><div class="muted small">Thank you for being with us</div>'}
          </div>
        </div>
      </div>
      ${live.map((a) => `
        <a class="banner" href="#engage/${a.id}">
          <div class="icon">${a.kind === 'quiz' ? '🏆' : '📊'}</div>
          <div><div class="small" style="opacity:.85">${a.kind === 'quiz' ? 'Live quiz' : 'Live poll'}</div><b>${esc(a.title)}</b></div>
          <span class="go">${a.kind === 'quiz' ? 'Play' : 'Vote'} →</span>
        </a>`).join('')}
      <div class="section-title"><h2>Updates</h2><span class="muted small">${posts.length} post${posts.length === 1 ? '' : 's'}</span></div>
      ${posts.length ? posts.map(postHtml).join('') : '<div class="card empty"><div class="em">🌴</div>Updates from the organisers will appear here.</div>'}
      <div class="section-title"><h2>Good to know</h2></div>
      <div class="card stack">
        <div><b>Venue</b><div class="muted">${esc(state.cfg.venue)}${state.cfg.venueMapUrl ? ` · <a href="${esc(state.cfg.venueMapUrl)}" target="_blank" rel="noopener">Map ↗</a>` : ''}</div></div>
        ${state.cfg.helpdeskPhone || state.cfg.helpdeskEmail ? `<div><b>Help desk</b><div class="muted">
          ${state.cfg.helpdeskPhone ? `<a href="tel:${esc(state.cfg.helpdeskPhone)}">${esc(state.cfg.helpdeskPhone)}</a> · <a href="https://wa.me/${esc(state.cfg.helpdeskPhone.replace(/\D/g, ''))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
          ${state.cfg.helpdeskEmail ? ` · <a href="mailto:${esc(state.cfg.helpdeskEmail)}">${esc(state.cfg.helpdeskEmail)}</a>` : ''}</div></div>` : ''}
      </div>`;
    ($('#passQr') || $('#passShow')).onclick = showPass;
    if (postId) { const el = $('#post-' + postId); if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); }
  }

  // ---------- AGENDA ----------
  let agendaDay = null;
  async function renderAgenda() {
    state.agenda = await api('/agenda');
    const days = [...new Set(state.agenda.map((s) => s.day))];
    const { day: today, hm } = istNow();
    if (!agendaDay || !days.includes(agendaDay)) agendaDay = days.includes(today) ? today : days[0];
    if (!days.length) { view.innerHTML = '<div class="card empty"><div class="em">🗓️</div>The agenda will be published soon.</div>'; return; }
    const list = state.agenda.filter((s) => s.day === agendaDay);
    view.innerHTML = `
      <div class="card">
        <div class="row wrap"><h2 style="font-size:20px">Agenda</h2><span class="spacer"></span>
          <a class="btn sm ghost" href="/api/agenda.ics?t=${encodeURIComponent(token)}">＋ Add to my calendar</a></div>
        <div class="daytabs" style="margin-top:14px">
          ${days.map((d, i) => `<button data-day="${d}" class="${d === agendaDay ? 'active' : ''}"><small>Day ${i + 1}</small><b>${fmtDay(d)}</b></button>`).join('')}
        </div>
        <div class="timeline">
          ${list.map((s) => {
            const past = s.day < today || (s.day === today && s.end_time <= hm);
            const now = s.day === today && s.start_time <= hm && hm < s.end_time;
            return `<div class="session ${past ? 'past' : ''} ${now ? 'now' : ''}">
              <div class="time">${hm12(s.start_time)}<small>to ${hm12(s.end_time)}</small></div>
              <div>
                ${now ? '<span class="pill live">Live now</span>' : ''}
                <h3>${esc(s.title)}</h3>
                <div class="muted small">${[s.speaker, s.location].filter(Boolean).map(esc).join(' · ')}</div>
                ${s.description ? `<div class="small" style="margin-top:4px">${linkify(s.description)}</div>` : ''}
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    $$('.daytabs button').forEach((b) => (b.onclick = () => { agendaDay = b.dataset.day; renderAgenda(); }));
  }

  // ---------- ENGAGE (quizzes & polls) ----------
  function updateEngageDot() {
    const n = state.activities.filter((a) => a.status === 'live' && !a.my_submitted_at).length
      + (state.wheels || []).filter((w) => w.status === 'live' && w.my_label == null).length;
    const dot = $('#engageDot');
    dot.textContent = n; dot.classList.toggle('hidden', !n);
  }

  async function renderEngage(id) {
    if (id === 'stars') return renderStars();
    if (id && id.startsWith('w')) return renderWheel(Number(id.slice(1)));
    if (id) return renderActivity(Number(id));
    const [acts, lb, wheels] = await Promise.all([api('/activities'), api('/leaderboard'), api('/wheels')]);
    state.activities = acts; state.wheels = wheels; updateEngageDot();
    const wheelCard = (w) => `
      <a class="card act" href="#engage/w${w.id}">
        <div class="row">
          <span class="pill ${w.status === 'live' ? 'live' : ''}">${w.status === 'live' ? 'Live' : 'Closed'}</span>
          <span class="pill">🎡 Spin the wheel</span>
          ${w.my_label != null ? `<span class="pill ${w.my_win ? 'ok' : ''}">${w.my_win ? '🎉 ' : ''}${esc(w.my_label)}</span>` : ''}
        </div>
        <h3>${esc(w.title)}</h3>
        <div class="muted small">${w.my_label != null ? 'You’ve had your spin' : w.status === 'live' ? 'One free spin each' : 'Closed'}${w.description ? ' · ' + esc(w.description) : ''}</div>
      </a>`;
    const card = (a) => `
      <a class="card act" href="#engage/${a.id}">
        <div class="row">
          <span class="pill ${a.status === 'live' ? 'live' : ''}">${a.status === 'live' ? 'Live' : 'Closed'}</span>
          <span class="pill">${a.kind === 'quiz' ? '🏆 Quiz' : '📊 Poll'}</span>
          ${a.my_submitted_at ? `<span class="pill ok">✓ ${a.kind === 'quiz' && a.my_score != null ? 'Scored ' + a.my_score : 'Done'}</span>` : ''}
        </div>
        <h3>${esc(a.title)}</h3>
        <div class="muted small">${a.question_count} question${a.question_count === 1 ? '' : 's'}${a.description ? ' · ' + esc(a.description) : ''}</div>
      </a>`;
    const live = [...wheels.filter((w) => w.status === 'live').map(wheelCard), ...acts.filter((a) => a.status === 'live').map(card)];
    const closed = [...wheels.filter((w) => w.status !== 'live').map(wheelCard), ...acts.filter((a) => a.status !== 'live').map(card)];
    view.innerHTML = `
      <div class="card"><h2 style="font-size:20px">Games, quizzes & polls</h2>
        <p class="muted small" style="margin:6px 0 0">Quizzes: highest score wins, ties go to whoever answered fastest. Polls: see how everyone voted right after you vote. Wheels: one free spin each.</p></div>
      <a class="banner" href="#engage/stars">
        <div class="icon">⭐</div>
        <div><div class="small" style="opacity:.85">Star Spotlight</div><b>Appreciate a colleague</b></div>
        <span class="go">Send →</span>
      </a>
      <div class="section-title"><h2>Live now</h2></div>
      ${live.length ? `<div class="act-list">${live.join('')}</div>` : '<div class="card empty"><div class="em">⏳</div>Nothing live right now — we’ll notify you when the next one starts.</div>'}
      ${lb.visible && lb.rows.length ? `<div class="section-title"><h2>Leaderboard</h2></div>
        <div class="card">${lb.rows.map((r) => `<div class="leader"><div class="rank">${r.rank}</div><div style="flex:1"><b>${esc(r.name)}</b><div class="muted small">${esc(r.company || '')}</div></div><b>${r.points} pts</b></div>`).join('')}</div>` : ''}
      ${closed.length ? `<div class="section-title"><h2>Earlier</h2></div><div class="act-list">${closed.join('')}</div>` : ''}`;
  }

  // ---------- Star Spotlight ----------
  async function renderStars() {
    const [mine, people] = await Promise.all([api('/stars'), api('/people')]);
    const left = mine.limit - mine.sent.length;
    const status = { pending: 'Waiting for approval', approved: '✓ Shown', rejected: 'Not shown' };
    view.innerHTML = `<a href="#engage" class="small">← Back</a>
      <div class="card stack" style="margin-top:8px">
        <h2 style="font-size:20px">⭐ Star Spotlight</h2>
        <p class="muted small" style="margin:0">Thank a colleague who made a difference this year. Once the organisers approve it, they’ll see your message and it may appear on the big screen.</p>
        ${left > 0 ? `<form id="starForm" class="stack">
          <label class="field">Colleague<input class="input" id="starTo" list="starPeople" placeholder="Start typing a name" autocomplete="off" required></label>
          <datalist id="starPeople">${people.map((p) => `<option value="${esc(p.name)}">${esc(p.company || '')}</option>`).join('')}</datalist>
          <label class="field">Your message<textarea class="input" id="starMsg" rows="3" maxlength="200" required placeholder="e.g. Thank you for always going the extra mile for our dealers!"></textarea></label>
          <div class="row"><span class="muted small">${left} of ${mine.limit} stars left</span><span class="spacer"></span><button class="btn">Send star</button></div>
        </form>` : `<div class="muted">You’ve sent all ${mine.limit} of your stars. Thank you!</div>`}
      </div>
      <div class="section-title"><h2>Stars for you</h2></div>
      ${mine.received.length ? mine.received.map((s) => `<div class="card" style="margin-bottom:10px"><div>“${esc(s.message)}”</div><div class="muted small" style="margin-top:6px">— ${esc(s.from_name)}</div></div>`).join('') : '<div class="card empty"><div class="em">🌟</div>Appreciation from colleagues will appear here.</div>'}
      ${mine.sent.length ? `<div class="section-title"><h2>You sent</h2></div><div class="card">${mine.sent.map((s) => `<div class="leader"><div style="flex:1"><b>${esc(s.to_name)}</b><div class="muted small">${esc(s.message)}</div></div><span class="muted small">${status[s.status]}</span></div>`).join('')}</div>` : ''}`;
    const form = $('#starForm');
    if (form) form.onsubmit = async (e) => {
      e.preventDefault();
      const name = $('#starTo').value.trim().toLowerCase();
      const to = people.find((p) => p.name.toLowerCase() === name); // shortcut: two guests with the same name get the first; add company to the pick if that happens
      if (!to) return toast('Pick your colleague from the list of names', { error: true });
      await api('/stars', { method: 'POST', body: { to_id: to.id, message: $('#starMsg').value } });
      toast('Star sent! It will be shown once approved.', { icon: '⭐' });
      renderStars();
    };
  }

  // ---------- spin the wheel ----------
  const WHEEL_COLORS = [['var(--teal-700)', 'var(--on-primary)'], ['var(--coral)', 'var(--on-accent)'], ['var(--gold)', 'var(--on-highlight)'], ['var(--teal-500)', 'var(--on-primary)']];
  function wheelSvg(labels) {
    const n = labels.length, seg = 360 / n;
    const pt = (deg) => { const r = (deg * Math.PI) / 180; return `${(100 * Math.sin(r)).toFixed(2)} ${(-100 * Math.cos(r)).toFixed(2)}`; };
    const color = (i) => WHEEL_COLORS[(i === n - 1 && n % WHEEL_COLORS.length === 1 ? 1 : i) % WHEEL_COLORS.length];
    const short = (t) => (t.length > 16 ? t.slice(0, 15) + '…' : t);
    return `<svg viewBox="-110 -110 220 220" class="wheel-svg" role="img" aria-label="Prize wheel: ${esc(labels.join(', '))}">
      <circle r="106" fill="var(--teal-900)"/>
      <g id="wheelRot">${labels.map((l, i) => {
        const [bg, fg] = color(i), mid = (i + 0.5) * seg;
        return `<path d="M0 0 L${pt(i * seg)} A100 100 0 ${seg > 180 ? 1 : 0} 1 ${pt((i + 1) * seg)} Z" fill="${bg}" stroke="#fff" stroke-width="1.2"/>
          <g transform="rotate(${mid})"><text x="0" y="-56" transform="rotate(${mid > 180 ? 90 : -90} 0 -56)" text-anchor="middle" dominant-baseline="middle" fill="${fg}" font-size="${n > 8 ? 7.5 : 9}" font-weight="700">${esc(short(l))}</text></g>`;
      }).join('')}</g>
      <circle r="13" fill="#fff" stroke="var(--teal-900)" stroke-width="3"/>
      <path d="M-9 -112 L9 -112 L0 -92 Z" fill="var(--gold)" stroke="#fff" stroke-width="2"/>
    </svg>`;
  }
  async function renderWheel(id) {
    const w = (await api('/wheels')).find((x) => x.id === id);
    if (!w) { view.innerHTML = '<div class="card empty"><div class="em">🎡</div>This wheel isn’t available. <a href="#engage">Back to Play</a></div>'; return; }
    const seg = 360 / w.prizes.length;
    const resultHtml = (label, win) => win
      ? `<div class="em">🎉</div><h2>You won: ${esc(label)}</h2><p class="muted small">Show this screen at the help desk to collect it.</p>`
      : `<div class="em">🙌</div><h2>${esc(label)}</h2><p class="muted small">Thanks for playing — stay tuned for the next game.</p>`;
    view.innerHTML = `
      <a href="#engage" class="small">← All games</a>
      <div class="card wheel-card">
        <h2 style="font-size:22px">${esc(w.title)}</h2>
        ${w.description ? `<p class="muted small" style="margin:4px 0 0">${esc(w.description)}</p>` : ''}
        <div class="wheel-wrap">${wheelSvg(w.prizes)}</div>
        <div id="wheelResult" class="wheel-result" aria-live="polite"></div>
        ${w.my_label == null && w.status === 'live' ? '<button class="btn block" id="spinBtn">Spin the wheel</button><p class="muted small center" style="margin:8px 0 0">One spin per person.</p>' : ''}
        ${w.my_label == null && w.status !== 'live' ? '<p class="muted center">This wheel has closed.</p>' : ''}
      </div>`;
    const rot = $('#wheelRot');
    // Turn the wheel so segment i sits under the pointer at the top.
    const landOn = (i, turns) => turns * 360 + (360 - (i + 0.5) * seg);
    if (w.my_label != null) {
      rot.style.transform = `rotate(${landOn(w.my_index, 0)}deg)`;
      $('#wheelResult').innerHTML = resultHtml(w.my_label, !!w.my_win);
      return;
    }
    const btn = $('#spinBtn');
    if (!btn) return;
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = 'Spinning…';
      let out;
      try { out = await api(`/wheels/${id}/spin`, { method: 'POST' }); } catch (e) {
        toast(e.message, { error: true }); btn.disabled = false; btn.textContent = 'Spin the wheel'; return;
      }
      const jitter = (Math.random() - 0.5) * seg * 0.6; // land somewhere inside the segment, not dead centre
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      rot.style.transition = still ? 'none' : 'transform 5s cubic-bezier(.15,.75,.1,1)';
      rot.style.transform = `rotate(${landOn(out.index, still ? 0 : 6) + jitter}deg)`;
      setTimeout(() => {
        btn.remove(); $('.wheel-card .center')?.remove();
        $('#wheelResult').innerHTML = resultHtml(out.label, out.win);
        if (out.win) toast(`You won: ${out.label}`, { icon: '🎉' });
      }, still ? 0 : 5200);
    };
  }

  async function renderActivity(id) {
    const d = await api('/activities/' + id);
    const a = d.activity;
    const canAnswer = a.status === 'live' && !d.submitted;
    const chosen = {};
    const r = d.results;
    const qHtml = (q, i) => {
      const rq = r?.questions.find((x) => x.id === q.id);
      if (q.qtype === 'text') {
        return `<div class="question"><div class="qtext">${i + 1}. ${esc(q.text)}</div>
          ${canAnswer ? `<textarea class="input" data-q="${q.id}" rows="3" maxlength="1000" placeholder="Type your answer" style="margin-top:10px"></textarea>`
            : `<div class="muted" style="margin-top:8px">${q.mine?.text_answer ? 'Your answer: “' + esc(q.mine.text_answer) + '”' : 'No answer'}</div>`}</div>`;
      }
      return `<div class="question"><div class="qtext">${i + 1}. ${esc(q.text)}</div>
        <div class="options">
          ${q.options.map((o, oi) => {
            const mine = q.mine?.option_index === oi;
            const pct = rq ? rq.percents[oi] : null;
            const cls = [mine ? 'selected' : '', q.correct_index === oi ? 'correct' : '', q.correct_index != null && mine && q.correct_index !== oi ? 'wrong' : '', rq && rq.topOptions.includes(oi) && a.kind === 'poll' ? 'top' : ''].join(' ');
            return `<button class="option ${cls}" data-q="${q.id}" data-o="${oi}" ${canAnswer ? '' : 'disabled'}>
              ${pct != null ? `<span class="bar" style="width:${pct}%"></span>` : ''}
              <span>${String.fromCharCode(65 + oi)}.</span><span>${esc(o)}</span>
              ${q.correct_index === oi ? '<span>✅</span>' : ''}
              ${pct != null ? `<span class="pct">${pct}%</span>` : ''}
            </button>`;
          }).join('')}
        </div>
        ${rq ? `<div class="muted small" style="margin-top:6px">${rq.responses} response${rq.responses === 1 ? '' : 's'}${rq.correctPercent != null ? ` · ${rq.correctPercent}% got it right` : ''}</div>` : ''}
      </div>`;
    };
    // With artwork, the question form stays folded until the guest taps the artwork (e.g. its "Nominate" button).
    const art = a.image_path;
    const typedOnly = d.questions.every((q) => q.qtype === 'text'); // e.g. a nomination: "answer", not "vote"
    const cta = a.cta_box && JSON.parse(a.cta_box); // the artwork's own button, marked by organisers
    const ctaGlow = cta ? `<span class="cta-glow" style="left:${cta.x}%;top:${cta.y}%;width:${cta.w}%;height:${cta.h}%"></span>` : '';
    view.innerHTML = `
      <div class="card">
        <a href="#engage" class="small">← All quizzes & polls</a>
        <div class="row" style="margin-top:10px">
          <span class="pill ${a.status === 'live' ? 'live' : ''}">${a.status === 'live' ? 'Live' : 'Closed'}</span>
          <span class="pill">${a.kind === 'quiz' ? '🏆 Quiz' : '📊 Poll'}</span>
        </div>
        ${art ? (canAnswer
          ? `<button class="artwork" id="artOpen" aria-label="${esc(a.title)}: tap to answer"><span class="art-frame"><img src="/uploads/${esc(art)}" alt="${esc(a.title)}">${ctaGlow}</span></button>
             ${cta ? '' : '<button class="btn block cta-btn" id="ctaOpen">Tap to answer</button>'}`
          : `<div class="artwork"><span class="art-frame"><img src="/uploads/${esc(art)}" alt="${esc(a.title)}"></span></div>`) : ''}
        <h2 style="font-size:22px;margin-top:10px" ${art ? 'class="sr-only"' : ''}>${esc(a.title)}</h2>
        ${a.description ? `<p class="muted" style="margin:6px 0 0">${esc(a.description)}</p>` : ''}
        ${d.submitted && a.kind === 'quiz' ? `
          <div class="scorebox"><div class="big">${d.my_score}${r ? '/' + r.maxScore : ''}</div>
            <div><b>Your score</b><div class="muted small">${r?.myRank ? `You ranked #${r.myRank} of ${r.participants}` : 'Results and the winner will be revealed by the organisers.'}</div></div></div>` : ''}
        ${d.submitted && a.kind === 'poll' ? `<div class="pill ok" style="margin-top:12px">✓ ${typedOnly ? 'Thanks, your answer is in!' : 'Thanks for voting!'}</div>` : ''}
        ${r?.winner ? `<div class="scorebox"><div class="big">🏆</div><div><div class="muted small">Winner</div><b style="font-size:18px">${esc(r.winner.name)}</b><div class="muted small">${esc(r.winner.company || '')} · ${r.winner.score}/${r.maxScore}</div></div></div>` : ''}
        <div id="actForm" ${art && canAnswer ? 'hidden' : ''}>
          ${d.questions.map(qHtml).join('')}
          ${canAnswer ? '<button class="btn block" id="submitAct" style="margin-top:20px" disabled>Submit</button>' : ''}
        </div>
        ${!canAnswer && !d.submitted && a.status !== 'live' ? '<p class="muted" style="margin-top:16px">This one has closed.</p>' : ''}
      </div>
      ${r?.top?.length ? `<div class="section-title"><h2>Top 10</h2><span class="muted small">${r.participants} of ${r.totalAttendees} took part</span></div>
        <div class="card">${r.top.map((x) => `<div class="leader"><div class="rank">${x.rank}</div><div style="flex:1"><b>${esc(x.name)}</b><div class="muted small">${esc(x.company || '')}</div></div><b>${x.score}</b></div>`).join('')}</div>` : ''}`;

    // Skip past the event header so the artwork (and its button) fill the screen.
    if (art) {
      const img = $('.artwork img', view), go = () => $('.card', view)?.scrollIntoView({ block: 'start' });
      img.complete ? go() : img.addEventListener('load', go, { once: true }); // the page is only tall enough once the image is in
    }
    if (!canAnswer) return;
    const choiceQs = d.questions.filter((q) => q.qtype === 'choice').map((q) => q.id);
    const btn = $('#submitAct');
    // Every question needs an answer, typed ones included.
    const refresh = () => (btn.disabled = !choiceQs.every((q) => chosen[q] != null) || $$('#actForm textarea').some((t) => !t.value.trim()));
    $$('#actForm textarea').forEach((t) => (t.oninput = refresh));
    const openForm = () => {
      $('#actForm').hidden = false;
      $('#ctaOpen')?.remove();
      const first = $('#actForm textarea, #actForm .option');
      first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (first.tagName === 'TEXTAREA') first.focus({ preventScroll: true });
    };
    $('#artOpen') && ($('#artOpen').onclick = openForm);
    $('#ctaOpen') && ($('#ctaOpen').onclick = openForm);
    $$('.option').forEach((o) => (o.onclick = () => {
      const q = Number(o.dataset.q);
      chosen[q] = Number(o.dataset.o);
      $$(`.option[data-q="${q}"]`).forEach((x) => x.classList.toggle('selected', x === o));
      refresh();
    }));
    refresh();
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = 'Submitting…';
      const answers = d.questions.map((q) => (q.qtype === 'text' ? { question_id: q.id, text: $(`textarea[data-q="${q.id}"]`).value } : { question_id: q.id, option_index: chosen[q.id] }));
      try {
        const out = await api(`/activities/${id}/submit`, { method: 'POST', body: { answers } });
        toast(a.kind === 'quiz' ? `Submitted! You scored ${out.score}.` : typedOnly ? `Answer submitted — thank you!${out.score ? ` +${out.score} point${out.score === 1 ? '' : 's'}` : ''}` : `Vote recorded — thanks!${out.score ? ` +${out.score} point${out.score === 1 ? '' : 's'}` : ''}`, { icon: '🎉' });
        renderActivity(id);
      } catch (e) {
        toast(e.message, { error: true }); btn.disabled = false; btn.textContent = 'Submit';
      }
    };
  }

  // ---------- GALLERY ----------
  async function renderGallery() {
    const [items, mine] = await Promise.all([api('/gallery'), api('/my-media')]);
    state.gallery = items;
    const pending = mine.filter((m) => m.status === 'pending').length;
    const official = items.filter((m) => m.official), shared = items.filter((m) => !m.official);
    const tile = (m) => `<button class="tile" data-id="${m.id}">
      ${m.media_type === 'video' ? `<video src="/uploads/${esc(m.file_path)}#t=0.5" muted preload="metadata"></video><div class="play">▶</div>` : `<img src="/uploads/${esc(m.file_path)}" loading="lazy" alt="${esc(m.caption || '')}">`}
      ${m.official ? '<span class="badge">Official</span>' : ''}</button>`;
    view.innerHTML = `
      <div class="card stack">
        <h2 style="font-size:20px">Share your moments</h2>
        <label class="dropzone" id="drop">
          <input type="file" id="files" accept="image/*,video/*" multiple hidden>
          <div style="font-size:28px">📸</div>
          <b>Tap to add photos or videos</b>
          <div class="muted small">or drag them here · up to 20 at a time</div>
        </label>
        <div id="picked" class="hidden stack">
          <div class="muted small" id="pickedInfo"></div>
          <input class="input" id="caption" maxlength="300" placeholder="Add a caption (optional)">
          <button class="btn block" id="uploadBtn">Upload</button>
          <div class="progress hidden" id="prog"><div></div></div>
        </div>
        ${pending ? `<div class="pill gold">⏳ ${pending} of your upload${pending === 1 ? ' is' : 's are'} waiting for approval</div>` : ''}
      </div>
      ${official.length ? `<div class="section-title"><h2>Official photos & videos</h2><span class="muted small">${official.length}</span></div><div class="grid">${official.map(tile).join('')}</div>` : ''}
      <div class="section-title"><h2>From the guests</h2><span class="muted small">${shared.length}</span></div>
      ${shared.length ? `<div class="grid">${shared.map(tile).join('')}</div>` : '<div class="card empty"><div class="em">🏖️</div>Be the first to share a photo!</div>'}`;

    const input = $('#files'), drop = $('#drop');
    let files = [];
    const pick = (list) => {
      files = [...list].filter((f) => /^(image|video)\//.test(f.type)).slice(0, 20);
      $('#picked').classList.toggle('hidden', !files.length);
      const mb = files.reduce((s, f) => s + f.size, 0) / 1048576;
      $('#pickedInfo').textContent = `${files.length} file${files.length === 1 ? '' : 's'} selected · ${mb.toFixed(1)} MB`;
    };
    input.onchange = () => pick(input.files);
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
    drop.addEventListener('drop', (e) => pick(e.dataTransfer.files));
    $('#uploadBtn').onclick = () => {
      if (!files.length) return;
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      fd.append('caption', $('#caption').value);
      const xhr = new XMLHttpRequest();
      const prog = $('#prog'); prog.classList.remove('hidden');
      $('#uploadBtn').disabled = true;
      xhr.upload.onprogress = (e) => e.lengthComputable && (prog.firstElementChild.style.width = (e.loaded / e.total) * 100 + '%');
      xhr.onload = () => {
        const out = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 400) { toast(out.error || 'Upload failed', { error: true }); $('#uploadBtn').disabled = false; return; }
        toast(out.status === 'approved' ? 'Uploaded to the gallery!' : 'Uploaded! It will appear once the organisers approve it.', { icon: '✅' });
        renderGallery();
      };
      xhr.onerror = () => { toast('Upload failed — check your connection', { error: true }); $('#uploadBtn').disabled = false; };
      xhr.open('POST', '/api/media');
      xhr.setRequestHeader('x-token', token);
      xhr.send(fd);
    };
    $$('.tile').forEach((t) => (t.onclick = () => openLightbox(state.gallery.findIndex((m) => m.id === Number(t.dataset.id)))));
  }

  function openLightbox(i) {
    const items = state.gallery;
    if (i < 0) return;
    let idx = i;
    const lb = document.createElement('div');
    lb.className = 'lightbox';
    const draw = () => {
      const m = items[idx];
      lb.innerHTML = `
        <button class="btn sm secondary close">✕ Close</button>
        ${items.length > 1 ? '<button class="nav prev">‹</button><button class="nav next">›</button>' : ''}
        <div class="inner">
          ${m.media_type === 'video' ? `<video src="/uploads/${esc(m.file_path)}" controls autoplay playsinline></video>` : `<img src="/uploads/${esc(m.file_path)}" alt="">`}
          <div class="cap">${m.caption ? esc(m.caption) + '<br>' : ''}<span class="small" style="opacity:.7">${m.official ? 'Official' : 'Shared by ' + esc(m.uploader || 'a guest')}</span>
            · <a href="/uploads/${esc(m.file_path)}" download style="color:var(--gold)">Download</a></div>
        </div>`;
      $('.close', lb).onclick = close;
      if (items.length > 1) {
        $('.prev', lb).onclick = (e) => { e.stopPropagation(); idx = (idx - 1 + items.length) % items.length; draw(); };
        $('.next', lb).onclick = (e) => { e.stopPropagation(); idx = (idx + 1) % items.length; draw(); };
      }
    };
    const key = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') $('.next', lb)?.click(); if (e.key === 'ArrowLeft') $('.prev', lb)?.click(); };
    function close() { lb.remove(); document.removeEventListener('keydown', key); }
    lb.addEventListener('click', (e) => e.target === lb && close());
    document.addEventListener('keydown', key);
    draw();
    document.body.append(lb);
  }

  // ---------- CHAT ----------
  async function renderChat(peer) {
    const [people, convos] = await Promise.all([api('/people'), api('/conversations')]);
    state.unread = convos.reduce((s, c) => s + c.unread, 0);
    updateChatDot();
    const peerId = peer === 'lounge' ? 'lounge' : peer ? Number(peer) : null;
    state.chatPeer = peerId;
    const online = new Set(people.filter((p) => p.online).map((p) => p.id));
    const convoIds = new Set(convos.map((c) => c.peer.id));
    const listHtml = `
      <a class="convo ${peerId === 'lounge' ? 'active' : ''}" href="#chat/lounge"><div class="ava lounge">🌴</div><div class="who"><b>The Lounge</b><div class="muted small">Group chat with everyone</div></div></a>
      ${convos.map((c) => `<a class="convo ${peerId === c.peer.id ? 'active' : ''}" href="#chat/${c.peer.id}">
        <div class="ava ${online.has(c.peer.id) ? 'online' : ''}">${initials(c.peer.name)}</div>
        <div class="who"><b>${esc(c.peer.name)}</b><div class="muted small">${esc(c.last?.body || '')}</div></div>
        ${c.unread ? `<span class="unread">${c.unread}</span>` : ''}</a>`).join('')}
      <div class="section-title" style="margin:16px 4px 6px"><h2 style="font-size:15px">People</h2><span class="muted small">${people.length}</span></div>
      <input class="input" id="peopleSearch" placeholder="Search name or company">
      <div id="peopleList" style="max-height:340px;overflow-y:auto;margin-top:6px"></div>`;

    view.innerHTML = `<div class="chat-layout">
      <div class="card ${peerId && window.innerWidth < 820 ? 'hidden' : ''}" id="convoList">${listHtml}</div>
      <div class="card thread ${!peerId ? 'hidden-mobile' : ''}" id="threadBox"></div></div>`;
    if (!peerId && window.innerWidth < 820) $('#threadBox').classList.add('hidden');

    const drawPeople = (q = '') => {
      q = q.toLowerCase();
      $('#peopleList').innerHTML = people.filter((p) => !convoIds.has(p.id) && (`${p.name} ${p.company || ''}`).toLowerCase().includes(q))
        .map((p) => `<a class="convo" href="#chat/${p.id}"><div class="ava ${p.online ? 'online' : ''}">${initials(p.name)}</div>
          <div class="who"><b>${esc(p.name)}</b><div class="muted small">${esc([p.designation, p.company].filter(Boolean).join(', '))}</div></div></a>`).join('')
        || '<div class="muted small" style="padding:8px">No one found</div>';
    };
    drawPeople();
    $('#peopleSearch').oninput = (e) => drawPeople(e.target.value);

    const box = $('#threadBox');
    if (!peerId) { box.innerHTML = '<div class="empty" style="margin:auto"><div class="em">💬</div>Pick the Lounge or a person to start chatting.</div>'; return; }
    const who = peerId === 'lounge' ? { name: 'The Lounge' } : people.find((p) => p.id === peerId) || convos.find((c) => c.peer.id === peerId)?.peer;
    if (!who) { box.innerHTML = '<div class="empty">Person not found.</div>'; return; }
    box.innerHTML = `
      <div class="row" style="padding-bottom:10px;border-bottom:1px solid var(--line)">
        <a href="#chat" class="btn sm ghost" style="padding:6px 10px">←</a>
        <div class="ava ${peerId === 'lounge' ? 'lounge' : online.has(peerId) ? 'online' : ''}">${peerId === 'lounge' ? '🌴' : initials(who.name)}</div>
        <div><b>${esc(who.name)}</b><div class="muted small">${peerId === 'lounge' ? 'Everyone at ' + esc(state.cfg.eventName) : esc([who.designation, who.company].filter(Boolean).join(', '))}</div></div>
      </div>
      <div class="msgs" id="msgs"></div>
      <form class="composer" id="composer"><textarea class="input" name="body" placeholder="Write a message" maxlength="2000"></textarea><button class="btn">Send</button></form>`;
    state.chatMsgs = await api('/messages/' + peerId);
    drawMsgs();
    if (peerId !== 'lounge') { state.unread = Math.max(0, state.unread - (convos.find((c) => c.peer.id === peerId)?.unread || 0)); updateChatDot(); }
    const form = $('#composer');
    const send = async () => {
      const body = form.body.value.trim(); if (!body) return;
      form.body.value = '';
      try { await api('/messages', { method: 'POST', body: { to: peerId, body } }); } catch (e) { toast(e.message, { error: true }); form.body.value = body; }
    };
    form.onsubmit = (e) => { e.preventDefault(); send(); };
    form.body.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
  }
  function drawMsgs() {
    const el = $('#msgs'); if (!el) return;
    el.innerHTML = state.chatMsgs.map((m) => `<div class="bubble ${m.from_id === state.me.id ? 'me' : ''}">`
      + (state.chatPeer === 'lounge' && m.from_id !== state.me.id ? `<div class="from">${esc(m.from_name)}</div>` : '')
      + `<div>${linkify(m.body)}</div><div class="t">${toDate(m.created_at) ? fmtTime(toDate(m.created_at)) : ''}</div></div>`).join('')
      || '<div class="empty" style="margin:auto">Say hello 👋</div>';
    el.scrollTop = el.scrollHeight;
  }
  function updateChatDot() {
    const dot = $('#chatDot');
    dot.textContent = state.unread; dot.classList.toggle('hidden', !state.unread);
  }

  // ---------- event pass ----------
  const passSrc = () => '/api/me/qr.svg?t=' + encodeURIComponent(token);
  function showPass() {
    const bd = document.createElement('div');
    bd.className = 'pass-full';
    bd.innerHTML = `<div class="inner"><img src="${passSrc()}" alt="Your event pass QR code">
      <h2>${esc(state.me.name)}</h2><div class="muted">${esc(state.me.company || '')}</div>
      <p class="muted small">Turn your screen brightness up. Tap anywhere to close.</p></div>`;
    bd.onclick = () => bd.remove();
    document.body.append(bd);
  }

  // ---------- profile sheet ----------
  function openProfile() {
    const me = state.me;
    const bd = document.createElement('div');
    bd.className = 'sheet-backdrop';
    bd.innerHTML = `<div class="sheet stack">
      <div class="row"><div class="ava" style="width:52px;height:52px;font-size:18px">${initials(me.name)}</div>
        <div><h2 style="font-size:20px">${esc(me.name)}</h2><div class="muted small">${esc([me.designation, me.company].filter(Boolean).join(', '))}</div></div></div>
      <div>
        <div class="muted small" style="font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-top:6px">Notify me about new updates</div>
        <label class="switch"><span>💬 WhatsApp <span class="muted small">${esc(me.phone ? '+' + me.phone : 'no number on file')}</span></span><input type="checkbox" id="nWa" ${me.notify_whatsapp ? 'checked' : ''}></label>
        <label class="switch"><span>✉️ Email <span class="muted small">${esc(me.email || 'no email on file')}</span></span><input type="checkbox" id="nEm" ${me.notify_email ? 'checked' : ''}></label>
      </div>
      <p class="muted small">Wrong number or email? Contact the help desk and we will update it.</p>
      <div class="row"><button class="btn ghost" id="closeSheet">Close</button><span class="spacer"></span><button class="btn" id="saveSheet">Save</button></div>
    </div>`;
    document.body.append(bd);
    const close = () => bd.remove();
    bd.onclick = (e) => e.target === bd && close();
    $('#closeSheet', bd).onclick = close;
    $('#saveSheet', bd).onclick = async () => {
      const body = { notify_whatsapp: $('#nWa', bd).checked, notify_email: $('#nEm', bd).checked };
      await api('/me', { method: 'PATCH', body });
      Object.assign(state.me, { notify_whatsapp: body.notify_whatsapp ? 1 : 0, notify_email: body.notify_email ? 1 : 0 });
      toast('Preferences saved', { icon: '✅' }); close();
    };
  }

  // ---------- live updates ----------
  function connectLive() {
    const es = new EventSource('/api/stream?t=' + encodeURIComponent(token));
    const tab = () => (location.hash.replace(/^#/, '').split('/')[0] || 'feed');
    es.addEventListener('post', (e) => {
      const p = JSON.parse(e.data);
      if (p.id) toast(`New update: ${p.title}`, { href: '#post-' + p.id, icon: p.media_type === 'video' ? '🎬' : '📣' });
      if (tab() === 'feed') renderFeed();
    });
    es.addEventListener('activity', (e) => {
      const a = JSON.parse(e.data);
      if (a.status === 'live' && a.title && !a.reveal) toast(`${a.kind === 'quiz' ? 'Quiz' : 'Poll'} is live: ${a.title}`, { href: '#engage/' + a.id, icon: a.kind === 'quiz' ? '🏆' : '📊', ms: 8000 });
      if (a.reveal) toast('Results are in!', { href: '#engage/' + a.id, icon: '🏆' });
      const [t, arg] = location.hash.replace(/^#/, '').split('/');
      if (t === 'engage' && (!arg || Number(arg) === a.id)) {
        if (!(arg && a.status === 'live' && !a.reveal)) renderEngage(arg); // don't wipe an in-progress answer sheet
      } else if (tab() === 'feed') renderFeed();
      else api('/activities').then((x) => { state.activities = x; updateEngageDot(); }).catch(() => {});
    });
    es.addEventListener('activity-progress', (e) => {
      const { id } = JSON.parse(e.data);
      const [t, arg] = location.hash.replace(/^#/, '').split('/');
      if (t === 'engage' && Number(arg) === id && !$('#submitAct')) renderActivity(id);
    });
    es.addEventListener('wheel', (e) => {
      const w = JSON.parse(e.data);
      if (w.status === 'live' && w.title) toast(`Spin the wheel: ${w.title}`, { href: '#engage/w' + w.id, icon: '🎡', ms: 8000 });
      const [t, arg] = location.hash.replace(/^#/, '').split('/');
      if (t === 'engage' && (!arg || (arg === 'w' + w.id && !$('#spinBtn')?.disabled))) renderEngage(arg);
      else api('/wheels').then((x) => { state.wheels = x; updateEngageDot(); }).catch(() => {});
    });
    // A locked phone misses live events: catch up on check-in when the guest comes back to the page.
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden) return;
      const me = await api('/me').catch(() => null);
      if (!me || me.checked_in_at === state.me.checked_in_at) return;
      state.me.checked_in_at = me.checked_in_at;
      if (tab() === 'feed') renderFeed();
    });
    es.addEventListener('star', (e) => {
      toast(`${JSON.parse(e.data).from || 'A colleague'} sent you a Star Spotlight!`, { icon: '⭐', href: '#engage/stars' });
      if (location.hash === '#engage/stars') renderStars();
    });
    es.addEventListener('draw', (e) => toast(`You won the lucky draw: ${JSON.parse(e.data).title}! Please come to the stage or help desk.`, { icon: '🎉' }));
    es.addEventListener('checkin', (e) => {
      state.me.checked_in_at = JSON.parse(e.data).checked_in_at;
      $('.pass-full')?.remove();
      if (state.me.checked_in_at) toast(`Checked in, welcome to ${state.cfg.eventName}!`, { icon: '✅' });
      if (tab() === 'feed') renderFeed();
    });
    es.addEventListener('agenda', () => { if (tab() === 'agenda') renderAgenda(); });
    es.addEventListener('branding', (e) => { state.cfg.branding = JSON.parse(e.data); renderHeader(); });
    es.addEventListener('gallery', () => { if (tab() === 'gallery' && !$('.lightbox') && $('#picked')?.classList.contains('hidden')) renderGallery(); });
    es.addEventListener('settings', () => { if (tab() === 'engage') renderEngage(location.hash.split('/')[1]); });
    const onMsg = (m) => {
      const mine = m.from_id === state.me.id;
      const peerOf = m.to_id == null ? 'lounge' : mine ? m.to_id : m.from_id;
      if (state.chatPeer === peerOf && tab() === 'chat') {
        state.chatMsgs.push(m); drawMsgs();
        if (!mine && peerOf !== 'lounge') api('/messages/' + peerOf).catch(() => {}); // marks read
      } else if (!mine && m.to_id != null) {
        state.unread++; updateChatDot();
        toast(`${m.from_name}: ${m.body.slice(0, 80)}`, { href: '#chat/' + m.from_id, icon: '💬' });
      }
    };
    es.addEventListener('dm', (e) => onMsg(JSON.parse(e.data)));
    es.addEventListener('lounge', (e) => onMsg(JSON.parse(e.data)));
  }

  // ---------- boot ----------
  async function boot() {
    state.cfg = await fetch('/api/config').then((r) => r.json());
    renderHeader();
    if (!token) return renderGate();
    try {
      state.me = await api('/me');
    } catch { return; }
    $('#tabs').classList.remove('hidden');
    const meBtn = $('#meBtn');
    meBtn.textContent = initials(state.me.name);
    meBtn.classList.remove('hidden');
    meBtn.onclick = openProfile;
    connectLive();
    api('/conversations').then((c) => { state.unread = c.reduce((s, x) => s + x.unread, 0); updateChatDot(); }).catch(() => {});
    route();
  }
  boot();
})();
