import type {
  NextFunction,
  Request,
  Response,
} from 'express';
import type { ApiSuccessResponse } from '../../shared/types';
import {
  organizationActivationRequestService,
  type OrganizationActivationRequestService,
} from './service';

export class OrganizationActivationRequestController {
  constructor(
    private readonly service:
      OrganizationActivationRequestService =
        organizationActivationRequestService,
  ) {}

  public current = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const data = await this.service.current(req.accessStatus!);
      res.status(200).json({
        success: true,
        data,
      } satisfies ApiSuccessResponse<any>);
    } catch (error) {
      next(error);
    }
  };

  public submit = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const data = await this.service.submit(
        req.accessStatus!,
        req.body.note,
      );
      res.status(201).json({
        success: true,
        data,
      } satisfies ApiSuccessResponse<any>);
    } catch (error) {
      next(error);
    }
  };
}

export const organizationActivationRequestController =
  new OrganizationActivationRequestController();
