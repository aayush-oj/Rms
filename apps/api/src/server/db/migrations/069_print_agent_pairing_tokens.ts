import type { MigrationDefinition } from './types';

export const migration069PrintAgentPairingTokens: MigrationDefinition = {
  name: "069_print_agent_pairing_tokens",
  up: async (connection) => {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS print_agent_pairing_tokens (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        agent_id BIGINT UNSIGNED NULL,
        device_id VARCHAR(120) NOT NULL,
        purpose ENUM('PAIR', 'ROTATE') NOT NULL,
        token_hash CHAR(64) NOT NULL,
        expires_at DATETIME NOT NULL,
        consumed_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

        UNIQUE KEY uq_print_agent_pairing_token_hash (token_hash),
        INDEX idx_print_agent_pairing_scope (
          organization_id,
          branch_id,
          consumed_at,
          expires_at
        ),
        INDEX idx_print_agent_pairing_device (
          device_id,
          purpose,
          consumed_at,
          expires_at
        ),

        CONSTRAINT chk_print_agent_pairing_token_hash
          CHECK (CHAR_LENGTH(token_hash) = 64),

        CONSTRAINT fk_print_agent_pairing_org
          FOREIGN KEY (organization_id)
          REFERENCES organizations(id)
          ON DELETE CASCADE,
        CONSTRAINT fk_print_agent_pairing_branch
          FOREIGN KEY (branch_id)
          REFERENCES branches(id)
          ON DELETE CASCADE,
        CONSTRAINT fk_print_agent_pairing_agent
          FOREIGN KEY (agent_id)
          REFERENCES print_agents(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  },
  down: async (connection) => {
    await connection.query("DROP TABLE IF EXISTS print_agent_pairing_tokens");
  }
};
