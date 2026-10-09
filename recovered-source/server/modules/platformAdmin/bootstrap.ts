import bcrypt from 'bcryptjs';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { getDatabasePool } from '../../db/pool';

const PLATFORM_ADMIN_BOOTSTRAP_LOCK = 'rms:platform-admin-bootstrap';
const PLATFORM_ADMIN_BOOTSTRAP_LOCK_TIMEOUT_SECONDS = 10;
const PLATFORM_ADMIN_PASSWORD_ROUNDS = 12;

const platformAdminBootstrapSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  password: z.string().min(14).max(128),
  mustChangePassword: z.boolean().default(false),
}).superRefine((value, ctx) => {
  const password = value.password;
  if (!/[a-z]/.test(password)) {
    ctx.addIssue({ code: 'custom', path: ['password'], message: 'Password must include a lowercase letter' });
  }
  if (!/[A-Z]/.test(password)) {
    ctx.addIssue({ code: 'custom', path: ['password'], message: 'Password must include an uppercase letter' });
  }
  if (!/\d/.test(password)) {
    ctx.addIssue({ code: 'custom', path: ['password'], message: 'Password must include a number' });
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    ctx.addIssue({ code: 'custom', path: ['password'], message: 'Password must include a symbol' });
  }
});

export type PlatformAdminBootstrapInput = z.input<typeof platformAdminBootstrapSchema>;

export interface BootstrappedPlatformAdmin {
  id: number;
  name: string;
  email: string;
}

export type PlatformAdminEnvironmentBootstrapResult =
  | { status: 'not-configured' }
  | { status: 'already-bootstrapped' }
  | { status: 'created'; admin: BootstrappedPlatformAdmin };

export class PlatformAdminBootstrapError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'PLATFORM_ADMIN_ALREADY_BOOTSTRAPPED'
      | 'PLATFORM_ADMIN_BOOTSTRAP_LOCK_UNAVAILABLE'
  ) {
    super(message);
    this.name = 'PlatformAdminBootstrapError';
  }
}

export function validatePlatformAdminBootstrapInput(input: PlatformAdminBootstrapInput) {
  return platformAdminBootstrapSchema.parse(input);
}

async function releaseBootstrapLock(connection: PoolConnection): Promise<void> {
  try {
    await connection.execute('SELECT RELEASE_LOCK(?)', [PLATFORM_ADMIN_BOOTSTRAP_LOCK]);
  } catch {
    // Connection release still happens below. Bootstrap success/failure must not be
    // replaced by a secondary advisory-lock cleanup error.
  }
}

export async function bootstrapFirstPlatformAdmin(
  input: PlatformAdminBootstrapInput,
  pool: Pool = getDatabasePool()
): Promise<BootstrappedPlatformAdmin> {
  const validated = validatePlatformAdminBootstrapInput(input);
  const passwordHash = await bcrypt.hash(validated.password, PLATFORM_ADMIN_PASSWORD_ROUNDS);
  const connection = await pool.getConnection();
  let lockAcquired = false;
  let transactionStarted = false;

  try {
    const [lockRows] = await connection.execute<RowDataPacket[]>(
      'SELECT GET_LOCK(?, ?) AS acquired',
      [PLATFORM_ADMIN_BOOTSTRAP_LOCK, PLATFORM_ADMIN_BOOTSTRAP_LOCK_TIMEOUT_SECONDS]
    );
    lockAcquired = Number(lockRows[0]?.acquired ?? 0) === 1;
    if (!lockAcquired) {
      throw new PlatformAdminBootstrapError(
        'Could not acquire the Platform Admin bootstrap lock. Another bootstrap may be running.',
        'PLATFORM_ADMIN_BOOTSTRAP_LOCK_UNAVAILABLE'
      );
    }

    await connection.beginTransaction();
    transactionStarted = true;

    const [existingRows] = await connection.execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS count FROM platform_admins'
    );
    if (Number(existingRows[0]?.count ?? 0) > 0) {
      throw new PlatformAdminBootstrapError(
        'Platform Admin bootstrap has already been completed. Refusing to create another privileged account through the bootstrap path.',
        'PLATFORM_ADMIN_ALREADY_BOOTSTRAPPED'
      );
    }

    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO platform_admins
        (name, email, password_hash, must_change_password, is_active)
       VALUES (?, ?, ?, ?, TRUE)`,
      [validated.name, validated.email, passwordHash, validated.mustChangePassword]
    );

    await connection.commit();
    transactionStarted = false;

    return {
      id: Number(result.insertId),
      name: validated.name,
      email: validated.email,
    };
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback().catch(() => undefined);
    }
    throw error;
  } finally {
    if (lockAcquired) await releaseBootstrapLock(connection);
    connection.release();
  }
}

export async function bootstrapPlatformAdminFromEnvironment(
  pool: Pool = getDatabasePool(),
): Promise<PlatformAdminEnvironmentBootstrapResult> {
  const name = String(process.env.PLATFORM_ADMIN_BOOTSTRAP_NAME || '').trim();
  const email = String(process.env.PLATFORM_ADMIN_BOOTSTRAP_EMAIL || '').trim();
  const password = String(process.env.PLATFORM_ADMIN_BOOTSTRAP_PASSWORD || '');

  // Limit how long the temporary bootstrap secret remains available to code in
  // this process. The hosting control panel may inject it again after a restart.
  delete process.env.PLATFORM_ADMIN_BOOTSTRAP_PASSWORD;

  if (!name && !email && !password) return { status: 'not-configured' };
  if (!name || !email || !password) {
    throw new Error(
      'PLATFORM_ADMIN_BOOTSTRAP_NAME, PLATFORM_ADMIN_BOOTSTRAP_EMAIL, and PLATFORM_ADMIN_BOOTSTRAP_PASSWORD must be configured together',
    );
  }

  try {
    const admin = await bootstrapFirstPlatformAdmin({
      name,
      email,
      password,
      mustChangePassword: true,
    }, pool);
    return { status: 'created', admin };
  } catch (error) {
    if (
      error instanceof PlatformAdminBootstrapError
      && error.code === 'PLATFORM_ADMIN_ALREADY_BOOTSTRAPPED'
    ) {
      return { status: 'already-bootstrapped' };
    }
    throw error;
  }
}
