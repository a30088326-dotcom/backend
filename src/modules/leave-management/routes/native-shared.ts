import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { repository } from '../../../storage/repository';
import { StorageConflictError, type Document } from '../../../storage/dynamodb';
import { LeaveError } from '../services/application.service';
import { LeaveRuleScriptError } from '../services/restricted-rule';

export type AuthRequest = Request & { user?: { userId: string; role: string; email: string } };
export const nativeHandler = (fn: (req: AuthRequest, res: Response) => Promise<unknown>) => (req: Request, res: Response, _next: NextFunction) => {
  Promise.resolve(fn(req, res)).catch((error: unknown) => {
    const status = error instanceof LeaveError ? error.status : error instanceof StorageConflictError ? 409 : error instanceof ZodError || error instanceof LeaveRuleScriptError ? 400 : 500;
    res.status(status).json({ success: false, message: error instanceof Error ? error.message : 'Unable to complete this leave operation.' });
  });
};

export function paging(req: Request, defaultLimit = 20) {
  const page = Math.max(1, parseInt(String(req.query.page)) || 1);
  const limit = Math.max(1, Math.min(500, parseInt(String(req.query.limit)) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

export async function leaveReferences() {
  const repo = repository();
  const [types, years, users] = await Promise.all([repo.find('leave_types', () => true), repo.find('leave_years', () => true), repo.find('users', () => true)]);
  return { types: new Map(types.map(row => [row.id, row])), years: new Map(years.map(row => [row.id, row])), users: new Map(users.map(row => [row.id, row])) };
}

export function formatApplication(app: Document, refs: Awaited<ReturnType<typeof leaveReferences>>) {
  const type = refs.types.get(app.leaveTypeId), year = refs.years.get(app.leaveYearId), approver = refs.users.get(app.approverId), cover = refs.users.get(app.coveringEmployeeId);
  const { _version, _migration, ...data } = app;
  return { ...data, applicantName: refs.users.get(app.applicantId)?.name,
    leaveType: type ? { id: type.id, name: type.name, color: type.color, code: type.code } : null,
    leaveYear: year ? { id: year.id, year: year.year, displayName: year.displayName } : null,
    approver: approver ? { id: approver.id, name: approver.name, email: approver.email } : null,
    coveringEmployee: cover ? { id: cover.id, name: cover.name, email: cover.email } : null };
}
