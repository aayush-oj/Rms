import type { NextFunction, Request, Response } from 'express';
import { allowedOrigins } from '../../config/env';
import { ForbiddenError } from '../../shared/errors';
import {
  platformBearerToken,
  platformSessionCookieToken,
} from './sessionCookies';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function normalizedHttpOrigin(value: string | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function trustedPlatformOrigins(): Set<string> {
  return new Set(
    allowedOrigins()
      .map(origin => normalizedHttpOrigin(origin))
      .filter((origin): origin is string => Boolean(origin)),
  );
}

function requestOrigin(req: Request): string | null {
  const origin = normalizedHttpOrigin(req.headers.origin);
  if (req.headers.origin !== undefined) return origin;

  const referer = req.headers.referer;
  return normalizedHttpOrigin(referer);
}

export function platformMutationOriginGuard() {
  return (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void => {
    if (SAFE_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }

    // Bearer-authenticated Platform calls are not browser-cookie CSRF targets.
    // Platform authentication already gives bearer credentials precedence over
    // the scoped cookie, so preserve that same source-of-authority ordering.
    if (platformBearerToken(req)) {
      next();
      return;
    }

    // Login and other unauthenticated Platform POSTs without the Platform
    // session cookie are outside the cookie-authenticated CSRF boundary.
    if (!platformSessionCookieToken(req)) {
      next();
      return;
    }

    const origin = requestOrigin(req);
    if (origin && trustedPlatformOrigins().has(origin)) {
      next();
      return;
    }

    next(
      new ForbiddenError(
        'Trusted Platform request origin required',
        'PLATFORM_REQUEST_ORIGIN_FORBIDDEN',
      ),
    );
  };
}
