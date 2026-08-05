# Deploy LabCD to Ubuntu (`labcd.ai`)

Zero-to-hero guide: Docker production stack + GitHub Actions CI/CD for **https://labcd.ai**.

## Architecture

```
Browser → https://labcd.ai
            │
         Caddy (:80 / :443)     ← automatic HTTPS (Let's Encrypt)
            │
         frontend (nginx:80)
            ├─ /          → React SPA
            └─ /api/      → proxy → api:8000 (FastAPI)
                              │
                              └─ db (Postgres, Docker network only)
```

| File | Role |
|------|------|
| `docker-compose.prod.yml` | Production services (db, api, frontend, caddy) |
| `deploy/Caddyfile` | TLS + reverse proxy for `labcd.ai` / `www.labcd.ai` |
| `deploy/env.production.example` | Template for server `.env` |
| `deploy/deploy.sh` | Pull latest `master` and rebuild stack |
| `.github/workflows/deploy.yml` | SSH deploy on push to `master` |

Do **not** use root `docker-compose.yml` in production — it exposes Postgres and API ports.

---

## 1. Server prerequisites (Ubuntu)

SSH in as a sudo user:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl git ufw
```

### Docker Engine + Compose

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
# log out and back in
docker --version
docker compose version
```

### Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Do **not** open `5432`, `8000`, or `5173` publicly.

### App directory

```bash
sudo mkdir -p /opt/labcd
sudo chown "$USER:$USER" /opt/labcd
cd /opt/labcd
git clone <YOUR_GITHUB_REPO_URL> .
```

### Deploy user + SSH key (for CI/CD)

On the **server**:

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
sudo mkdir -p /home/deploy/.ssh
sudo chmod 700 /home/deploy/.ssh
```

On your **laptop**:

```bash
ssh-keygen -t ed25519 -f labcd_deploy -N ""
```

Install the **public** key on the server:

```bash
# as root / sudo — paste contents of labcd_deploy.pub
echo "ssh-ed25519 AAAA... comment" | sudo tee -a /home/deploy/.ssh/authorized_keys
sudo chmod 600 /home/deploy/.ssh/authorized_keys
sudo chown -R deploy:deploy /home/deploy/.ssh
sudo chown -R deploy:deploy /opt/labcd
```

Test:

```bash
ssh -i labcd_deploy deploy@YOUR_SERVER_IP
```

Optional SSH hardening (`/etc/ssh/sshd_config`):

```
PasswordAuthentication no
PermitRootLogin no
```

Then: `sudo systemctl reload ssh`.

---

## 2. DNS

Point the domain at the server (A records):

| Type | Name | Value |
|------|------|--------|
| A | `@` | server public IP |
| A | `www` | server public IP |

Verify:

```bash
dig +short labcd.ai
dig +short www.labcd.ai
```

Both must resolve to the server. Ports **80** and **443** must reach the host (cloud security group + UFW).

---

## 3. First deploy (manual)

On the server as `deploy`:

```bash
cd /opt/labcd
git checkout master
git pull

cp deploy/env.production.example .env
nano .env
```

Fill at least:

- `JWT_SECRET` — `openssl rand -hex 32`
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- `POSTGRES_PASSWORD` — `openssl rand -hex 24`
- At least one LLM API key you use
- Keep `CORS_ORIGINS=https://labcd.ai,https://www.labcd.ai`
- SMTP settings for auth emails (see [§4 Email (SMTP)](#4-email-smtp-for-production))
- `APP_PUBLIC_URL=https://labcd.ai` (used in verify / reset links)

Then:

```bash
mkdir -p results uploads
chmod +x deploy/deploy.sh

docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

Wait 1–2 minutes for images and Let's Encrypt.

### Verify

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f caddy

curl -I https://labcd.ai
curl https://labcd.ai/api/v1/health
```

In the browser:

1. Open https://labcd.ai — landing page loads.
2. Log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
3. Run a short design job and confirm streaming still works.

---

## 4. Email (SMTP) for production

LabCD does **not** run its own SMTP server. The API is an SMTP **client**: it connects to an external mail provider and sends verification and password-reset emails.

If `SMTP_HOST` is empty, emails are only logged to the API console (dev fallback). That is not suitable for production.

### Recommended approach

Use a transactional email provider. Do **not** install Postfix/Sendmail on the app server for outbound auth mail — deliverability and spam reputation are hard to manage yourself.

| Provider | Typical host | Port |
|----------|--------------|------|
| Resend | `smtp.resend.com` | 587 |
| SendGrid | `smtp.sendgrid.net` | 587 |
| Amazon SES | `email-smtp.<region>.amazonaws.com` | 587 |
| Mailgun | `smtp.mailgun.org` | 587 |
| Brevo | `smtp-relay.brevo.com` | 587 |
| Gmail (Workspace / app password) | `smtp.gmail.com` | 587 |

### Configure on the server

In `/opt/labcd/.env`:

```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=SG.xxxxxxxx
SMTP_TLS=true
EMAIL_FROM=noreply@yourdomain.com
APP_PUBLIC_URL=https://labcd.ai
```

Notes:

- **`SMTP_TLS=true`** — the API uses STARTTLS on port 587.
- **`EMAIL_FROM`** — must be a domain/address the provider allows you to send from. Verify DNS (SPF, DKIM, DMARC) for that domain.
- **`APP_PUBLIC_URL`** — used in email verify / password-reset links; must be the real public URL, not `localhost`.
- After changing env, recreate the API:

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --force-recreate api
```

### Example: SendGrid

1. Create a SendGrid account and verify your domain.
2. Create an API key with Mail Send permission.
3. Set:

```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=<your-sendgrid-api-key>
SMTP_TLS=true
EMAIL_FROM=noreply@yourdomain.com
```

### Example: Amazon SES

1. Verify the domain in SES; move out of sandbox if you need to mail arbitrary users.
2. Create SMTP credentials in SES.
3. Set host to your region endpoint (e.g. `email-smtp.eu-west-1.amazonaws.com`) plus the SES SMTP user/password.

### Optional local SMTP relay

You can run Postfix, Mailu, or similar as a relay to a provider, then point `SMTP_HOST` at that relay (`localhost` or another container). That is optional infrastructure; the app only needs a reachable SMTP host with auth.

### Sanity check

1. Register a user or trigger password reset.
2. Confirm the message arrives (and check spam).
3. If nothing is sent, check API logs — empty `SMTP_HOST` means console-only logging:

```bash
docker compose -f docker-compose.prod.yml logs -f api
```

---

## 5. GitHub Actions CI/CD

Repo → **Settings → Secrets and variables → Actions** → add:

| Secret | Value |
|--------|--------|
| `DEPLOY_HOST` | server IP or `labcd.ai` |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | private key file contents (`labcd_deploy`, including `BEGIN`/`END` lines) |

On every push to `master` (or manual **Run workflow**), Actions SSHs in and runs `deploy/deploy.sh`.

The server `.env` is **not** in git — edit secrets only on the server.

If your default branch is `master`, change the branch in:

- `.github/workflows/deploy.yml`
- `deploy/deploy.sh` (`DEPLOY_BRANCH` or default)

---

## 6. Day-2 operations

```bash
cd /opt/labcd

# status / logs
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f caddy

# redeploy manually
bash deploy/deploy.sh

# apply .env changes
docker compose -f docker-compose.prod.yml --env-file .env up -d --force-recreate api

# stop (keeps volumes)
docker compose -f docker-compose.prod.yml down
```

### Database backup (example cron)

```bash
mkdir -p /opt/labcd/backups
docker compose -f /opt/labcd/docker-compose.prod.yml exec -T db \
  pg_dump -U labcd labcd | gzip > "/opt/labcd/backups/labcd-$(date +%F).sql.gz"
```

Also back up `uploads/` and `results/`.

---

## 7. Troubleshooting

| Symptom | Fix |
|---------|-----|
| HTTPS / cert fails | Open ports 80+443; confirm DNS with `dig`; check `caddy` logs |
| `Bind for 0.0.0.0:80 failed: port is already allocated` | Something else owns host :80. On the server: `docker ps --filter publish=80` and `sudo ss -tlnp \| grep ':80 '`. Stop the other container, or disable host nginx/apache (`sudo systemctl disable --now nginx`). Then re-run `bash deploy/deploy.sh`. |
| `502` Bad Gateway | `docker compose ... ps` and logs for `frontend` / `api` |
| CORS / login errors | Set `CORS_ORIGINS` to production HTTPS URLs; recreate `api` |
| Login hangs / times out under load | API keeps one worker (in-memory jobs). Raise `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` / `API_THREAD_LIMIT` in `.env` and recreate `api`. Frontend times out auth requests after 30s with Retry. |
| API 404 under `/api/` | Frontend nginx proxies `/api/` → `api:8000`; ensure both containers are up |
| SSE job dies early | Frontend nginx already uses long `proxy_read_timeout`; raise timeout on any extra proxy |
| Actions SSH fails | Test key locally; confirm `deploy` is in `docker` group and owns `/opt/labcd` |
| Admin login fails | Recheck `.env` admin vars; recreate `api` so env reloads. Note: changing `ADMIN_PASSWORD` does not update an existing admin hash — reset via DB or admin UI. |
| Auth emails never arrive | Set `SMTP_HOST` / credentials in `.env`; recreate `api`. Empty `SMTP_HOST` logs email to the console only. Confirm `EMAIL_FROM` is verified at the provider and `APP_PUBLIC_URL` is the public HTTPS URL. |

---

## Quick happy path

1. Install Docker + UFW on Ubuntu.  
2. Clone repo to `/opt/labcd`.  
3. Copy `deploy/env.production.example` → `.env` and fill secrets (including SMTP + `APP_PUBLIC_URL`).  
4. `docker compose -f docker-compose.prod.yml --env-file .env up -d --build`.  
5. Confirm https://labcd.ai and `/api/v1/health`.  
6. Trigger a register / password-reset and confirm the email arrives.  
7. Add GitHub deploy secrets; push to `master` for auto-deploy.
