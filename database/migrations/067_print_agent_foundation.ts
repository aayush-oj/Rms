import type { MigrationDefinition } from './types';

export const migration067PrintAgentFoundation: MigrationDefinition = {
  name: "067_print_agent_foundation",
  up: async (connection) => {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS print_agents (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        device_id VARCHAR(120) NOT NULL,
        credential_hash CHAR(64) NOT NULL,
        agent_version VARCHAR(80) NULL,
        last_seen_at DATETIME NULL,
        last_connected_at DATETIME NULL,
        last_disconnected_at DATETIME NULL,
        revoked_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,

        UNIQUE KEY uq_print_agents_device_id (device_id),
        INDEX idx_print_agents_scope (
          organization_id,
          branch_id,
          revoked_at,
          last_seen_at
        ),

        CONSTRAINT chk_print_agents_credential_hash
          CHECK (CHAR_LENGTH(credential_hash) = 64),

        CONSTRAINT fk_print_agents_org
          FOREIGN KEY (organization_id)
          REFERENCES organizations(id)
          ON DELETE CASCADE,
        CONSTRAINT fk_print_agents_branch
          FOREIGN KEY (branch_id)
          REFERENCES branches(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  },
  down: async (connection) => {
    await connection.query("DROP TABLE IF EXISTS print_agents");
  }
};
