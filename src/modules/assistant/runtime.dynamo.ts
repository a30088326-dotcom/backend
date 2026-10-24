import { isDeepStrictEqual } from 'util';
import { repository } from '../../storage/repository';
import { tools } from './tools';
import { ensurePerformanceSchema } from '../performance/schema';
import { LeaveError } from '../leave-management/services/application.service';
import { pages } from './navigation';
import { authorize, scopedContext } from './policy';
import { conversation, parse, remember, setContext, settings } from './store';
import { ensure, AssistantError, type Context } from './types';
import { publicTool } from './runtime';
import { sourceTime } from './native-data';

function previous(c: Context, toolId: string, old: any) {
  ensure(old.user_id === c.userId && old.tool === toolId, 'Request ID already used.', 409);
  if (old.status === 'PENDING') return { kind:'confirmation',conversationId:old.conversation_id,actionId:old.id,summary:old.summary };
  ensure(old.status === 'SUCCEEDED', 'This request cannot be repeated. Check its action history.', 409);
  return { kind:'result',conversationId:old.conversation_id,result:parse(old.result) };
}
async function finish(id: string, userId: string, state: string, result?: any) {
  await repository().transaction(async tx => { const row = await tx.get('hr_assistant_actions', { id }); ensure(row?.user_id === userId && row.status === 'RUNNING', 'Action state changed; check its history.', 409); await tx.replace('hr_assistant_actions', { ...row,status:state,...(result ? { result } : {}),updated_at:new Date().toISOString() }); });
}
export async function invoke(context: Context, toolId: string, input: unknown, requestId: string, conversationId?: string) {
  const tool = tools.find(t => t.id === toolId); ensure(tool, 'Unknown assistant action.', 404);
  const conv = await conversation(context, conversationId);
  try { authorize(context, tool, await settings()); } catch (error) {
    await repository().transaction(async tx => { if (!await tx.get('hr_assistant_actions', { id:requestId })) await tx.create('hr_assistant_actions', { id:requestId,user_id:context.userId,employee_id:context.employeeId,actor_role:context.role,conversation_id:conv.id,tool:tool.id,module:tool.module,status:'DENIED',args:{},summary:'Action denied by current permissions.',expires_at:new Date().toISOString() }); });
    throw error;
  }
  const c = scopedContext(context, tool.module);
  if (tool.module === 'performance_management') await ensurePerformanceSchema();
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) return { kind:'form',conversationId:conv.id,tool:publicTool(tool,c),values:input,message:`I can help with this. Please complete or correct: ${parsed.error.issues.map((e:any) => `${tool.fields.find(f => f.name === e.path[0])?.label || e.path.join('.') || 'Input'}${e.message === 'Required' ? '' : ` (${e.message})`}`).join(', ')}. Nothing has been submitted yet.` };
  if (tool.id === 'builder.addButton') { const target = tools.find(t => t.id === parsed.data.action); ensure(target, 'Unknown connected action.'); authorize(c,target,await settings()); const args = target.schema.safeParse(parsed.data.arguments); ensure(args.success,'Connected action arguments are incomplete or invalid.'); parsed.data.arguments = args.data; }
  if (tool.id === 'studio.configure') { ensure(parsed.data.disabledTools.every((id:string) => tools.some(t => t.id === id)), 'Disabled tools must use existing registry IDs.'); ensure(parsed.data.help.every((entry:{page:string}) => pages.some(p => p.id === entry.page)), 'Help entries must link to existing Peoples Management pages.'); }
  const old = await repository().get('hr_assistant_actions', { id:requestId });
  if (old) return previous(c,tool.id,old);
  const prepared = tool.prepare ? await tool.prepare(c,parsed.data) : { args:parsed.data,summary:`${tool.label}: ${JSON.stringify(parsed.data)}`,before:null };
  const write = tool.risk !== 'read';
  // The conditional creation is the idempotency claim. Only one invocation may execute.
  await repository().create('hr_assistant_actions', { id:requestId,user_id:c.userId,employee_id:c.employeeId,actor_role:c.role,conversation_id:conv.id,tool:tool.id,module:tool.module,status:write ? 'PENDING' : 'RUNNING',args:write ? { input:parsed.data,prepared:prepared.args } : {},summary:write ? prepared.summary : tool.label,before_data:prepared.before ?? null,expires_at:new Date(Date.now()+600000).toISOString(),created_at:new Date().toISOString(),updated_at:new Date().toISOString() });
  if (write) return { kind:'confirmation',conversationId:conv.id,actionId:requestId,summary:prepared.summary };
  try {
    const result = await tool.execute(c,prepared.args);
    await finish(requestId,c.userId,'SUCCEEDED',{ message:`Completed: ${tool.label}. Run again for fresh data.` });
    await setContext(c,conv.id,result.selectedEmployeeId); await remember(c,conv.id,'assistant',`Completed: ${tool.label}.`);
    return { kind:'result',conversationId:conv.id,result };
  } catch (error) { const row = await repository().get('hr_assistant_actions', { id:requestId }); if (row?.status === 'RUNNING') await finish(requestId,c.userId,'FAILED'); throw error; }
}
export async function confirm(context: Context, id: string, cancel = false) {
  const row = await repository().get('hr_assistant_actions', { id }); ensure(row?.user_id === context.userId, 'Action not found.', 404);
  const tool = tools.find(t => t.id === row.tool); ensure(tool, 'This tool is no longer available.', 409);
  authorize(context,tool,await settings());
  if (row.status === 'SUCCEEDED') return { kind:'result',conversationId:row.conversation_id,result:parse(row.result) };
  ensure(row.status === 'PENDING','This action is no longer pending. Check action history before trying again.',409);
  const expired = sourceTime(row.expires_at) <= Date.now();
  if (cancel || expired) {
    await repository().replace('hr_assistant_actions', { ...row,status:cancel ? 'CANCELLED' : 'EXPIRED',updated_at:new Date().toISOString() });
    return { kind:'result',conversationId:row.conversation_id,result:{ message:cancel ? 'Action cancelled. Nothing changed.' : 'Confirmation expired. Request a fresh preview.' } };
  }
  const c = scopedContext(context,tool.module); const stored = parse(row.args);
  if (tool.module === 'performance_management') await ensurePerformanceSchema();
  const fresh = tool.prepare ? await tool.prepare(c,stored.input) : { args:stored.input,summary:row.summary,before:null };
  ensure(isDeepStrictEqual(fresh.args,stored.prepared) && isDeepStrictEqual(fresh.before ?? null,parse(row.before_data)), 'The target or its data changed after preview. Cancel and request a new preview.',409);
  // Conditional PENDING -> RUNNING prevents double execution across containers.
  await repository().replace('hr_assistant_actions', { ...row,status:'RUNNING',confirmed_at:new Date().toISOString(),updated_at:new Date().toISOString() });
  try {
    const result = await tool.execute(c,fresh.args);
    await finish(id,c.userId,'SUCCEEDED',{ message:result.message,recordId:result.recordId,links:result.links });
    await setContext(c,row.conversation_id,result.selectedEmployeeId); await remember(c,row.conversation_id,'assistant',`Completed: ${tool.label}.`);
    return { kind:'result',conversationId:row.conversation_id,result };
  } catch (error) {
    const current = await repository().get('hr_assistant_actions', { id });
    if (current?.status !== 'RUNNING') throw error;
    if (error instanceof LeaveError) { await finish(id,c.userId,'FAILED',{ message:error.message }); throw new AssistantError(error.status,`${error.message} Nothing was changed by this action.`); }
    await finish(id,c.userId,'CHECK_REQUIRED',{ message:'Completion was not verified. Check the target record before issuing a new request.' });
    const detail = error instanceof AssistantError && error.status < 500 ? `${error.message} ` : '';
    throw new AssistantError(409,`${detail}Completion could not be verified. Check the target record and Bot Studio action ${id} before retrying.`);
  }
}
