'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {main,releaseAsset,validateResult,unpack}=require('./run');
const version='0.3.6';
const valid={schemaVersion:1,status:'pass',baseline:{flash:1,ram:1},current:{flash:2,ram:2},delta:{flash:1,ram:1},violations:[]};
test('stderr warnings do not override valid outcomes; errors and contradictions fail',()=>{
 for(const status of [0,2]) {
  const report={...valid,status:status===0?'pass':'budget_exceeded',violations:status===0?[]:[{memory:'ram',metric:'growth_bytes',actual:1,limit:0}]};
  assert.equal(validateResult({status,stdout:JSON.stringify(report),stderr:'Warning: ignored extra CA certificate'}).status,report.status);
 }
 for(const result of [{status:1,stdout:JSON.stringify(valid)},{status:2,stdout:JSON.stringify(valid)},{status:0,stdout:'invalid'},{status:0,stdout:JSON.stringify({...valid,schemaVersion:2})},{status:null,error:Error('timeout')}])assert.throws(()=>validateResult(result));
});
test('unknown versions cannot execute; immutable pin selects a direct download URL',()=>{
 assert.throws(()=>releaseAsset('999.999.999',{}),/pinned/);
 for(const v of ['latest','../escape','0.3.6\n'])assert.throws(()=>releaseAsset(v,{}));
 const a=releaseAsset(version,{[version]:{'linux-x64':{sha256:'a'.repeat(64)}}});
 assert.equal(a.browser_download_url,`https://github.com/itainover-create/fw-mem-guard/releases/download/v${version}/${a.name}`);
});
test('offline and online archives share pin validation; warning-only never masks errors',{skip:process.platform!=='linux'||process.arch!=='x64'},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fwmg-action-v2-')),env={...process.env},fetch=global.fetch,log=console.log;
 const annotations=[];console.log=(...args)=>annotations.push(args.join(' '));
 try {
  const root=path.join(dir,`fw-mem-guard-${version}-linux-x64`);fs.mkdirSync(path.join(root,'src'),{recursive:true});
  fs.writeFileSync(path.join(root,'src/cli.js'),`const fs=require('fs');const r=JSON.parse(fs.readFileSync(process.argv[3]));console.error('Warning: optional certificate unavailable');if(r.error){process.exitCode=1}else{console.log(JSON.stringify(r));process.exitCode=r.status==='pass'?0:2}`);
  const archive=path.join(dir,'original.tar.gz');assert.equal(spawnSync('tar',['-czf',archive,'-C',dir,path.basename(root)]).status,0);
  const bytes=fs.readFileSync(archive),registry={[version]:{'linux-x64':{sha256:crypto.createHash('sha256').update(bytes).digest('hex')}}};
  Object.assign(process.env,{GITHUB_WORKSPACE:dir,INPUT_PROJECT:'firmware.fwmg.json',INPUT_VERSION:version,'INPUT_CLI-ARCHIVE':archive,GITHUB_OUTPUT:path.join(dir,'outputs'),'INPUT_FAIL-ON-BUDGET-EXCEEDED':'true'});
  delete process.env.GITHUB_STEP_SUMMARY;
  let requests=0;global.fetch=async()=>{requests++;throw Error('Network forbidden');};
  let index=0;
  async function run(report,expected) {
   process.env.INPUT_REPORT=`report-${index++}.json`;fs.writeFileSync(path.join(dir,'firmware.fwmg.json'),JSON.stringify(report));fs.writeFileSync(process.env.GITHUB_OUTPUT,'');
   assert.equal(await main(registry),expected);
   return fs.readFileSync(process.env.GITHUB_OUTPUT,'utf8');
  }
  assert.match(await run(valid,0),/result=pass/);
  const exceeded={...valid,status:'budget_exceeded',violations:[{memory:'ram',metric:'growth_bytes',actual:1,limit:0}]};
  assert.match(await run(exceeded,2),/result=budget-exceeded/);
  process.env['INPUT_FAIL-ON-BUDGET-EXCEEDED']='false';
  assert.equal(annotations.length,0,'enforced violations must not emit warning-only annotations');
  process.env.GITHUB_STEP_SUMMARY=path.join(dir,'summary');
  assert.match(await run(exceeded,0),/exit-code=2/);
  assert.equal(annotations.length,1);assert.match(annotations[0],/^::warning title=FW Mem Guard::/);
  assert.match(fs.readFileSync(process.env.GITHUB_STEP_SUMMARY,'utf8'),/warning-only mode is enabled/);
  assert.match(await run({error:true},1),/result=error/);
  assert.equal(annotations.length,1,'infrastructure errors must not emit budget warnings');
  assert.equal(fs.existsSync(path.join(dir,process.env.INPUT_REPORT)),false);
  process.env['INPUT_CLI-ARCHIVE']=path.join(dir,'missing');await run(valid,1);
  process.env['INPUT_CLI-ARCHIVE']=archive;fs.appendFileSync(archive,'tampered');await run(valid,1);
  assert.equal(requests,0);
  delete process.env['INPUT_CLI-ARCHIVE'];
  global.fetch=async url=>{requests++;assert.equal(url,releaseAsset(version,registry).browser_download_url);assert.ok(!url.includes('api.github.com'));return new Response(bytes);};
  await run(valid,0);assert.equal(requests,1);
  assert.equal(await main(registry),1,'existing report must not be overwritten');
  assert.equal(requests,1);
  const linkRoot=path.join(dir,'links');fs.mkdirSync(linkRoot);fs.symlinkSync('/tmp',path.join(root,'link'));
  assert.equal(spawnSync('tar',['-czf',archive,'-C',dir,path.basename(root)]).status,0);
  assert.throws(()=>unpack(archive,linkRoot,version),/Unsafe/);
 }finally {console.log=log;global.fetch=fetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);fs.rmSync(dir,{recursive:true,force:true});}
});
