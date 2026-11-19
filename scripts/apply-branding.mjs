// Loads the AMG 2026 branding (brand/brand.json and its files) onto a running microsite through the admin API.
// Usage: node --use-system-ca scripts/apply-branding.mjs https://your-site.onrender.com  (asks for the admin password)
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const [base, passArg] = process.argv.slice(2);
if (!base) {
  console.error('Usage: node scripts/apply-branding.mjs <site address> [admin password]');
  process.exit(1);
}
// Without a password argument, ask for it with typing hidden, so it stays out of shell history.
const password = passArg || await new Promise((resolve) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Admin password (from Render > Environment > ADMIN_PASSWORD), then Enter: ', (v) => { rl.close(); console.log(); resolve(v.trim()); });
  rl._writeToOutput = (s) => { if (!s.includes('Admin password')) return; rl.output.write(s); };
});
const BASE = base.replace(/\/$/, '');
const file = (name, type) => new Blob([readFileSync(new URL(`../brand/${name}`, import.meta.url))], { type });

const login = await fetch(`${BASE}/api/admin/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
}).then((r) => r.json());
if (!login.token) throw new Error(`Login failed: ${JSON.stringify(login)}`);

const brand = JSON.parse(readFileSync(new URL('../brand/brand.json', import.meta.url), 'utf8'));
const type = (name) => (name.endsWith('.jpg') ? 'image/jpeg' : 'image/png');
const fd = new FormData();
for (const k of ['clientName', 'eventName', 'tagline', 'colorPrimary', 'colorAccent', 'colorHighlight', 'logoBadge', 'heroTint', 'font']) {
  fd.append(k, String(brand[k]));
}
fd.append('logo', file(brand.logo, type(brand.logo)), brand.logo);
fd.append('titleArt', file(brand.titleArt, type(brand.titleArt)), brand.titleArt);
fd.append('hero', file(brand.hero, type(brand.hero)), brand.hero);
// Replace any partner logos already there, so re-running doesn't add duplicates.
const current = await fetch(`${BASE}/api/config`).then((r) => r.json());
fd.append('removePartners', JSON.stringify(current.branding.partnerLogos));
for (const name of brand.partners) fd.append('partners', file(name, type(name)), name);

const res = await fetch(`${BASE}/api/admin/branding`, { method: 'PUT', headers: { 'x-admin': login.token }, body: fd });
const out = await res.json();
if (!res.ok) throw new Error(`Branding failed: ${JSON.stringify(out)}`);
console.log('Branding applied:', out.clientName, out.eventName, out.colorPrimary);
