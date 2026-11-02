# Deploying the Logistics Command Center

In production the system is **one Node.js program** (the API, which also serves the website) plus **PostgreSQL**. No Docker or nginx is needed.

Pick where it runs:

- **Option A — Windows office PC/server.** Staff use it on the office network, e.g. `http://192.168.1.20:4000`.
- **Option B — Linux VPS.** Staff use it from anywhere at `https://ops.your-domain.com`.

Both options share the same five steps: install, configure, build, first-time setup, then keep it running.

---

## Option A — Windows office PC/server

Use a PC that stays on during working hours (ideally all the time) and has a **fixed IP address** on the office network (set it in your router or in Windows network settings).

### A1. Install (once)

1. **Node.js 22 LTS** — https://nodejs.org (default options).
2. **PostgreSQL 18** — https://www.postgresql.org/download/windows/ (keep port 5432; write down the `postgres` password).
3. **Git** — https://git-scm.com/download/win.
4. In **PowerShell (as Administrator)**:
   ```powershell
   npm install -g pnpm@9.12.0 pm2 pm2-windows-startup
   ```

### A2. Get the code and create the database

```powershell
cd D:\
git clone https://github.com/thninvichea68/grateful_project.git gs-command-center
cd D:\gs-command-center
mkdir D:\gs-data\uploads, D:\gs-data\backups
```

Open **SQL Shell (psql)**, sign in as `postgres`, and run (use a strong password, letters/digits/-/_ only):

```sql
CREATE USER gs WITH PASSWORD 'Choose_A_Strong_Db_Password_2026';
CREATE DATABASE gs_command_center OWNER gs;
\q
```

### A3. Configure `.env`

```powershell
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # copy the output
notepad .env
```

Set these lines (everything else can stay as it is):

```ini
NODE_ENV=production
PORT=4000
DATABASE_URL=postgresql://gs:Choose_A_Strong_Db_Password_2026@localhost:5432/gs_command_center
JWT_ACCESS_SECRET=<paste the random value>
CORS_ORIGIN=http://192.168.1.20:4000
COOKIE_SECURE=false
WEB_DIST_DIR=apps/web/dist
UPLOAD_DIR=D:\gs-data\uploads
BACKUP_DIR=D:\gs-data\backups
PG_BIN=C:\Program Files\PostgreSQL\18\bin
```

`COOKIE_SECURE=false` is correct for plain `http://` on the office network. Set it to `true` only when you use HTTPS.

The program **refuses to start** if `JWT_ACCESS_SECRET` or the database password are still the examples.

### A4. Build and first-time setup

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm db:migrate:prod
pnpm db:init:prod
```

`db:init:prod` loads the reference data (roles, customs ports, forwarders, countries, dropdown lists, quotation templates, company details) and asks for the **first Admin** account. It never creates demo data, and running it again changes nothing.

**Do not run `pnpm db:seed` on the production database** — it deletes everything and loads demo data.

### A5. Keep it running (starts with Windows)

```powershell
pm2 start ecosystem.config.cjs
pm2 save
pm2-startup install
```

Allow staff PCs to connect (PowerShell as Administrator, once):

```powershell
New-NetFirewallRule -DisplayName "GS Command Center" -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow -Profile Private,Domain
```

Open **http://192.168.1.20:4000** from any office PC (use your server's IP) and sign in with the Admin account. Useful commands: `pm2 status`, `pm2 logs gs-command-center`, `pm2 restart gs-command-center`.

### A6. Daily backups (Task Scheduler)

1. Open **Task Scheduler** → _Create Basic Task_ → name "GS backup" → _Daily_ → 19:00.
2. Action _Start a program_:
   - Program: `C:\Program Files\nodejs\node.exe`
   - Arguments: `--env-file=.env scripts/backup.mjs`
   - Start in: `D:\gs-command-center`
3. In the task's properties tick **Run whether user is logged on or not**.

Run it once by hand (`pnpm backup`) and check `D:\gs-data\backups`. **Copy that folder off the machine** regularly (USB drive, Google Drive / OneDrive sync folder, or a NAS) — a backup on the same disk doesn't survive a disk failure.

---

## Option B — Linux VPS (Ubuntu 24.04)

A VPS with 2 GB RAM is enough (≈ US$6–12/month). Point a domain such as `ops.your-domain.com` at its IP (DNS A record).

### B1. Install (once, as root)

```bash
apt update && apt install -y postgresql git curl debian-keyring debian-archive-keyring apt-transport-https
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs
npm install -g pnpm@9.12.0 pm2
# Caddy: automatic HTTPS certificates
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
adduser --disabled-password --gecos "" gs
mkdir -p /var/lib/gs/uploads /var/lib/gs/backups && chown -R gs:gs /var/lib/gs
sudo -u postgres psql -c "CREATE USER gs WITH PASSWORD 'Choose_A_Strong_Db_Password_2026';" -c "CREATE DATABASE gs_command_center OWNER gs;"
```

### B2. Code, configuration, build, first-time setup (as `gs`)

```bash
sudo -iu gs
git clone https://github.com/thninvichea68/grateful_project.git gs-command-center && cd gs-command-center
cp .env.example .env && nano .env
```

Same settings as A3, with:

```ini
NODE_ENV=production
PORT=4000
DATABASE_URL=postgresql://gs:Choose_A_Strong_Db_Password_2026@localhost:5432/gs_command_center
JWT_ACCESS_SECRET=<node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))">
CORS_ORIGIN=https://ops.your-domain.com
COOKIE_SECURE=true
TRUST_PROXY=1
WEB_DIST_DIR=apps/web/dist
UPLOAD_DIR=/var/lib/gs/uploads
BACKUP_DIR=/var/lib/gs/backups
```

```bash
pnpm install --frozen-lockfile && pnpm build
pnpm db:migrate:prod && pnpm db:init:prod
pm2 start ecosystem.config.cjs && pm2 save
exit                                   # back to root
pm2 startup systemd -u gs --hp /home/gs   # then run the command it prints
```

### B3. HTTPS with Caddy (as root)

`/etc/caddy/Caddyfile`:

```
ops.your-domain.com {
    encode gzip
    reverse_proxy 127.0.0.1:4000
}
```

```bash
systemctl reload caddy
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```

Caddy obtains and renews the certificate automatically. Port 4000 stays closed to the internet.

### B4. Daily backups

```bash
sudo -iu gs crontab -e
# add:
0 19 * * * cd /home/gs/gs-command-center && /usr/bin/node --env-file=.env scripts/backup.mjs >> logs/backup.log 2>&1
```

Copy `/var/lib/gs/backups` off the server regularly (e.g. `rclone` to Google Drive, or your VPS provider's snapshot feature).

---

## Updating to a new version

```bash
git pull
pnpm install --frozen-lockfile
pnpm build
pnpm backup                 # always back up before migrating
pnpm db:migrate:prod
pm2 restart gs-command-center
```

## Restore from a backup

1. Stop the app: `pm2 stop gs-command-center`
2. Restore the database (PowerShell: use the full path to `pg_restore.exe` in PostgreSQL's `bin` folder):
   ```bash
   pg_restore --clean --if-exists --no-owner --no-privileges -h localhost -U gs -d gs_command_center backups/gs-db-YYYYMMDD-HHMM.dump
   ```
3. Copy the backup's `uploads` folder back into `UPLOAD_DIR`.
4. `pm2 start gs-command-center`

Test a restore into a spare database (`CREATE DATABASE gs_restore_test OWNER gs;`) once after going live, so you know it works before you need it.

## Moving from testing to real use

1. Run `db:init:prod` on an **empty** production database (never the demo one).
2. As Admin: **Settings** → check company details, add today's USD→KHR rate; **Staff Management** → add each person with a temporary password (they change it from their name in the sidebar).
3. **Clients** → add your clients with their codes (JR, JYX, SAK, VFL…) and commission.
4. **Cut Stock** → choose the client → **Import Excel** with each client's CDC master list (preview first).
5. Start entering shipments. Existing shipments can be entered through the wizard; the cargo section accepts the Export Template Excel file.

## Security checklist

- [ ] `JWT_ACCESS_SECRET` is a fresh random value (the app refuses example values).
- [ ] Database password is strong and not the example; PostgreSQL only listens on `localhost` (default).
- [ ] HTTPS in front when reachable from the internet, with `COOKIE_SECURE=true` and `TRUST_PROXY=1`.
- [ ] Only the app port (office) or 80/443 (VPS) are open in the firewall.
- [ ] Daily backups run, and a copy leaves the machine.
- [ ] Each person has their own account; remove accounts of people who leave (Staff Management → Remove signs them out immediately).
- [ ] `.env` is never committed or shared (it's in `.gitignore`).
