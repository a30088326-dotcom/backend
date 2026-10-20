import type { z } from 'zod';
import type { DirectoryEmployee } from '../../shared/services/organization.service';

export type Permission = 'canView' | 'canCreate' | 'canEdit' | 'canDelete' | 'canApprove' | 'canExport';
export type Scope = 'staff' | 'own' | 'team' | 'admin' | 'super';
export interface Context {
  userId: string; employeeId: string | null; name: string; role: string; admin: boolean; superAdmin: boolean;
  executive: boolean; manager: boolean; employees: DirectoryEmployee[]; visibleIds: string[];
  permissions: Record<string, any>[]; authorization: string;
}
export interface Field {
  name: string; label: string; type?: 'text' | 'date' | 'number' | 'select' | 'json' | 'textarea' | 'checkbox';
  required?: boolean; options?: string[]; placeholder?: string;
}
export interface Result {
  message: string; recordId?: string; selectedEmployeeId?: string;
  cards?: { title: string; values: { label: string; value: string }[] }[];
  table?: { columns: string[]; rows: string[][] };
  links?: { label: string; path: string }[];
  download?: { name: string; content: string; mime: string };
}
export interface Prepared { args: Record<string, any>; summary: string; before?: unknown; }
export interface Tool {
  id: string; label: string; module: string; description: string; scope: Scope; permission: Permission;
  risk: 'read' | 'write' | 'high'; examples: string[]; fields: Field[]; schema: z.ZodTypeAny;
  service: string;
  prepare?: (ctx: Context, input: any) => Promise<Prepared>;
  execute: (ctx: Context, input: any) => Promise<Result>;
}
export interface Settings {
  name: string; welcome: string; disabledTools: string[]; confirmWrites: boolean;
  enabled: boolean; help: { title: string; text: string; page: string }[]; version: number;
}
export class AssistantError extends Error { constructor(public status: number, message: string) { super(message); } }
export function ensure(value: unknown, message: string, status = 400): asserts value { if (!value) throw new AssistantError(status, message); }
