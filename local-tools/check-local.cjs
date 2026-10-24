const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const root=__dirname;
const frontendTests=fs.readdirSync(path.join(root,'frontend','tests')).filter(name=>name.endsWith('.test.cjs')).map(name=>path.join('tests',name));
const checks=[
 ['Frontend type check','frontend',['node_modules/typescript/bin/tsc','--noEmit']],
 ['Backend type check','backend',['node_modules/typescript/bin/tsc','--noEmit']],
 ['Frontend forms and navigation','frontend',['--test',...frontendTests]],
 ...[['Whole HR system','system.integration.ts'],['Attendance calculations','attendance.calculation.integration.ts'],['Original leave rules','leave.rules.integration.ts'],['Performance workflow','performance.integration.ts'],['HR Assistant','assistant.integration.ts']].map(([name,file])=>[name,'backend',['node_modules/tsx/dist/cli.mjs',path.join('tests',file)]]),
];
async function main(){
 require(path.join(root,'backend','node_modules','dotenv')).config({path:path.join(root,'backend','.env'),quiet:true});
 const database=new URL(process.env.DATABASE_URL||'');
 if(!['localhost','127.0.0.1','[::1]'].includes(database.hostname))throw new Error('This checker is restricted to local MySQL.');
 process.env.SMTP_USER='';process.env.SMTP_PASS='';
 const results=[];
 for(const [name,directory,args] of checks){
  console.log(`\nChecking: ${name}`);
  const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:path.join(root,directory),windowsHide:true,stdio:'inherit'});child.once('error',reject);child.once('exit',code=>resolve(code??1));});
  results.push({name,passed:code===0});
 }
 const report={at:new Date().toISOString(),passed:results.every(result=>result.passed),checks:results};
 const output=path.join(root,'backend','repair-audit');fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'local-verification.json'),JSON.stringify(report,null,2));
 console.log(report.passed?'\nAll local HR checks passed.':'\nSome checks failed. See the messages above.');
 if(!report.passed)process.exitCode=1;
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
