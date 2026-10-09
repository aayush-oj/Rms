export type ReportRow = Record<string, unknown>;
export type ReportQuery = { from?: string; to?: string; branchId?: number; page?: number; limit?: number; sort?: string };

const MAX_LIMIT = 1000;
const SORT_ALLOWLIST = new Set(['dateTime desc', 'dateTime asc', 'amount desc', 'amount asc', 'name asc', 'name desc']);

export function normalizeReportQuery(query: ReportQuery = {}) {
  const page = Number.isInteger(query.page) && (query.page ?? 0) > 0 ? query.page! : 1;
  const limit = Math.min(MAX_LIMIT, Number.isInteger(query.limit) && (query.limit ?? 0) > 0 ? query.limit! : 100);
  const sort = SORT_ALLOWLIST.has(query.sort ?? '') ? query.sort! : 'dateTime desc';
  return { ...query, page, limit, sort };
}

export function paginate<T>(rows: T[], page: number, limit: number) {
  const start = (page - 1) * limit;
  return { rows: rows.slice(start, start + limit), page, limit, total: rows.length };
}
