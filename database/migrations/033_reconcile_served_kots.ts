import { PoolConnection } from 'mysql2/promise';
import { MigrationDefinition } from './types';

export const migration033ReconcileServedKots: MigrationDefinition = {
  name: '033_reconcile_served_kots',
  up: async (connection: PoolConnection): Promise<void> => {
    await connection.execute(`
      UPDATE kitchen_tickets kt
      JOIN orders o
        ON o.id = kt.order_id
       AND o.organization_id = kt.organization_id
       AND o.branch_id = kt.branch_id
      SET kt.ticket_status = 'COMPLETED',
          kt.updated_at = NOW()
      WHERE kt.ticket_status = 'READY'
        AND o.order_status IN ('SERVED', 'COMPLETED')
    `);
  },
};
