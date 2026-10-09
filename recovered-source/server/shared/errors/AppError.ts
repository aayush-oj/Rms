export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(message: string, statusCode = 500, errorCode = 'INTERNAL_ERROR', details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad Request', errorCode = 'BAD_REQUEST', details?: unknown) {
    super(message, 400, errorCode, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', errorCode = 'UNAUTHORIZED', details?: unknown) {
    super(message, 401, errorCode, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', errorCode = 'FORBIDDEN', details?: unknown) {
    super(message, 403, errorCode, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource Not Found', errorCode = 'NOT_FOUND', details?: unknown) {
    super(message, 404, errorCode, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', errorCode = 'CONFLICT', details?: unknown) {
    super(message, 409, errorCode, details);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation Error', details?: unknown) {
    super(message, 422, 'VALIDATION_ERROR', details);
  }
}

export class InternalServerError extends AppError {
  constructor(message = 'Internal Server Error', errorCode = 'INTERNAL_SERVER_ERROR', details?: unknown) {
    super(message, 500, errorCode, details);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests', errorCode = 'RATE_LIMITED', details?: unknown) {
    super(message, 429, errorCode, details);
  }
}
