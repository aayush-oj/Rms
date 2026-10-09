import { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../pool';
import { logger } from '../../lib/logger';
import { migrationChecksums } from './checksums';
import { MigrationDefinition, AppliedMigrationRecord, MigrationStatusReport } from './types';

const MIGRATION_LOCK_NAME = 'rms:schema-migrations';
const MIGRATION_LOCK_TIMEOUT_SECONDS = 30;

export class MigrationRunner {
  private readonly registeredMigrations: MigrationDefinition[] = [];
  private readonly tableName = '_schema_migrations';

  constructor(migrations: MigrationDefinition[] = []) {
    this.registerMigrations(migrations);
  }

  private checksumFor(name: string): string {
    const checksum = migrationChecksums[name];
    if (!checksum) {
      throw new Error(
        `[MigrationRunner] Migration "${name}" has no checksum manifest entry. Run npm run db:verify:migrations and add the checksum before registering it.`
      );
    }
    return checksum;
  }

  public registerMigration(migration: MigrationDefinition): void {
    if (this.registeredMigrations.some(m => m.name === migration.name)) {
      throw new Error(`[MigrationRunner] Migration "${migration.name}" is already registered.`);
    }
    this.checksumFor(migration.name);
    this.registeredMigrations.push(migration);
    this.registeredMigrations.sort((a, b) => a.name.localeCompare(b.name));
  }

  public registerMigrations(migrations: MigrationDefinition[]): void {
    for (const m of migrations) this.registerMigration(m);
  }

  public async initMigrationTable(pool: Pool | PoolConnection = getDatabasePool()): Promise<void> {
    const ddl = `
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        checksum VARCHAR(64) NULL,
        batch INT NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    await pool.query(ddl);

    const [checksumColumns] = await pool.query<RowDataPacket[]>(
      `SHOW COLUMNS FROM ${this.tableName} LIKE 'checksum'`
    );
    if (checksumColumns.length === 0) {
      try {
        await pool.query(
          `ALTER TABLE ${this.tableName} ADD COLUMN checksum VARCHAR(64) NULL AFTER name`
        );
      } catch (error) {
        const code = typeof error === 'object' && error && 'code' in error
          ? String((error as { code?: unknown }).code || '')
          : '';
        if (code !== 'ER_DUP_FIELDNAME') throw error;
      }
    }
  }

  private async enforceChecksumIntegrity(
    pool: Pool | PoolConnection,
    applied: AppliedMigrationRecord[]
  ): Promise<void> {
    for (const record of applied) {
      const expected = this.checksumFor(record.name);

      if (!record.checksum) {
        await pool.query(
          `UPDATE ${this.tableName} SET checksum = ? WHERE id = ? AND checksum IS NULL`,
          [expected, record.id]
        );
        record.checksum = expected;
        logger.warn(
          `[MigrationRunner] Baselined checksum for legacy applied migration: ${record.name}`
        );
        continue;
      }

      if (record.checksum !== expected) {
        throw new Error(
          `[MigrationRunner] Migration checksum mismatch for "${record.name}". Recorded=${record.checksum}, expected=${expected}. Applied migrations are immutable; restore the original migration and add a new numbered migration for schema changes.`
        );
      }
    }
  }

  public async getAppliedMigrations(pool: Pool = getDatabasePool()): Promise<AppliedMigrationRecord[]> {
    await this.initMigrationTable(pool);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, name, checksum, batch, applied_at FROM ${this.tableName} ORDER BY id ASC`
    );
    const applied = rows as unknown as AppliedMigrationRecord[];
    await this.enforceChecksumIntegrity(pool, applied);
    return applied;
  }

  public async getMigrationStatus(pool: Pool = getDatabasePool()): Promise<MigrationStatusReport> {
    try {
      const applied = await this.getAppliedMigrations(pool);
      const appliedNames = new Set(applied.map(a => a.name));
      const pending = this.registeredMigrations
        .filter(m => !appliedNames.has(m.name))
        .map(m => m.name);

      return {
        initialized: true,
        totalRegistered: this.registeredMigrations.length,
        totalApplied: applied.length,
        pendingCount: pending.length,
        applied,
        pending,
      };
    } catch (error) {
      logger.error('[MigrationRunner] Migration status/integrity check failed', { error });
      return {
        initialized: false,
        totalRegistered: this.registeredMigrations.length,
        totalApplied: 0,
        pendingCount: this.registeredMigrations.length,
        applied: [],
        pending: this.registeredMigrations.map(m => m.name),
      };
    }
  }

  public async runPending(pool: Pool = getDatabasePool()): Promise<{ applied: string[]; batch: number }> {
    // MySQL DDL can auto-commit, so wrapping migration DDL in a transaction is not
    // enough to protect two application instances starting at the same time. A
    // database advisory lock ensures only one process performs schema migration work.
    const connection: PoolConnection = await pool.getConnection();
    let lockAcquired = false;

    try {
      const [lockRows] = await connection.execute<RowDataPacket[]>(
        'SELECT GET_LOCK(?, ?) AS acquired',
        [MIGRATION_LOCK_NAME, MIGRATION_LOCK_TIMEOUT_SECONDS]
      );
      lockAcquired = Number(lockRows[0]?.acquired || 0) === 1;
      if (!lockAcquired) {
        throw new Error('[MigrationRunner] Could not acquire schema migration lock. Another instance may still be migrating.');
      }

      // Re-read applied migrations only after the lock is held. Another instance may
      // have finished migrations while this process was waiting for the advisory lock.
      await this.initMigrationTable(connection);
      const [appliedRows] = await connection.query<RowDataPacket[]>(
        `SELECT id, name, checksum, batch, applied_at FROM ${this.tableName} ORDER BY id ASC`
      );
      const appliedRecords = appliedRows as unknown as AppliedMigrationRecord[];
      await this.enforceChecksumIntegrity(connection, appliedRecords);

      const appliedNames = new Set(appliedRecords.map(r => r.name));
      const pending = this.registeredMigrations.filter(m => !appliedNames.has(m.name));

      if (pending.length === 0) {
        logger.info('[MigrationRunner] No pending migrations to run.');
        return { applied: [], batch: 0 };
      }

      const maxBatch = appliedRecords.reduce((max, r) => Math.max(max, r.batch), 0);
      const currentBatch = maxBatch + 1;
      const newlyApplied: string[] = [];

      for (const migration of pending) {
        const checksum = this.checksumFor(migration.name);
        logger.info(`[MigrationRunner] Applying migration: ${migration.name} (Batch: ${currentBatch})`);
        await connection.beginTransaction();
        try {
          await migration.up(connection);
          await connection.query(
            `INSERT INTO ${this.tableName} (name, checksum, batch) VALUES (?, ?, ?)`,
            [migration.name, checksum, currentBatch]
          );
          await connection.commit();
          newlyApplied.push(migration.name);
          logger.info(`[MigrationRunner] Successfully applied: ${migration.name}`);
        } catch (migrationErr) {
          await connection.rollback();
          logger.error(`[MigrationRunner] Failed to apply migration: ${migration.name}`, { error: migrationErr });
          throw new Error(
            `[MigrationRunner] Migration "${migration.name}" failed: ${
              migrationErr instanceof Error ? migrationErr.message : String(migrationErr)
            }`
          );
        }
      }

      return { applied: newlyApplied, batch: currentBatch };
    } finally {
      if (lockAcquired) {
        try {
          await connection.execute('SELECT RELEASE_LOCK(?)', [MIGRATION_LOCK_NAME]);
        } catch (error) {
          logger.warn('[MigrationRunner] Failed to release schema migration lock cleanly', { error });
        }
      }
      connection.release();
    }
  }
}

export const migrationRunner = new MigrationRunner();
