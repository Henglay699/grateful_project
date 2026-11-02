import type { ErrorCode } from '@gs/shared';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'VALIDATION_ERROR', message, details);
export const unauthenticated = (message = 'Sign in to continue') =>
  new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'Your role does not allow this action') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (entity: string) => new AppError(404, 'NOT_FOUND', `${entity} not found`);
export const conflict = (message: string, details?: unknown) =>
  new AppError(409, 'CONFLICT', message, details);
export const businessRule = (message: string, details?: unknown) =>
  new AppError(422, 'BUSINESS_RULE', message, details);
