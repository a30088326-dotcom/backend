import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { RowDataPacket } from 'mysql2/promise';
import { db } from '../../lib/db';
import type { Context, Tool } from './types';
import { ensure } from './types';
import { parse } from './store';
import { pages } from './navigation';
import { useDynamo, nativeRows, nativeOne } from './native-data';
import * as native from './configuration.dynamo';

const extensionPages = ['eim', 'employee-information', 'performance', 'dashboard', 'attendance', 'leave-management', 'reporting-hierarchy', 'onboarding'] as const;
export const buttonActions = ['eim.exportDepartments', 'eim.list', 'performance.summary', 'employee.diagnostics', 'dashboard.summary', 'navigation.open'] as const;
const buttonSchema = z.object({ page: z.enum(extensionPages), label: z.string().trim().min(1).max(60), action: z.enum(buttonActions), arguments: z.record(z.string(), z.unknown()).default({}) }).strict();
const fieldSchema = z.object({ label: z.string().trim().min(1).max(60), name: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/), type: z.enum(['Text', 'Number', 'Date']), employeeVisible: z.boolean().default(false) }).strict();
const spec = (id: string, label: string, description: string, examples: string[]): Omit<Tool, 'schema' | 'execute'> => ({ id, label, description, examples, module: 'assistant', scope: 'super', permission: 'canEdit', risk: 'high', fields: [], service: 'Versioned Peoples Management UI extensions' });

async function createExtension(c: Context, page: string, data: unknown) {
  if (useDynamo()) return native.createExtension(c,page,data);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const id = randomUUID();
    await connection.query('INSERT INTO hr_assistant_extensions (id,page,data,created_by) VALUES (?,?,?,?)', [id, page, JSON.stringify(data), c.userId]);
    await connection.query('INSERT INTO hr_assistant_changes (id,entity_id,actor_id,kind,before_data,after_data) VALUES (?,?,?,?,?,?)', [randomUUID(), id, c.userId, 'EXTENSION_CREATED', 'null', JSON.stringify({ page, data, active: true, version: 1 })]);
    await connection.commit(); return id;
  } catch (e) { await connection.rollback(); throw e; } finally { connection.release(); }
}
export const builderTools: Tool[] = [
  { ...spec('builder.addButton', 'Add a connected page button', 'Add an admin page button connected to an existing authorized action. Changes are versioned and can be rolled back.', ['In EIM Admin add a button for exporting departments', 'Add a button called Department Summary to EIM Admin']), fields: [{ name: 'page', label: 'Target page', type: 'select', required: true, options: [...extensionPages] }, { name: 'label', label: 'Button label', required: true }, { name: 'action', label: 'Connected action', type: 'select', required: true, options: [...buttonActions] }, { name: 'arguments', label: 'Action arguments (JSON object)', type: 'json', required: true }], schema: buttonSchema,
    prepare: async (_c, v) => { if (v.action === 'navigation.open') ensure(pages.some(p => p.id === v.arguments.page || p.name === v.arguments.page), 'Choose an existing Peoples Management page.'); if (v.action === 'eim.list') ensure(typeof v.arguments.resource === 'string', 'Specify an EIM resource in the action arguments.'); return { args: v, summary: `Add "${v.label}" to ${v.page}, connected to ${v.action}. Visibility follows the connected action's permissions.` }; },
    execute: async (c, v) => { const id = await createExtension(c, v.page, { kind: 'button', ...v }); return { message: `The "${v.label}" button is now connected on ${v.page}. You can roll it back in Bot Studio.`, recordId: id, links: [{ label: 'Open target page', path: `/${v.page}` }] }; },
  },
  { ...spec('builder.addField', 'Add an employee custom field', 'Add a typed employee field in the existing Employee Information screen. Values remain tied to canonical employee IDs.', ['Add an employee field called Equipment Tag']), fields: [{ name: 'label', label: 'Field label', required: true }, { name: 'name', label: 'Field key (for example equipment_tag)', required: true }, { name: 'type', label: 'Field type', type: 'select', options: ['Text', 'Number', 'Date'], required: true }, { name: 'employeeVisible', label: 'Employees may see their own value', type: 'checkbox' }], schema: fieldSchema,
    prepare: async (_c, v) => { const [rows] = useDynamo() ? [await nativeRows('hr_assistant_extensions', row => row.page === 'employee-information' && row.active)] : await db.query<RowDataPacket[]>('SELECT data FROM hr_assistant_extensions WHERE page=? AND active=1', ['employee-information']); ensure(!rows.some(r => parse(r.data).kind === 'field' && parse(r.data).name === v.name), 'An active custom field already uses that key.'); return { args: v, summary: `Add ${v.type} field "${v.label}" to Employee Information. ${v.employeeVisible ? 'Employees can read their own value.' : 'Visible only to authorized employee administrators.'} Only permitted administrators can edit values.` }; },
    execute: async (c, v) => { const id = await createExtension(c, 'employee-information', { kind: 'field', ...v }); return { message: `Custom field "${v.label}" is available in Employee Information. Open an employee to enter a value.`, recordId: id, links: [{ label: 'Employee Information', path: '/employee-information' }] }; },
  },
  { ...spec('builder.rollback', 'Roll back a UI extension', 'Disable a button or custom field without deleting its saved values. The change is audited.', ['Roll back a builder change']), fields: [{ name: 'extensionId', label: 'Extension ID from Bot Studio', required: true }], schema: z.object({ extensionId: z.string().uuid() }).strict(), prepare: async (_c, v) => { const [[row]] = useDynamo() ? [[await nativeOne('hr_assistant_extensions',row => row.id === v.extensionId)]] : await db.query<RowDataPacket[]>('SELECT id,data,version,active,page FROM hr_assistant_extensions WHERE id=?', [v.extensionId]); ensure(row?.active, 'An active extension is required.'); return { args: { ...v, version: row.version }, summary: `Disable "${parse(row.data).label}" on ${row.page}. Saved custom values remain recoverable.`, before: { version: row.version, active: !!row.active } }; },
    execute: async (c, v) => { if (useDynamo()) return native.rollback(c,v); const connection = await db.getConnection(); try { await connection.beginTransaction(); const [[row]] = await connection.query<RowDataPacket[]>('SELECT * FROM hr_assistant_extensions WHERE id=? FOR UPDATE', [v.extensionId]); ensure(row?.active && row.version === v.version, 'This extension changed. Request a new preview.', 409); await connection.query('UPDATE hr_assistant_extensions SET active=0,version=version+1,updated_at=NOW(3) WHERE id=?', [v.extensionId]); await connection.query('INSERT INTO hr_assistant_changes (id,entity_id,actor_id,kind,before_data,after_data) VALUES (?,?,?,?,?,?)', [randomUUID(), row.id, c.userId, 'EXTENSION_ROLLED_BACK', JSON.stringify({ data: parse(row.data), active: true, version: row.version }), JSON.stringify({ active: false, version: row.version + 1 })]); await connection.commit(); return { message: 'Extension rolled back. Saved values were retained.', recordId: row.id }; } catch (e) { await connection.rollback(); throw e; } finally { connection.release(); } },
  },
];
