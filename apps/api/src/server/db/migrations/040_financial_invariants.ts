import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { MigrationDefinition } from './types';

async function constraintExists(connection: PoolConnection, table: string, name: string): Promise<boolean> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS count
       FROM information_schema.table_constraints
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND constraint_name = ?`,
    [table, name]
  );
  return Number(rows[0]?.count || 0) > 0;
}

async function indexExists(connection: PoolConnection, table: string, name: string): Promise<boolean> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS count
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND index_name = ?`,
    [table, name]
  );
  return Number(rows[0]?.count || 0) > 0;
}

async function assertNoDuplicateSplitSequences(connection: PoolConnection): Promise<void> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT organization_id, branch_id, split_batch_id, split_sequence, COUNT(*) AS duplicate_count
       FROM bills
      WHERE split_batch_id IS NOT NULL
        AND split_sequence IS NOT NULL
      GROUP BY organization_id, branch_id, split_batch_id, split_sequence
     HAVING COUNT(*) > 1
      LIMIT 1`
  );
  if (rows.length) {
    const row = rows[0];
    throw new Error(
      `Cannot enforce split-bill sequence uniqueness: duplicate sequence ${String(row.split_sequence)} exists in split batch ${String(row.split_batch_id)}`
    );
  }
}

export const migration040FinancialInvariants: MigrationDefinition = {
  name: '040_financial_invariants',
  up: async (connection: PoolConnection): Promise<void> => {
    // These checks mirror invariants already enforced by the billing/payment services.
    // The database now rejects impossible financial rows even if a future code path
    // accidentally bypasses application validation.
    const checks: Array<[string, string, string]> = [
      ['orders', 'chk_orders_nonnegative_totals', 'subtotal >= 0 AND discount >= 0 AND taxable_amount >= 0 AND tax >= 0 AND grand_total >= 0'],
      ['bills', 'chk_bills_nonnegative_totals', 'subtotal >= 0 AND discount_total >= 0 AND taxable_amount >= 0 AND tax_total >= 0 AND grand_total >= 0'],
      ['bills', 'chk_bills_payment_bounds', 'amount_paid >= 0 AND balance_due >= 0 AND amount_paid <= grand_total AND balance_due <= grand_total'],
      ['bill_lines', 'chk_bill_lines_positive_quantity', 'quantity > 0'],
      ['bill_lines', 'chk_bill_lines_nonnegative_money', 'unit_price >= 0 AND line_subtotal >= 0 AND discount_amount >= 0 AND taxable_amount >= 0 AND tax_amount >= 0 AND line_total >= 0'],
      ['payments', 'chk_payments_positive_amount', 'amount > 0'],
      ['payments', 'chk_payments_nonnegative_change', 'change_amount >= 0'],
      ['payments', 'chk_payments_tender_bounds', 'tender_amount IS NULL OR tender_amount >= amount'],
      ['bill_split_batches', 'chk_split_batch_nonnegative_totals', 'source_subtotal >= 0 AND source_discount >= 0 AND source_taxable_amount >= 0 AND source_tax >= 0 AND source_grand_total >= 0'],
    ];

    for (const [table, name, expression] of checks) {
      if (!(await constraintExists(connection, table, name))) {
        await connection.query(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`${name}\` CHECK (${expression})`);
      }
    }

    // Multiple split bills are valid, but the sequence number must be unique inside
    // one split batch. NULL split columns remain valid for ordinary unsplit bills.
    if (!(await indexExists(connection, 'bills', 'uk_bills_split_sequence'))) {
      await assertNoDuplicateSplitSequences(connection);
      await connection.query(
        `CREATE UNIQUE INDEX uk_bills_split_sequence
           ON bills (organization_id, branch_id, split_batch_id, split_sequence)`
      );
    }
  },
  down: async (connection: PoolConnection): Promise<void> => {
    if (await indexExists(connection, 'bills', 'uk_bills_split_sequence')) {
      await connection.query('ALTER TABLE bills DROP INDEX uk_bills_split_sequence');
    }

    const checks: Array<[string, string]> = [
      ['bill_split_batches', 'chk_split_batch_nonnegative_totals'],
      ['payments', 'chk_payments_tender_bounds'],
      ['payments', 'chk_payments_nonnegative_change'],
      ['payments', 'chk_payments_positive_amount'],
      ['bill_lines', 'chk_bill_lines_nonnegative_money'],
      ['bill_lines', 'chk_bill_lines_positive_quantity'],
      ['bills', 'chk_bills_payment_bounds'],
      ['bills', 'chk_bills_nonnegative_totals'],
      ['orders', 'chk_orders_nonnegative_totals'],
    ];

    for (const [table, name] of checks) {
      if (await constraintExists(connection, table, name)) {
        await connection.query(`ALTER TABLE \`${table}\` DROP CHECK \`${name}\``);
      }
    }
  },
};
