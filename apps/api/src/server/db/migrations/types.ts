import type { PoolConnection } from 'mysql2/promise';

export interface MigrationDefinition {
  name: string;
  up: (connection: PoolConnection) => Promise<void>;
  down?: (connection: PoolConnection) => Promise<void>;
}

export interface AppliedMigrationRecord {
  id: number;
  name: string;
  checksum: string | null;
  batch: number;
  applied_at: string | Date;
}

export interface MigrationStatusReport {
  initialized: boolean;
  totalRegistered: number;
  totalApplied: number;
  pendingCount: number;
  applied: AppliedMigrationRecord[];
  pending: string[];
}
