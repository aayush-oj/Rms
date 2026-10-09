import type { NextFunction, Request, Response } from 'express';
import type { ApiSuccessResponse } from '../../shared/types';
import {
  PlatformActivationRequestReadService,
  platformActivationRequestReadService,
} from './activationRequestReadService';
import type {
  PlatformActivationRequestListFilters,
} from './activationRequestReadTypes';

export class PlatformActivationRequestReadController {
  constructor(
    private readonly service:
      PlatformActivationRequestReadService =
        platformActivationRequestReadService,
  ) {}

  public list = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const data = await this.service.list(
        req.query as unknown as PlatformActivationRequestListFilters,
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
      const data = await this.service.detail(Number(req.params.requestId));
      res.status(200).json({
        success: true,
        data,
      } satisfies ApiSuccessResponse<any>);
    } catch (error) {
      next(error);
    }
  };
}

export const platformActivationRequestReadController =
  new PlatformActivationRequestReadController();
