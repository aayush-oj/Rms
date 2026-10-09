import type { Request, Response } from 'express';
import { cookieSecure } from '../../config/env';

export const PLATFORM_ADMIN_SESSION_COOKIE = 'rms_platform_session';
export const PLATFORM_ADMIN_COOKIE_PATH = '/api/v1/platform';

function parseCookies(raw?: string): Record<string, string> {
  if (!raw) return {};
  const result: Record<string, string> = {};

  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      result[key] = decodeURIComponent(value);
    } catch {
      result[key] = value;
    }
  }

  return result;
}

export function platformSessionCookieToken(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[PLATFORM_ADMIN_SESSION_COOKIE] || null;
}

function baseOptions() {
  return {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'lax' as const,
    path: PLATFORM_ADMIN_COOKIE_PATH,
  };
}

export function setPlatformSessionCookie(
  res: Response,
  token: string,
  expiresAt: string,
): void {
  const expiry = new Date(expiresAt).getTime();
  const maxAge = Math.max(1, expiry - Date.now());

  res.cookie(PLATFORM_ADMIN_SESSION_COOKIE, token, {
    ...baseOptions(),
    maxAge,
  });
}

export function clearPlatformSessionCookie(res: Response): void {
  res.clearCookie(PLATFORM_ADMIN_SESSION_COOKIE, baseOptions());
}

export function platformBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

export function platformRequestToken(req: Request): string | null {
  return platformBearerToken(req) || platformSessionCookieToken(req);
}
