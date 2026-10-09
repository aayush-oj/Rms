import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { ValidationError } from '../shared/errors';

export interface RequestValidationSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

export function validateRequest(schemas: RequestValidationSchemas) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (schemas.params) {
        req.params = (await schemas.params.parseAsync(req.params)) as typeof req.params;
      }
      if (schemas.query) {
        req.query = (await schemas.query.parseAsync(req.query)) as typeof req.query;
      }
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedIssues = error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        }));
        next(new ValidationError('Request validation failed', formattedIssues));
      } else {
        next(error);
      }
    }
  };
}
