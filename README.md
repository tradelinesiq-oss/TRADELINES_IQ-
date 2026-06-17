# TradelineIQ Backend

A small, self-contained Node.js + Express server (zero-dependency JSON store) that gives your
`index.html` real, cross-device accounts. It implements the exact `/api/*`
endpoints the front-end already calls, so **no changes to your HTML logic are
needed** — you only point it at this server (one line, see step 4).

## Why Node + Express (and not Supabase/Firebase)?

Your front-end already talks to plain REST endpoints (`/api/register`,
`/api/login`, `/api/forgot-password`, `/api/send-confirmation-email`). A custom
server can match those request/response shapes **exactly**, so it drops in with
zero front-end rewrite. Supabase/Firebase would require adopting their client
SDK and auth flow and rebuilding the sign-in code. For this project, the custom
server is the faster, cleaner fit.

Passwords are hashed with **bcrypt** (never stored in plaintext). Email
verification and password resets use one-time, expiring tokens. Data is kept in
a single `data.json` file by default — no database server and **no native build
step**, so `npm install` works on any host. (Upgrade path to SQLite/Postgres
below.)

---

## 1. Install

```bash
cd backend
npm install
```

## 2. Configure

```bash
cp .env.example .env
# edit .env — at minimum set JWT_SECRET. SMTP is optional (see below).
```

## 3. Run

```bash
npm start          # production
npm run dev        # auto-restart on file changes
```

The data file (`data.json`) is created automatically on first run. You should see:

```
TradelineIQ backend listening on http://localhost:8000
```

Test it:

```bash
curl http://localhost:8000/health
```

## 4. Connect your front-end (the only change to index.html)

Find this block near the top of the `<script>` in `index.html`:

```js
window.TRADELINE_CONFIG = {
  baseUrl: 'http://localhost:8000',
  ...
};
```

Set `baseUrl` to wherever this server runs:

- Local testing: `http://localhost:8000`
- Production: `https://api.yourdomain.com` (your deployed backend URL)

That's it. Registration now writes to the server, and **login works from any
device or browser** using the same email + password. (The browser-local
fallback still works too, so the page is usable even if the backend is down.)

> Open `index.html` over a local web server (e.g. `npx serve`) rather than via
> `file://`, so the browser allows the cross-origin API calls.

---

## Email setup (optional but recommended)

Leave the `SMTP_*` variables blank and the server runs fine — it just **prints
the verification / reset links to the console** so you can copy them while
testing.

To send real email, fill in the `SMTP_*` values in `.env`. Any SMTP provider
works (Mailgun, SendGrid, Amazon SES, Postmark, even Gmail with an app
password). Example for Mailgun:

```
MAIL_FROM=TradelineIQ <welcome@yourdomain.com>
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=postmaster@yourdomain.com
SMTP_PASS=your-mailgun-password
```

---

## Deploy

Works on any Node host. Easiest options:

### Render
1. Push this `backend/` folder to a Git repo.
2. New ➜ Web Service ➜ pick the repo.
3. Build command `npm install`, start command `npm start`.
4. Add a **Disk** mounted at `/data` and set `DB_PATH=/data/data.json` so
   accounts survive restarts.
5. Set the other env vars (`JWT_SECRET`, `PUBLIC_URL`, `CORS_ORIGIN`, SMTP).

### Railway / Fly.io
Same idea — Node service, `npm start`, attach a volume for `data.json`, set
the env vars.

> The JSON store is perfect for getting started and small traffic. When you
> outgrow it, the **only** file you change is `db.js` — swap it for SQLite
> (`better-sqlite3`) or Postgres (`pg`) keeping the same exported function
> names, and `server.js` won't change. The intended SQL schema is in
> `schema.sql` for reference.

---

## API reference

| Method | Path                          | Body                                                                 | Purpose |
|--------|-------------------------------|----------------------------------------------------------------------|---------|
| POST   | `/api/register`               | `email, password, first_name, last_name, phone, state, zip_code, plan` | Create account + send verify email |
| POST   | `/api/login`                  | `email, password`                                                    | Authenticate from any device → returns `{name, initials, plan, createdAt, token}` |
| POST   | `/api/send-confirmation-email`| `to, name, plan, verifyUrl`                                          | (Re)send the verification email |
| POST   | `/api/forgot-password`        | `email`                                                              | Email a reset link (always returns ok) |
| POST   | `/api/reset-password`         | `token, password`                                                   | Set a new password |
| GET    | `/verify?token=...`           | —                                                                    | Confirm an email address |
| GET    | `/reset?token=...`            | —                                                                    | Small page to choose a new password |
| POST   | `/api/applications`           | `id, type_key, service, details, status, submitted_at` (+ `email`)   | Save a submitted application |
| GET    | `/api/applications?email=...` | —                                                                    | List a member's applications |
| PATCH  | `/api/applications/:id`       | `status`                                                            | Update an application's status |
| GET    | `/health`                     | —                                                                    | Uptime check |

The `applications` endpoints let the **"Track applications"** screen sync across
devices too. The front-end works without them (it tracks locally); wire them up
when you want a member to see the same applications everywhere.
