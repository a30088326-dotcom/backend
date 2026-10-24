import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { repository } from '../../storage/repository';
import { StorageConflictError } from '../../storage/dynamodb';

const flags=['moduleAccess','canView','canCreate','canEdit','canDelete','canApprove','canExport'] as const;
const scopes=['OWN','DIRECT_REPORTS','DEPARTMENT','ALL','TEAM','ORGANIZATION'] as const;
const permissionSchema=z.object({moduleId:z.string().trim().min(1).max(100),moduleAccess:z.boolean().optional(),canView:z.boolean().optional(),canCreate:z.boolean().optional(),canEdit:z.boolean().optional(),canDelete:z.boolean().optional(),canApprove:z.boolean().optional(),canExport:z.boolean().optional(),dataScope:z.enum(scopes).default('OWN')});
class AccessError extends Error {constructor(public status:number,message:string){super(message);}}
function ensure(condition:unknown,status:number,message:string):asserts condition{if(!condition)throw new AccessError(status,message);}
const route=(fn:(req:Request)=>Promise<any>)=>async(req:Request,res:Response)=>{try{return res.json({success:true,...await fn(req)});}catch(error){const status=error instanceof AccessError?error.status:error instanceof z.ZodError?400:error instanceof StorageConflictError?409:500;return res.status(status).json({success:false,message:status===500?'Server Error':error instanceof z.ZodError?'Invalid access-control fields.':(error as Error).message});}};
export const getUsers=route(async()=>{
  const [users,employees,personal,workstations,designations,departments]=await Promise.all([repository().find('users',()=>true),repository().find('employee_information_employees',()=>true),repository().find('employee_information_personal_details',()=>true),repository().find('employee_information_workstation_details',()=>true),repository().find('designations',()=>true),repository().find('eim_structures',()=>true)]);
  return {data:users.sort((a,b)=>String(a.name).localeCompare(String(b.name))).map(user=>{const e=employees.find(e=>e.userId===user.id),p=personal.find(p=>p.employeeId===e?.id),w=workstations.find(w=>w.employeeId===e?.id);return {id:user.id,name:p?.fullName||p?.firstName||user.name,email:user.email,role:user.role,isActive:!!user.isActive,employeeNo:e?.employeeNo||null,designation:designations.find(d=>d.id===w?.designationId)?.name||null,department:departments.find(d=>d.id===w?.departmentId)?.name||null,avatar:null};})};
});
export const updateUserRole=route(async req=>{
  const id=z.string().min(1).parse(req.params.id),role=z.enum(['SUPER_ADMIN','ADMIN','EMPLOYEE','CANDIDATE']).parse(req.body.role);
  ensure(req.user?.role==='SUPER_ADMIN',403,'Only the Owner/Super Admin can change user roles.');ensure(id!==req.user.userId,400,'Invalid role change.');
  await repository().transaction(async tx=>{const actor=await tx.get('users',{id:req.user!.userId});ensure(actor?.isActive&&actor.role==='SUPER_ADMIN',403,'Only the Owner/Super Admin can change user roles.');const target=await tx.get('users',{id});ensure(target,404,'User not found');ensure(target.role!=='SUPER_ADMIN',403,'The Owner account cannot be reassigned.');await tx.replace('users',{...target,role});});
  return {};
});
export const getUserPermissions=route(async req=>{const rows=await repository().find('user_module_permissions',row=>row.userId===req.params.id);return {data:rows.map(({_version,...row})=>({...row,...Object.fromEntries(flags.map(flag=>[flag,!!row[flag]]))}))};});
export const updateUserPermissions=route(async req=>{
  const permissions=z.array(permissionSchema).max(40).parse(req.body.permissions);ensure(new Set(permissions.map(p=>p.moduleId)).size===permissions.length,400,'Duplicate permission modules are not allowed.');
  await repository().transaction(async tx=>{
    const target=await tx.get('users',{id:String(req.params.id)});ensure(target,404,'User not found');ensure(target.role!=='SUPER_ADMIN'||req.user?.role==='SUPER_ADMIN',403,'The Owner permissions cannot be changed.');
    // Touch the user aggregate so simultaneous multi-module edits/deletion cannot interleave.
    await tx.replace('users',{...target});
    for(const p of permissions){const old=(await tx.find('user_module_permissions',row=>row.userId===target.id&&row.moduleId===p.moduleId))[0];const data={userId:target.id,moduleId:p.moduleId,...Object.fromEntries(flags.map(flag=>[flag,p[flag]?1:0])),dataScope:p.dataScope==='ORGANIZATION'?'ALL':p.dataScope};if(old)await tx.replace('user_module_permissions',{...old,...data});else await tx.create('user_module_permissions',{id:randomUUID(),...data});}
  });
  return {message:'Permissions updated successfully'};
});
export const updateUserStatus=route(async req=>{
  const isActive=z.boolean().parse(req.body.isActive),id=String(req.params.id);
  await repository().transaction(async tx=>{const target=await tx.get('users',{id});ensure(target,404,'User not found');ensure(target.role!=='SUPER_ADMIN'&&id!==req.user?.userId,403,'Cannot disable a Super Admin account');await tx.replace('users',{...target,isActive:isActive?1:0});});
  return {message:`User ${isActive?'enabled':'disabled'} successfully`};
});
