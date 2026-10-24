import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { db } from '../../lib/db';
import { canManageCandidate } from '../../middleware/module-action';
import { changeReporting } from '../../shared/services/organization.service';
import { syncEmployeeMappings } from '../../shared/services/employee-mapping.service';
import { assignRoster } from '../attendance/roster.service';
import { dateSchema } from '../performance/rules';
import { processEntitlementsForEmployee } from '../leave/leave.controller';
import { employeeFor } from './policy';
import { ensure, type Tool, type Context } from './types';

const text=z.string().trim().min(1).max(150);
const masters={company:'eim_companies',location:'eim_locations',department:'eim_structures',designation:'designations',employmentType:'employment_types',roster:'attendance_roster_groups'} as const;
async function readyCandidate(c:Context,email:string,connection:typeof db|PoolConnection=db,lock=false) {
  const [[user]]=await connection.query<RowDataPacket[]>('SELECT id,name,role,isActive FROM users WHERE LOWER(email)=?'+(lock?' FOR UPDATE':''),[email.toLowerCase()]);
  ensure(user?.isActive&&user.role==='CANDIDATE','Choose an active candidate who accepted an invitation and is not already an employee.');
  ensure(await canManageCandidate(c,user.id),'Candidate is outside your onboarding scope.',403);
  const [[existing]]=await connection.query<RowDataPacket[]>('SELECT id FROM employee_information_employees WHERE userId=?',[user.id]);ensure(!existing,'This candidate already has an employee profile.',409);
  const [documents]=await connection.query<RowDataPacket[]>('SELECT type,status FROM documents WHERE candidateId=? ORDER BY type'+(lock?' FOR UPDATE':''),[user.id]);
  ensure(['NATIONAL_ID','BANK_STATEMENT','PASSPORT_PHOTO'].every(t=>documents.some(d=>d.type===t&&d.status==='APPROVED'))&&documents.every(d=>d.status==='APPROVED'),'The required documents must be reviewed and approved first.');
  const [[contract]]=await connection.query<RowDataPacket[]>('SELECT id,status FROM contracts WHERE candidateId=?'+(lock?' FOR UPDATE':''),[user.id]);ensure(contract?.status==='SIGNED','The candidate must sign the employment agreement first.');
  const [[profile]]=await connection.query<RowDataPacket[]>('SELECT * FROM onboarding_profiles WHERE candidateId=?'+(lock?' FOR UPDATE':''),[user.id]);ensure(profile?.firstName&&profile?.lastName,'The candidate must complete their personal information before activation.');
  return {user,profile,documents,contract};
}
export const completeOnboardingTool:Tool={
  id:'onboarding.complete',label:'Complete onboarding and activate employee',module:'onboarding',scope:'staff',permission:'canCreate',risk:'high',service:'Transactional onboarding activation with canonical reporting and employee mapping',
  description:'After approved documents and a signed agreement, create the employee profile, map organization and roster, and enable employee login in one transaction.',examples:['Complete onboarding for a candidate'],
  fields:[{name:'email',label:'Candidate email',required:true},{name:'joinDate',label:'Join date',type:'date',required:true},...Object.keys(masters).map(name=>({name,label:`Exact ${name} name or ID`,required:true})),{name:'manager',label:'Reporting manager name or employee number',required:true}],
  schema:z.object({email:z.string().trim().email(),joinDate:dateSchema,company:text,location:text,department:text,designation:text,employmentType:text,roster:text,manager:text}).strict(),
  prepare:async(c,v)=>{
    const candidate=await readyCandidate(c,v.email),manager=employeeFor(c,v.manager);ensure(manager.organizationalRank!=='EMPLOYEE','Select a reporting manager with a higher organization rank.');
    const mapping:Record<string,string>={},labels:string[]=[];
    for(const [field,table] of Object.entries(masters)) {
      const [rows]=await db.query<RowDataPacket[]>(`SELECT * FROM ${table} WHERE id=? OR LOWER(name)=?`,[v[field],v[field].toLowerCase()]);
      const found=rows.filter(r=>r.isActive!==0&&r.status!=='Inactive'&&(field!=='department'||r.structureType==='Department'));
      ensure(found.length===1,`Select one active, exact ${field} name or ID.`);mapping[field]=found[0].id;labels.push(`${field}: ${found[0].name}`);
    }
    return {args:{email:v.email.toLowerCase(),candidateId:candidate.user.id,joinDate:v.joinDate,mapping,managerId:manager.id},summary:`Activate ${candidate.user.name} (${v.email}) as an Employee from ${v.joinDate}. Reporting manager: ${manager.name}. ${labels.join('; ')}. An employee number will be allocated. Submitted profile/contact/bank details will be copied; login credentials stay unchanged.`,before:JSON.parse(JSON.stringify({profile:candidate.profile,documents:candidate.documents,contract:candidate.contract}))};
  },
  execute:async(c,v)=>{
    const conn=await db.getConnection(),id=randomUUID();let employeeNumber='';
    try {
      await conn.beginTransaction();
      // Serializes allocation and reporting validation against concurrent onboarding/moves.
      const [existing]=await conn.query<RowDataPacket[]>('SELECT id,employeeNumber,employeeNo FROM employee_information_employees ORDER BY id FOR UPDATE');
      const candidate=await readyCandidate(c,v.email,conn,true),p=candidate.profile;
      ensure(candidate.user.id===v.candidateId,'The candidate changed. Request a new preview.',409);
      const max=existing.reduce((n,r)=>Math.max(n,...[r.employeeNumber,r.employeeNo].map(x=>/^EMP-\d+$/i.test(x||'')?Number(x.slice(4)):0)),0);employeeNumber=`EMP-${String(max+1).padStart(6,'0')}`;
      const m=v.mapping;
      for(const [field,table] of Object.entries(masters)){const [[r]]=await conn.query<RowDataPacket[]>(`SELECT * FROM ${table} WHERE id=? FOR UPDATE`,[m[field]]);ensure(r&&r.isActive!==0&&r.status!=='Inactive',`The selected ${field} changed. Request a new preview.`,409);}
      await conn.query(`INSERT INTO employee_information_employees (id,userId,employeeNumber,employeeNo,firstName,lastName,employmentTypeId,dateJoined,status,employeeStatus,isActive,organizationalRank,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,'Active','Active',1,'EMPLOYEE',NOW(),NOW())`,[id,candidate.user.id,employeeNumber,employeeNumber,p.firstName,p.lastName,m.employmentType,v.joinDate]);
      await conn.query('INSERT INTO employee_information_personal_details (id,employeeId,firstName,lastName,fullName,dob,gender,nationality) VALUES (?,?,?,?,?,?,?,?)',[randomUUID(),id,p.firstName,p.lastName,[p.firstName,p.lastName].join(' '),p.dateOfBirth||null,p.gender||null,p.nationality||null]);
      await conn.query('INSERT INTO employee_information_workstation_details (id,employeeId,companyId,locationId,departmentId,designationId,employmentTypeId) VALUES (?,?,?,?,?,?,?)',[randomUUID(),id,m.company,m.location,m.department,m.designation,m.employmentType]);
      await conn.query('INSERT INTO employee_information_contact_details (id,employeeId,official,permanent,residential,linkedIn) VALUES (?,?,?,?,?,?)',[randomUUID(),id,JSON.stringify({email:v.email}),JSON.stringify({address:[p.addressLine1,p.addressLine2].filter(Boolean).join(' '),city:p.city||'',postalCode:p.postalCode||''}),JSON.stringify({personal:{email:v.email,mobile:p.phoneNumber||'',alternatePhone:p.alternatePhone||''},emergencyContacts:p.emergencyContactName?[{name:p.emergencyContactName,relationship:p.emergencyContactRelation||'',primaryPhone:p.emergencyContactPhone||''}]:[]}),p.linkedIn||null]);
      if(p.bankName&&p.accountNumber) await conn.query('INSERT INTO employee_information_bank_details (id,employeeId,bankName,accountNo,accountHolderName,accountType,currency,transferMode,amountOrPercentage,priority,isActive) VALUES (?,?,?,?,?,?,?,\'Percentage\',100,1,1)',[randomUUID(),id,p.bankName,p.accountNumber,p.accountHolderName||null,p.accountType||'Savings',p.currency||'LKR']);
      await syncEmployeeMappings(conn,id);
      await changeReporting(conn,[{employeeId:id,managerId:v.managerId,organizationalRank:'EMPLOYEE'}],c.userId,v.joinDate,'Completed onboarding through Assistant');
      await assignRoster(conn,id,m.roster,v.joinDate);
      await conn.query('UPDATE users SET role=\'EMPLOYEE\',updatedAt=NOW() WHERE id=?',[candidate.user.id]);
      await conn.query('INSERT INTO employee_information_audit_logs (id,employeeId,userId,action,createdAt) VALUES (?,?,?,?,NOW())',[randomUUID(),id,c.userId,'ONBOARDING_COMPLETED']);
      await conn.commit();
    } catch(e){await conn.rollback();throw e;} finally{conn.release();}
    let note='';try{await processEntitlementsForEmployee(id);}catch{note=' Leave entitlements could not be calculated automatically; HR must check leave configuration before the first request.';}
    return {message:`Onboarding completed: ${employeeNumber}. Employee login, organization, reporting manager and roster are mapped.${note}`,recordId:id,links:[{label:'Employee Information',path:'/employee-information'}]};
  }
};
