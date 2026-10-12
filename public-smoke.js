'use strict';
// Workflow-only real-public-download acceptance. The runner supplies the pinned sample.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const action=require('./run');
async function run(){
 const version=process.argv[2],fixture=path.resolve(process.argv[3]),asset=action.releaseAsset(version);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fwmg-public-')),previous={...process.env};
 try{
  const archive=path.join(dir,asset.name);await action.download(asset,archive);action.verifyArchive(archive,asset);
  const unpack=path.join(dir,'cli');fs.mkdirSync(unpack);action.unpack(archive,unpack,version);
  const cli=path.join(unpack,`fw-mem-guard-${version}-linux-x64`,'src/cli.js');
  const inputs=Object.fromEntries(['baseline','current'].flatMap(p=>['Map','Elf'].map(e=>[p+e,path.join(fixture,p,'firmware.'+e.toLowerCase())])));
  const profile=JSON.parse(fs.readFileSync(path.join(fixture,'verification/generated-profile.json')));
  for(const [n,v]of Object.entries({inputs,regions:profile.regions,budgets:profile.budgets}))fs.writeFileSync(path.join(dir,n+'.json'),JSON.stringify(v));
  const project=path.join(dir,'firmware.fwmg.json');
  const init=spawnSync(process.execPath,[cli,'init',project,'--inputs',path.join(dir,'inputs.json'),'--regions',path.join(dir,'regions.json'),'--budgets',path.join(dir,'budgets.json')],{encoding:'utf8'});
  assert.equal(init.status,0,init.stderr);
  Object.assign(process.env,{GITHUB_WORKSPACE:dir,INPUT_PROJECT:'firmware.fwmg.json',INPUT_VERSION:version,'INPUT_CLI-ARCHIVE':archive});
  const saved=JSON.parse(fs.readFileSync(project));
  for(const [i,limit,warn,expected,result]of [[0,4096,false,0,'pass'],[1,4095,false,2,'budget-exceeded'],[2,4095,true,0,'budget-exceeded'],[3,4096,false,0,'pass']]){
   saved.budgets.ram.max_growth_bytes=limit;fs.writeFileSync(project,JSON.stringify(saved));
   process.env['INPUT_FAIL-ON-BUDGET-EXCEEDED']=warn?'false':'true';process.env.INPUT_REPORT=`result-${i}.json`;
   process.env.GITHUB_OUTPUT=path.join(dir,`output-${i}`);
   assert.equal(await action.main(),expected);
   assert.match(fs.readFileSync(process.env.GITHUB_OUTPUT,'utf8'),new RegExp(`result=${result}(?:\\r?\\n|$)`));
   const report=JSON.parse(fs.readFileSync(path.join(dir,process.env.INPUT_REPORT)));assert.deepEqual(report.delta,{flash:8240,ram:4096});
  }
  saved.baselineHashes.map='0'.repeat(64);fs.writeFileSync(project,JSON.stringify(saved));process.env.INPUT_REPORT='error.json';process.env.GITHUB_OUTPUT=path.join(dir,'error-output');
  assert.equal(await action.main(),1);assert.match(fs.readFileSync(process.env.GITHUB_OUTPUT,'utf8'),/result=error/);
  console.log(`Public CLI ${version} SHA-256 ${asset.sha256}: real sample PASS, budget exit 2, warning-only, restored PASS and error verified.`);
 }finally{
  for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);fs.rmSync(dir,{recursive:true,force:true});
 }
}
run().catch(e=>{console.error(e);process.exitCode=1;});
