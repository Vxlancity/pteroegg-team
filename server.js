const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.SERVER_PORT || process.env.PORT || 3000);
const HOST = process.env.SERVER_IP || '0.0.0.0';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'panel.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, expected] = String(stored).split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
function load() {
  if (!fs.existsSync(DATA_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return null; }
}
function save(db) {
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
function id() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }

let db = load();
if (!db) {
  const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  db = {
    settings: { teamName: process.env.TEAM_NAME || 'VxTeam', description: 'Self-hosted team management' },
    users: [{ id: id(), name: 'Administrator', email: process.env.ADMIN_EMAIL || 'admin@localhost', password: hashPassword(adminPassword), role: 'owner', createdAt: now() }],
    tasks: [], meetings: [], applications: [], announcements: [], links: []
  };
  save(db);
  console.log(`[VxTeamPanel] Initial admin: ${db.users[0].email}`);
  if (!process.env.ADMIN_PASSWORD) console.log('[VxTeamPanel] Default password: ChangeMe123! — change it immediately.');
}

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Nicht angemeldet' });
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'Sitzung ungültig' });
  req.user = user;
  next();
}
function cleanUser(u) { return { id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt }; }

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'VxTeamPanel', version: '1.0.0' }));
app.get('/api/me', auth, (req, res) => res.json({ user: cleanUser(req.user), settings: db.settings }));

app.post('/api/auth/register', (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (name.length < 2 || !email.includes('@') || password.length < 8) return res.status(400).json({ error: 'Name, E-Mail und ein Passwort mit mindestens 8 Zeichen sind erforderlich.' });
  if (db.users.some(u => u.email === email)) return res.status(409).json({ error: 'Diese E-Mail ist bereits registriert.' });
  const user = { id: id(), name, email, password: hashPassword(password), role: 'member', createdAt: now() };
  db.users.push(user); save(db);
  req.session.userId = user.id;
  res.status(201).json({ user: cleanUser(user) });
});
app.post('/api/auth/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.users.find(u => u.email === email);
  if (!user || !verifyPassword(password, user.password)) return res.status(401).json({ error: 'E-Mail oder Passwort falsch.' });
  req.session.userId = user.id;
  res.json({ user: cleanUser(user) });
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get('/api/dashboard', auth, (req, res) => res.json({
  members: db.users.length,
  tasks: db.tasks.filter(t => t.status !== 'done').length,
  meetings: db.meetings.length,
  applications: db.applications.filter(a => a.status === 'open').length,
  announcements: db.announcements.slice(-5).reverse()
}));
app.get('/api/members', auth, (req, res) => res.json(db.users.map(cleanUser)));
app.delete('/api/members/:id', auth, (req, res) => {
  if (!['owner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Keine Berechtigung' });
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Du kannst dich nicht selbst entfernen.' });
  db.users = db.users.filter(u => u.id !== req.params.id); save(db); res.json({ ok: true });
});

app.get('/api/tasks', auth, (req, res) => res.json(db.tasks));
app.post('/api/tasks', auth, (req, res) => {
  const task = { id: id(), title: String(req.body.title || '').trim(), status: 'open', assignee: String(req.body.assignee || ''), createdBy: req.user.id, createdAt: now() };
  if (!task.title) return res.status(400).json({ error: 'Titel fehlt.' });
  db.tasks.push(task); save(db); res.status(201).json(task);
});
app.patch('/api/tasks/:id', auth, (req, res) => {
  const task = db.tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Aufgabe nicht gefunden.' });
  if (req.body.title !== undefined) task.title = String(req.body.title).trim();
  if (req.body.assignee !== undefined) task.assignee = String(req.body.assignee);
  if (req.body.status !== undefined && ['open', 'progress', 'done'].includes(req.body.status)) task.status = req.body.status;
  save(db); res.json(task);
});
app.delete('/api/tasks/:id', auth, (req, res) => { db.tasks = db.tasks.filter(t => t.id !== req.params.id); save(db); res.json({ ok: true }); });

app.get('/api/meetings', auth, (req, res) => res.json(db.meetings));
app.post('/api/meetings', auth, (req, res) => {
  const meeting = { id: id(), title: String(req.body.title || '').trim(), date: String(req.body.date || ''), note: String(req.body.note || ''), createdBy: req.user.id, createdAt: now() };
  if (!meeting.title || !meeting.date) return res.status(400).json({ error: 'Titel und Datum fehlen.' });
  db.meetings.push(meeting); save(db); res.status(201).json(meeting);
});
app.delete('/api/meetings/:id', auth, (req, res) => { db.meetings = db.meetings.filter(m => m.id !== req.params.id); save(db); res.json({ ok: true }); });

app.get('/api/applications', auth, (req, res) => res.json(db.applications));
app.post('/api/applications', auth, (req, res) => {
  const application = { id: id(), name: String(req.body.name || '').trim(), text: String(req.body.text || '').trim(), status: 'open', createdAt: now() };
  if (!application.name || !application.text) return res.status(400).json({ error: 'Name und Bewerbungstext fehlen.' });
  db.applications.push(application); save(db); res.status(201).json(application);
});
app.patch('/api/applications/:id', auth, (req, res) => {
  const a = db.applications.find(x => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Bewerbung nicht gefunden.' });
  if (['open', 'accepted', 'rejected'].includes(req.body.status)) a.status = req.body.status;
  save(db); res.json(a);
});

app.get('/api/settings', auth, (req, res) => res.json(db.settings));
app.put('/api/settings', auth, (req, res) => {
  if (!['owner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Keine Berechtigung' });
  db.settings.teamName = String(req.body.teamName || db.settings.teamName).trim().slice(0, 80);
  db.settings.description = String(req.body.description || '').trim().slice(0, 240);
  save(db); res.json(db.settings);
});

app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, HOST, () => console.log(`[VxTeamPanel] listening on ${HOST}:${PORT}`));
