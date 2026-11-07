// Test the supplied runtime artifact, not a freshly compiled replacement.
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const solc = require('solc');
const { spawn } = require('child_process');
const { ethers } = require('ethers');
const root = path.resolve(__dirname, '..');
const artifactPath=path.join(root,'contracts/legacy_governor.hex');
const runtime=fs.readFileSync(artifactPath,'utf8').trim();
if (!/^0x(?:[a-fA-F0-9]{2})+$/.test(runtime)) throw Error('Invalid supplied EVM runtime artifact');
const artifactSha256=crypto.createHash('sha256').update(Buffer.from(runtime.slice(2),'hex')).digest('hex');
const source='contracts/RecoveredGovernor.sol';
const input={language:'Solidity',sources:{[source]:{content:fs.readFileSync(path.join(root,source),'utf8')}},settings:{optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}};
const compiled=JSON.parse(solc.compile(JSON.stringify(input)));
const errors=(compiled.errors||[]).filter(e=>e.severity==='error');
if (errors.length) throw Error(errors.map(e=>e.formattedMessage).join('\n'));
const recovered=compiled.contracts[source].RecoveredGovernor;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const proc=spawn(path.join(root,'node_modules/node/bin/node'), [path.join(root,'node_modules/@foundry-rs/anvil/bin.mjs'),'--host','127.0.0.1','--port',String(port),'--silent'],{stdio:'ignore'});
  try {
    await delay(300);
    if (proc.exitCode!==null) throw Error('Local Anvil exited before startup');
    const provider=new ethers.JsonRpcProvider(`http://127.0.0.1:${port}`,undefined,{staticNetwork:true});
    let ready=false;
    for (let i=0;i<60;i++) {if(proc.exitCode!==null) throw Error('Local Anvil exited during startup');try{await provider.send('eth_chainId',[]);ready=true;break;}catch{await delay(100)}}
    if(!ready) throw Error('Local Anvil did not start');
    const signer=await provider.getSigner(0);
    const legacyAddress='0x000000000000000000000000000000000000beef';
    await provider.send('anvil_setCode',[legacyAddress,runtime]);
    const a=new ethers.Contract(legacyAddress,recovered.abi,signer);
    const b=await new ethers.ContractFactory(recovered.abi,recovered.evm.bytecode.object,signer).deploy();await b.waitForDeployment();
    let state=2026;const rand=()=>{state=(state*1664525+1013904223)>>>0;return state;};
    const samples=[[0,0,0,71999],[0,0,0,72000],[0,0,0,87999],[0,0,0,88000],[45000,0,0,20000],[45001,0,0,20000]];
    for(let i=0;i<256;i++) samples.push([(rand()%180001)-90000,(rand()%180001)-90000,(rand()%500001)-250000,rand()%130001]);
    for(const args of samples){
      const [x,y]=await Promise.all([a.step(...args),b.step(...args)]);
      if(x[0]!==y[0]||x[1]!==y[1]||x[2]!==y[2]) throw Error(`EVM mismatch for ${args}`);
    }
    const calldata=a.interface.encodeFunctionData('step',[0,0,0,88000]);
    const trace=await provider.send('debug_traceCall',[{to:legacyAddress,data:calldata},'latest',{disableMemory:true,disableStack:true,disableStorage:true}]);
    fs.mkdirSync(path.join(root,'build'),{recursive:true});
    fs.writeFileSync(path.join(root,'build/evm_trace.json'),JSON.stringify(trace));
    console.log(JSON.stringify({network:'local Anvil',artifact_sha256:artifactSha256,tested:samples.length,passed:samples.length,trace_steps:(trace.structLogs||[]).length,legacy:legacyAddress,recovered:await b.getAddress()}));
    provider.destroy();
  } finally {proc.kill('SIGTERM');}
})().catch(err=>{console.error(err.message);process.exitCode=1;});
