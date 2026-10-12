'use strict';
// Public orchestration only. All memory accounting stays in the compiled CLI.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const repository = 'itainover-create/fw-mem-guard';
const maxDownload = 128 * 1024 * 1024;

const releases = require('./releases.json');
function releaseAsset(version, registry = releases) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Use an exact numeric CLI version.');
  const entry = registry[version]?.['linux-x64'];
  if (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('CLI version has no reviewed, pinned SHA-256.');
  const name = `fw-mem-guard-${version}-linux-x64.tar.gz`;
  return {name, sha256:entry.sha256, browser_download_url:`https://github.com/${repository}/releases/download/v${version}/${name}`};
}
function verifyArchive(file, asset) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size <= 0 || stat.size > maxDownload) throw new Error('Invalid CLI archive size.');
  const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (digest !== asset.sha256) throw new Error('CLI archive SHA-256 verification failed.');
}
async function request(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(60000), headers: {'User-Agent':'FW-Mem-Guard-Action', Accept:'application/octet-stream'}});
  if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}). Check that the public CLI release is available.`);
  return response;
}
async function download(asset, destination) {
  const response = await request(asset.browser_download_url);
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(destination, 'wx', 0o600);
  let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxDownload) throw new Error('Download exceeds declared size.');
      hash.update(chunk); fs.writeFileSync(fd, chunk);
    }
  } finally { fs.closeSync(fd); }
  if (size === 0 || hash.digest('hex') !== asset.sha256) throw new Error('CLI download SHA-256/size verification failed.');
}
function unpack(archive, directory, version) {
  const root = `fw-mem-guard-${version}-linux-x64`;
  const listing = spawnSync('tar', ['-tzf', archive], {encoding:'utf8', maxBuffer:4*1024*1024, timeout:30000});
  const types = spawnSync('tar', ['-tvzf', archive], {encoding:'utf8', maxBuffer:4*1024*1024, timeout:30000});
  if (listing.status !== 0 || types.status !== 0) throw new Error('Cannot inspect CLI archive.');
  const names = listing.stdout.trim().split('\n');
  if (names.some(n => n !== root && n !== root+'/' && !n.startsWith(root+'/')) || names.some(n => n.split('/').includes('..') || n.includes('\\')) || types.stdout.trim().split('\n').some(n => !['-','d'].includes(n[0]))) throw new Error('Unsafe CLI archive entries.');
  const result = spawnSync('tar', ['--extract','--gzip','--file',archive,'--directory',directory,'--no-same-owner','--no-same-permissions'], {encoding:'utf8', timeout:30000});
  if (result.status !== 0) throw new Error('Cannot extract CLI archive.');
  return path.join(directory, root);
}
function validateResult(result) {
  if (result.error || ![0,2].includes(result.status)) throw new Error('CLI failed before producing a valid comparison. '+(result.stderr || result.error?.message || '').trim());
  let report;
  try {report = JSON.parse(result.stdout);} catch {throw new Error('CLI did not return JSON.');}
  if (report.schemaVersion !== 1 || report.status !== (result.status === 0 ? 'pass' : 'budget_exceeded')) throw new Error('Unsupported CLI schema or inconsistent result.');
  for (const memory of ['flash','ram']) {
    for (const key of ['baseline','current','delta']) if (!Number.isSafeInteger(report[key]?.[memory])) throw new Error('Invalid CLI totals.');
    if (report.baseline[memory] < 0 || report.current[memory] < 0 || report.current[memory]-report.baseline[memory] !== report.delta[memory]) throw new Error('Inconsistent CLI totals.');
  }
  if (!Array.isArray(report.violations) || (result.status === 0) !== (report.violations.length === 0)) throw new Error('Inconsistent CLI violations.');
  return report;
}
function workspaceFile(workspace, relative) {
  if (!relative || path.isAbsolute(relative) || /[\r\n\0]/.test(relative)) throw new Error('Use a relative workspace path.');
  const file = path.resolve(workspace, relative);
  if (!file.startsWith(workspace+path.sep)) throw new Error('Path must stay inside the workspace.');
  return file;
}
function summary(report) {
  return `## FW Mem Guard: ${report.status.toUpperCase()}\n\n| Memory | Baseline | Current | Change |\n|---|---:|---:|---:|\n` + ['flash','ram'].map(k=>`| ${k.toUpperCase()} | ${report.baseline[k]} B | ${report.current[k]} B | ${report.delta[k]} B |`).join('\n') + '\n\nFull JSON is stored on the runner. It can contain object paths; upload it only if you intend to share those paths.\n';
}
function output(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}
async function main(registry = releases) {
  let temporary;
  try {
    if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Unsupported host: use a Linux x64 runner (glibc 2.28+).');
    const workspace = fs.realpathSync(process.env.GITHUB_WORKSPACE || process.cwd());
    const project = workspaceFile(workspace, process.env.INPUT_PROJECT || 'firmware.fwmg.json');
    const reportPath = workspaceFile(workspace, process.env.INPUT_REPORT || 'fwmg-result.json');
    if (!fs.statSync(project).isFile() || !project.endsWith('.fwmg.json')) throw new Error('Project must be an existing .fwmg.json file.');
    if (fs.existsSync(reportPath)) throw new Error('Report path already exists; choose a new report filename.');
    const parent = fs.realpathSync(path.dirname(reportPath));
    if (parent !== workspace && !parent.startsWith(workspace+path.sep)) throw new Error('Report parent resolves outside the workspace.');
    const version = process.env.INPUT_VERSION || '0.3.7';
    const failOnBudget = process.env['INPUT_FAIL-ON-BUDGET-EXCEEDED'] || 'true';
    if (!['true','false'].includes(failOnBudget)) throw new Error('fail-on-budget-exceeded must be true or false.');
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Use an exact numeric CLI release version.');
    const asset = releaseAsset(version, registry);
    temporary = fs.mkdtempSync(path.join(os.tmpdir(),'fwmg-action-'));
    const archive = path.join(temporary,'cli.tar.gz');
    const local = process.env['INPUT_CLI-ARCHIVE'];
    if (local) {
      if (/[\r\n\0]/.test(local)) throw new Error('Invalid CLI archive path.');
      const source = path.resolve(workspace, local);
      if (!fs.statSync(source).isFile() || fs.statSync(source).size > maxDownload) throw new Error('Invalid CLI archive.');
      fs.copyFileSync(source, archive, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(archive, 0o600);
      verifyArchive(archive, asset);
    } else {
      await download(asset, archive);
    }
    const cli = unpack(archive, temporary, version);
    // Use the Action's Node runtime; no setup-node or global Node install required.
    const result = spawnSync(process.execPath, [path.join(cli,'src/cli.js'),'compare',project,'--json'], {encoding:'utf8', timeout:120000, maxBuffer:4*1024*1024, cwd:workspace});
    const report = validateResult(result);
    if (result.stderr?.trim()) process.stderr.write(result.stderr);
    fs.writeFileSync(reportPath, JSON.stringify(report,null,2)+'\n', {flag:'wx', mode:0o600});
    output('report-path',reportPath);output('exit-code',result.status);
    output('result',result.status === 0 ? 'pass' : 'budget-exceeded');
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(report));
    if (result.status === 2) {
      console.error('FW Mem Guard: configured memory budget exceeded (exit 2).');
      if (failOnBudget === 'false') {
        console.log('::warning title=FW Mem Guard::Configured memory budget exceeded; warning-only mode is enabled (CLI exit 2).');
        if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n**Warning:** memory budget exceeded. This step passed because warning-only mode is enabled; CLI exit code remains 2.\n');
      }
    }
    return result.status === 2 && failOnBudget === 'false' ? 0 : result.status;
  } catch(error) {
    output('exit-code',1);output('result','error');
    console.error('FW Mem Guard: '+error.message);
    return 1;
  } finally {if (temporary) fs.rmSync(temporary,{recursive:true,force:true});}
}
if (require.main === module) main().then(code=>{process.exitCode=code;});
module.exports = {releaseAsset, verifyArchive, download, unpack, validateResult, workspaceFile, summary, main};
