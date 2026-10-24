import { randomUUID } from 'crypto';
import { repository, type RepositorySession } from '../../storage/repository';
import type { EntityName } from '../../storage/table-definitions';
import { canManageCandidate } from '../../middleware/module-action';
import { processEntitlementsNative } from '../leave/entitlements.native';
import { assignRoster } from '../attendance/roster.service';
import { changeReportingNative } from '../../shared/services/organization.service';
import { employeeFor } from './policy';
import { ensure, type Context } from './types';
import { touchEimReferences } from '../eim/eim.dynamo.service';

const masters={company:'eim_companies',location:'eim_locations',department:'eim_structures',designation:'designations',employmentType:'employment_types',roster:'attendance_roster_groups'} as const;
async function candidate(c:Context,email:string,tx:RepositorySession=repository()) {
  const user=(await tx.find('users',r=>r.email.toLowerCase()===email.toLowerCase()))[0];
  ensure(user?.isActive&&user.role==='CANDIDATE','Choose an active candidate who accepted an invitation and is not already an employee.');
  ensure(await canManageCandidate(c,user.id),'Candidate is outside your onboarding scope.',403);
  ensure(!(await tx.find('employee_information_employees',r=>r.userId===user.id)).length,'This candidate already has an employee profile.',409);
  const documents=(await tx.find('documents',r=>r.candidateId===user.id)).sort((a,b)=>a.type.localeCompare(b.type));
  ensure(['NATIONAL_ID','BANK_STATEMENT','PASSPORT_PHOTO'].every(type=>documents.some(d=>d.type===type&&d.status==='APPROVED'))&&documents.every(d=>d.status==='APPROVED'),'The required documents must be reviewed and approved first.');
  const contract=(await tx.find('contracts',r=>r.candidateId===user.id))[0];ensure(contract?.status==='SIGNED','The candidate must sign the employment agreement first.');
  const profile=(await tx.find('onboarding_profiles',r=>r.candidateId===user.id))[0];ensure(profile?.firstName&&profile.lastName,'The candidate must complete their personal information before activation.');
  return {user,profile,documents:documents.map(({type,status})=>({type,status})),contract:{id:contract.id,status:contract.status}};
}
export async function prepare(c:Context,v:any) {
  const ready=await candidate(c,v.email),manager=employeeFor(c,v.manager);ensure(manager.organizationalRank!=='EMPLOYEE','Select a reporting manager with a higher organization rank.');
  const mapping:Record<string,string>={},labels:string[]=[];
  for(const [field,table] of Object.entries(masters)){const found=await repository().find(table,r=>(r.id===v[field]||r.name.toLowerCase()===v[field].toLowerCase())&&r.isActive!==0&&r.status!=='Inactive'&&(field!=='department'||r.structureType==='Department'));ensure(found.length===1,`Select one active, exact ${field} name or ID.`);mapping[field]=found[0].id;labels.push(`${field}: ${found[0].name}`);}
  return {args:{email:v.email.toLowerCase(),candidateId:ready.user.id,joinDate:v.joinDate,mapping,managerId:manager.id},summary:`Activate ${ready.user.name} (${v.email}) as an Employee from ${v.joinDate}. Reporting manager: ${manager.name}. ${labels.join('; ')}. An employee number will be allocated. Submitted profile/contact/bank details will be copied; login credentials stay unchanged.`,before:JSON.parse(JSON.stringify({profile:ready.profile,documents:ready.documents,contract:ready.contract}))};
}
export async function execute(c:Context,v:any) {
  const id=randomUUID();let employeeNumber='';
  await repository().transaction(async tx=>{
    await touchEimReferences(tx);
    const ready=await candidate(c,v.email,tx),p=ready.profile;ensure(ready.user.id===v.candidateId,'The candidate changed. Request a new preview.',409);
    const existing=await tx.find('employee_information_employees',()=>true);
    const max=existing.reduce((n,r)=>Math.max(n,...[r.employeeNumber,r.employeeNo].map(value=>/^EMP-\d+$/i.test(value||'')?Number(value.slice(4)):0)),0);employeeNumber=`EMP-${String(max+1).padStart(6,'0')}`;
    const selected:Record<string,any>={};
    for(const [field,table] of Object.entries(masters)){const row=await tx.get(table as EntityName,{id:v.mapping[field]});ensure(row&&row.isActive!==0&&row.status!=='Inactive',`The selected ${field} changed. Request a new preview.`,409);selected[field]=row;}
    await tx.create('employee_information_employees',{id,userId:ready.user.id,employeeNumber,employeeNo:employeeNumber,firstName:p.firstName,lastName:p.lastName,email:ready.user.email,employmentTypeId:selected.employmentType.id,employmentType:selected.employmentType.name,dateJoined:v.joinDate,status:'Active',employeeStatus:'Active',isActive:1,organizationalRank:'EMPLOYEE',companyId:selected.company.id,locationId:selected.location.id,departmentId:selected.department.id,department:selected.department.name,designationId:selected.designation.id,designation:selected.designation.name});
    await tx.create('employee_information_personal_details',{id:randomUUID(),employeeId:id,firstName:p.firstName,lastName:p.lastName,fullName:[p.firstName,p.lastName].join(' '),dob:p.dateOfBirth||null,gender:p.gender||null,nationality:p.nationality||null});
    await tx.create('employee_information_workstation_details',{id:randomUUID(),employeeId:id,companyId:selected.company.id,locationId:selected.location.id,departmentId:selected.department.id,designationId:selected.designation.id,employmentTypeId:selected.employmentType.id});
    await tx.create('employee_information_contact_details',{id:randomUUID(),employeeId:id,official:{email:v.email},permanent:{address:[p.addressLine1,p.addressLine2].filter(Boolean).join(' '),city:p.city||'',postalCode:p.postalCode||''},residential:{personal:{email:v.email,mobile:p.phoneNumber||'',alternatePhone:p.alternatePhone||''},emergencyContacts:p.emergencyContactName?[{name:p.emergencyContactName,relationship:p.emergencyContactRelation||'',primaryPhone:p.emergencyContactPhone||''}]:[]},linkedIn:p.linkedIn||null});
    if(p.bankName&&p.accountNumber)await tx.create('employee_information_bank_details',{id:randomUUID(),employeeId:id,bankName:p.bankName,accountNo:p.accountNumber,accountHolderName:p.accountHolderName||null,accountType:p.accountType||'Savings',currency:p.currency||'LKR',transferMode:'Percentage',amountOrPercentage:100,priority:1,isActive:1});
    await changeReportingNative(tx,[{employeeId:id,managerId:v.managerId,organizationalRank:'EMPLOYEE'}],c.userId,v.joinDate,'Completed onboarding through Assistant');
    await assignRoster(tx,id,selected.roster.id,v.joinDate);
    const updatedUser=await tx.get('users',{id:ready.user.id});ensure(updatedUser,'Candidate changed.',409);await tx.replace('users',{...updatedUser,role:'EMPLOYEE',name:[p.firstName,p.lastName].filter(Boolean).join(' ')});
    await tx.create('employee_information_audit_logs',{id:randomUUID(),employeeId:id,userId:c.userId,action:'ONBOARDING_COMPLETED'});
    await processEntitlementsNative(id, tx);
  });
  return {message:`Onboarding completed: ${employeeNumber}. Employee login, organization, reporting manager, roster and leave entitlements are mapped.`,recordId:id,links:[{label:'Employee Information',path:'/employee-information'}]};
}
