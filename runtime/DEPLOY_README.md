# MIH DineOS — cPanel deployment with no npm access

This package is designed for a cPanel account where `npm`, `npm install`,
`npm ci`, and `npm run build` cannot be executed on the server.

The package is built on a Linux GitHub Actions runner and already contains:

- `app.js`
- `dist/index.html`
- `dist/server.cjs`
- standalone `dist/server.cjs` with server runtime packages bundled inside
- `.env.example`
- `RELEASE_SHA.txt`
- `BUILD_INFO.txt`

Do **not** run npm on cPanel.

## 1. Upload and extract

Download the GitHub Actions artifact named:

`mih-dineos-cpanel-<commit-sha>`

Upload that ZIP with cPanel File Manager and extract its contents directly into
the Node application root.

After extraction, the application root must contain:

```text
app.js
dist/
package.json
.env.example
RELEASE_SHA.txt
BUILD_INFO.txt
```

Do not leave those files nested inside an extra `cpanel-package/` directory
unless that directory itself is configured as the cPanel application root.

## 2. Create the MySQL database

For a new installation, create a MySQL database and user and grant privileges.
For an existing deployment, preserve its database and credentials; take a verified
backup of MySQL and uploads before replacing release files. Do not reset production.

RMS applies its numbered migrations automatically during startup. Do not create
or edit migration-history rows manually.

Expected schema after first successful startup:

```text
70 migrations
latest: 070_print_job_retry_failover
```

## 3. Create persistent upload storage

Create a persistent uploads directory outside disposable release files, for
example:

```text
/home/<CPANEL_USER>/rms-data/uploads
```

Use that path as `UPLOADS_DIR`.

## 4. Configure the Node application

Use cPanel Setup Node.js App / Application Manager:

```text
Node.js version:   22+
Application mode: Production
Application root:  directory containing app.js
Startup file:      app.js
Application URL:   your HTTPS RMS domain/subdomain
```

Run only one RMS Node process for the first rollout.

## 5. Configure production environment

Configure these through cPanel environment variables or a protected `.env`
file in the application root:

```dotenv
NODE_ENV=production

DATABASE_HOST=127.0.0.1
DATABASE_PORT=3306
DATABASE_NAME=<cpanel_database_name>
DATABASE_USER=<cpanel_database_user>
DATABASE_PASSWORD=<strong_database_password>

UPLOADS_DIR=/home/<CPANEL_USER>/rms-data/uploads

JWT_SECRET=<strong-random-secret-at-least-32-characters>
JWT_EXPIRES_IN=24h

PLATFORM_JWT_SECRET=<different-strong-random-secret-at-least-32-characters>
PLATFORM_JWT_EXPIRES_IN=8h

ALLOWED_ORIGINS=https://<RMS_DOMAIN>
COOKIE_SECURE=true
TRUST_PROXY=true
LEGACY_STATE_ENABLED=false
```

`PLATFORM_JWT_SECRET` must be different from `JWT_SECRET`.

Only enable `TRUST_PROXY=true` when the cPanel application is behind the
verified hosting reverse proxy.

Optional password-recovery email variables:

```dotenv
SMTP_HOST=<mail-host>
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=<mailbox>
SMTP_PASSWORD=<mailbox-password>
EMAIL_FROM=MIH DineOS <no-reply@example.com>
SMTP_TLS_REJECT_UNAUTHORIZED=true
```

## 6. Start / restart

Use cPanel's Restart / Redeploy control. No npm command is required.

At startup RMS will:

1. validate production configuration;
2. connect to MySQL;
3. acquire the migration lock;
4. apply pending migrations;
5. initialize the optional first Platform Admin bootstrap when configured;
6. start Express and Socket.IO;
7. serve the already-built React frontend from `dist/`.

## 7. Verify

Open:

```text
https://<RMS_DOMAIN>/api/health
https://<RMS_DOMAIN>/api/ready
```

`/api/ready` must confirm the database is connected, migrations are current,
and there are zero pending migrations.

Then manually verify:

- restaurant login;
- Platform login;
- Dine-In order -> KDS -> Ready -> Serve -> Bill -> Payment;
- Takeaway;
- realtime updates from two clients;
- uploaded menu images survive an application restart.

## Updating later

Build/download a new GitHub Actions cPanel artifact for the new `main` commit,
back up MySQL/uploads when appropriate, replace the application files while
preserving the protected production environment and persistent uploads, then
restart and recheck `/api/health` and `/api/ready`.

The artifact intentionally contains **no `node_modules` path**. CloudLinux
NodeJS Selector owns that path and creates its virtual-environment symlink.
Do not upload or create a real `node_modules` directory in the application root.

## Printer discovery release

Software verification was reported passed on Windows; MySQL verification passed
10 files / 47 tests on 2026-09-28. Physical printer output remains unverified.
Use one Node process; the current agent gateway is process-local. Confirm the host
supports persistent Socket.IO connections (WebSocket or polling) over HTTPS.
Run the updated printer connector on the restaurant computer, not on cPanel.
Preserve its private environment and pairing credentials when updating bundles.
After deployment verify discovery, test ticket, KOT, receipt copies and recovery.
Keep the previous application package and database backup for rollback. Rolling
back application files does not undo migrations; assess database compatibility
before rollback and never delete migration-history rows.

## Build locally from the complete checkout

Run `node scripts/package-cpanel.mjs` after pulling the verified branch and `npm ci`.
It builds and checks public assets, then writes separate cpanel/ and
printer-connector/ folders under release-packages/<commit-sha>/ with checksums.
It refuses tracked changes or missing assets. No production secrets are copied.
Upload only the CONTENTS of cpanel/ to the Node app root; preserve production .env,
uploads and host-managed node_modules symlink. Startup file app.js, Node 22+.

