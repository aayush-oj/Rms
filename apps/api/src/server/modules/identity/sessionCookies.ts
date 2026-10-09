import { Request, Response } from 'express';
import { cookieSecure, getEnv } from '../../config/env';

export const ACCOUNT_SESSION_COOKIE = 'rms_account_session';
export const STAFF_SESSION_COOKIE = 'rms_staff_session';
export const ACCESS_STATUS_SESSION_COOKIE = 'rms_access_status_session';

export type SessionCookieKind = 'ACCOUNT' | 'STAFF' | 'ACCESS_STATUS';

function parseCookies(raw?: string): Record<string, string> {
  if (!raw) return {};
  const result: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try { result[key] = decodeURIComponent(value); } catch { result[key] = value; }
  }
  return result;
}

function cookieName(kind: SessionCookieKind): string {
  if (kind === 'ACCOUNT') return ACCOUNT_SESSION_COOKIE;
  if (kind === 'STAFF') return STAFF_SESSION_COOKIE;
  return ACCESS_STATUS_SESSION_COOKIE;
}

export function cookieToken(req: Request, kind: SessionCookieKind): string | null {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[cookieName(kind)] || null;
}

export function rawCookieToken(cookieHeader: string | undefined, kind: SessionCookieKind): string | null {
  const cookies = parseCookies(cookieHeader);
  return cookies[cookieName(kind)] || null;
}

function options() {
  return {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 24 * 60 * 60 * 1000,
  };
}

export function setSessionCookie(res: Response, kind: SessionCookieKind, token: string): void {
  res.cookie(cookieName(kind), token, options());
}

export function clearSessionCookie(res: Response, kind: SessionCookieKind): void {
  const { maxAge: _maxAge, ...clearOptions } = options();
  res.clearCookie(cookieName(kind), clearOptions);
}

export function browserSafeAuthResult<T extends { token?: string }>(result: T): T | Omit<T, 'token'> {
  if (getEnv().NODE_ENV !== 'production') return result;
  const { token: _token, ...safe } = result;
  return safe;
}
