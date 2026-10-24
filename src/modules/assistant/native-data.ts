import { repository } from '../../storage/repository';
import type { EntityName } from '../../storage/table-definitions';

export const useDynamo = () => process.env.DATABASE_PROVIDER === 'dynamodb';
export const nativeRows = (table: EntityName, predicate: (row: any) => boolean = () => true) => repository().find(table,predicate);
export const nativeOne = async (table: EntityName, predicate: (row: any) => boolean) => (await nativeRows(table,predicate))[0];
export async function nativeLeaveRows(predicate: (row:any) => boolean) {
  const [applications,types,employees,users] = await Promise.all([nativeRows('leave_applications'),nativeRows('leave_types'),nativeRows('employee_information_employees'),nativeRows('users')]);
  return applications.map(row => { const employee = employees.find(e => e.userId === row.applicantId); return { ...row,type:types.find(type => type.id === row.leaveTypeId)?.name,employeeId:employee?.id,employeeNumber:employee?.employeeNumber,name:users.find(user => user.id === row.applicantId)?.name }; }).filter(row => row.employeeId && predicate(row));
}
export function sourceTime(value: unknown) {
  if (value instanceof Date) return value.getTime();
  const text = String(value || '');
  return new Date(/Z$|[+-]\d\d:\d\d$/.test(text) ? text : text.replace(' ','T') + '+05:30').getTime();
}
