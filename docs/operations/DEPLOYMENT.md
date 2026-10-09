# Deployment — RestroX Phase 01–42 recovery

Deploy `runtime/app.js` together with `runtime/dist/` on Node.js 22+.

Required production configuration includes:
- `NODE_ENV=production`
- explicit `ALLOWED_ORIGINS`
- authoritative MySQL connectivity
- unique `JWT_SECRET` and `PLATFORM_JWT_SECRET` values of at least 32 random characters
- persistent uploads path
- secure cookie/proxy configuration appropriate to the verified HTTPS deployment

The application intentionally refuses production startup when required origin configuration or the authoritative MySQL database is unavailable. Do not disable this guard for production.

Database target: `restrox_prod`; application user: `restrox_app`; migration user: `restrox_migrator`; readonly user: `restrox_readonly`; backup user: `restrox_backup`.
