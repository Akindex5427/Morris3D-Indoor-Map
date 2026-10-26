import {describe,it,expect} from 'vitest';
import {createMapEnvironmentAdapter,isFeatureColorExpression} from './mapEnvironment';
import {sampleEnvironment} from './environment';
const expression=['match',['get','class'],'park','#88cc88','#cccccc'];
function fixture(){
 const calls=[];
 const map={getStyle:()=>({sources:{tiles:{url:'mapbox://test'}},layers:[
  {id:'feature',type:'fill',source:'tiles',paint:{'fill-color':expression}},
  {id:'background',type:'background',paint:{'background-color':'#ffffff'}}]}),
  getLayer:()=>true,getFog:()=>null,getLight:()=>null,on:()=>{},off:()=>{},isStyleLoaded:()=>true,
  setPaintProperty:(id,property,value)=>calls.push({id,property,value}),setFog:()=>{},setLight:()=>{}};
 const adapter=createMapEnvironmentAdapter(map);calls.length=0;return {calls,adapter};
}
describe('Mapbox feature-color update budget',()=>{
 it('distinguishes feature colors from camera-only or literal expressions',()=>{
  expect(isFeatureColorExpression(expression)).toBe(true);
  expect(isFeatureColorExpression(['interpolate',['linear'],['zoom'],0,'#fff',20,'#000'])).toBe(false);
  expect(isFeatureColorExpression(['literal',['get','class']])).toBe(false);
 });
 it('reduces feature-buffer updates without changing uniform-paint cadence',()=>{
  const {adapter,calls}=fixture();
  for(let i=0;i<=480;i++)adapter.apply(sampleEnvironment(i/480));
  const feature=calls.filter(c=>c.id==='feature'),background=calls.filter(c=>c.id==='background');
  expect(feature.length).toBeLessThanOrEqual(121);expect(background.length).toBeGreaterThan(feature.length);
  expect(feature.at(-1).value).not.toEqual(expression);
 });
 it('restores the exact source expression on reversal and never skips an endpoint',()=>{
  const {adapter,calls}=fixture();adapter.apply(sampleEnvironment(.5));adapter.apply(sampleEnvironment(.499));
  adapter.apply(sampleEnvironment(0));expect(calls.filter(c=>c.id==='feature').at(-1).value).toBe(expression);
  adapter.apply(sampleEnvironment(.999));adapter.apply(sampleEnvironment(1));
  expect(calls.filter(c=>c.id==='feature').at(-1).value).not.toEqual(expression);
 });
 it('supports exact forced keyframe verification and preserves source data',()=>{
  const before=JSON.stringify(expression),{adapter,calls}=fixture();
  adapter.apply(sampleEnvironment(.5),true);adapter.apply(sampleEnvironment(.501),true);
  expect(calls.filter(c=>c.id==='feature')).toHaveLength(2);expect(JSON.stringify(expression)).toBe(before);
  adapter.dispose();expect(calls.filter(c=>c.id==='feature'&&c.property==='fill-color').at(-1).value).toBe(expression);
 });
});
