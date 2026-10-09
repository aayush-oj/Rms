import { getEnv } from '../config/env';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  requestId?: string;
  method?: string;
  url?: string;
  statusCode?: number;
  durationMs?: number;
  err?: unknown;
  [key: string]: unknown;
}

const SENSITIVE_KEYS = new Set([
  'password',
  'pin',
  'token',
  'authorization',
  'secret',
  'cookie',
  'apiKey',
  'database_password',
  'card',
  'cvv',
]);

function sanitize(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map(item => sanitize(item));
  }

  const record = data as Record<string, unknown>;
  const clean: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase()) || key.toLowerCase().includes('password') || key.toLowerCase().includes('pin')) {
      clean[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      clean[key] = sanitize(value);
    } else {
      clean[key] = value;
    }
  }

  return clean;
}

export class Logger {
  private level: LogLevel = 'info';

  constructor() {
    try {
      const env = getEnv();
      if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') {
        this.level = 'debug';
      }
    } catch {
      this.level = 'info';
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      debug: 10,
      info: 20,
      warn: 30,
      error: 40,
    };
    return levels[level] >= levels[this.level];
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const safeContext = context ? sanitize(context) : undefined;

    return JSON.stringify({
      timestamp,
      level,
      message,
      ...(safeContext && typeof safeContext === 'object' ? safeContext : {}),
    });
  }

  public debug(message: string, context?: LogContext): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, context));
    }
  }

  public info(message: string, context?: LogContext): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, context));
    }
  }

  public warn(message: string, context?: LogContext): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, context));
    }
  }

  public error(message: string, context?: LogContext): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, context));
    }
  }
}

export const logger = new Logger();
