import mysql, { Pool, PoolOptions } from 'mysql2/promise';
import { getDatabaseConfig } from '../config/database';
import { getEnv } from '../config/env';
import { logger } from '../lib/logger';

let poolInstance: Pool | null = null;

export interface DatabaseHealthStatus {
  healthy: boolean;
  message: string;
  latencyMs?: number;
  error?: string;
}

export function getDatabasePool(): Pool {
  if (!poolInstance) {
    const config = getDatabaseConfig();
    const poolOptions: PoolOptions = {
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      waitForConnections: config.waitForConnections,
      connectionLimit: config.connectionLimit,
      queueLimit: config.queueLimit,
      connectTimeout: config.connectTimeout,
      // Business dates are calendar dates, not instants subject to timezone conversion.
      dateStrings: ['DATE'],
      enableKeepAlive: config.enableKeepAlive,
      keepAliveInitialDelay: config.keepAliveInitialDelay,
    };

    logger.info(`Initializing MySQL 8.0 connection pool to ${config.host}:${config.port}/${config.database} (limit: ${config.connectionLimit})`);
    poolInstance = mysql.createPool(poolOptions);
  }

  return poolInstance;
}

let dbAvailabilityCached: boolean | null = null;

export async function isDatabaseAvailable(): Promise<boolean> {
  const available = dbAvailabilityCached ?? (await checkDatabaseConnection()).healthy;
  if (!available && getEnv().NODE_ENV === 'production') {
    throw new Error('Authoritative MySQL is unavailable; production memory fallback is prohibited');
  }
  return available;
}

export function resetDatabaseAvailability(): void {
  dbAvailabilityCached = null;
}

export async function checkDatabaseConnection(): Promise<DatabaseHealthStatus> {
  const startTime = Date.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const pool = getDatabasePool();
    const timeoutMs = getDatabaseConfig().connectTimeout;
    await Promise.race([
      pool.query('SELECT 1 + 1 AS health'),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Database ping timeout')), timeoutMs);
      }),
    ]);
    const latencyMs = Date.now() - startTime;
    dbAvailabilityCached = true;
    return {
      healthy: true,
      message: 'Database connection operational',
      latencyMs,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);
    dbAvailabilityCached = false;
    logger.debug(`Database health check: ${errorMessage}`, { latencyMs });
    return {
      healthy: false,
      message: 'Database unavailable or connection failed',
      latencyMs,
      error: errorMessage,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function executeQuery<T = unknown>(sql: string, params?: any[]): Promise<T> {
  const pool = getDatabasePool();
  const [rows] = await pool.execute(sql, params);
  return rows as T;
}

export async function closeDatabasePool(): Promise<void> {
  if (poolInstance) {
    logger.info('Closing MySQL connection pool...');
    await poolInstance.end();
    poolInstance = null;
    resetDatabaseAvailability();
    logger.info('MySQL connection pool closed.');
  }
}
