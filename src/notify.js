// Outbound notifications: WhatsApp (Meta Cloud API or Twilio) + Email (SMTP).
// If a channel is not configured, messages are recorded as "dry-run" so you can
// test the whole flow before connecting real accounts.
const crypto = require('node:crypto');
const nodemailer = require('nodemailer');
const { db } = require('./db');
const { getBranding, onColor } = require('./branding');

const env = (k, d = '') => (process.env[k] ?? d).trim();

const EVENT_NAME = () => getBranding().eventName;
const BASE_URL = () => env('BASE_URL', `http://localhost:${env('PORT', '3000')}`).replace(/\/$/, '');

function personalLink(attendee, path = '/') {
  const sep = path.includes('?') ? '&' : '?';
  return `${BASE_URL()}${path}${sep}t=${attendee.token}`;
}

// ---------- phone helpers ----------
function normalisePhone(raw) {
  if (!raw) return '';
  let d = String(raw).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d.slice(1);
  d = d.replace(/^0+/, '');
  if (d.length === 10) d = env('DEFAULT_COUNTRY_CODE', '91') + d;
  return d;
}

// ---------- WhatsApp ----------
function whatsappConfigured() {
  const p = env('WHATSAPP_PROVIDER').toLowerCase();
  if (p === 'meta') return !!(env('WA_META_TOKEN') && env('WA_META_PHONE_NUMBER_ID') && env('WA_TEMPLATE_NAME'));
  if (p === 'twilio') return !!(env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && env('TWILIO_WHATSAPP_FROM'));
  return false;
}

// Business-initiated WhatsApp messages must use a pre-approved template.
// Template body (register this in WhatsApp Manager / Twilio Content):
//   "Hi {{1}}, {{2}} on the AMG 2026 microsite. Open it here: {{3}} See you in Goa!"
// (Meta rejects a template whose body ends with a variable, hence the closing words.)
async function sendWhatsApp(to, vars) {
  const p = env('WHATSAPP_PROVIDER').toLowerCase();
  const params = [vars.name, vars.headline, vars.link];
  if (p === 'meta') {
    const url = `https://graph.facebook.com/${env('WA_META_API_VERSION', 'v21.0')}/${env('WA_META_PHONE_NUMBER_ID')}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env('WA_META_TOKEN')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: env('WA_TEMPLATE_NAME'),
          language: { code: env('WA_TEMPLATE_LANG', 'en') },
          components: [{ type: 'body', parameters: params.map((t) => ({ type: 'text', text: String(t).slice(0, 900) })) }],
        },
      }),
    });
    if (!res.ok) throw new Error(`Meta ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return;
  }
  if (p === 'twilio') {
    const sid = env('TWILIO_ACCOUNT_SID');
    const form = new URLSearchParams({ From: `whatsapp:${env('TWILIO_WHATSAPP_FROM')}`, To: `whatsapp:+${to}` });
    if (env('TWILIO_CONTENT_SID')) {
      form.set('ContentSid', env('TWILIO_CONTENT_SID'));
      form.set('ContentVariables', JSON.stringify({ 1: params[0], 2: params[1], 3: params[2] }));
    } else {
      form.set('Body', `Hi ${params[0]}, ${params[1]} on the ${EVENT_NAME()} microsite. Open it here: ${params[2]}`);
    }
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${env('TWILIO_AUTH_TOKEN')}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return;
  }
  throw new Error('WhatsApp not configured');
}

// ---------- Email ----------
let transporter = null;
function emailConfigured() {
  return !!(env('SMTP_HOST') && env('MAIL_FROM'));
}
function getTransport() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env('SMTP_HOST'),
      port: Number(env('SMTP_PORT', '587')),
      secure: env('SMTP_SECURE') === 'true',
      auth: env('SMTP_USER') ? { user: env('SMTP_USER'), pass: env('SMTP_PASS') } : undefined,
    });
  }
  return transporter;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function emailHtml({ name, title, message, link, cta }) {
  const b = getBranding();
  const onPrimary = onColor(b.colorPrimary);
  // Email clients need an absolute URL; Gmail/Outlook don't show SVG, so PNG/JPG logos work best.
  const logo = b.logo
    ? `<img src="${esc(BASE_URL() + b.logo)}" alt="${esc(b.clientName)}" height="40" style="display:block;height:40px;max-width:200px;margin-bottom:14px;${b.logoBadge ? 'background:#fff;padding:6px 10px;border-radius:8px;' : ''}">`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f3efe7;font-family:Segoe UI,Arial,sans-serif;color:#1c2b2a">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:14px;overflow:hidden">
    <tr><td style="background:${b.colorPrimary};padding:22px 28px;color:${onPrimary};border-bottom:4px solid ${b.colorHighlight}">
      ${logo}
      <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;opacity:.8">${esc(b.clientName)}</div>
      ${b.titleArt
        ? `<img src="${esc(BASE_URL() + b.titleArt)}" alt="${esc(b.eventName)}" width="200" style="display:block;width:200px;max-width:100%;height:auto;margin:10px 0 6px">
           <div style="font-size:14px;opacity:.85">${esc(env('EVENT_CITY', 'Goa'))}</div>`
        : `<div style="font-size:24px;font-weight:700;margin-top:4px">${esc(b.eventName)} · ${esc(env('EVENT_CITY', 'Goa'))}</div>`}
      ${b.tagline ? `<div style="font-size:14px;opacity:.85;margin-top:4px">${esc(b.tagline)}</div>` : ''}
    </td></tr>
    <tr><td style="padding:28px">
      <p style="margin:0 0 12px">Hi ${esc(name)},</p>
      <h2 style="margin:0 0 10px;font-size:20px">${esc(title)}</h2>
      ${message ? `<p style="margin:0 0 20px;line-height:1.55;white-space:pre-line">${esc(message)}</p>` : ''}
      <a href="${esc(link)}" style="display:inline-block;background:${b.colorAccent};color:${onColor(b.colorAccent)};text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">${esc(cta || 'Open the microsite')}</a>
      <p style="margin:22px 0 0;font-size:12px;color:#6b7c7a">This is your personal link — please don't forward it.</p>
    </td></tr>
    ${b.partnerLogos.length ? `<tr><td align="center" style="padding:16px 28px 22px;border-top:1px solid #eee">
      ${b.partnerLogos.map((src) => `<img src="${esc(BASE_URL() + src)}" alt="" height="32" style="height:32px;width:auto;max-width:120px;margin:4px 12px;vertical-align:middle">`).join('')}
    </td></tr>` : ''}
  </table></td></tr></table></body></html>`;
}

async function sendEmail(to, payload) {
  await getTransport().sendMail({
    from: env('MAIL_FROM'),
    to,
    subject: payload.subject,
    text: `Hi ${payload.name},\n\n${payload.title}\n\n${payload.message || ''}\n\nOpen: ${payload.link}`,
    html: emailHtml(payload),
  });
}

// ---------- Broadcast ----------
const logStmt = db.prepare(
  'INSERT INTO notifications(batch, attendee_id, channel, subject, status, error) VALUES (?,?,?,?,?,?)'
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Notify attendees on WhatsApp + email. Runs in the background; returns the batch id.
 * @param {object} o
 * @param {string} o.title      Headline, e.g. "New video: Opening keynote"
 * @param {string} [o.message]  Longer text for email
 * @param {string} [o.path]     Microsite path to deep-link to, e.g. "/#feed"
 * @param {string} [o.cta]      Email button label
 * @param {number[]} [o.attendeeIds]  Limit to these attendees (default: everyone)
 * @param {('whatsapp'|'email')[]} [o.channels]
 */
function broadcast(o) {
  const batch = crypto.randomBytes(6).toString('hex');
  const channels = o.channels && o.channels.length ? o.channels : ['whatsapp', 'email'];
  let people = db.prepare('SELECT * FROM attendees ORDER BY id').all();
  if (o.attendeeIds) {
    const set = new Set(o.attendeeIds.map(Number));
    people = people.filter((p) => set.has(p.id));
  }
  const waLive = whatsappConfigured();
  const mailLive = emailConfigured();
  const subject = `${EVENT_NAME()}: ${o.title}`;

  (async () => {
    for (const a of people) {
      const link = personalLink(a, o.path || '/');
      const firstName = String(a.name).split(' ')[0];
      if (channels.includes('whatsapp')) {
        const to = normalisePhone(a.phone);
        if (!to || !a.notify_whatsapp) logStmt.run(batch, a.id, 'whatsapp', subject, 'skipped', to ? 'opted out' : 'no phone');
        else if (!waLive) logStmt.run(batch, a.id, 'whatsapp', subject, 'dry-run', null);
        else {
          try {
            await sendWhatsApp(to, { name: firstName, headline: o.waHeadline || o.title, link });
            logStmt.run(batch, a.id, 'whatsapp', subject, 'sent', null);
          } catch (e) {
            logStmt.run(batch, a.id, 'whatsapp', subject, 'failed', String(e.message).slice(0, 500));
          }
          await sleep(120); // stay well under provider rate limits
        }
      }
      if (channels.includes('email')) {
        if (!a.email || !a.notify_email) logStmt.run(batch, a.id, 'email', subject, 'skipped', a.email ? 'opted out' : 'no email');
        else if (!mailLive) logStmt.run(batch, a.id, 'email', subject, 'dry-run', null);
        else {
          try {
            await sendEmail(a.email, { subject, name: firstName, title: o.title, message: o.message, link, cta: o.cta });
            logStmt.run(batch, a.id, 'email', subject, 'sent', null);
          } catch (e) {
            logStmt.run(batch, a.id, 'email', subject, 'failed', String(e.message).slice(0, 500));
          }
          await sleep(80);
        }
      }
    }
    console.log(`[notify] batch ${batch} finished for ${people.length} attendee(s)`);
  })().catch((e) => console.error('[notify] batch crashed', e));

  return { batch, recipients: people.length, whatsapp: waLive ? 'live' : 'dry-run', email: mailLive ? 'live' : 'dry-run' };
}

function channelStatus() {
  return {
    whatsapp: whatsappConfigured() ? `live (${env('WHATSAPP_PROVIDER')})` : 'dry-run (not configured)',
    email: emailConfigured() ? 'live (SMTP)' : 'dry-run (not configured)',
    baseUrl: BASE_URL(),
  };
}

module.exports = { broadcast, channelStatus, personalLink, normalisePhone, emailHtml, BASE_URL };
