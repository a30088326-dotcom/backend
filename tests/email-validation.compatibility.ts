import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import express from 'express';
import { once } from 'node:events';
import { validate } from '../src/middleware/validate';
import { createContractSchema, onboardingProfileSchema, createInviteSchema } from '../src/lib/validations';

test('updated Nodemailer accepts delivery, recipient rejection, SMTP auth failures and unconfigured SMTP without external mail',async()=>{
  let mode='accept';const messages:string[]=[];
  const server=net.createServer(socket=>{
    socket.setEncoding('utf8');socket.write('220 local.test ESMTP\r\n');let input='',body='',data=false;
    socket.on('data',chunk=>{
      input+=chunk;let at:number;
      while((at=input.indexOf('\r\n'))>=0){const line=input.slice(0,at);input=input.slice(at+2);
        if(data){if(line==='.'){messages.push(body);body='';data=false;socket.write('250 queued-test\r\n');}else body+=line+'\r\n';continue;}
        const verb=line.split(' ')[0].toUpperCase();
        if(verb==='EHLO'||verb==='HELO')socket.write('250-local.test\r\n250 AUTH PLAIN\r\n');
        else if(verb==='AUTH')socket.write(mode==='auth'?'535 authentication rejected\r\n':'235 authenticated\r\n');
        else if(verb==='MAIL')socket.write('250 sender accepted\r\n');
        else if(verb==='RCPT')socket.write(mode==='reject'?'550 recipient rejected\r\n':'250 recipient accepted\r\n');
        else if(verb==='DATA'){data=true;socket.write('354 end with dot\r\n');}
        else if(verb==='QUIT'){socket.end('221 bye\r\n');}
        else socket.write('250 ok\r\n');
      }
    });
  });server.listen(0,'127.0.0.1');await once(server,'listening');
  process.env.SMTP_HOST='127.0.0.1';process.env.SMTP_PORT=String((server.address() as net.AddressInfo).port);process.env.SMTP_SECURE='false';process.env.SMTP_USER='sender@test.invalid';process.env.SMTP_PASS='fake-local-test-password';
  const {sendEmail}=await import('../src/lib/email');
  try{
    const sent=await sendEmail({to:'recipient@test.invalid',subject:'Local compatibility test',html:'<p>Only the local SMTP stub receives this message.</p>'});assert.equal(sent.sent,true);assert.equal(messages.length,1);assert.match(messages[0],/Local compatibility test/);
    mode='reject';assert.equal((await sendEmail({to:'recipient@test.invalid',subject:'Rejected test',html:'Local'})).sent,false);assert.equal(messages.length,1);
    mode='auth';const rejected=await sendEmail({to:'recipient@test.invalid',subject:'Auth test',html:'Local'});assert.equal(rejected.sent,false);assert.match(rejected.reason||'',/authentication/);
    process.env.SMTP_USER='';assert.equal((await sendEmail({to:'recipient@test.invalid',subject:'No SMTP',html:'Local'})).sent,false);assert.equal(messages.length,1);
  }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));delete process.env.SMTP_PASS;delete process.env.SMTP_USER;}
});

test('updated Zod preserves record values and returns actionable onboarding validation errors through actual HTTP middleware',async()=>{
  assert.equal(createInviteSchema.parse({name:'Test Candidate',email:'admin@readyhr.local'}).role,'CANDIDATE');
  const values={employee:'Test Employee',address:'Test Address'};
  assert.deepEqual(createContractSchema.parse({candidateId:'3f2814f0-a042-4ac7-a970-b8a4b14c7668',title:'Test',templateContent:'{{employee}}',fieldValues:values}).fieldValues,values);
  const app=express();app.use(express.json());app.post('/profile',validate(onboardingProfileSchema),(_req,res)=>{res.json({success:true});});const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try{const response=await fetch(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}/profile`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({emergencyContactRelation:'Unknown'})});assert.equal(response.status,400);const result:any=await response.json();assert.ok(result.errors.some((e:any)=>e.field==='firstName'));assert.match(result.errors.find((e:any)=>e.field==='emergencyContactRelation').message,/Father, Mother, or Other/);}finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
