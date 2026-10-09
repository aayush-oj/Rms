import { PoolConnection } from 'mysql2/promise';
import { MigrationDefinition } from './types';

export const migration005TableAllocations: MigrationDefinition = {
  name: '005_table_allocations',
  up: async (connection: PoolConnection): Promise<void> => {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS table_allocations (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        dining_table_id BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

        -- Generated column for unique active allocation constraint
        active_key INT GENERATED ALWAYS AS (IF(is_active, 1, NULL)) STORED,

        -- Foreign keys
        CONSTRAINT fk_table_alloc_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_table_alloc_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
        CONSTRAINT fk_table_alloc_table FOREIGN KEY (dining_table_id) REFERENCES dining_tables(id) ON DELETE CASCADE,
        CONSTRAINT fk_table_alloc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_table_alloc_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,

        -- Database-enforced uniqueness: only one active allocation per table per branch
        -- MySQL allows multiple NULLs in unique indexes, so inactive rows (active_key=NULL) don't conflict
        UNIQUE KEY uk_table_branch_active (dining_table_id, branch_id, active_key),

        -- Indexes for common queries
        INDEX idx_table_alloc_org (organization_id),
        INDEX idx_table_alloc_branch (organization_id, branch_id),
        INDEX idx_table_alloc_user (organization_id, user_id),
        INDEX idx_table_alloc_table (dining_table_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  },
  down: async (connection: PoolConnection): Promise<void> => {
    await connection.query('DROP TABLE IF EXISTS table_allocations;');
  },
};
