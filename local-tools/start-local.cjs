const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = __dirname;
const logs = path.join(root, 'backend', 'backups', 'local-setup');

function latestFrontendChange(directory) {
  return fs.readdirSync(directory,{withFileTypes:true}).reduce((latest,entry)=>{
    const file=path.join(directory,entry.name);
    return Math.max(latest,entry.isDirectory()?latestFrontendChange(file):fs.statSync(file).mtimeMs);
  },0);
}

async function buildFrontend() {
  const frontend=path.join(root,'frontend');
  const index=path.join(frontend,'dist','index.html');
  const inputs=['package.json','vite.config.ts','.env','.env.local','.env.production','.env.production.local'];
  const changed=Math.max(latestFrontendChange(path.join(frontend,'src')),...inputs.filter(file=>fs.existsSync(path.join(frontend,file))).map(file=>fs.statSync(path.join(frontend,file)).mtimeMs));
  if(fs.existsSync(index)&&fs.statSync(index).mtimeMs>=changed)return;
  console.log('Preparing the updated local app…');
  const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','build'],{cwd:frontend,windowsHide:true,stdio:'inherit'});
  await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('Frontend build failed. Check the build output.')));});
}

async function responseAt(url) {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(1500) });
  } catch {
    return null;
  }
}

async function start(name, directory, args, url, verify) {
  const existing = await responseAt(url);
  if (existing) {
    if (!existing.ok || !await verify(existing)) {
      throw new Error(`Another service is using ${url}. Close it before starting HR.`);
    }
    console.log(`${name} is already running.`);
    return;
  }

  const out = fs.openSync(path.join(logs, `${name}.out.log`), 'a');
  const err = fs.openSync(path.join(logs, `${name}.err.log`), 'a');
  try {
    const child = spawn(process.execPath, args, {
      cwd: path.join(root, directory),
      detached: true,
      windowsHide: true,
      stdio: ['ignore', out, err],
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
  } finally {
    fs.closeSync(out);
    fs.closeSync(err);
  }

  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await responseAt(url);
    if (response?.ok && await verify(response)) {
      console.log(`${name} started.`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`${name} did not start. Check the logs in ${logs}.`);
}

async function main() {
  if (!fs.existsSync(path.join(root, 'backend', '.env'))) {
    throw new Error('Configure backend/.env with the local MySQL connection first.');
  }
  fs.mkdirSync(logs, { recursive: true });
  await buildFrontend();
  await start('backend', 'backend', ['node_modules/tsx/dist/cli.mjs', 'src/server.ts'],
    'http://127.0.0.1:3001/health', async response => (await response.json()).service === 'HR API');
  await start('frontend', 'frontend', ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5174', '--strictPort'],
    'http://127.0.0.1:5174/', async response => (await response.text()).includes('Peoples Management'));
  console.log('Open http://localhost:5174');
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
