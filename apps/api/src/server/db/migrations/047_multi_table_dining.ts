import { MigrationDefinition } from './types';

export const migration047MultiTableDining: MigrationDefinition = {
  name: '047_multi_table_dining',
  async up(connection) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS order_tables (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        order_id BIGINT UNSIGNED NOT NULL,
        dining_table_id BIGINT UNSIGNED NOT NULL,
        is_primary BOOLEAN NOT NULL DEFAULT FALSE,
        attached_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        attached_by BIGINT UNSIGNED NULL,
        released_at DATETIME NULL,
        released_by BIGINT UNSIGNED NULL,
        active_dining_table_id BIGINT UNSIGNED
          GENERATED ALWAYS AS (CASE WHEN released_at IS NULL THEN dining_table_id ELSE NULL END) STORED,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_order_tables_order_table (order_id, dining_table_id),
        UNIQUE KEY uq_order_tables_active_table (organization_id, branch_id, active_dining_table_id),
        KEY idx_order_tables_order (organization_id, branch_id, order_id, released_at),
        KEY idx_order_tables_table_history (organization_id, branch_id, dining_table_id, attached_at),
        CONSTRAINT fk_order_tables_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_order_tables_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
        CONSTRAINT fk_order_tables_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
        CONSTRAINT fk_order_tables_table FOREIGN KEY (dining_table_id) REFERENCES dining_tables(id) ON DELETE RESTRICT,
        CONSTRAINT fk_order_tables_attached_by FOREIGN KEY (attached_by) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_order_tables_released_by FOREIGN KEY (released_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Transaction-local staging keyed by the MySQL connection. Rows are inserted
    // and consumed inside the same order transaction, so rollback removes them too.
    await connection.query(`
      CREATE TABLE IF NOT EXISTS pending_order_table_claims (
        connection_id BIGINT UNSIGNED NOT NULL,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        dining_table_id BIGINT UNSIGNED NOT NULL,
        is_primary BOOLEAN NOT NULL DEFAULT FALSE,
        performed_by BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (connection_id, dining_table_id),
        KEY idx_pending_order_table_scope (connection_id, organization_id, branch_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Preserve historical seating while only active orders retain active ownership.
    await connection.query(`
      INSERT INTO order_tables
        (organization_id, branch_id, order_id, dining_table_id, is_primary,
         attached_at, attached_by, released_at, released_by)
      SELECT
        o.organization_id,
        o.branch_id,
        o.id,
        o.dining_table_id,
        CASE WHEN o.order_status IN ('PLACED','PREPARING','READY','SERVED') THEN TRUE ELSE FALSE END,
        o.created_at,
        o.created_by,
        CASE
          WHEN o.order_status = 'COMPLETED' THEN COALESCE(o.completed_at, o.updated_at)
          WHEN o.order_status = 'CANCELLED' THEN COALESCE(o.cancelled_at, o.updated_at)
          WHEN o.order_status = 'MERGED' THEN COALESCE(o.merged_at, o.updated_at)
          ELSE NULL
        END,
        CASE
          WHEN o.order_status = 'COMPLETED' THEN COALESCE(o.completed_by, o.created_by)
          WHEN o.order_status = 'CANCELLED' THEN COALESCE(o.cancelled_by, o.created_by)
          WHEN o.order_status = 'MERGED' THEN COALESCE(o.merged_by, o.created_by)
          ELSE NULL
        END
      FROM orders o
      WHERE o.order_type = 'DINE_IN' AND o.dining_table_id IS NOT NULL
      ON DUPLICATE KEY UPDATE
        is_primary = VALUES(is_primary),
        released_at = VALUES(released_at),
        released_by = VALUES(released_by),
        updated_at = NOW()
    `);

    await connection.query('DROP TRIGGER IF EXISTS trg_orders_order_tables_insert');
    await connection.query(`
      CREATE TRIGGER trg_orders_order_tables_insert
      AFTER INSERT ON orders
      FOR EACH ROW
      BEGIN
        DECLARE staged_count INT DEFAULT 0;

        IF NEW.order_type = 'DINE_IN' AND NEW.dining_table_id IS NOT NULL THEN
          SELECT COUNT(*) INTO staged_count
            FROM pending_order_table_claims
           WHERE connection_id = CONNECTION_ID()
             AND organization_id = NEW.organization_id
             AND branch_id = NEW.branch_id;

          IF staged_count > 0 THEN
            INSERT INTO order_tables
              (organization_id, branch_id, order_id, dining_table_id, is_primary, attached_at, attached_by)
            SELECT
              NEW.organization_id,
              NEW.branch_id,
              NEW.id,
              claim.dining_table_id,
              claim.is_primary,
              NOW(),
              claim.performed_by
            FROM pending_order_table_claims claim
            WHERE claim.connection_id = CONNECTION_ID()
              AND claim.organization_id = NEW.organization_id
              AND claim.branch_id = NEW.branch_id
            ON DUPLICATE KEY UPDATE
              is_primary = VALUES(is_primary),
              released_at = NULL,
              released_by = NULL,
              updated_at = NOW();

            UPDATE dining_tables dt
            JOIN pending_order_table_claims claim
              ON claim.connection_id = CONNECTION_ID()
             AND claim.organization_id = NEW.organization_id
             AND claim.branch_id = NEW.branch_id
             AND claim.dining_table_id = dt.id
               SET dt.status = 'occupied', dt.updated_at = NOW()
             WHERE dt.organization_id = NEW.organization_id
               AND dt.branch_id = NEW.branch_id;

            DELETE FROM pending_order_table_claims
             WHERE connection_id = CONNECTION_ID()
               AND organization_id = NEW.organization_id
               AND branch_id = NEW.branch_id;
          ELSE
            INSERT INTO order_tables
              (organization_id, branch_id, order_id, dining_table_id, is_primary, attached_at, attached_by)
            VALUES
              (NEW.organization_id, NEW.branch_id, NEW.id, NEW.dining_table_id, TRUE, NOW(), NEW.created_by)
            ON DUPLICATE KEY UPDATE
              is_primary = TRUE,
              released_at = NULL,
              released_by = NULL,
              updated_at = NOW();
          END IF;
        END IF;
      END
    `);

    // Terminal order transitions release every physical table owned by the party.
    // Active primary-table changes remain compatible with older single-table code.
    await connection.query('DROP TRIGGER IF EXISTS trg_orders_order_tables_update');
    await connection.query(`
      CREATE TRIGGER trg_orders_order_tables_update
      AFTER UPDATE ON orders
      FOR EACH ROW
      BEGIN
        DECLARE active_table_count INT DEFAULT 0;
        DECLARE new_primary_active INT DEFAULT 0;

        IF NEW.order_status IN ('COMPLETED','CANCELLED','MERGED')
           AND OLD.order_status NOT IN ('COMPLETED','CANCELLED','MERGED') THEN
          UPDATE order_tables
             SET released_at = COALESCE(released_at, NOW()),
                 released_by = COALESCE(released_by, NEW.completed_by, NEW.cancelled_by, NEW.merged_by, NEW.created_by),
                 is_primary = FALSE,
                 updated_at = NOW()
           WHERE order_id = NEW.id AND released_at IS NULL;

          UPDATE dining_tables dt
          JOIN order_tables history
            ON history.dining_table_id = dt.id AND history.order_id = NEW.id
          LEFT JOIN order_tables active_owner
            ON active_owner.organization_id = NEW.organization_id
           AND active_owner.branch_id = NEW.branch_id
           AND active_owner.dining_table_id = dt.id
           AND active_owner.released_at IS NULL
             SET dt.status = CASE
                 WHEN active_owner.id IS NULL AND dt.status = 'occupied' THEN 'available'
                 ELSE dt.status
               END,
                 dt.updated_at = NOW()
           WHERE dt.organization_id = NEW.organization_id
             AND dt.branch_id = NEW.branch_id;

        ELSEIF NEW.order_type = 'DINE_IN'
           AND NEW.dining_table_id IS NOT NULL
           AND NEW.order_status IN ('PLACED','PREPARING','READY','SERVED')
           AND NOT (NEW.dining_table_id <=> OLD.dining_table_id) THEN

          SELECT COUNT(*) INTO active_table_count
            FROM order_tables
           WHERE order_id = NEW.id AND released_at IS NULL;

          SELECT COUNT(*) INTO new_primary_active
            FROM order_tables
           WHERE order_id = NEW.id
             AND dining_table_id = NEW.dining_table_id
             AND released_at IS NULL;

          -- A direct legacy single-table transfer should release the old table.
          -- The modern multi-table sync path attaches the new primary before updating orders,
          -- so new_primary_active is already 1 and no group table is released here.
          IF active_table_count <= 1 AND new_primary_active = 0 THEN
            UPDATE order_tables
               SET released_at = NOW(),
                   released_by = NEW.created_by,
                   is_primary = FALSE,
                   updated_at = NOW()
             WHERE order_id = NEW.id AND released_at IS NULL;
          ELSE
            UPDATE order_tables
               SET is_primary = FALSE, updated_at = NOW()
             WHERE order_id = NEW.id AND released_at IS NULL;
          END IF;

          INSERT INTO order_tables
            (organization_id, branch_id, order_id, dining_table_id, is_primary, attached_at, attached_by, released_at, released_by)
          VALUES
            (NEW.organization_id, NEW.branch_id, NEW.id, NEW.dining_table_id, TRUE, NOW(), NEW.created_by, NULL, NULL)
          ON DUPLICATE KEY UPDATE
            is_primary = TRUE,
            attached_at = IF(released_at IS NULL, attached_at, NOW()),
            attached_by = NEW.created_by,
            released_at = NULL,
            released_by = NULL,
            updated_at = NOW();

          UPDATE dining_tables
             SET status = 'occupied', updated_at = NOW()
           WHERE id = NEW.dining_table_id
             AND organization_id = NEW.organization_id
             AND branch_id = NEW.branch_id;

          IF OLD.dining_table_id IS NOT NULL THEN
            UPDATE dining_tables dt
            LEFT JOIN order_tables active_owner
              ON active_owner.organization_id = NEW.organization_id
             AND active_owner.branch_id = NEW.branch_id
             AND active_owner.dining_table_id = dt.id
             AND active_owner.released_at IS NULL
               SET dt.status = CASE
                   WHEN active_owner.id IS NULL AND dt.status = 'occupied' THEN 'available'
                   ELSE dt.status
                 END,
                   dt.updated_at = NOW()
             WHERE dt.id = OLD.dining_table_id
               AND dt.organization_id = NEW.organization_id
               AND dt.branch_id = NEW.branch_id;
          END IF;
        END IF;
      END
    `);
  },

  async down(connection) {
    await connection.query('DROP TRIGGER IF EXISTS trg_orders_order_tables_update');
    await connection.query('DROP TRIGGER IF EXISTS trg_orders_order_tables_insert');
    await connection.query('DROP TABLE IF EXISTS pending_order_table_claims');
    await connection.query('DROP TABLE IF EXISTS order_tables');
  },
};
