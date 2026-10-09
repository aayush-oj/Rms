import { Pool, RowDataPacket } from 'mysql2/promise';
import { ForbiddenError } from '../../shared/errors';
import { ReportFilters, REPORT_METRICS } from './types';
import { ResolvedReportScope } from './service';

const number = (value: unknown) => Number(value ?? 0);
const round = (value: number) => Math.round((value + Number.EPSILON) * 10000) / 10000;
const active = "'PLACED','PREPARING','READY','SERVED'";

// All history stays in MySQL. The nested running totals count a table only once,
// even when multiple checks overlap on that same table.
export const occupancyPeakSql = `,
intervals AS (
  SELECT dining_table_id, created_at start_at,
    CASE WHEN order_status='COMPLETED' THEN completed_at ELSE NOW() END end_at
  FROM visits WHERE order_status='COMPLETED' OR business_day_status='OPEN'
), events AS (
  SELECT dining_table_id, start_at at_time, 1 delta FROM intervals WHERE end_at > start_at
  UNION ALL
  SELECT dining_table_id, end_at, -1 FROM intervals WHERE end_at > start_at
), table_events AS (
  SELECT dining_table_id, at_time, SUM(delta) delta FROM events GROUP BY dining_table_id, at_time
), table_running AS (
  SELECT *, SUM(delta) OVER (PARTITION BY dining_table_id ORDER BY at_time ROWS UNBOUNDED PRECEDING) checks FROM table_events
), changes AS (
  SELECT at_time, (CASE WHEN checks>0 THEN 1 ELSE 0 END) -
    (CASE WHEN checks-delta>0 THEN 1 ELSE 0 END) delta FROM table_running
), concurrent AS (
  SELECT at_time, SUM(SUM(delta)) OVER (ORDER BY at_time ROWS UNBOUNDED PRECEDING) occupied
  FROM changes GROUP BY at_time
)
SELECT COALESCE(MAX(occupied),0) peak FROM concurrent`;

export async function occupancyReport(pool: Pick<Pool, 'execute'>, scope: ResolvedReportScope, filters: ReportFilters) {
  const scopeSql = `organization_id=? AND branch_id IN (${scope.branchIds.map(() => '?').join(',')})`;
  const scopeParams = [scope.organizationId, ...scope.branchIds];
  // Report permission intentionally grants branch-wide visibility, independent of waiter allocation.
  for (const [id, entity] of [[filters.roomId, 'sections'], [filters.tableId, 'dining_tables']] as const) {
    if (id !== undefined) {
      const [found] = await pool.execute<RowDataPacket[]>(`SELECT id FROM ${entity} WHERE ${scopeSql} AND id=?`, [...scopeParams, id]);
      if (!found.length) throw new ForbiddenError('Room or table is outside the authorized report scope', 'UNAUTHORIZED_OCCUPANCY_SCOPE');
    }
  }
  const locations = [scopeSql];
  const locationParams: (string | number)[] = [...scopeParams];
  if (filters.roomId) { locations.push('section_id=?'); locationParams.push(filters.roomId); }
  if (filters.tableId) { locations.push('id=?'); locationParams.push(filters.tableId); }
  const tables = `selected_tables AS (SELECT * FROM dining_tables WHERE ${locations.join(' AND ')})`;
  const history = ['o.organization_id=?', `o.branch_id IN (${scope.branchIds.map(() => '?').join(',')})`, "o.order_type='DINE_IN'", `(o.order_status='COMPLETED' OR o.order_status IN (${active}))`];
  const historyParams: (string | number)[] = [...scopeParams];
  if (filters.businessDayId) { history.push('o.business_day_id=?'); historyParams.push(filters.businessDayId); }
  if (filters.from) { history.push('bd.business_date>=?'); historyParams.push(filters.from); }
  if (filters.to) { history.push('bd.business_date<=?'); historyParams.push(filters.to); }
  if (filters.timeFrom) { history.push('TIME(o.created_at)>=?'); historyParams.push(`${filters.timeFrom}:00`); }
  if (filters.timeTo) { history.push('TIME(o.created_at)<?'); historyParams.push(`${filters.timeTo}:00`); }
  const cte = `WITH ${tables}, visits AS (
    SELECT o.*, bd.status business_day_status FROM orders o
    JOIN selected_tables t ON t.id=o.dining_table_id AND t.organization_id=o.organization_id AND t.branch_id=o.branch_id
    JOIN business_days bd ON bd.id=o.business_day_id AND bd.organization_id=o.organization_id AND bd.branch_id=o.branch_id
    WHERE ${history.join(' AND ')}
  )`;
  const params = [...locationParams, ...historyParams];
  const [rows] = await pool.execute<RowDataPacket[]>(`${cte},
    completed AS (
      SELECT dining_table_id, COUNT(*) turns,
        SUM(CASE WHEN completed_at>=created_at THEN TIMESTAMPDIFF(SECOND,created_at,completed_at)/60.0 END) duration,
        COUNT(CASE WHEN completed_at>=created_at THEN 1 END) duration_count
      FROM visits WHERE order_status='COMPLETED' GROUP BY dining_table_id
    ), sales AS (
      SELECT v.dining_table_id, SUM(b.subtotal-b.discount_total) net_sales
      FROM visits v JOIN bills b ON b.order_id=v.id AND b.organization_id=v.organization_id AND b.branch_id=v.branch_id
      WHERE v.order_status='COMPLETED' AND b.status='FINALIZED' GROUP BY v.dining_table_id
    ), current_tables AS (
      SELECT o.dining_table_id, COUNT(*) active_orders, MIN(o.created_at) occupied_since
      FROM orders o JOIN selected_tables t ON t.id=o.dining_table_id AND t.organization_id=o.organization_id AND t.branch_id=o.branch_id
      WHERE o.order_type='DINE_IN' AND o.order_status IN (${active}) GROUP BY o.dining_table_id
    )
    SELECT t.id table_id,t.table_number,t.section_id room_id,COALESCE(s.name,'Unassigned') room,
      c.turns,c.duration,c.duration_count,sa.net_sales,ct.active_orders,ct.occupied_since
    FROM selected_tables t
    LEFT JOIN sections s ON s.id=t.section_id AND s.organization_id=t.organization_id AND s.branch_id=t.branch_id
    LEFT JOIN completed c ON c.dining_table_id=t.id LEFT JOIN sales sa ON sa.dining_table_id=t.id
    LEFT JOIN current_tables ct ON ct.dining_table_id=t.id ORDER BY room,t.table_number`, params);
  const [peak] = await pool.execute<RowDataPacket[]>(`${cte}${occupancyPeakSql}`, params);
  const tablePerformance = rows.map(r => ({ tableId: number(r.table_id), table: String(r.table_number), roomId: r.room_id == null ? null : number(r.room_id), room: String(r.room), completedTurns: number(r.turns), completedOrders: number(r.turns), netSales: round(number(r.net_sales)), averageTableValue: number(r.turns) ? round(number(r.net_sales)/number(r.turns)) : null, averageCompletedDurationMinutes: number(r.duration_count) ? round(number(r.duration)/number(r.duration_count)) : null, ordersPerTable: number(r.turns) }));
  const rooms = new Map<number | null, { roomId: number | null; room: string; tableCount: number; completedTurns: number; completedOrders: number; netSales: number; duration: number; durationCount: number }>();
  rows.forEach((r,i) => {
    const table = tablePerformance[i];
    const room = rooms.get(table.roomId) ?? { roomId: table.roomId, room: table.room, tableCount: 0, completedTurns: 0, completedOrders: 0, netSales: 0, duration: 0, durationCount: 0 };
    room.tableCount++; room.completedTurns += table.completedTurns; room.completedOrders += table.completedOrders; room.netSales += number(r.net_sales); room.duration += number(r.duration); room.durationCount += number(r.duration_count); rooms.set(table.roomId, room);
  });
  const roomPerformance = [...rooms.values()].map(({duration,durationCount,...room}) => ({...room, netSales: round(room.netSales), averageTableValue: room.completedOrders ? round(room.netSales/room.completedOrders) : null, averageCompletedDurationMinutes: durationCount ? round(duration/durationCount) : null}));
  const currentOccupancy = rows.filter(r => number(r.active_orders)>0).map(r => ({tableId:number(r.table_id),table:String(r.table_number),room:String(r.room),activeOrders:number(r.active_orders),occupiedSince:r.occupied_since as string | Date}));
  const turns = rows.reduce((sum,r)=>sum+number(r.turns),0);
  const durationCount = rows.reduce((sum,r)=>sum+number(r.duration_count),0);
  const netSales = rows.reduce((sum,r)=>sum+number(r.net_sales),0);
  return {
    summary: { totalTables: rows.length, currentOccupiedTables: currentOccupancy.length, completedTableTurns: turns,
      averageCompletedDurationMinutes: durationCount ? round(rows.reduce((sum,r)=>sum+number(r.duration),0)/durationCount) : null,
      ordersPerTable: rows.length ? round(turns/rows.length) : null, salesPerTable: rows.length ? round(netSales/rows.length) : null,
      peakConcurrentOccupancy: number(peak[0]?.peak) },
    tablePerformance, roomPerformance, currentOccupancy,
    metricDefinitions: REPORT_METRICS,
  };
}
