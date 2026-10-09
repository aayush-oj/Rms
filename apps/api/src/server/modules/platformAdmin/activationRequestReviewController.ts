import type { NextFunction, Request, Response } from 'express';
import type { ApiSuccessResponse } from '../../shared/types';
import {
  PlatformActivationRequestReviewService,
  platformActivationRequestReviewService,
} from './activationRequestReviewService';

interface ApproveBody {
  expectedVersion: number;
  reason: string;
  customerMessage?: string | null;
}

interface ApproveUntilBody extends ApproveBody {
  accessEndsAt: Date;
}

interface RejectBody {
  reviewNote: string;
}

export class PlatformActivationRequestReviewController {
  constructor(
    private readonly service:
      PlatformActivationRequestReviewService =
        platformActivationRequestReviewService,
  ) {}

  private metadata(req: Request) {
    return {
      platformAdminId: req.platformAdmin!.admin.id,
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
      requestIdHeader: req.id,
    };
  }

  public approve = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const body = req.body as ApproveBody;
      const data = await this.service.approve({
        requestId: Number(req.params.requestId),
        expectedVersion: body.expectedVersion,
        reason: body.reason,
        customerMessage: body.customerMessage,
        ...this.metadata(req),
      });
      res.status(200).json({
        success: true,
        data,
      } satisfies ApiSuccessResponse<any>);
    } catch (error) {
      next(error);
    }
  };

  public approveUntil = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const body = req.body as ApproveUntilBody;
      const data = await this.service.approveUntil({
        requestId: Number(req.params.requestId),
        expectedVersion: body.expectedVersion,
        accessEndsAt: body.accessEndsAt,
        reason: body.reason,
        customerMessage: body.customerMessage,
        ...this.metadata(req),
      });
      res.status(200).json({
        success: true,
        data,
      } satisfies ApiSuccessResponse<any>);
    } catch (error) {
      next(error);
    }
  };

  public reject = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const body = req.body as RejectBody;
      const data = await this.service.reject({
        requestId: Number(req.params.requestId),
        reviewNote: body.reviewNote,
        ...this.metadata(req),
      });
      res.status(200).json({
        success: true,
        data,
      } satisfies ApiSuccessResponse<any>);
    } catch (error) {
      next(error);
    }
  };
}

export const platformActivationRequestReviewController =
  new PlatformActivationRequestReviewController();
