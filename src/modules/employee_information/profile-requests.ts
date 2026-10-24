import { Router } from 'express';
import { randomUUID, createHash } from 'crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { db } from '../../lib/db';
import { requireAuth } from '../../middleware/auth';
import { syncEmployeeMappings } from '../../shared/services/employee-mapping.service';
import { repository } from '../../storage/repository';
import nativeRoutes from './profile-requests.native';

// Additive storage: employment, payroll, leave rules and existing history are not changed.
export async function ensureProfileRequestStorage() {
  if (process.env.DATABASE_PROVIDER === 'dynamodb') return;
  await db.query(`CREATE TABLE IF NOT EXISTS employee_profile_extras (
    employeeId varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
    data json NOT NULL, updatedAt datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_profile_extras_employee FOREIGN KEY (employeeId) REFERENCES employee_information_employees(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}
const parse = (value: any, fallback: any = {}) => typeof value === 'string' ? JSON.parse(value) : value || fallback;
export function identifiedContacts(contacts:any[] = []) {return contacts.map(v=>({...v,id:v.id||`legacy-${createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,24)}`}));}
export async function getProfileExtras(employeeId: string) {
  if (process.env.DATABASE_PROVIDER === 'dynamodb') return parse((await repository().get('employee_profile_extras', { employeeId }))?.data);
  const [rows] = await db.query<RowDataPacket[]>('SELECT data FROM employee_profile_extras WHERE employeeId=?', [employeeId]);
  return parse(rows[0]?.data);
}
const text = z.string().trim().max(255);
const required = text.min(1);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v,'Enter a valid date.').or(z.literal(''));
export const profileSchemas = {
  basic: z.object({ firstName:required,lastName:required,fullName:required,title:text,gender:text,dob:date,maritalStatus:text,nationality:text }).strict(),
  contact: z.object({address:text,city:text,country:text,mobile:text,telephone:text,email:z.string().email().or(z.literal('')),workingAddress:text}).strict(),
  emergency: z.object({name:required,relationship:z.enum(['Father','Mother','Other']),primaryPhone:required}).strict(),
  dependents: z.object({name:required,relationship:required,dob:date,gender:text}).strict(),
  qualifications: z.object({qualification:required,type:text,institute:required,year:z.string().regex(/^\d{4}$/)}).strict(),
  workExperience: z.object({role:required,company:required,from:date,to:date}).strict().refine(v=>!v.from||!v.to||v.to>=v.from,'End date must follow start date.'),
  expertise: z.object({skill:required,domain:text}).strict(),
  memberships: z.object({organization:required,number:text,type:text,expiry:date}).strict(),
  bank: z.object({bankName:required,branch:text,accountNo:required,accountHolderName:required,accountType:z.enum(['Savings','Current']),currency:required}).strict(),
  identification: z.object({nicNo:text,passportNo:text}).strict().refine(v=>!!(v.nicNo||v.passportNo),'Enter an ID or passport number.')
};
type Section = keyof typeof profileSchemas;
class RequestError extends Error { constructor(public status:number,message:string){super(message);} }
const requestSchema = z.object({section:z.enum(Object.keys(profileSchemas) as [Section,...Section[]]),operation:z.enum(['update','add','remove']),itemId:z.string().optional(),values:z.record(z.string(), z.unknown()),reason:z.string().trim().min(1).max(2000)}).strict();
const router = Router(); router.use(requireAuth);
router.use((req,res,next)=>process.env.DATABASE_PROVIDER === 'dynamodb' ? nativeRoutes(req,res,next) : next());
const run = (fn:any) => async (req:any,res:any)=>{try{await fn(req,res);}catch(e:any){if(!(e instanceof RequestError)&&!(e instanceof z.ZodError))console.error('Profile request error:',e);res.status(e.status|| (e instanceof z.ZodError?400:500)).json({success:false,message:e instanceof z.ZodError?e.issues.map((x:any)=>x.message).join(' '):e.status?e.message:'Unable to process the profile request.'});}};
async function own(userId:string,c:any=db) {
  const [rows]=await c.query('SELECT * FROM employee_information_employees WHERE userId=? AND isActive=1',[userId]);
  if(!rows[0])throw new RequestError(404,'An active employee profile is required.');return rows[0];
}
async function snapshot(c:any,employeeId:string,section:Section) {
  if(section==='basic'||section==='identification'){
    const [rows]=await c.query('SELECT * FROM employee_information_personal_details WHERE employeeId=?',[employeeId]);
    const source=rows[0]||{};const keys=section==='basic'?['firstName','lastName','fullName','title','gender','dob','maritalStatus','nationality']:['nicNo','passportNo'];
    const aliases:any={maritalStatus:source.civilStatus,dob:source.dateOfBirth,nicNo:source.nic||source.nicNumber,passportNo:source.passportNumber};
    return Object.fromEntries(keys.map(k=>[k,source[k]||aliases[k]||'']));
  }
  if(section==='contact'||section==='emergency'){
    const [rows]=await c.query('SELECT * FROM employee_information_contact_details WHERE employeeId=?',[employeeId]);
    const r=rows[0]||{}, residential=parse(r.residential),permanent=parse(r.permanent),working=parse(r.working);
    if(section==='emergency')return identifiedContacts(residential.emergencyContacts||[]);
    return {address:permanent.address||'',city:permanent.city||'',country:permanent.country||'',mobile:residential.personal?.mobile||'',telephone:residential.personal?.telephone||'',email:residential.personal?.email||'',workingAddress:working.address||''};
  }
  if(section==='bank'){const [rows]=await c.query('SELECT * FROM employee_information_bank_details WHERE employeeId=?',[employeeId]);return rows;}
  const [rows]=await c.query('SELECT data FROM employee_profile_extras WHERE employeeId=?',[employeeId]);return parse(rows[0]?.data)[section]||[];
}
async function apply(c:PoolConnection,employeeId:string,p:any) {
  const current=await snapshot(c,employeeId,p.section);
  const list=Array.isArray(current);
  const previous=list?current.find((v:any)=>v.id===p.itemId):current;
  if(p.operation!=='add'&&!isDeepStrictEqual(parse(JSON.stringify(previous)),p.before))throw new RequestError(409,'The profile has changed since this request. Ask the employee to submit a new request.');
  if(!list&&p.operation!=='update')throw new RequestError(400,'This section supports updates only.');
  const values=p.values;
  if(p.section==='basic'||p.section==='identification'){
    const [[row]]=await c.query<RowDataPacket[]>('SELECT id FROM employee_information_personal_details WHERE employeeId=? FOR UPDATE',[employeeId]);
    const update={...values};if(update.dob==='')update.dob=null;
    if(p.section==='basic'){update.civilStatus=values.maritalStatus;update.dateOfBirth=update.dob;}
    else {update.nic=values.nicNo;update.nicNumber=values.nicNo;update.passportNumber=values.passportNo;}
    if(row)await c.query('UPDATE employee_information_personal_details SET ?,updatedAt=NOW() WHERE employeeId=?',[update,employeeId]);
    else await c.query('INSERT INTO employee_information_personal_details SET ?',[{id:randomUUID(),employeeId,...update}]);
    if(p.section==='basic')await syncEmployeeMappings(c,employeeId);
  }else if(p.section==='bank'){
    if(p.operation==='remove')throw new RequestError(400,'Bank accounts cannot be removed through this request.');
    const update={...values,accountNumber:values.accountNo,branchName:values.branch};
    if(p.operation==='add')await c.query('INSERT INTO employee_information_bank_details SET ?',[{id:randomUUID(),employeeId,...update}]);
    else await c.query('UPDATE employee_information_bank_details SET ?,updatedAt=NOW() WHERE id=? AND employeeId=?',[update,p.itemId,employeeId]);
  }else if(p.section==='contact'||p.section==='emergency'){
    const [[row]]=await c.query<RowDataPacket[]>('SELECT * FROM employee_information_contact_details WHERE employeeId=? FOR UPDATE',[employeeId]);
    const residential=parse(row?.residential),permanent=parse(row?.permanent),working=parse(row?.working);
    if(p.section==='contact'){Object.assign(permanent,{address:values.address,city:values.city,country:values.country});working.address=values.workingAddress;residential.personal={...residential.personal,mobile:values.mobile,telephone:values.telephone,email:values.email};}
    else residential.emergencyContacts=changeList(current,p);
    const update={permanent:JSON.stringify(permanent),working:JSON.stringify(working),residential:JSON.stringify(residential)};
    if(row)await c.query('UPDATE employee_information_contact_details SET ?,updatedAt=NOW() WHERE employeeId=?',[update,employeeId]);
    else await c.query('INSERT INTO employee_information_contact_details SET ?',[{id:randomUUID(),employeeId,...update}]);
  }else{
    const [[row]]=await c.query<RowDataPacket[]>('SELECT data FROM employee_profile_extras WHERE employeeId=? FOR UPDATE',[employeeId]);
    const extras=parse(row?.data);extras[p.section]=changeList(current,p);
    await c.query('INSERT INTO employee_profile_extras (employeeId,data) VALUES (?,?) ON DUPLICATE KEY UPDATE data=VALUES(data),updatedAt=NOW()',[employeeId,JSON.stringify(extras)]);
  }
}
function changeList(current:any[],p:any){
  if(p.operation==='add')return [...current,{id:randomUUID(),...p.values,status:'Approved'}];
  return p.operation==='remove'?current.filter(v=>v.id!==p.itemId):current.map(v=>v.id===p.itemId?{...v,...p.values}:v);
}
const select=`SELECT r.*, CONCAT_WS(' ',e.firstName,e.lastName) employeeName,e.employeeNo, u.name approverName
 FROM employee_requests r JOIN employee_information_employees e ON e.id=r.employeeId
 LEFT JOIN users u ON u.id=JSON_UNQUOTE(JSON_EXTRACT(r.dataPayload,'$.approverId'))`;
router.get('/my',run(async(req:any,res:any)=>{const e=await own(req.user.userId);const [rows]=await db.query(select+' WHERE r.employeeId=? ORDER BY r.createdAt DESC',[e.id]);res.json({success:true,data:rows});}));
router.get('/team',run(async(req:any,res:any)=>{const [rows]=await db.query(select+" WHERE JSON_UNQUOTE(JSON_EXTRACT(r.dataPayload,'$.approverId'))=? ORDER BY r.createdAt DESC",[req.user.userId]);res.json({success:true,data:rows});}));
router.post('/',run(async(req:any,res:any)=>{
  const input=requestSchema.parse(req.body);const e=await own(req.user.userId);
  const [[manager]]=await db.query<RowDataPacket[]>('SELECT u.id FROM employee_information_employees m JOIN users u ON u.id=m.userId WHERE m.id=? AND m.isActive=1 AND u.isActive=1',[e.reportingManagerId]);
  if(!manager||manager.id===req.user.userId)throw new RequestError(409,'A valid reporting manager must be assigned before submitting profile requests.');
  const current=await snapshot(db,e.id,input.section);const list=Array.isArray(current);
  if(!list&&input.operation!=='update')throw new RequestError(400,'This section supports updates only.');
  if(list&&input.operation!=='add'&&!current.some((v:any)=>v.id===input.itemId))throw new RequestError(404,'The selected profile item was not found.');
  if(input.section==='bank'&&input.operation==='remove')throw new RequestError(400,'Bank account removal is not supported.');
  const values=input.operation==='remove'?{}:profileSchemas[input.section].parse(input.values);
  const before=list?current.find((v:any)=>v.id===input.itemId)||null:current;
  const id=randomUUID();const payload={version:1,section:input.section,operation:input.operation,itemId:input.itemId||null,values,before,approverId:manager.id};
  await db.query("INSERT INTO employee_requests (id,employeeId,requestType,title,description,dataPayload,status) VALUES (?,?,'PROFILE_CHANGE',?,?,?,'PENDING')",[id,e.id,`${input.operation} ${input.section}`,input.reason,JSON.stringify(payload)]);
  res.status(201).json({success:true,data:{id,status:'PENDING',approverId:manager.id}});
}));
router.patch('/:id/cancel',run(async(req:any,res:any)=>{const e=await own(req.user.userId);const [result]:any=await db.query("UPDATE employee_requests SET status='CANCELLED',updatedAt=NOW() WHERE id=? AND employeeId=? AND status='PENDING'",[req.params.id,e.id]);if(!result.affectedRows)throw new RequestError(409,'Only your pending profile requests can be cancelled.');res.json({success:true});}));
router.patch('/:id/resolve',run(async(req:any,res:any)=>{
  const {action,reason}=z.object({action:z.enum(['APPROVED','REJECTED']),reason:z.string().trim().max(2000).optional()}).strict().parse(req.body);
  if(action==='REJECTED'&&!reason)throw new RequestError(400,'Give a reason for rejecting the request.');
  const c=await db.getConnection();try{
    await c.beginTransaction();const [[row]]=await c.query<RowDataPacket[]>('SELECT * FROM employee_requests WHERE id=? FOR UPDATE',[req.params.id]);
    if(!row)throw new RequestError(404,'Request not found.');const payload=parse(row.dataPayload);
    if(payload.approverId!==req.user.userId)throw new RequestError(403,'Only the assigned reporting manager can decide this request.');
    if(row.status!=='PENDING')throw new RequestError(409,'This request has already been processed.');
    const [[employee]]=await c.query<RowDataPacket[]>('SELECT id,isActive FROM employee_information_employees WHERE id=? FOR UPDATE',[row.employeeId]);
    if(!employee?.isActive)throw new RequestError(409,'The employee is no longer active.');
    if(action==='APPROVED')await apply(c,row.employeeId,payload);
    await c.query('UPDATE employee_requests SET status=?,rejectionReason=?,approvedBy=?,approvedAt=NOW(),updatedAt=NOW() WHERE id=?',[action,reason||null,req.user.userId,req.params.id]);
    await c.commit();res.json({success:true,data:{id:row.id,status:action}});
  }catch(e){await c.rollback();throw e;}finally{c.release();}
}));
export default router;
