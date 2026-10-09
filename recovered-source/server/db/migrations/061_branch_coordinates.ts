import type { PoolConnection } from 'mysql2/promise';
import type { MigrationDefinition } from './types';

async function columnExists(
  connection: PoolConnection,
  table: string,
  column: string,
): Promise<boolean> {
  const [rows] = await connection.query<any[]>(
    `SHOW COLUMNS FROM \`${table}\` LIKE ?`,
    [column],
  );
  return rows.length > 0;
}

async function constraintExists(
  connection: PoolConnection,
  name: string,
): Promise<boolean> {
  const [rows] = await connection.query<any[]>(
    `SELECT 1
       FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND TABLE_NAME = 'branches'
        AND CONSTRAINT_NAME = ?
      LIMIT 1`,
    [name],
  );
  return rows.length > 0;
}

export const migration061BranchCoordinates: MigrationDefinition = {
  name: '061_branch_coordinates',

  up: async (connection: PoolConnection): Promise<void> => {
    if (!(await columnExists(connection, 'branches', 'latitude'))) {
      await connection.query(
        'ALTER TABLE branches ADD COLUMN latitude DECIMAL(9,6) NULL AFTER address',
      );
    }

    if (!(await columnExists(connection, 'branches', 'longitude'))) {
      await connection.query(
        'ALTER TABLE branches ADD COLUMN longitude DECIMAL(9,6) NULL AFTER latitude',
      );
    }

    if (!(await constraintExists(connection, 'chk_branches_latitude_range'))) {
      await connection.query(
        `ALTER TABLE branches
           ADD CONSTRAINT chk_branches_latitude_range
           CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90))`,
      );
    }

    if (!(await constraintExists(connection, 'chk_branches_longitude_range'))) {
      await connection.query(
        `ALTER TABLE branches
           ADD CONSTRAINT chk_branches_longitude_range
           CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180))`,
      );
    }

    if (!(await constraintExists(connection, 'chk_branches_coordinate_pair'))) {
      await connection.query(
        `ALTER TABLE branches
           ADD CONSTRAINT chk_branches_coordinate_pair
           CHECK (
             (latitude IS NULL AND longitude IS NULL)
             OR
             (latitude IS NOT NULL AND longitude IS NOT NULL)
           )`,
      );
    }
  },

  down: async (connection: PoolConnection): Promise<void> => {
    if (await constraintExists(connection, 'chk_branches_coordinate_pair')) {
      await connection.query(
        'ALTER TABLE branches DROP CHECK chk_branches_coordinate_pair',
      );
    }
    if (await constraintExists(connection, 'chk_branches_longitude_range')) {
      await connection.query(
        'ALTER TABLE branches DROP CHECK chk_branches_longitude_range',
      );
    }
    if (await constraintExists(connection, 'chk_branches_latitude_range')) {
      await connection.query(
        'ALTER TABLE branches DROP CHECK chk_branches_latitude_range',
      );
    }
    if (await columnExists(connection, 'branches', 'longitude')) {
      await connection.query('ALTER TABLE branches DROP COLUMN longitude');
    }
    if (await columnExists(connection, 'branches', 'latitude')) {
      await connection.query('ALTER TABLE branches DROP COLUMN latitude');
    }
  },
};
