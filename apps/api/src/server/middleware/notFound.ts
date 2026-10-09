import { Request, Response, NextFunction } from 'express';
import { NotFoundError } from '../shared/errors';

export function notFoundMiddleware(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found.`));
}
