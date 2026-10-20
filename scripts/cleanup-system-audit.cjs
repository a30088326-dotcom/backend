/** Remove explicitly named disposable copies only, never the configured HR database. */
require('dotenv').config({quiet:true});
const mysql=require('mysql2/promise'),fs=require('node:fs'),path=require('node:path');
async function main(){
 const source=new URL(process.env.DATABASE_URL),names=process.argv.slice(2).filter(v=>v!=='--apply');
 const c=await mysql.createConnection(process.env.DATABASE_URL),uploadRoot=path.resolve('uploads');
 const report=[];
 try {
  for(const name of names){
   if(!/^hr_system_audit_[a-f0-9]{32}$/.test(name)||name===source.pathname.slice(1))throw new Error('Refusing unsafe audit database target.');
   const [users]=await c.query('SELECT id,email FROM ??.users WHERE email IN (?,?,?,?)',[name,'audit-admin@example.test','audit-manager@example.test','audit-employee@example.test','audit-outsider@example.test']);
   if(users.length!==4)throw new Error('This database is not a recognized synthetic system audit copy.');
   const employeeUser=users.find(u=>u.email==='audit-employee@example.test');
   const [docs]=await c.query('SELECT fileName,fileUrl FROM ??.documents WHERE candidateId=?',[name,employeeUser.id]);
   const [attachments]=await c.query('SELECT a.fileName,a.fileUrl FROM ??.employee_information_employee_attachments a JOIN ??.employee_information_employees e ON e.id=a.employeeId WHERE e.userId=?',[name,name,employeeUser.id]);
   const prefixes=new Set([...docs,...attachments].map(v=>String(v.fileName).match(/^audit-[a-f0-9-]{36}-/)?.[0]).filter(Boolean));
   const files=fs.readdirSync(uploadRoot).filter(file=>[...prefixes].some(prefix=>file.includes(prefix)));
   for(const file of files){const resolved=path.resolve(uploadRoot,file);if(path.dirname(resolved)!==uploadRoot)throw new Error('Unsafe upload cleanup path.');}
   report.push({database:name,syntheticFiles:files.length,apply:process.argv.includes('--apply')});
   if(process.argv.includes('--apply')){
    await c.query('DROP DATABASE ??',[name]);
    for(const file of files)fs.unlinkSync(path.resolve(uploadRoot,file));
   }
  }
  console.log(JSON.stringify(report,null,2));
 }finally{await c.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
