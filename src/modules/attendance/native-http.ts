import { RosterError } from './roster.service';
import type { RepositorySession } from '../../storage/repository';
import type { EntityName } from '../../storage/table-definitions';
export const nativeRun=(fn:any)=>async(req:any,res:any)=>{try{await fn(req,res);}catch(error:any){const status=error.status||(error.name==='StorageConflictError'?409:400);res.status(status).json({success:false,message:error.message||'Attendance operation failed.'});}};
export async function requiredNative(tx:RepositorySession,entity:EntityName,id:string){const row=await tx.get(entity,{id});if(!row)throw new RosterError(404,'Record not found.');return row;}
export async function employeeNative(tx:RepositorySession,userId:string,active=false){const row=(await tx.find('employee_information_employees',r=>r.userId===userId&&(!active||(!!r.isActive&&r.status==='Active'))))[0];if(!row)throw new RosterError(404,'Employee profile not found.');return row;}
export function parsedArray(value:any){if(Array.isArray(value))return value;if(!value)return [];try{return JSON.parse(value);}catch{return String(value).split(',').map(s=>s.trim());}}
export const newestNative=(a:any,b:any)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''));
export const pickNative=(body:any,fields:string[])=>Object.fromEntries(fields.filter(key=>body[key]!==undefined).map(key=>[key,body[key]]));
