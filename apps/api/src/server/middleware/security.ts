import { NextFunction, Request, Response } from 'express';
import { getEnv } from '../config/env';

const DEVELOPMENT_CSP = [
  "default-src 'self'",
  // @vitejs/plugin-react injects its Fast Refresh preamble as an inline module in development.
  // Keep this development-only: production must not require unsafe-inline for scripts.
  "script-src 'self' 'unsafe-inline'",
  // Legacy RMS screens still use the Material Symbols stylesheet while the UI migrates to Lucide SVG icons.
  // Scope this compatibility allowance to the exact Google Fonts stylesheet/font hosts only.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob:",
  "font-src 'self' data: https://fonts.gstatic.com",
  // Vite HMR and the RMS Socket.IO client both use WebSockets during local development.
  "connect-src 'self' ws: wss: http: https:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join('; ');

// Start production CSP in report-only mode so deployments can validate fonts,
// images, receipt/print integrations and realtime connections before enforcement.
// The policy deliberately avoids unsafe-inline for scripts while temporarily
// allowing inline styles because parts of the current React UI still emit them.
const PRODUCTION_CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
  "form-action 'self'",
].join('; ');

export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
  const env = getEnv();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  if (env.NODE_ENV !== 'production') {
    // Vite's React Fast Refresh preamble is injected inline. A strict `script-src 'self'`
    // policy blocks that preamble and causes `@vitejs/plugin-react can't detect preamble`.
    // This relaxed policy applies only to local development/test responses.
    res.setHeader('Content-Security-Policy', DEVELOPMENT_CSP);
  } else {
    res.setHeader('Content-Security-Policy-Report-Only', PRODUCTION_CSP_REPORT_ONLY);
  }

  if (env.NODE_ENV === 'production' && req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}
