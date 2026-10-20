import { z } from 'zod';
import { db } from '../../lib/db';
import type { RowDataPacket } from 'mysql2/promise';
import { ensure, type Tool } from './types';
import { employeeFor } from './policy';
import { api } from './gateway';
import { dateSchema, librarySchema } from '../performance/rules';
import { actorFor } from '../performance/store';
import { workspace } from '../performance/query.service';
import { saveLibraryGoal, assignGoals } from '../performance/setup.service';
import { descendants } from '../../shared/services/organization.service';

const text = z.string().trim().min(1).max(500);
const base = (id:string,label:string,module:string):Omit<Tool,'schema'|'execute'> => ({id,label,module,scope:'admin',permission:'canCreate',risk:'write',description:label,examples:[],fields:[],service:'Canonical Peoples Management workflow'});
const modules = ['onboarding','document_verification','performance_management','employee_information','attendance_management','eim_admin','reporting_hierarchy','leave_management','leave_approval','reports_analytics','self_service'] as const;
export const workflowTools:Tool[] = [
  { ...base('users.grantModule','Grant full access to one module','access_control'), permission:'canEdit',risk:'high',examples:['Give Supun Wijesinghe full access to onboarding'],
    fields:[{name:'employee',label:'Employee exact name or number',required:true},{name:'module',label:'Module',type:'select',options:[...modules],required:true}],
    schema:z.object({employee:text,module:z.enum(modules)}).strict(),
    prepare:async(c,v)=>{const e=employeeFor(c,v.employee);ensure(e.userId && e.organizationalRank!=='OWNER','Select a non-Owner employee with a login.');return {args:{...v,userId:e.userId},summary:`Grant ${e.name} view, create, edit, delete, approve and export access to ${v.module}, with organization-wide scope. This does not change their login role or other modules.`,before:await api(c,'GET',`/api/access-control/users/${e.userId}/permissions`)};},
    execute:async(c,v)=>{await api(c,'PATCH',`/api/access-control/users/${v.userId}/permissions`,{permissions:[{moduleId:v.module,moduleAccess:true,canView:true,canCreate:true,canEdit:true,canDelete:true,canApprove:true,canExport:true,dataScope:'ALL'}]});const saved=await api(c,'GET',`/api/access-control/users/${v.userId}/permissions`);const p=saved.find((p:any)=>p.moduleId===v.module);ensure(p&&['moduleAccess','canView','canCreate','canEdit','canDelete','canApprove','canExport'].every(key=>p[key])&&['ALL','ORGANIZATION'].includes(p.dataScope),'Permission save could not be verified.',502);return {message:`Full ${v.module} access granted. The user can refresh access to see the available actions.`,recordId:v.userId};}
  },
  { ...base('performance.createGoal','Create a goal in the library','performance_management'),examples:['Create a performance goal'],
    fields:[{name:'title',label:'Goal title',required:true},{name:'measure',label:'Success measure',type:'textarea',required:true},{name:'weight',label:'Weight %',type:'number',required:true}],
    schema:librarySchema.extend({milestones:librarySchema.shape.milestones.default([])}).strict(),
    prepare:async(_c,v)=>({args:v,summary:`Create library goal "${v.title}". Measure: ${v.measure}. Weight: ${v.weight}%.`}),
    execute:async(c,v)=>{const r=await saveLibraryGoal(await actorFor(c.userId),v);return {message:`Goal "${r.title}" created. Assign it to a launched cycle next.`,recordId:r.id};}
  },
  { ...base('performance.assignGoal','Assign a goal to an employee or team','performance_management'),scope:'staff',permission:'canEdit',examples:['Assign a goal to an employee'],
    fields:[{name:'employee',label:'Employee name or number',required:true},{name:'goal',label:'Exact goal title or ID',required:true},{name:'cycle',label:'Exact cycle name or ID',required:true},{name:'dueDate',label:'Due date',type:'date',required:true},{name:'includeReports',label:'Also include this employee’s reporting descendants',type:'checkbox'}],
    schema:z.object({employee:text,goal:text,cycle:text,dueDate:dateSchema,includeReports:z.boolean().default(false)}).strict(),
    prepare:async(c,v)=>{const e=employeeFor(c,v.employee),a=await actorFor(c.userId),w=await workspace(a);const cycles=w.cycles.filter(x=>x.id===v.cycle||x.name.toLowerCase()===v.cycle.toLowerCase());const goals=w.library.filter(x=>x.id===v.goal||x.title.toLowerCase()===v.goal.toLowerCase());ensure(cycles.length===1&&goals.length===1,'Use one exact cycle and goal name, or their IDs.');const ids=[e.id,...(v.includeReports?descendants(c.employees,e.id):[])];ensure(ids.every(id=>c.visibleIds.includes(id)),'The selected team extends beyond your employee scope.',403);ensure(ids.every(id=>a.admin||id===a.employeeId||a.employees.some(e=>e.id===id&&e.managerId===a.employeeId)),'Assign goals to yourself or your direct reports; HR can assign across a reporting branch.',403);return {args:{cycleId:cycles[0].id,goalIds:[goals[0].id],employeeIds:ids,dueDate:v.dueDate},summary:`Assign "${goals[0].title}" in ${cycles[0].name}, due ${v.dueDate}, to: ${ids.map(id=>employeeFor(c,id).name).join(', ')}.`,before:w.reviews.filter(r=>ids.includes(r.employeeId)&&r.cycleId===cycles[0].id)};},
    execute:async(c,v)=>{const r=await assignGoals(await actorFor(c.userId),v);return {message:`${r.assigned} goal assignment(s) saved. Employees receive a performance update.`};}
  },
  { ...base('attendance.assignRoster','Assign an employee to a roster group','attendance_management'),examples:['Assign a roster group to an employee'],
    fields:[{name:'employee',label:'Employee name or number',required:true},{name:'group',label:'Exact roster group name or code',required:true},{name:'startDate',label:'Effective start',type:'date',required:true},{name:'endDate',label:'Effective end (optional)',type:'date'}],
    schema:z.object({employee:text,group:text,startDate:dateSchema,endDate:dateSchema.optional()}).strict(),
    prepare:async(c,v)=>{const e=employeeFor(c,v.employee);const groups=await api(c,'GET','/api/attendance/roster-groups');const matches=groups.filter((g:any)=>[g.id,g.code,g.name].map(value=>String(value||'').toLowerCase()).includes(v.group.toLowerCase()));ensure(matches.length===1,'Select one exact roster group.');ensure(!v.endDate||v.endDate>=v.startDate,'End date must be after the start date.');const [old]=await db.query<RowDataPacket[]>('SELECT id,groupId,status,effectiveStartDate,effectiveEndDate FROM attendance_roster_assignments WHERE employeeId=? AND status=\'Active\' ORDER BY id',[e.id]);return {args:{employeeIds:[e.id],groupId:matches[0].id,effectiveStartDate:v.startDate,effectiveEndDate:v.endDate||null},summary:`Assign ${e.name} to ${matches[0].name} from ${v.startDate}. Replaces their active roster assignment.`,before:old};},
    execute:async(c,v)=>{await api(c,'POST','/api/attendance/assignments',v);return {message:'Roster assignment saved.',recordId:v.employeeIds[0]};}
  },
  { ...base('attendance.createShift','Create a working shift','attendance_management'),examples:['Create a shift'],
    fields:[{name:'code',label:'Unique shift code',required:true},{name:'name',label:'Shift name',required:true},{name:'startTime',label:'Start (HH:mm)',required:true},{name:'endTime',label:'End (HH:mm)',required:true},{name:'breakDuration',label:'Break duration in minutes',type:'number',required:true}],
    schema:z.object({code:z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9_-]+$/),name:text,startTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),endTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),breakDuration:z.coerce.number().min(0).max(240)}).strict(),
    prepare:async(c,v)=>{const shifts=await api(c,'GET','/api/attendance/shifts');ensure(!shifts.some((s:any)=>s.code.toLowerCase()===v.code.toLowerCase()),'Shift code already exists.');const minutes=(s:string)=>Number(s.slice(0,2))*60+Number(s.slice(3));const duration=(minutes(v.endTime)-minutes(v.startTime)+1440)%1440;ensure(duration>v.breakDuration,'Shift duration must exceed the break.');return {args:{...v,description:'Created through Peoples Management Assistant',shiftType:'Fixed',crossMidnight:v.endTime<v.startTime,totalHours:duration/60,minWorkingHours:(duration-v.breakDuration)/60,fullDayHours:(duration-v.breakDuration)/60,halfDayHours:(duration-v.breakDuration)/120,breakType:'Unpaid',earliestIn:v.startTime,latestOut:v.endTime,graceLate:0,graceEarly:0,overtimeEligible:false,overtimeStart:0,weeklyWorkingDays:['Monday','Tuesday','Wednesday','Thursday','Friday'],weeklyOffDays:['Saturday','Sunday'],holidayRule:'Off',applicableEmploymentTypes:[],status:'Active'},summary:`Create shift ${v.code}: ${v.name}, ${v.startTime}–${v.endTime}, unpaid break ${v.breakDuration} minutes, Monday–Friday. Overtime disabled. Change these defaults in Attendance & Roster if needed.`};},
    execute:async(c,v)=>{const r=await api(c,'POST','/api/attendance/shifts',v);return {message:`Shift ${r.name} created.`,recordId:r.id};}
  },
];
