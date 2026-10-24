import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../src/lib/db';
import { portableFileUrl } from '../src/modules/onboarding/files.routes';
import { attendanceDateTime, attendanceTimestamp, saveAttendance } from '../src/modules/attendance/calculation.service';
import type { RowDataPacket } from 'mysql2/promise';

async function main(){
 const source=new URL(process.env.DATABASE_URL!);
 if(!['localhost','127.0.0.1'].includes(source.hostname))throw new Error('This repair is restricted to local MySQL.');
 const apply=process.argv.includes('--apply'),connection=await db.getConnection();
 const directory=resolve('backups','local-repair-'+new Date().toISOString().replace(/[:.]/g,'-'));
 try{
  await connection.beginTransaction();
  const [documents]=await connection.query<RowDataPacket[]>('SELECT id,fileUrl FROM documents FOR UPDATE');
  const [attachments]=await connection.query<RowDataPacket[]>('SELECT id,fileUrl FROM employee_information_employee_attachments FOR UPDATE');
  const [attendance]=await connection.query<RowDataPacket[]>('SELECT * FROM attendance_records FOR UPDATE');
  mkdirSync(directory,{recursive:true});
  writeFileSync(resolve(directory,'before.json'),JSON.stringify({documents,attachments,attendance},null,2));
  const changes={documentUrls:0,attachmentUrls:0,attendanceRecords:0,applied:apply,backup:directory};
  for(const [table,rows,key] of [['documents',documents,'documentUrls'],['employee_information_employee_attachments',attachments,'attachmentUrls']] as const){
   for(const row of rows){const url=portableFileUrl(row.fileUrl);if(url!==row.fileUrl){await connection.query('UPDATE ?? SET fileUrl=? WHERE id=?',[table,url,row.id]);changes[key]++;}}
  }
  for(const row of attendance){
   if(!row.inTime||!row.outTime)continue;
   const date=String(row.date).slice(0,10);
   const [logs]=await connection.query<RowDataPacket[]>('SELECT timestamp,logType FROM attendance_raw_logs WHERE employeeId=? AND timestamp>=? AND timestamp<=? ORDER BY timestamp,id',[row.employeeId,attendanceDateTime(new Date(attendanceTimestamp(row.inTime))),attendanceDateTime(new Date(attendanceTimestamp(row.outTime)))]);
   const result=await saveAttendance(connection,row.id,row.employeeId,date,row.inTime,row.outTime,{savedShiftId:row.shiftId,logs:row.isException?undefined:logs as any,status:row.status,isException:row.isException});
   if(Object.entries(result).some(([key,value])=>String(row[key]??'')!==String(value??'')))changes.attendanceRecords++;
  }
  if(apply)await connection.commit();else await connection.rollback();
  const report=resolve('repair-audit','local-files-attendance-repair.json');mkdirSync(resolve('repair-audit'),{recursive:true});writeFileSync(report,JSON.stringify(changes,null,2));console.log(JSON.stringify(changes,null,2));
 }catch(error){await connection.rollback();throw error;}finally{connection.release();await db.end();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
