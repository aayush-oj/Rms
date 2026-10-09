import { NotFoundError } from '../../shared/errors';
import { evaluateOrganizationEntitlement } from '../organizationAccess/service';
import type { EffectiveOrganizationAccess } from '../organizationAccess/types';
import {
  PlatformOrganizationReadRepository,
  platformOrganizationReadRepository,
  type PlatformOrganizationBranchRecord,
  type PlatformOrganizationBusinessMatrixRecord,
  type PlatformOrganizationBusinessMetricsRecord,
} from './organizationReadRepository';
import type {
  PlatformOrganizationAccessSummary,
  PlatformOrganizationAutomationAttentionSummary,
  PlatformOrganizationAutomationFailure,
  PlatformOrganizationAutomationFailureRecord,
  PlatformOrganizationBaseRecord,
  PlatformOrganizationBranchDetail,
  PlatformOrganizationBusinessMatrix,
  PlatformOrganizationBusinessProfile,
  PlatformOrganizationCounts,
  PlatformOrganizationDetail,
  PlatformOrganizationListFilters,
  PlatformOrganizationListResult,
  PlatformOrganizationPrimaryBranch,
  PlatformOrganizationSummary,
} from './organizationReadTypes';

interface NormalizedListFilters
  extends Required<Pick<PlatformOrganizationListFilters, 'limit' | 'offset'>> {
  search?: string;
  status?: PlatformOrganizationListFilters['status'];
  accessMode?: PlatformOrganizationListFilters['accessMode'];
}

function positiveInteger(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
}

function normalizeFilters(
  input: PlatformOrganizationListFilters,
): NormalizedListFilters {
  const search = input.search?.trim().slice(0, 100);
  return {
    search: search || undefined,
    status: input.status,
    accessMode: input.accessMode,
    limit: positiveInteger(input.limit, 25, 100),
    offset: nonNegativeInteger(input.offset, 0),
  };
}

function accessSummary(
  access: EffectiveOrganizationAccess,
): PlatformOrganizationAccessSummary {
  return {
    configuredStatus: access.configuredStatus,
    accessMode: access.accessMode,
    canOperate: access.canOperate,
    blockingReason: access.blockingReason,
    trialEndsAt: access.trialEndsAt,
    accessEndsAt: access.accessEndsAt,
    graceEndsAt: access.graceEndsAt,
    scheduledSuspensionAt: access.scheduledSuspensionAt,
    evaluatedAt: access.evaluatedAt,
  };
}

function branchGroups(
  branches: PlatformOrganizationBranchRecord[],
): Map<number, PlatformOrganizationBranchRecord[]> {
  const grouped = new Map<number, PlatformOrganizationBranchRecord[]>();
  for (const branch of branches) {
    const current = grouped.get(branch.organizationId) ?? [];
    current.push(branch);
    grouped.set(branch.organizationId, current);
  }
  return grouped;
}

function automationFailureGroups(
  failures: PlatformOrganizationAutomationFailureRecord[],
): Map<number, PlatformOrganizationAutomationFailureRecord[]> {
  const grouped =
    new Map<number, PlatformOrganizationAutomationFailureRecord[]>();
  for (const failure of failures) {
    const current = grouped.get(failure.organizationId) ?? [];
    current.push(failure);
    grouped.set(failure.organizationId, current);
  }
  return grouped;
}

function automationAttentionSummary(
  failures: PlatformOrganizationAutomationFailureRecord[],
): PlatformOrganizationAutomationAttentionSummary {
  return {
    activeCount: failures.length,
    totalFailureCount: failures.reduce(
      (total, failure) => total + failure.failureCount,
      0,
    ),
    lastFailedAt: failures[0]?.lastFailedAt ?? null,
  };
}

function publicAutomationFailures(
  failures: PlatformOrganizationAutomationFailureRecord[],
): PlatformOrganizationAutomationFailure[] {
  return failures.map(failure => ({
    kind: failure.kind,
    failureCount: failure.failureCount,
    firstFailedAt: failure.firstFailedAt,
    lastFailedAt: failure.lastFailedAt,
    dueAt: failure.dueAt,
    entitlementVersion: failure.entitlementVersion,
    errorCode: failure.errorCode,
    errorSummary: failure.errorSummary,
  }));
}

function primaryBranch(
  branches: PlatformOrganizationBranchRecord[],
): PlatformOrganizationPrimaryBranch | null {
  const branch = branches[0];
  if (!branch) return null;
  return {
    id: branch.id,
    name: branch.name,
    code: branch.code,
    address: branch.address,
    latitude: branch.latitude,
    longitude: branch.longitude,
    isActive: branch.isActive,
  };
}

function asOfDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function businessMatrix(
  metrics: PlatformOrganizationBusinessMatrixRecord | PlatformOrganizationBusinessMetricsRecord,
): PlatformOrganizationBusinessMatrix {
  const activeSalesDays = metrics.last30ActiveSalesDays;
  const finalizedOrders = metrics.last30FinalizedOrders;
  const completedMonths = metrics.completedMonths;

  return {
    observedDays: metrics.observedDays,
    last30NetSales: metrics.last30NetSales,
    averageMonthlyNetSales:
      completedMonths > 0
        ? metrics.completedMonthNetSales / completedMonths
        : null,
    averageDailyNetSales:
      activeSalesDays > 0
        ? metrics.last30NetSales / activeSalesDays
        : null,
    averageOrdersPerActiveDay:
      activeSalesDays > 0
        ? finalizedOrders / activeSalesDays
        : null,
    netAverageOrderValue:
      finalizedOrders > 0
        ? metrics.last30NetSales / finalizedOrders
        : null,
    trailingNetSales: metrics.trailingNetSales,
    trailingObservedDays: metrics.trailingObservedDays,
    trailingIsFull365DayWindow: metrics.trailingIsFull365DayWindow,
    lastBusinessActivityAt: metrics.lastBusinessActivityAt,
  };
}

function businessProfile(
  metrics: PlatformOrganizationBusinessMetricsRecord,
): PlatformOrganizationBusinessProfile {
  const activeSalesDays = metrics.last30ActiveSalesDays;
  const finalizedOrders = metrics.last30FinalizedOrders;
  const completedMonths = metrics.completedMonths;

  return {
    observedHistory: {
      firstBusinessDate: metrics.firstBusinessDate,
      lastBusinessDate: metrics.lastBusinessDate,
      observedDays: metrics.observedDays,
    },
    last30Days: {
      netSales: metrics.last30NetSales,
      activeSalesDays,
      finalizedOrders,
      averageDailyNetSales:
        activeSalesDays > 0
          ? metrics.last30NetSales / activeSalesDays
          : null,
      averageOrdersPerActiveDay:
        activeSalesDays > 0
          ? finalizedOrders / activeSalesDays
          : null,
      netAverageOrderValue:
        finalizedOrders > 0
          ? metrics.last30NetSales / finalizedOrders
          : null,
    },
    monthly: {
      averageNetSales:
        completedMonths > 0
          ? metrics.completedMonthNetSales / completedMonths
          : null,
      completedMonths,
    },
    trailing: {
      netSales: metrics.trailingNetSales,
      observedDays: metrics.trailingObservedDays,
      isFull365DayWindow: metrics.trailingIsFull365DayWindow,
    },
    lastBusinessActivityAt: metrics.lastBusinessActivityAt,
  };
}

function publicBranches(
  branches: PlatformOrganizationBranchRecord[],
): PlatformOrganizationBranchDetail[] {
  return branches.map(branch => ({
    id: branch.id,
    name: branch.name,
    code: branch.code,
    address: branch.address,
    latitude: branch.latitude,
    longitude: branch.longitude,
    isActive: branch.isActive,
    createdAt: branch.createdAt,
  }));
}

export class PlatformOrganizationReadService {
  constructor(
    private readonly repository: PlatformOrganizationReadRepository =
      platformOrganizationReadRepository,
  ) {}

  public async listOrganizations(
    input: PlatformOrganizationListFilters = {},
    now: Date = new Date(),
  ): Promise<PlatformOrganizationListResult> {
    const filters = normalizeFilters(input);
    const stableFilters = {
      search: filters.search,
      status: filters.status,
    };

    let baseRows: PlatformOrganizationBaseRecord[];
    let total: number;

    if (filters.accessMode) {
      // Effective access is deliberately evaluated through the shared lifecycle
      // resolver instead of duplicating expiry/grace/suspension rules in SQL.
      // This scan is the correctness-first initial implementation; profile
      // before introducing any future access projection.
      const candidates = await this.repository.listBaseCandidates(stableFilters);
      const filtered = candidates.filter(candidate =>
        evaluateOrganizationEntitlement(
          candidate.entitlement,
          candidate.id,
          now,
        ).accessMode === filters.accessMode
      );
      total = filtered.length;
      baseRows = filtered.slice(filters.offset, filters.offset + filters.limit);
    } else {
      const page = await this.repository.listBasePage({
        ...stableFilters,
        limit: filters.limit,
        offset: filters.offset,
      });
      baseRows = page.rows;
      total = page.total;
    }

    const items = await this.composeSummaries(baseRows, now);

    return {
      items,
      pagination: {
        total,
        limit: filters.limit,
        offset: filters.offset,
      },
    };
  }

  public async getOrganization(
    organizationId: number,
    now: Date = new Date(),
  ): Promise<PlatformOrganizationDetail> {
    if (!Number.isInteger(organizationId) || organizationId <= 0) {
      throw new NotFoundError(
        'Platform organization not found',
        'PLATFORM_ORGANIZATION_NOT_FOUND',
      );
    }

    const base = await this.repository.findBaseById(organizationId);
    if (!base) {
      throw new NotFoundError(
        'Platform organization not found',
        'PLATFORM_ORGANIZATION_NOT_FOUND',
      );
    }

    const [
      branches,
      userCounts,
      ownerContacts,
      securitySuspension,
      automationFailures,
      businessMetrics,
    ] = await Promise.all([
      this.repository.listBranchesForOrganizations([organizationId]),
      this.repository.listActiveUserCounts([organizationId]),
      this.repository.listOwnerContacts(organizationId),
      base.entitlement?.accessStatus === 'SECURITY_SUSPENDED'
        ? this.repository.findCurrentSecuritySuspensionContext(organizationId)
        : Promise.resolve(null),
      this.repository.listActiveAutomationFailures([organizationId]),
      this.repository.getBusinessMetrics(
        organizationId,
        asOfDate(now),
      ),
    ]);

    const access = evaluateOrganizationEntitlement(
      base.entitlement,
      organizationId,
      now,
    );
    const counts = this.countsFor(
      organizationId,
      branches,
      userCounts,
    );

    return {
      ...this.summaryFrom(
        base,
        branches,
        counts,
        access,
        automationFailures,
        businessMatrix(businessMetrics),
      ),
      updatedAt: base.updatedAt,
      ownerContacts,
      branches: publicBranches(branches),
      entitlement: base.entitlement,
      securitySuspension,
      automationFailures: publicAutomationFailures(automationFailures),
      businessProfile: businessProfile(businessMetrics),
    };
  }

  private async composeSummaries(
    baseRows: PlatformOrganizationBaseRecord[],
    now: Date,
  ): Promise<PlatformOrganizationSummary[]> {
    if (!baseRows.length) return [];

    const organizationIds = baseRows.map(row => row.id);
    const [branches, userCounts, automationFailures, matrixMetrics] =
      await Promise.all([
        this.repository.listBranchesForOrganizations(organizationIds),
        this.repository.listActiveUserCounts(organizationIds),
        this.repository.listActiveAutomationFailures(organizationIds),
        this.repository.listBusinessMatrixMetrics(
          organizationIds,
          asOfDate(now),
        ),
      ]);
    const groupedBranches = branchGroups(branches);
    const groupedAutomationFailures =
      automationFailureGroups(automationFailures);
    const matrixByOrganization = new Map(
      matrixMetrics.map(metrics => [metrics.organizationId, metrics]),
    );

    return baseRows.map(base => {
      const organizationBranches = groupedBranches.get(base.id) ?? [];
      const access = evaluateOrganizationEntitlement(
        base.entitlement,
        base.id,
        now,
      );
      const counts = this.countsFor(
        base.id,
        organizationBranches,
        userCounts,
      );
      return this.summaryFrom(
        base,
        organizationBranches,
        counts,
        access,
        groupedAutomationFailures.get(base.id) ?? [],
        businessMatrix(
          matrixByOrganization.get(base.id) ?? {
            organizationId: base.id,
            observedDays: 0,
            last30NetSales: 0,
            last30ActiveSalesDays: 0,
            last30FinalizedOrders: 0,
            completedMonthNetSales: 0,
            completedMonths: 0,
            trailingNetSales: 0,
            trailingObservedDays: 0,
            trailingIsFull365DayWindow: false,
            lastBusinessActivityAt: null,
          },
        ),
      );
    });
  }

  private countsFor(
    organizationId: number,
    branches: PlatformOrganizationBranchRecord[],
    userCounts: Array<{
      organizationId: number;
      activeUsers: number;
      activeStaff: number;
    }>,
  ): PlatformOrganizationCounts {
    const users = userCounts.find(row => row.organizationId === organizationId);
    return {
      branches: branches.length,
      activeBranches: branches.filter(branch => branch.isActive).length,
      activeUsers: users?.activeUsers ?? 0,
      activeStaff: users?.activeStaff ?? 0,
    };
  }

  private summaryFrom(
    base: PlatformOrganizationBaseRecord,
    branches: PlatformOrganizationBranchRecord[],
    counts: PlatformOrganizationCounts,
    access: EffectiveOrganizationAccess,
    automationFailures: PlatformOrganizationAutomationFailureRecord[],
    matrix: PlatformOrganizationBusinessMatrix,
  ): PlatformOrganizationSummary {
    return {
      id: base.id,
      handle: base.handle,
      name: base.name,
      legalName: base.legalName,
      currencyCode: base.currencyCode,
      registeredAt: base.registeredAt,
      primaryBranch: primaryBranch(branches),
      counts,
      access: accessSummary(access),
      automationAttention: automationAttentionSummary(automationFailures),
      businessMatrix: matrix,
    };
  }
}

export const platformOrganizationReadService =
  new PlatformOrganizationReadService();
