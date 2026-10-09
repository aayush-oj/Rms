import type { NextFunction, Request, Response } from 'express';
import type { ApiSuccessResponse } from '../../shared/types';
import {
  PlatformOrganizationSuspensionScheduleService,
  platformOrganizationSuspensionScheduleService,
} from './organizationSuspensionScheduleService';

interface ScheduleSuspensionBody {
  expectedVersion: number;
  scheduledSuspensionAt: Date;
  reason: string;
  customerMessage?: string | null;
}

interface CancelScheduledSuspensionBody {
  expectedVersion: number;
  reason: string;
  customerMessage?: string | null;
}

export class PlatformOrganizationSuspensionScheduleController {
  constructor(
    private readonly service:
      PlatformOrganizationSuspensionScheduleService =
      platformOrganizationSuspensionScheduleService,
  ) {}

  private response(
    organizationId: number,
    entitlement: Awaited<
      ReturnType<PlatformOrganizationSuspensionScheduleService['schedule']>
    >,
  ): ApiSuccessResponse {
    return {
      success: true,
      data: {
        organizationId,
        entitlement,
      },
    };
  }

  private requestMetadata(req: Request) {
    return {
      platformAdminId: req.platformAdmin!.admin.id,
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
      requestId: req.id,
    };
  }

  public schedule = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const organizationId = Number(req.params.organizationId);
      const body = req.body as ScheduleSuspensionBody;

      const entitlement = await this.service.schedule({
        organizationId,
        expectedVersion: body.expectedVersion,
        scheduledSuspensionAt: body.scheduledSuspensionAt,
        reason: body.reason,
        customerMessage: body.customerMessage,
        ...this.requestMetadata(req),
      });

      res.status(200).json(this.response(organizationId, entitlement));
    } catch (error) {
      next(error);
    }
  };

  public reschedule = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const organizationId = Number(req.params.organizationId);
      const body = req.body as ScheduleSuspensionBody;

      const entitlement = await this.service.reschedule({
        organizationId,
        expectedVersion: body.expectedVersion,
        scheduledSuspensionAt: body.scheduledSuspensionAt,
        reason: body.reason,
        customerMessage: body.customerMessage,
        ...this.requestMetadata(req),
      });

      res.status(200).json(this.response(organizationId, entitlement));
    } catch (error) {
      next(error);
    }
  };

  public cancel = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const organizationId = Number(req.params.organizationId);
      const body = req.body as CancelScheduledSuspensionBody;

      const entitlement = await this.service.cancel({
        organizationId,
        expectedVersion: body.expectedVersion,
        reason: body.reason,
        customerMessage: body.customerMessage,
        ...this.requestMetadata(req),
      });

      res.status(200).json(this.response(organizationId, entitlement));
    } catch (error) {
      next(error);
    }
  };
}

export const platformOrganizationSuspensionScheduleController =
  new PlatformOrganizationSuspensionScheduleController();
