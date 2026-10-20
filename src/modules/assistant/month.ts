import { z } from 'zod';
import { localToday } from '../../shared/services/dashboard.service';

const names = 'january february march april may june july august september october november december'.split(' ');
/** Shared by chat and forms; unrecognized input is never silently replaced. */
export function parseMonth(value: string, today = localToday()): string | undefined {
  const m = value.toLowerCase().trim();
  const iso = m.match(/\b(\d{4}-(?:0[1-9]|1[0-2]))\b/);
  if (iso) return iso[1];
  if (/\blast month\b/.test(m)) return new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 15)).toISOString().slice(0, 7);
  if (/\b(?:this|current) month\b|\btoday\b/.test(m)) return today.slice(0, 7);
  const index = names.findIndex(name => new RegExp(`\\b(?:${name}|${name.slice(0, 3)})\\b`).test(m));
  const year = m.match(/\b\d{4}\b/)?.[0] || today.slice(0, 4);
  return index < 0 ? undefined : `${year}-${String(index + 1).padStart(2, '0')}`;
}
export const monthSchema = z.preprocess(value => {
  if (value === undefined || value === '') return localToday().slice(0, 7);
  return typeof value === 'string' ? parseMonth(value) || value : value;
}, z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month such as August, August 2025, last month, or 2026-08.'));
