import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { memory } from './dynamodb.domain-memory';
import { withRepositoryForTests } from '../src/storage/repository';
import { StorageConflictError } from '../src/storage/dynamodb';
import * as setup from '../src/modules/performance/setup.service';
import * as performance from '../src/modules/performance/store';
import { changeReview } from '../src/modules/performance/review.service';
import { reviewDetails } from '../src/modules/performance/query.service';
import { historicalPerformance } from '../src/modules/performance/history.service';
import type { Actor, Review } from '../src/modules/performance/types';
import { ensureSchema, conversation, remember } from '../src/modules/assistant/store';
import { invoke, confirm } from '../src/modules/assistant/runtime';
import type { Context } from '../src/modules/assistant/types';
import { db } from '../src/lib/db';

process.env.NODE_ENV='test'; process.env.DATABASE_PROVIDER='dynamodb';
// Any accidental SQL fallback fails this suite instead of touching a local database.
(db as any).query=async()=>{throw new Error('SQL reached from DynamoDB runtime');};
(db as any).getConnection=async()=>{throw new Error('SQL connection reached from DynamoDB runtime');};
const employeeId=randomUUID(), managerId=randomUUID(), userId=randomUUID(), managerUser=randomUUID();
const employees=[{id:employeeId,userId,name:'Test Employee',employeeNumber:'EMP-TEST-1',department:'Tests',designation:'Tester',managerId,managerName:'Test Manager',active:true,organizationalRank:'EMPLOYEE'},{id:managerId,userId:managerUser,name:'Test Manager',employeeNumber:'EMP-TEST-2',department:'Tests',designation:'Manager',managerId:null,managerName:'',active:true,organizationalRank:'MANAGER'}];
const admin:Actor={userId:managerUser,employeeId:managerId,admin:true,executive:false,employees};
const employee:Actor={userId,employeeId,admin:false,executive:false,employees};
const template={name:'Native review',description:'Test',goalWeight:70,competencies:[{id:'quality',name:'Quality',description:'Quality',weight:30}],questions:[{id:'question',section:'Review',prompt:'How was your work?',required:true}]};
async function cycle() {
  const saved=await setup.saveTemplate(admin,template); await setup.publishTemplate(admin,saved.id);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Colombo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const result=await setup.saveCycle(admin,{name:'Native cycle',description:'',startDate:today,endDate:today,selfDeadline:today,managerDeadline:today,templateId:saved.id,employeeIds:[employeeId],feedbackRequired:false,developmentRequired:false});
  await setup.transitionCycle(admin,result.id,'launch');
  return {cycle:result,review:(await performance.list<Review>('reviews'))[0]};
}
test('native performance launch atomically creates review, notifications and audit, duplicate launch blocked',async()=>{
  const {repo}=memory();await withRepositoryForTests(repo,async()=>{const {cycle:created,review}=await cycle();assert.equal(review.employeeId,employeeId);assert.equal((await repo.find('hr_performance_notifications',()=>true)).length,1);assert.ok((await repo.find('hr_performance_audit',()=>true)).length>=4);await assert.rejects(setup.transitionCycle(admin,created.id,'launch'),/draft cycle/);assert.equal((await performance.list('reviews')).length,1);});
});
test('native performance keeps drafts private and rejects unrelated writes and stale review versions',async()=>{
  const {repo}=memory();await withRepositoryForTests(repo,async()=>{const {review}=await cycle();await changeReview(employee,review.id,{action:'self-save',version:1,payload:{answers:{question:'Private draft'},goalRatings:{},competencyRatings:{},comment:'Private comment'}});const managerView=await reviewDetails(admin,review.id);assert.equal(managerView.self.comment,'');await assert.rejects(changeReview(employee,review.id,{action:'self-share',version:1}),/changed in another session/);const unrelated={...employee,userId:randomUUID(),employeeId:randomUUID()};await assert.rejects(changeReview(unrelated,review.id,{action:'self-save',version:2,payload:{}}),/access/);assert.equal((await performance.get<Review>('reviews',review.id)).version,2);});
});
test('native performance concurrent saves commit once with their audit receipt',async()=>{
  const {repo}=memory();await withRepositoryForTests(repo,async()=>{const {review}=await cycle();const before=(await repo.find('hr_performance_audit',()=>true)).length;const results=await Promise.allSettled([1,2].map(n=>changeReview(employee,review.id,{action:'self-save',version:1,payload:{answers:{question:'Draft '+n},goalRatings:{},competencyRatings:{},comment:'Comment '+n}})));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.equal((await repo.find('hr_performance_audit',()=>true)).length,before+1);assert.equal((await performance.get<Review>('reviews',review.id)).version,2);});
});
test('native performance launches eighty employee reviews without exceeding transaction limits',async()=>{
  const {repo,calls}=memory();await withRepositoryForTests(repo,async()=>{const saved=await setup.saveTemplate(admin,template);await setup.publishTemplate(admin,saved.id);const ids=Array.from({length:80},()=>randomUUID());const actor={...admin,employees:[...employees,...ids.map(id=>({...employees[0],id,userId:randomUUID()}))]};const data=await setup.saveCycle(actor,{name:'Large staged launch',startDate:'2026-01-01',endDate:'2027-01-01',selfDeadline:'2026-11-01',managerDeadline:'2026-12-01',templateId:saved.id,employeeIds:ids,feedbackRequired:false,developmentRequired:false});await setup.transitionCycle(actor,data.id,'launch');assert.equal((await performance.list('reviews')).length,80);assert.equal((await repo.find('hr_performance_notifications',()=>true)).length,80);assert.equal((await performance.get<any>('cycles',data.id)).status,'ACTIVE');assert.ok(calls.filter(c=>c.constructor.name==='TransactWriteCommand').every(c=>c.input.TransactItems.length<=100));});
});
test('interrupted native performance launch stays hidden and resumes without duplicate reviews or notifications',async()=>{
  const {repo}=memory();await withRepositoryForTests(repo,async()=>{
    const saved=await setup.saveTemplate(admin,template);await setup.publishTemplate(admin,saved.id);
    const ids=Array.from({length:35},()=>randomUUID());const actor={...admin,employees:[...employees,...ids.map(id=>({...employees[0],id,userId:randomUUID()}))]};
    const input={name:'Resumable launch',startDate:'2026-01-01',endDate:'2027-01-01',selfDeadline:'2026-11-01',managerDeadline:'2026-12-01',templateId:saved.id,employeeIds:ids,feedbackRequired:false,developmentRequired:false};
    const cycle=await setup.saveCycle(actor,input);const original=repo.store.transact.bind(repo.store);let commits=0;
    repo.store.transact=async(items,token)=>{if(++commits===3)throw new Error('Injected transport interruption');return original(items,token);};
    await assert.rejects(setup.transitionCycle(actor,cycle.id,'launch'),/progress saved \(10\/35\)/);
    assert.equal((await repo.find('hr_performance_reviews',()=>true)).length,10);
    assert.equal((await performance.list('reviews')).length,0);
    assert.equal((await performance.notifications(actor.employees.find(e=>e.id===ids[0])!.userId!)).length,0);
    const {dashboardInputsNative}=await import('../src/shared/services/dashboard.dynamo');
    assert.equal((await dashboardInputsNative(ids,[], '2026-10-24')).reviews.length,0);
    await assert.rejects(setup.saveCycle(actor,{...input,name:'Changed'},cycle.id),/launching/);
    await assert.rejects(setup.transitionCycle(actor,cycle.id,'delete'),/launching/);
    repo.store.transact=original;await setup.transitionCycle(actor,cycle.id,'launch');
    assert.equal((await performance.list('reviews')).length,35);
    assert.equal((await repo.find('hr_performance_notifications',()=>true)).length,35);
    assert.equal((await repo.find('hr_performance_audit',r=>r.event==='CYCLE_LAUNCH')).length,1);
  });
});
test('native historical archive keeps manager drafts and anonymous feedback identities private', async () => {
  const { repo } = memory();
  await withRepositoryForTests(repo, async () => {
    const cycleId = randomUUID(), reviewId = randomUUID(), goalId = randomUUID();
    await repo.create('performance_cycles', { id: cycleId, name: 'Old cycle' });
    await repo.create('performance_reviews', { id: reviewId, performance_cycle_id: cycleId, employee_id: employeeId, reviewer_id: managerId, self_assessment: 'Self draft', manager_review: 'Private manager draft', manager_score: 5, status: 'DRAFT' });
    await repo.create('performance_goals', { id: goalId, performance_cycle_id: cycleId, employee_id: employeeId, title: 'Goal', manager_comment: 'Private goal manager comment', created_by: managerId });
    await repo.create('performance_feedback', { id: randomUUID(), performance_cycle_id: cycleId, employee_id: employeeId, from_employee_id: managerId, feedback: 'Shared feedback' });
    let result = await historicalPerformance(employee);
    assert.equal(result.reviews[0].managerReview, null);
    assert.equal(result.reviews[0].managerScore, null);
    assert.ok(!JSON.stringify(result).includes('Private manager draft'));
    assert.ok(!JSON.stringify(result).includes('Private goal manager comment'));
    assert.equal(result.feedback.length, 0);
    const row = (await repo.get('performance_reviews', { id: reviewId }))!;
    await repo.replace('performance_reviews', { ...row, closed_date: '2026-10-24', status: 'CLOSED' });
    result = await historicalPerformance(employee);
    assert.equal(result.feedback[0].feedback, 'Shared feedback');
    assert.equal(result.feedback[0].from_employee_id, undefined);
    assert.equal(result.goals[0].manager_comment, undefined);
  });
});
const context:Context={...admin,name:'Test Manager',role:'SUPER_ADMIN',superAdmin:true,manager:true,permissions:[],visibleIds:employees.map(e=>e.id),authorization:''};
test('native assistant initial settings creation is idempotent across simultaneous instances', async () => {
  const { repo } = memory();
  await withRepositoryForTests(repo, async () => {
    await Promise.all(Array.from({ length: 8 }, () => ensureSchema()));
    assert.equal((await repo.find('hr_assistant_settings', () => true)).length, 1);
  });
});
test('native assistant protects conversation ownership and omits credential messages',async()=>{
  const {repo}=memory();await withRepositoryForTests(repo,async()=>{await ensureSchema();const c=await conversation(context);await remember(context,c.id,'user','My password is confidential');assert.equal((await repo.find('hr_assistant_messages',()=>true))[0].text,'[Credential-related message omitted. Use the secure password form.]');await assert.rejects(conversation({...context,userId:'other'},c.id),/not found/);});
});
test('native assistant write preview, confirmation and duplicate confirmation execute extension once',async()=>{
  const {repo}=memory();await withRepositoryForTests(repo,async()=>{await ensureSchema();const request=randomUUID();const first:any=await invoke(context,'builder.addField',{label:'Test code',name:'test_code',type:'Text',employeeVisible:true},request);assert.equal(first.kind,'confirmation');assert.equal((await repo.find('hr_assistant_extensions',()=>true)).length,0);const results=await Promise.allSettled([confirm(context,request),confirm(context,request)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await repo.find('hr_assistant_extensions',()=>true)).length,1);assert.equal((await repo.find('hr_assistant_changes',()=>true)).length,1);const again:any=await confirm(context,request);assert.equal(again.kind,'result');assert.equal((await repo.find('hr_assistant_extensions',()=>true)).length,1);await assert.rejects(confirm({...context,userId:'other'},request),/not found/);});
});
test('native assistant rechecks permissions and target versions before writes',async()=>{
  const {repo}=memory();await withRepositoryForTests(repo,async()=>{await ensureSchema();const request=randomUUID();await invoke(context,'builder.addField',{label:'Test code',name:'test_code',type:'Text',employeeVisible:true},request);await assert.rejects(confirm({...context,superAdmin:false,admin:false,role:'EMPLOYEE'},request),/not enabled/);assert.equal((await repo.find('hr_assistant_extensions',()=>true)).length,0);const action=await repo.get('hr_assistant_actions',{id:request});assert.equal(action?.status,'PENDING');});
});
test('native conditional replacement refuses stale state without partially changing settings',async()=>{
  const {repo}=memory();await withRepositoryForTests(repo,async()=>{await ensureSchema();const row=(await repo.get('hr_assistant_settings',{id:'main'}))!;await repo.replace('hr_assistant_settings',{...row,data:{version:2}});await assert.rejects(repo.replace('hr_assistant_settings',{...row,data:{version:3}}),StorageConflictError);assert.equal((await repo.get('hr_assistant_settings',{id:'main'}))?.data.version,2);});
});
