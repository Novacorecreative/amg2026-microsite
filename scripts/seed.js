// Demo data so you can click through the microsite before real attendees are loaded.
// Usage: npm run seed   (safe to re-run; it only adds what is missing)
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
if (fs.existsSync(path.join(__dirname, '..', '.env'))) process.loadEnvFile(path.join(__dirname, '..', '.env'));
const { db, tx, getSetting, setSetting } = require('../src/db');

// --once (used on the host at every start): seed only a brand-new database, so demo people
// never come back after organisers delete them.
if (process.argv.includes('--once') && getSetting('seeded')) process.exit(0);

const start = process.env.EVENT_START_DATE || '2026-12-10';
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const d1 = start, d2 = addDays(start, 1), d3 = addDays(start, 2);

tx(() => {
  if (!db.prepare('SELECT COUNT(*) n FROM attendees').get().n) {
    const people = [
      ['Aarav Mehta', 'aarav.mehta@example.com', '9800000001', 'Grindwell Norton', 'Regional Sales Head'],
      ['Priya Nair', 'priya.nair@example.com', '9800000002', 'Coastal Abrasives', 'Partner'],
      ['Rohan Desai', 'rohan.desai@example.com', '9800000003', 'Desai Industrial Supplies', 'Director'],
      ['Sneha Kulkarni', 'sneha.k@example.com', '9800000004', 'Grindwell Norton', 'Marketing Manager'],
      ['Imran Shaikh', 'imran.shaikh@example.com', '9800000005', 'Shaikh Tools & Co.', 'Owner'],
      ['Ananya Iyer', 'ananya.iyer@example.com', '9800000006', 'Precision Grind Works', 'CEO'],
    ];
    const ins = db.prepare('INSERT INTO attendees(name,email,phone,company,designation,token) VALUES (?,?,?,?,?,?)');
    for (const p of people) ins.run(p[0], p[1], '91' + p[2], p[3], p[4], crypto.randomBytes(18).toString('base64url'));
  }

  if (!db.prepare('SELECT COUNT(*) n FROM sessions').get().n) {
    const s = [
      [d1, '14:00', '16:00', 'Arrivals, check-in & welcome kit', null, 'Hotel lobby', 'Collect your badge and welcome kit at the AMG desk.'],
      [d1, '17:30', '18:30', 'Sunset welcome on the lawns', null, 'Beach lawns', 'Smart casuals. Mocktails and live acoustic set.'],
      [d1, '19:30', '22:30', 'Opening night dinner', null, 'Grand Ballroom', null],
      [d2, '09:30', '10:15', 'Opening keynote: The year ahead', 'Managing Director', 'Grand Ballroom', null],
      [d2, '10:15', '11:30', 'Product showcase & new launches', 'Product team', 'Grand Ballroom', null],
      [d2, '11:30', '11:45', 'Coffee break', null, 'Foyer', null],
      [d2, '11:45', '13:00', 'Partner panel: Growing together', 'Panel', 'Grand Ballroom', null],
      [d2, '13:00', '14:00', 'Lunch', null, 'Coastal Café', null],
      [d2, '14:30', '17:30', 'Team activity: Beach olympics', null, 'Beach', 'Wear comfortable clothes and sunscreen!'],
      [d2, '20:00', '23:30', 'AMG Awards night', null, 'Grand Ballroom', 'Dress code: Indo-western.'],
      [d3, '09:00', '10:30', 'Breakfast & feedback', null, 'Coastal Café', null],
      [d3, '11:00', '12:00', 'Check-out & departures', null, 'Hotel lobby', null],
    ];
    const ins = db.prepare('INSERT INTO sessions(day,start_time,end_time,title,speaker,location,description) VALUES (?,?,?,?,?,?,?)');
    for (const r of s) ins.run(...r);
  }

  if (!db.prepare('SELECT COUNT(*) n FROM posts').get().n) {
    db.prepare('INSERT INTO posts(title, body, pinned) VALUES (?,?,1)').run(
      'Welcome to AMG 2026, Goa!',
      'This is your home for the conference: live updates, the agenda, quizzes and polls, and the photo wall. Keep this page handy — we will ping you on WhatsApp and email whenever something new goes up.'
    );
  }

  if (!db.prepare('SELECT COUNT(*) n FROM activities').get().n) {
    const quiz = Number(db.prepare("INSERT INTO activities(kind,title,description) VALUES ('quiz',?,?)").run('Goa Warm-up Quiz', 'Three quick questions. Highest score wins; ties go to the fastest.').lastInsertRowid);
    const q = db.prepare('INSERT INTO questions(activity_id, position, qtype, text, options, correct_index, points) VALUES (?,?,?,?,?,?,?)');
    q.run(quiz, 0, 'choice', 'What is the capital of Goa?', JSON.stringify(['Margao', 'Panaji', 'Vasco da Gama', 'Mapusa']), 1, 1);
    q.run(quiz, 1, 'choice', 'Which river flows through Panaji?', JSON.stringify(['Zuari', 'Mandovi', 'Chapora', 'Terekhol']), 1, 1);
    q.run(quiz, 2, 'choice', 'Goa became a state of India in which year?', JSON.stringify(['1961', '1975', '1987', '1999']), 2, 1);

    const poll = Number(db.prepare("INSERT INTO activities(kind,title,description) VALUES ('poll',?,?)").run('Pick the theme for Awards night', 'Most votes wins!').lastInsertRowid);
    q.run(poll, 0, 'choice', 'Which theme should we go with?', JSON.stringify(['Bollywood Retro', 'Goan Carnival', 'Black & Gold', 'Beach Luau']), null, 1);
    q.run(poll, 1, 'text', 'Any song requests for the DJ?', '[]', null, 1);
  }
});

setSetting('seeded', '1');
console.log('Seeded. Attendee links:');
for (const a of db.prepare('SELECT name, token FROM attendees ORDER BY id LIMIT 6').all()) {
  console.log(`  ${a.name.padEnd(18)} http://localhost:${process.env.PORT || 3000}/?t=${a.token}`);
}
