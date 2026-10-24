import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Readable, Writable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import { storedUploadKey, uploadStorageProvider, putStoredUpload, streamStoredUpload, deleteStoredUpload } from '../src/storage/upload-storage';

test('private S3 upload storage persists bytes and does not expose unsafe files',async t=>{
  const original = S3Client.prototype.send;
  const old = Object.fromEntries(['UPLOAD_STORAGE','UPLOADS_BUCKET','AWS_REGION'].map(name=>[name,process.env[name]]));
  const folder = await mkdtemp(path.join(os.tmpdir(),'peoples-upload-storage-'));
  const commands:any[]=[];
  let missing=false;
  (S3Client.prototype as any).send=async(command:any)=>{
    commands.push(command);
    if(command.constructor.name==='PutObjectCommand') {
      const chunks=[]; for await(const chunk of command.input.Body) chunks.push(Buffer.from(chunk));
      assert.equal(Buffer.concat(chunks).toString(),'private test bytes'); return {};
    }
    if(command.constructor.name==='GetObjectCommand') {
      if(missing)throw Object.assign(new Error('Missing'),{name:'NoSuchKey',$metadata:{httpStatusCode:404}});
      return {Body:Readable.from(Buffer.from('private test bytes')),ContentLength:18};
    }
    return {};
  };
  process.env.UPLOAD_STORAGE='s3'; process.env.UPLOADS_BUCKET='test-private-bucket'; process.env.AWS_REGION='ap-southeast-2';
  try {
    await t.test('rejects traversal and unsupported provider before network access',()=>{
      for(const value of ['../a.pdf','a/b.pdf','a\\b.pdf','.','..',''])assert.throws(()=>storedUploadKey(value));
      assert.equal(storedUploadKey('safe-file.pdf'),'uploads/safe-file.pdf');
      process.env.UPLOAD_STORAGE='unknown';assert.throws(uploadStorageProvider);process.env.UPLOAD_STORAGE='s3';
    });
    await t.test('sends upload to exact private bucket/key with server-side encryption',async()=>{
      const source=path.join(folder,'source');await writeFile(source,'private test bytes');
      await putStoredUpload(source,'safe-file.pdf','application/pdf');
      assert.deepEqual({bucket:commands.at(-1).input.Bucket,key:commands.at(-1).input.Key,type:commands.at(-1).input.ContentType,encryption:commands.at(-1).input.ServerSideEncryption},
        {bucket:'test-private-bucket',key:'uploads/safe-file.pdf',type:'application/pdf',encryption:'AES256'});
      assert.equal(commands.at(-1).input.ACL,undefined);
    });
    await t.test('HTML and other unsafe extensions are downloaded as binary even if client declares PDF',async()=>{
      await putStoredUpload(path.join(folder,'source'),'unsafe.html','application/pdf');
      assert.equal(commands.at(-1).input.ContentType,'application/octet-stream');
    });
    await t.test('authorized route streams bytes with private browser caching and sandbox headers',async()=>{
      const headers:Record<string,unknown>={};const chunks:Buffer[]=[];
      const response=new Writable({write(chunk,_encoding,callback){chunks.push(Buffer.from(chunk));callback();}}) as any;
      response.setHeader=(key:string,value:unknown)=>{headers[key]=value;};
      assert.equal(await streamStoredUpload('safe-file.pdf',response),true);
      assert.equal(Buffer.concat(chunks).toString(),'private test bytes');
      assert.equal(headers['Cache-Control'],'private, no-store');assert.equal(headers['X-Content-Type-Options'],'nosniff');
      assert.match(String(headers['Content-Security-Policy']),/sandbox/);
    });
    await t.test('missing objects return false without starting response',async()=>{
      missing=true;let headers=0;
      assert.equal(await streamStoredUpload('missing.pdf',{setHeader(){headers++;}} as any),false);
      assert.equal(headers,0);missing=false;
    });
    await t.test('deletion is restricted to this bucket and uploads prefix',async()=>{
      await deleteStoredUpload('safe-file.pdf');assert.equal(commands.at(-1).constructor.name,'DeleteObjectCommand');
      assert.deepEqual(commands.at(-1).input,{Bucket:'test-private-bucket',Key:'uploads/safe-file.pdf'});
    });
  }finally {
    S3Client.prototype.send=original;
    for(const [name,value]of Object.entries(old)){if(value===undefined)delete process.env[name];else process.env[name]=value;}
    await rm(folder,{recursive:true,force:true});
  }
});
