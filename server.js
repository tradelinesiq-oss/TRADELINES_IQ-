// ============================================================
//  server.js — TradelineIQ backend
//  Implements the exact /api/* endpoints the front-end already
//  calls, so it plugs straight into index.html with no rewrite.
//
//  Endpoints
//    POST /api/register                -> create account + send verify email
//    POST /api/login                   -> verify credentials (works on ANY device)
//    POST /api/send-confirmation-email -> (re)send verification email
//    POST /api/forgot-password         -> email a password-reset link
//    POST /api/reset-password          -> set a new password from a reset token
//    GET  /verify?token=...            -> confirm an email address
//    GET  /reset?token=...             -> tiny page to choose a new password
//    POST /api/applications            -> save a submitted application
//    GET  /api/applications?email=...  -> list a member's applications
//    PATCH/api/applications/:id        -> update an application's status
//    GET  /health                      -> uptime check
// ============================================================
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import {
  initSchema, createUser, getUserByEmail, setUserVerified, setUserPassword,
  createToken, getToken, useToken,
  createApplication, listApplicationsByEmail, updateApplicationStatus,
} from './db.js';

initSchema();

const app = express();
app.use(express.json({ limit: '1mb' }));

// --- CORS: allow your front-end origin(s). Set CORS_ORIGIN in .env. ---
const allowed = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim());
app.use(cors({ origin: allowed.includes('*') ? true : allowed }));

const PORT       = process.env.PORT || 8000;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const norm = (e) => String(e || '').trim().toLowerCase();
const now  = () => Date.now();

// ---------- email ----------
let transporter = null;
function getTransport() {
  if (transporter) return transporter;
  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE) === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}
async function sendMail({ to, subject, html }) {
  const t = getTransport();
  if (!t) {
    // Dev mode: no SMTP configured — log the message so you can still test.
    console.log(`\n[email:dev] To: ${to}\n[email:dev] Subject: ${subject}\n[email:dev] ${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}\n`);
    return { dev: true };
  }
  return t.sendMail({ from: process.env.MAIL_FROM || 'TradelineIQ <welcome@tradelineiq.com>', to, subject, html });
}
function makeToken() { return crypto.randomBytes(24).toString('hex'); }

// ---------- helpers ----------
function publicUser(u) {
  const initials = ((u.first_name || u.email || 'U')[0] + (u.last_name || '')[0] || '').toUpperCase().slice(0, 2);
  return {
    email: u.email,
    name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email,
    initials,
    plan: u.plan || 'Starter',
    verified: !!u.verified,
    createdAt: u.created_at,            // matches the front-end's `createdAt`
  };
}

// ============================================================
//  AUTH
// ============================================================
app.post('/api/register', async (req, res) => {
  try {
    const email = norm(req.body.email);
    const { password, first_name, last_name, phone, state, zip_code, plan } = req.body;
    if (!email || !password || password.length < 8) {
      return res.status(400).json({ error: 'A valid email and an 8+ character password are required.' });
    }
    if (getUserByEmail.get(email)) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }
    const password_hash = await bcrypt.hash(password, 12);
    const created_at = now();
    createUser.run({ email, password_hash, first_name, last_name, phone, state, zip_code, plan: plan || 'Starter', created_at });

    // Issue an email-verification token and send the welcome email.
    const token = makeToken();
    createToken.run({ token, email, kind: 'verify', expires_at: now() + 1000 * 60 * 60 * 24 });
    const verifyUrl = `${PUBLIC_URL}/verify?token=${token}`;
    await sendMail({
      to: email,
      subject: 'Welcome to TradelineIQ — confirm your email',
      html: `<h2>Welcome${first_name ? ', ' + first_name : ''}!</h2>
             <p>Your ${plan || 'Starter'} account is ready. Please confirm your email:</p>
             <p><a href="${verifyUrl}">Confirm my email</a></p>
             <p style="color:#888;font-size:12px">If you didn't create this account, ignore this message.</p>`,
    });

    const user = getUserByEmail.get(email);
    return res.json(publicUser(user));          // front-end reads user.email
  } catch (e) {
    console.error('register error', e);
    return res.status(500).json({ error: 'Registration failed.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const email = norm(req.body.email);
    const { password } = req.body;
    const u = getUserByEmail.get(email);
    if (!u) return res.status(401).json({ error: 'Incorrect email or password.' });
    const ok = await bcrypt.compare(String(password || ''), u.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect email or password.' });
    const token = jwt.sign({ email: u.email }, JWT_SECRET, { expiresIn: '30d' });
    return res.json({ ...publicUser(u), token }); // front-end uses name/initials/plan/createdAt
  } catch (e) {
    console.error('login error', e);
    return res.status(500).json({ error: 'Login failed.' });
  }
});

app.post('/api/send-confirmation-email', async (req, res) => {
  try {
    const email = norm(req.body.to);
    if (!email) return res.status(400).json({ error: 'Missing recipient.' });
    const token = makeToken();
    createToken.run({ token, email, kind: 'verify', expires_at: now() + 1000 * 60 * 60 * 24 });
    const verifyUrl = `${PUBLIC_URL}/verify?token=${token}`;
    await sendMail({
      to: email,
      subject: 'Confirm your TradelineIQ email',
      html: `<h2>Confirm your email</h2><p><a href="${verifyUrl}">Click here to verify</a> your address.</p>`,
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error('confirmation email error', e);
    return res.status(500).json({ error: 'Could not send email.' });
  }
});

app.post('/api/forgot-password', async (req, res) => {
  try {
    const email = norm(req.body.email);
    const u = getUserByEmail.get(email);
    // Always return ok (don't reveal whether the address exists).
    if (u) {
      const token = makeToken();
      createToken.run({ token, email, kind: 'reset', expires_at: now() + 1000 * 60 * 30 }); // 30 min
      const resetUrl = `${PUBLIC_URL}/reset?token=${token}`;
      await sendMail({
        to: email,
        subject: 'Reset your TradelineIQ password',
        html: `<h2>Password reset</h2><p><a href="${resetUrl}">Set a new password</a>. This link expires in 30 minutes.</p>`,
      });
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error('forgot error', e);
    return res.json({ ok: true });
  }
});

app.post('/api/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    const row = getToken.get(token);
    if (!row || row.kind !== 'reset' || row.used || row.expires_at < now()) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const hash = await bcrypt.hash(password, 12);
    setUserPassword.run(hash, row.email);
    useToken.run(token);
    return res.json({ ok: true });
  } catch (e) {
    console.error('reset error', e);
    return res.status(500).json({ error: 'Could not reset password.' });
  }
});

app.get('/verify', (req, res) => {
  const row = getToken.get(req.query.token);
  if (!row || row.kind !== 'verify' || row.used || row.expires_at < now()) {
    return res.status(400).send(page('Link expired', 'This verification link is invalid or has expired.'));
  }
  setUserVerified.run(row.email);
  useToken.run(req.query.token);
  res.send(page('Email confirmed ✓', 'Your email is verified. You can close this tab and sign in.'));
});

app.get('/reset', (req, res) => {
  const token = String(req.query.token || '');
  res.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
  <body style="font-family:system-ui;max-width:420px;margin:60px auto;padding:0 20px">
  <h2>Choose a new password</h2>
  <form onsubmit="go(event)">
    <input id="p" type="password" placeholder="New password (8+ chars)" style="width:100%;padding:12px;margin:8px 0;font-size:16px">
    <button style="width:100%;padding:12px;font-size:16px;background:#10B981;color:#fff;border:0;border-radius:8px">Set password</button>
  </form>
  <p id="m"></p>
  <script>
  async function go(e){e.preventDefault();
    const r=await fetch('/api/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token:${JSON.stringify(token)},password:document.getElementById('p').value})});
    document.getElementById('m').textContent = r.ok ? 'Password updated — you can sign in now.' : (await r.json()).error;
  }
  </script></body>`);
});

function page(title, msg) {
  return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
  <body style="font-family:system-ui;max-width:420px;margin:80px auto;text-align:center;padding:0 20px">
  <h2>${title}</h2><p style="color:#555">${msg}</p></body>`;
}

// ============================================================
//  APPLICATION TRACKING (optional cross-device sync)
// ============================================================
function authEmail(req) {
  // Prefer a bearer token; fall back to ?email / body.email for easy integration.
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    try { return norm(jwt.verify(h.slice(7), JWT_SECRET).email); } catch {}
  }
  return norm(req.query.email || req.body?.email || '');
}

app.post('/api/applications', (req, res) => {
  const email = authEmail(req);
  if (!email) return res.status(400).json({ error: 'Missing owner email.' });
  const { id, type_key, service, details, status, submitted_at } = req.body;
  const rec = {
    id: id || ('TLQ-' + Date.now().toString(36).toUpperCase()),
    email, type_key, service,
    details: details ? JSON.stringify(details) : null,
    status: status || 'received',
    submitted_at: submitted_at || now(),
    updated_at: now(),
  };
  try { createApplication.run(rec); } catch (e) { return res.status(409).json({ error: 'Application already exists.' }); }
  return res.json({ ok: true, application: rec });
});

app.get('/api/applications', (req, res) => {
  const email = authEmail(req);
  if (!email) return res.status(400).json({ error: 'Missing owner email.' });
  const rows = listApplicationsByEmail.all(email).map(r => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));
  return res.json({ applications: rows });
});

app.patch('/api/applications/:id', (req, res) => {
  updateApplicationStatus.run({ id: req.params.id, status: req.body.status || 'received', updated_at: now() });
  return res.json({ ok: true });
});

app.get('/health', (_req, res) => res.json({ ok: true, ts: now() }));

app.listen(PORT, () => {
  console.log(`TradelineIQ backend listening on ${PUBLIC_URL}`);
  if (!process.env.SMTP_HOST) console.log('[email] SMTP not configured — emails will be logged to the console (dev mode).');
});
