import { RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { ReportFilters } from './types';
import { FnbFilters } from './fnb';

interface Scope { organizationId: number; branchIds: number[]; }
const n = (value: unknown) => Number(value ?? 0);
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const inClause = (ids: number[]) => ids.map(() => '?').join(',');

function salesWhere(scope: Scope, filters: FnbFilters) {
  const clauses = ['b.organization_id = ?', `b.branch_id IN (${inClause(scope.branchIds)})`, "b.status = 'FINALIZED'"];
  const params: Array<string | number> = [scope.organizationId, ...scope.branchIds];
  if (filters.businessDayId) { clauses.push('b.business_day_id = ?'); params.push(filters.businessDayId); }
  if (filters.from) { clauses.push('b.business_date >= ?'); params.push(filters.from); }
  if (filters.to) { clauses.push('b.business_date <= ?'); params.push(filters.to); }
  if (filters.departmentId) { clauses.push('COALESCE(bl.department_id_snapshot, mi.department_id) = ?'); params.push(filters.departmentId); }
  if (filters.categoryId) { clauses.push('COALESCE(bl.category_id_snapshot, mi.category_id) = ?'); params.push(filters.categoryId); }
  if (filters.itemId) { clauses.push('bl.menu_item_id = ?'); params.push(filters.itemId); }
  if (filters.classification) {
    clauses.push("COALESCE(bl.item_classification_snapshot, mi.item_classification, 'OTHER') = ?");
    params.push(filters.classification);
  }
  return { clauses, params };
}

function trendExpression(grouping: ReportFilters['grouping']) {
  if (grouping === 'hour') return "DATE_FORMAT(COALESCE(b.finalized_at,b.created_at),'%Y-%m-%d %H:00')";
  if (grouping === 'week') return "DATE_FORMAT(DATE_SUB(b.business_date, INTERVAL WEEKDAY(b.business_date) DAY),'%Y-%m-%d')";
  if (grouping === 'month') return "DATE_FORMAT(b.business_date,'%Y-%m')";
  return "DATE_FORMAT(b.business_date,'%Y-%m-%d')";
}

export async function fnbSalesPerformance(scope: Scope, filters: FnbFilters) {
  const pool = getDatabasePool();
  const w = salesWhere(scope, filters);
  const joins = `FROM bills b
    JOIN bill_lines bl ON bl.bill_id = b.id AND bl.organization_id = b.organization_id AND bl.branch_id = b.branch_id
    LEFT JOIN menu_items mi ON mi.id = bl.menu_item_id AND mi.organization_id = b.organization_id
    LEFT JOIN menu_categories mc ON mc.id = COALESCE(bl.category_id_snapshot,mi.category_id) AND mc.organization_id = b.organization_id
    LEFT JOIN departments d ON d.id = COALESCE(bl.department_id_snapshot,mi.department_id) AND d.organization_id = b.organization_id`;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT bl.menu_item_id item_id, bl.item_name_snapshot item,
      COALESCE(bl.item_classification_snapshot,mi.item_classification,'OTHER') classification,
      COALESCE(bl.category_name_snapshot,mc.name,'Unassigned') category,
      COALESCE(bl.department_name_snapshot,d.name,'Unassigned') department,
      SUM(bl.quantity) quantity, SUM(bl.line_subtotal-bl.discount_amount) net_sales
     ${joins} WHERE ${w.clauses.join(' AND ')}
     GROUP BY bl.menu_item_id,bl.item_name_snapshot,classification,category,department`, w.params
  );
  const ranked = rows.map(row => ({
    itemId: row.item_id == null ? null : n(row.item_id), item: String(row.item), classification: String(row.classification),
    category: String(row.category), department: String(row.department), quantity: n(row.quantity), netSales: round(n(row.net_sales)),
  }));
  const byQuantity = [...ranked].sort((a,b) => b.quantity-a.quantity || b.netSales-a.netSales || a.item.localeCompare(b.item));
  const bottom = [...ranked].filter(row => row.quantity > 0).sort((a,b) => a.quantity-b.quantity || a.netSales-b.netSales || a.item.localeCompare(b.item));
  const byRevenue = [...ranked].sort((a,b) => b.netSales-a.netSales || b.quantity-a.quantity);
  const totalQuantity = ranked.reduce((sum,row) => sum+row.quantity,0);
  const totalNetSales = ranked.reduce((sum,row) => sum+row.netSales,0);
  const grouping = filters.grouping || (filters.businessDayId ? 'hour' : 'day');
  const groupExpr = trendExpression(grouping);
  const [trendRows] = await pool.execute<RowDataPacket[]>(
    `SELECT ${groupExpr} period, SUM(bl.quantity) quantity, SUM(bl.line_subtotal-bl.discount_amount) net_sales
     ${joins} WHERE ${w.clauses.join(' AND ')} GROUP BY period ORDER BY period`, w.params
  );
  return {
    summary: {
      totalQuantity, totalNetSales: round(totalNetSales),
      topSeller: byQuantity[0] ?? null,
      lowestSeller: bottom[0] ?? null,
      highestRevenueItem: byRevenue[0] ?? null,
    },
    topItems: byQuantity.slice(0,10),
    bottomItems: bottom.slice(0,10),
    trend: trendRows.map(row => ({ period:String(row.period), quantity:n(row.quantity), netSales:round(n(row.net_sales)) })),
    ranking: byQuantity.map((row,index) => ({ ...row, rank:index+1, salesSharePercent: totalQuantity ? round(row.quantity*100/totalQuantity) : 0 })),
    grouping,
  };
}

function operationWhere(scope: Scope, filters: ReportFilters) {
  const clauses = ['kt.organization_id = ?', `kt.branch_id IN (${inClause(scope.branchIds)})`, "kt.ticket_status <> 'VOIDED'"];
  const params: Array<string | number> = [scope.organizationId, ...scope.branchIds];
  if (filters.businessDayId) { clauses.push('o.business_day_id = ?'); params.push(filters.businessDayId); }
  if (filters.from) { clauses.push('DATE(kt.created_at) >= ?'); params.push(filters.from); }
  if (filters.to) { clauses.push('DATE(kt.created_at) <= ?'); params.push(filters.to); }
  if (filters.departmentId) { clauses.push('kti.department_id_snapshot = ?'); params.push(filters.departmentId); }
  if (filters.itemId) { clauses.push('kti.menu_item_id = ?'); params.push(filters.itemId); }
  return { clauses, params };
}

function operationGroup(grouping: ReportFilters['grouping'], column: string) {
  if (grouping === 'hour') return `DATE_FORMAT(${column},'%Y-%m-%d %H:00')`;
  if (grouping === 'week') return `DATE_FORMAT(DATE_SUB(DATE(${column}), INTERVAL WEEKDAY(${column}) DAY),'%Y-%m-%d')`;
  if (grouping === 'month') return `DATE_FORMAT(${column},'%Y-%m')`;
  return `DATE_FORMAT(${column},'%Y-%m-%d')`;
}

export async function departmentOperationalPerformance(scope: Scope, filters: ReportFilters) {
  const pool = getDatabasePool();
  const w = operationWhere(scope, filters);
  const base = `FROM kitchen_ticket_items kti
    JOIN kitchen_tickets kt ON kt.id = kti.kitchen_ticket_id
    JOIN orders o ON o.id = kt.order_id AND o.organization_id = kt.organization_id AND o.branch_id = kt.branch_id`;
  const where = `${w.clauses.join(' AND ')} AND kti.item_status = 'READY' AND kti.preparing_at IS NOT NULL AND kti.ready_at IS NOT NULL`;
  const [departmentRows] = await pool.execute<RowDataPacket[]>(
    `SELECT kti.department_id_snapshot department_id, COALESCE(kti.department_name_snapshot,'Unassigned') department,
      COUNT(*) prepared_items, SUM(kti.quantity) quantity,
      AVG(TIMESTAMPDIFF(SECOND,kti.preparing_at,kti.ready_at)) avg_prep_seconds,
      AVG(TIMESTAMPDIFF(SECOND,kti.created_at,kti.ready_at)) avg_sent_to_ready_seconds,
      SUM(CASE WHEN kti.prep_time_minutes_snapshot IS NOT NULL AND TIMESTAMPDIFF(SECOND,kti.preparing_at,kti.ready_at) <= kti.prep_time_minutes_snapshot*60 THEN 1 ELSE 0 END) within_target,
      SUM(CASE WHEN kti.prep_time_minutes_snapshot IS NOT NULL THEN 1 ELSE 0 END) target_samples
     ${base} WHERE ${where}
     GROUP BY kti.department_id_snapshot,COALESCE(kti.department_name_snapshot,'Unassigned')
     ORDER BY avg_prep_seconds DESC`, w.params
  );
  const [itemRows] = await pool.execute<RowDataPacket[]>(
    `SELECT kti.menu_item_id item_id, kti.item_name_snapshot item, COALESCE(kti.department_name_snapshot,'Unassigned') department,
      SUM(kti.quantity) quantity, COUNT(*) samples,
      AVG(TIMESTAMPDIFF(SECOND,kti.preparing_at,kti.ready_at)) avg_prep_seconds,
      AVG(TIMESTAMPDIFF(SECOND,kti.created_at,kti.ready_at)) avg_sent_to_ready_seconds,
      SUM(CASE WHEN kti.prep_time_minutes_snapshot IS NOT NULL AND TIMESTAMPDIFF(SECOND,kti.preparing_at,kti.ready_at) <= kti.prep_time_minutes_snapshot*60 THEN 1 ELSE 0 END) within_target,
      SUM(CASE WHEN kti.prep_time_minutes_snapshot IS NOT NULL THEN 1 ELSE 0 END) target_samples
     ${base} WHERE ${where}
     GROUP BY kti.menu_item_id,kti.item_name_snapshot,COALESCE(kti.department_name_snapshot,'Unassigned')
     ORDER BY avg_prep_seconds DESC`, w.params
  );
  const serviceClauses = ['o.organization_id = ?', `o.branch_id IN (${inClause(scope.branchIds)})`, 'o.ready_at IS NOT NULL', 'o.served_at IS NOT NULL', "o.order_status <> 'CANCELLED'"];
  const serviceParams: Array<string|number> = [scope.organizationId,...scope.branchIds];
  if (filters.businessDayId) { serviceClauses.push('o.business_day_id = ?'); serviceParams.push(filters.businessDayId); }
  if (filters.from) { serviceClauses.push('DATE(o.served_at) >= ?'); serviceParams.push(filters.from); }
  if (filters.to) { serviceClauses.push('DATE(o.served_at) <= ?'); serviceParams.push(filters.to); }
  if (filters.staffId) { serviceClauses.push('o.served_by = ?'); serviceParams.push(filters.staffId); }
  const [serviceSummaryRows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) served_orders, AVG(TIMESTAMPDIFF(SECOND,o.ready_at,o.served_at)) avg_ready_to_served_seconds,
      AVG(TIMESTAMPDIFF(SECOND,first_kot.sent_at,o.served_at)) avg_sent_to_served_seconds
     FROM orders o
     LEFT JOIN (SELECT order_id,MIN(created_at) sent_at FROM kitchen_tickets WHERE ticket_status <> 'VOIDED' GROUP BY order_id) first_kot ON first_kot.order_id=o.id
     WHERE ${serviceClauses.join(' AND ')}`, serviceParams
  );
  const [waiterRows] = await pool.execute<RowDataPacket[]>(
    `SELECT o.served_by staff_id, COALESCE(u.name,'Unknown') staff, COUNT(*) served_orders,
      AVG(TIMESTAMPDIFF(SECOND,o.ready_at,o.served_at)) avg_ready_to_served_seconds,
      MAX(TIMESTAMPDIFF(SECOND,o.ready_at,o.served_at)) slowest_ready_to_served_seconds
     FROM orders o LEFT JOIN users u ON u.id=o.served_by
     WHERE ${serviceClauses.join(' AND ')} AND o.served_by IS NOT NULL
     GROUP BY o.served_by,u.name ORDER BY avg_ready_to_served_seconds`, serviceParams
  );
  const grouping = filters.grouping || (filters.businessDayId ? 'hour' : 'day');
  const prepGroup = operationGroup(grouping,'kti.ready_at');
  const [prepTrend] = await pool.execute<RowDataPacket[]>(
    `SELECT ${prepGroup} period, AVG(TIMESTAMPDIFF(SECOND,kti.preparing_at,kti.ready_at)) avg_prep_seconds, COUNT(*) samples
     ${base} WHERE ${where} GROUP BY period ORDER BY period`, w.params
  );
  const serviceGroup = operationGroup(grouping,'o.served_at');
  const [serviceTrend] = await pool.execute<RowDataPacket[]>(
    `SELECT ${serviceGroup} period, AVG(TIMESTAMPDIFF(SECOND,o.ready_at,o.served_at)) avg_ready_to_served_seconds, COUNT(*) samples
     FROM orders o WHERE ${serviceClauses.join(' AND ')} GROUP BY period ORDER BY period`, serviceParams
  );
  const prepSamples = departmentRows.reduce((sum,row)=>sum+n(row.prepared_items),0);
  const weightedPrep = departmentRows.reduce((sum,row)=>sum+n(row.avg_prep_seconds)*n(row.prepared_items),0);
  const targetSamples = departmentRows.reduce((sum,row)=>sum+n(row.target_samples),0);
  const withinTarget = departmentRows.reduce((sum,row)=>sum+n(row.within_target),0);
  const service = serviceSummaryRows[0] ?? ({} as RowDataPacket);
  const trendMap = new Map<string,{period:string;avgPrepSeconds:number|null;avgReadyToServedSeconds:number|null;prepSamples:number;serviceSamples:number}>();
  for (const row of prepTrend) trendMap.set(String(row.period),{period:String(row.period),avgPrepSeconds:round(n(row.avg_prep_seconds)),avgReadyToServedSeconds:null,prepSamples:n(row.samples),serviceSamples:0});
  for (const row of serviceTrend) {
    const key=String(row.period); const current=trendMap.get(key)??{period:key,avgPrepSeconds:null,avgReadyToServedSeconds:null,prepSamples:0,serviceSamples:0};
    current.avgReadyToServedSeconds=round(n(row.avg_ready_to_served_seconds)); current.serviceSamples=n(row.samples); trendMap.set(key,current);
  }
  const pct=(a:number,b:number)=>b?round(a*100/b):null;
  return {
    summary: {
      preparedItems: prepSamples,
      avgPrepSeconds: prepSamples ? round(weightedPrep/prepSamples) : null,
      prepWithinTargetPercent: pct(withinTarget,targetSamples),
      prepTargetSamples: targetSamples,
      servedOrders: n(service.served_orders),
      avgReadyToServedSeconds: service.avg_ready_to_served_seconds == null ? null : round(n(service.avg_ready_to_served_seconds)),
      avgSentToServedSeconds: service.avg_sent_to_served_seconds == null ? null : round(n(service.avg_sent_to_served_seconds)),
    },
    rows: departmentRows.map(row=>({
      departmentId:row.department_id==null?null:n(row.department_id), department:String(row.department), preparedItems:n(row.prepared_items), quantity:n(row.quantity),
      avgPrepSeconds:round(n(row.avg_prep_seconds)), avgSentToReadySeconds:round(n(row.avg_sent_to_ready_seconds)),
      withinTargetPercent:pct(n(row.within_target),n(row.target_samples)), targetSamples:n(row.target_samples),
    })),
    items: itemRows.map(row=>({ itemId:n(row.item_id), item:String(row.item), department:String(row.department), quantity:n(row.quantity), samples:n(row.samples), avgPrepSeconds:round(n(row.avg_prep_seconds)), avgSentToReadySeconds:round(n(row.avg_sent_to_ready_seconds)), withinTargetPercent:pct(n(row.within_target),n(row.target_samples)) })),
    waiters: waiterRows.map(row=>({ staffId:n(row.staff_id), staff:String(row.staff), servedOrders:n(row.served_orders), avgReadyToServedSeconds:round(n(row.avg_ready_to_served_seconds)), slowestReadyToServedSeconds:round(n(row.slowest_ready_to_served_seconds)) })),
    trend:[...trendMap.values()].sort((a,b)=>a.period.localeCompare(b.period)),
    grouping,
    disclaimer:'Prep metrics include only KOT items with explicit PREPARING and READY timestamps. Older records without lifecycle timestamps are excluded rather than estimated.',
  };
}
