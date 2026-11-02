# Grateful Solutions — Logistics Management

Production version of the "GS Dashboard" prototype: React + TypeScript web app, Node.js + TypeScript API, PostgreSQL.
Every number, table row and chart is read from PostgreSQL through the API — nothing is hard-coded in the browser.

```
apps/web         React 18 · Vite · React Router · TanStack Query · React Hook Form + Zod
apps/api         Node 20 · Express 5 · Drizzle ORM · Zod · JWT (access + httpOnly refresh cookie) · pino
packages/shared  Zod schemas, enums, permissions and the accounting / cut-stock formulas used by both
```

**Status: complete (Phases 1–6).** Every page is built on the database, hardened and documented for production. **To go live, follow [DEPLOY.md](DEPLOY.md).**

---

## Requirements

| Tool           | Version                             | Windows install                                                  |
| -------------- | ----------------------------------- | ---------------------------------------------------------------- |
| Node.js        | 20.12 or newer (22 LTS recommended) | https://nodejs.org                                               |
| pnpm           | 9                                   | `corepack enable` then `corepack prepare pnpm@9.12.0 --activate` |
| Docker Desktop | any recent                          | https://www.docker.com/products/docker-desktop                   |

All commands below work the same in **PowerShell**, Command Prompt, macOS and Linux unless marked.

---

## Option A — run everything in Docker (closest to production)

```powershell
Copy-Item .env.example .env          # macOS/Linux: cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD, JWT_ACCESS_SECRET and SEED_DEFAULT_PASSWORD
docker compose up -d --build         # postgres + api + web; the API applies migrations on start
pnpm docker:seed                     # load the demo dataset (or: docker compose exec api node dist/db/seed/index.js --force)
```

Open **http://localhost:8080** and sign in (see [Demo accounts](#demo-accounts)).
API docs: http://localhost:8080/api/docs

Useful:

```powershell
docker compose logs -f api           # API logs
docker compose down                  # stop (data is kept in the pgdata volume)
docker compose down -v               # stop AND delete the database + uploaded files
```

## Option B — develop locally (hot reload)

```powershell
Copy-Item .env.example .env          # then edit the secrets as above
pnpm install
docker compose up -d postgres        # only the database runs in Docker
pnpm db:migrate
pnpm db:seed
pnpm dev                             # API on :4000, web on :5173
```

Open **http://localhost:5173**. Vite forwards `/api` to the API, so the browser sees one origin (no CORS, cookies just work).

> Port 5432 already used by a local PostgreSQL? Set `POSTGRES_PORT=5433` in `.env` and change the port in `DATABASE_URL` / `DATABASE_URL_TEST` to match.

### Everyday commands

| Command                                        | What it does                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| `pnpm dev`                                     | API (watch mode) + web (Vite) together                               |
| `pnpm db:migrate`                              | Apply pending migrations                                             |
| `pnpm db:seed`                                 | **Wipe** and reload the demo dataset                                 |
| `pnpm db:reset`                                | Drop everything, migrate, seed                                       |
| `pnpm db:generate`                             | After editing `apps/api/src/db/schema/*`, create a new SQL migration |
| `pnpm db:studio`                               | Browse the database in Drizzle Studio                                |
| `pnpm test`                                    | All unit + integration tests (needs the Docker postgres running)     |
| `pnpm typecheck` · `pnpm lint` · `pnpm format` | Quality checks                                                       |
| `pnpm build`                                   | Production builds of every package                                   |

---

## Demo accounts

`pnpm db:seed` creates one user per role. The password for all of them is the `SEED_DEFAULT_PASSWORD` value in your `.env`.

| Email                   | Role              | Can                                                                                |
| ----------------------- | ----------------- | ---------------------------------------------------------------------------------- |
| admin@gs.local          | Admin             | everything, incl. staff, roles and settings                                        |
| aden.whitfield@gs.local | Manager           | everything except staff/role and settings changes; can approve cut-stock overrides |
| marcus.ellery@gs.local  | Accountant        | accounting and quotations; read operations                                         |
| sokha.chan@gs.local     | Operator          | shipments, clients, cut stock, documents, follow-ups; no accounting                |
| dara.kim@gs.local       | Viewer            | read-only                                                                          |
| ceo@gs.local            | CEO               | sees everything; approves low-margin jobs (finance:approve); changes nothing else  |
| ops.manager@gs.local    | Operation Manager | Operations' and customs work, approves document packages and closes jobs           |
| broker@gs.local         | Customs Broker    | permits, declarations, clearance and CO; Credit Noted; broker details              |

The full permission matrix is in `packages/shared/src/permissions.ts`.

## What the seed loads

Deterministic (same result every run), dated around the real current date so statuses look live:

- 4 clients (JR Apparel Corp, Jin Yuan Xi Ltd, Sportline Garments, VFL APPAREL) with codes JR / JYX / SAK / VFL and commission settings (JR $0, others $50)
- 10 customs ports from the accounting engine's directory (SHV11, PNH01 KTI, PNH21 O'Lair…), 7 forwarders (Maersk, FWF, Hippo, …), 25 countries
- **262 shipments** across 2026 (peak in June), 195 containers, 386 cargo invoices with 1,392 lines
- 225 customs declarations, each with a monthly-ledger row computed by the shared accounting formulas (≈ 5 % are loss-making)
- **195 cut-stock items read directly from `JR CDC MASTER LIST.xlsx`** (`apps/api/src/db/seed/data/`), including the 10 items that are already over-imported in the spreadsheet; a few 2026 declarations draw them down further
- 8 quotation templates extracted from `quotation-system.html`, 10 follow-ups, monthly USD→KHR rates

---

## Job workflow (shipment stages, roles, approvals)

Every shipment moves through a job workflow (`packages/shared/src/workflow.ts`). Each stage has an
owner, the documents that must be attached and the data that must be recorded before it can be
completed. The shipment opens on its **Workflow** tab, which shows the stage track, what is still
missing (with Upload / Enter buttons that jump to the right field), the cross-checks, permits,
vendor invoices, generated documents and the history.

| Import stages                   | Owner                                        | Needs                                                     |
| ------------------------------- | -------------------------------------------- | --------------------------------------------------------- |
| Pre-alert                       | Operations                                   | Invoice, packing list, B/L uploaded; cargo lines; HBL no. |
| Document check → Permit package | Operations                                   | No blocking cross-check errors                            |
| Manager review                  | Operation Manager                            | Approval                                                  |
| Customer signing                | Operations                                   | Signed authorization letter                               |
| Customs permit                  | Customs Broker                               | Permit recorded and valid; permit PDF                     |
| Arrival notice                  | Operations                                   | Arrival notice; ETA                                       |
| Local charges                   | Accountant                                   | Vendor invoices entered and paid                          |
| Delivery order                  | Operations                                   | DO uploaded; DO date                                      |
| Customs clearance               | Customs Broker                               | Declaration number; valid permit                          |
| Delivery                        | Operations                                   | Arrival at factory                                        |
| Billing                         | Accountant                                   | Ledger entry                                              |
| Close job                       | Operation Manager (+ CEO when margin < 10 %) | Approval                                                  |

Exports: Booking received → Booked with forwarder → Final packing list → Warehouse documents →
Manager review → Export declaration → Delivered to CFS → Bill of lading → Certificate of origin →
Vendor costs → Billing → Close job.

- **Moving on** needs the stage owner's permission (`shipments:write`, `customs:write`,
  `accounting:write` or `workflow:approve`). With requirements unmet, someone with
  `workflow:approve` can move on with a written reason. Any stage can be **sent back** with a note.
  Every move is kept in `shipment_stage_history` and the audit log.
- **Cross-checks** (`apps/api/src/modules/workflow/service.ts`): booking vs final packing list
  (qty, weight, CBM), declared vs CFS-measured vs vendor-billed CBM / weight, ATD vs ETD on the
  INV/PL and CO, permit validity vs ETA, CDC master list and broker card expiry, the same file
  attached twice.
- **My Work** (`/my-work`) lists the jobs at stages your role owns, with alerts; queue roles land
  there after sign-in. The **bell** shows the same alerts plus overdue follow-ups.
- **Master data with expiry**: Settings → Customs broker (agent card), Client → Customs papers
  (signatory, authorization letters, broker ID, patent, CDC validity). The import letters read
  them instead of hard-coded values.
- **Generated export documents**: booking form, warehouse checklist and cargo DO (`.xlsx`).

API: `GET /workflow/shipments/:id`, `POST …/advance`, `POST …/return`, `PUT …/figures`,
`…/permits`, `…/vendor-invoices`, `GET …/docs/:kind.xlsx`, `GET /workflow/queue`,
`GET /workflow/alerts`, `/workflow/broker-agents`, `/workflow/clients/:id/signatories|authorizations`.

## How it is built

### Data model

37 tables (`apps/api/src/db/schema/`), migrations in `apps/api/drizzle/`. Highlights:

- **Shipments** split freight into `transport_mode` (SEA/AIR/ROAD/RAIL) and `load_type` (FCL = CY/CY, LCL, NONE). The Key Accounts CY/CY · LCL · AIR columns are derived from these.
- **Customs declarations** are their own table (a shipment can have several). Each declaration has at most one **accounting record** (the Chea payment / monthly ledger row) and any number of **CDC lines**.
- **Cut-stock balance** is never stored: the `cut_stock_balances` view computes imported qty, balance, balance % and OK/CHECK (CHECK below 50 %) exactly like the spreadsheet.
- **Over-import rule** is enforced twice: by the API (Phase 3) and by a database trigger that locks the item row and rejects any CDC line that would push the balance below zero unless it carries an override reason + approving user.
- Money is `NUMERIC(14,2)`, unit prices `NUMERIC(14,4)`, quantities/weights/CBM `NUMERIC(14,3)`, KHR `NUMERIC(16,0)`. Calendar dates are `date`; event times are `timestamptz`.
- `fob_amount` on cargo invoice lines is a PostgreSQL generated column (`round(pcs × fob_unit_price, 2)`).
- `audit_log` records who changed what (before/after JSON), logins, failed logins and token reuse.

### Accounting formulas (`packages/shared/src/accounting.ts`)

Ported from `accounting-engine.html` and unit-tested against the two real declarations in the prototype:

```
VAT          = 10 % × INV revenue                      (pass-through, NOT in profit)
Net profit   = (INV revenue + DIS + DN total) − (clear fee + THC + CM + other pay)
CM           = client's commission setting             (prototype rule: JR $0, others $50)
Invoice date = next business day after the declaration date (Sat/Sun → Mon)
KHR          = USD × exchange rate stored on the document, rounded to whole riel
```

All arithmetic is done in integer cents / BigInt fixed point — no floating-point drift in stored totals.

### Auth & security

- Login returns a 15-minute access token (kept in memory in the browser, never in localStorage) and sets a 14-day refresh token as an **httpOnly, SameSite=Strict cookie scoped to `/api/v1/auth`**.
- Refresh tokens are stored hashed and rotate on every use. Re-using an old one revokes the whole session family (theft detection).
- Role permissions are checked by API middleware on every protected route; the web app uses the same list to hide what a role can't use.
- helmet headers, rate limits (600 req/min per IP; 10 failed logins per 15 min per IP+email), request IDs, redacted pino logs, strict CSP from nginx.

### Look and feel

The prototype's stylesheet is ported unchanged (`apps/web/src/styles/prototype.css`), with tokens in `tokens.css` and the bundled Helvetica faces in `fonts.css`. Components reuse the prototype's class names (`.sidebar`, `.menu-item`, `.card`, `.status-tag`, …), so screens match pixel-for-pixel. New, page-specific styles go in CSS Modules.

Changes from the prototype shell: Cut Stock and Quotations were added to the sidebar; "Ask AI" and "Help" were removed from the top bar (no feature behind them); the bell shows **overdue follow-ups** from the database; the clock always shows Phnom Penh time.

---

## Configuration (`.env`)

| Variable                                  | Purpose                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `POSTGRES_*`                              | Database credentials used by Docker Compose                                                                        |
| `DATABASE_URL` / `DATABASE_URL_TEST`      | Connection strings for local dev and the integration tests                                                         |
| `JWT_ACCESS_SECRET`                       | ≥ 32 random characters. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `COOKIE_SECURE`                           | `true` once the site is served over HTTPS                                                                          |
| `TRUST_PROXY`                             | Number of reverse proxies in front of the API (Compose sets 1 for nginx)                                           |
| `PUBLIC_URL`, `WEB_PORT`, `POSTGRES_PORT` | Docker host ports / address                                                                                        |
| `SEED_DEFAULT_PASSWORD`                   | Password given to the demo users                                                                                   |

`.env` is git-ignored. Never commit real secrets.

## Deploying on a server

1. Install Docker on the server (VPS or office machine), copy the repo, create `.env` with strong secrets.
2. `docker compose up -d --build`
3. Put HTTPS in front (Caddy, Traefik or nginx with Let's Encrypt) forwarding to port 8080, then set `COOKIE_SECURE=true` and `PUBLIC_URL=https://your-domain` and run `docker compose up -d` again.
4. **Do not run the seed in production** — it wipes the database. Create real users via the Staff page (Phase 5); until then, run the seed once and change the passwords.
5. Back up the `pgdata` volume (e.g. a nightly `docker compose exec postgres pg_dump …`) and the `uploads` volume.

---

## Roadmap

| Phase | Scope                                                                                                 | Status |
| ----- | ----------------------------------------------------------------------------------------------------- | ------ |
| 1     | Analysis, ERD, plan                                                                                   | ✅     |
| 2     | Monorepo, Docker, schema + migrations, seed, auth, RBAC, layout, routing                              | ✅     |
| 3     | Clients, Shipping Plans (+ create wizard, Excel import), Cut Stock                                    | next   |
| 4     | Overview and Analytics with all charts on live API data                                               |        |
| 5     | Accounting (all sub-pages, PDF/Excel), Quotations, Documents, Follow-ups, Staff, Settings, Operations |        |
| 6     | Hardening: more tests, RBAC review, query/index review, deploy guide                                  |        |

## Going live (Phase 6)

See **[DEPLOY.md](DEPLOY.md)** for step-by-step instructions on a Windows office server or a Linux VPS. Summary:

| Command                                          | What it does                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `pnpm build`                                     | Build the API and the website                                                                    |
| `pnpm db:migrate:prod`                           | Apply migrations using `.env`                                                                    |
| `pnpm db:init:prod`                              | Empty database → reference data + first Admin (no demo data; safe to re-run)                     |
| `pnpm start` or `pm2 start ecosystem.config.cjs` | Run in production: one process serves the API **and** the website (`WEB_DIST_DIR=apps/web/dist`) |
| `pnpm backup`                                    | Database dump + new uploaded files into `BACKUP_DIR`, keeps `BACKUP_KEEP_DAYS` days              |

Hardening in this phase:

- **Production safety check** — the server refuses to start with the example JWT secret or database password.
- **Route-protection audit test** — reads every router in the code and proves each endpoint rejects anonymous requests (401) and that the read-only Viewer role is refused on every write (403). A new unprotected endpoint fails the build.
- **Upload content check** — a file must really be what its extension says (PDF, PNG/JPG/WEBP, Office, CSV/text); renamed executables are refused.
- **Security headers** — strict Content-Security-Policy (`script-src 'self'`, no framing); HTTPS upgrade and HSTS only when `COOKIE_SECURE=true`, so plain-HTTP office networks work.
- **Performance** — tested at ~21× the demo volume (5,500 shipments, 29,000 invoice lines): Shipping Plans 374 ms → 17 ms after paging ids first; dashboards and ledger 2–5 ms.
- **Paths** — relative `UPLOAD_DIR` / `WEB_DIST_DIR` resolve from the project folder whether started by `pnpm dev` or `pnpm start`.
- **Backups** verified by restoring a dump into a fresh database.

## Client Billing — the month-end pack per client

Replaces the monthly Excel workbook per client (e.g. `09-JR-INV`: a tax invoice + disbursement and a debit note per shipment, the two account statements `ST-INV` / `STA-DN`, the official receipts `OR-INV` and the checking list). **Accounting → Client Billing** (`/accounting/billing`) lists every client with billing in a month and where it stands (Not invoiced → Drafts to issue → Awaiting payment → Partly paid → Paid). Opening a client shows its month in three steps:

1. **Shipment documents** — one row per Monthly Ledger entry of the month (by invoice date) with its tax invoice, disbursement and debit note. **Create missing drafts** fills every missing one from the shipment and copies the line items of the client's last issued document of the same import/export (same container size first), or puts one line with the ledger amount. **+ Other debit note** is for charges of no shipment (monthly MIH / payroll fee). **Issue drafts** issues the month's drafts (a $0.00 draft is skipped).
2. **Account statements** — "Invoices & disbursements" (tax invoice total with VAT + disbursement per shipment) and "Debit notes", read from the issued documents. A number typed in the ledger for a document made outside the system (the Excel days) still counts, marked "ledger".
3. **Payments** — **Record payment** issues an official receipt (`OR26-001`…) against one statement, never more than its balance; the amount in words is generated. Void keeps the number and puts the amount due again. **Official Receipt** (`/accounting/receipts`) is the register.

**Print month pack** (`/print/billing/:clientId?month=YYYY-MM`) prints, in order, each shipment's tax invoice, disbursement and debit note, the statements, the receipts (two A5 receipts per A4 sheet) and the handover checklist; each part can be switched off. The document editor gained **Copy lines from…** (a recent issued document of the client) and returns to Client Billing when opened from there.

Automatic tax invoice / disbursement / debit note numbers now continue after the highest number already used, including numbers typed into the ledger, so they never repeat an Excel-era number. Statements are not stored (always computed from the documents); receipts are, in `official_receipts` (migration `0010_official_receipts`).

```
GET  /accounting/billing?month                        every client's month: totals and stage
GET  /accounting/billing/:clientId?month              shipments + documents, statements, receipts
GET  /accounting/billing/:clientId/pack?month         the same plus every issued document in full (print)
POST /accounting/billing/:clientId/drafts             { month, types[], lines: previous|ledger }
POST /accounting/billing/:clientId/issue              { month }
GET  /accounting/receipts?month&clientId&status&q     POST /accounting/receipts
GET  /accounting/receipts/:receiptId                  POST /accounting/receipts/:receiptId/void { reason }
GET  /accounting/docs/:type/prefill?clientId&date     a document of no shipment, from the client
```

## Phase 5b features

**Staff & Roles** (`/staff`) — add staff with a temporary password, edit role/department/status, reset passwords, remove; **Roles & permissions** matrix (Admin always has everything). Safeguards: you can't change your own role or deactivate yourself, the last active Admin can't be removed, and deactivating or resetting a password signs that person out everywhere. Everyone can **change their own password** by clicking their name in the sidebar (min. 10 characters with a number).

**Settings** (`/settings`, Admin) — company details printed on documents · USD→KHR rates by date (+ base rate) · ports (code, customs no., chart label) · forwarders · consignees (link to a client) · dropdown lists (units, materials, CO forms, brokers, departments, charges). These replace the prototype's localStorage "Add New" lists, so additions are shared by everyone. Inactive entries leave the dropdowns but stay on old records.

**Follow-ups** (`/followup`) — FLW-#### references, client/assignee/due (Phnom Penh time)/priority/status, overdue rows highlighted, one-click **Mark done**; the sidebar badge and the bell (overdue) follow the data.

**Documents** (`/documents`) — upload PDF, images, Excel, CSV, Word or text up to 20 MB, with title, category and status, linked to a client and/or shipment; download; delete (soft — the file is kept for the audit trail). Files are stored under `UPLOAD_DIR` (`apps/api/storage` by default) in `year/month/<random-id>` names; downloads are always sent as attachments.

**Operations** (`/operations`) — the customs declaration register: declaration, date, port, shipment, HBL, client, clearance, ledger status (filter "Not yet in ledger"), CDC lines and document count. Click a row to see and upload that shipment's BL / compliance documents.

**Quotations** (`/quotations`) — the 8 service templates from `quotation-system.html` with their standard rates and notes; cells accept numbers or text ("As per receipt"). Q26-### numbering, Draft → Sent → Accepted, **Revise** creates v2 and marks v1 Superseded, list shows the latest versions (tick "Show old versions" for all), A4 print/PDF.

### API added in Phase 5b

```
/staff  GET POST · PATCH|DELETE /:id · POST /:id/reset-password · GET /roles · PUT /roles/:code
/auth/change-password  POST
/settings  GET · PUT /company · PUT /base-exchange-rate · POST|DELETE /exchange-rates · POST|PATCH /ports /forwarders /consignees /lookups · DELETE /lookups/:id
/follow-ups  GET (status|ACTIVE, overdue, priority, assigneeId, clientId, q) · POST · PATCH|DELETE /:id
/documents  GET · POST (multipart "file" + metadata) · GET /:id/download · PATCH|DELETE /:id
/operations/declarations  GET (month, clientId, direction, ledger=with|without, q)
/quotations  GET · GET /templates · POST · GET|PUT|DELETE /:id · POST /:id/status · POST /:id/revise
```

## Phase 5a features — accounting

**Monthly Ledger** (`/accounting`) — one row per customs declaration, filtered by month, client, paid/unpaid or number; totals row; Excel export. New entries are picked from declarations that have no ledger row yet. The server fills in what the engine did by hand:

- **Invoice date** = next business day after the declaration (Fri/Sat/Sun → Mon)
- **Exchange rate** = the USD→KHR rate in force on that date (`exchange_rates`, else the workspace base rate)
- **CM** = the client's commission setting (JR $0, others $50) unless typed
- **VAT 10%** of INV revenue, and **net profit = (INV + DIS + DN) − (clear fee + THC + CM + other pay)**; VAT is never profit

**Documents** (`/accounting/tax-invoices`, `disbursements`, `debit-notes`, `credit-notes`, `record-summaries`) — open a ledger row and click **+ Tax Invoice** (or any type) to get a draft filled from the shipment: customer (English + Khmer), VATTIN, shipper, consignee, HBL, PKGS, weights, CBM, containers, POL/POD and a first line priced from the ledger. Drafts can be edited; then:

- **Issue** → final. A tax invoice / disbursement / debit note writes its number and total into the ledger row and net profit is recalculated (dashboards follow).
- **Void** (with a reason) → kept for the record, taken back out of the ledger. Numbers are never reused.
- Numbering: tax invoices **GS26-###**, disbursements **DIS###**, debit notes **{CLIENT}{YYMM}###** (e.g. JR2610001), credit notes **CN26-###**; a typed number is accepted if unused.
- **Print / PDF** opens an A4 page (bilingual Khmer/English tax invoice with KHR totals at the document's rate; Khmer font bundled) → use the browser's _Save as PDF_. **Excel** exports the document.

> The prototype engine calculated with `parseFloat(x) | 0`, which silently dropped decimals (US$18.75 became 18). All totals here are exact to the cent.

### API added in Phase 5a

```
GET    /accounting/ledger?month&clientId&cheaStatus&q   GET /accounting/ledger/export.xlsx
POST   /accounting/ledger      GET|PATCH|DELETE /accounting/ledger/:id     GET /accounting/declarations?q
GET    /accounting/docs/:type?month&clientId&status&q   GET /accounting/docs/:type/prefill?recordId
POST   /accounting/docs/:type  GET|PUT|DELETE /accounting/docs/:type/:id
POST   /accounting/docs/:type/:id/issue | /void        GET /accounting/docs/:type/:id/export.xlsx
GET    /meta/company           (printed company details)
       :type = tax-invoices | disbursements | debit-notes | credit-notes | record-summaries
```

Migration `0002_billing_shipment_fields` adds the shipment fields (POL/POD, container, HBL, weights…) printed on disbursements and debit notes.

## Phase 4 features — dashboards

Every number and chart is aggregated **in PostgreSQL** (GROUP BY, `date_trunc`, `FILTER`, `generate_series` for zero-filled months) and fetched with TanStack Query. Creating, editing or deleting a shipment invalidates the dashboard queries, so charts update straight away; the Overview also refreshes every minute.

**Overview** (`/overview`) — KPI cards for the current month vs last month (total, import, export, customs cleared + still pending) · **Shipment Summary** area chart for the year (hover tooltip, click or pick a month to pin it) · **Total Net Profit** (YTD from the monthly ledger, this month vs last, sparkline, donut + per-client bars) — shown only to roles with accounting access; others see **Shipments by Client** · **Imported/Exported By Countries** · **Key Logistics Accounts** (All / Import / Export → Total, CY/CY, LCL, AIR) · **Port of Discharge** (Import/Export, by percentage or by shipment; top 3 + OTHERS) · **Forwarder Statistics** radar (Factory / Import / Export / On-time %) · **Live Consignments Tracking** (exceptions first, then nearest ETA).

**Analytics** (`/analytics`) — filters for period (this month, last 3 months, year to date, full year, last year, custom dates), client, import/export and transport mode (Sea CY/CY, Sea LCL, Air, Road), kept in the URL so a view can be shared. Sections: KPIs vs the previous period of the same length · Monthly volume Import vs Export (grouped bars) · Import/Export share donut with mode breakdown · Customs clearance status · Shipments by origin/destination country · Forwarder ranking (shipments, on-time %, average delay) · Port of discharge Import vs Export · Key accounts full breakdown with totals.

Definitions: a shipment belongs to the month of its **ETA**; **on-time** = actual arrival (ATA) on or before ETA; **factory** = imports with an Arrive FTY date; imports are counted by **origin** country, exports by **destination**; profit uses the ledger's **invoice date**.

### API added in Phase 4

```
GET /analytics/kpis | monthly-volume | transport-share | clearance-status | forwarders | ports | accounts
GET /analytics/by-country?flow=import|export
GET /analytics/profit?year=           (accounting:read)
    common filters: from, to, clientId (repeatable), direction, transportMode, loadType
GET /overview/summary                 this month's KPIs, the year's monthly volume, profit (if allowed)
GET /overview/live-consignments
```

## Phase 3 features

**Clients** (`/clients`, `/clients/:id`) — searchable list with active runs, shipment counts and (for roles with accounting access) net profit this year; add/edit in a form; detail page with recent shipments, consignees and a link to the client's CDC master list. Clients with shipments can't be deleted — set them to **Inactive** (no new shipments allowed).

**Shipping Plans** (`/plans`) — the prototype's table and Filter menu (clients, import/export, status, **Expand All** columns, **Freeze Columns**), search by invoice / HBL / container / declaration number (also from the top-bar search), sorting, pagination, and **Export Excel** of the filtered list.

**Create / edit shipment** (`/plans/new`, `/plans/:id`) — the prototype's IMPORT (4 steps) and EXPORT (3 steps) flows:

- Cargo, Pricing & FOB: invoices with expandable line items, live totals, **⇪ Upload Excel Template** (the `Export Template.xlsx` layout; warns about invoice numbers already used).
- Containers (CY/CY only), consignee / forwarder **+ Add new**, THC / HBL, vessel and CO details.
- Customs declarations; on imports each declaration has **CDC lines** picked from the client's master list, showing the balance after saving.
- Saving re-validates everything on the server. Errors jump to the step that needs fixing.

**Cut Stock** (`/cutstock`) — each client's CDC master list with live imported qty, balance, balance % and OK/CHECK, filters (category, condition, over-imported), item detail with every declaration that drew on it, add/edit items, **Import Excel** (preview first, matched on the Declare column) and **Export Excel** in the original layout.

### Business rules enforced by the API

- **Cut-stock balance can't go below zero.** A CDC line that would is refused (422, listing item, balance and requested qty) unless it has a written reason **and** the user is a Manager/Admin (`cutstock:override`); the approver is recorded. A database trigger enforces the same rule.
- CDC items must belong to the shipment's client; deleting a shipment releases its CDC quantities.
- Invoice numbers and declaration numbers are unique across shipments (clear 409 messages).
- Declarations with a ledger entry can't be removed, and their shipment can't be deleted or moved to another client.
- Inactive clients can't get new shipments. Air freight has no CY/CY or LCL; containers only on CY/CY; ETA ≥ ETD.
- Every create/update/delete is written to `audit_log` with before/after.

### API added in Phase 3

```
GET    /lookups                         dropdown data (clients, consignees, forwarders, ports, countries, lists)
POST   /lookups/consignees | /forwarders quick-add from the wizard
GET    /clients?q&status&page&sort       POST /clients      GET|PATCH|DELETE /clients/:id
GET    /shipments?clientId&direction&status&transportMode&loadType&from&to&q&page&pageSize&sort
GET    /shipments/export.xlsx           (same filters)
POST   /shipments/parse-cargo-excel     multipart "file" → invoices for the wizard (nothing saved)
POST   /shipments                       GET|PUT|DELETE /shipments/:id
GET    /cut-stock?clientId&q&category&condition   GET /cut-stock/options?clientId&q
GET    /cut-stock/export.xlsx?clientId  POST /cut-stock/import?clientId&dryRun&updateOpening (multipart)
POST   /cut-stock                       GET|PATCH|DELETE /cut-stock/:id
```

## Verified in Phase 6

- API: 95 integration tests (adds the route-protection audit over every endpoint, upload content checks, security headers)
- `db:init` on an empty database: weak admin password refused → reference data + 1 Admin, 0 shipments/clients → re-run changes nothing
- Production run from the project root: refuses example secrets; serves `/`, deep links, print pages, cached assets and the API from one process; login and refresh work
- `pnpm backup` → restore into a new database: 262 shipments, 232 ledger rows, 195 cut-stock items intact; uploaded files mirrored, second run copies only new files

## Verified in Phase 5b

- API: 82 integration tests (adds staff create/sign-in/duplicates/weak passwords, manager vs admin, deactivate → signed out, lock-out guards, password reset, role matrix, change own password, settings + exchange rates + lists, follow-up references/overdue/done, document upload/type rejection/download headers/soft delete, quotation templates/versioning/permissions, declaration register)
- Live run: staff added → signs in → changes password · rate added · overdue follow-up raises the bell · BL uploaded from the register and downloaded intact · real "Import SIH" quotation (12 rows) sent → revised to v2

## Verified in Phase 5a

- API: 70 integration tests (adds the engine's I 122050 example → $202.80, Friday → Monday invoice date, rate and commission defaults, recalculation on edit, one entry per declaration, month totals and export, accounting RBAC, tax invoice prefill → GS26-001 with VAT/KHR → issue syncs ledger → locked → void reverses it → next number not reused, decimals kept, debit-note numbering per client/month, credit-note and record-summary prefill, duplicate numbers, cross-client links, document Excel)
- Live run on the seeded database through the dev proxy: new declaration → ledger row → tax invoice prefilled (Khmer name, 978 CTNS, container, POD) → issued → ledger + yearly profit updated

## Verified in Phase 4

- API: 60 integration tests (adds monthly zero-fill, previous-period KPIs, every filter, clearance stages, countries by flow, forwarder on-time/delay/factory, ports, account buckets, inverted range, profit RBAC and per-client/month totals, live consignments order, and create → edit → delete moving the charts)
- Web: 33 tests (adds dashboard helpers, Port card top-3 + OTHERS, KPI row, lazy-loaded routes) · Shared: 21
- Pages are code-split: the main bundle is ~380 KB; the chart library loads only on the dashboards

## Verified in Phase 3

- API: 44 integration tests (adds shipments CRUD, filters/search, duplicate invoice, ledger protection, soft delete, RBAC, over-import block, Manager override, cross-client items, re-check on edit, balance release on delete, the real Export Template and JR master list import → re-import → export, clients, lookups)
- Web: 26 tests · Shared: 21 tests · lint, typecheck and both production builds clean
- Live run on the seeded database through the dev proxy: create an import with a CDC line → balance 3 → 1 (CHECK), over-import refused, delete → balance back to 3

## Verified in Phase 2

- Shared formulas: 21 unit tests (incl. declarations I 122050 → $202.80 and I 95925 → $352.11)
- API: 20 integration tests against PostgreSQL (login, validation, refresh rotation + reuse detection, logout, RBAC per role, error format, OpenAPI)
- Web: 24 tests (token refresh logic, sidebar permissions, login form, Phnom Penh clock)
- Seed: cut-stock view matches every spreadsheet balance; over-import trigger rejects I-10
- Production builds run: migrations + server from the built bundle, nginx config serving the SPA and forwarding `/api` (deep links, CSP, caching, login + refresh through the proxy)
- The Docker images themselves could not be built in the development sandbox; their build steps were replayed outside Docker.
