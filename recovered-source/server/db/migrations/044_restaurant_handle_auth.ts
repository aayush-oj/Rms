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

function alnum(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function baseHandle(name: unknown, id: number): string {
  const clean = alnum(name);
  if (clean.length >= 3) return clean.slice(0, 15);
  return `rms${id}`.slice(0, 15);
}

function localLoginName(name: unknown, id: number): string {
  return (alnum(name) || `staff${id}`).slice(0, 80);
}

export const migration044RestaurantHandleAuth: MigrationDefinition = {
  name: '044_restaurant_handle_auth',
  up: async (connection: PoolConnection): Promise<void> => {
    if (!(await columnExists(connection, 'organizations', 'handle'))) {
      await connection.query('ALTER TABLE organizations ADD COLUMN handle VARCHAR(15) NULL AFTER id');
    }

    const [organizations] = await connection.execute<RowDataPacket[]>(
      'SELECT id, name, handle FROM organizations ORDER BY id FOR UPDATE'
    );

    const usedHandles = new Set<string>();
    for (const organization of organizations) {
      const organizationId = Number(organization.id);
      let candidate = String(organization.handle || '').trim().toLowerCase();
      if (!/^[a-z][a-z0-9]{2,14}$/.test(candidate) || usedHandles.has(candidate)) {
        const base = baseHandle(organization.name, organizationId);
        candidate = /^[a-z]/.test(base) ? base : `r${base}`.slice(0, 15);
        let suffix = 2;
        while (usedHandles.has(candidate)) {
          const suffixText = String(suffix);
          candidate = `${base.slice(0, Math.max(1, 15 - suffixText.length))}${suffixText}`;
          if (!/^[a-z]/.test(candidate)) candidate = `r${candidate}`.slice(0, 15);
          suffix += 1;
        }
      }
      usedHandles.add(candidate);
      await connection.execute('UPDATE organizations SET handle = ? WHERE id = ?', [candidate, organizationId]);
    }

    await connection.query('ALTER TABLE organizations MODIFY handle VARCHAR(15) NOT NULL');
    if (!(await indexExists(connection, 'organizations', 'uk_organizations_handle'))) {
      await connection.query('ALTER TABLE organizations ADD UNIQUE KEY uk_organizations_handle (handle)');
    }

    for (const organization of organizations) {
      const organizationId = Number(organization.id);
      const [handleRows] = await connection.execute<RowDataPacket[]>(
        'SELECT handle FROM organizations WHERE id = ? LIMIT 1',
        [organizationId]
      );
      const handle = String(handleRows[0]?.handle || '');
      const [users] = await connection.execute<RowDataPacket[]>(
        'SELECT id, name FROM users WHERE organization_id = ? ORDER BY id FOR UPDATE',
        [organizationId]
      );
      const usedUsernames = new Set<string>();
      for (const user of users) {
        const userId = Number(user.id);
        const local = localLoginName(user.name, userId);
        const base = `${handle}-${local}`.slice(0, 100);
        let username = base;
        let suffix = 2;
        while (usedUsernames.has(username)) {
          const suffixText = String(suffix);
          username = `${base.slice(0, Math.max(1, 100 - suffixText.length))}${suffixText}`;
          suffix += 1;
        }
        usedUsernames.add(username);
        await connection.execute(
          'UPDATE users SET username = ?, updated_at = NOW() WHERE id = ? AND organization_id = ?',
          [username, userId, organizationId]
        );
      }
    }

    if (!(await indexExists(connection, 'users', 'uk_users_username'))) {
      await connection.query('ALTER TABLE users ADD UNIQUE KEY uk_users_username (username)');
    }

    if (await indexExists(connection, 'organizations', 'uk_organizations_restaurant_code')) {
      await connection.query('ALTER TABLE organizations DROP INDEX uk_organizations_restaurant_code');
    }
    if (await columnExists(connection, 'organizations', 'restaurant_code')) {
      await connection.query('ALTER TABLE organizations DROP COLUMN restaurant_code');
    }
  },
  down: async (connection: PoolConnection): Promise<void> => {
    if (await indexExists(connection, 'users', 'uk_users_username')) {
      await connection.query('ALTER TABLE users DROP INDEX uk_users_username');
    }
    if (await indexExists(connection, 'organizations', 'uk_organizations_handle')) {
      await connection.query('ALTER TABLE organizations DROP INDEX uk_organizations_handle');
    }
    if (await columnExists(connection, 'organizations', 'handle')) {
      await connection.query('ALTER TABLE organizations DROP COLUMN handle');
    }
  },
};
