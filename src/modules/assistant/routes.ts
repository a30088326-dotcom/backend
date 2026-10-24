import { useDynamo, nativeRows } from './native-data';
import { repository } from '../../storage/repository';
import { StorageConflictError } from '../../storage/dynamodb';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { RowDataPacket } from 'mysql2/promise';
import { db } from '../../lib/db';
import { requireAuth } from '../../middleware/auth';
import { contextFor, allowed, assertEnglish, employeeFor, scopedContext } from './policy';
import { ensureSchema, settings, conversation, remember, recentActions, parse } from './store';
import { accessiblePages } from './navigation';
import { tools } from './tools';
import { invoke, confirm, publicTool } from './runtime';
import { AssistantError, ensure, type Context } from './types';
import { updates, ensureNotifications } from './notifications';

const router = Router(); router.use(requireAuth);
const credentialWords = /\b(?:passwords?|passcodes?|passphrases?|secrets?|tokens?|api[ _-]?keys?|one[ _-]?time[ _-]?codes?|otps?|pins?)\b/i;
function containsCredentialMaterial(value: unknown, key = ''): boolean {
  if (key === 'disabledTools') return false; // Registry IDs such as account.password are not credentials.
  if (credentialWords.test(key)) return true;
  if (typeof value === 'string') return credentialWords.test(value);
  if (Array.isArray(value)) return value.some(item => containsCredentialMaterial(item));
  if (value && typeof value === 'object') return Object.entries(value).some(([k,v]) => containsCredentialMaterial(v,k));
  return false;
}
const buckets = new Map<string, { start: number; count: number }>();
const wrap = (fn: (req: Request, c: Context) => Promise<any>) => async (req: Request, res: Response, _next: NextFunction) => {
  try {
    await ensureSchema(); const c = await contextFor(req.user!.userId, req.headers.authorization || '');
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
      const now = Date.now(); for (const [key, value] of buckets) if (now - value.start > 60000) buckets.delete(key);
      const b = buckets.get(c.userId) || { start: now, count: 0 }; b.count++; buckets.set(c.userId, b); ensure(b.count <= 40, 'Too many commands. Please wait a minute.', 429);
    }
    const data = await fn(req, c); res.json({ success: true, data });
  } catch (e: any) {
    const status = e instanceof StorageConflictError ? 409 : e instanceof AssistantError ? e.status : e instanceof z.ZodError ? 400 : Number.isInteger(e.status) ? e.status : 500;
    res.status(status).json({ success: false, message: status === 500 ? 'Assistant could not complete this request. Please try again or check service status.' : e instanceof z.ZodError ? 'Invalid request fields.' : e.message });
  }
};
const base = { requestId: z.string().uuid(), conversationId: z.string().uuid().optional() };
router.get('/capabilities', wrap(async (_req, c) => { const config = await settings(); return { name: config.name, welcome: config.welcome, enabled: config.enabled || c.superAdmin, mode: 'English guided commands', tools: tools.filter(t => allowed(c, t, config)).map(t => publicTool(t,c)), pages: accessiblePages(c), superAdmin: c.superAdmin }; }));
router.post('/message', wrap(async (req, c) => {
  const v = z.object({ ...base, message: z.string().trim().min(1).max(4000) }).strict().parse(req.body); assertEnglish(v.message);
  const conv = await conversation(c, v.conversationId);
  // Do not retain messages containing credential material, even if command recognition fails.
  await remember(c, conv.id, 'user', credentialWords.test(v.message) ? '[Credential-related message omitted. Use the secure password form.]' : v.message);
  const { routeMessage } = await import('./hybrid-router');
  return await routeMessage(c, conv.id, v.message, v.requestId, conv.context.selectedEmployeeId);
}));
router.post('/invoke', wrap(async (req, c) => {
  const v = z.object({ ...base, tool: z.string().max(100), args: z.record(z.string(), z.unknown()) }).strict().parse(req.body);
  ensure(JSON.stringify(v.args).length <= 18000, 'Action input is too large.');
  ensure(!containsCredentialMaterial(v.args), 'Never submit credentials through the assistant. Use the secure password form.');
  return invoke(c, v.tool, v.args, v.requestId, v.conversationId);
}));
router.post('/actions/:id/confirm', wrap(async (req, c) => { z.object({}).strict().parse(req.body); return confirm(c, z.string().uuid().parse(req.params.id)); }));
router.post('/actions/:id/cancel', wrap(async (req, c) => { z.object({}).strict().parse(req.body); return confirm(c, z.string().uuid().parse(req.params.id), true); }));
router.get('/history/:id', wrap(async (req, c) => { const conv = await conversation(c, z.string().uuid().parse(req.params.id)); const [rows] = useDynamo()?[(await nativeRows('hr_assistant_messages',r=>r.conversation_id===conv.id&&r.user_id===c.userId)).sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0,50).map(({role,text,at})=>({role,text,at}))]:await db.query<RowDataPacket[]>('SELECT role,text,at FROM hr_assistant_messages WHERE conversation_id=? AND user_id=? ORDER BY at DESC LIMIT 50', [conv.id, c.userId]); return rows.reverse(); }));
router.get('/actions', wrap(async (_req, c) => recentActions(c)));
router.get('/notifications', wrap(async (_req, c) => updates(c)));
router.post('/notifications/:id/read', wrap(async (req, c) => {
  const id = z.string().regex(/^[a-f0-9]{64}$/).parse(req.params.id);
  ensure(!(await updates(c)).some(r => r.id === id && r.pending), 'This request stays pending until its workflow is resolved. Open it to review.', 409);
  await ensureNotifications();
  if(useDynamo())await repository().transaction(async tx=>{const key={user_id:c.userId,event_id:id};if(!await tx.get('hr_assistant_read_updates',key))await tx.create('hr_assistant_read_updates',key);});else await db.query('INSERT IGNORE INTO hr_assistant_read_updates (user_id,event_id) VALUES (?,?)',[c.userId,id]);
  return { read: true };
}));
router.get('/admin', wrap(async (_req, c) => { ensure(c.superAdmin, 'Bot Studio is only available to Super Admin.', 403); const [extensions] = useDynamo()?[(await nativeRows('hr_assistant_extensions')).sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)))]:await db.query<RowDataPacket[]>('SELECT id,page,data,active,version FROM hr_assistant_extensions ORDER BY updated_at DESC'); const [changes] = useDynamo()?[(await nativeRows('hr_assistant_changes')).sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0,100).map(({id,entity_id,actor_id,kind,at})=>({id,entity_id,actor_id,kind,at}))]:await db.query<RowDataPacket[]>('SELECT id,entity_id,actor_id,kind,at FROM hr_assistant_changes ORDER BY at DESC LIMIT 100'); return { settings: await settings(), actions: await recentActions(c), extensions: extensions.map(e => ({ ...e, data: parse(e.data) })), changes, tools: tools.map(t => publicTool(t,c)), diagnostics: { mode: 'English guided commands', externalAI: false, arbitraryCodeExecution: false, writesRequireConfirmation: true } }; }));
router.get('/extensions', wrap(async (req, c) => { const page = z.string().max(70).parse(req.query.page); if (!accessiblePages(c).some(p => p.id === page)) return []; const config = await settings(); const [rows] = useDynamo()?[await nativeRows('hr_assistant_extensions',r=>r.page===page&&r.active)]:await db.query<RowDataPacket[]>('SELECT id,data FROM hr_assistant_extensions WHERE page=? AND active=1', [page]); return rows.map(r => ({ id: r.id, ...parse(r.data) })).filter(r => r.kind === 'button' && tools.some(t => t.id === r.action && allowed(c, t, config))); }));
router.get('/employees/:id/fields', wrap(async (req, c) => {
  const own = req.params.id === c.employeeId; const tool = tools.find(t => t.id === (own ? 'self.profile' : 'employee.search'))!; ensure(allowed(c, tool, await settings()), 'Employee fields are not available.', 403);
  const e = employeeFor(scopedContext(c, tool.module), String(req.params.id), own);
  const [rows] = useDynamo()?[await nativeEmployeeFields(e.id)]:await db.query<RowDataPacket[]>('SELECT f.id,f.data,JSON_UNQUOTE(v.value) AS value FROM hr_assistant_extensions f LEFT JOIN hr_assistant_field_values v ON v.field_id=f.id AND v.employee_id=? WHERE f.page=? AND f.active=1', [e.id, 'employee-information']);
  const canEdit = allowed(c, tools.find(t => t.id === 'employee.customField')!, await settings());
  return { canEdit, fields: rows.map(r => ({ id: r.id, ...parse(r.data), value: r.value === null ? '' : String(r.value) })).filter(r => r.kind === 'field' && (c.admin || (own && r.employeeVisible))) };
}));
export default router;

async function nativeEmployeeFields(employeeId:string){const [fields,values]=await Promise.all([nativeRows('hr_assistant_extensions',r=>r.page==='employee-information'&&r.active),nativeRows('hr_assistant_field_values',r=>r.employee_id===employeeId)]);return fields.map(row=>({id:row.id,data:row.data,value:values.find(v=>v.field_id===row.id)?.value??null}));}
