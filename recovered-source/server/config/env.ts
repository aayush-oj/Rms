import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_JWT_SECRET = 'foodiehub-rms-secure-jwt-signing-secret-key-32chars';
const DOCUMENTED_JWT_PLACEHOLDERS = new Set([
  'replace-with-a-long-random-secret-at-least-32-characters',
  'replace-with-a-unique-random-secret-at-least-32-characters',
]);
const DOCUMENTED_DATABASE_PASSWORD_PLACEHOLDERS = new Set([
  'replace-with-a-strong-database-password',
]);

const PLATFORM_SESSION_MAX_MS = 8 * 60 * 60 * 1000;

const platformAdminBootstrapEnvironmentSchema = z.object({
  PLATFORM_ADMIN_BOOTSTRAP_NAME: z.string().trim().min(2).max(120),
  PLATFORM_ADMIN_BOOTSTRAP_EMAIL: z.string().trim().email().max(254),
  PLATFORM_ADMIN_BOOTSTRAP_PASSWORD: z.string()
    .min(14)
    .max(128)
    .regex(/[a-z]/)
    .regex(/[A-Z]/)
    .regex(/\d/)
    .regex(/[^A-Za-z0-9]/),
});

function validatePlatformAdminBootstrapEnvironment(
  rawEnv: Record<string, string | undefined>,
): void {
  const keys = [
    'PLATFORM_ADMIN_BOOTSTRAP_NAME',
    'PLATFORM_ADMIN_BOOTSTRAP_EMAIL',
    'PLATFORM_ADMIN_BOOTSTRAP_PASSWORD',
  ] as const;
  const supplied = keys.filter(key => Boolean(rawEnv[key]?.trim()));
  if (supplied.length === 0) return;
  if (supplied.length !== keys.length) {
    throw new Error(
      '[EnvConfig] Environment validation failed:\n  - PLATFORM_ADMIN_BOOTSTRAP: name, email, and password must be configured together',
    );
  }

  const result = platformAdminBootstrapEnvironmentSchema.safeParse(rawEnv);
  if (!result.success) {
    const details = result.error.issues
      .map(issue => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`[EnvConfig] Environment validation failed:\n${details}`);
  }
}

function simpleDurationMs(value: string): number | null {
  const match = value.trim().match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit === 's'
    ? 1000
    : unit === 'm'
      ? 60 * 1000
      : unit === 'h'
        ? 60 * 60 * 1000
        : 24 * 60 * 60 * 1000;

  const result = amount * multiplier;
  return Number.isFinite(result) && result > 0 ? result : null;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  HOST: z.string().trim().min(1).default('0.0.0.0'),
  API_PREFIX: z.string().trim().min(1).default('/api/v1'),

  DATABASE_HOST: z.string().trim().min(1).default('127.0.0.1'),
  DATABASE_PORT: z.coerce.number().int().positive().max(65535).default(3306),
  DATABASE_NAME: z.string().trim().min(1).default('foodiehub_rms'),
  DATABASE_USER: z.string().trim().min(1).default('root'),
  DATABASE_PASSWORD: z.string().default(''),
  DATABASE_CONNECTION_LIMIT: z.coerce.number().int().positive().max(100).default(10),
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().max(60000).default(5000),

  UPLOADS_DIR: z.string().trim().min(1).default('uploads'),

  JWT_SECRET: z.string().min(32).default(DEFAULT_JWT_SECRET),
  JWT_EXPIRES_IN: z.string().trim().min(2).default('24h'),
  PLATFORM_JWT_SECRET: z.string().min(32).optional(),
  PLATFORM_JWT_EXPIRES_IN: z.string()
    .trim()
    .regex(/^\d+(s|m|h|d)$/i, 'PLATFORM_JWT_EXPIRES_IN must use a simple duration such as 30m, 2h, or 8h')
    .default('8h'),

  ALLOWED_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000'),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  LEGACY_STATE_ENABLED: z.enum(['true', 'false']).optional(),

  AUTH_LOGIN_WINDOW_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
  AUTH_LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  AUTH_PIN_WINDOW_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
  AUTH_PIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(20),
  AUTH_REGISTER_WINDOW_MS: z.coerce.number().int().positive().default(60 * 60 * 1000),
  AUTH_REGISTER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

  SUPPORT_CONTACT_NAME: z.string().trim().min(1).max(100).default('MIH Support'),
  SUPPORT_CONTACT_EMAIL: z.union([
    z.literal(''),
    z.string().trim().email(),
  ]).default('info@mih.com.np'),
  SUPPORT_CONTACT_WEBSITE: z.union([
    z.literal(''),
    z.string().trim().url().refine(
      value => value.startsWith('https://') || value.startsWith('http://'),
      'SUPPORT_CONTACT_WEBSITE must use http:// or https://',
    ),
  ]).default('https://www.mihgroup.com.np/'),
  SUPPORT_CONTACT_PHONE: z.string().trim().max(40).default(''),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;
  if (!env.DATABASE_PASSWORD.trim()) {
    ctx.addIssue({ code: 'custom', path: ['DATABASE_PASSWORD'], message: 'DATABASE_PASSWORD must not be empty in production' });
  } else if (DOCUMENTED_DATABASE_PASSWORD_PLACEHOLDERS.has(env.DATABASE_PASSWORD)) {
    ctx.addIssue({ code: 'custom', path: ['DATABASE_PASSWORD'], message: 'DATABASE_PASSWORD must not use a documented placeholder in production' });
  }
  if (env.JWT_SECRET === DEFAULT_JWT_SECRET) {
    ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'JWT_SECRET must not use the development default in production' });
  } else if (DOCUMENTED_JWT_PLACEHOLDERS.has(env.JWT_SECRET)) {
    ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'JWT_SECRET must not use a documented placeholder in production' });
  }
  if (!env.PLATFORM_JWT_SECRET) {
    ctx.addIssue({ code: 'custom', path: ['PLATFORM_JWT_SECRET'], message: 'PLATFORM_JWT_SECRET must be explicitly configured in production' });
  } else if (DOCUMENTED_JWT_PLACEHOLDERS.has(env.PLATFORM_JWT_SECRET)) {
    ctx.addIssue({ code: 'custom', path: ['PLATFORM_JWT_SECRET'], message: 'PLATFORM_JWT_SECRET must not use a documented placeholder in production' });
  } else if (env.PLATFORM_JWT_SECRET === env.JWT_SECRET) {
    ctx.addIssue({ code: 'custom', path: ['PLATFORM_JWT_SECRET'], message: 'PLATFORM_JWT_SECRET must be different from JWT_SECRET' });
  }

  const platformSessionMs = simpleDurationMs(env.PLATFORM_JWT_EXPIRES_IN);
  if (platformSessionMs == null || platformSessionMs > PLATFORM_SESSION_MAX_MS) {
    ctx.addIssue({
      code: 'custom',
      path: ['PLATFORM_JWT_EXPIRES_IN'],
      message: 'Production Platform Admin sessions must have an absolute lifetime of 8 hours or less',
    });
  }
  const origins = env.ALLOWED_ORIGINS.split(',').map(v => v.trim()).filter(Boolean);
  if (!origins.length || origins.includes('*')) {
    ctx.addIssue({ code: 'custom', path: ['ALLOWED_ORIGINS'], message: 'Production requires an explicit non-wildcard ALLOWED_ORIGINS list' });
  }
  if (env.COOKIE_SECURE === 'false') {
    ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'COOKIE_SECURE cannot be disabled in production' });
  }
  if (env.LEGACY_STATE_ENABLED === 'true') {
    ctx.addIssue({ code: 'custom', path: ['LEGACY_STATE_ENABLED'], message: 'Legacy /api/state compatibility storage cannot be enabled in production' });
  }
  if (
    !env.SUPPORT_CONTACT_EMAIL
    && !env.SUPPORT_CONTACT_WEBSITE
    && !env.SUPPORT_CONTACT_PHONE
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['SUPPORT_CONTACT_EMAIL'],
      message: 'Production requires at least one public support contact method',
    });
  }
});

export type EnvConfig = z.infer<typeof envSchema>;

let cachedEnv: EnvConfig | null = null;

export function validateEnv(rawEnv: Record<string, string | undefined> = process.env): EnvConfig {
  validatePlatformAdminBootstrapEnvironment(rawEnv);
  if ((rawEnv.NODE_ENV ?? 'development') === 'production' && !rawEnv.ALLOWED_ORIGINS?.trim()) {
    throw new Error('[EnvConfig] Environment validation failed:\n  - ALLOWED_ORIGINS: Production requires an explicitly configured origin allowlist');
  }
  const result = envSchema.safeParse(rawEnv);
  if (!result.success) {
    const errorDetails = result.error.issues.map(issue => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`[EnvConfig] Environment validation failed:\n${errorDetails}`);
  }
  cachedEnv = result.data;
  return result.data;
}

export function resetEnvForTests(): void { cachedEnv = null; }

export function getEnv(): EnvConfig {
  if (!cachedEnv) return validateEnv(process.env);
  return cachedEnv;
}

export function allowedOrigins(env: EnvConfig = getEnv()): string[] {
  return env.ALLOWED_ORIGINS.split(',').map(v => v.trim()).filter(Boolean);
}

export function cookieSecure(env: EnvConfig = getEnv()): boolean {
  return env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production';
}

export function legacyStateEnabled(env: EnvConfig = getEnv()): boolean {
  if (env.LEGACY_STATE_ENABLED) return env.LEGACY_STATE_ENABLED === 'true';
  return env.NODE_ENV !== 'production';
}

export function platformJwtSecret(env: EnvConfig = getEnv()): string {
  return env.PLATFORM_JWT_SECRET ?? `${env.JWT_SECRET}:platform-admin`;
}

export interface PublicSupportContact {
  name: string;
  email: string | null;
  website: string | null;
  phone: string | null;
}

export function publicSupportContact(
  env: EnvConfig = getEnv(),
): PublicSupportContact {
  return {
    name: env.SUPPORT_CONTACT_NAME,
    email: env.SUPPORT_CONTACT_EMAIL || null,
    website: env.SUPPORT_CONTACT_WEBSITE || null,
    phone: env.SUPPORT_CONTACT_PHONE || null,
  };
}
