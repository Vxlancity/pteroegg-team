const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const app = express();
const PORT = Number(process.env.SERVER_PORT || process.env.PORT || 3000);
const HOST = process.env.SERVER_IP || '0.0.0.0';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'panel.json');
const SOURCE_REPOSITORY = String(process.env.SOURCE_REPOSITORY || '');
const SOURCE_BRANCH = String(process.env.SOURCE_BRANCH || 'main');
const APP_VERSION = '1.1.0';

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
function admin(req, res, next) {
  if (!['owner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Keine Berechtigung' });
  next();
}
function cleanUser(u) { return { id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt }; }

function gitArgs(token, args) {
  return token ? ['-c', `http.extraheader=Authorization: Bearer ${token}`, ...args] : args;
}
function runGit(token, args, cwd = __dirname) {
  return spawnSync('git', gitArgs(token, args), { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
}
function getRemoteCommit() {
  if (!SOURCE_REPOSITORY) throw new Error('SOURCE_REPOSITORY ist nicht konfiguriert.');
  const result = runGit(process.env.GITHUB_TOKEN || '', ['ls-remote', SOURCE_REPOSITORY, `refs/heads/${SOURCE_BRANCH}`]);
  if (result.status !== 0) throw new Error(String(result.stderr || 'Repository konnte nicht erreicht werden.').trim());
  const hash = String(result.stdout || '').trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{40}$/.test(hash)) throw new Error('Kein gültiger Commit für den Update-Branch gefunden.');
  return hash;
}
function readInstalledCommit() {
  const file = path.join(__dirname, '.vxteam-commit');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
}
function writeInstalledCommit(commit) {
  fs.writeFileSync(path.join(__dirname, '.vxteam-commit'), `${commit}\n`);
}
function updateFromRepository() {
  if (!SOURCE_REPOSITORY) throw new Error('SOURCE_REPOSITORY ist nicht konfiguriert.');
  const token = process.env.GITHUB_TOKEN || '';
  const remoteCommit = getRemoteCommit();
  const tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'vxteampanel-update-'));
  try {
    const clone = runGit(token, ['clone', '--depth', '1', '--branch', SOURCE_BRANCH, SOURCE_REPOSITORY, tempDir], __dirname);
    if (clone.status !== 0) throw new Error(String(clone.stderr || 'Update-Repository konnte nicht geklont werden.').trim());

    const entries = fs.readdirSync(tempDir);
    for (const entry of entries) {
      if (entry === '.git' || entry === 'data' || entry === 'node_modules') continue;
      const source = path.join(tempDir, entry);
      const target = path.join(__dirname, entry);
      fs.rmSync(target, { recursive: true, force: true });
      fs.cpSync(source, target, { recursive: true });
    }
    writeInstalledCommit(remoteCommit);

    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const install = spawnSync(npm, ['install', '--omit=dev'], { cwd: __dirname, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
    if (install.status !== 0) throw new Error(String(install.stderr || 'npm install fehlgeschlagen.').trim());

    return remoteCommit;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'VxTeamPanel', version: APP_VERSION }));
app.get('/api/me', auth, (req, res) => res.json({ user: cleanUser(req.user), settings: db.settings }));

app.get('/api/update', auth, admin, (req, res) => {
  try {
    const remote = getRemoteCommit();
    const installed = readInstalledCommit();
    res.json({ currentVersion: APP_VERSION, installedCommit: installed || null, remoteCommit: remote, updateAvailable: Boolean(installed && installed !== remote), repository: SOURCE_REPOSITORY, branch: SOURCE_BRANCH });
  } catch (e) {
    res.status(500).json({ error: `Update-Prüfung fehlgeschlagen: ${e.message}` });
  }
});
app.post('/api/update', auth, admin, (req, res) => {
  try {
    const installed = readInstalledCommit();
    const remote = getRemoteCommit();
    if (installed && installed === remote) return res.json({ ok: true, updated: false, message: 'Das Panel ist bereits aktuell.', commit: remote, restartRequired: false });
    const commit = updateFromRepository();
    res.json({ ok: true, updated: true, message: 'Update installiert. Bitte den Pterodactyl-Server neu starten, damit der neue Backend-Code geladen wird.', commit, restartRequired: true });
  } catch (e) {
    res.status(500).json({ error: `Update fehlgeschlagen: ${e.message}` });
  }
});

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
