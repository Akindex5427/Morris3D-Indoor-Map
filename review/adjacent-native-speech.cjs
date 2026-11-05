const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 await page.addInitScript(()=>{window.nativeSpeechEvents=[];const s=window.speechSynthesis;if(s){const speak=s.speak.bind(s);s.speak=u=>{for(const type of ['start','pause','resume','end','error'])u.addEventListener(type,e=>window.nativeSpeechEvents.push({type,error:e.error}));return speak(u);};}});
 let result;
 try{
  await page.goto('http://127.0.0.1:3004');
  await page.getByRole('combobox',{name:'Search rooms on all floors'}).fill('0420D');await page.getByRole('option').filter({hasText:'F4'}).first().click();
  await page.getByRole('button',{name:'Rooms Above & Below',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#panel-correspondence')?.getAttribute('aria-busy')==='false',null,{timeout:60000});
  result=await page.evaluate(()=>{const s=window.speechSynthesis,voices=s?.getVoices()||[];return {supported:!!s,totalVoices:voices.length,localEnglishVoices:voices.filter(v=>v.localService&&/^en(?:-|$)/i.test(v.lang)).map(v=>({name:v.name,lang:v.lang})),audiblePlaybackVerified:false};});
  if(result.localEnglishVoices.length){
   await page.getByRole('button',{name:'Listen to Analysis',exact:true}).click();
   await page.waitForFunction(()=>window.nativeSpeechEvents.some(e=>e.type==='start'||e.type==='error')||document.querySelector('.analysis-speech-status')?.textContent.includes('did not start'),null,{timeout:15000});
   if(await page.evaluate(()=>window.nativeSpeechEvents.some(e=>e.type==='start'))){
    await page.getByRole('button',{name:'Pause analysis',exact:true}).click();await page.getByRole('button',{name:'Resume analysis',exact:true}).waitFor({timeout:5000});
    await page.getByRole('button',{name:'Resume analysis',exact:true}).click();await page.getByRole('button',{name:'Pause analysis',exact:true}).waitFor({timeout:5000});
    await page.getByRole('button',{name:'Stop analysis',exact:true}).click();await page.waitForTimeout(250);
   }
  }
  result.events=await page.evaluate(()=>window.nativeSpeechEvents);result.status=await page.locator('.analysis-speech-status').textContent();
  result.stopped=await page.evaluate(()=>!speechSynthesis.speaking&&!speechSynthesis.pending);
 }catch(e){result={...result,error:e.message,events:await page.evaluate(()=>window.nativeSpeechEvents)};}
 finally{fs.writeFileSync('docs/adjacent-room-analysis/native-speech.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));await browser.close();if(result.error)process.exitCode=1;}
})().catch(e=>{console.error(e);process.exitCode=1;});
