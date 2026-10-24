import { randomUUID } from 'crypto';
import { db } from '../../lib/db';
import type { RowDataPacket } from 'mysql2/promise';
import type { Context, Settings } from './types';
import { ensure } from './types';
import * as native from './store.dynamo';
const useDynamo = () => process.env.DATABASE_PROVIDER === 'dynamodb';

let ready: Promise<void> | undefined;
export const parse = <T = any>(v: any): T => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return v as T; } };
export const defaults: Settings = { name: 'Peoples Management Assistant', welcome: 'Ask in English. I can help with your permitted HR tasks.', disabledTools: [], confirmWrites: true, enabled: true, help: [], version: 1 };
export function ensureSchema() {
  if (useDynamo()) return native.ensureSchema();
  return ready ||= (async () => {
    await db.query(`CREATE TABLE IF NOT EXISTS hr_assistant_settings (id VARCHAR(30) PRIMARY KEY, data JSON NOT NULL)`);
    await db.query('INSERT IGNORE INTO hr_assistant_settings (id,data) VALUES (?,?)', ['main', JSON.stringify(defaults)]);
    await db.query(`CREATE TABLE IF NOT EXISTS hr_assistant_conversations (id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(191) NOT NULL, context JSON NOT NULL, created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3), INDEX owner_lookup(user_id,updated_at))`);
    await db.query(`CREATE TABLE IF NOT EXISTS hr_assistant_messages (id VARCHAR(36) PRIMARY KEY, conversation_id VARCHAR(36) NOT NULL, user_id VARCHAR(191) NOT NULL, role VARCHAR(20) NOT NULL, text TEXT NOT NULL, at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3), INDEX conversation_lookup(conversation_id,at))`);
    await db.query(`CREATE TABLE IF NOT EXISTS hr_assistant_actions (id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(191) NOT NULL, employee_id VARCHAR(191), actor_role VARCHAR(30) NOT NULL, conversation_id VARCHAR(36), tool VARCHAR(100) NOT NULL, module VARCHAR(60) NOT NULL, status VARCHAR(30) NOT NULL, args JSON NOT NULL, summary TEXT NOT NULL, before_data JSON, result JSON, confirmed_at DATETIME(3), expires_at DATETIME(3) NOT NULL, created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3), INDEX action_owner(user_id,created_at))`);
    await db.query(`CREATE TABLE IF NOT EXISTS hr_assistant_extensions (id VARCHAR(36) PRIMARY KEY, page VARCHAR(70) NOT NULL, data JSON NOT NULL, version INT NOT NULL DEFAULT 1, active BOOLEAN NOT NULL DEFAULT 1, created_by VARCHAR(191) NOT NULL, updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3))`);
    await db.query(`CREATE TABLE IF NOT EXISTS hr_assistant_changes (id VARCHAR(36) PRIMARY KEY, entity_id VARCHAR(36) NOT NULL, actor_id VARCHAR(191) NOT NULL, kind VARCHAR(30) NOT NULL, before_data JSON, after_data JSON, at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3))`);
    await db.query(`CREATE TABLE IF NOT EXISTS hr_assistant_field_values (field_id VARCHAR(36) NOT NULL, employee_id VARCHAR(191) NOT NULL, value JSON NOT NULL, version INT NOT NULL DEFAULT 1, updated_by VARCHAR(191) NOT NULL, updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY(field_id,employee_id))`);
  })().catch(e => { ready = undefined; throw e; });
}
export async function settings(): Promise<Settings> {
  if (useDynamo()) return native.settings();
  const [[row]] = await db.query<RowDataPacket[]>('SELECT data FROM hr_assistant_settings WHERE id=?', ['main']);
  const saved = parse<Settings>(row.data);
  // Keep existing custom names while displaying the current brand for the old default.
  return /^readyhr assistant$/i.test(saved.name) ? { ...saved, name: defaults.name } : saved;
}
export async function conversation(c: Context, id?: string) {
  if (useDynamo()) return native.conversation(c, id);
  if (id) {
    const [[row]] = await db.query<RowDataPacket[]>('SELECT id, context FROM hr_assistant_conversations WHERE id=? AND user_id=? AND updated_at>DATE_SUB(NOW(),INTERVAL 30 DAY)', [id, c.userId]);
    ensure(row, 'Conversation not found or expired.', 404); return { id: row.id as string, context: parse(row.context) };
  }
  const newId = randomUUID();
  await db.query('INSERT INTO hr_assistant_conversations (id,user_id,context) VALUES (?,?,?)', [newId, c.userId, '{}']);
  return { id: newId, context: {} as any };
}
export async function setContext(c: Context, conversationId: string, selectedEmployeeId?: string) {
  if (useDynamo()) return native.setContext(c, conversationId, selectedEmployeeId);
  if (!selectedEmployeeId) return;
  await db.query('UPDATE hr_assistant_conversations SET context=?,updated_at=NOW(3) WHERE id=? AND user_id=?', [JSON.stringify({ selectedEmployeeId }), conversationId, c.userId]);
}
export async function remember(c: Context, id: string, role: string, text: string) {
  if (useDynamo()) return native.remember(c, id, role, text);
  // Never persist supplied secrets or private record payloads in conversational history.
  if (/\b(?:passwords?|passcodes?|passphrases?|secrets?|tokens?|api[ _-]?keys?|credentials?|otps?|pins?)\b/i.test(text)) text = '[Credential-related message omitted. Use the secure password form.]';
  await db.query('INSERT INTO hr_assistant_messages (id,conversation_id,user_id,role,text) VALUES (?,?,?,?,?)', [randomUUID(), id, c.userId, role, text.slice(0, 4000)]);
  await db.query('UPDATE hr_assistant_conversations SET updated_at=NOW(3) WHERE id=? AND user_id=?', [id, c.userId]);
}
export async function recentActions(c: Context) {
  if (useDynamo()) return native.recentActions(c);
  const [rows] = await db.query<RowDataPacket[]>(`SELECT a.id,a.tool,a.module,a.status,a.summary,a.actor_role,a.user_id,a.created_at,a.updated_at,u.name AS actor_name FROM hr_assistant_actions a LEFT JOIN users u ON u.id=a.user_id ${c.superAdmin ? '' : 'WHERE a.user_id=?'} ORDER BY a.created_at DESC LIMIT 80`, c.superAdmin ? [] : [c.userId]);
  return rows;
}
