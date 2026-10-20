import type { Context, Permission } from './types';
import { moduleAllowed } from './policy';
export const pages = [
  { id: 'assistant', name: 'Assistant', path: '/assistant', module: 'assistant', aliases: ['assistant', 'bot', 'help'] },
  { id: 'assistant-admin', name: 'Bot Studio', path: '/assistant-admin', module: 'access_control', super: true, aliases: ['bot studio', 'assistant settings'] },
  { id: 'performance', name: 'Performance', path: '/performance#overview', module: 'performance_management', aliases: ['performance', 'review', 'goals', 'assessment'] },
  { id: 'self_service', name: 'Self Service', path: '/self_service#dashboard', module: 'self_service', aliases: ['self service'] },
  { id: 'profile', name: 'My Profile', path: '/self_service#profile', module: 'self_service', aliases: ['my profile', 'profile'] },
  { id: 'my-leave', name: 'My Leave', path: '/self_service#leave', module: 'self_service', aliases: ['my leave', 'leave balance', 'leave'] },
  { id: 'my-requests', name: 'My Requests', path: '/self_service#requests', module: 'self_service', aliases: ['my requests'] },
  { id: 'my-attendance', name: 'My Attendance', path: '/self_service#attendance', module: 'self_service', aliases: ['my attendance'] },
  { id: 'my-shift', name: 'Roster Group', path: '/self_service#shift', module: 'self_service', aliases: ['my shift', 'my roster'] },
  { id: 'my-manager', name: 'Reporting Manager', path: '/self_service#manager', module: 'self_service', aliases: ['my manager'] },
  { id: 'employee-information', name: 'Employee Information', path: '/employee-information', module: 'employee_information', aliases: ['employee information', 'employees', 'employee administration'] },
  { id: 'eim', name: 'EIM Admin', path: '/eim', module: 'eim_admin', aliases: ['eim admin', 'eim', 'departments', 'designations'] },
  { id: 'reporting-hierarchy', name: 'Reporting Hierarchy', path: '/reporting-hierarchy', module: 'reporting_hierarchy', aliases: ['reporting hierarchy', 'hierarchy'] },
  { id: 'supervisor', name: 'Team Leave Requests', path: '/supervisor', module: 'leave_approval', aliases: ['team leave', 'leave approvals'] },
  { id: 'team-attendance', name: 'Team Attendance', path: '/team-attendance', module: 'leave_approval', aliases: ['team attendance'] },
  { id: 'leave-management', name: 'Leave Management', path: '/leave-management', module: 'leave_management', aliases: ['leave management', 'leave configuration'] },
  { id: 'attendance', name: 'Attendance & Roster', path: '/attendance', module: 'attendance_management', aliases: ['attendance', 'roster', 'shifts'] },
  { id: 'dashboard', name: 'Dashboard', path: '/dashboard', module: 'reports_analytics', aliases: ['dashboard', 'analytics'] },
  { id: 'onboarding', name: 'Onboarding', path: '/onboarding', module: 'onboarding', aliases: ['onboarding', 'invites'] },
  { id: 'verification', name: 'Doc Verification', path: '/verification', module: 'document_verification', aliases: ['documents', 'document verification'] },
  { id: 'access-control', name: 'Access Control', path: '/access-control', module: 'access_control', super: true, aliases: ['access control', 'users', 'permissions'] },
] as const;
export function accessiblePages(c: Context) { return pages.filter(p => (!('super' in p) || c.superAdmin) && moduleAllowed(c, p.module, 'canView' as Permission)); }
