// Real editor components with isolated browser-side API fixtures. No simulation
// mutation reaches the server; this script must never edit a user's project.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { openChromium, sleep } from '../../tests/chromium-client.mjs';
const url = process.env.APP_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const cards = await (await fetch(`${url}/api/simulations?collection=examples`)).json();
const source = await (await fetch(`${url}/api/simulations/${cards.items[0].id}`)).json();
assert.ok(source.is_seed && source.read_only && !source.is_owner);
const fixture = { ...source, is_seed: false, is_owner: true, read_only: false, revision: 1, name: 'Isolated save recovery fixture',
  location: {}, scenarios: [] };
const b = await openChromium('about:blank'), { evaluate: e, waitFor: wait } = b;
const tab = async text => {
  await e(`[...document.querySelectorAll('.wb-tab')].find(n=>n.textContent.replace(/\\s/g,'').includes(${JSON.stringify(text.replace(/\s/g, ''))})).click()`);
  await sleep(150);
};
try {
  await b.call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__fixture = ${JSON.stringify(fixture)};
    window.__identity = {id:'replit:browser-recovery-test',email:'',is_admin:false};
    window.__mode='ok'; window.__patches=0; window.__writes=0; window.__auth='authenticated';
    window.__activity=0; window.__storageFail=false;
    const setItem=Storage.prototype.setItem;
    Storage.prototype.setItem=function(k,v){if(window.__storageFail) throw new Error('test quota');return setItem.call(this,k,v)};
    const originalFetch=window.fetch.bind(window);
    const response=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});
    window.fetch=async(input,options={})=>{
      const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;
      const method=(options.method||'GET').toUpperCase();
      if(path==='/api/access-mode') return response({public_read_only:false,auth_provider:'replit'});
      if(path==='/api/session'||path==='/api/session/activity'){
        if(method==='POST')window.__activity++;
        return response({status:window.__auth,user:window.__auth==='authenticated'?window.__identity:null,
          serverTime:Date.now(),idleExpiresAt:Date.now()+7200000,absoluteExpiresAt:Date.now()+43200000});
      }
      if(path==='/api/simulations/${fixture.id}'&&method==='GET')return response(window.__fixture);
      if(path.startsWith('/api/simulations')&&method!=='GET'){
        if(method!=='PATCH')throw new Error('Explicit mutations forbidden in test');
        window.__patches++;
        if(window.__mode==='auth'){window.__auth='reauthentication_required';return response({detail:'Session expired'},401);}
        if(window.__mode==='network'){window.__mode='ok';throw new TypeError('test network interruption');}
        if(window.__mode==='rate'){window.__mode='ok';return response({detail:'Rate limited'},429,{'Retry-After':'2'});}
        if(window.__mode==='permission')return response({detail:'Permission changed'},403);
        if(window.__mode==='validation')return response({detail:'Fix the input'},422);
        const body=JSON.parse(options.body);
        if(window.__mode==='hold'){window.__mode='ok';await new Promise(resolve=>{window.__releaseHold=resolve});}
        if(window.__mode==='hang'){window.__mode='ok';await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));}
        if(body.revision!==window.__fixture.revision)return response({detail:'Changed in another session'},409);
        window.__fixture={...window.__fixture,...body,revision:body.revision+1,updated_at:new Date().toISOString()};
        window.__writes++;
        if(window.__mode==='lost'){window.__mode='ok';throw new TypeError('lost response after commit');}
        return response(window.__fixture);
      }
      return originalFetch(input,options);
    };
  ` });
  await b.call('Page.navigate', { url: `${url}/simulations/${fixture.id}` });
  await wait(`document.querySelectorAll('.wb-tab').length===7`, 'Editor did not mount');
  await sleep(1800);
  await tab('Setup');
  await tab('Data Inputs');
  await wait(`window.__writes>0&&!document.querySelector('.project-save-status').textContent.includes('Saving')`, 'Initial progress did not save');
  assert.match(await e(`document.querySelector('.project-save-status').textContent`), /Saved to server/);
  console.log('Acknowledged save status verified.');

  await e(`window.__mode='auth';window.__originalEditor=document.querySelector('.project-workspace');true`);
  await tab('Setup');
  await wait(`document.body.textContent.includes('Session expired.')`, 'Missing authentication recovery notice');
  await e(`(()=>{const input=document.querySelector('#setup-simulation-name');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Unapplied setup survives');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await tab('Data Inputs');
  const paused = await e(`window.__patches`);
  await sleep(1400); assert.equal(await e(`window.__patches`), paused, 'Auth-required must pause writes');
  assert.equal(await e(`document.querySelector('.project-workspace')===window.__originalEditor`), true);
  await e(`window.__mode='ok';window.__auth='authenticated';[...document.querySelectorAll('button')].find(n=>n.textContent==='Check sign-in').click()`);
  await wait(`!document.body.textContent.includes('Session expired.')&&document.querySelector('.project-save-status').textContent.includes('Saved to server')`, 'Same-account saving did not resume');
  await tab('Setup');
  assert.equal(await e(`document.querySelector('#setup-simulation-name').value`), 'Unapplied setup survives');
  assert.equal(await e(`window.__fixture.name`), fixture.name, 'Recovery must not silently apply setup');
  await wait(`window.__fixture.location.activeTab===-1&&document.querySelector('.project-save-status').textContent.includes('Saved to server')`, 'Setup location did not settle');
  console.log('Expired-session editor preservation, latest edits and same-account resume verified.');

  await e(`window.__mode='network'`); await tab('Data Inputs');
  await wait(`document.body.textContent.includes('Connection interrupted.')`, 'Missing retry status');
  await wait(`document.querySelector('.project-save-status').textContent.includes('Saved to server')`, 'Network retry did not recover');
  await e(`window.__mode='rate'`); await tab('Setup');
  await wait(`document.body.textContent.includes('Connection interrupted.')`, 'Missing 429 retry status');
  await wait(`document.querySelector('.project-save-status').textContent.includes('Saved to server')`, '429 retry did not recover');
  const beforeLost = await e(`window.__writes`);
  await e(`window.__mode='lost'`); await tab('Data Inputs');
  await wait(`window.__writes===${beforeLost + 1}&&document.querySelector('.project-save-status').textContent.includes('Saved to server')`, 'Lost-response reconciliation failed');
  assert.equal(await e(`window.__writes`), beforeLost + 1);
  console.log('Network/429 recovery and committed-write reconciliation verified.');

  await e(`window.__mode='hold'`); await tab('Setup');
  await wait(`!!window.__releaseHold`, 'No in-flight save to test');
  await tab('BAU Scenario');
  assert.equal(await e(`JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.includes(':tab:')))).draft.location.activeTab`), 1,
    'Latest in-flight edits must be recoverable');
  await e(`window.__releaseHold();true`);
  await wait(`window.__fixture.location.activeTab===1&&document.querySelector('.project-save-status').textContent.includes('Saved to server')`, 'Latest edits after earlier acknowledgement did not save');
  await e(`window.__mode='hang'`); await tab('Data Inputs');
  await wait(`document.querySelector('.project-save-status').textContent.includes('Saving')`, 'Hanging save did not start');
  await sleep(25_500);
  await wait(`document.querySelector('.project-save-status').textContent.includes('Saved to server')`, 'Timed-out request did not recover');
  console.log('Edits during a pending save and real request-deadline recovery verified.');

  await e(`window.__storageFail=true`); await tab('Setup');
  await wait(`document.body.textContent.includes('Browser recovery is unavailable.')`, 'Missing storage warning');
  await wait(`document.querySelector('.project-save-status').textContent.includes('Saved to server')`, 'Storage failure prevented a server save');
  await e(`window.__storageFail=false;window.__mode='auth'`); await tab('Data Inputs');
  await wait(`document.body.textContent.includes('Session expired.')`, 'Expected auth state');
  await e(`window.__auth='authenticated';window.__identity={id:'replit:different-test-account',email:'',is_admin:false};[...document.querySelectorAll('button')].find(n=>n.textContent==='Check sign-in').click()`);
  await wait(`document.querySelector('.project-workspace').hidden`, 'Different account must not see the original editor');
  const mismatched = await e(`window.__patches`);
  await sleep(1500); assert.equal(await e(`window.__patches`), mismatched);
  await e(`window.__identity={id:'replit:browser-recovery-test',email:'',is_admin:false};window.__mode='ok';window.__fixture.revision++;window.dispatchEvent(new Event('focus'))`);
  await wait(`document.querySelector('.project-save-status').textContent.includes('Conflict')`, 'Changed revision must block overwrite');
  console.log('Storage failure independence, account isolation and post-login conflict handling verified.');
  const pendingCopies = await e(`Object.keys(localStorage).filter(k=>k.includes('wss:recovery:replit:browser-recovery-test:')).map(k=>JSON.parse(localStorage.getItem(k)))`);
  assert.ok(pendingCopies.some(copy => copy.setup?.name === 'Unapplied setup survives'));
  await b.call('Page.navigate', { url: `${url}/simulations/${fixture.id}` });
  await wait(`document.body.textContent.includes('Pending browser drafts were found.')`, 'Reload must offer recovery before saving');
  assert.equal(await e(`window.__patches`), 0, 'Initial server snapshot must not overwrite pending browser recovery');
  await e(`[...document.querySelectorAll('button')].find(n=>n.textContent==='Recover draft').click()`);
  await wait(`document.querySelector('.project-save-status').textContent.includes('Conflict')`, 'Recovered original revision must block changed-server overwrite');
  await tab('Setup');
  assert.equal(await e(`document.querySelector('#setup-simulation-name').value`), 'Unapplied setup survives');
  assert.equal(await e(`window.__patches`), 0);
  console.log('Reload recovery preserves original revision and unapplied setup without submitting conflicting data.');
  assert.equal(b.errors.length, 0, 'No browser runtime exceptions');
  if (process.env.SESSION_SCREENSHOT) {
    mkdirSync('frontend/src/tests/screenshots', { recursive: true });
    const shot = await b.call('Page.captureScreenshot', { format: 'png' });
    writeFileSync('frontend/src/tests/screenshots/session-save-recovery.png', Buffer.from(shot.data, 'base64'));
  }
} catch (error) {
  console.error(await e(`({patches:window.__patches,writes:window.__writes,auth:window.__auth,status:document.querySelector('.project-save-status')?.textContent,alerts:[...document.querySelectorAll('.project-alert')].map(n=>n.textContent)})`));
  throw error;
} finally { await b.close(); }
