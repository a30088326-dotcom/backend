import { isDeepStrictEqual } from 'util';
import { db } from '../../lib/db';
import type { RowDataPacket } from 'mysql2/promise';
import { tools } from './tools';
import { ensurePerformanceSchema } from '../performance/schema';
import { LeaveError } from '../leave-management/services/application.service';
import { pages } from './navigation';
import { authorize, scopedContext, hasFullModuleAccess } from './policy';
import { conversation, parse, remember, setContext, settings } from './store';
import { ensure, AssistantError, type Context, type Tool } from './types';

export const publicTool = (t: Tool, c?: Context) => {
  const canManage = !c || c.manager || c.admin || hasFullModuleAccess(c,t.module);
  const fields = t.fields.map(f => {
    if (canManage) return f;
    if (t.id === 'performance.assessment' && f.name === 'kind') return { ...f, options: ['self'] };
    if (t.id === 'performance.action' && f.name === 'action') return { ...f, options: ['self-share', 'acknowledge'] };
    return f;
  });
  return { id: t.id, label: !canManage && t.id === 'performance.assessment' ? 'Save my self-assessment' : !canManage && t.id === 'performance.action' ? 'Share or acknowledge my review' : t.label, description: t.description, module: t.module, risk: t.risk, fields, examples: t.examples };
};
export async function invoke(context: Context, toolId: string, input: unknown, requestId: string, conversationId?: string) {
  const tool = tools.find(t => t.id === toolId);
  ensure(tool, 'Unknown assistant action.', 404);
  const conv = await conversation(context, conversationId);
  try { authorize(context, tool, await settings()); } catch (error) {
    await db.query('INSERT IGNORE INTO hr_assistant_actions (id,user_id,employee_id,actor_role,conversation_id,tool,module,status,args,summary,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,NOW(3))', [requestId, context.userId, context.employeeId, context.role, conv.id, tool.id, tool.module, 'DENIED', '{}', 'Action denied by current permissions.']);
    throw error;
  }
  const c = scopedContext(context, tool.module);
  if (tool.module === 'performance_management') await ensurePerformanceSchema();
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) return { kind: 'form', conversationId: conv.id, tool: publicTool(tool, c), values: input, message: `I can help with this. Please complete or correct: ${parsed.error.issues.map((e: any) => `${tool.fields.find(f => f.name === e.path[0])?.label || e.path.join('.') || 'Input'}${e.message === 'Required' ? '' : ` (${e.message})`}`).join(', ')}. Nothing has been submitted yet.` };
  // Extensions can only connect to a real, schema-valid, permitted registry action.
  if (tool.id === 'builder.addButton') {
    const target = tools.find(t => t.id === parsed.data.action); ensure(target, 'Unknown connected action.');
    authorize(c, target, await settings());
    const args = target.schema.safeParse(parsed.data.arguments);
    ensure(args.success, 'Connected action arguments are incomplete or invalid.');
    parsed.data.arguments = args.data;
  }
  if (tool.id === 'studio.configure') {
    ensure(parsed.data.disabledTools.every((id: string) => tools.some(t => t.id === id)), 'Disabled tools must use existing registry IDs.');
    ensure(parsed.data.help.every((entry: {page: string}) => pages.some(p => p.id === entry.page)), 'Help entries must link to existing Peoples Management pages.');
  }
  const connection = await db.getConnection();
  const lock = `hrbot:${requestId}`;
  try {
    const [[locked]] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?,0) AS acquired', [lock]);
    ensure(locked.acquired === 1, 'This action is already being processed.', 409);
    const [[old]] = await connection.query<RowDataPacket[]>('SELECT * FROM hr_assistant_actions WHERE id=?', [requestId]);
    if (old) {
      ensure(old.user_id === c.userId && old.tool === tool.id, 'Request ID already used.', 409);
      if (old.status === 'PENDING') return { kind: 'confirmation', conversationId: old.conversation_id, actionId: old.id, summary: old.summary };
      ensure(old.status === 'SUCCEEDED', 'This request cannot be repeated. Check its action history.', 409);
      return { kind: 'result', conversationId: old.conversation_id, result: parse(old.result) };
    }
    const prepared = tool.prepare ? await tool.prepare(c, parsed.data) : { args: parsed.data, summary: `${tool.label}: ${JSON.stringify(parsed.data)}`, before: null };
    const write = tool.risk !== 'read';
    await connection.query('INSERT INTO hr_assistant_actions (id,user_id,employee_id,actor_role,conversation_id,tool,module,status,args,summary,before_data,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,DATE_ADD(NOW(3),INTERVAL 10 MINUTE))', [requestId, c.userId, c.employeeId, c.role, conv.id, tool.id, tool.module, write ? 'PENDING' : 'RUNNING', JSON.stringify(write ? { input: parsed.data, prepared: prepared.args } : {}), write ? prepared.summary : tool.label, JSON.stringify(prepared.before ?? null)]);
    if (write) return { kind: 'confirmation', conversationId: conv.id, actionId: requestId, summary: prepared.summary };
    try {
      const result = await tool.execute(c, prepared.args);
      await connection.query('UPDATE hr_assistant_actions SET status=?,result=?,updated_at=NOW(3) WHERE id=?', ['SUCCEEDED', JSON.stringify({ message: `Completed: ${tool.label}. Run again for fresh data.` }), requestId]);
      await setContext(c, conv.id, result.selectedEmployeeId);
      await remember(c, conv.id, 'assistant', `Completed: ${tool.label}.`);
      return { kind: 'result', conversationId: conv.id, result };
    } catch (error) {
      await connection.query('UPDATE hr_assistant_actions SET status=?,updated_at=NOW(3) WHERE id=?', ['FAILED', requestId]); throw error;
    }
  } finally { await connection.query('SELECT RELEASE_LOCK(?)', [lock]); connection.release(); }
}

export async function confirm(context: Context, id: string, cancel = false) {
  const connection = await db.getConnection(); const lock = `hrbot:${id}`;
  try {
    const [[locked]] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?,0) AS acquired', [lock]);
    ensure(locked.acquired === 1, 'This action is already being processed.', 409);
    const [[row]] = await connection.query<RowDataPacket[]>('SELECT *, expires_at>NOW(3) AS valid FROM hr_assistant_actions WHERE id=? AND user_id=?', [id, context.userId]);
    ensure(row, 'Action not found.', 404);
    const tool = tools.find(t => t.id === row.tool); ensure(tool, 'This tool is no longer available.', 409);
    authorize(context, tool, await settings());
    if (row.status === 'SUCCEEDED') return { kind: 'result', conversationId: row.conversation_id, result: parse(row.result) };
    ensure(row.status === 'PENDING', 'This action is no longer pending. Check action history before trying again.', 409);
    if (cancel || !row.valid) {
      await connection.query('UPDATE hr_assistant_actions SET status=?,updated_at=NOW(3) WHERE id=?', [cancel ? 'CANCELLED' : 'EXPIRED', id]);
      return { kind: 'result', conversationId: row.conversation_id, result: { message: cancel ? 'Action cancelled. Nothing changed.' : 'Confirmation expired. Request a fresh preview.' } };
    }
    const c = scopedContext(context, tool.module); const stored = parse(row.args);
    if (tool.module === 'performance_management') await ensurePerformanceSchema();
    const fresh = tool.prepare ? await tool.prepare(c, stored.input) : { args: stored.input, summary: row.summary, before: null };
    ensure(isDeepStrictEqual(fresh.args, stored.prepared) && isDeepStrictEqual(fresh.before ?? null, parse(row.before_data)), 'The target or its data changed after preview. Cancel and request a new preview.', 409);
    await connection.query('UPDATE hr_assistant_actions SET status=?,confirmed_at=NOW(3),updated_at=NOW(3) WHERE id=?', ['RUNNING', id]);
    try {
      const result = await tool.execute(c, fresh.args);
      // Keep only a minimal receipt; never persist full employee records in chat/audit results.
      const receipt = { message: result.message, recordId: result.recordId, links: result.links };
      await connection.query('UPDATE hr_assistant_actions SET status=?,result=?,updated_at=NOW(3) WHERE id=?', ['SUCCEEDED', JSON.stringify(receipt), id]);
      await setContext(c, row.conversation_id, result.selectedEmployeeId);
      await remember(c, row.conversation_id, 'assistant', `Completed: ${tool.label}.`);
      return { kind: 'result', conversationId: row.conversation_id, result };
    } catch (error) {
      // Leave validation errors are returned only after the canonical transaction
      // rolls back. Preserve the actionable cause instead of claiming uncertainty.
      if (error instanceof LeaveError) {
        await connection.query('UPDATE hr_assistant_actions SET status=?,result=?,updated_at=NOW(3) WHERE id=?', ['FAILED', JSON.stringify({ message: error.message }), id]);
        throw new AssistantError(error.status, `${error.message} Nothing was changed by this action.`);
      }
      // Canonical services may have committed before a transport/verification error. Never auto-retry writes.
      await connection.query('UPDATE hr_assistant_actions SET status=?,result=?,updated_at=NOW(3) WHERE id=?', ['CHECK_REQUIRED', JSON.stringify({ message: 'Completion was not verified. Check the target record before issuing a new request.' }), id]);
      const detail = error instanceof AssistantError && error.status < 500 ? `${error.message} ` : '';
      throw new AssistantError(409, `${detail}Completion could not be verified. Check the target record and Bot Studio action ${id} before retrying.`);
    }
  } finally { await connection.query('SELECT RELEASE_LOCK(?)', [lock]); connection.release(); }
}
