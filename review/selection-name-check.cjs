const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
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


  try {
    await page.goto(process.env.SEARCH_REVIEW_URL || 'http://127.0.0.1:3001');
    await page.waitForFunction(()=>{
      const d=window.navigationDeck(),l=d?.props.layers.find(l=>l.id==='indoor-building-layer');
      return d?.getViewports()[0].longitude < -89 && l?.props.data.features.every(f=>f.properties.__presentationReveal===1);
    },null,{timeout:60000});
    await page.waitForTimeout(600);
    const point=await page.evaluate(()=>{
      const deck=window.navigationDeck(),v=deck.getViewports()[0];
      const l=deck.props.layers.find(l=>l.id==='indoor-building-layer');
      const f=l.props.data.features.find(f=>f.properties.name==='Classroom 0174');
      const points=f.geometry.coordinates[0].map(([x,y,z=0])=>v.project([x,y,z+l.props.getElevation(f)]));
      const rect=document.querySelector('.map-3d-container').getBoundingClientRect();
      const minX=Math.min(...points.map(p=>p[0])),maxX=Math.max(...points.map(p=>p[0]));
      const minY=Math.min(...points.map(p=>p[1])),maxY=Math.max(...points.map(p=>p[1]));
      for(let i=1;i<10;i++)for(let j=1;j<10;j++){
        const x=minX+(maxX-minX)*i/10,y=minY+(maxY-minY)*j/10;
        const hit=deck.pickObject({x,y,radius:0});
        if(hit?.object?.properties?.name==='Classroom 0174')return {x:rect.x+x,y:rect.y+y};
      }
      return null;
    });
    assert(point,'A visible pixel of Classroom 0174 must be pickable');
    await page.mouse.click(point.x,point.y);
    await page.waitForTimeout(2000);
    console.log(await page.evaluate(()=>{
      const d=window.navigationDeck(),v=d?.getViewports()[0];
      return {name:document.querySelector('.room-info-popup .room-name')?.textContent,
        view:{zoom:v?.zoom,pitch:v?.pitch},selected:document.querySelector('.floor-btn.active')?.textContent};
    }));
    await page.waitForFunction(()=>{
      const d=window.navigationDeck(),v=d?.getViewports()[0];
      return document.querySelector('.room-info-popup .room-name')?.textContent==='Classroom 0174'&&v.pitch===0&&v.zoom>20;
    },null,{timeout:30000});
    assert.equal(await page.locator('.room-info-popup').count(),1);
    const label=await page.evaluate(()=>{
      const d=window.navigationDeck();
      return {name:document.querySelector('.room-info-popup .room-name').textContent,
        onMapLabel:d.props.layers.some(l=>l.id==='selected-feature-name'),pitch:d.getViewports()[0].pitch,zoom:d.getViewports()[0].zoom};
    });
    assert.equal(label.onMapLabel,false);
    fs.writeFileSync('docs/stage-3-search/map-click-results.json',JSON.stringify({passed:true,...label},null,2));
    console.log(label);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
