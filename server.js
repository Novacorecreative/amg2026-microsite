// AMG 2026 event microsite — Express server.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

if (fs.existsSync(path.join(__dirname, '.env'))) process.loadEnvFile(path.join(__dirname, '.env'));

const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const { db, getSetting, setSetting, tx } = require('./src/db');
const { broadcast, channelStatus, personalLink, normalisePhone, emailHtml, BASE_URL } = require('./src/notify');
const live = require('./src/live');
const { getBranding, isHex, partnerFiles, HERO_TINTS, FONTS, MAX_PARTNERS } = require('./src/branding');

const env = (k, d = '') => (process.env[k] ?? d).trim();
const PORT = Number(env('PORT', '3000'));
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let ADMIN_PASSWORD = env('ADMIN_PASSWORD');
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = crypto.randomBytes(6).toString('hex');
  console.warn(`[admin] ADMIN_PASSWORD not set — using a temporary one for this run: ${ADMIN_PASSWORD}`);
}

const app = express();
app.set('trust proxy', 1); // Render's proxy: req.ip is the guest's address, not the proxy's
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: 'text/csv', limit: '2mb' }));
// Uploaded files are served inert: no scripts can run even if someone opens one directly.
app.use('/uploads', express.static(UPLOAD_DIR, {
  maxAge: '7d',
  setHeaders: (res) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  },
}));
// no-cache = browsers re-check (cheaply, via ETag) on every load, so phones never mix old scripts with a new server after a deploy.
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));
// QR decoder for the check-in desk's camera scanner.
app.get('/vendor/jsQR.js', (_req, res) => res.sendFile(require.resolve('jsqr/dist/jsQR.js')));

const newToken = () => crypto.randomBytes(18).toString('base64url');
const now = () => new Date().toISOString();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// ---------------- uploads ----------------
const MAX_MB = Number(env('MAX_UPLOAD_MB', '250'));
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname) || '').toLowerCase().replace(/[^.\w]/g, '').slice(0, 8);
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 20 },
  // SVG can carry scripts, so only organisers (e.g. for a logo) may upload it.
  fileFilter: (req, file, cb) => cb(null, /^(image|video)\//.test(file.mimetype)
    && (file.mimetype !== 'image/svg+xml' || req.baseUrl === '/api/admin')),
});
const mediaType = (mime) => (String(mime).startsWith('video/') ? 'video' : 'image');

// ---------------- auth ----------------
const touch = db.prepare('UPDATE attendees SET last_seen = ? WHERE id = ?');
function attendeeAuth(req, res, next) {
  const token = req.get('x-token') || req.query.t;
  if (!token) return bad(res, 'Please open the microsite from your personal link.', 401);
  const a = db.prepare('SELECT * FROM attendees WHERE token = ?').get(String(token));
  if (!a) return bad(res, 'This link is not valid any more. Ask for a new one.', 401);
  if (!a.last_seen || Date.now() - Date.parse(a.last_seen) > 60_000) touch.run(now(), a.id);
  req.me = a;
  next();
}
function adminAuth(req, res, next) {
  const t = req.get('x-admin') || req.query.a;
  if (!t || !db.prepare('SELECT 1 FROM admin_sessions WHERE token = ?').get(String(t))) return bad(res, 'Admin login required', 401);
  next();
}
const publicAttendee = (a) => ({ id: a.id, name: a.name, company: a.company, designation: a.designation });

// ---------------- public ----------------
// Home-screen app. start_url carries the guest's own link: iPhones keep a home-screen app's sign-in apart from Safari's.
app.get('/manifest.webmanifest', (req, res) => {
  const b = getBranding();
  const t = /^[\w-]{16,64}$/.test(String(req.query.t || '')) ? req.query.t : '';
  res.type('application/manifest+json').json({
    id: '/', name: b.eventName, short_name: b.eventName, start_url: t ? `/?t=${t}` : '/', scope: '/',
    display: 'standalone', background_color: '#ffffff', theme_color: b.colorPrimary,
    icons: [192, 512].map((n) => ({ src: `/icons/icon-${n}.png`, sizes: `${n}x${n}`, type: 'image/png', purpose: 'any maskable' })),
  });
});

app.get('/api/config', (_req, res) => {
  const branding = getBranding();
  res.json({
    eventName: branding.eventName,
    clientName: branding.clientName,
    branding,
    city: env('EVENT_CITY', 'Goa'),
    venue: env('EVENT_VENUE', 'Venue to be announced'),
    venueMapUrl: env('EVENT_VENUE_MAP_URL'),
    startDate: env('EVENT_START_DATE', '2026-12-03'),
    endDate: env('EVENT_END_DATE', '2026-12-05'),
    helpdeskPhone: env('HELPDESK_PHONE'),
    helpdeskEmail: env('HELPDESK_EMAIL'),
    timezone: 'Asia/Kolkata',
    ...agendaInfo(),
  });
});

// Agenda intro line and a theme title per day (e.g. "Arrival, Beach Experience & Star Achiever Awards").
function agendaInfo() {
  let days = {};
  try { days = JSON.parse(getSetting('agenda_day_titles') || '{}') || {}; } catch { /* ignore */ }
  return { agendaIntro: getSetting('agenda_intro') || '', agendaDayTitles: days };
}

// "Lost your link?" — always answers OK so nobody can probe who is registered.
app.post('/api/resend-link', (req, res) => {
  const contact = String(req.body?.contact || '').trim();
  if (contact.includes('@')) { // email only: WhatsApp sending isn't connected
    const a = db.prepare('SELECT * FROM attendees WHERE lower(email) = lower(?)').get(contact);
    if (a) {
      broadcast({
        title: 'Your personal access link',
        waHeadline: 'here is your personal access link',
        message: 'Tap the button below to open the event microsite. You will stay signed in on this device.',
        attendeeIds: [a.id],
        channels: ['email'],
      });
    }
  }
  res.json({ ok: true });
});

// Self sign-up from the one shared join link / QR.
// Someone on the list whose email AND mobile both match is signed straight in; if only one matches,
// their link is sent to the contact we already have (so nobody can take over a colleague's pass by
// typing their email). People not on the list are added and flagged for the organisers.
const signups = new Map(); // ip -> recent sign-up times
app.post('/api/register', (req, res) => {
  const ip = req.ip, t = Date.now();
  const recent = (signups.get(ip) || []).filter((x) => t - x < 10 * 60_000); // shortcut: in-memory, resets on restart; fine for one event
  if (recent.length >= 60) return bad(res, 'Too many sign-ups from this network. Please try again in a few minutes.', 429);
  signups.set(ip, [...recent, t]);

  const b = req.body || {};
  const name = String(b.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const email = String(b.email || '').trim().toLowerCase();
  const phone = normalisePhone(b.phone);
  if (name.length < 2) return bad(res, 'Please enter your full name');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad(res, 'Please enter a valid email address');
  if (!/^\d{11,13}$/.test(phone)) return bad(res, 'Please enter a valid mobile number');

  const byEmail = db.prepare('SELECT * FROM attendees WHERE lower(email) = ?').get(email);
  const byPhone = db.prepare('SELECT * FROM attendees WHERE phone = ?').get(phone);
  if (byEmail && byPhone && byEmail.id === byPhone.id) {
    db.prepare('UPDATE attendees SET registered_at = COALESCE(registered_at, ?) WHERE id = ?').run(now(), byEmail.id);
    return res.json({ token: byEmail.token });
  }
  const known = byEmail || byPhone;
  if (known) {
    // Links go by email only (WhatsApp sending isn't connected).
    if (!known.email) return res.json({ sent: 'none' });
    broadcast({
      title: 'Your personal access link', waHeadline: 'here is your personal access link',
      message: 'Tap the button below to open the event microsite. You will stay signed in on this device.',
      attendeeIds: [known.id], channels: ['email'],
    });
    return res.json({ sent: 'email' });
  }
  const token = newToken();
  db.prepare('INSERT INTO attendees(name,email,phone,token,registered_at,self_added) VALUES (?,?,?,?,?,1)').run(name, email, phone, token, now());
  res.json({ token });
});

// ---------------- attendee ----------------
const api = express.Router();
api.use(attendeeAuth);

api.get('/me', (req, res) => {
  const { token, ...me } = req.me;
  res.json(me);
});
// The guest's event pass: a QR of their personal link, scanned at the check-in desk.
api.get('/me/qr.svg', wrap(async (req, res) => {
  res.set('Content-Type', 'image/svg+xml').set('Cache-Control', 'private, max-age=86400');
  res.send(await QRCode.toString(personalLink(req.me), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
}));
api.patch('/me', (req, res) => {
  const b = req.body || {};
  db.prepare('UPDATE attendees SET notify_whatsapp = ?, notify_email = ?, designation = COALESCE(?, designation) WHERE id = ?').run(
    b.notify_whatsapp ? 1 : 0, b.notify_email ? 1 : 0, b.designation ?? null, req.me.id
  );
  res.json({ ok: true });
});

api.get('/feed', (_req, res) => {
  res.json(db.prepare('SELECT * FROM posts ORDER BY pinned DESC, created_at DESC, id DESC').all());
});

api.get('/agenda', (_req, res) => {
  res.json(db.prepare('SELECT * FROM sessions ORDER BY day, start_time, id').all());
});

api.get('/agenda.ics', (_req, res) => {
  const rows = db.prepare('SELECT * FROM sessions ORDER BY day, start_time, id').all();
  const fmt = (day, t) => `${day.replace(/-/g, '')}T${t.replace(':', '')}00`;
  const escIcs = (s) => String(s || '').replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AMG2026//Microsite//EN', 'CALSCALE:GREGORIAN'];
  const stamp = `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  // Items without a fixed time go into one all-day event per day.
  const { agendaDayTitles } = agendaInfo();
  const untimed = Object.groupBy(rows.filter((s) => !s.start_time), (s) => s.day);
  for (const [day, items] of Object.entries(untimed)) {
    const next = new Date(`${day}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    lines.push('BEGIN:VEVENT', `UID:amg2026-day-${day}@microsite`, stamp,
      `DTSTART;VALUE=DATE:${day.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, '')}`,
      `SUMMARY:${escIcs(agendaDayTitles[day] || getBranding().eventName)}`,
      `DESCRIPTION:${escIcs(items.map((s) => '• ' + s.title).join('\n'))}`, 'END:VEVENT');
  }
  for (const s of rows.filter((x) => x.start_time)) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:amg2026-session-${s.id}@microsite`,
      stamp,
      `DTSTART;TZID=Asia/Kolkata:${fmt(s.day, s.start_time)}`,
      `DTEND;TZID=Asia/Kolkata:${fmt(s.day, s.end_time)}`,
      `SUMMARY:${escIcs(s.title)}`,
      `LOCATION:${escIcs(s.location)}`,
      `DESCRIPTION:${escIcs([s.speaker, s.description].filter(Boolean).join(' — '))}`,
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="AMG2026-agenda.ics"');
  res.send(lines.join('\r\n'));
});

// ----- quizzes & polls -----
function loadQuestions(activityId) {
  return db.prepare('SELECT * FROM questions WHERE activity_id = ? ORDER BY position, id').all(activityId)
    .map((q) => ({ ...q, options: JSON.parse(q.options || '[]') }));
}

function resultsFor(activityId) {
  const act = db.prepare('SELECT * FROM activities WHERE id = ?').get(activityId);
  if (!act) return null;
  const totalAttendees = db.prepare('SELECT COUNT(*) n FROM attendees').get().n;
  const participants = db.prepare('SELECT COUNT(*) n FROM submissions WHERE activity_id = ? AND submitted_at IS NOT NULL').get(activityId).n;
  const questions = loadQuestions(activityId).map((q) => {
    const rows = db.prepare(`SELECT x.option_index, x.text_answer, x.is_correct, a.name, a.company FROM answers x
      JOIN attendees a ON a.id = x.attendee_id WHERE x.question_id = ? ORDER BY x.answered_at, x.id`).all(q.id);
    const counts = q.options.map(() => 0);
    let correct = 0;
    const texts = [];
    for (const r of rows) {
      if (r.option_index != null && counts[r.option_index] != null) counts[r.option_index]++;
      if (r.is_correct) correct++;
      if (r.text_answer) texts.push({ name: r.name, company: r.company, text: r.text_answer });
    }
    const max = Math.max(0, ...counts);
    return {
      id: q.id, text: q.text, qtype: q.qtype, options: q.options, points: q.points,
      correct_index: q.correct_index,
      responses: rows.length,
      counts,
      percents: counts.map((c) => (rows.length ? Math.round((c / rows.length) * 1000) / 10 : 0)),
      topOptions: max > 0 ? counts.map((c, i) => (c === max ? i : -1)).filter((i) => i >= 0) : [],
      correctCount: act.kind === 'quiz' && q.correct_index != null ? correct : null,
      correctPercent: act.kind === 'quiz' && q.correct_index != null && rows.length ? Math.round((correct / rows.length) * 1000) / 10 : null,
      textAnswers: q.qtype === 'text' ? texts : undefined,
    };
  });
  let rankings = [];
  if (act.kind === 'quiz' || questions.some((q) => q.qtype === 'text')) { // typed answers earn points in polls too
    rankings = db.prepare(`
      SELECT s.attendee_id, s.score, s.duration_ms, s.submitted_at, a.name, a.company
      FROM submissions s JOIN attendees a ON a.id = s.attendee_id
      WHERE s.activity_id = ? AND s.submitted_at IS NOT NULL
      ORDER BY s.score DESC, s.duration_ms ASC, s.submitted_at ASC`).all(activityId);
    rankings.forEach((r, i) => (r.rank = i + 1));
  }
  const maxScore = questions.filter((q) => q.correct_index != null || q.qtype === 'text').reduce((s, q) => s + q.points, 0);
  return {
    activity: act, totalAttendees, participants,
    participationPercent: totalAttendees ? Math.round((participants / totalAttendees) * 1000) / 10 : 0,
    maxScore, questions, rankings,
    winner: rankings[0] || null,
  };
}

api.get('/activities', (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, s.submitted_at AS my_submitted_at, s.score AS my_score,
      (SELECT COUNT(*) FROM questions q WHERE q.activity_id = a.id) AS question_count
    FROM activities a LEFT JOIN submissions s ON s.activity_id = a.id AND s.attendee_id = ?
    WHERE a.status IN ('live','closed') ORDER BY (a.status = 'live') DESC, a.opened_at DESC`).all(req.me.id);
  res.json(rows);
});

api.get('/activities/:id', (req, res) => {
  const act = db.prepare("SELECT * FROM activities WHERE id = ? AND status IN ('live','closed')").get(req.params.id);
  if (!act) return bad(res, 'Not found', 404);
  const sub = db.prepare('SELECT * FROM submissions WHERE activity_id = ? AND attendee_id = ?').get(act.id, req.me.id);
  if (act.status === 'live' && !sub) {
    db.prepare('INSERT OR IGNORE INTO submissions(activity_id, attendee_id, started_at) VALUES (?,?,?)').run(act.id, req.me.id, now());
  }
  const done = !!sub?.submitted_at;
  const revealAnswers = act.kind === 'quiz' && (act.status === 'closed' || act.results_visible);
  const mine = Object.fromEntries(
    db.prepare('SELECT a.question_id, a.option_index, a.text_answer, a.is_correct FROM answers a JOIN questions q ON q.id = a.question_id WHERE q.activity_id = ? AND a.attendee_id = ?')
      .all(act.id, req.me.id).map((r) => [r.question_id, r])
  );
  const questions = loadQuestions(act.id).map((q) => ({
    id: q.id, qtype: q.qtype, text: q.text, options: q.options, points: q.points,
    correct_index: revealAnswers ? q.correct_index : undefined,
    mine: mine[q.id] ? { option_index: mine[q.id].option_index, text_answer: mine[q.id].text_answer, is_correct: done && act.kind === 'quiz' ? mine[q.id].is_correct : undefined } : null,
  }));
  // Polls: show the crowd's answers once you have voted (or when closed). Quizzes: when organisers reveal.
  const showResults = act.kind === 'poll' ? done || act.status === 'closed' : !!act.results_visible;
  const r = showResults ? resultsFor(act.id) : null;
  res.json({
    activity: act,
    submitted: done,
    my_score: done ? sub.score : null,
    questions,
    results: r && {
      participants: r.participants, totalAttendees: r.totalAttendees, maxScore: r.maxScore,
      questions: r.questions.map(({ textAnswers, ...q }) => q),
      winner: r.winner && { name: r.winner.name, company: r.winner.company, score: r.winner.score },
      top: r.rankings.slice(0, 10).map((x) => ({ rank: x.rank, name: x.name, company: x.company, score: x.score })),
      myRank: r.rankings.find((x) => x.attendee_id === req.me.id)?.rank ?? null,
    },
  });
});

api.post('/activities/:id/submit', (req, res) => {
  const act = db.prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
  if (!act) return bad(res, 'Not found', 404);
  if (act.status !== 'live') return bad(res, 'This one is closed now.');
  const sub = db.prepare('SELECT * FROM submissions WHERE activity_id = ? AND attendee_id = ?').get(act.id, req.me.id);
  if (sub?.submitted_at) return bad(res, 'You have already submitted.');
  const questions = loadQuestions(act.id);
  const given = new Map((req.body?.answers || []).map((x) => [Number(x.question_id), x]));
  let score = 0;
  const submittedAt = now();
  tx(() => {
    const ins = db.prepare('INSERT OR REPLACE INTO answers(question_id, attendee_id, option_index, text_answer, is_correct, answered_at) VALUES (?,?,?,?,?,?)');
    for (const q of questions) {
      const g = given.get(q.id);
      if (!g) continue;
      if (q.qtype === 'text') {
        const t = String(g.text || '').trim().slice(0, 1000);
        if (t) { ins.run(q.id, req.me.id, null, t, null, submittedAt); score += q.points; } // answering earns the points
      } else {
        const idx = Number(g.option_index);
        if (!Number.isInteger(idx) || idx < 0 || idx >= q.options.length) continue;
        const correct = act.kind === 'quiz' && q.correct_index != null ? (idx === q.correct_index ? 1 : 0) : null;
        if (correct) score += q.points;
        ins.run(q.id, req.me.id, idx, null, correct, submittedAt);
      }
    }
    const started = sub?.started_at || submittedAt;
    const duration = Math.max(0, Date.parse(submittedAt) - Date.parse(started));
    db.prepare(`INSERT INTO submissions(activity_id, attendee_id, started_at, submitted_at, duration_ms, score) VALUES (?,?,?,?,?,?)
      ON CONFLICT(activity_id, attendee_id) DO UPDATE SET submitted_at = excluded.submitted_at, duration_ms = excluded.duration_ms, score = excluded.score`)
      .run(act.id, req.me.id, started, submittedAt, duration, score);
  });
  live.sendAll('activity-progress', { id: act.id });
  res.json({ ok: true, score });
});

// Scores follow the rules above: correct quiz choices plus every typed answer. Re-applied at start-up so
// answers given before a rule change (e.g. typed answers before they earned points) are counted too.
function rescoreAll() {
  const rows = db.prepare(`SELECT s.id, COALESCE(SUM(CASE WHEN x.is_correct = 1 OR (q.qtype = 'text' AND x.text_answer <> '') THEN q.points END), 0) AS score
    FROM submissions s LEFT JOIN questions q ON q.activity_id = s.activity_id
    LEFT JOIN answers x ON x.question_id = q.id AND x.attendee_id = s.attendee_id
    WHERE s.submitted_at IS NOT NULL GROUP BY s.id`).all();
  const upd = db.prepare('UPDATE submissions SET score = ? WHERE id = ? AND score IS NOT ?');
  tx(() => rows.forEach((r) => upd.run(r.score, r.id, r.score)));
}
rescoreAll();

// ----- spin the wheel -----
// Segments a guest can still land on: unlimited ones, or limited ones with stock left.
function wheelAvailable(wheel) {
  const given = new Map(db.prepare('SELECT prize_index i, COUNT(*) n FROM wheel_spins WHERE wheel_id = ? GROUP BY prize_index').all(wheel.id).map((r) => [r.i, r.n]));
  return JSON.parse(wheel.prizes).map((p, i) => ({ ...p, i, left: p.qty == null ? null : Math.max(0, p.qty - (given.get(i) || 0)) }));
}

api.get('/wheels', (req, res) => {
  const rows = db.prepare(`
    SELECT w.id, w.title, w.description, w.prizes, w.status, s.prize_index AS my_index, s.label AS my_label, s.win AS my_win
    FROM wheels w LEFT JOIN wheel_spins s ON s.wheel_id = w.id AND s.attendee_id = ?
    WHERE w.status IN ('live','closed') ORDER BY (w.status = 'live') DESC, w.id DESC`).all(req.me.id);
  // Guests see the segment names only, not how many prizes are left.
  res.json(rows.map((w) => ({ ...w, prizes: JSON.parse(w.prizes).map((p) => p.label) })));
});

api.post('/wheels/:id/spin', (req, res) => {
  const wheel = db.prepare("SELECT * FROM wheels WHERE id = ? AND status = 'live'").get(req.params.id);
  if (!wheel) return bad(res, 'This wheel isn’t open right now', 404);
  const mine = db.prepare('SELECT * FROM wheel_spins WHERE wheel_id = ? AND attendee_id = ?').get(wheel.id, req.me.id);
  if (mine) return res.status(409).json({ error: 'You’ve already spun this wheel', index: mine.prize_index, label: mine.label, win: !!mine.win });
  // The server picks the result, so it can't be gamed and limited prizes never run over.
  const open = wheelAvailable(wheel).filter((p) => p.left == null || p.left > 0);
  if (!open.length) return bad(res, 'All the prizes on this wheel have been won');
  // With a win chance set, first decide win or miss, then pick a segment of that kind (prizes still need stock).
  let pool = open;
  if (wheel.win_chance != null) {
    const wins = open.filter((p) => p.win !== false), misses = open.filter((p) => p.win === false);
    const wantWin = crypto.randomInt(100) < wheel.win_chance;
    pool = (wantWin ? wins : misses).length ? (wantWin ? wins : misses) : open;
  }
  const pick = pool[crypto.randomInt(pool.length)];
  const win = pick.win !== false;
  db.prepare('INSERT INTO wheel_spins(wheel_id, attendee_id, prize_index, label, win) VALUES (?,?,?,?,?)').run(wheel.id, req.me.id, pick.i, pick.label, win ? 1 : 0);
  live.sendAll('wheel-spin', { id: wheel.id });
  res.json({ index: pick.i, label: pick.label, win });
});

api.get('/leaderboard', (_req, res) => {
  if (getSetting('leaderboard_visible', '0') !== '1') return res.json({ visible: false, rows: [] });
  res.json({ visible: true, rows: leaderboard().slice(0, 25) });
});

function leaderboard() {
  const rows = db.prepare(`
    SELECT a.id, a.name, a.company, SUM(s.score) AS points, COUNT(s.id) AS quizzes, SUM(s.duration_ms) AS time_ms
    FROM submissions s JOIN attendees a ON a.id = s.attendee_id
    WHERE s.submitted_at IS NOT NULL AND s.score > 0
    GROUP BY a.id ORDER BY points DESC, time_ms ASC`).all(); // every quiz and poll that gave points, typed answers included
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

// ----- gallery -----
api.get('/gallery', (_req, res) => {
  res.json(db.prepare(`
    SELECT m.id, m.file_path, m.media_type, m.caption, m.official, m.created_at, a.name AS uploader
    FROM media m LEFT JOIN attendees a ON a.id = m.attendee_id
    WHERE m.status = 'approved' ORDER BY m.created_at DESC, m.id DESC`).all());
});
api.get('/my-media', (req, res) => {
  res.json(db.prepare('SELECT * FROM media WHERE attendee_id = ? ORDER BY id DESC').all(req.me.id));
});
api.post('/media', upload.array('files', 20), (req, res) => {
  if (!req.files?.length) return bad(res, 'Please choose photos or videos to upload.');
  const auto = getSetting('auto_approve_uploads', '0') === '1';
  const ins = db.prepare('INSERT INTO media(attendee_id, file_path, media_type, caption, status) VALUES (?,?,?,?,?)');
  for (const f of req.files) ins.run(req.me.id, f.filename, mediaType(f.mimetype), String(req.body.caption || '').slice(0, 300), auto ? 'approved' : 'pending');
  if (auto) live.sendAll('gallery', {});
  res.json({ ok: true, count: req.files.length, status: auto ? 'approved' : 'pending' });
});

// ----- people & chat -----
api.get('/people', (req, res) => {
  const online = new Set(live.onlineIds());
  res.json(db.prepare('SELECT id, name, company, designation FROM attendees WHERE id <> ? ORDER BY name').all(req.me.id)
    .map((p) => ({ ...p, online: online.has(p.id) })));
});

// ----- Star Spotlight: guests appreciate each other; organisers approve before anything is shown -----
const STAR_LIMIT = 10; // per guest, so nobody floods the wall
api.get('/stars', (req, res) => {
  res.json({
    received: db.prepare(`SELECT s.message, s.created_at, a.name AS from_name FROM spotlights s JOIN attendees a ON a.id = s.from_id
      WHERE s.to_id = ? AND s.status = 'approved' ORDER BY s.id DESC`).all(req.me.id),
    sent: db.prepare(`SELECT s.message, s.status, s.created_at, a.name AS to_name FROM spotlights s JOIN attendees a ON a.id = s.to_id
      WHERE s.from_id = ? ORDER BY s.id DESC`).all(req.me.id),
    limit: STAR_LIMIT,
  });
});
api.post('/stars', (req, res) => {
  const toId = Number(req.body?.to_id);
  const message = String(req.body?.message || '').trim();
  if (!toId || toId === req.me.id || !db.prepare('SELECT 1 FROM attendees WHERE id = ?').get(toId)) return bad(res, 'Choose a colleague from the list.');
  if (message.length < 3 || message.length > 200) return bad(res, 'Write a message of up to 200 characters.');
  if (db.prepare('SELECT COUNT(*) n FROM spotlights WHERE from_id = ?').get(req.me.id).n >= STAR_LIMIT) return bad(res, `You can send up to ${STAR_LIMIT} stars.`);
  db.prepare('INSERT INTO spotlights(from_id, to_id, message) VALUES (?,?,?)').run(req.me.id, toId, message);
  res.json({ ok: true });
});

api.get('/conversations', (req, res) => {
  const me = req.me.id;
  const rows = db.prepare(`
    SELECT CASE WHEN from_id = ? THEN to_id ELSE from_id END AS peer,
      MAX(id) AS last_id,
      SUM(CASE WHEN to_id = ? AND read_at IS NULL THEN 1 ELSE 0 END) AS unread
    FROM messages WHERE to_id IS NOT NULL AND (from_id = ? OR to_id = ?)
    GROUP BY peer ORDER BY last_id DESC`).all(me, me, me, me);
  const getMsg = db.prepare('SELECT body, created_at FROM messages WHERE id = ?');
  const getPeer = db.prepare('SELECT id, name, company FROM attendees WHERE id = ?');
  res.json(rows.map((r) => ({ peer: getPeer.get(r.peer), unread: r.unread, last: getMsg.get(r.last_id) })).filter((r) => r.peer));
});

api.get('/messages/:peer', (req, res) => {
  const me = req.me.id;
  if (req.params.peer === 'lounge') {
    if (getSetting('lounge_enabled', '1') !== '1') return res.json([]);
    return res.json(db.prepare(`
      SELECT m.id, m.from_id, m.body, m.created_at, a.name AS from_name
      FROM messages m JOIN attendees a ON a.id = m.from_id WHERE m.to_id IS NULL
      ORDER BY m.id DESC LIMIT 200`).all().reverse());
  }
  const peer = Number(req.params.peer);
  db.prepare('UPDATE messages SET read_at = ? WHERE from_id = ? AND to_id = ? AND read_at IS NULL').run(now(), peer, me);
  res.json(db.prepare(`
    SELECT id, from_id, to_id, body, created_at FROM messages
    WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY id LIMIT 500`).all(me, peer, peer, me));
});

api.post('/messages', (req, res) => {
  const body = String(req.body?.body || '').trim().slice(0, 2000);
  if (!body) return bad(res, 'Empty message');
  const to = req.body.to === 'lounge' ? null : Number(req.body.to);
  if (to === null && getSetting('lounge_enabled', '1') !== '1') return bad(res, 'The lounge is closed.');
  if (to !== null && !db.prepare('SELECT 1 FROM attendees WHERE id = ?').get(to)) return bad(res, 'Unknown person');
  const info = db.prepare('INSERT INTO messages(from_id, to_id, body, created_at) VALUES (?,?,?,?)').run(req.me.id, to, body, now());
  const msg = { id: Number(info.lastInsertRowid), from_id: req.me.id, to_id: to, body, created_at: now(), from_name: req.me.name };
  if (to === null) live.sendAll('lounge', msg);
  else {
    live.sendTo(to, 'dm', msg);
    live.sendTo(req.me.id, 'dm', msg);
  }
  res.json(msg);
});

api.get('/stream', (req, res) => live.addClient(req.me.id, res));


// ---------------- admin ----------------
const admin = express.Router();

app.post('/api/admin/login', (req, res) => {
  const given = Buffer.from(String(req.body?.password || ''));
  const want = Buffer.from(ADMIN_PASSWORD);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return bad(res, 'Wrong password', 401);
  const token = newToken();
  db.prepare('INSERT INTO admin_sessions(token) VALUES (?)').run(token);
  res.json({ token });
});

admin.use(adminAuth);

admin.get('/overview', (_req, res) => {
  const n = (sql) => db.prepare(sql).get().n;
  res.json({
    channels: channelStatus(),
    counts: {
      attendees: n('SELECT COUNT(*) n FROM attendees'),
      visited: n('SELECT COUNT(*) n FROM attendees WHERE last_seen IS NOT NULL'),
      online: live.onlineIds().length,
      posts: n('SELECT COUNT(*) n FROM posts'),
      pendingMedia: n("SELECT COUNT(*) n FROM media WHERE status = 'pending'"),
      approvedMedia: n("SELECT COUNT(*) n FROM media WHERE status = 'approved'"),
      liveActivities: n("SELECT COUNT(*) n FROM activities WHERE status = 'live'"),
      messages: n('SELECT COUNT(*) n FROM messages'),
    },
    settings: {
      auto_approve_uploads: getSetting('auto_approve_uploads', '0') === '1',
      leaderboard_visible: getSetting('leaderboard_visible', '0') === '1',
      lounge_enabled: getSetting('lounge_enabled', '1') === '1',
    },
    batches: db.prepare(`
      SELECT batch, subject, MIN(created_at) AS created_at,
        SUM(status = 'sent') AS sent, SUM(status = 'failed') AS failed,
        SUM(status = 'dry-run') AS dry_run, SUM(status = 'skipped') AS skipped
      FROM notifications GROUP BY batch ORDER BY MIN(id) DESC LIMIT 15`).all(),
  });
});

admin.put('/settings', (req, res) => {
  for (const k of ['auto_approve_uploads', 'leaderboard_visible', 'lounge_enabled']) {
    if (k in (req.body || {})) setSetting(k, req.body[k] ? '1' : '0');
  }
  live.sendAll('settings', {});
  res.json({ ok: true });
});

// ----- WhatsApp invites sent by hand from the organiser's own WhatsApp (no WhatsApp Business account needed) -----
const WA_INVITE_DEFAULT = "Hi {name}! 🌴 Welcome to {event}, Goa ({dates}).\n\nHere is your personal event link: {link}\n\nIt has your QR pass for check-in, the agenda, games and live updates. Please keep it handy and don't share it — it's just for you.";
admin.get('/wa-invites', (_req, res) => {
  res.json({
    text: getSetting('wa_invite_text') || WA_INVITE_DEFAULT,
    people: db.prepare('SELECT * FROM attendees ORDER BY name').all().map((a) => ({
      id: a.id, name: a.name, company: a.company, phone: a.phone, wa_sent_at: a.wa_sent_at, link: personalLink(a),
    })),
  });
});
admin.put('/wa-invites/text', (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 1500);
  if (!text.includes('{link}')) return bad(res, 'Keep {link} in the message: it becomes each person’s own link');
  setSetting('wa_invite_text', text);
  res.json({ ok: true });
});
admin.post('/wa-invites/:id/sent', (req, res) => {
  db.prepare('UPDATE attendees SET wa_sent_at = ? WHERE id = ?').run(req.body?.sent === false ? null : now(), req.params.id);
  res.json({ ok: true });
});

// ----- branding -----
const brandUpload = upload.fields([
  { name: 'logo', maxCount: 1 }, { name: 'hero', maxCount: 1 }, { name: 'titleArt', maxCount: 1 }, { name: 'partners', maxCount: MAX_PARTNERS },
  { name: 'banner', maxCount: 1 }, { name: 'bannerMobile', maxCount: 1 },
]);
admin.put('/branding', brandUpload, (req, res) => {
  const b = req.body || {};
  const files = req.files || {};
  const uploaded = Object.values(files).flat();
  const discard = () => uploaded.forEach((f) => fs.rm(f.path, () => {}));

  for (const f of uploaded) {
    if (!f.mimetype.startsWith('image/')) { discard(); return bad(res, 'Logos, artwork and header images must be image files'); }
  }
  for (const k of ['colorPrimary', 'colorAccent', 'colorHighlight']) {
    if (b[k] && !isHex(b[k])) { discard(); return bad(res, `${k} must be a colour like #0d4f4a`); }
  }
  if (b.heroTint && !HERO_TINTS.includes(b.heroTint)) { discard(); return bad(res, 'Unknown header tint'); }
  if (b.font && !FONTS.includes(b.font)) { discard(); return bad(res, 'Unknown heading font'); }
  let removePartners = [];
  try { removePartners = b.removePartners ? JSON.parse(b.removePartners) : []; } catch { /* ignore */ }
  const keptPartners = partnerFiles().filter((f) => !removePartners.includes(`/uploads/${f}`));
  if (keptPartners.length + (files.partners || []).length > MAX_PARTNERS) {
    discard(); return bad(res, `Up to ${MAX_PARTNERS} partner logos`);
  }

  const text = { clientName: ['brand_client_name', 60], eventName: ['brand_event_name', 40], tagline: ['brand_tagline', 120] };
  for (const [field, [key, max]] of Object.entries(text)) {
    if (field in b) setSetting(key, String(b[field]).trim().slice(0, max) || null);
  }
  const colors = { colorPrimary: 'brand_color_primary', colorAccent: 'brand_color_accent', colorHighlight: 'brand_color_highlight' };
  for (const [field, key] of Object.entries(colors)) if (field in b) setSetting(key, b[field] || null);
  if ('logoBadge' in b) setSetting('brand_logo_badge', b.logoBadge === 'true' || b.logoBadge === true ? '1' : '0');
  if (b.heroTint) setSetting('brand_hero_tint', b.heroTint);
  if (b.font) setSetting('brand_font', b.font);

  const removeUpload = (name) => fs.rm(path.join(UPLOAD_DIR, path.basename(name)), () => {});
  const replaceFile = (key, file, remove) => {
    if (!file && !remove) return;
    const old = getSetting(key);
    if (old) removeUpload(old);
    setSetting(key, file ? file.filename : null);
  };
  replaceFile('brand_logo', files.logo?.[0], b.removeLogo === 'true');
  replaceFile('brand_hero', files.hero?.[0], b.removeHero === 'true');
  replaceFile('brand_title_art', files.titleArt?.[0], b.removeTitleArt === 'true');
  replaceFile('brand_banner', files.banner?.[0], b.removeBanner === 'true');
  replaceFile('brand_banner_mobile', files.bannerMobile?.[0], b.removeBannerMobile === 'true');
  partnerFiles().filter((f) => !keptPartners.includes(f)).forEach(removeUpload);
  setSetting('brand_partner_logos', JSON.stringify([...keptPartners, ...(files.partners || []).map((f) => f.filename)]));

  const branding = getBranding();
  live.sendAll('branding', branding);
  res.json(branding);
});

admin.get('/branding/email-preview', (_req, res) => {
  res.type('html').send(emailHtml({
    name: 'Aarav',
    title: 'New video: Opening keynote highlights',
    message: 'Catch the best moments from this morning’s keynote — now on the microsite.',
    link: '#',
    cta: 'See the update',
  }));
});

admin.get('/notifications/:batch', (req, res) => {
  res.json(db.prepare(`SELECT n.*, a.name FROM notifications n LEFT JOIN attendees a ON a.id = n.attendee_id WHERE batch = ? ORDER BY n.id`).all(req.params.batch));
});

// ----- attendees -----
admin.get('/attendees', (_req, res) => {
  res.json(db.prepare('SELECT * FROM attendees ORDER BY name').all().map((a) => ({ ...a, link: personalLink(a) })));
});

function upsertAttendee(p) {
  const name = String(p.name || '').trim();
  if (!name) throw new Error('Name is required');
  const email = String(p.email || '').trim().toLowerCase() || null;
  const phone = p.phone ? normalisePhone(p.phone) : null;
  if (!email && !phone) throw new Error(`${name}: needs an email or phone`);
  const existing = (email && db.prepare('SELECT * FROM attendees WHERE lower(email) = ?').get(email))
    || (phone && db.prepare('SELECT * FROM attendees WHERE phone = ?').get(phone));
  if (existing) {
    db.prepare('UPDATE attendees SET name=?, email=COALESCE(?,email), phone=COALESCE(?,phone), company=COALESCE(?,company), designation=COALESCE(?,designation) WHERE id=?')
      .run(name, email, phone, p.company || null, p.designation || null, existing.id);
    return { id: existing.id, created: false };
  }
  const info = db.prepare('INSERT INTO attendees(name,email,phone,company,designation,token) VALUES (?,?,?,?,?,?)')
    .run(name, email, phone, p.company || null, p.designation || null, newToken());
  return { id: Number(info.lastInsertRowid), created: true };
}

// The one shared link + QR for self sign-up (the site's own address).
admin.get('/join-qr.png', wrap(async (_req, res) => {
  res.set('Content-Type', 'image/png').send(await QRCode.toBuffer(BASE_URL() + '/', { width: 1200, margin: 2, errorCorrectionLevel: 'M' }));
}));
admin.get('/attendees.csv', (_req, res) => {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = db.prepare('SELECT * FROM attendees ORDER BY name').all();
  const lines = [['Name', 'Email', 'Mobile', 'Company', 'Designation', 'On guest list', 'Signed up via QR', 'Last opened site', 'Checked in']]
    .concat(rows.map((a) => [a.name, a.email, a.phone ? '+' + a.phone : '', a.company, a.designation, a.self_added ? 'No' : 'Yes', a.registered_at, a.last_seen, a.checked_in_at]));
  res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="AMG2026-attendees.csv"');
  res.send('\ufeff' + lines.map((r) => r.map(cell).join(',')).join('\r\n'));
});
admin.post('/attendees', (req, res) => {
  try {
    res.json(upsertAttendee(req.body || {}));
  } catch (e) {
    bad(res, e.message);
  }
});

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

admin.post('/attendees/import', (req, res) => {
  const text = typeof req.body === 'string' ? req.body : String(req.body?.csv || '');
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (!rows.length) return bad(res, 'The CSV is empty');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (names) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const idx = {
    name: col(['name']), email: col(['email', 'mail']), phone: col(['phone', 'mobile', 'whatsapp', 'contact']),
    company: col(['company', 'organisation', 'organization', 'dealer', 'firm']), designation: col(['designation', 'title', 'role']),
  };
  const hasHeader = idx.name >= 0;
  if (!hasHeader) Object.assign(idx, { name: 0, email: 1, phone: 2, company: 3, designation: 4 });
  let created = 0, updated = 0;
  const errors = [];
  tx(() => {
    for (const r of rows.slice(hasHeader ? 1 : 0)) {
      const get = (k) => (idx[k] >= 0 ? (r[idx[k]] || '').trim() : '');
      try {
        const out = upsertAttendee({ name: get('name'), email: get('email'), phone: get('phone'), company: get('company'), designation: get('designation') });
        out.created ? created++ : updated++;
      } catch (e) {
        errors.push(e.message);
      }
    }
  });
  res.json({ created, updated, errors });
});

admin.patch('/attendees/:id', (req, res) => {
  const b = req.body || {};
  db.prepare('UPDATE attendees SET name=COALESCE(?,name), email=COALESCE(?,email), phone=COALESCE(?,phone), company=COALESCE(?,company), designation=COALESCE(?,designation) WHERE id=?')
    .run(b.name || null, b.email || null, b.phone ? normalisePhone(b.phone) : null, b.company || null, b.designation || null, req.params.id);
  res.json({ ok: true });
});
admin.post('/attendees/:id/reset-link', (req, res) => {
  db.prepare('UPDATE attendees SET token = ? WHERE id = ?').run(newToken(), req.params.id);
  res.json({ ok: true });
});
admin.delete('/attendees/:id', (req, res) => {
  db.prepare('DELETE FROM attendees WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
admin.post('/send-links', (req, res) => {
  const ids = Array.isArray(req.body?.ids) && req.body.ids.length ? req.body.ids : undefined;
  res.json(broadcast({
    title: req.body?.title || `Welcome to ${getBranding().eventName}`,
    waHeadline: 'your personal invite to the event microsite is ready',
    message: req.body?.message || 'Your personal event microsite is live: agenda, updates, quizzes, polls and the photo wall — all in one place.',
    cta: 'Open my microsite',
    attendeeIds: ids,
    channels: req.body?.channels,
  }));
});

// ----- broadcast -----
admin.post('/broadcast', (req, res) => {
  const b = req.body || {};
  if (!b.title) return bad(res, 'Title is required');
  res.json(broadcast({ title: b.title, waHeadline: b.title, message: b.message, path: b.path || '/', channels: b.channels }));
});

// ----- posts (updates feed) -----
admin.post('/posts', upload.single('media'), (req, res) => {
  const b = req.body || {};
  if (!b.title) return bad(res, 'Title is required');
  const info = db.prepare('INSERT INTO posts(title, body, media_path, media_type, link_url, pinned, created_at) VALUES (?,?,?,?,?,?,?)').run(
    b.title, b.body || null, req.file?.filename || null, req.file ? mediaType(req.file.mimetype) : null, b.link_url || null, b.pinned === 'true' || b.pinned === true ? 1 : 0, now()
  );
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid);
  live.sendAll('post', post);
  let notification = null;
  if (b.notify === 'true' || b.notify === true) {
    const kind = post.media_type === 'video' ? 'a new video' : post.media_type === 'image' ? 'a new photo update' : 'a new update';
    notification = broadcast({
      title: post.title, waHeadline: `${kind} is up: "${post.title}"`, message: post.body, path: `/#post-${post.id}`, cta: 'See the update',
      channels: b.channels ? String(b.channels).split(',') : undefined,
    });
  }
  res.json({ post, notification });
});
admin.patch('/posts/:id', (req, res) => {
  const b = req.body || {};
  if ('title' in b) { // edit text only; never re-notifies guests
    const title = String(b.title).trim();
    if (!title) return bad(res, 'Headline is required');
    db.prepare('UPDATE posts SET title = ?, body = ? WHERE id = ?').run(title, String(b.body || '').trim() || null, req.params.id);
  }
  if ('pinned' in b) db.prepare('UPDATE posts SET pinned = ? WHERE id = ?').run(b.pinned ? 1 : 0, req.params.id);
  res.json({ ok: true });
});
admin.delete('/posts/:id', (req, res) => {
  const p = db.prepare('SELECT media_path FROM posts WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  if (p?.media_path) fs.rm(path.join(UPLOAD_DIR, p.media_path), () => {});
  live.sendAll('post', {});
  res.json({ ok: true });
});
admin.get('/posts', (_req, res) => res.json(db.prepare('SELECT * FROM posts ORDER BY pinned DESC, created_at DESC').all()));

// ----- agenda -----
admin.get('/sessions', (_req, res) => res.json(db.prepare('SELECT * FROM sessions ORDER BY day, start_time, id').all()));
// Times are optional (some agendas only list what happens each day); if given, both are needed.
const sessionError = (s) => (!s.day || !s.title ? 'Date and title are required'
  : !s.start_time !== !s.end_time ? 'Give both a start and an end time, or leave both blank' : null);
admin.post('/sessions', (req, res) => {
  const s = req.body || {};
  if (sessionError(s)) return bad(res, sessionError(s));
  const info = db.prepare('INSERT INTO sessions(day,start_time,end_time,title,speaker,location,description) VALUES (?,?,?,?,?,?,?)')
    .run(s.day, s.start_time || '', s.end_time || '', s.title, s.speaker || null, s.location || null, s.description || null);
  live.sendAll('agenda', {});
  res.json({ id: Number(info.lastInsertRowid) });
});
admin.put('/sessions/:id', (req, res) => {
  const s = req.body || {};
  if (sessionError(s)) return bad(res, sessionError(s));
  db.prepare('UPDATE sessions SET day=?,start_time=?,end_time=?,title=?,speaker=?,location=?,description=? WHERE id=?')
    .run(s.day, s.start_time || '', s.end_time || '', s.title, s.speaker || null, s.location || null, s.description || null, req.params.id);
  live.sendAll('agenda', {});
  res.json({ ok: true });
});
admin.put('/agenda-info', (req, res) => {
  const b = req.body || {};
  const days = {};
  for (const [d, t] of Object.entries(b.days || {})) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && String(t).trim()) days[d] = String(t).trim().slice(0, 120);
  }
  setSetting('agenda_intro', String(b.intro || '').trim().slice(0, 400) || null);
  setSetting('agenda_day_titles', JSON.stringify(days));
  live.sendAll('agenda', {});
  res.json(agendaInfo());
});
admin.delete('/sessions/:id', (req, res) => {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
  live.sendAll('agenda', {});
  res.json({ ok: true });
});

// ----- quizzes & polls -----
admin.get('/activities', (_req, res) => {
  res.json(db.prepare(`
    SELECT a.*, (SELECT COUNT(*) FROM questions q WHERE q.activity_id = a.id) AS question_count,
      (SELECT COUNT(*) FROM submissions s WHERE s.activity_id = a.id AND s.submitted_at IS NOT NULL) AS participants
    FROM activities a ORDER BY a.id DESC`).all());
});
admin.get('/activities/:id', (req, res) => {
  const act = db.prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
  if (!act) return bad(res, 'Not found', 404);
  res.json({ activity: act, questions: loadQuestions(act.id) });
});

function saveQuestions(activityId, kind, questions) {
  if (!Array.isArray(questions) || !questions.length) throw new Error('Add at least one question');
  const ins = db.prepare('INSERT INTO questions(activity_id, position, qtype, text, options, correct_index, points) VALUES (?,?,?,?,?,?,?)');
  questions.forEach((q, i) => {
    const qtype = q.qtype === 'text' ? 'text' : 'choice';
    const options = qtype === 'choice' ? (q.options || []).map((o) => String(o).trim()).filter(Boolean) : [];
    if (!String(q.text || '').trim()) throw new Error(`Question ${i + 1} has no text`);
    if (qtype === 'choice' && options.length < 2) throw new Error(`Question ${i + 1} needs at least 2 options`);
    let correct = kind === 'quiz' && qtype === 'choice' && q.correct_index !== '' && q.correct_index != null ? Number(q.correct_index) : null;
    if (correct != null && !(correct >= 0 && correct < options.length)) correct = null;
    if (kind === 'quiz' && qtype === 'choice' && correct == null) throw new Error(`Question ${i + 1}: mark the correct answer`);
    ins.run(activityId, i, qtype, String(q.text).trim(), JSON.stringify(options), correct, Math.max(1, Number(q.points) || 1));
  });
}

admin.post('/activities', (req, res) => {
  const b = req.body || {};
  if (!['quiz', 'poll'].includes(b.kind)) return bad(res, 'Pick quiz or poll');
  if (!b.title) return bad(res, 'Title is required');
  try {
    const id = tx(() => {
      const info = db.prepare('INSERT INTO activities(kind,title,description) VALUES (?,?,?)').run(b.kind, b.title, b.description || null);
      const id = Number(info.lastInsertRowid);
      saveQuestions(id, b.kind, b.questions);
      return id;
    });
    res.json({ id });
  } catch (e) {
    bad(res, e.message);
  }
});

admin.put('/activities/:id', (req, res) => {
  const act = db.prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
  if (!act) return bad(res, 'Not found', 404);
  const hasAnswers = db.prepare('SELECT COUNT(*) n FROM submissions WHERE activity_id = ? AND submitted_at IS NOT NULL').get(act.id).n;
  if (hasAnswers) return bad(res, 'People have already answered — duplicate it instead of editing.');
  const b = req.body || {};
  try {
    tx(() => {
      db.prepare('UPDATE activities SET title=?, description=? WHERE id=?').run(b.title || act.title, b.description ?? act.description, act.id);
      db.prepare('DELETE FROM questions WHERE activity_id = ?').run(act.id);
      saveQuestions(act.id, act.kind, b.questions);
    });
    res.json({ ok: true });
  } catch (e) {
    bad(res, e.message);
  }
});

admin.post('/activities/:id/status', (req, res) => {
  const act = db.prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
  if (!act) return bad(res, 'Not found', 404);
  const status = req.body?.status;
  if (!['draft', 'live', 'closed'].includes(status)) return bad(res, 'Bad status');
  if (status === 'live') db.prepare('UPDATE activities SET status=?, opened_at=COALESCE(opened_at, ?), closed_at=NULL WHERE id=?').run(status, now(), act.id);
  else if (status === 'closed') db.prepare('UPDATE activities SET status=?, closed_at=? WHERE id=?').run(status, now(), act.id);
  else db.prepare('UPDATE activities SET status=? WHERE id=?').run(status, act.id);
  live.sendAll('activity', { id: act.id, status, title: act.title, kind: act.kind });
  let notification = null;
  if (status === 'live' && req.body?.notify) {
    const label = act.kind === 'quiz' ? 'quiz' : 'poll';
    notification = broadcast({
      title: `New ${label}: ${act.title}`,
      waHeadline: `a new ${label} "${act.title}" is now live`,
      message: act.kind === 'quiz' ? 'Answer fast — the top score with the quickest time wins.' : 'Cast your vote and see what everyone else thinks.',
      path: `/#engage/${act.id}`,
      cta: act.kind === 'quiz' ? 'Play now' : 'Vote now',
    });
  }
  res.json({ ok: true, notification });
});

admin.post('/activities/:id/reveal', (req, res) => {
  db.prepare('UPDATE activities SET results_visible = ? WHERE id = ?').run(req.body?.visible ? 1 : 0, req.params.id);
  const act = db.prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
  live.sendAll('activity', { id: act.id, status: act.status, reveal: !!act.results_visible });
  let notification = null;
  if (req.body?.visible && req.body?.notify) {
    const r = resultsFor(act.id);
    notification = broadcast({
      title: `Results are in: ${act.title}`,
      waHeadline: r.winner ? `the results of "${act.title}" are out — congratulations ${r.winner.name}` : `the results of "${act.title}" are out`,
      message: r.winner ? `Winner: ${r.winner.name}${r.winner.company ? ' (' + r.winner.company + ')' : ''} with ${r.winner.score}/${r.maxScore}.` : '',
      path: `/#engage/${act.id}`,
      cta: 'See results',
    });
  }
  res.json({ ok: true, notification });
});

admin.get('/activities/:id/results', (req, res) => {
  const r = resultsFor(req.params.id);
  if (!r) return bad(res, 'Not found', 404);
  res.json(r);
});

admin.get('/activities/:id/results.csv', (req, res) => {
  const r = resultsFor(req.params.id);
  if (!r) return bad(res, 'Not found', 404);
  const qs = loadQuestions(r.activity.id);
  const people = db.prepare(`SELECT a.id, a.name, a.company, a.email, a.phone, s.score, s.duration_ms, s.submitted_at
    FROM submissions s JOIN attendees a ON a.id = s.attendee_id WHERE s.activity_id = ? AND s.submitted_at IS NOT NULL
    ORDER BY s.score DESC, s.duration_ms ASC`).all(r.activity.id);
  const ans = db.prepare('SELECT option_index, text_answer FROM answers WHERE question_id = ? AND attendee_id = ?');
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Rank', 'Name', 'Company', 'Email', 'Phone', 'Score', 'Time (s)', 'Submitted', ...qs.map((q) => q.text)].map(cell).join(',')];
  people.forEach((p, i) => {
    const answers = qs.map((q) => {
      const a = ans.get(q.id, p.id);
      return a ? (a.text_answer ?? q.options[a.option_index]) : '';
    });
    lines.push([i + 1, p.name, p.company, p.email, p.phone, p.score ?? '', ((p.duration_ms || 0) / 1000).toFixed(1), p.submitted_at, ...answers].map(cell).join(','));
  });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="results-${r.activity.id}.csv"`);
  res.send('﻿' + lines.join('\r\n'));
});

// Artwork for a quiz/poll: guests tap it to open the answer form.
const removeUpload = (name) => { if (name) fs.rm(path.join(UPLOAD_DIR, path.basename(name)), { force: true }, () => {}); };
admin.post('/activities/:id/image', upload.single('image'), (req, res) => {
  const act = db.prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
  if (!act || !req.file) { removeUpload(req.file?.filename); return bad(res, act ? 'Choose an image' : 'Not found', act ? 400 : 404); }
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(req.file.mimetype)) { removeUpload(req.file.filename); return bad(res, 'Use a PNG, JPG or WebP image'); }
  removeUpload(act.image_path);
  // A new image keeps the marked button only if the admin sends it again (the editor does).
  db.prepare('UPDATE activities SET image_path = ?, cta_box = NULL WHERE id = ?').run(req.file.filename, act.id);
  res.json({ image_path: req.file.filename });
});
// Where the button sits on the artwork (percentages of the image), so it can glow. null clears it.
admin.put('/activities/:id/cta', (req, res) => {
  const b = req.body?.cta_box;
  let box = null;
  if (b) {
    box = Object.fromEntries(['x', 'y', 'w', 'h'].map((k) => [k, Math.round(Number(b[k]) * 10) / 10]));
    const ok = Object.values(box).every((v) => Number.isFinite(v) && v >= 0 && v <= 100) && box.w >= 1 && box.h >= 1 && box.x + box.w <= 100.5 && box.y + box.h <= 100.5;
    if (!ok) return bad(res, 'Mark the button again');
  }
  db.prepare('UPDATE activities SET cta_box = ? WHERE id = ?').run(box && JSON.stringify(box), req.params.id);
  res.json({ cta_box: box });
});
admin.delete('/activities/:id/image', (req, res) => {
  const act = db.prepare('SELECT image_path FROM activities WHERE id = ?').get(req.params.id);
  removeUpload(act?.image_path);
  db.prepare('UPDATE activities SET image_path = NULL, cta_box = NULL WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

admin.delete('/activities/:id', (req, res) => {
  removeUpload(db.prepare('SELECT image_path FROM activities WHERE id = ?').get(req.params.id)?.image_path);
  db.prepare('DELETE FROM activities WHERE id = ?').run(req.params.id);
  live.sendAll('activity', { id: Number(req.params.id), status: 'deleted' });
  res.json({ ok: true });
});

admin.get('/leaderboard', (_req, res) => res.json(leaderboard()));

// ----- spin the wheel -----
const cleanChance = (v) => (v === '' || v == null ? null : Math.min(100, Math.max(0, Math.round(Number(v)) || 0)));
function cleanPrizes(list) {
  if (!Array.isArray(list)) throw new Error('Add the wheel’s segments');
  const prizes = list.map((p) => ({
    label: String(p?.label || '').trim().slice(0, 40),
    qty: p?.qty === '' || p?.qty == null ? null : Math.max(0, Math.floor(Number(p.qty)) || 0),
    win: p?.win !== false,
  })).filter((p) => p.label);
  if (prizes.length < 2 || prizes.length > 12) throw new Error('A wheel needs 2 to 12 segments');
  return JSON.stringify(prizes);
}

admin.get('/wheels', (_req, res) => {
  const wheels = db.prepare('SELECT * FROM wheels ORDER BY id DESC').all();
  res.json(wheels.map((w) => ({
    ...w,
    prizes: wheelAvailable(w),
    spins: db.prepare('SELECT COUNT(*) n FROM wheel_spins WHERE wheel_id = ?').get(w.id).n,
  })));
});

admin.post('/wheels', (req, res) => {
  const b = req.body || {};
  if (!String(b.title || '').trim()) return bad(res, 'Give the wheel a title');
  try {
    const info = db.prepare('INSERT INTO wheels(title, description, prizes, win_chance) VALUES (?,?,?,?)')
      .run(String(b.title).trim().slice(0, 80), String(b.description || '').trim().slice(0, 200) || null, cleanPrizes(b.prizes), cleanChance(b.win_chance));
    res.json({ id: Number(info.lastInsertRowid) });
  } catch (e) { bad(res, e.message); }
});

admin.put('/wheels/:id', (req, res) => {
  const w = db.prepare('SELECT * FROM wheels WHERE id = ?').get(req.params.id);
  if (!w) return bad(res, 'Not found', 404);
  const b = req.body || {};
  try {
    const prizes = cleanPrizes(b.prizes);
    // Spins remember which segment they landed on, so the segment list is fixed once anyone has spun.
    const spun = db.prepare('SELECT COUNT(*) n FROM wheel_spins WHERE wheel_id = ?').get(w.id).n;
    if (spun && JSON.parse(prizes).length !== JSON.parse(w.prizes).length) return bad(res, 'People have already spun, so segments can’t be added or removed now — you can still rename them or change quantities');
    db.prepare('UPDATE wheels SET title = ?, description = ?, prizes = ?, win_chance = ? WHERE id = ?')
      .run(String(b.title || w.title).trim().slice(0, 80), String(b.description ?? '').trim().slice(0, 200) || null, prizes, cleanChance(b.win_chance), w.id);
    live.sendAll('wheel', { id: w.id });
    res.json({ ok: true });
  } catch (e) { bad(res, e.message); }
});

admin.post('/wheels/:id/status', (req, res) => {
  const w = db.prepare('SELECT * FROM wheels WHERE id = ?').get(req.params.id);
  if (!w) return bad(res, 'Not found', 404);
  const status = req.body?.status;
  if (!['draft', 'live', 'closed'].includes(status)) return bad(res, 'Bad status');
  db.prepare('UPDATE wheels SET status = ? WHERE id = ?').run(status, w.id);
  live.sendAll('wheel', { id: w.id, status, title: w.title });
  let notification = null;
  if (status === 'live' && req.body?.notify) {
    notification = broadcast({
      title: `Spin the wheel: ${w.title}`,
      waHeadline: `"${w.title}" spin-the-wheel is now live — one free spin each`,
      message: 'You get one spin. Good luck!',
      path: `/#engage/w${w.id}`,
      cta: 'Spin now',
    });
  }
  res.json({ ok: true, notification });
});

admin.get('/wheels/:id/spins', (req, res) => {
  res.json(db.prepare(`
    SELECT s.label, s.win, s.spun_at, a.name, a.company, a.phone, a.email
    FROM wheel_spins s JOIN attendees a ON a.id = s.attendee_id
    WHERE s.wheel_id = ? ORDER BY s.win DESC, s.spun_at`).all(req.params.id));
});

admin.delete('/wheels/:id', (req, res) => {
  db.prepare('DELETE FROM wheels WHERE id = ?').run(req.params.id);
  live.sendAll('wheel', { id: Number(req.params.id) });
  res.json({ ok: true });
});

// ----- media moderation -----
// ---------- check-in desk ----------
const deskAttendee = (a) => ({ id: a.id, name: a.name, company: a.company, designation: a.designation, phone: a.phone, checked_in_at: a.checked_in_at });
admin.get('/checkin', (_req, res) => {
  const all = db.prepare('SELECT * FROM attendees ORDER BY name').all();
  res.json({
    total: all.length,
    checkedIn: all.filter((a) => a.checked_in_at).length,
    attendees: all.map(deskAttendee),
  });
});
// Body: { code } = the scanned QR (personal link or bare token), or { id } from a name search.
admin.post('/checkin', (req, res) => {
  const b = req.body || {};
  let a;
  if (b.id) a = db.prepare('SELECT * FROM attendees WHERE id = ?').get(Number(b.id));
  else {
    const raw = String(b.code || '').trim();
    let token = raw;
    try { token = new URL(raw).searchParams.get('t') || raw; } catch { /* not a URL: a bare token */ }
    a = db.prepare('SELECT * FROM attendees WHERE token = ?').get(token);
  }
  if (!a) return bad(res, 'This QR is not an AMG 2026 pass', 404);
  if (a.checked_in_at) return res.json({ status: 'already', attendee: deskAttendee(a) });
  const at = now();
  db.prepare('UPDATE attendees SET checked_in_at = ? WHERE id = ?').run(at, a.id);
  live.sendTo(a.id, 'checkin', { checked_in_at: at });
  res.json({ status: 'ok', attendee: deskAttendee({ ...a, checked_in_at: at }) });
});
admin.delete('/checkin/:id', (req, res) => {
  db.prepare('UPDATE attendees SET checked_in_at = NULL WHERE id = ?').run(req.params.id);
  live.sendTo(Number(req.params.id), 'checkin', { checked_in_at: null });
  res.json({ ok: true });
});

// ---------- lucky draw ----------
// Winners are picked by the server among guests who are checked in (unless the draw says otherwise)
// and haven't already won a draw, so nobody takes home two prizes.
function drawWinners(drawId) {
  return db.prepare(`SELECT w.attendee_id, w.status, w.drawn_at, a.name, a.company, a.phone FROM draw_winners w
    JOIN attendees a ON a.id = w.attendee_id WHERE w.draw_id = ? ORDER BY w.id`).all(drawId);
}
function drawPool(d) {
  return db.prepare(`SELECT id, name FROM attendees a
    WHERE (? = 0 OR a.checked_in_at IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM draw_winners w WHERE w.attendee_id = a.id AND (w.status = 'won' OR w.draw_id = ?))`).all(d.checked_in_only, d.id);
}
admin.get('/draws', (_req, res) => {
  res.json(db.prepare('SELECT * FROM draws ORDER BY id DESC').all().map((d) => ({ ...d, winners: drawWinners(d.id), pool: drawPool(d).length })));
});
admin.post('/draws', (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim().slice(0, 80);
  const count = Number(b.winners_count);
  if (!title) return bad(res, 'Give the draw a name, e.g. the prize');
  if (!Number.isInteger(count) || count < 1 || count > 50) return bad(res, 'Number of winners must be 1–50');
  const info = db.prepare('INSERT INTO draws(title, winners_count, checked_in_only) VALUES (?,?,?)').run(title, count, b.checked_in_only === false ? 0 : 1);
  res.json({ id: Number(info.lastInsertRowid) });
});
// Fills the empty winner slots (all of them the first time; a replacement after someone is marked absent).
admin.post('/draws/:id/draw', (req, res) => {
  const d = db.prepare('SELECT * FROM draws WHERE id = ?').get(req.params.id);
  if (!d) return bad(res, 'Not found', 404);
  const won = drawWinners(d.id).filter((w) => w.status === 'won').length;
  const pool = drawPool(d);
  const need = Math.min(d.winners_count - won, pool.length);
  if (d.winners_count - won <= 0) return bad(res, 'All winners are already drawn');
  if (!pool.length) return bad(res, d.checked_in_only ? 'Nobody left to draw: everyone checked in has already won' : 'Nobody left to draw');
  const picked = [];
  tx(() => {
    for (let i = 0; i < need; i++) {
      const [p] = pool.splice(crypto.randomInt(pool.length), 1);
      db.prepare('INSERT INTO draw_winners(draw_id, attendee_id) VALUES (?,?)').run(d.id, p.id);
      picked.push(p);
    }
  });
  for (const p of picked) live.sendTo(p.id, 'draw', { title: d.title });
  res.json({ picked: picked.map((p) => p.name) });
});
admin.post('/draws/:id/absent/:attendeeId', (req, res) => {
  db.prepare("UPDATE draw_winners SET status = 'absent' WHERE draw_id = ? AND attendee_id = ?").run(req.params.id, req.params.attendeeId);
  res.json({ ok: true });
});
admin.delete('/draws/:id', (req, res) => {
  db.prepare('DELETE FROM draws WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Star Spotlight moderation ----------
admin.get('/stars', (_req, res) => {
  res.json(db.prepare(`SELECT s.*, f.name AS from_name, t.name AS to_name FROM spotlights s
    JOIN attendees f ON f.id = s.from_id JOIN attendees t ON t.id = s.to_id ORDER BY s.id DESC`).all());
});
admin.post('/stars/status', (req, res) => {
  const status = req.body?.status;
  const ids = (req.body?.ids || []).map(Number).filter(Boolean);
  if (!['approved', 'rejected', 'pending'].includes(status) || !ids.length) return bad(res, 'Nothing to update');
  tx(() => {
    for (const id of ids) {
      const s = db.prepare('SELECT * FROM spotlights WHERE id = ?').get(id);
      if (!s || s.status === status) continue;
      db.prepare('UPDATE spotlights SET status = ? WHERE id = ?').run(status, id);
      if (status === 'approved') {
        const from = db.prepare('SELECT name FROM attendees WHERE id = ?').get(s.from_id);
        live.sendTo(s.to_id, 'star', { from: from?.name });
      }
    }
  });
  res.json({ ok: true });
});

// ---------- LED big screen ----------
// Organisers pick what the screen shows; the screen asks for it every couple of seconds.
const SCREEN_MODES = ['welcome', 'arrivals', 'activity', 'leaderboard', 'wheel', 'draw', 'spotlight'];
const getScreen = () => JSON.parse(getSetting('screen', '{"mode":"welcome"}'));
function screenData({ mode, id }) {
  if (mode === 'arrivals') {
    return {
      total: db.prepare('SELECT COUNT(*) n FROM attendees').get().n,
      checkedIn: db.prepare('SELECT COUNT(*) n FROM attendees WHERE checked_in_at IS NOT NULL').get().n,
      recent: db.prepare('SELECT name, company FROM attendees WHERE checked_in_at IS NOT NULL ORDER BY checked_in_at DESC LIMIT 8').all(),
    };
  }
  if (mode === 'activity') {
    const r = resultsFor(id);
    if (!r) return null;
    // A quiz's answers and ranking stay hidden until it is closed, so the screen can't give answers away.
    const reveal = r.activity.kind === 'poll' || r.activity.status === 'closed';
    return {
      kind: r.activity.kind, title: r.activity.title, status: r.activity.status,
      participants: r.participants, totalAttendees: r.totalAttendees, reveal,
      questions: reveal ? r.questions.map((q) => ({
        text: q.text, qtype: q.qtype, options: q.options, counts: q.counts, percents: q.percents,
        responses: q.responses, correct_index: q.correct_index, textAnswers: (q.textAnswers || []).slice(-12).map((t) => t.text),
      })) : [],
      rankings: reveal ? r.rankings.slice(0, 10).map(({ rank, name, company, score, duration_ms }) => ({ rank, name, company, score, duration_ms })) : [],
      maxScore: r.maxScore,
    };
  }
  if (mode === 'leaderboard') return { rows: leaderboard().slice(0, 10).map(({ rank, name, company, points }) => ({ rank, name, company, points })) };
  if (mode === 'wheel') {
    const w = db.prepare('SELECT id, title FROM wheels WHERE id = ?').get(id);
    if (!w) return null;
    const winners = db.prepare(`SELECT s.label, a.name, a.company FROM wheel_spins s JOIN attendees a ON a.id = s.attendee_id
      WHERE s.wheel_id = ? AND s.win = 1 ORDER BY s.spun_at DESC, s.id DESC LIMIT 10`).all(w.id);
    return { title: w.title, winners, spins: db.prepare('SELECT COUNT(*) n FROM wheel_spins WHERE wheel_id = ?').get(w.id).n };
  }
  if (mode === 'draw') {
    const d = db.prepare('SELECT * FROM draws WHERE id = ?').get(id);
    if (!d) return null;
    // Names to shuffle through on screen before each winner lands (stable order, so the screen doesn't redraw every poll).
    const pool = db.prepare('SELECT name FROM attendees WHERE (? = 0 OR checked_in_at IS NOT NULL) ORDER BY id LIMIT 200').all(d.checked_in_only).map((p) => p.name);
    return {
      title: d.title, winnersCount: d.winners_count, pool,
      winners: drawWinners(d.id).filter((w) => w.status === 'won').map(({ name, company }) => ({ name, company })),
    };
  }
  if (mode === 'spotlight') {
    return {
      messages: db.prepare(`SELECT s.id, s.message, f.name AS from_name, t.name AS to_name, t.company AS to_company FROM spotlights s
        JOIN attendees f ON f.id = s.from_id JOIN attendees t ON t.id = s.to_id WHERE s.status = 'approved' ORDER BY s.id DESC LIMIT 30`).all(),
      top: db.prepare(`SELECT t.name, COUNT(*) AS stars FROM spotlights s JOIN attendees t ON t.id = s.to_id
        WHERE s.status = 'approved' GROUP BY t.id ORDER BY stars DESC, MIN(s.id) LIMIT 5`).all(),
    };
  }
  // welcome: what's on now and next, in event time (IST)
  const ist = new Date(Date.now() + 5.5 * 3600e3).toISOString();
  const day = ist.slice(0, 10), hm = ist.slice(11, 16);
  const sessions = db.prepare('SELECT title, day, start_time, end_time, location FROM sessions ORDER BY day, start_time, id').all();
  return {
    current: sessions.find((s) => s.day === day && s.start_time <= hm && hm < s.end_time) || null,
    next: sessions.find((s) => s.day > day || (s.day === day && s.start_time > hm)) || null,
  };
}
admin.get('/screen', (_req, res) => {
  const s = getScreen();
  const data = screenData(s);
  res.json(data ? { ...s, data } : { mode: 'welcome', data: screenData({ mode: 'welcome' }) }); // item deleted: fall back
});
admin.post('/screen', (req, res) => {
  const mode = String(req.body?.mode || '');
  if (!SCREEN_MODES.includes(mode)) return bad(res, 'Unknown screen mode');
  const s = { mode, id: req.body.id ? Number(req.body.id) : null };
  if (!screenData(s)) return bad(res, 'That item no longer exists', 404);
  setSetting('screen', JSON.stringify(s));
  res.json(s);
});

admin.get('/media', (req, res) => {
  const status = req.query.status;
  const rows = db.prepare(`SELECT m.*, a.name AS uploader FROM media m LEFT JOIN attendees a ON a.id = m.attendee_id
    ${status ? 'WHERE m.status = ?' : ''} ORDER BY m.id DESC`).all(...(status ? [status] : []));
  res.json(rows);
});
admin.patch('/media/:id', (req, res) => {
  const s = req.body?.status;
  if (!['pending', 'approved', 'rejected'].includes(s)) return bad(res, 'Bad status');
  db.prepare('UPDATE media SET status = ? WHERE id = ?').run(s, req.params.id);
  live.sendAll('gallery', {});
  res.json({ ok: true });
});
admin.delete('/media/:id', (req, res) => {
  const m = db.prepare('SELECT file_path FROM media WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM media WHERE id = ?').run(req.params.id);
  if (m) fs.rm(path.join(UPLOAD_DIR, m.file_path), () => {});
  live.sendAll('gallery', {});
  res.json({ ok: true });
});
admin.post('/media', upload.array('files', 20), (req, res) => {
  if (!req.files?.length) return bad(res, 'No files');
  const ins = db.prepare("INSERT INTO media(attendee_id, file_path, media_type, caption, status, official) VALUES (NULL,?,?,?, 'approved', 1)");
  for (const f of req.files) ins.run(f.filename, mediaType(f.mimetype), String(req.body.caption || '').slice(0, 300));
  live.sendAll('gallery', {});
  res.json({ ok: true, count: req.files.length });
});
admin.post('/gallery/announce', (req, res) => {
  res.json(broadcast({
    title: req.body?.title || 'The official AMG 2026 photos & videos are here',
    waHeadline: 'the official event photos and videos are now on the gallery',
    message: req.body?.message || 'Relive the moments from Goa — browse and download the official photos and videos.',
    path: '/#gallery',
    cta: 'Open the gallery',
  }));
});

app.use('/api/admin', admin);
app.use('/api', api);

// ---------------- errors ----------------
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) return bad(res, err.code === 'LIMIT_FILE_SIZE' ? `Files must be under ${MAX_MB} MB` : err.message);
  console.error(err);
  bad(res, 'Something went wrong', 500);
});

app.listen(PORT, () => {
  console.log(`AMG 2026 microsite running on http://localhost:${PORT}`);
  console.log(`Admin console: http://localhost:${PORT}/admin`);
  console.log('Channels:', channelStatus());
});
