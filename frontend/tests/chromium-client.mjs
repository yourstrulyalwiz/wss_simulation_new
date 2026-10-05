// Small dependency-free CDP client for isolated browser regressions.
import { spawn } from 'node:child_process';
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function openChromium(url) {
  const browser = spawn(process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium',
    ['--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe'],
    {stdio:['ignore','ignore','ignore','pipe','pipe']});
  let sequence=0, buffer='';
  const pending=new Map(), errors=[];
  browser.stdio[4].on('data',chunk=>{
    buffer+=chunk.toString();
    let end;
    while((end=buffer.indexOf('\0'))>=0) {
      const message=JSON.parse(buffer.slice(0,end)); buffer=buffer.slice(end+1);
      if(message.method==='Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
      if(message.id && pending.has(message.id)) {
        const p=pending.get(message.id); pending.delete(message.id); clearTimeout(p.timer);
        message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result);
      }
    }
  });
  function send(method,params={},sessionId) {
    const id=++sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Timed out: ${method}`));},20000);
      pending.set(id,{resolve,reject,timer});
      browser.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');
    });
  }
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  const call=(method,params={})=>send(method,params,sessionId);
  await call('Runtime.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1600,height:1100,deviceScaleFactor:1,mobile:false});
  const evaluate=async expression=>{
    const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const waitFor=async(expression,message)=>{
    for(let i=0;i<100;i++) { if(await evaluate(expression)) return; await sleep(150); }
    throw new Error(message);
  };
  await call('Page.navigate',{url});
  return {call,evaluate,waitFor,errors,close(){
    browser.kill();for(const p of pending.values())clearTimeout(p.timer);
  }};
}
