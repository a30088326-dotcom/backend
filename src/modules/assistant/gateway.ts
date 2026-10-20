import type { Context } from './types';
import { AssistantError } from './types';
/** Only registry-owned relative paths reach this adapter. No model/user supplied URLs. */
export async function api(c: Context, method: string, path: string, body?: unknown): Promise<any> {
  if (!path.startsWith('/api/') || /[\r\n]/.test(path)) throw new AssistantError(400, 'Invalid internal action.');
  const response = await fetch(`http://127.0.0.1:${Number(process.env.PORT || 3001)}${path}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { Authorization: c.authorization, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json() as any;
  if (!response.ok || result.success === false) throw new AssistantError(response.status >= 500 ? 502 : response.status, result.message || 'The HR service could not complete the action.');
  return result.data ?? result;
}
export const rowsTable = (columns: string[], rows: unknown[][]) => ({ columns, rows: rows.slice(0, 100).map(r => r.map(v => v == null ? '—' : String(v))) });
export function csv(columns: string[], rows: unknown[][]) { return [columns, ...rows].map(row => row.map(v => { const s = String(v ?? ''); return `"${(/^[=+@\-\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`; }).join(',')).join('\r\n'); }
