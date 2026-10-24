import type { Request, Response } from 'express';
import schemas from '../../storage/entity-schemas.json';
import type { EntityName } from '../../storage/table-definitions';
export class EmployeeError extends Error { constructor(public status: number, message: string) { super(message); } }
export function assertEmployee(value: unknown, message: string, status = 400): asserts value { if (!value) throw new EmployeeError(status, message); }
export const parseProfile = (v: any, fallback: any = {}) => typeof v === 'string' ? JSON.parse(v) : v ?? fallback;
export const isoDay = (value: any) => {
  if (value === '' || value == null) return null;
  if (value instanceof Date) assertEmployee(!Number.isNaN(value.valueOf()), 'Enter a valid calendar date.');
  const day = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  assertEmployee(/^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day, 'Enter a valid calendar date.');
  return day;
};
export const columnData = (table: EntityName, data: any) => Object.fromEntries(Object.entries(data || {}).filter(([key]) => key in schemas[table].columns && !['id', 'employeeId', 'createdAt', 'updatedAt', '_version'].includes(key)));
export const nativeHandler = (fn: (req: Request, res: Response) => Promise<any>) => async (req: Request, res: Response) => {
  try { return await fn(req, res); }
  catch (error: any) {
    const status = error.status || (error.name === 'StorageConflictError' ? 409 : 500);
    if (status >= 500) console.error('[Employee native]', error);
    return res.status(status).json({ success: false, message: status < 500 ? error.message : 'Unable to complete the request. Refresh the profile to check its saved state before retrying.' });
  }
};
