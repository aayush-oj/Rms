import type { NextFunction, Request, Response } from 'express';
import type { ApiSuccessResponse } from '../../shared/types';
import {
  PlatformOrganizationReadService,
  platformOrganizationReadService,
} from './organizationReadService';
import type {
  PlatformOrganizationListFilters,
} from './organizationReadTypes';

export class PlatformOrganizationReadController {
  constructor(
    private readonly service: PlatformOrganizationReadService =
      platformOrganizationReadService,
  ) {}

  public list = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.service.listOrganizations(
        req.query as unknown as PlatformOrganizationListFilters,
      );

      const response: ApiSuccessResponse = {
        success: true,
        data: result,
      };
      res.status(200).json(response);
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
      const organizationId = Number(req.params.organizationId);
      const result = await this.service.getOrganization(organizationId);

      const response: ApiSuccessResponse = {
        success: true,
        data: result,
      };
      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };
}

export const platformOrganizationReadController =
  new PlatformOrganizationReadController();
