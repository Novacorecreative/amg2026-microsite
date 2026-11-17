// Loads the AMG 2026 branding (files in brand/) onto a running microsite through the admin API.
// Usage: node scripts/apply-branding.mjs https://your-site.onrender.com <admin-password>
import { readFileSync } from 'node:fs';

const [base, password] = process.argv.slice(2);
if (!base || !password) {
  console.error('Usage: node scripts/apply-branding.mjs <site address> <admin password>');
  process.exit(1);
}
const BASE = base.replace(/\/$/, '');
const file = (name, type) => new Blob([readFileSync(new URL(`../brand/${name}`, import.meta.url))], { type });

const login = await fetch(`${BASE}/api/admin/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
}).then((r) => r.json());
if (!login.token) throw new Error(`Login failed: ${JSON.stringify(login)}`);

const fd = new FormData();
for (const [k, v] of Object.entries({
  clientName: 'Grindwell Norton', eventName: 'AMG 2026', tagline: 'Proud to Lead, Ready to Grow',
  colorPrimary: '#1c2d7c', colorAccent: '#e8202e', colorHighlight: '#f07420',
  logoBadge: 'true', heroTint: 'light', font: 'montserrat',
})) fd.append(k, v);
fd.append('logo', file('norton-saint-gobain.png', 'image/png'), 'norton-saint-gobain.png');
fd.append('titleArt', file('amg-managers-meet-2026.png', 'image/png'), 'amg-managers-meet-2026.png');
fd.append('hero', file('header-artwork.jpg', 'image/jpeg'), 'header-artwork.jpg');
// Replace any partner logos already there, so re-running doesn't add duplicates.
const current = await fetch(`${BASE}/api/config`).then((r) => r.json());
fd.append('removePartners', JSON.stringify(current.branding.partnerLogos));
fd.append('partners', file('lead-and-grow-2030.png', 'image/png'), 'lead-and-grow-2030.png');
fd.append('partners', file('saint-gobain.png', 'image/png'), 'saint-gobain.png');

const res = await fetch(`${BASE}/api/admin/branding`, { method: 'PUT', headers: { 'x-admin': login.token }, body: fd });
const out = await res.json();
if (!res.ok) throw new Error(`Branding failed: ${JSON.stringify(out)}`);
console.log('Branding applied:', out.clientName, out.eventName, out.colorPrimary);
