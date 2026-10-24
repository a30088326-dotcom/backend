import { randomUUID } from 'node:crypto';
import { repository, type RepositorySession } from '../../storage/repository';
import { LeaveRulesEvaluator } from '../leave-management/services/leaveRulesEvaluator';

export async function processEntitlementsNative(employeeId:string, session?:RepositorySession, options:{assumeConfirmed?:boolean}={}) {
  const work = async (tx:RepositorySession)=>{
    const employee=await tx.get('employee_information_employees',{id:employeeId});
    if(!employee)throw new Error('Employee not found');
    if(Number(employee.isActive??1)===0)throw new Error('Employee must be active to allocate leaves.');
    if(!employee.userId)throw new Error('Employee login account must be linked before allocating leaves.');
    if(!employee.dateJoined)throw new Error('Employee has no join date configured');
    // Shared aggregate CAS serializes allocations with leave applications and employment changes.
    await tx.replace('employee_information_employees',{...employee});
    const currentYear=Number(new Date(Date.now()+330*60000).toISOString().slice(0,4));
    let leaveYear=(await tx.find('leave_years',r=>Number(r.year)===currentYear))[0];
    if(!leaveYear)leaveYear=await tx.create('leave_years',{id:randomUUID(),year:currentYear,displayName:String(currentYear),startDate:`${currentYear}-01-01`,endDate:`${currentYear}-12-31`,isActive:1});
    const types=await tx.find('leave_types',r=>!!r.isActive),scripts=await tx.find('leave_rule_scripts',()=>true),generated=[];
    for(const type of types){
      const name=`${String(type.name).replace(/ /g,'_')}_Sri_Lanka`;
      const script=scripts.find(r=>r.name===name)||scripts.find(r=>!!r.isDefault);
      const result=await LeaveRulesEvaluator.evaluate({employeeId,leaveTypeId:type.id,leaveYear:leaveYear.year,assumeConfirmed:options.assumeConfirmed},script?.content,tx);
      const hasCarry=/output\s*\.\s*carryForwardAmount\s*=/.test(script?.content||'');
      const old=(await tx.find('leave_entitlements',r=>r.userId===employee.userId&&r.leaveTypeId===type.id&&r.leaveYearId===leaveYear!.id))[0];
      if(old)await tx.replace('leave_entitlements',{...old,totalDays:result.entitlement,...(hasCarry?{carryForwardDays:result.carryForwardAmount}:{})});
      else await tx.create('leave_entitlements',{id:randomUUID(),userId:employee.userId,leaveTypeId:type.id,leaveYearId:leaveYear.id,totalDays:result.entitlement,usedDays:0,pendingDays:0,carryForwardDays:hasCarry?result.carryForwardAmount:0,earnedDays:0,status:'PROCESSED'});
      generated.push({type:type.code,days:result.entitlement});
    }
    return generated;
  };
  return session ? work(session) : repository().transaction(work);
}
export async function entitlementsReportNative(){
  const repo=repository();
  const [users,employees,years,types,entitlements,invites]=await Promise.all([repo.find('users',r=>r.role!=='CANDIDATE'&&!!r.isActive),repo.find('employee_information_employees',r=>!!r.isActive),repo.find('leave_years',r=>!!r.isActive),repo.find('leave_types',()=>true),repo.find('leave_entitlements',()=>true),repo.find('invites',()=>true)]);
  const year=years.sort((a,b)=>Number(b.year)-Number(a.year))[0];
  return users.filter(u=>employees.some(e=>e.userId===u.id)).map(user=>{
    const employee=employees.find(e=>e.userId===user.id)!,joined=employee.dateJoined||invites.find(i=>i.invitedUserId===user.id)?.joinedDate;
    const balances:Record<string,number>={};
    for(const type of types){let code=String(type.code).toUpperCase();if(['AL001','ANN','ANNUAL'].includes(code))code='AL';if(['MED','MEDICAL'].includes(code))code='ML';if(['CAS','CASUAL'].includes(code))code='CL';const ent=entitlements.find(e=>e.userId===user.id&&e.leaveTypeId===type.id&&e.leaveYearId===year?.id);balances[code]=ent?Number(ent.totalDays||0)+Number(ent.carryForwardDays||0)-Number(ent.usedDays||0)-Number(ent.pendingDays||0):0;}
    return {employeeId:employee.employeeNo||String(user.id).slice(0,8),name:user.name||`User ${String(user.id).slice(0,5)}`,joinDate:joined?String(joined).slice(0,10):'N/A',balances,leaveYear:year?.year||null};
  });
}
