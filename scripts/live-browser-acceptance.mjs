/** Navigation and HTTP-transport smoke checks only; not narrated rehearsal evidence.
 * Run manually with an explicit DEMO_URL pointing at the intended backend/frontend.
 * Never substitute replay for a failed live action or infer remote provider delivery.
 */
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
const puppeteer=require('../frontend/node_modules/puppeteer-core');
const BASE_URL=process.env.DEMO_URL;
if(!BASE_URL)throw new Error('Set DEMO_URL explicitly. This script makes real local simulation/evaluation requests.');
const OUT_DIR=path.resolve(process.env.ACCEPTANCE_OUT_DIR || 'docs/demo/screens');
fs.mkdirSync(OUT_DIR,{recursive:true});
const receipt={url:BASE_URL,timestamp:new Date().toISOString(),classification:'NAVIGATION_AND_HTTP_TRANSPORT_SMOKE',narratedRehearsalVerified:false,remoteSponsorExecutionVerified:false,status:'IN_PROGRESS',demoRuns:[],sponsorPanelCheck:{},consoleErrors:[]};
async function waitForText(page,text){
  await page.waitForFunction(value=>document.body.innerText.includes(value),{timeout:20000},text);
}
async function click(page,text){
  const found=await page.evaluate(value=>{
    const button=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(value)&&!b.disabled);
    if(!button)return false;button.click();return true;
  },text);
  if(!found)throw new Error(`Enabled button not found: ${text}`);
}
async function action(page,button,route){
  const pending=page.waitForResponse(response=>new URL(response.url()).pathname===route&&response.request().method()==='POST',{timeout:30000});
  await click(page,button);
  const response=await pending;
  if(!response.ok())throw new Error(`${route} returned HTTP ${response.status()}; no replay permitted`);
  const body=await response.json();
  return {body,transport:{method:'POST',path:route,httpStatus:response.status()}};
}
let browser;
try{
  browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  const page=await browser.newPage();
  page.on('console',msg=>{if(msg.type()==='error')receipt.consoleErrors.push(msg.text());});
  await page.setViewport({width:1440,height:900});
  await page.goto(`${BASE_URL}/#home`,{waitUntil:'networkidle2'});
  receipt.themeCheck=await page.evaluate(()=>({themeAttr:document.documentElement.getAttribute('data-theme'),rootBg:getComputedStyle(document.documentElement).backgroundColor,bodyBg:getComputedStyle(document.body).backgroundColor}));
  await page.screenshot({path:path.join(OUT_DIR,'01-white-landing-1440.png')});
  for(let run=1;run<=3;run++){
    const started=Date.now();
    await page.goto(`${BASE_URL}/#demo`,{waitUntil:'networkidle2'});
    await click(page,'Reset Demo');
    await waitForText(page,'Baseline received from backend. Optimization has not run.');
    await click(page,'Next Scene');
    await waitForText(page,'SCENE 2 / 6');
    const result=await action(page,'Optimize Portfolio','/api/hackharvard-demo/optimize');
    if(result.body.delivery_mode!=='LIVE_COMPUTATION'||!result.body.result?.run_id||!result.body.fixture_sha256)throw new Error('Missing live backend result identity');
    await waitForText(page,'SCENE 4 / 6');
    await click(page,'Next Scene');await waitForText(page,'SCENE 5 / 6');
    await click(page,'Next Scene');await waitForText(page,'SCENE 6 / 6');
    receipt.demoRuns.push({run,navigationDurationMs:Date.now()-started,classification:'NAVIGATION_SMOKE_ONLY',deliveryMode:result.body.delivery_mode,runId:result.body.result.run_id,inputSha256:result.body.result.input_sha256,computedAt:result.body.computed_at,transport:result.transport});
  }
  await page.goto(`${BASE_URL}/#sponsor-agents`,{waitUntil:'networkidle2'});
  const sms=await action(page,'Send STATUS','/api/agents/photon/simulate');
  if(sms.body.status!=='LOCAL_SIMULATION')throw new Error('Phone preview lacks explicit local simulation status');
  const droid=await action(page,'Evaluate Local Proposals','/api/agents/droid/run');
  if(!droid.body.recommendation_id)throw new Error('Missing proposal identity');
  const chalk=await action(page,'Run Local Acceptance Suite','/api/evals/chalk/run');
  if(!chalk.body.run_id||!chalk.body.engine_mode||!(chalk.body.total_scenarios>0))throw new Error('Missing evaluation receipt identity');
  receipt.sponsorPanelCheck={classification:'BACKEND_LOCAL_ACTIONS_ONLY',sms:{...sms.transport,status:sms.body.status,requestId:sms.body.request_id},droid:{...droid.transport,recommendationId:droid.body.recommendation_id,runtimeAgent:droid.body.runtime_agent},chalk:{...chalk.transport,runId:chalk.body.run_id,engineMode:chalk.body.engine_mode,totalScenarios:chalk.body.total_scenarios}};
  await page.screenshot({path:path.join(OUT_DIR,'05-sponsor-agents.png')});
  for(const [width,height] of [[768,1024],[375,812]]){
    await page.setViewport({width,height});await page.goto(`${BASE_URL}/#home`,{waitUntil:'networkidle2'});
    await page.screenshot({path:path.join(OUT_DIR,`landing-${width}.png`)});
  }
  receipt.status=receipt.consoleErrors.length?'LIMITED_CONSOLE_ERRORS':'TRANSPORT_SMOKE_PASSED';
}catch(error){receipt.status='FAILED';receipt.error=String(error);process.exitCode=1;}
finally{
  fs.writeFileSync(path.join(OUT_DIR,'acceptance-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  if(browser)await browser.close();
}
