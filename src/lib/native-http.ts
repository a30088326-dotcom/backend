import type { RequestHandler } from 'express';
export function requireValue(condition: unknown, message: string, status = 400): asserts condition {
  if (!condition) throw Object.assign(new Error(message), { status });
}
export const nativeRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};
export const htmlText = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function frontendUrl() {
  return (process.env.EXTERNAL_FRONTEND_URL || process.env.FRONTEND_URL?.split(',')[0] || 'http://localhost:5174').replace(/\/$/, '');
}
/** SQL DATETIME values in migrated records represent Colombo wall time. */
export function storedInstant(value: unknown): number {
  if (typeof value !== 'string') return NaN;
  return Date.parse(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)
    ? value.replace(' ', 'T') + '+05:30' : value);
}
