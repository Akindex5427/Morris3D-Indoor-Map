// Run against the local Vite server with an available Playwright installation.
// Optional: PLAYWRIGHT_MODULE, NAVIGATION_REVIEW_URL, NAVIGATION_REVIEW_OUTPUT.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const output = process.env.NAVIGATION_REVIEW_OUTPUT || 'docs/stage-2-navigation';
fs.mkdirSync(output, {recursive:true});

(async () => {
  const browser = await chromium.launch({channel:'chrome', headless:true,
    args:['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const results = [], errors = [];
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const url = process.env.NAVIGATION_REVIEW_URL || 'http://127.0.0.1:3001';
  await page.addInitScript(() => {
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
  const waitReady = async () => {
    await page.getByRole('slider',{name:'Map zoom',exact:true}).first().waitFor({timeout:60000});
    await page.waitForFunction(() => {
      const deck = window.navigationDeck();
      const layer = deck?.props.layers.find(layer => /^indoor-building-(night-)?layer$/.test(layer.id));
      return Math.abs((deck?.getViewports()[0]?.longitude ?? 0) + 89.22) < 0.01
        && layer?.props.data.features.length && layer.props.data.features.every(f=>f.properties.__presentationReveal >= 1);
    }, null, {timeout:60000});
  };
  const view = () => page.evaluate(() => {
    const v = window.navigationDeck().getViewports()[0];
    return {longitude:v.longitude, latitude:v.latitude, zoom:v.zoom, pitch:v.pitch, bearing:v.bearing};
  });
  const sync = async () => {
    await page.waitForFunction(() => {
      const zoom = window.navigationDeck()?.getViewports()[0]?.zoom;
      const input = document.querySelector('.map-zoom-slider');
      return input && Math.abs(Number(input.value) - zoom) < 0.02;
    });
  };
  const fit = async () => { await page.getByRole('button',{name:'Fit building / Reset view',exact:true}).first().click(); await page.waitForTimeout(300); await sync(); };
  const frame = async phase => {
    const result = await page.evaluate(async () => {
      const {getWallFitPoints} = await import('/src/utils/buildingCamera.js');
      const deck = window.navigationDeck();
      const viewport = deck.getViewports()[0];
      const layer = deck.props.layers.find(layer => /^indoor-building-(night-)?layer$/.test(layer.id));
      const projected = layer.props.data.features.flatMap(feature => {
        const coords = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates.flat() : feature.geometry.coordinates.flat(2);
        return coords.flatMap(([x,y,z=0]) => [viewport.project([x,y,z]), viewport.project([x,y,z+layer.props.getElevation(feature)])]);
      });
      projected.push(...getWallFitPoints(deck.props.layers.filter(l=>Array.isArray(l.props.data) && l.props.data[0]?.mesh)).map(point=>viewport.project(point)));
      const bounds = {left:Math.min(...projected.map(p=>p[0])),right:Math.max(...projected.map(p=>p[0])),
        top:Math.min(...projected.map(p=>p[1])),bottom:Math.max(...projected.map(p=>p[1]))};
      const container = document.querySelector('.map-3d-container').getBoundingClientRect();
      const control = document.querySelector('.map-camera-controls').getBoundingClientRect();
      const right = container.width - 12;
      const railLeft=control.left-container.left-10, railBottom=control.bottom-container.top+10;
      const center=[(bounds.left+bounds.right)/2,(bounds.top+bounds.bottom)/2];
      const besideDistance=Math.hypot(center[0]-(12+railLeft)/2,center[1]-container.height/2);
      const belowDistance=Math.hypot(center[0]-container.width/2,center[1]-(railBottom+container.height-12)/2);
      const fitRegion=besideDistance<belowDistance?'beside-controls':'below-controls';
      const availableWidth=fitRegion==='beside-controls'?railLeft-12:container.width-24;
      const availableHeight=fitRegion==='beside-controls'?container.height-24:container.height-12-railBottom;
      return {bounds, width:container.width, height:container.height, right,
        occupancy:Math.max((bounds.right-bounds.left)/availableWidth,(bounds.bottom-bounds.top)/availableHeight),fitRegion,
        zoom:viewport.zoom,pitch:viewport.pitch,bearing:viewport.bearing,
        floor:document.querySelector('.floor-btn.active')?.textContent,
        controls:{x:control.x,y:control.y,width:control.width,height:control.height},
        overlapsControls: bounds.right > control.left-container.left && bounds.left < control.right-container.left
          && bounds.bottom > control.top-container.top && bounds.top < control.bottom-container.top,
        targets:[...document.querySelectorAll('.map-camera-controls button')].map(b=>({width:b.offsetWidth,height:b.offsetHeight}))};
    });
    assert(result.bounds.left>=0 && result.bounds.top>=0 && result.bounds.right<=result.right && result.bounds.bottom<=result.height, `${phase}: clipped ${JSON.stringify(result)}`);
    assert(!result.overlapsControls,`${phase}: building overlaps controls`);
    assert(result.occupancy>=0.78 && result.occupancy<=0.91, `${phase}: occupancy ${result.occupancy}`);
    assert(result.targets.every(t=>t.width>=44 && t.height>=44));
    results.push({phase,...result});
    console.log(phase, 'zoom',result.zoom.toFixed(3),'occupancy',result.occupancy.toFixed(3));
  };
  try {
    await page.goto(url);
    await waitReady(); await sync();
    await frame('initial-desktop');
    assert.equal(await page.locator('.floor-btn.active').textContent(),'F1');
    assert.equal((await view()).pitch,45);
    await page.screenshot({path:`${output}/initial-desktop.png`});
    const initial = await view(); await page.waitForTimeout(700); assert.deepEqual(await view(),initial);

    const slider = page.getByRole('slider',{name:'Map zoom',exact:true});
    await slider.focus(); await slider.press('Home'); await sync();
    assert.equal((await view()).zoom,14);
    await fit(); await frame('reset-after-zoom-out');
    await slider.focus(); await slider.press('ArrowUp'); await sync();
    assert((await view()).zoom>initial.zoom);

    const box = await page.locator('.map-3d-container').boundingBox();
    const beforeWheel = (await view()).zoom;
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await page.mouse.wheel(0,300); await page.waitForTimeout(900); await sync();
    assert((await view()).zoom<beforeWheel);
    results.push({phase:'wheel-and-slider',passed:true});
    await page.evaluate(() => {
      const deck = window.navigationDeck();
      deck.props.onViewStateChange({viewState:{...deck.props.viewState,zoom:18.2,transitionDuration:0}});
    });
    await sync(); assert(Math.abs(Number(await slider.inputValue())-18.2)<0.02);

    const manual = await view();
    await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
    await page.waitForTimeout(800); assert.deepEqual(await view(),manual);
    await fit(); await frame('sidebar-collapsed-reset');
    const collapsed = await view();
    await page.getByRole('button',{name:'Expand sidebar',exact:true}).click();
    await page.waitForTimeout(800); assert.deepEqual(await view(),collapsed);
    results.push({phase:'sidebar-resize-preserves-camera',passed:true});

    for (const floor of ['F0','F2','F7','F-All']) {
      const before = await view();
      await page.getByRole('button',{name:floor,exact:true}).click(); await waitReady();
      assert.deepEqual(await view(),before, `${floor}: unexpected automatic fit`);
      await fit(); await frame(`${floor}-reset`);
    }
    await page.screenshot({path:`${output}/all-floors.png`});

    await page.getByRole('button',{name:'F1',exact:true}).click(); await waitReady();
    const search = page.getByRole('combobox',{name:'Search rooms on all floors'});
    await search.fill('0174'); await page.locator('.suggestion-item').first().click();
    await page.waitForTimeout(1500); await sync();
    const count = await page.evaluate(()=>window.navigationDeck().props.layers.find(l=>l.id==='indoor-building-layer').props.data.features.length);
    await fit();
    assert.equal(await search.inputValue(),'Classroom 0174');
    assert.equal(await page.evaluate(()=>window.navigationDeck().props.layers.find(l=>l.id==='indoor-building-layer').props.data.features.length),count);
    assert.equal(await page.locator('.floor-btn.active').textContent(),'F1');
    results.push({phase:'reset-preserves-search',passed:true});
    await page.getByRole('button',{name:'Clear search',exact:true}).click();
    assert.equal(await page.getByRole('region',{name:'Room details'}).count(),0);

    await page.getByRole('button',{name:'Plan Route',exact:true}).click();
    await page.getByPlaceholder('Search start room...').fill('0174');
    await page.locator('.route-suggestion-body').first().click();
    await page.getByPlaceholder('Search end room...').fill('0181');
    await page.locator('.route-suggestion-item-clickable').first().click();
    await page.getByRole('button',{name:'Find Route',exact:true}).click();
    await page.waitForTimeout(1800);
    await page.getByRole('slider',{name:'Preview progress'}).press('ArrowRight');
    await page.getByTitle('Resume preview',{exact:true}).waitFor();
    const snapshotRoute=require(process.cwd()+'/review/route-model-snapshot.cjs').snapshotRoute;
    const routeBefore = await page.evaluate(snapshotRoute);
    assert(routeBefore.length>0,'Route should render');
    await fit(); await frame('route-reset');
    assert.deepEqual(await page.evaluate(snapshotRoute),routeBefore);
    await slider.focus(); await slider.press('ArrowDown'); await sync();
    results.push({phase:'route-preserved-during-navigation',passed:true});
    await page.locator('#animation-toggle').uncheck();

    await page.locator('#night-mode-toggle').check();
    await page.locator('input[name="night-visualization-style"][value="gis"]').check();
    await page.waitForTimeout(800); const nightView=await view();
    await fit(); await sync();
    assert(await page.locator('input[name="night-visualization-style"][value="gis"]').isChecked());
    // Cinematic rendering deliberately retains one layer ID through Day/Night.
    await page.waitForFunction(()=>window.navigationDeck().layerManager.getLayers().find(l=>l.id==='indoor-building-layer-polygons-fill')?.props.environment.progress===1);
    await page.locator('input[name="night-visualization-style"][value="architectural"]').check();
    const fittedNight=await view(); await page.waitForTimeout(800); assert.deepEqual(await view(),fittedNight);
    results.push({phase:'night-presets-preserved',passed:true,nightView});

    await page.locator('#night-mode-toggle').uncheck();
    await page.getByRole('button',{name:'Plan Route',exact:true}).click();
    await page.locator('#planner-floor-select').selectOption('');
    await page.getByPlaceholder('Search start room...').fill('0174');
    await page.locator('.route-suggestion-body').first().click();
    await page.getByPlaceholder('Search end room...').fill('0261');
    await page.locator('.route-suggestion-item-clickable').first().click();
    await page.getByRole('button',{name:'Find Route',exact:true}).click();
    await page.locator('.multi-floor-route-view').waitFor({timeout:60000});
    await waitReady();
    const panels = await page.locator('.map-camera-controls').count();
    assert(panels>=2);
    await fit(); assert.equal((await view()).pitch,0);
    await page.getByRole('slider',{name:'Map zoom',exact:true}).first().focus();
    await page.getByRole('slider',{name:'Map zoom',exact:true}).first().press('Home'); await sync();
    assert.equal((await view()).zoom,14);
    const timelineView=await view();
    await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click(); await page.waitForTimeout(800);
    assert.deepEqual(await view(),timelineView);
    assert.equal(await page.locator('.route-timeline-card').count(),panels);
    results.push({phase:'multi-floor-route-panel-controls',passed:true,panels});

    await page.setViewportSize({width:390,height:844});
    await page.reload(); await waitReady(); await sync(); await frame('initial-mobile');
    assert.equal(await page.locator('.floor-btn.active').textContent(),'F1');
    await page.screenshot({path:`${output}/initial-mobile.png`});
    await slider.focus(); await slider.press('Home'); await sync(); await fit(); await frame('mobile-reset');
    const mobileBox=await page.locator('.map-3d-container').boundingBox();
    const touchZoom=(await view()).zoom;
    const cdp=await context.newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
    const centerX=mobileBox.x+mobileBox.width/2, centerY=mobileBox.y+mobileBox.height*0.6;
    const fingers=distance=>[{x:centerX-distance,y:centerY,id:1},{x:centerX+distance,y:centerY,id:2}];
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:fingers(25)});
    for(let distance=30;distance<=60;distance+=5){
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:fingers(distance)});
      await page.waitForTimeout(40);
    }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForTimeout(700); await sync();
    assert((await view()).zoom>touchZoom,'Pinch should zoom in');
    results.push({phase:'touch-pinch-slider-synchronization',passed:true});
    await fit();
    const beforeDrawer=await view();
    await page.locator('.mobile-drawer-toggle').click(); await page.waitForTimeout(400);
    await page.locator('.drawer-close').click();
    await page.waitForTimeout(400); assert.deepEqual(await view(),beforeDrawer);
    results.push({phase:'mobile-drawer-preserves-camera',passed:true});
    assert.equal(errors.length,0,errors.join('\n'));
  } finally {
    fs.writeFileSync(`${output}/browser-results.json`,JSON.stringify({results,errors},null,2));
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
