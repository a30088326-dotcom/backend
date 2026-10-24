import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Response } from 'express';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

type S3Sender = Pick<S3Client, 'send'>;
let s3Client: S3Sender | undefined;
function client() { return s3Client ??= new S3Client({ region: process.env.AWS_REGION, maxAttempts: 5 }); }

export function storedUploadKey(filename: string) {
  if (!filename || filename !== path.basename(filename) || /[\\/\x00]/.test(filename) || filename === '.' || filename === '..') {
    throw new Error('Invalid uploaded filename.');
  }
  return `uploads/${filename}`;
}
export function uploadStorageProvider() {
  const provider = process.env.UPLOAD_STORAGE || 'local';
  if (provider !== 'local' && provider !== 's3') throw new Error('Unsupported upload storage provider.');
  if (provider === 's3' && (!process.env.UPLOADS_BUCKET || !process.env.AWS_REGION)) throw new Error('Private upload bucket and AWS region are required.');
  return provider;
}
function safeContentType(filename: string) {
  const extension = path.extname(filename).toLowerCase();
  return ({ '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' } as Record<string,string>)[extension] || 'application/octet-stream';
}
function isMissing(error: any) { return error?.$metadata?.httpStatusCode === 404 || error?.name === 'NoSuchKey' || error?.code === 'ENOENT'; }

/** Complete this before saving the document reference. Failed database writes must delete the new object. */
export async function putStoredUpload(localPath: string, filename: string, _contentType?: string) {
  const Key = storedUploadKey(filename);
  if (uploadStorageProvider() === 's3') {
    await client().send(new PutObjectCommand({ Bucket: process.env.UPLOADS_BUCKET!, Key,
      Body: createReadStream(localPath), ContentType: safeContentType(filename), ServerSideEncryption: 'AES256' }));
    return;
  }
  const root = path.resolve('uploads');
  await mkdir(root, { recursive: true });
  const target = path.join(root, filename);
  if (path.resolve(localPath) !== target) await copyFile(localPath, target);
}

/** Call only after the existing owner/module authorization guard has allowed access. */
export async function streamStoredUpload(filename: string, response: Response) {
  const Key = storedUploadKey(filename);
  const headers = () => {
    response.setHeader('Content-Type', safeContentType(filename));
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    if (safeContentType(filename) === 'application/octet-stream') response.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(filename));
  };
  if (uploadStorageProvider() === 's3') {
    let object;
    try { object = await client().send(new GetObjectCommand({ Bucket: process.env.UPLOADS_BUCKET!, Key })); }
    catch(error) { if(isMissing(error)) return false; throw error; }
    if (!object.Body) return false;
    headers();
    if (object.ContentLength !== undefined) response.setHeader('Content-Length', object.ContentLength);
    await pipeline(object.Body as any, response);
    return true;
  }
  let root: string, target: string;
  try { root = await realpath(path.resolve('uploads')); target = await realpath(path.join(root, filename)); }
  catch(error) { if(isMissing(error)) return false; throw error; }
  if (path.dirname(target) !== root) return false;
  headers();
  await pipeline(createReadStream(target), response);
  return true;
}

export async function deleteStoredUpload(filename: string) {
  const Key = storedUploadKey(filename);
  if (uploadStorageProvider() === 's3') { await client().send(new DeleteObjectCommand({ Bucket: process.env.UPLOADS_BUCKET!, Key })); return; }
  const root = await realpath(path.resolve('uploads'));
  let target: string;
  try { target = await realpath(path.join(root, filename)); } catch(error) { if(isMissing(error)) return; throw error; }
  if (path.dirname(target) !== root) throw new Error('Uploaded file is outside storage.');
  await unlink(target);
}

/** Migration verification checks bytes without making uploaded files public. */
export async function headStoredUpload(filename: string) {
  storedUploadKey(filename);
  if (uploadStorageProvider() !== 's3') throw new Error('S3 verification requires UPLOAD_STORAGE=s3.');
  return client().send(new HeadObjectCommand({ Bucket: process.env.UPLOADS_BUCKET!, Key: storedUploadKey(filename) }));
}

/** Use a unique temporary path; the caller still owns cleanup after persistence succeeds. */
export async function downloadStoredUpload(filename: string, target: string) {
  const object = await client().send(new GetObjectCommand({ Bucket: process.env.UPLOADS_BUCKET!, Key: storedUploadKey(filename) }));
  if (!object.Body) throw new Error('Stored file has no content.');
  await pipeline(object.Body as any, createWriteStream(target, { flags: 'wx' }));
}
