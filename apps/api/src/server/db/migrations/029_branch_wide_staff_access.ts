import { MigrationDefinition } from './types';

/**
 * Room/table access rows previously acted as hard authorization filters.
 * The RMS now treats branch access as the staff security boundary while
 * waiter/table assignment remains an operational responsibility signal.
 */
export const migration029BranchWideStaffAccess: MigrationDefinition = {
  name: '029_branch_wide_staff_access',
  async up(connection) {
    await connection.query('DELETE FROM user_table_access');
    await connection.query('DELETE FROM user_section_access');
  },
  async down() {
    // Previous per-table/per-section restrictions cannot be reconstructed safely.
    // A rollback preserves branch-wide access rather than inventing authorization data.
  },
};