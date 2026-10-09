import type { NextFunction, Request, Response } from 'express';
import type { ApiSuccessResponse } from '../../shared/types';
import {
  PlatformAuditReadService,
  platformAuditReadService,
} from './platformAuditReadService';
import type { PlatformAuditListFilters } from './platformAuditReadTypes';

export class PlatformAuditReadController {
  constructor(
    private readonly service:
      PlatformAuditReadService = platformAuditReadService,
  ) {}

  public list = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const data = await this.service.list(
        req.query as unknown as PlatformAuditListFilters,
      );
      res.status(200).json({
        success: true,
        data,
      } satisfies ApiSuccessResponse<any>);
    } catch (error) {
      next(error);
    }
  };

  public detail = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const data = await this.service.detail(Number(req.params.auditId));
      res.status(200).json({
        success: true,
        data,
      } satisfies ApiSuccessResponse<any>);
    } catch (error) {
      next(error);
    }
  };
}

export const platformAuditReadController =
  new PlatformAuditReadController();
