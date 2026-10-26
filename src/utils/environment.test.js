import {describe,it,expect} from 'vitest';
import {createEnvironmentClock,sampleEnvironment,ENVIRONMENT_KEYFRAMES} from './environment';
import {createMapEnvironmentAdapter,transformColorExpression,parseStyleColor} from './mapEnvironment';
import {createIndoorLighting,applyEnvironmentLighting} from '../components/IndoorBuilding';

function harness() {
  let time=0,id=0; const queue=new Map(),values=[];
  const clock=createEnvironmentClock({now:()=>time,request:cb=>{queue.set(++id,cb);return id;},
    cancel:id=>queue.delete(id),onChange:p=>values.push(p)});
  return {clock,queue,values,advance(ms){time+=ms;const pending=[...queue.values()];queue.clear();pending.forEach(cb=>cb(time));}};
}
describe('reversible environment',()=>{
  it('traverses daylight, sunset, twilight, night in eight seconds independent of frame cadence',()=>{
    for(const interval of [8,16,100,137]) {
      const h=harness();h.clock.setTarget(1);
      for(let t=0;t<8000;t+=interval) h.advance(Math.min(interval,8000-t));
      expect(h.values.at(-1)).toBe(1);expect(h.queue.size).toBe(0);
      expect(h.values.every((v,i,a)=>i===0||v>=a[i-1])).toBe(true);
    }
    expect(sampleEnvironment(.36).sunColor).toEqual([255,156,72]);
    expect(sampleEnvironment(.7).sky).toEqual([43,66,110]);
  });
  it('interpolates configurable keyframes continuously with normalized sun direction',()=>{
    for(const frame of ENVIRONMENT_KEYFRAMES) {
      const actual=sampleEnvironment(frame.at);
      expect(actual.ambientColor).toEqual(frame.ambientColor);
      expect(Math.hypot(...actual.direction)).toBeCloseTo(1);
      const a=sampleEnvironment(frame.at-1e-6),b=sampleEnvironment(frame.at+1e-6);
      expect(Math.abs(a.surfaceNight-b.surfaceNight)).toBeLessThan(.0001);
    }
    expect(sampleEnvironment(.36,ENVIRONMENT_KEYFRAMES.map(f=>({...f,exposure:2}))).exposure).toBe(2);
  });
  it('reverses from the current state without an endpoint flash',()=>{
    const h=harness();h.clock.setTarget(1);h.advance(3200);expect(h.clock.getProgress()).toBe(.4);
    h.clock.setTarget(0);expect(h.clock.getProgress()).toBe(.4);
    h.advance(1600);expect(h.clock.getProgress()).toBeCloseTo(.2);
    h.advance(1600);expect(h.clock.getProgress()).toBe(0);
  });
  it('rapid toggles leave only one scheduled frame and dispose prevents later updates',()=>{
    const h=harness();
    for(let i=0;i<20;i++){h.clock.setTarget(i%2);h.advance(37);expect(h.queue.size).toBeLessThanOrEqual(1);}
    h.clock.setTarget(1);h.clock.dispose();const count=h.values.length;
    h.advance(9000);h.clock.setTarget(0);expect(h.queue.size).toBe(0);expect(h.values.length).toBe(count);
  });
  it('reduced motion resolves to target and cancels active animation',()=>{
    const h=harness();h.clock.setTarget(1);h.advance(1000);h.clock.setTarget(1,true);
    expect(h.clock.getProgress()).toBe(1);expect(h.queue.size).toBe(0);
    h.clock.setTarget(0,true);expect(h.clock.getProgress()).toBe(0);
  });
  it('reuses all deck light objects while varying environment, independent of camera or preset',()=>{
    const effect=createIndoorLighting(), ambient=effect.ambientLight,sun=effect.directionalLights[0];
    const h=harness();h.clock.setTarget(1);h.advance(8000);
    for(const p of [0,.36,.7,1,.5,0]) applyEnvironmentLighting(effect,sampleEnvironment(p));
    expect(effect.ambientLight).toBe(ambient);expect(effect.directionalLights[0]).toBe(sun);
    expect(sun.intensity).toBe(.5);expect(ambient.intensity).toBe(.3);
    // Preset configuration cannot restart a clock whose only input is target progress.
    expect(h.clock.getProgress()).toBe(1);expect(h.queue.size).toBe(0);
  });
});
describe('non-destructive basemap adapter',()=>{
  it('parses authored hex, rgb and hsl colors with alpha',()=>{
    expect(parseStyleColor('#f80')).toEqual([255,136,0,1]);
    expect(parseStyleColor('rgba(10,20,30,.5)')).toEqual([10,20,30,.5]);
    expect(parseStyleColor('hsl(120,100%,50%)')).toEqual([0,255,0,1]);
    expect(parseStyleColor(['get','color'])).toBeNull();
  });
  it('preserves zoom structure, match keys and unsupported data-driven expressions',()=>{
    const expression=['interpolate',['linear'],['zoom'],12,['match',['get','class'],'#fff','#000','#fff'],18,'#fff'];
    const before=JSON.stringify(expression);
    const result=transformColorExpression(expression,()=> '#112233');
    expect(result[2]).toEqual(['zoom']);expect(result[4][2]).toBe('#fff');
    expect(result[4][3]).toBe('#112233');expect(result[6]).toBe('#112233');
    expect(JSON.stringify(expression)).toBe(before);
    expect(transformColorExpression(['to-color',['get','color']],()=> '#000')).toEqual(['to-color',['get','color']]);
  });
  it('preserves custom layers, camera and sources, restores exact day paint and detaches listener',()=>{
    const camera=Object.freeze({zoom:19,pitch:45,bearing:17});
    const calls=[],listeners=new Map();
    const style={sources:{composite:{url:'mapbox://mapbox.mapbox-streets-v8'},rooms:{type:'geojson'}},layers:[
      {id:'land',type:'fill',source:'composite',paint:{'fill-color':'#eee'}},
      {id:'rooms',type:'fill',source:'rooms',paint:{'fill-color':'#0f0'}}]};
    const before=JSON.stringify(style);
    const map={getStyle:()=>style,isStyleLoaded:()=>true,getLayer:id=>style.layers.find(l=>l.id===id),
      on:(e,f)=>listeners.set(e,f),off:e=>listeners.delete(e),getFog:()=>null,getLight:()=>({intensity:.5}),
      setPaintProperty:(...args)=>calls.push(args),setFog:()=>{},setLight:()=>{},camera};
    const adapter=createMapEnvironmentAdapter(map);
    for(const p of [0,.36,.7,1,.5,0]) adapter.apply(sampleEnvironment(p),true);
    expect(adapter.diagnostics.paintProperties).toBe(1);expect(adapter.diagnostics.failures).toEqual([]);
    expect(calls.filter(c=>c[1]==='fill-color').at(-1)).toEqual(['land','fill-color','#eee']);
    expect(calls.every(c=>c[0]==='land')).toBe(true);expect(map.camera).toBe(camera);expect(JSON.stringify(style)).toBe(before);
    listeners.get('style.load')();adapter.dispose();expect(listeners.size).toBe(0);
  });
});
