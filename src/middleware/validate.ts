import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodSchema } from 'zod';
import { StorageConflictError } from '../storage/dynamodb';

// ─── Zod Validation Middleware ────────────────────────────────────────────────

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const errors = (result.error as ZodError).issues.map(e => ({
        field: e.path.join('.'),
        message: e.message,
      }));

      res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors,
      });
      return;
    }

    req.body = result.data;
    next();
  };
}

// ─── Global Error Handler ─────────────────────────────────────────────────────

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const route = req.route?.path || req.path.replace(/(\/api\/invites)\/[^/]+/, '$1/[redacted]');
  console.error(`[ERROR] ${req.method} ${route}:`, err.message);

  const declaredStatus = Number((err as any).status || (err as any).statusCode);
  const status = err instanceof StorageConflictError ? 409 : err instanceof ZodError ? 400
    : declaredStatus >= 400 && declaredStatus < 500 ? declaredStatus : 500;
  res.status(status).json({
    success: false,
    message: status === 409 && err instanceof StorageConflictError ? 'This record changed or duplicates an existing record. Refresh and try again.' : status === 400 && err instanceof ZodError ? 'Invalid input.' : process.env.NODE_ENV === 'production' && status === 500
      ? 'Internal server error'
      : err.message,
  });
}

// ─── 404 Handler ─────────────────────────────────────────────────────────────

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
  });
}
