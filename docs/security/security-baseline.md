# Security baseline

Default deny. Tenant = organization, branch allowlist, authenticated staff context. Authorization is server-side. Non-owner permission precedence: DENIED override > GRANTED override > role permission > deny. OWNER and `admin:all` are superuser authorities. Unknown endpoints deny. Platform-admin and staff auth realms remain separate.

Never log secrets, JWTs, password reset tokens, payment credentials, or raw authorization headers.
