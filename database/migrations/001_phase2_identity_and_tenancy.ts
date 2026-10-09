import { PoolConnection } from 'mysql2/promise';
import { MigrationDefinition } from './types';

export const migration001Phase2IdentityAndTenancy: MigrationDefinition = {
  name: '001_phase2_identity_and_tenancy',
  up: async (connection: PoolConnection): Promise<void> => {
    // 1. Organizations
    await connection.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        legal_name VARCHAR(200) NULL,
        tax_identifier VARCHAR(50) NULL COMMENT 'PAN, VAT, or GST Number',
        currency_code VARCHAR(3) NOT NULL DEFAULT 'NPR' COMMENT 'ISO 4217 Currency Code',
        status ENUM('ACTIVE', 'SUSPENDED', 'PENDING') NOT NULL DEFAULT 'ACTIVE',
        settings JSON NULL COMMENT 'Tenant organization-level configurations',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 2. Branches
    await connection.query(`
      CREATE TABLE IF NOT EXISTS branches (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(150) NOT NULL,
        code VARCHAR(20) NOT NULL COMMENT 'Branch code like KTM-01',
        address TEXT NULL,
        phone VARCHAR(50) NULL,
        email VARCHAR(100) NULL,
        bill_prefix VARCHAR(10) NOT NULL DEFAULT 'FH-',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_org_branch_code (organization_id, code),
        INDEX idx_branch_org (organization_id),
        CONSTRAINT fk_branches_organization FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 3. Roles
    await connection.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NULL COMMENT 'NULL for global system roles',
        name VARCHAR(50) NOT NULL,
        description VARCHAR(255) NULL,
        is_system BOOLEAN NOT NULL DEFAULT FALSE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_role_org_name (organization_id, name),
        INDEX idx_roles_org (organization_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 4. Permissions
    await connection.query(`
      CREATE TABLE IF NOT EXISTS permissions (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(100) NOT NULL UNIQUE,
        module VARCHAR(50) NOT NULL,
        description VARCHAR(255) NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 5. Role Permissions
    await connection.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id BIGINT UNSIGNED NOT NULL,
        permission_id BIGINT UNSIGNED NOT NULL,
        PRIMARY KEY (role_id, permission_id),
        CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
        CONSTRAINT fk_rp_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 6. Users
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        default_branch_id BIGINT UNSIGNED NOT NULL,
        role_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(100) NOT NULL,
        username VARCHAR(100) NOT NULL,
        email VARCHAR(150) NULL,
        password_hash VARCHAR(255) NULL COMMENT 'Bcrypt password hash for web login',
        pin_hash VARCHAR(255) NULL COMMENT 'Bcrypt hash of 4-digit POS terminal PIN',
        avatar_url VARCHAR(255) NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_org_username (organization_id, username),
        INDEX idx_users_org_branch (organization_id, default_branch_id),
        CONSTRAINT fk_users_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
        CONSTRAINT fk_users_branch FOREIGN KEY (default_branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 7. User Branches (Many-to-Many cross-branch assignment)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_branches (
        user_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        organization_id BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, branch_id),
        INDEX idx_ub_org (organization_id),
        CONSTRAINT fk_ub_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_ub_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
        CONSTRAINT fk_ub_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 8. Sessions (Token revocations & tracking)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        token_id VARCHAR(100) NOT NULL UNIQUE,
        user_id BIGINT UNSIGNED NOT NULL,
        organization_id BIGINT UNSIGNED NOT NULL,
        is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
        expires_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        revoked_at DATETIME NULL,
        INDEX idx_sessions_user (user_id),
        INDEX idx_sessions_token (token_id),
        CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_sessions_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  },

  down: async (connection: PoolConnection): Promise<void> => {
    await connection.query('DROP TABLE IF EXISTS sessions;');
    await connection.query('DROP TABLE IF EXISTS user_branches;');
    await connection.query('DROP TABLE IF EXISTS users;');
    await connection.query('DROP TABLE IF EXISTS role_permissions;');
    await connection.query('DROP TABLE IF EXISTS permissions;');
    await connection.query('DROP TABLE IF EXISTS roles;');
    await connection.query('DROP TABLE IF EXISTS branches;');
    await connection.query('DROP TABLE IF EXISTS organizations;');
  },
};
