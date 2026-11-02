import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorBody } from '@gs/shared';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

interface PgError {
  code?: string;
  constraint?: string;
  detail?: string;
  hint?: string;
  message?: string;
}

function fromPg(err: PgError): AppError | null {
  switch (err.code) {
    case '23505':
      return new AppError(409, 'CONFLICT', 'A record with the same value already exists', {
        constraint: err.constraint,
        detail: err.detail,
      });
    case '23503':
      return new AppError(409, 'CONFLICT', 'This record is linked to other records', {
        constraint: err.constraint,
      });
    case '23514':
      return new AppError(422, 'BUSINESS_RULE', 'A value breaks a business rule', {
        constraint: err.constraint,
      });
    case 'P0001':
      return new AppError(422, 'BUSINESS_RULE', err.message ?? 'Business rule violated', {
        rule: err.hint,
      });
    case '22P02':
    case '22007':
    case '22008':
      return new AppError(400, 'VALIDATION_ERROR', 'A value has the wrong format', {
        detail: err.message,
      });
    default:
      return null;
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  const body: ApiErrorBody = {
    error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` },
  };
  res.status(404).json(body);
}

// Express recognises error handlers by their 4 arguments.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const pgCause = (err as { cause?: PgError })?.cause ?? (err as PgError);
  const appErr =
    err instanceof AppError
      ? err
      : (fromPg(pgCause) ??
        ((err as { type?: string })?.type === 'entity.parse.failed'
          ? new AppError(400, 'VALIDATION_ERROR', 'Request body is not valid JSON')
          : (err as { type?: string })?.type === 'entity.too.large'
            ? new AppError(413 as number, 'VALIDATION_ERROR', 'Request body is too large')
            : null));

  const multerCode =
    (err as { name?: string; code?: string })?.name === 'MulterError'
      ? (err as { code?: string }).code
      : undefined;
  if (!appErr && multerCode) {
    const body: ApiErrorBody = {
      error: {
        code: 'VALIDATION_ERROR',
        message:
          multerCode === 'LIMIT_FILE_SIZE'
            ? 'The file is larger than 5 MB'
            : `Upload problem: ${multerCode}`,
      },
    };
    res.status(multerCode === 'LIMIT_FILE_SIZE' ? 413 : 400).json(body);
    return;
  }
  if (!appErr) {
    logger.error({ err, reqId: req.id }, 'Unhandled error');
    const body: ApiErrorBody = {
      error: { code: 'INTERNAL', message: 'Something went wrong on the server. Try again.' },
    };
    res.status(500).json(body);
    return;
  }
  if (appErr.status >= 500) logger.error({ err, reqId: req.id }, appErr.message);
  const body: ApiErrorBody = {
    error: {
      code: appErr.code,
      message: appErr.message,
      ...(appErr.details !== undefined ? { details: appErr.details } : {}),
    },
  };
  res.status(appErr.status).json(body);
}
