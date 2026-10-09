import type { NextFunction, Request, Response } from 'express';
import type { ApiSuccessResponse } from '../../shared/types';
import { safeAccessStatusResult } from './accessStatusAuth';

export const accessStatusController = {
  me: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = req.accessStatus!;
      res.status(200).json({
        success: true,
        data: safeAccessStatusResult(context),
      } satisfies ApiSuccessResponse<any>);
    } catch (error) {
      next(error);
    }
  },
};
