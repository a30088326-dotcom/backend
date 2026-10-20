// Live read checks only. Assistant audit/conversation receipts are the only writes.
require('dotenv/config');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { db } = require('../dist/lib/db');
const { generateToken } = require('../dist/middleware/auth');
const { tools } = require('../dist/modules/assistant/tools');
const { contextFor, allowed } = require('../dist/modules/assistant/policy');
async function main() {
  let count = 0; let failed = 0;
  const [users] = await db.query(`SELECT u.id,u.email,u.role,e.organizationalRank,e.employeeNumber FROM users u JOIN employee_information_employees e ON e.userId=u.id WHERE u.isActive=1 AND u.mustChangePassword=0`);
  const actors = { owner: users.find(u=>u.role==='SUPER_ADMIN'), employee: users.find(u=>u.employeeNumber==='EMP-027'), manager:users.find(u=>u.employeeNumber==='EMP-002'), ceo:users.find(u=>u.organizationalRank==='CEO') };
  const inputs = { 'navigation.open':{page:'performance'},'help.guide':{topic:'performance'},'employee.search':{},'self.profile':{},'reporting.myManager':{},'reporting.team':{},'dashboard.summary':{},'leave.balance':{},'leave.requests':{},'leave.pending':{},'attendance.mine':{month:'2026-08'},'attendance.team':{month:'2026-08'},'performance.summary':{},'performance.review':{employee:'me'},'performance.invitations':{},'performance.cycles':{},'employee.diagnostics':{},'eim.list':{resource:'structures'},'eim.exportDepartments':{},'users.list':{},'account.password':{} };
  for(const [role,u] of Object.entries(actors)) {
    assert(u,`${role} account missing`); const token=generateToken({userId:u.id,role:u.role,email:u.email}); const authorization=`Bearer ${token}`; const c=await contextFor(u.id,authorization);
    inputs['help.capabilities'] = {};
    inputs['help.chat'] = {};
    inputs['onboarding.invites'] = {};
    inputs['onboarding.documents'] = {};
    const inbox=await fetch('http://127.0.0.1:3001/api/assistant/notifications',{headers:{Authorization:authorization}});
    const inboxData=await inbox.json();assert.equal(inbox.status,200,`${role}: notification endpoint`);assert(Array.isArray(inboxData.data));count++;console.log(`PASS ${role}: workflow inbox`);
    inputs['leave.team'] = {};
    inputs['attendance.mine'] = {month:'August 2026'};
    inputs['attendance.team'] = {month:'august'};
    for(const [id,args] of Object.entries(inputs)) {
      const tool=tools.find(t=>t.id===id); if(!allowed(c,tool)) continue;
      const response=await fetch('http://127.0.0.1:3001/api/assistant/invoke',{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({tool:id,args,requestId:randomUUID()})});
      const result=await response.json();
      if(response.ok && result.data.kind==='result') { count++; console.log(`PASS ${role}: ${id}`); }
      else { failed++; console.log(`FAIL ${role}: ${id}: ${response.status} ${result.message || result.data?.message}`); if(response.status===500) { try { await tool.execute(c,tool.schema.parse(args)); } catch(e) { console.log(`DETAIL ${id}: ${e.message}`); } } }
    }
    if(role==='employee' || role==='manager') {
      for(const message of ['i want 1 day leave','i want to leave 26 , 27 send mn reporting managr to leave request']) {
        const r=await fetch('http://127.0.0.1:3001/api/assistant/message',{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({message,requestId:randomUUID()})});
        const j=await r.json(); assert.equal(r.status,200); assert.equal(j.data.kind,'form'); assert.equal(j.data.tool.id,'leave.apply'); count++; console.log(`PASS ${role}: incomplete leave collects details without permission error`);
      }
      assert(allowed(c,tools.find(t=>t.id==='attendance.punch'))); count++; console.log(`PASS ${role}: own attendance marking is available`);
    }
  }
  console.log(`${count} live read checks passed; ${failed} failed. No employee records changed.`); if(failed) process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.end());
