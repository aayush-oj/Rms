import { getEnv } from './env';

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  connectionLimit: number;
  connectTimeout: number;
  waitForConnections: boolean;
  queueLimit: number;
  enableKeepAlive: boolean;
  keepAliveInitialDelay: number;
}

export function getDatabaseConfig(): DatabaseConfig {
  const env = getEnv();
  return {
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    database: env.DATABASE_NAME,
    user: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD || undefined,
    connectionLimit: env.DATABASE_CONNECTION_LIMIT,
    connectTimeout: env.DATABASE_CONNECT_TIMEOUT_MS,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  };
}
