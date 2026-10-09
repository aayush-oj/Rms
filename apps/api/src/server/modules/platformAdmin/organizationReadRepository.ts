import type { Pool, RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import type {
  OrganizationAccessStatus,
  OrganizationEntitlement,
} from '../organizationAccess/types';
import type {
  PlatformOrganizationAutomationFailureRecord,
  PlatformOrganizationBaseRecord,
  PlatformOrganizationBranchDetail,
  PlatformOrganizationOwnerContact,
  PlatformOrganizationSecuritySuspensionContext,
} from './organizationReadTypes';

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function toNullableIso(value: unknown): string | null {
  if (value == null) return null;
  return toIso(value);
}

function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function mapEntitlement(row: RowDataPacket): OrganizationEntitlement | null {
  if (row.entitlement_id == null) return null;

  return {
    id: Number(row.entitlement_id),
    organizationId: Number(row.organization_id),
    accessStatus: String(row.entitlement_access_status) as OrganizationAccessStatus,
    trialStartedAt: toNullableIso(row.entitlement_trial_started_at),
    trialEndsAt: toNullableIso(row.entitlement_trial_ends_at),
    activatedAt: toNullableIso(row.entitlement_activated_at),
    accessEndsAt: toNullableIso(row.entitlement_access_ends_at),
    graceEndsAt: toNullableIso(row.entitlement_grace_ends_at),
    scheduledSuspensionAt: toNullableIso(row.entitlement_scheduled_suspension_at),
    scheduledSuspensionReason:
      row.entitlement_scheduled_suspension_reason == null
        ? null
        : String(row.entitlement_scheduled_suspension_reason),
    scheduledSuspensionCustomerMessage:
      row.entitlement_scheduled_suspension_customer_message == null
        ? null
        : String(row.entitlement_scheduled_suspension_customer_message),
    suspendedAt: toNullableIso(row.entitlement_suspended_at),
    cancelledAt: toNullableIso(row.entitlement_cancelled_at),
    internalReason:
      row.entitlement_internal_reason == null
        ? null
        : String(row.entitlement_internal_reason),
    customerMessage:
      row.entitlement_customer_message == null
        ? null
        : String(row.entitlement_customer_message),
    version: Number(row.entitlement_version),
    createdAt: toIso(row.entitlement_created_at),
    updatedAt: toIso(row.entitlement_updated_at),
  };
}

function mapBase(row: RowDataPacket): PlatformOrganizationBaseRecord {
  return {
    id: Number(row.organization_id),
    handle: String(row.organization_handle),
    name: String(row.organization_name),
    legalName:
      row.organization_legal_name == null
        ? null
        : String(row.organization_legal_name),
    currencyCode: String(row.organization_currency_code),
    registeredAt: toIso(row.organization_created_at),
    updatedAt: toIso(row.organization_updated_at),
    entitlement: mapEntitlement(row),
  };
}

function escapeLike(value: string): string {
  return value.replace(/=/g, '==').replace(/%/g, '=%').replace(/_/g, '=_');
}

interface StableFilters {
  search?: string;
  status?: OrganizationAccessStatus;
}

type StableWhereParam = string | number;

function stableWhere(filters: StableFilters): {
  sql: string;
  params: StableWhereParam[];
} {
  const clauses: string[] = [];
  const params: StableWhereParam[] = [];

  if (filters.search) {
    const pattern = `%${escapeLike(filters.search)}%`;
    clauses.push(
      `(
        o.name LIKE ? ESCAPE '='
        OR o.legal_name LIKE ? ESCAPE '='
        OR o.handle LIKE ? ESCAPE '='
      )`,
    );
    params.push(pattern, pattern, pattern);
  }

  if (filters.status) {
    clauses.push('e.access_status = ?');
    params.push(filters.status);
  }

  return {
    sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

const BASE_SELECT = `
  SELECT
    o.id AS organization_id,
    o.handle AS organization_handle,
    o.name AS organization_name,
    o.legal_name AS organization_legal_name,
    o.currency_code AS organization_currency_code,
    o.created_at AS organization_created_at,
    o.updated_at AS organization_updated_at,

    e.id AS entitlement_id,
    e.access_status AS entitlement_access_status,
    e.trial_started_at AS entitlement_trial_started_at,
    e.trial_ends_at AS entitlement_trial_ends_at,
    e.activated_at AS entitlement_activated_at,
    e.access_ends_at AS entitlement_access_ends_at,
    e.grace_ends_at AS entitlement_grace_ends_at,
    e.scheduled_suspension_at AS entitlement_scheduled_suspension_at,
    e.scheduled_suspension_reason AS entitlement_scheduled_suspension_reason,
    e.scheduled_suspension_customer_message AS entitlement_scheduled_suspension_customer_message,
    e.suspended_at AS entitlement_suspended_at,
    e.cancelled_at AS entitlement_cancelled_at,
    e.internal_reason AS entitlement_internal_reason,
    e.customer_message AS entitlement_customer_message,
    e.version AS entitlement_version,
    e.created_at AS entitlement_created_at,
    e.updated_at AS entitlement_updated_at
  FROM organizations o
  LEFT JOIN organization_entitlements e
    ON e.organization_id = o.id
`;

export interface PlatformOrganizationBranchRecord
  extends PlatformOrganizationBranchDetail {
  organizationId: number;
}

export interface PlatformOrganizationUserCounts {
  organizationId: number;
  activeUsers: number;
  activeStaff: number;
}


export interface PlatformOrganizationBusinessMatrixRecord {
  organizationId: number;
  observedDays: number;
  last30NetSales: number;
  last30ActiveSalesDays: number;
  last30FinalizedOrders: number;
  completedMonthNetSales: number;
  completedMonths: number;
  trailingNetSales: number;
  trailingObservedDays: number;
  trailingIsFull365DayWindow: boolean;
  lastBusinessActivityAt: string | null;
}

export interface PlatformOrganizationBusinessMetricsRecord {
  firstBusinessDate: string | null;
  lastBusinessDate: string | null;
  observedDays: number;
  last30NetSales: number;
  last30ActiveSalesDays: number;
  last30FinalizedOrders: number;
  completedMonthNetSales: number;
  completedMonths: number;
  trailingNetSales: number;
  trailingObservedDays: number;
  trailingIsFull365DayWindow: boolean;
  lastBusinessActivityAt: string | null;
}

export class PlatformOrganizationReadRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  public async listBasePage(
    filters: StableFilters & { limit: number; offset: number },
  ): Promise<{ rows: PlatformOrganizationBaseRecord[]; total: number }> {
    const where = stableWhere(filters);

    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `${BASE_SELECT}
       ${where.sql}
       ORDER BY o.created_at DESC, o.id DESC
       LIMIT ? OFFSET ?`,
      [...where.params, filters.limit, filters.offset],
    );

    const [countRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
         FROM organizations o
         LEFT JOIN organization_entitlements e
           ON e.organization_id = o.id
       ${where.sql}`,
      where.params,
    );

    return {
      rows: rows.map(mapBase),
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  /**
   * Used only when the caller filters by effective accessMode. accessMode is
   * time-derived and must be evaluated by the shared lifecycle resolver rather
   * than duplicated in SQL.
   */
  public async listBaseCandidates(
    filters: StableFilters,
  ): Promise<PlatformOrganizationBaseRecord[]> {
    const where = stableWhere(filters);
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `${BASE_SELECT}
       ${where.sql}
       ORDER BY o.created_at DESC, o.id DESC`,
      where.params,
    );
    return rows.map(mapBase);
  }

  public async findBaseById(
    organizationId: number,
  ): Promise<PlatformOrganizationBaseRecord | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `${BASE_SELECT}
       WHERE o.id = ?
       LIMIT 1`,
      [organizationId],
    );
    return rows.length ? mapBase(rows[0]) : null;
  }

  public async listBranchesForOrganizations(
    organizationIds: number[],
  ): Promise<PlatformOrganizationBranchRecord[]> {
    if (!organizationIds.length) return [];
    const placeholders = organizationIds.map(() => '?').join(',');

    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT
          id,
          organization_id,
          name,
          code,
          address,
          latitude,
          longitude,
          is_active,
          created_at
         FROM branches
        WHERE organization_id IN (${placeholders})
        ORDER BY
          organization_id ASC,
          is_active DESC,
          created_at ASC,
          id ASC`,
      organizationIds,
    );

    return rows.map(row => ({
      id: Number(row.id),
      organizationId: Number(row.organization_id),
      name: String(row.name),
      code: String(row.code),
      address: row.address == null ? null : String(row.address),
      latitude: row.latitude == null ? null : Number(row.latitude),
      longitude: row.longitude == null ? null : Number(row.longitude),
      isActive: toBool(row.is_active),
      createdAt: toIso(row.created_at),
    }));
  }

  public async listActiveUserCounts(
    organizationIds: number[],
  ): Promise<PlatformOrganizationUserCounts[]> {
    if (!organizationIds.length) return [];
    const placeholders = organizationIds.map(() => '?').join(',');

    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT
          u.organization_id,
          COUNT(*) AS active_users,
          SUM(CASE WHEN r.name <> 'OWNER' THEN 1 ELSE 0 END) AS active_staff
         FROM users u
         INNER JOIN roles r
           ON r.id = u.role_id
        WHERE u.organization_id IN (${placeholders})
          AND u.is_active = TRUE
        GROUP BY u.organization_id`,
      organizationIds,
    );

    return rows.map(row => ({
      organizationId: Number(row.organization_id),
      activeUsers: Number(row.active_users ?? 0),
      activeStaff: Number(row.active_staff ?? 0),
    }));
  }

  public async listBusinessMatrixMetrics(
    organizationIds: number[],
    asOfDate: string,
  ): Promise<PlatformOrganizationBusinessMatrixRecord[]> {
    if (!organizationIds.length) return [];

    const placeholders = organizationIds.map(() => '?').join(',');

    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `WITH
        params AS (
          SELECT CAST(? AS DATE) AS as_of_date
        ),
        selected_orgs AS (
          SELECT id AS organization_id
            FROM organizations
           WHERE id IN (${placeholders})
        ),
        filtered AS (
          SELECT
            b.organization_id,
            b.business_date,
            b.order_id,
            (b.subtotal - b.discount_total) AS net_sales,
            COALESCE(b.finalized_at, b.created_at) AS activity_at
          FROM bills b
          INNER JOIN selected_orgs so
            ON so.organization_id = b.organization_id
          CROSS JOIN params p
          WHERE b.status = 'FINALIZED'
            AND b.business_date <= p.as_of_date
        ),
        history AS (
          SELECT
            so.organization_id,
            MIN(f.business_date) AS first_business_date,
            MAX(f.business_date) AS last_business_date,
            UNIX_TIMESTAMP(MAX(f.activity_at))
              AS last_business_activity_epoch
          FROM selected_orgs so
          LEFT JOIN filtered f
            ON f.organization_id = so.organization_id
          GROUP BY so.organization_id
        ),
        windows AS (
          SELECT
            h.organization_id,
            h.first_business_date,
            h.last_business_date,
            h.last_business_activity_epoch,
            CASE
              WHEN h.first_business_date IS NULL THEN 0
              ELSE DATEDIFF(h.last_business_date, h.first_business_date) + 1
            END AS observed_days,
            DATE_SUB(p.as_of_date, INTERVAL 29 DAY) AS last30_start,
            DATE_SUB(p.as_of_date, INTERVAL 364 DAY) AS trailing365_start,
            STR_TO_DATE(
              DATE_FORMAT(p.as_of_date, '%Y-%m-01'),
              '%Y-%m-%d'
            ) AS current_month_start,
            CASE
              WHEN h.first_business_date IS NULL THEN NULL
              WHEN DAY(h.first_business_date) = 1
                THEN h.first_business_date
              ELSE DATE_ADD(LAST_DAY(h.first_business_date), INTERVAL 1 DAY)
            END AS completed_month_start
          FROM history h
          CROSS JOIN params p
        ),
        aggregates AS (
          SELECT
            w.organization_id,
            COALESCE(SUM(
              CASE
                WHEN f.business_date >= w.last30_start
                  THEN f.net_sales
                ELSE 0
              END
            ), 0) AS last30_net_sales,
            COUNT(DISTINCT CASE
              WHEN f.business_date >= w.last30_start
                THEN f.business_date
              ELSE NULL
            END) AS last30_active_sales_days,
            COUNT(DISTINCT CASE
              WHEN f.business_date >= w.last30_start
                THEN f.order_id
              ELSE NULL
            END) AS last30_finalized_orders,
            COALESCE(SUM(
              CASE
                WHEN w.completed_month_start IS NOT NULL
                  AND f.business_date >= w.completed_month_start
                  AND f.business_date < w.current_month_start
                  THEN f.net_sales
                ELSE 0
              END
            ), 0) AS completed_month_net_sales,
            COALESCE(SUM(
              CASE
                WHEN w.observed_days >= 365
                  THEN CASE
                    WHEN f.business_date >= w.trailing365_start
                      THEN f.net_sales
                    ELSE 0
                  END
                ELSE f.net_sales
              END
            ), 0) AS trailing_net_sales
          FROM windows w
          LEFT JOIN filtered f
            ON f.organization_id = w.organization_id
          GROUP BY w.organization_id
        )
        SELECT
          w.organization_id,
          w.observed_days,
          a.last30_net_sales,
          a.last30_active_sales_days,
          a.last30_finalized_orders,
          a.completed_month_net_sales,
          CASE
            WHEN w.completed_month_start IS NULL THEN 0
            ELSE GREATEST(
              TIMESTAMPDIFF(
                MONTH,
                w.completed_month_start,
                w.current_month_start
              ),
              0
            )
          END AS completed_months,
          a.trailing_net_sales,
          LEAST(w.observed_days, 365) AS trailing_observed_days,
          CASE WHEN w.observed_days >= 365 THEN 1 ELSE 0 END
            AS trailing_is_full_365_day_window,
          w.last_business_activity_epoch
        FROM windows w
        INNER JOIN aggregates a
          ON a.organization_id = w.organization_id
        ORDER BY w.organization_id ASC`,
      [asOfDate, ...organizationIds],
    );

    return rows.map(row => ({
      organizationId: Number(row.organization_id),
      observedDays: Number(row.observed_days ?? 0),
      last30NetSales: Number(row.last30_net_sales ?? 0),
      last30ActiveSalesDays: Number(row.last30_active_sales_days ?? 0),
      last30FinalizedOrders: Number(row.last30_finalized_orders ?? 0),
      completedMonthNetSales: Number(row.completed_month_net_sales ?? 0),
      completedMonths: Number(row.completed_months ?? 0),
      trailingNetSales: Number(row.trailing_net_sales ?? 0),
      trailingObservedDays: Number(row.trailing_observed_days ?? 0),
      trailingIsFull365DayWindow: toBool(
        row.trailing_is_full_365_day_window,
      ),
      lastBusinessActivityAt: (() => {
        const epoch = Number(row.last_business_activity_epoch);
        return Number.isFinite(epoch) && epoch > 0
          ? new Date(epoch * 1000).toISOString()
          : null;
      })(),
    }));
  }

  public async getBusinessMetrics(
    organizationId: number,
    asOfDate: string,
  ): Promise<PlatformOrganizationBusinessMetricsRecord> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `WITH
        params AS (
          SELECT CAST(? AS DATE) AS as_of_date
        ),
        filtered AS (
          SELECT
            b.business_date,
            b.order_id,
            (b.subtotal - b.discount_total) AS net_sales,
            COALESCE(b.finalized_at, b.created_at) AS activity_at
          FROM bills b
          CROSS JOIN params p
          WHERE b.organization_id = ?
            AND b.status = 'FINALIZED'
            AND b.business_date <= p.as_of_date
        ),
        history AS (
          SELECT
            MIN(business_date) AS first_business_date,
            MAX(business_date) AS last_business_date,
            MAX(activity_at) AS last_business_activity_at
          FROM filtered
        ),
        windows AS (
          SELECT
            h.first_business_date,
            h.last_business_date,
            h.last_business_activity_at,
            CASE
              WHEN h.first_business_date IS NULL THEN 0
              ELSE DATEDIFF(h.last_business_date, h.first_business_date) + 1
            END AS observed_days,
            DATE_SUB(p.as_of_date, INTERVAL 29 DAY) AS last30_start,
            DATE_SUB(p.as_of_date, INTERVAL 364 DAY) AS trailing365_start,
            STR_TO_DATE(
              DATE_FORMAT(p.as_of_date, '%Y-%m-01'),
              '%Y-%m-%d'
            ) AS current_month_start,
            CASE
              WHEN h.first_business_date IS NULL THEN NULL
              WHEN DAY(h.first_business_date) = 1
                THEN h.first_business_date
              ELSE DATE_ADD(LAST_DAY(h.first_business_date), INTERVAL 1 DAY)
            END AS completed_month_start
          FROM history h
          CROSS JOIN params p
        ),
        aggregates AS (
          SELECT
            COALESCE(SUM(
              CASE
                WHEN f.business_date >= w.last30_start
                  THEN f.net_sales
                ELSE 0
              END
            ), 0) AS last30_net_sales,
            COUNT(DISTINCT CASE
              WHEN f.business_date >= w.last30_start
                THEN f.business_date
              ELSE NULL
            END) AS last30_active_sales_days,
            COUNT(DISTINCT CASE
              WHEN f.business_date >= w.last30_start
                THEN f.order_id
              ELSE NULL
            END) AS last30_finalized_orders,
            COALESCE(SUM(
              CASE
                WHEN w.completed_month_start IS NOT NULL
                  AND f.business_date >= w.completed_month_start
                  AND f.business_date < w.current_month_start
                  THEN f.net_sales
                ELSE 0
              END
            ), 0) AS completed_month_net_sales,
            COALESCE(SUM(
              CASE
                WHEN w.observed_days >= 365
                  THEN CASE
                    WHEN f.business_date >= w.trailing365_start
                      THEN f.net_sales
                    ELSE 0
                  END
                ELSE f.net_sales
              END
            ), 0) AS trailing_net_sales
          FROM windows w
          LEFT JOIN filtered f ON TRUE
        )
        SELECT
          DATE_FORMAT(w.first_business_date, '%Y-%m-%d') AS first_business_date,
          DATE_FORMAT(w.last_business_date, '%Y-%m-%d') AS last_business_date,
          w.observed_days,
          a.last30_net_sales,
          a.last30_active_sales_days,
          a.last30_finalized_orders,
          a.completed_month_net_sales,
          CASE
            WHEN w.completed_month_start IS NULL THEN 0
            ELSE GREATEST(
              TIMESTAMPDIFF(
                MONTH,
                w.completed_month_start,
                w.current_month_start
              ),
              0
            )
          END AS completed_months,
          a.trailing_net_sales,
          LEAST(w.observed_days, 365) AS trailing_observed_days,
          CASE WHEN w.observed_days >= 365 THEN 1 ELSE 0 END
            AS trailing_is_full_365_day_window,
          w.last_business_activity_at
        FROM windows w
        CROSS JOIN aggregates a`,
      [asOfDate, organizationId],
    );

    const row = rows[0] as RowDataPacket | undefined;
    return {
      firstBusinessDate:
        row?.first_business_date == null
          ? null
          : String(row.first_business_date),
      lastBusinessDate:
        row?.last_business_date == null
          ? null
          : String(row.last_business_date),
      observedDays: Number(row?.observed_days ?? 0),
      last30NetSales: Number(row?.last30_net_sales ?? 0),
      last30ActiveSalesDays: Number(row?.last30_active_sales_days ?? 0),
      last30FinalizedOrders: Number(row?.last30_finalized_orders ?? 0),
      completedMonthNetSales: Number(row?.completed_month_net_sales ?? 0),
      completedMonths: Number(row?.completed_months ?? 0),
      trailingNetSales: Number(row?.trailing_net_sales ?? 0),
      trailingObservedDays: Number(row?.trailing_observed_days ?? 0),
      trailingIsFull365DayWindow: toBool(
        row?.trailing_is_full_365_day_window,
      ),
      lastBusinessActivityAt: toNullableIso(
        row?.last_business_activity_at,
      ),
    };
  }

  public async listOwnerContacts(
    organizationId: number,
  ): Promise<PlatformOrganizationOwnerContact[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT
          u.id,
          u.name,
          u.email,
          u.phone,
          u.is_active
         FROM users u
         INNER JOIN roles r
           ON r.id = u.role_id
        WHERE u.organization_id = ?
          AND r.name = 'OWNER'
        ORDER BY u.id ASC`,
      [organizationId],
    );

    return rows.map(row => ({
      userId: Number(row.id),
      name: String(row.name),
      email: row.email == null ? null : String(row.email),
      phone: row.phone == null ? null : String(row.phone),
      isActive: toBool(row.is_active),
    }));
  }

  public async listActiveAutomationFailures(
    organizationIds: number[],
  ): Promise<PlatformOrganizationAutomationFailureRecord[]> {
    if (!organizationIds.length) return [];
    const placeholders = organizationIds.map(() => '?').join(',');

    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT
          organization_id,
          automation_kind,
          first_failed_at,
          last_failed_at,
          failure_count,
          last_due_at,
          last_entitlement_version,
          last_error_code,
          last_error_summary
         FROM lifecycle_automation_attention
        WHERE organization_id IN (${placeholders})
          AND resolved_at IS NULL
        ORDER BY organization_id ASC, last_failed_at DESC, id DESC`,
      organizationIds,
    );

    return rows.map(row => ({
      organizationId: Number(row.organization_id),
      kind: String(row.automation_kind) as PlatformOrganizationAutomationFailureRecord['kind'],
      failureCount: Number(row.failure_count),
      firstFailedAt: toIso(row.first_failed_at),
      lastFailedAt: toIso(row.last_failed_at),
      dueAt: toIso(row.last_due_at),
      entitlementVersion: Number(row.last_entitlement_version),
      errorCode: String(row.last_error_code),
      errorSummary: String(row.last_error_summary),
    }));
  }

  public async findCurrentSecuritySuspensionContext(
    organizationId: number,
  ): Promise<PlatformOrganizationSecuritySuspensionContext | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT
          h.from_status,
          h.effective_at,
          a.id AS actor_id,
          a.name AS actor_name,
          a.email AS actor_email
         FROM organization_status_history h
         LEFT JOIN platform_admins a
           ON a.id = h.platform_admin_id
        WHERE h.organization_id = ?
          AND h.to_status = 'SECURITY_SUSPENDED'
        ORDER BY h.id DESC
        LIMIT 1`,
      [organizationId],
    );

    if (!rows.length || rows[0].from_status == null) return null;

    const originStatus = String(rows[0].from_status);
    if (
      originStatus !== 'ACTIVE'
      && originStatus !== 'GRACE_PERIOD'
      && originStatus !== 'SUSPENDED'
    ) {
      return null;
    }

    return {
      originStatus,
      effectiveAt: toIso(rows[0].effective_at),
      actor:
        rows[0].actor_id == null
          ? null
          : {
              id: Number(rows[0].actor_id),
              name: String(rows[0].actor_name),
              email: String(rows[0].actor_email),
            },
    };
  }

}

export const platformOrganizationReadRepository =
  new PlatformOrganizationReadRepository();
