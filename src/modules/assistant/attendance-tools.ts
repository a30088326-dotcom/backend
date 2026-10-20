import { z } from 'zod';
import type { Tool } from './types';
import { ensure } from './types';
import { api } from './gateway';
import { localToday } from '../../shared/services/dashboard.service';

export const attendanceTools: Tool[] = [{
  id: 'attendance.punch', label: 'Mark my attendance', module: 'self_service', scope: 'own', permission: 'canCreate', risk: 'write',
  description: 'Clock in, clock out, start a break or return from a break for your own account at the current time.',
  examples: ['Mark my attendance today', 'Clock me out', 'Start my break'],
  fields: [{ name: 'logType', label: 'Attendance action (BreakIn = start break; BreakOut = return)', type: 'select', required: true, options: ['In', 'Out', 'BreakIn', 'BreakOut'] }],
  schema: z.object({ logType: z.enum(['In', 'Out', 'BreakIn', 'BreakOut']) }).strict(),
  service: 'POST /api/attendance/punch',
  prepare: async (c, v) => {
    const logs = await api(c, 'GET', '/api/attendance/my-today');
    const last = logs.at(-1);
    ensure(last?.logType !== v.logType, `Your attendance is already marked ${v.logType} today. No duplicate entry is needed.`);
    ensure(v.logType === 'In' || last, 'Clock in before clocking out or recording a break.');
    ensure(v.logType !== 'BreakOut' || last?.logType === 'BreakIn', 'Start a break before recording your return.');
    ensure(v.logType !== 'BreakIn' || ['In', 'BreakOut'].includes(last?.logType), 'You must be clocked in to start a break.');
    ensure(v.logType !== 'In' || !last || last.logType === 'Out', 'You are already clocked in. End your break or clock out instead.');
    return { args: v, summary: `${c.name}: record ${v.logType} for ${localToday()} at the time you confirm.`, before: { date: localToday(), lastId: last?.id || null } };
  },
  execute: async (c, v) => {
    const saved = await api(c, 'POST', '/api/attendance/punch', { logType: v.logType, source: 'Assistant' });
    ensure(saved?.id && saved?.logType === v.logType, 'Attendance was sent but could not be verified. Check My Attendance before retrying.', 502);
    return { message: `Attendance recorded: ${saved.logType} on ${saved.date}.`, recordId: saved.id, links: [{ label: 'My Attendance', path: '/self_service#attendance' }] };
  },
}];
