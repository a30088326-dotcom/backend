import { randomUUID } from 'crypto';
import { repository } from '../../storage/repository';
import { ensure, type Context, type Settings } from './types';
import { defaults, parse } from './store';
import { sourceTime } from './native-data';
import { StorageConflictError } from '../../storage/dynamodb';

export async function ensureSchema() {
  try {
    await repository().transaction(async tx => { if (!await tx.get('hr_assistant_settings', { id:'main' })) await tx.create('hr_assistant_settings', { id:'main',data:defaults }); });
  } catch (error) {
    if (!(error instanceof StorageConflictError) || !await repository().get('hr_assistant_settings', { id:'main' })) throw error;
  }
}
export async function settings(): Promise<Settings> {
  const row = await repository().get('hr_assistant_settings', { id:'main' });
  ensure(row, 'Assistant settings have not been initialized.', 503);
  const saved = parse<Settings>(row.data);
  return /^readyhr assistant$/i.test(saved.name) ? { ...saved,name:defaults.name } : saved;
}
export async function conversation(c: Context, id?: string) {
  if (id) {
    const row = await repository().get('hr_assistant_conversations', { id });
    ensure(row?.user_id === c.userId && sourceTime(row.updated_at) > Date.now() - 30 * 86400000, 'Conversation not found or expired.', 404);
    return { id:row.id as string,context:parse(row.context) };
  }
  const newId = randomUUID();
  await repository().create('hr_assistant_conversations', { id:newId,user_id:c.userId,context:{},created_at:new Date().toISOString(),updated_at:new Date().toISOString() });
  return { id:newId,context:{} as any };
}
export async function setContext(c: Context, id: string, selectedEmployeeId?: string) {
  if (!selectedEmployeeId) return;
  await repository().transaction(async tx => { const row = await tx.get('hr_assistant_conversations', { id }); ensure(row?.user_id === c.userId, 'Conversation not found.', 404); await tx.replace('hr_assistant_conversations', { ...row,context:{ selectedEmployeeId },updated_at:new Date().toISOString() }); });
}
export async function remember(c: Context, id: string, role: string, text: string) {
  if (/\b(?:passwords?|passcodes?|passphrases?|secrets?|tokens?|api[ _-]?keys?|credentials?|otps?|pins?)\b/i.test(text)) text = '[Credential-related message omitted. Use the secure password form.]';
  await repository().transaction(async tx => { const row = await tx.get('hr_assistant_conversations', { id }); ensure(row?.user_id === c.userId, 'Conversation not found.', 404); await tx.create('hr_assistant_messages', { id:randomUUID(),conversation_id:id,user_id:c.userId,role,text:text.slice(0,4000),at:new Date().toISOString() }); await tx.replace('hr_assistant_conversations', { ...row,updated_at:new Date().toISOString() }); });
}
export async function recentActions(c: Context) {
  const rows = (await repository().find('hr_assistant_actions', row => c.superAdmin || row.user_id === c.userId)).sort((a,b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0,80);
  const users = await repository().find('users', row => rows.some(action => action.user_id === row.id));
  return rows.map(row => ({ id:row.id,tool:row.tool,module:row.module,status:row.status,summary:row.summary,actor_role:row.actor_role,user_id:row.user_id,created_at:row.created_at,updated_at:row.updated_at,actor_name:users.find(user => user.id === row.user_id)?.name || null }));
}
