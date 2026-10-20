import { z } from 'zod';
import type { RowDataPacket } from 'mysql2/promise';
import { db } from '../../lib/db';
import { employeeFor } from './policy';
import { api } from './gateway';
import { ensure, type Tool } from './types';
import { dateSchema } from '../performance/rules';

const fields = ['firstName','lastName','dob','gender','nationality','maritalStatus','bloodGroup','religion','employmentType','dateJoined','permanentEffectiveDate','probationStatus','payrollNo','personalEmail','mobile','linkedIn'] as const;
const personal = new Set(['firstName','lastName','dob','gender','nationality','maritalStatus','bloodGroup','religion']);
const dateFields = new Set(['dob','dateJoined','permanentEffectiveDate']);
export const employeeDetailsTools: Tool[] = [{
  id:'employee.updateDetails',label:'Update an employee detail',description:'Change one personal, contact or employment field without replacing unrelated details. Use dedicated manager, department and roster actions for organization mappings.',
  module:'employee_information',scope:'admin',permission:'canEdit',risk:'write',service:'Canonical Employee Information update',examples:['Update employee details'],
  fields:[{name:'employee',label:'Employee name or number',required:true},{name:'field',label:'Detail to update',type:'select',options:[...fields],required:true},{name:'value',label:'New value (dates: YYYY-MM-DD)',required:true}],
  schema:z.object({employee:z.string().trim().min(1).max(150),field:z.enum(fields),value:z.string().trim().min(1).max(250)}).strict(),
  prepare:async(c,v)=>{
    const e=employeeFor(c,v.employee);const record=await api(c,'GET',`/api/employee_information/audit/${e.id}`);
    if(dateFields.has(v.field)) ensure(dateSchema.safeParse(v.value).success,'Use a valid YYYY-MM-DD date.');
    if(v.field==='personalEmail') ensure(z.string().email().safeParse(v.value).success,'Enter a valid email address. This changes contact details, not login credentials.');
    if(v.field==='linkedIn') ensure(/^https:\/\/(www\.)?linkedin\.com\//i.test(v.value),'Enter an HTTPS LinkedIn profile URL.');
    const patch:any={}; let old:any;
    if(personal.has(v.field)) {
      const p=record.personalDetails||{};old=p[v.field];patch.personalDetails={[v.field]:v.value};
      if(v.field==='firstName'||v.field==='lastName') patch.personalDetails.fullName=[v.field==='firstName'?v.value:p.firstName,p.middleName,v.field==='lastName'?v.value:p.lastName].filter(Boolean).join(' ');
      if(v.field==='dob') patch.personalDetails.dateOfBirth=v.value;
      if(v.field==='maritalStatus') patch.personalDetails.civilStatus=v.value;
    } else if(['personalEmail','mobile','linkedIn'].includes(v.field)) {
      const contact=record.contactDetails||{},residential=contact.residential||{};
      const key=v.field==='personalEmail'?'email':v.field;
      old=v.field==='linkedIn'?contact.linkedIn:residential.personal?.[key];
      patch.contactDetails={...contact,personal:{...residential.personal},emergencyContacts:residential.emergencyContacts||[]};
      if(v.field==='linkedIn') patch.contactDetails.linkedIn=v.value; else patch.contactDetails.personal[key]=v.value;
    } else {
      old=v.field==='employmentType'?record.employmentType?.name:record[v.field]??record.employmentDetails?.[v.field];
      patch.employmentDetails={[v.field]:v.value};
      if(v.field==='employmentType') {
        const [types]=await db.query<RowDataPacket[]>('SELECT id,name FROM employment_types WHERE LOWER(name)=?',[v.value.toLowerCase()]);
        ensure(types.length===1,'Choose an existing, exact employment type name from EIM Admin.');patch.employmentDetails.employmentTypeId=types[0].id;
      }
    }
    return {args:{employeeId:e.id,patch,field:v.field,value:v.value},summary:`Update ${e.name} (${e.employeeNumber}): ${v.field}: ${old??'Not set'} → ${v.value}. Other details remain unchanged.${v.field==='personalEmail'?' The login email will not change.':''}`,before:{updatedAt:record.updatedAt,old:old??null,contact:patch.contactDetails?record.contactDetails:null}};
  },
  execute:async(c,v)=>{
    await api(c,'PUT',`/api/employee_information/audit/${v.employeeId}`,v.patch);
    const saved=await api(c,'GET',`/api/employee_information/audit/${v.employeeId}`);
    let actual=personal.has(v.field)?saved.personalDetails?.[v.field]:v.field==='employmentType'?saved.employmentType?.name:v.field==='linkedIn'?saved.contactDetails?.linkedIn:['personalEmail','mobile'].includes(v.field)?saved.contactDetails?.residential?.personal?.[v.field==='personalEmail'?'email':v.field]:saved[v.field]??saved.employmentDetails?.[v.field];
    if(actual instanceof Date) actual=actual.toISOString().slice(0,10);
    ensure(String(actual??'').slice(0,dateFields.has(v.field)?10:undefined)===v.value,'The update response could not be verified. Check Employee Information before retrying.',502);
    return {message:`Employee ${v.field} updated and verified.`,recordId:v.employeeId};
  }
}];
