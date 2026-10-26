// Verify Stage 3 against a local Vite server using Playwright and installed Chrome.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const output = process.env.SEARCH_REVIEW_OUTPUT || 'docs/stage-3-search';
fs.mkdirSync(output, {recursive:true});
(async () => {
  const browser = await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  const page = await context.newPage();
  const results=[], errors=[];
  page.on('pageerror', error => errors.push(error.message));
  const url=process.env.SEARCH_REVIEW_URL || 'http://127.0.0.1:3001';
  await page.addInitScript(() => {
    // Read the catalog actually passed to the mounted search component. A
    // direct Vite import can address a different HMR generation of the store.
    window.liveRoomCatalog = () => {
      const node = document.querySelector('.search-bar-container');
      let fiber = node?.[Object.keys(node).find(key=>key.startsWith('__reactFiber'))];
      while (fiber) {
        if (fiber.memoizedProps?.catalog) {
          let root = fiber; while (root.return) root = root.return;
          return (root.stateNode?.current === root ? fiber : fiber.alternate || fiber).memoizedProps.catalog;
        }
        fiber = fiber.return;
      }
    };
    window.navigationDeck = () => {
      const node = document.querySelector('#deckgl-wrapper');
      let fiber = node?.[Object.keys(node).find(key=>key.startsWith('__reactFiber'))];
      while (fiber) {
        let hook = fiber.memoizedState;
        while (hook && typeof hook === 'object') {
          if (hook.memoizedState?.current?.deck) return hook.memoizedState.current.deck;
          hook = hook.next;
        }
        fiber = fiber.return;
      }
    };
  });

  const ready=async()=>{
    await page.getByRole('combobox',{name:'Search rooms on all floors',includeHidden:true}).waitFor({state:'attached',timeout:60000});
    await page.waitForFunction(()=>window.navigationDeck()?.getViewports()[0]?.longitude < -89,{},{timeout:60000});
    await page.waitForFunction(()=>window.liveRoomCatalog()?.loadedFloors.length===8);
    await page.waitForTimeout(1000);
  };
  const input=()=>page.getByRole('combobox',{name:'Search rooms on all floors'});
  const view=()=>page.evaluate(()=>{
    const v=window.navigationDeck().getViewports()[0];return {longitude:v.longitude,latitude:v.latitude,zoom:v.zoom,pitch:v.pitch,bearing:v.bearing};
  });
  const close=async()=>{const b=page.getByRole('button',{name:'Close room details',exact:true});if(await b.count())await b.click();};
  const select=async(query,floor,name,{keyboard=false,resultIndex=0}={})=>{
    await close();
    await input().fill(query);
    const match=page.getByRole('option').filter({has:page.locator('.suggestion-name',{hasText:name})}).filter({hasText:`F${floor}`}).nth(resultIndex);
    await match.waitFor();
    if(keyboard)await input().press('Enter');else await match.click();
    await page.waitForFunction(({floor,name})=>{
      const deck=window.navigationDeck();
      const layer=deck?.props.layers.find(l=>/^indoor-building-(night-)?layer$/.test(l.id));
      const gold=layer?.props.data.features.filter(f=>{const c=layer.props.getFillColor(f);return c[0]===255 && c[1]===200 && c[2]===0;}) || [];
      return document.querySelector('.floor-btn.active')?.textContent===`F${floor}` && gold.length===1 && gold[0].properties.name===name;
    },{floor,name},{timeout:60000});
    await page.waitForFunction(()=>{
      const deck=window.navigationDeck(),v=deck?.getViewports()[0];
      const layer=deck?.props.layers.find(l=>/^indoor-building-(night-)?layer$/.test(l.id));
      const f=layer?.props.data.features.find(f=>{const c=layer.props.getFillColor(f);return c[0]===255&&c[1]===200&&c[2]===0;});
      if(!f||!v)return false;
      const coords=f.geometry.type==='Polygon'?f.geometry.coordinates.flat():f.geometry.coordinates.flat(2);
      const points=coords.flatMap(([x,y,z=0])=>[v.project([x,y,z]),v.project([x,y,z+layer.props.getElevation(f)])]);
      const x=(Math.min(...points.map(p=>p[0]))+Math.max(...points.map(p=>p[0])))/2;
      const y=(Math.min(...points.map(p=>p[1]))+Math.max(...points.map(p=>p[1])))/2;
      return Math.abs(x-(32+v.width-90)/2)<0.5&&Math.abs(y-v.height/2)<0.5&&v.pitch===0;
    },null,{timeout:60000});
    await page.waitForTimeout(300);
    const info=await page.evaluate(()=>{
      const deck=window.navigationDeck(), v=deck.getViewports()[0];
      const layer=deck.props.layers.find(l=>/^indoor-building-(night-)?layer$/.test(l.id));
      const feature=layer.props.data.features.find(f=>{const c=layer.props.getFillColor(f);return c[0]===255 && c[1]===200 && c[2]===0;});
      const coords=feature.geometry.type==='Polygon'?feature.geometry.coordinates.flat():feature.geometry.coordinates.flat(2);
      const points=coords.flatMap(([x,y,z=0])=>[v.project([x,y,z]),v.project([x,y,z+layer.props.getElevation(feature)])]);
      const allPoints=layer.props.data.features.flatMap(f=>{
        const c=f.geometry.type==='Polygon'?f.geometry.coordinates.flat():f.geometry.coordinates.flat(2);
        return c.flatMap(([x,y,z=0])=>[v.project([x,y,z]),v.project([x,y,z+layer.props.getElevation(f)])]);
      });
      return {key:feature.properties.__roomSearchKey,name:feature.properties.name,floor:feature.properties.floor,
        featureCount:layer.props.data.features.length, zoom:v.zoom,pitch:v.pitch,bearing:v.bearing,
        bounds:{left:Math.min(...points.map(p=>p[0])),right:Math.max(...points.map(p=>p[0])),top:Math.min(...points.map(p=>p[1])),bottom:Math.max(...points.map(p=>p[1]))},
        buildingBounds:{left:Math.min(...allPoints.map(p=>p[0])),right:Math.max(...allPoints.map(p=>p[0])),top:Math.min(...allPoints.map(p=>p[1])),bottom:Math.max(...allPoints.map(p=>p[1]))},
        viewport:{width:v.width,height:v.height}};
    });
    assert(info.bounds.left>=0 && info.bounds.right<=info.viewport.width && info.bounds.top>=0 && info.bounds.bottom<=info.viewport.height,JSON.stringify(info));
    const panel=page.getByRole('region',{name:'Room details'});
    assert.equal(await panel.locator('.room-name').textContent(),name);
    assert.equal(await panel.locator('.detail-row').count(),0);
    assert(await page.evaluate(()=>!window.navigationDeck().props.layers.some(l=>l.id==='selected-feature-name')));
    const label={text:await panel.locator('.room-name').textContent(),presentation:'fixed-panel'};
    assert.equal(info.pitch,0);
    assert.equal(info.bearing,0);
    assert(info.zoom>=14&&info.zoom<=21);
    results.push({phase:'select-room',query,...info,label});
    console.log('Selected',floor,name,info.zoom);
    return info;
  };
  try {
    await page.goto(url); await ready();
    await page.locator('#animation-toggle').uncheck();
    const audit=await page.evaluate(async()=>{
      const {searchRooms}=await import('/src/utils/roomCatalog.js');
      const snapshot=window.liveRoomCatalog();
      return {floors:snapshot.summaries,unnamed:snapshot.entries.filter(e=>!e.name).map(({floor,source,index,identifiers})=>({floor,source,index,identifiers})),
        queries:['class','GROUP   STUDY','classroom-0754','dewey','structure','staircase'].map(query=>{
          const matches=searchRooms(snapshot.entries,query);
          return {query,count:matches.length,byFloor:Object.fromEntries(Array.from({length:8},(_,f)=>[f,matches.filter(e=>e.floor===f).length]))};
        })};
    });
    fs.writeFileSync(`${output}/data-audit.json`,JSON.stringify(audit,null,2));
    assert.equal(audit.floors.reduce((n,f)=>n+f.searchable,0),1610);
    await input().fill('structure');
    assert.equal(await page.getByRole('listbox',{name:'Room search results'}).getByRole('option').count(),audit.queries.find(q=>q.query==='structure').count);
    assert((await page.getByRole('listbox',{name:'Room search results'}).getByRole('option').count())>8);
    results.push({phase:'all-duplicate-results-visible',count:await page.getByRole('listbox',{name:'Room search results'}).getByRole('option').count(),passed:true});
    await input().press('Escape');
    await page.getByRole('button',{name:'F-All',exact:true}).click();
    await select('JOURNALS 1995 older a',0,'journals 1995 & older a to f');
    for(const [floor,query,name] of [
      [1,'CLASSROOM-0174','Classroom 0174'],[2,'026','Classroom 0261'],
      [3,'lactation','Lactation Room 0323'],[4,'conference 048','Library Conference 0480A'],
      [5,'group study 0550a','Group  Study 0550A'],[6,'math class','Math Classroom 0654'],[7,'classroom0754','Classroom 0754']]) {
      await select(query,floor,name,{keyboard:floor===7});
    }
    await page.screenshot({path:`${output}/selected-f7.png`});
    const duplicateName=await page.evaluate(()=> window.liveRoomCatalog().entries.find(e=>e.floor===4 && e.name.toLowerCase()==='structure').name);
    const firstDuplicate=await select('structure',4,duplicateName);
    const secondDuplicate=await select('structure',4,duplicateName,{resultIndex:1});
    assert.notEqual(firstDuplicate.key,secondDuplicate.key);
    results.push({phase:'same-floor-duplicate-identity',passed:true});
    const panelBefore=await page.locator('.room-info-popup').boundingBox();
    const manual=await view();
    await page.getByRole('button',{name:'Zoom out',exact:true}).click(); await page.waitForTimeout(700);
    const changed=await view();assert(changed.zoom<manual.zoom);
    const panelAfter=await page.locator('.room-info-popup').boundingBox();
    assert.equal(panelAfter.width,panelBefore.width);assert.equal(panelAfter.height,panelBefore.height);
    results.push({phase:'selection-panel-size-independent-of-zoom',passed:true});
    await page.locator('#night-mode-toggle').check();
    for(const preset of ['gis','architectural']){
      await page.locator(`input[name="night-visualization-style"][value="${preset}"]`).check();
      await page.waitForTimeout(750);assert.deepEqual(await view(),changed);
      assert(await page.evaluate(()=>!window.navigationDeck().props.layers.some(l=>l.id==='selected-feature-name')));
    }
    results.push({phase:'manual-camera-and-night-preserved',passed:true});
    await page.locator('#night-mode-toggle').uncheck();
    await page.getByRole('button',{name:'Clear search',exact:true}).click();
    assert.equal(await page.locator('.room-info-popup').count(),0);
    assert(await page.evaluate(()=>!window.navigationDeck().props.layers.some(l=>l.id==='selected-feature-name')));
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(()=>{
      const l=window.navigationDeck().props.layers.find(l=>l.id==='indoor-building-layer');return l.props.data.features.filter(f=>{const c=l.props.getFillColor(f);return c[0]===255&&c[1]===200&&c[2]===0;}).length;
    }),0);
    await page.getByRole('button',{name:'F1',exact:true}).click();
    await page.getByRole('button',{name:'Plan Route',exact:true}).click();
    await page.getByPlaceholder('Search start room...').fill('0174');await page.locator('.route-suggestion-body').first().click();
    await page.getByPlaceholder('Search end room...').fill('0181');await page.locator('.route-suggestion-item-clickable').first().click();
    await page.getByRole('button',{name:'Find Route',exact:true}).click();await page.waitForTimeout(2000);
    // Responsive labels may change when search moves the camera. Compare the
    // route paths, with preview paused, rather than their transient annotations.
    await page.getByRole('slider',{name:'Preview progress'}).press('ArrowRight');
    await page.getByTitle('Resume preview',{exact:true}).waitFor();
    const route=()=>page.evaluate(require(process.cwd()+'/review/route-model-snapshot.cjs').snapshotRoute);
    const before=await route();assert(before.length>0);
    await select('classroom 0754',7,'Classroom 0754');
    await select('classroom 0174',1,'Classroom 0174');
    assert.deepEqual(await route(),before);
    results.push({phase:'route-preserved-through-cross-floor-search',passed:true});
    await close();
    await page.getByRole('button',{name:'Plan Route',exact:true}).click();
    await page.locator('#planner-floor-select').selectOption('');
    await page.getByPlaceholder('Search start room...').fill('0174');await page.locator('.route-suggestion-body').first().click();
    await page.getByPlaceholder('Search end room...').fill('0261');await page.locator('.route-suggestion-item-clickable').first().click();
    await page.getByRole('button',{name:'Find Route',exact:true}).click();
    await page.locator('.multi-floor-route-view').waitFor({timeout:60000});
    const panelCount=await page.locator('.route-timeline-card').count();assert(panelCount>=2);
    await select('0261',2,'Classroom 0261');
    assert.equal(await page.locator('.multi-floor-route-view').count(),0);
    assert(await page.getByRole('button',{name:'Clear Route',exact:true}).count());
    await close();
    await page.getByRole('button',{name:'Timeline view',exact:true}).click();
    await page.locator('.multi-floor-route-view').waitFor({timeout:60000});
    assert.equal(await page.locator('.route-timeline-card').count(),panelCount);
    results.push({phase:'multi-floor-route-search-and-timeline-return',passed:true});
    await page.getByRole('button',{name:'Clear Route',exact:true}).click();
    await page.getByRole('button',{name:'F-All',exact:true}).click();
    await page.waitForTimeout(1600);
    const count=await page.evaluate(()=>window.navigationDeck().props.layers.find(l=>l.id==='indoor-building-layer').props.data.features.length);
    assert.equal(count,1608);results.push({phase:'combined-f-all-preserved',count,passed:true});
    await page.setViewportSize({width:390,height:844});await page.reload();await ready();
    await page.locator('.mobile-drawer-toggle').click();
    await select('0754',7,'Classroom 0754');
    const mobileLayout=await page.evaluate(()=>{
      const main=document.querySelector('.main-content'),map=document.querySelector('.map-container');
      const a=main.getBoundingClientRect(),b=map.getBoundingClientRect();
      return {scrollTop:main.scrollTop,mainY:a.y,mapY:b.y,mapHeight:b.height,panel:document.querySelector('.room-info-popup').getBoundingClientRect().toJSON()};
    });
    assert.equal(mobileLayout.scrollTop,0);
    assert(Math.abs(mobileLayout.mainY-mobileLayout.mapY)<2);
    assert(mobileLayout.panel.y>=mobileLayout.mapY);
    results.push({phase:'mobile-panel-and-map-layout',passed:true,...mobileLayout});
    await page.screenshot({path:`${output}/mobile-search.png`});
    results.push({phase:'mobile-cross-floor-selection',passed:true});
    await page.setViewportSize({width:1440,height:1000});
    let release;
    const delayed=new Promise(resolve=>{release=resolve;});
    await page.route('**/rooms-level-7-WGS.geojson',async route=>{await delayed;await route.continue();});
    await page.reload();
    await input().waitFor({timeout:60000});
    await input().fill('0754');
    await page.waitForTimeout(300);
    assert((await page.locator('.room-search-status').innerText()).includes('Loading'));
    assert.equal(await page.locator('[role="listbox"] .suggestion-item').count(),0);
    release();
    await page.getByRole('option').filter({hasText:'Classroom 0754'}).waitFor({timeout:30000});
    results.push({phase:'query-updates-after-delayed-floor',passed:true});
    await page.unroute('**/rooms-level-7-WGS.geojson');
    await page.route('**/rooms-level-7-WGS.geojson',route=>route.fulfill({status:503,body:'Unavailable'}));
    await page.reload();await input().waitFor({timeout:60000});
    await page.waitForFunction(()=>document.querySelector('.room-search-status')?.textContent.includes('F7 unavailable'));
    await input().fill('0754');
    await page.unroute('**/rooms-level-7-WGS.geojson');
    await page.locator('.room-search-status').getByRole('button',{name:'Retry'}).click();
    await page.getByRole('option').filter({hasText:'Classroom 0754'}).waitFor({timeout:30000});
    results.push({phase:'failed-floor-visible-and-retry-restores-results',passed:true});
    assert.equal(errors.length,0,errors.join('\n'));
  } finally {
    fs.writeFileSync(`${output}/browser-results.json`,JSON.stringify({results,errors},null,2));
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
