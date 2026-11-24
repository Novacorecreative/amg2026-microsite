// Loads a CSV of attendees (Name, Email, Phone, Company…) onto a running microsite through the admin API.
// Usage: node --use-system-ca scripts/import-attendees.mjs https://your-site.onrender.com path/to/list.csv
// Re-running is safe: people already on the site (same email or phone) are updated, not duplicated.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const [base, csvPath] = process.argv.slice(2);
if (!base || !csvPath) {
  console.error('Usage: node scripts/import-attendees.mjs <site address> <list.csv>');
  process.exit(1);
}
const csv = readFileSync(csvPath, 'utf8');
// Ask for the password with typing hidden, so it stays out of shell history.
const password = await new Promise((resolve) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Admin password (from Render > Environment > ADMIN_PASSWORD), then Enter: ', (v) => { rl.close(); console.log(); resolve(v.trim()); });
  rl._writeToOutput = (s) => { if (!s.includes('Admin password')) return; rl.output.write(s); };
});
const BASE = base.replace(/\/$/, '');
const login = await fetch(`${BASE}/api/admin/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
}).then((r) => r.json());
if (!login.token) throw new Error(`Login failed: ${JSON.stringify(login)}`);

const res = await fetch(`${BASE}/api/admin/attendees/import`, {
  method: 'POST', headers: { 'x-admin': login.token, 'Content-Type': 'text/csv' }, body: csv,
});
const out = await res.json();
if (!res.ok) throw new Error(`Import failed: ${JSON.stringify(out)}`);
console.log(`Added ${out.created}, updated ${out.updated}.`);
if (out.errors.length) console.log('Skipped:\n  ' + out.errors.join('\n  '));
