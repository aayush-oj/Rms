import { fnbReport, fnbOptions, fnbPeriod, FnbFilters } from './fnb';
import { occupancyReport } from './occupancy';
import { RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { ReportFilters, REPORT_METRICS } from './types';

const n = (v: unknown) => Number(v || 0);
const money = (v: unknown) => Math.round((n(v) + Number.EPSILON) * 10000) / 10000;

interface Scope { organizationId: number; branchIds: number[]; }

function inClause(ids: number[]): string { return ids.map(() => '?').join(','); }

function financialWhere(scope: Scope, filters: ReportFilters, alias = 'b') {
  const clauses = [`${alias}.organization_id = ?`, `${alias}.branch_id IN (${inClause(scope.branchIds)})`];
  const params: (string | number)[] = [scope.organizationId, ...scope.branchIds];
  if (filters.businessDayId) { clauses.push(`${alias}.business_day_id = ?`); params.push(filters.businessDayId); }
  if (filters.from) { clauses.push(`${alias}.business_date >= ?`); params.push(filters.from); }
  if (filters.to) { clauses.push(`${alias}.business_date <= ?`); params.push(filters.to); }
  if (filters.shiftId) { clauses.push(`${alias}.shift_id = ?`); params.push(filters.shiftId); }
  if (filters.registerId) { clauses.push(`${alias}.register_id = ?`); params.push(filters.registerId); }
  return { clauses, params };
}

export class ReportsRepository {
  private pool() { return getDatabasePool(); }

  async currentBusinessDay(scope: Scope) {
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT id, branch_id, business_date, status, opened_at FROM business_days
       WHERE organization_id = ? AND branch_id IN (${inClause(scope.branchIds)}) AND status = 'OPEN'
       ORDER BY opened_at DESC LIMIT 1`, [scope.organizationId, ...scope.branchIds]
    );
    return rows[0] ? { id: n(rows[0].id), branchId: n(rows[0].branch_id), businessDate: String(rows[0].business_date), status: String(rows[0].status) } : null;
  }

  async dashboard(scope: Scope, filters: ReportFilters) {
    const effective = { ...filters };
    let businessDay: { id: number; branchId: number; businessDate: string; status: string } | null = null;

    if (!effective.businessDayId && !effective.from && !effective.to) {
      businessDay = await this.currentBusinessDay(scope);
      effective.businessDayId = businessDay?.id ?? -1;
    }

    const salesWhere = financialWhere(scope, effective);
    salesWhere.clauses.push("b.status = 'FINALIZED'");
    if (effective.orderType) {
      salesWhere.clauses.push('o.order_type = ?');
      salesWhere.params.push(effective.orderType);
    }
    if (effective.staffId) {
      salesWhere.clauses.push('(o.waiter_id = ? OR b.finalized_by = ?)');
      salesWhere.params.push(effective.staffId, effective.staffId);
    }
    const salesSql = salesWhere.clauses.join(' AND ');

    const [summaryRows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(b.subtotal),0) gross_sales,
              COALESCE(SUM(b.discount_total),0) discounts,
              COALESCE(SUM(b.subtotal-b.discount_total),0) net_sales,
              COALESCE(SUM(b.tax_total),0) tax,
              COALESCE(SUM(b.rounding_delta),0) rounding,
              COALESCE(SUM(b.grand_total),0) grand_total,
              COUNT(*) bill_count,
              COUNT(DISTINCT b.order_id) order_count
         FROM bills b
         JOIN orders o ON o.id=b.order_id
        WHERE ${salesSql}`,
      salesWhere.params,
    );
    const summary = summaryRows[0] ?? ({} as RowDataPacket);
    const billCount = n(summary.bill_count);
    const orderCount = n(summary.order_count);
    const grandTotal = money(summary.grand_total);

    const [trendRows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(COALESCE(b.finalized_at,b.created_at),'%Y-%m-%d %H:00') period,
              SUM(b.subtotal-b.discount_total) net_sales,
              SUM(b.grand_total) grand_total,
              COUNT(*) bill_count
         FROM bills b
         JOIN orders o ON o.id=b.order_id
        WHERE ${salesSql}
        GROUP BY period
        ORDER BY period`,
      salesWhere.params,
    );

    const billWhere = financialWhere(scope, effective);
    billWhere.clauses.push("b.status = 'FINALIZED'");

    const [topItemRows, opsRows, tableRows] = await Promise.all([
      this.pool().execute<RowDataPacket[]>(
        `SELECT bl.menu_item_id item_id,
                bl.item_name_snapshot item,
                SUM(bl.quantity) quantity,
                SUM(bl.line_subtotal - bl.discount_amount) net_sales
           FROM bill_lines bl
           JOIN bills b ON b.id = bl.bill_id
             AND b.organization_id = bl.organization_id
             AND b.branch_id = bl.branch_id
          WHERE ${billWhere.clauses.join(' AND ')}
          GROUP BY bl.menu_item_id, bl.item_name_snapshot
          ORDER BY net_sales DESC, quantity DESC, item
          LIMIT 5`,
        billWhere.params
      ),
      this.pool().execute<RowDataPacket[]>(
        `SELECT
           SUM(CASE WHEN order_status IN ('PLACED','PREPARING','READY','SERVED') THEN 1 ELSE 0 END) active_orders,
           SUM(CASE WHEN order_status = 'READY' THEN 1 ELSE 0 END) ready_orders
         FROM orders
         WHERE organization_id = ?
           AND branch_id IN (${inClause(scope.branchIds)})
           ${effective.businessDayId ? 'AND business_day_id = ?' : ''}`,
        [scope.organizationId, ...scope.branchIds, ...(effective.businessDayId ? [effective.businessDayId] : [])]
      ),
      this.pool().execute<RowDataPacket[]>(
        `SELECT
           COUNT(*) total_tables,
           SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) occupied_tables,
           SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) available_tables
         FROM dining_tables
         WHERE organization_id = ?
           AND branch_id IN (${inClause(scope.branchIds)})
           AND is_active = TRUE
           AND status <> 'disabled'`,
        [scope.organizationId, ...scope.branchIds]
      ),
    ]);

    const ops = opsRows[0]?.[0] ?? ({} as RowDataPacket);
    const tables = tableRows[0]?.[0] ?? ({} as RowDataPacket);

    return {
      scope: {
        branchIds: scope.branchIds,
        businessDayId: effective.businessDayId ?? null,
      },
      businessDay,
      metrics: {
        netSales: money(summary.net_sales),
        orders: orderCount,
        averageBill: billCount ? money(grandTotal / billCount) : 0,
        activeOrders: n(ops.active_orders),
        readyOrders: n(ops.ready_orders),
        totalTables: n(tables.total_tables),
        occupiedTables: n(tables.occupied_tables),
        availableTables: n(tables.available_tables),
      },
      salesTrend: trendRows.map((row) => {
        const period = String(row.period);
        return {
          period: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(period) ? period.slice(11) : period,
          netSales: money(row.net_sales),
          grandTotal: money(row.grand_total),
          billCount: n(row.bill_count),
        };
      }),
      topItems: topItemRows[0].map((row) => ({
        itemId: row.item_id == null ? null : n(row.item_id),
        item: String(row.item),
        quantity: n(row.quantity),
        netSales: money(row.net_sales),
      })),
      metricDefinitions: REPORT_METRICS,
    };
  }

  async sales(scope: Scope, filters: ReportFilters) {
    const w = financialWhere(scope, filters);
    w.clauses.push(`b.status = 'FINALIZED'`);
    if (filters.orderType) { w.clauses.push('o.order_type = ?'); w.params.push(filters.orderType); }
    if (filters.staffId) { w.clauses.push('(o.waiter_id = ? OR b.finalized_by = ?)'); w.params.push(filters.staffId, filters.staffId); }
    const where = w.clauses.join(' AND ');
    const [summaryRows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(b.subtotal),0) gross_sales, COALESCE(SUM(b.discount_total),0) discounts,
        COALESCE(SUM(b.subtotal-b.discount_total),0) net_sales, COALESCE(SUM(b.tax_total),0) tax,
        COALESCE(SUM(b.rounding_delta),0) rounding,
        COALESCE(SUM(b.grand_total),0) grand_total, COUNT(*) bill_count, COUNT(DISTINCT b.order_id) order_count
       FROM bills b JOIN orders o ON o.id=b.order_id WHERE ${where}`, w.params
    );
    const s = summaryRows[0];
    const billCount = n(s.bill_count), orderCount = n(s.order_count), grand = money(s.grand_total);
    const grouping = filters.grouping || 'day';
    const groupExpr = grouping === 'hour' ? `DATE_FORMAT(COALESCE(b.finalized_at,b.created_at),'%Y-%m-%d %H:00')`
      : grouping === 'week' ? `DATE_FORMAT(DATE_SUB(b.business_date, INTERVAL WEEKDAY(b.business_date) DAY),'%Y-%m-%d')`
      : grouping === 'month' ? `DATE_FORMAT(b.business_date,'%Y-%m')` : `DATE_FORMAT(b.business_date,'%Y-%m-%d')`;
    const [trendRows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT ${groupExpr} period, SUM(b.subtotal-b.discount_total) net_sales, SUM(b.grand_total) grand_total, COUNT(*) bill_count
       FROM bills b JOIN orders o ON o.id=b.order_id WHERE ${where} GROUP BY period ORDER BY period`, w.params
    );

    const paymentWhere = financialWhere(scope, filters);
    paymentWhere.clauses.push(`b.status = 'FINALIZED'`, `p.status = 'CAPTURED'`);
    if (filters.orderType) { paymentWhere.clauses.push('o.order_type = ?'); paymentWhere.params.push(filters.orderType); }
    if (filters.staffId) { paymentWhere.clauses.push('(o.waiter_id = ? OR b.finalized_by = ?)'); paymentWhere.params.push(filters.staffId, filters.staffId); }

    const [orderTypeRows, topItemRows, paymentRows] = await Promise.all([
      this.pool().execute<RowDataPacket[]>(
        `SELECT o.order_type,
                COUNT(DISTINCT b.order_id) order_count,
                COUNT(*) bill_count,
                COALESCE(SUM(b.subtotal-b.discount_total),0) net_sales,
                COALESCE(SUM(b.grand_total),0) grand_total
           FROM bills b
           JOIN orders o ON o.id=b.order_id
          WHERE ${where}
          GROUP BY o.order_type
          ORDER BY net_sales DESC`,
        w.params
      ),
      this.pool().execute<RowDataPacket[]>(
        `SELECT bl.menu_item_id item_id,
                bl.item_name_snapshot item,
                COALESCE(SUM(bl.quantity),0) quantity,
                COALESCE(SUM(bl.line_subtotal-bl.discount_amount),0) net_sales
           FROM bill_lines bl
           JOIN bills b ON b.id=bl.bill_id
           JOIN orders o ON o.id=b.order_id
          WHERE ${where}
          GROUP BY bl.menu_item_id, bl.item_name_snapshot
          ORDER BY net_sales DESC, quantity DESC, item
          LIMIT 8`,
        w.params
      ),
      this.pool().execute<RowDataPacket[]>(
        `SELECT pm.id payment_method_id,
                pm.name,
                pm.code,
                pm.type,
                COUNT(*) transaction_count,
                COALESCE(SUM(p.amount),0) amount
           FROM payments p
           JOIN bills b ON b.id=p.bill_id
             AND b.organization_id=p.organization_id
             AND b.branch_id=p.branch_id
           JOIN orders o ON o.id=b.order_id
           JOIN payment_methods pm ON pm.id=p.payment_method_id
             AND pm.organization_id=p.organization_id
          WHERE ${paymentWhere.clauses.join(' AND ')}
          GROUP BY pm.id,pm.name,pm.code,pm.type
          ORDER BY amount DESC`,
        paymentWhere.params
      ),
    ]);

    const netSales = money(s.net_sales);
    const paymentTotal = paymentRows[0].reduce((sum, row) => sum + n(row.amount), 0);
    return {
      summary: { grossSales: money(s.gross_sales), discounts: money(s.discounts), netSales, tax: money(s.tax), rounding: money(s.rounding), grandTotal: grand, billCount, orderCount, averageBill: billCount ? money(grand / billCount) : 0, averageOrderValue: orderCount ? money(grand / orderCount) : 0 },
      trend: trendRows.map(r => ({ period: String(r.period), netSales: money(r.net_sales), grandTotal: money(r.grand_total), billCount: n(r.bill_count) })),
      orderTypeMix: orderTypeRows[0].map(row => ({
        orderType: String(row.order_type),
        orderCount: n(row.order_count),
        billCount: n(row.bill_count),
        netSales: money(row.net_sales),
        grandTotal: money(row.grand_total),
        contributionPercent: netSales ? money(n(row.net_sales) * 100 / netSales) : 0,
      })),
      topItems: topItemRows[0].map(row => ({
        itemId: row.item_id == null ? null : n(row.item_id),
        item: String(row.item),
        quantity: n(row.quantity),
        netSales: money(row.net_sales),
        contributionPercent: netSales ? money(n(row.net_sales) * 100 / netSales) : 0,
      })),
      paymentMix: paymentRows[0].map(row => ({
        paymentMethodId: n(row.payment_method_id),
        name: String(row.name),
        code: String(row.code),
        type: String(row.type),
        transactionCount: n(row.transaction_count),
        amount: money(row.amount),
        percentage: paymentTotal ? money(n(row.amount) * 100 / paymentTotal) : 0,
      })),
      metricDefinitions: REPORT_METRICS,
    };
  }

  async fnb(scope: Scope, filters: FnbFilters, includeCosts = false) {
    return fnbReport(this.pool(), scope, filters, includeCosts);
  }

  async fnbOptions(scope: Scope) { return fnbOptions(this.pool(), scope); }
  async fnbPeriod(scope: Scope, filters: FnbFilters) { return fnbPeriod(this.pool(), scope, filters); }

  async departments(scope: Scope, filters: ReportFilters, includeCosts = false) {
    const w = financialWhere(scope, filters); w.clauses.push(`b.status='FINALIZED'`);
    if (filters.departmentId) { w.clauses.push('COALESCE(bl.department_id_snapshot,mi.department_id)=?'); w.params.push(filters.departmentId); }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT COALESCE(bl.department_id_snapshot,mi.department_id) department_id,
        COALESCE(bl.department_name_snapshot,d.name,'Unassigned') department,
        COUNT(DISTINCT b.order_id) orders, SUM(bl.quantity) items_sold,
        SUM(bl.line_subtotal-bl.discount_amount) net_sales, SUM(bl.discount_amount) discounts,
        SUM(COALESCE(rs.total_cost_snapshot,0) * (bl.quantity/NULLIF(oi.quantity,0))) recipe_cost
       FROM bill_lines bl JOIN bills b ON b.id=bl.bill_id LEFT JOIN menu_items mi ON mi.id=bl.menu_item_id
       LEFT JOIN departments d ON d.id=COALESCE(bl.department_id_snapshot,mi.department_id)
       LEFT JOIN order_items oi ON oi.id=bl.order_item_id LEFT JOIN order_item_recipe_snapshots rs ON rs.order_item_id=bl.order_item_id
       WHERE ${w.clauses.join(' AND ')} GROUP BY COALESCE(bl.department_id_snapshot,mi.department_id), COALESCE(bl.department_name_snapshot,d.name,'Unassigned') ORDER BY net_sales DESC`, w.params
    );
    const total = rows.reduce((sum,r)=>sum+n(r.net_sales),0);
    return { rows: rows.map(r=>({ departmentId:r.department_id==null?null:n(r.department_id), department:String(r.department), orders:n(r.orders), itemsSold:n(r.items_sold), netSales:money(r.net_sales), contributionPercent:total?money(n(r.net_sales)*100/total):0, averageItemValue:n(r.items_sold)?money(n(r.net_sales)/n(r.items_sold)):0, discounts:money(r.discounts), ...(includeCosts ? { theoreticalRecipeCost:money(r.recipe_cost), grossMargin:money(n(r.net_sales)-n(r.recipe_cost)) } : {}) })), totalNetSales: money(total) };
  }

  async staff(scope: Scope, filters: ReportFilters) {
    const branchSql = `o.organization_id=? AND o.branch_id IN (${inClause(scope.branchIds)})`;
    const params: (string | number)[] = [scope.organizationId,...scope.branchIds];
    const clauses=[branchSql,`b.status='FINALIZED'`];
    if(filters.businessDayId){clauses.push('b.business_day_id=?');params.push(filters.businessDayId);} if(filters.from){clauses.push('b.business_date>=?');params.push(filters.from);} if(filters.to){clauses.push('b.business_date<=?');params.push(filters.to);} if(filters.staffId){clauses.push('o.waiter_id=?');params.push(filters.staffId);}
    const [waiters]=await this.pool().execute<RowDataPacket[]>(`SELECT u.id staff_id,u.name staff,r.name role,COUNT(DISTINCT o.id) orders,COUNT(DISTINCT o.dining_table_id) tables,COALESCE(SUM(b.grand_total),0) sales,COALESCE(SUM(b.discount_total),0) discounts FROM orders o JOIN bills b ON b.order_id=o.id LEFT JOIN users u ON u.id=o.waiter_id LEFT JOIN roles r ON r.id=u.role_id WHERE ${clauses.join(' AND ')} AND o.waiter_id IS NOT NULL GROUP BY u.id,u.name,r.name ORDER BY sales DESC`,params);
    const payW=financialWhere(scope,filters,'p'); const payClauses=[...payW.clauses,`p.status='CAPTURED'`]; if(filters.staffId){payClauses.push('p.created_by=?');payW.params.push(filters.staffId);} const [cashiers]=await this.pool().execute<RowDataPacket[]>(`SELECT u.id staff_id,u.name staff,r.name role,COUNT(*) payment_count,COUNT(DISTINCT p.bill_id) bills_settled,SUM(p.amount) payment_amount,SUM(CASE WHEN pm.type='CASH' THEN p.amount ELSE 0 END) cash_collected,SUM(CASE WHEN pm.type<>'CASH' THEN p.amount ELSE 0 END) non_cash_collected FROM payments p JOIN payment_methods pm ON pm.id=p.payment_method_id JOIN users u ON u.id=p.created_by LEFT JOIN roles r ON r.id=u.role_id WHERE ${payClauses.join(' AND ')} GROUP BY u.id,u.name,r.name ORDER BY payment_amount DESC`,payW.params);
    return { waiters: waiters.map(r=>({staffId:n(r.staff_id),staff:String(r.staff),role:String(r.role||''),orders:n(r.orders),tables:n(r.tables),sales:money(r.sales),averageBill:n(r.orders)?money(n(r.sales)/n(r.orders)):0,discounts:money(r.discounts)})), cashiers: cashiers.map(r=>({staffId:n(r.staff_id),staff:String(r.staff),role:String(r.role||''),billsSettled:n(r.bills_settled),paymentCount:n(r.payment_count),paymentAmount:money(r.payment_amount),cashCollected:money(r.cash_collected),nonCashCollected:money(r.non_cash_collected)})) };
  }

  async occupancy(scope: Scope, filters: ReportFilters) {
    return occupancyReport(this.pool(), scope, filters);
  }

  async occupancyOptions(scope: Scope) {
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT t.id tableId,t.table_number AS \`table\`,s.id roomId,COALESCE(s.name,'Unassigned') room
       FROM dining_tables t LEFT JOIN sections s ON s.id=t.section_id AND s.organization_id=t.organization_id AND s.branch_id=t.branch_id
       WHERE t.organization_id=? AND t.branch_id IN (${inClause(scope.branchIds)}) ORDER BY room,t.table_number`,
      [scope.organizationId,...scope.branchIds]);
    return rows.map(r=>({tableId:n(r.tableId),table:String(r.table),roomId:r.roomId==null?null:n(r.roomId),room:String(r.room)}));
  }

  async payments(scope: Scope, filters: ReportFilters) {
    const w=financialWhere(scope,filters,'p'); w.clauses.push(`p.status='CAPTURED'`); if(filters.paymentMethodId){w.clauses.push('p.payment_method_id=?');w.params.push(filters.paymentMethodId);} if(filters.staffId){w.clauses.push('p.created_by=?');w.params.push(filters.staffId);}
    const [rows]=await this.pool().execute<RowDataPacket[]>(`SELECT pm.id payment_method_id,pm.name,pm.code,pm.type,COUNT(*) transaction_count,SUM(p.amount) amount FROM payments p JOIN payment_methods pm ON pm.id=p.payment_method_id WHERE ${w.clauses.join(' AND ')} GROUP BY pm.id,pm.name,pm.code,pm.type ORDER BY amount DESC`,w.params); const total=rows.reduce((s,r)=>s+n(r.amount),0);
    return {summary:{totalPayments:money(total),transactionCount:rows.reduce((s,r)=>s+n(r.transaction_count),0)},rows:rows.map(r=>({paymentMethodId:n(r.payment_method_id),name:String(r.name),code:String(r.code),type:String(r.type),transactionCount:n(r.transaction_count),amount:money(r.amount),percentage:total?money(n(r.amount)*100/total):0}))};
  }

  async tax(scope: Scope, filters: ReportFilters) { const w=financialWhere(scope,filters);w.clauses.push(`b.status='FINALIZED'`); const [rows]=await this.pool().execute<RowDataPacket[]>(`SELECT SUM(b.taxable_amount) taxable_sales,SUM(b.tax_total) tax_amount,SUM(b.grand_total) grand_total,COUNT(*) bill_count FROM bills b WHERE ${w.clauses.join(' AND ')}`,w.params); const r=rows[0];return{summary:{taxableSales:money(r.taxable_sales),taxAmount:money(r.tax_amount),grandTotal:money(r.grand_total),billCount:n(r.bill_count)},disclaimer:'Internal RMS VAT summary based on finalized bill snapshots; no IRD/CBMS certification is claimed.'}; }

  async shifts(scope: Scope, filters: ReportFilters) { const clauses=[`s.organization_id=?`,`s.branch_id IN (${inClause(scope.branchIds)})`];const params:(string | number)[]=[scope.organizationId,...scope.branchIds];if(filters.businessDayId){clauses.push('s.business_day_id=?');params.push(filters.businessDayId);}if(filters.shiftId){clauses.push('s.id=?');params.push(filters.shiftId);}if(filters.registerId){clauses.push('s.register_id=?');params.push(filters.registerId);}if(filters.staffId){clauses.push('s.cashier_id=?');params.push(filters.staffId);} const [rows]=await this.pool().execute<RowDataPacket[]>(`SELECT s.id,r.name register_name,u.name cashier,s.status,s.opening_cash,s.expected_cash,s.counted_cash,s.variance,s.variance_status,s.opened_at,s.closed_at,COALESCE(SUM(CASE WHEN pm.type='CASH' AND p.status='CAPTURED' THEN p.amount ELSE 0 END),0) cash_sales FROM shifts s JOIN registers r ON r.id=s.register_id JOIN users u ON u.id=s.cashier_id LEFT JOIN payments p ON p.shift_id=s.id LEFT JOIN payment_methods pm ON pm.id=p.payment_method_id WHERE ${clauses.join(' AND ')} GROUP BY s.id,r.name,u.name ORDER BY s.opened_at DESC`,params);return{rows:rows.map(r=>({id:n(r.id),register:String(r.register_name),cashier:String(r.cashier),status:String(r.status),openingCash:money(r.opening_cash),cashSales:money(r.cash_sales),expectedCash:r.expected_cash==null?null:money(r.expected_cash),countedCash:r.counted_cash==null?null:money(r.counted_cash),variance:r.variance==null?null:money(r.variance),varianceStatus:r.variance_status==null?null:String(r.variance_status),openedAt:String(r.opened_at),closedAt:r.closed_at==null?null:String(r.closed_at)}))}; }

  async inventory(scope: Scope, filters: ReportFilters) { const clauses=[`i.organization_id=?`,`i.branch_id IN (${inClause(scope.branchIds)})`];const params:(string | number)[]=[scope.organizationId,...scope.branchIds];if(filters.itemId){clauses.push('i.id=?');params.push(filters.itemId);} const [rows]=await this.pool().execute<RowDataPacket[]>(`SELECT i.id,i.name,c.name category,l.name location,b.current_quantity,i.reorder_point,u.symbol unit FROM inventory_items i LEFT JOIN inventory_categories c ON c.id=i.category_id JOIN units_of_measure u ON u.id=i.unit_id LEFT JOIN inventory_balances b ON b.inventory_item_id=i.id LEFT JOIN inventory_locations l ON l.id=b.location_id WHERE ${clauses.join(' AND ')} ORDER BY i.name,l.name`,params);const mapped=rows.map(r=>({itemId:n(r.id),item:String(r.name),category:r.category==null?null:String(r.category),location:r.location==null?null:String(r.location),quantity:money(r.current_quantity),reorderPoint:money(r.reorder_point),unit:String(r.unit),stockStatus:n(r.current_quantity)<=0?'OUT_OF_STOCK':n(r.current_quantity)<=n(r.reorder_point)?'LOW':'OK'}));return{summary:{lowStockCount:mapped.filter(r=>r.stockStatus==='LOW').length,outOfStockCount:mapped.filter(r=>r.stockStatus==='OUT_OF_STOCK').length},rows:mapped}; }

  async inventoryMovements(scope: Scope, filters: ReportFilters) { const clauses=[`m.organization_id=?`,`m.branch_id IN (${inClause(scope.branchIds)})`];const params:(string | number)[]=[scope.organizationId,...scope.branchIds];if(filters.itemId){clauses.push('m.inventory_item_id=?');params.push(filters.itemId);}if(filters.from){clauses.push('DATE(m.created_at)>=?');params.push(filters.from);}if(filters.to){clauses.push('DATE(m.created_at)<=?');params.push(filters.to);} const [rows]=await this.pool().execute<RowDataPacket[]>(`SELECT m.id,m.created_at,i.name item,l.name location,m.movement_type,m.quantity,m.before_quantity,m.after_quantity,m.reason,m.reference_type,m.reference_id,u.name performed_by FROM inventory_movements m JOIN inventory_items i ON i.id=m.inventory_item_id JOIN inventory_locations l ON l.id=m.location_id JOIN users u ON u.id=m.performed_by WHERE ${clauses.join(' AND ')} ORDER BY m.created_at DESC,m.id DESC LIMIT 1000`,params);return{rows:rows.map(r=>({id:n(r.id),createdAt:String(r.created_at),item:String(r.item),location:String(r.location),movementType:String(r.movement_type),quantity:money(r.quantity),opening:money(r.before_quantity),closing:money(r.after_quantity),reason:String(r.reason),referenceType:r.reference_type==null?null:String(r.reference_type),referenceId:r.reference_id==null?null:n(r.reference_id),performedBy:String(r.performed_by)}))}; }

  async purchasing(scope: Scope, filters: ReportFilters) { const clauses=[`po.organization_id=?`,`po.branch_id IN (${inClause(scope.branchIds)})`];const params:(string | number)[]=[scope.organizationId,...scope.branchIds];if(filters.from){clauses.push('po.order_date>=?');params.push(filters.from);}if(filters.to){clauses.push('po.order_date<=?');params.push(filters.to);} const [rows]=await this.pool().execute<RowDataPacket[]>(`SELECT s.id supplier_id,s.name supplier,COUNT(DISTINCT po.id) po_count,SUM(CASE WHEN po.status<>'CANCELLED' THEN po.grand_total ELSE 0 END) ordered_amount,SUM(poi.accepted_quantity) accepted_quantity,SUM(poi.rejected_quantity) rejected_quantity,AVG(si.lead_time_days) lead_time_days FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id LEFT JOIN purchase_order_items poi ON poi.purchase_order_id=po.id LEFT JOIN supplier_items si ON si.supplier_id=s.id AND si.inventory_item_id=poi.inventory_item_id AND si.branch_id=po.branch_id WHERE ${clauses.join(' AND ')} GROUP BY s.id,s.name ORDER BY ordered_amount DESC`,params);return{summary:{purchaseOrders:rows.reduce((s,r)=>s+n(r.po_count),0),orderedAmount:money(rows.reduce((s,r)=>s+n(r.ordered_amount),0))},rows:rows.map(r=>({supplierId:n(r.supplier_id),supplier:String(r.supplier),poCount:n(r.po_count),orderedAmount:money(r.ordered_amount),acceptedQuantity:money(r.accepted_quantity),rejectedQuantity:money(r.rejected_quantity),configuredLeadTimeDays:money(r.lead_time_days)}))}; }

  async expenses(scope: Scope, filters: ReportFilters) { const clauses=[`e.organization_id=?`,`e.branch_id IN (${inClause(scope.branchIds)})`,`e.status='POSTED'`];const params:(string | number)[]=[scope.organizationId,...scope.branchIds];if(filters.businessDayId){clauses.push('e.business_day_id=?');params.push(filters.businessDayId);}if(filters.from){clauses.push('e.expense_date>=?');params.push(filters.from);}if(filters.to){clauses.push('e.expense_date<=?');params.push(filters.to);}if(filters.departmentId){clauses.push('e.department_id=?');params.push(filters.departmentId);}if(filters.paymentMethodId){clauses.push('e.payment_method_id=?');params.push(filters.paymentMethodId);} const [rows]=await this.pool().execute<RowDataPacket[]>(`SELECT ec.id category_id,ec.name category,COALESCE(d.name,'Unassigned') department,pm.name payment_method,pm.type payment_type,COUNT(*) expense_count,SUM(e.amount) amount FROM expenses e JOIN expense_categories ec ON ec.id=e.expense_category_id LEFT JOIN departments d ON d.id=e.department_id JOIN payment_methods pm ON pm.id=e.payment_method_id WHERE ${clauses.join(' AND ')} GROUP BY ec.id,ec.name,department,pm.id,pm.name,pm.type ORDER BY amount DESC`,params);const total=rows.reduce((s,r)=>s+n(r.amount),0);return{summary:{totalExpenses:money(total),expenseCount:rows.reduce((s,r)=>s+n(r.expense_count),0),cashExpenses:money(rows.filter(r=>String(r.payment_type)==='CASH').reduce((s,r)=>s+n(r.amount),0)),nonCashExpenses:money(rows.filter(r=>String(r.payment_type)!=='CASH').reduce((s,r)=>s+n(r.amount),0))},rows:rows.map(r=>({categoryId:n(r.category_id),category:String(r.category),department:String(r.department),paymentMethod:String(r.payment_method),paymentType:String(r.payment_type),expenseCount:n(r.expense_count),amount:money(r.amount)}))}; }

  async controls(scope: Scope, filters: ReportFilters) {
    const clauses=[`o.organization_id=?`,`o.branch_id IN (${inClause(scope.branchIds)})`,`o.order_status='CANCELLED'`];
    const params:(string | number)[]=[scope.organizationId,...scope.branchIds];
    if(filters.businessDayId){clauses.push('o.business_day_id=?');params.push(filters.businessDayId);}
    if(filters.from){clauses.push('DATE(o.created_at)>=?');params.push(filters.from);}
    if(filters.to){clauses.push('DATE(o.created_at)<=?');params.push(filters.to);}
    const [cancelled]=await this.pool().execute<RowDataPacket[]>(
      `SELECT o.id,o.order_number,o.grand_total amount,o.cancellation_reason reason,o.cancelled_at,u.name actor
         FROM orders o
         LEFT JOIN users u ON u.id=o.cancelled_by
        WHERE ${clauses.join(' AND ')}
        ORDER BY o.cancelled_at DESC LIMIT 500`,
      params
    );

    const discountWhere=financialWhere(scope,filters);
    discountWhere.clauses.push(`b.status='FINALIZED'`,`b.discount_total>0`);
    const [discounts]=await this.pool().execute<RowDataPacket[]>(
      `SELECT b.id,b.bill_number,b.discount_total amount,b.finalized_at,u.name actor
         FROM bills b
         LEFT JOIN users u ON u.id=b.finalized_by
        WHERE ${discountWhere.clauses.join(' AND ')}
        ORDER BY b.finalized_at DESC LIMIT 500`,
      discountWhere.params
    );

    const reversalWhere=financialWhere(scope,filters);
    reversalWhere.clauses.push(`b.status='FINALIZED'`,`p.status='REVERSED'`);
    const [reversals]=await this.pool().execute<RowDataPacket[]>(
      `SELECT p.id,b.bill_number,p.amount,p.reversal_reason reason,p.reversed_at,
              pm.name payment_method,u.name actor
         FROM payments p
         JOIN bills b ON b.id=p.bill_id AND b.organization_id=p.organization_id AND b.branch_id=p.branch_id
         JOIN payment_methods pm ON pm.id=p.payment_method_id AND pm.organization_id=p.organization_id
         LEFT JOIN users u ON u.id=p.reversed_by AND u.organization_id=p.organization_id
        WHERE ${reversalWhere.clauses.join(' AND ')}
        ORDER BY p.reversed_at DESC,p.id DESC LIMIT 500`,
      reversalWhere.params
    );

    return {
      summary:{
        cancelledOrders:cancelled.length,
        cancelledAmount:money(cancelled.reduce((sum,row)=>sum+n(row.amount),0)),
        discountedBills:discounts.length,
        discountAmount:money(discounts.reduce((sum,row)=>sum+n(row.amount),0)),
        reversedPayments:reversals.length,
        reversedAmount:money(reversals.reduce((sum,row)=>sum+n(row.amount),0)),
      },
      cancelled:cancelled.map(row=>({
        id:n(row.id),
        orderNumber:String(row.order_number),
        amount:money(row.amount),
        reason:row.reason==null?null:String(row.reason),
        at:row.cancelled_at==null?null:String(row.cancelled_at),
        actor:row.actor==null?null:String(row.actor),
      })),
      discounts:discounts.map(row=>({
        id:n(row.id),
        billNumber:String(row.bill_number),
        amount:money(row.amount),
        at:row.finalized_at==null?null:String(row.finalized_at),
        actor:row.actor==null?null:String(row.actor),
      })),
      reversals:reversals.map(row=>({
        id:n(row.id),
        billNumber:String(row.bill_number),
        paymentMethod:String(row.payment_method),
        amount:money(row.amount),
        reason:row.reason==null?null:String(row.reason),
        at:row.reversed_at==null?null:String(row.reversed_at),
        actor:row.actor==null?null:String(row.actor),
      })),
    };
  }

  async branches(scope: Scope, filters: ReportFilters) { const w=financialWhere(scope,filters);w.clauses.push(`b.status='FINALIZED'`); const [rows]=await this.pool().execute<RowDataPacket[]>(`SELECT br.id branch_id,br.name branch,COUNT(*) bill_count,COUNT(DISTINCT b.order_id) order_count,SUM(b.subtotal-b.discount_total) net_sales,SUM(b.grand_total) grand_total FROM bills b JOIN branches br ON br.id=b.branch_id WHERE ${w.clauses.join(' AND ')} GROUP BY br.id,br.name ORDER BY net_sales DESC`,w.params);return{rows:rows.map(r=>({branchId:n(r.branch_id),branch:String(r.branch),billCount:n(r.bill_count),orderCount:n(r.order_count),netSales:money(r.net_sales),grandTotal:money(r.grand_total),averageBill:n(r.bill_count)?money(n(r.grand_total)/n(r.bill_count)):0}))}; }
}

export const reportsRepository = new ReportsRepository();
