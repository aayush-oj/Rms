import crypto from 'crypto';
import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { MigrationDefinition } from './types';

async function columnExists(connection: PoolConnection, table: string, column: string): Promise<boolean> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS count
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?`,
    [table, column]
  );
  return Number(rows[0]?.count || 0) > 0;
}

async function indexExists(connection: PoolConnection, table: string, index: string): Promise<boolean> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS count
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND index_name = ?`,
    [table, index]
  );
  return Number(rows[0]?.count || 0) > 0;
}

async function generateUniqueRestaurantCode(connection: PoolConnection, used: Set<string>): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const code = String(crypto.randomInt(100000, 1000000));
    if (used.has(code)) continue;
    const [rows] = await connection.execute<RowDataPacket[]>(
      'SELECT id FROM organizations WHERE restaurant_code = ? LIMIT 1',
      [code]
    );
    if (!rows.length) {
      used.add(code);
      return code;
    }
  }
  throw new Error('Unable to generate a unique restaurant code after 100 attempts');
}

function normalizeDisplayName(value: unknown, userId: number): string {
  const cleaned = String(value ?? '').trim().replace(/\s+/g, ' ');
  return cleaned || `Staff ${userId}`;
}

async function migrateNameBasedLogins(connection: PoolConnection): Promise<void> {
  const [organizations] = await connection.execute<RowDataPacket[]>('SELECT id FROM organizations ORDER BY id');
  for (const organization of organizations) {
    const organizationId = Number(organization.id);
    const [users] = await connection.execute<RowDataPacket[]>(
      'SELECT id, name FROM users WHERE organization_id = ? ORDER BY id FOR UPDATE',
      [organizationId]
    );

    // Free the old tenant-scoped usernames first so an old email/username cannot
    // collide with another staff member's new name-based login during conversion.
    for (const user of users) {
      const userId = Number(user.id);
      await connection.execute(
        'UPDATE users SET username = ? WHERE id = ? AND organization_id = ?',
        [`__rms43_${userId}`, userId, organizationId]
      );
    }

    const used = new Set<string>();
    for (const user of users) {
      const userId = Number(user.id);
      const baseName = normalizeDisplayName(user.name, userId).slice(0, 100);
      let displayName = baseName;
      let normalized = displayName.toLowerCase();
      let suffix = 2;
      while (used.has(normalized)) {
        const suffixText = ` (${suffix})`;
        displayName = `${baseName.slice(0, Math.max(1, 100 - suffixText.length))}${suffixText}`;
        normalized = displayName.toLowerCase();
        suffix += 1;
      }
      used.add(normalized);
      await connection.execute(
        'UPDATE users SET name = ?, username = ?, updated_at = NOW() WHERE id = ? AND organization_id = ?',
        [displayName, normalized, userId, organizationId]
      );
    }
  }
}

export const migration043RestaurantCodeAuth: MigrationDefinition = {
  name: '043_restaurant_code_auth',
  up: async (connection: PoolConnection): Promise<void> => {
    if (!(await columnExists(connection, 'organizations', 'restaurant_code'))) {
      await connection.query('ALTER TABLE organizations ADD COLUMN restaurant_code CHAR(6) NULL AFTER id');
    }

    const [organizations] = await connection.execute<RowDataPacket[]>(
      'SELECT id, restaurant_code FROM organizations ORDER BY id FOR UPDATE'
    );
    const used = new Set<string>(
      organizations
        .map(row => String(row.restaurant_code || '').trim())
        .filter(code => /^\d{6}$/.test(code))
    );

    for (const organization of organizations) {
      const current = String(organization.restaurant_code || '').trim();
      if (/^\d{6}$/.test(current)) continue;
      const code = await generateUniqueRestaurantCode(connection, used);
      await connection.execute(
        'UPDATE organizations SET restaurant_code = ? WHERE id = ?',
        [code, Number(organization.id)]
      );
    }

    await connection.query('ALTER TABLE organizations MODIFY restaurant_code CHAR(6) NOT NULL');
    if (!(await indexExists(connection, 'organizations', 'uk_organizations_restaurant_code'))) {
      await connection.query('ALTER TABLE organizations ADD UNIQUE KEY uk_organizations_restaurant_code (restaurant_code)');
    }

    await migrateNameBasedLogins(connection);

    // PIN authentication is retired. Legacy nullable columns remain only so the
    // historical migrations and old snapshots stay readable; no active path uses them.
    if (await columnExists(connection, 'users', 'pin_hash')) {
      await connection.query('UPDATE users SET pin_hash = NULL');
    }
    if (await columnExists(connection, 'users', 'must_change_pin')) {
      await connection.query('UPDATE users SET must_change_pin = FALSE');
    }
  },
  down: async (connection: PoolConnection): Promise<void> => {
    if (await indexExists(connection, 'organizations', 'uk_organizations_restaurant_code')) {
      await connection.query('ALTER TABLE organizations DROP INDEX uk_organizations_restaurant_code');
    }
    if (await columnExists(connection, 'organizations', 'restaurant_code')) {
      await connection.query('ALTER TABLE organizations DROP COLUMN restaurant_code');
    }
  },
};
