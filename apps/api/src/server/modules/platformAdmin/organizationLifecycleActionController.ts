import type { NextFunction, Request, Response } from 'express';
import type { ApiSuccessResponse } from '../../shared/types';
import {
  PlatformOrganizationLifecycleActionService,
  platformOrganizationLifecycleActionService,
} from './organizationLifecycleActionService';

interface CommonActionBody {
  expectedVersion: number;
  reason: string;
  customerMessage?: string | null;
}

interface ActiveActionBody extends CommonActionBody {
  accessEndsAt: Date | null;
}

interface StartGraceBody extends CommonActionBody {
  graceEndsAt: Date;
}

export class PlatformOrganizationLifecycleActionController {
  constructor(
    private readonly service: PlatformOrganizationLifecycleActionService =
      platformOrganizationLifecycleActionService,
  ) {}

  private response(
    organizationId: number,
    entitlement: Awaited<
      ReturnType<PlatformOrganizationLifecycleActionService['activate']>
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

  public activate = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const organizationId = Number(req.params.organizationId);
      const body = req.body as ActiveActionBody;
      const entitlement = await this.service.activate({
        organizationId,
        expectedVersion: body.expectedVersion,
        reason: body.reason,
        customerMessage: body.customerMessage,
        accessEndsAt: body.accessEndsAt,
        platformAdminId: req.platformAdmin!.admin.id,
      });

      res.status(200).json(this.response(organizationId, entitlement));
    } catch (error) {
      next(error);
    }
  };

  public suspend = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const organizationId = Number(req.params.organizationId);
      const body = req.body as CommonActionBody;
      const entitlement = await this.service.suspend({
        organizationId,
        expectedVersion: body.expectedVersion,
        reason: body.reason,
        customerMessage: body.customerMessage,
        platformAdminId: req.platformAdmin!.admin.id,
      });

      res.status(200).json(this.response(organizationId, entitlement));
    } catch (error) {
      next(error);
    }
  };

  public reactivate = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const organizationId = Number(req.params.organizationId);
      const body = req.body as ActiveActionBody;
      const entitlement = await this.service.reactivate({
        organizationId,
        expectedVersion: body.expectedVersion,
        reason: body.reason,
        customerMessage: body.customerMessage,
        accessEndsAt: body.accessEndsAt,
        platformAdminId: req.platformAdmin!.admin.id,
      });

      res.status(200).json(this.response(organizationId, entitlement));
    } catch (error) {
      next(error);
    }
  };


  public startGrace = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const organizationId = Number(req.params.organizationId);
      const body = req.body as StartGraceBody;
      const entitlement = await this.service.startGrace({
        organizationId,
        expectedVersion: body.expectedVersion,
        reason: body.reason,
        customerMessage: body.customerMessage,
        graceEndsAt: body.graceEndsAt,
        platformAdminId: req.platformAdmin!.admin.id,
      });

      res.status(200).json(this.response(organizationId, entitlement));
    } catch (error) {
      next(error);
    }
  };

  public endGrace = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const organizationId = Number(req.params.organizationId);
      const body = req.body as ActiveActionBody;
      const entitlement = await this.service.endGrace({
        organizationId,
        expectedVersion: body.expectedVersion,
        reason: body.reason,
        customerMessage: body.customerMessage,
        accessEndsAt: body.accessEndsAt,
        platformAdminId: req.platformAdmin!.admin.id,
      });

      res.status(200).json(this.response(organizationId, entitlement));
    } catch (error) {
      next(error);
    }
  };
}

export const platformOrganizationLifecycleActionController =
  new PlatformOrganizationLifecycleActionController();
