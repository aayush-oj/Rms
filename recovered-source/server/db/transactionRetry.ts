const MYSQL_DEADLOCK = 1213;
const MYSQL_LOCK_WAIT_TIMEOUT = 1205;

export interface TransactionRetryOptions {
  attempts?: number;
  baseDelayMs?: number;
}

function mysqlErrno(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const value = (error as { errno?: unknown }).errno;
  return typeof value === 'number' ? value : null;
}

export function isRetryableTransactionError(error: unknown): boolean {
  const errno = mysqlErrno(error);
  return errno === MYSQL_DEADLOCK || errno === MYSQL_LOCK_WAIT_TIMEOUT;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a complete transaction operation after MySQL has rolled it back because
 * of a deadlock or lock-wait timeout. The callback must create/own its own
 * transaction and be safe to invoke again (financial callers use idempotency
 * keys or row-state guards for this reason).
 */
export async function withTransactionRetry<T>(
  operation: () => Promise<T>,
  options: TransactionRetryOptions = {}
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 20);

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableTransactionError(error) || attempt >= attempts) throw error;
      await sleep(baseDelayMs * attempt);
    }
  }

  throw lastError;
}
