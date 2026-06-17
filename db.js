// ============================================================
//  db.js — zero-dependency JSON data layer
//  Pure JavaScript, no native build step — installs and runs on
//  any host. Exposes the same tiny statement API (.run/.get/.all)
//  that server.js uses, so you can later swap this single file for
//  SQLite (better-sqlite3) or Postgres (pg) WITHOUT touching
//  server.js. The conceptual schema lives in schema.sql.
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.json');

let data = { users: {}, tokens: {}, applications: {} };

function load() {
  try {
    if (fs.existsSync(DB_PATH)) data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) { console.warn('[db] could not read store, starting fresh:', e.message); }
  data.users ||= {}; data.tokens ||= {}; data.applications ||= {};
}
function save() {
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_PATH);            // atomic write
}
load();

export function initSchema() {
  save();
  console.log('[db] JSON store ready at', DB_PATH);
}

// ---- Users ----------------------------------------------------
export const createUser = { run(u) {
  if (data.users[u.email]) { const e = new Error('UNIQUE constraint failed: users.email'); e.code = 'DUP'; throw e; }
  data.users[u.email] = { ...u, verified: 0 }; save();
}};
export const getUserByEmail = { get(email) { return data.users[email]; } };
export const setUserVerified = { run(email) { if (data.users[email]) { data.users[email].verified = 1; save(); } } };
export const setUserPassword = { run(hash, email) { if (data.users[email]) { data.users[email].password_hash = hash; save(); } } };

// ---- Tokens ---------------------------------------------------
export const createToken = { run(t) { data.tokens[t.token] = { used: 0, ...t }; save(); } };
export const getToken = { get(token) { return data.tokens[token]; } };
export const useToken = { run(token) { if (data.tokens[token]) { data.tokens[token].used = 1; save(); } } };

// ---- Applications ---------------------------------------------
export const createApplication = { run(a) {
  if (data.applications[a.id]) { const e = new Error('UNIQUE constraint failed: applications.id'); e.code = 'DUP'; throw e; }
  data.applications[a.id] = a; save();
}};
export const listApplicationsByEmail = { all(email) {
  return Object.values(data.applications).filter(a => a.email === email).sort((x, y) => y.submitted_at - x.submitted_at);
}};
export const updateApplicationStatus = { run(o) {
  const a = data.applications[o.id];
  if (a) { a.status = o.status; a.updated_at = o.updated_at; save(); }
}};

if (process.argv.includes('--init')) { initSchema(); process.exit(0); }
