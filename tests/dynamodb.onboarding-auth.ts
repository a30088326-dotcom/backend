import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { unlink, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import bcrypt from 'bcryptjs';
import { memory } from './dynamodb.domain-memory';
import { withRepositoryForTests } from '../src/storage/repository';
import { generateToken } from '../src/middleware/auth';
import { errorHandler } from '../src/middleware/validate';
import auth from '../src/modules/auth/auth.routes';
import users from '../src/modules/auth/users.routes';
import onboarding from '../src/modules/onboarding/onboarding.routes';
import invites from '../src/modules/onboarding/invites.routes';
import contracts from '../src/modules/onboarding/contracts.routes';
import documents from '../src/modules/onboarding/documents.routes';
import files from '../src/modules/onboarding/files.routes';
import { db } from '../src/lib/db';

process.env.NODE_ENV = 'test'; process.env.DATABASE_PROVIDER = 'dynamodb'; process.env.UPLOAD_STORAGE = 'local';
process.env.JWT_SECRET = 'native-onboarding-fixture-secret-at-least-32-bytes';
process.env.SMTP_USER = ''; process.env.SMTP_PASS = '';
(db as any).query = async () => { throw new Error('SQL reached from native onboarding runtime'); };
(db as any).getConnection = async () => { throw new Error('SQL connection reached from native onboarding runtime'); };
const profile = { firstName:'Test',lastName:'Candidate',dateOfBirth:'2000-10-23',gender:'Male',nationality:'Sri Lankan',addressLine1:'Test address',city:'Colombo',postalCode:'00100',phoneNumber:'0770000000',alternatePhone:'0110000000',linkedIn:'https://example.test/profile',emergencyContactName:'Test Parent',emergencyContactRelation:'Father',emergencyContactPhone:'0770000001',bankName:'Test Bank',accountHolderName:'Test Candidate',accountNumber:'0000000000',accountType:'SAVINGS',currency:'LKR' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7Q0AAAAASUVORK5CYII=', 'base64');

async function fixture(work: (f: any) => Promise<void>) {
  const { repo } = memory(), ids = { admin: randomUUID(), candidate: randomUUID(), outsider: randomUUID(), delegated: randomUUID() };
  const tokens: Record<string,string> = {};
  for (const [who, id] of Object.entries(ids)) {
    const role = who === 'admin' ? 'SUPER_ADMIN' : who === 'candidate' ? 'CANDIDATE' : 'EMPLOYEE';
    await repo.create('users', { id, email:`${who}@onboarding.test`, name:`Test ${who}`, role, isActive:1, mustChangePassword:0, password:await bcrypt.hash('123456',4) });
    tokens[who] = generateToken({ userId:id, email:`${who}@onboarding.test`, role });
  }
  await repo.create('user_module_permissions', { id: randomUUID(), userId:ids.delegated,moduleId:'onboarding',moduleAccess:1,canView:1,canCreate:1,dataScope:'OWN' });
  const app = express(); app.use(express.json({ limit: '3mb' }));
  app.use((_req, _res, next) => { void withRepositoryForTests(repo, async () => next()); });
  app.use('/api/auth', auth); app.use('/api/users', users); app.use('/api/onboarding', onboarding);
  app.use('/api/invites', invites); app.use('/api/contracts', contracts); app.use('/api/documents', documents); app.use('/api/files', files);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const cleanup = new Set<string>();
  async function request(who: string, method: string, url: string, body?: any) {
    const multipart = body instanceof FormData;
    const result = await fetch(base + url, { method, headers: { ...(tokens[who] ? { Authorization: `Bearer ${tokens[who]}` } : {}), ...(!multipart && body !== undefined ? { 'Content-Type':'application/json' } : {}) }, body: body === undefined ? undefined : multipart ? body : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const value = result.headers.get('content-type')?.includes('application/json') ? await result.json() : Buffer.from(await result.arrayBuffer());
    if (value?.data?.fileUrl?.startsWith('/api/files/')) cleanup.add(decodeURIComponent(value.data.fileUrl.split('/').pop()));
    if (value?.data?.signatureUrl?.startsWith('/api/files/')) cleanup.add(decodeURIComponent(value.data.signatureUrl.split('/').pop()));
    return { status: result.status, body: value, headers: result.headers };
  }
  try { await work({ repo, ids, tokens, request, cleanup }); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); for (const filename of cleanup) if (filename === path.basename(filename)) await unlink(path.join('uploads',filename)).catch(() => undefined); }
}

test('native auth preserves legacy password login, current permissions, forced-change and disabled-user guards', async () => fixture(async ({ repo, ids, request }: any) => {
  assert.equal((await request('', 'POST','/api/auth/login',{ email:'candidate@onboarding.test',password:'incorrect' })).status,401);
  const login = await request('', 'POST','/api/auth/login',{ email:'CANDIDATE@onboarding.test',password:'123456' });
  assert.equal(login.status,200); assert.ok(login.body.token); assert.ok(!JSON.stringify(login.body).includes('password'));
  const current = await repo.get('users',{ id:ids.candidate }); await repo.replace('users',{ ...current,mustChangePassword:1 });
  assert.equal((await request('candidate','GET','/api/onboarding')).status,403);
  assert.equal((await request('candidate','GET','/api/auth/me')).body.user.mustChangePassword,true);
  assert.equal((await request('candidate','POST','/api/auth/change-password',{currentPassword:'wrong',newPassword:'new-password'})).status,400);
  assert.equal((await request('candidate','POST','/api/auth/change-password',{currentPassword:'123456',newPassword:'new-password'})).status,200);
  assert.equal((await request('candidate','GET','/api/onboarding')).status,200);
  const user = await repo.get('users',{ id:ids.candidate }); await repo.replace('users',{...user,isActive:0});
  assert.equal((await request('candidate','GET','/api/auth/me')).status,401);
}));
test('native onboarding saves every profile field and private user views survive reload without leaking to outsiders', async () => fixture(async ({ ids, request }: any) => {
  assert.equal((await request('candidate','POST','/api/onboarding',profile)).status,201);
  const saved = await request('candidate','GET','/api/onboarding');
  for (const [key,value] of Object.entries(profile)) assert.equal(saved.body.data[key],value,key);
  assert.equal((await request('candidate','POST','/api/onboarding',{ ...profile,city:'Kandy' })).status,201);
  assert.equal((await request('candidate','GET','/api/users/me')).body.data.onboardingProfile.city,'Kandy');
  assert.equal((await request('admin','GET',`/api/onboarding/${ids.candidate}`)).body.data.candidate.email,'candidate@onboarding.test');
  assert.equal((await request('outsider','GET',`/api/onboarding/${ids.candidate}`)).status,403);
  const listing = await request('outsider','GET','/api/users'); assert.equal(listing.status,200); assert.equal(listing.body.data.length,0);
  assert.equal((await request('candidate','POST','/api/onboarding',{ ...profile,gender:'' })).status,400);
}));
test('native invitations enforce one pending email, accept once atomically, preserve account on invite delete and enforce scope', async () => fixture(async ({ repo, request }: any) => {
  const creation = await request('admin','POST','/api/invites',{name:'Test Invited',email:'invited@onboarding.test',role:'CANDIDATE'});
  assert.equal(creation.status,201); const token = creation.body.data.inviteLink.split('/').pop(), id = creation.body.data.invite.id;
  assert.equal(creation.body.data.delivery.sent,false);
  assert.equal((await request('admin','POST','/api/invites',{name:'Duplicate',email:'INVITED@onboarding.test'})).status,409);
  assert.equal((await request('','GET',`/api/invites/${token}`)).status,200);
  const accepted = await Promise.all([1,2].map(() => request('','POST',`/api/invites/${token}/accept`,{password:'fixture-password'})));
  assert.equal(accepted.filter(r=>r.status===200).length,1); assert.equal(accepted.filter(r=>r.status===409).length,1);
  assert.equal((await repo.find('users',(u:any)=>u.email==='invited@onboarding.test')).length,1);
  assert.equal((await request('admin','DELETE',`/api/invites/${id}`)).status,409);
  assert.equal((await request('delegated','POST','/api/invites',{name:'Privilege',email:'privilege@onboarding.test',role:'ADMIN'})).status,403);
  assert.equal((await request('delegated','POST',`/api/invites/${id}/resend`)).status,403);
}));
test('native invitation expiry uses Colombo legacy datetimes and cloud ISO dates consistently', async () => fixture(async ({ repo, ids, request }: any) => {
  await repo.create('invites',{id:randomUUID(),email:'expired@onboarding.test',name:'Expired Fixture',role:'CANDIDATE',status:'PENDING',token:'expired-native-token',expiresAt:'2020-01-01 12:00:00',invitedById:ids.admin});
  assert.equal((await request('','GET','/api/invites/expired-native-token')).status,410);
  assert.equal((await repo.find('invites',(i:any)=>i.token==='expired-native-token'))[0].status,'EXPIRED');
  assert.equal((await request('','POST','/api/invites/expired-native-token/accept',{password:'fixture-password'})).status,410);
  assert.equal((await repo.find('users',(u:any)=>u.email==='expired@onboarding.test')).length,0);
}));
test('native document upload limit, review, rejected resubmission, bytes and private file authorization work together', async () => fixture(async ({ ids, request }: any) => {
  const upload = () => { const f = new FormData(); f.set('documentType','NATIONAL_ID'); f.set('label','Fixture document'); f.set('file',new Blob([png],{type:'image/png'}),'fixture.png'); return f; };
  const docs = [];
  for(let i=0;i<4;i++) { const result = await request('candidate','POST','/api/documents/upload',upload()); assert.equal(result.status,201,result.body.message); docs.push(result.body.data); }
  assert.equal((await request('candidate','POST','/api/documents/upload',upload())).status,409);
  const own = await request('candidate','GET',docs[0].fileUrl); assert.equal(own.status,200); assert.deepEqual(own.body,png); assert.equal(own.headers.get('cache-control'),'private, no-store');
  assert.equal((await request('','GET',docs[0].fileUrl)).status,401);
  assert.equal((await request('outsider','GET',docs[0].fileUrl)).status,404);
  assert.equal((await request('outsider','GET',`/api/documents?candidateId=${ids.candidate}`)).status,403);
  assert.equal((await request('admin','PATCH',`/api/documents/${docs[0].id}/verify`,{status:'REJECTED',rejectionNote:'Fixture re-upload'})).status,200);
  const replacement = await request('candidate','POST','/api/documents/upload',upload()); assert.equal(replacement.status,201); assert.equal(replacement.body.data.id,docs[0].id);
  assert.equal((await request('candidate','GET','/api/documents')).body.data.length,4);
  assert.equal((await request('admin','PATCH',`/api/documents/${docs[0].id}/verify`,{status:'APPROVED'})).status,200);
  assert.equal((await request('admin','PATCH',`/api/documents/${docs[0].id}/verify`,{status:'REJECTED',rejectionNote:'Second decision'})).status,409);
}));
test('native contracts serialize duplicate creation and preserve immutable signed content and private signature after reload', async () => fixture(async ({ ids, request }: any) => {
  const body = { candidateId:ids.candidate,title:'Fixture Contract',templateContent:'Hello {{Name}}',fieldValues:{Name:'Fixture'} };
  const created = await Promise.all([1,2].map(()=>request('admin','POST','/api/contracts',body)));
  assert.equal(created.filter(r=>r.status===201).length,1); assert.equal(created.filter(r=>r.status===409).length,1);
  const contract = created.find(r=>r.status===201)!.body.data;
  assert.equal((await request('outsider','GET',`/api/contracts/${contract.id}`)).status,403);
  assert.equal((await request('admin','PUT',`/api/contracts/${contract.id}`,{templateContent:'Updated {{Name}}',fieldValues:{Name:'Candidate'}})).status,200);
  assert.equal((await request('outsider','POST',`/api/contracts/${contract.id}/sign`,{signatureDataUrl:`data:image/png;base64,${png.toString('base64')}`})).status,403);
  const signed = await request('candidate','POST',`/api/contracts/${contract.id}/sign`,{signatureDataUrl:`data:image/png;base64,${png.toString('base64')}`});
  assert.equal(signed.status,200,signed.body.message); assert.equal(signed.body.data.status,'SIGNED');
  const reread = await request('candidate','GET',`/api/contracts/${contract.id}`); assert.equal(reread.body.data.renderedContent,'Updated Candidate');
  assert.equal((await request('candidate','GET',reread.body.data.signatureUrl)).status,200);
  assert.equal((await request('outsider','GET',reread.body.data.signatureUrl)).status,404);
  assert.equal((await request('admin','PUT',`/api/contracts/${contract.id}`,{templateContent:'Changed',fieldValues:{}})).status,409);
}));
test('staff can read their manager profile image while unrelated avatars and identity documents remain private', async () => fixture(async ({ repo, ids, request, cleanup }: any) => {
  const managerId=randomUUID(),staffId=randomUUID(),avatar=`manager-avatar-${randomUUID()}.png`,document=`manager-document-${randomUUID()}.png`;
  await mkdir('uploads',{recursive:true});
  for(const filename of [avatar,document]) { await writeFile(path.join('uploads',filename),png); cleanup.add(filename); }
  const user=await repo.get('users',{id:ids.candidate});await repo.replace('users',{...user,role:'EMPLOYEE'});
  await repo.create('employee_information_employees',{id:managerId,userId:ids.admin,employeeNumber:'MANAGER-TEST',employeeNo:'MANAGER-TEST',status:'Active',isActive:1,avatar:`/api/files/${avatar}`});
  await repo.create('employee_information_employees',{id:staffId,userId:ids.candidate,employeeNumber:'STAFF-TEST',employeeNo:'STAFF-TEST',status:'Active',isActive:1,reportingManagerId:managerId});
  await repo.create('documents',{id:randomUUID(),candidateId:ids.admin,type:'NATIONAL_ID',fileUrl:`/api/files/${document}`,status:'PENDING'});
  assert.equal((await request('candidate','GET',`/api/files/${avatar}`)).status,200);
  assert.equal((await request('outsider','GET',`/api/files/${avatar}`)).status,404);
  assert.equal((await request('candidate','GET',`/api/files/${document}`)).status,404);
}));
