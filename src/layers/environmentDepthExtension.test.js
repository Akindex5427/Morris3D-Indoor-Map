import {describe,it,expect,vi} from 'vitest';
const calls=vi.hoisted(()=>[]);
vi.mock('@luma.gl/core',async original=>({...(await original()),setParameters:(_gl,p)=>calls.push(p)}));
import {EnvironmentDepthExtension,environmentDepthState,environmentDepthBlend} from './environmentDepthExtension';
describe('continuous depth without fragment rejection',()=>{
 it('preserves reversible early-handoff timing',()=>{
  const forward=[0,.001,.01,.02,.03,.04,.55,1].map(environmentDepthBlend);
  expect(forward[0]).toBe(0);expect(forward[3]).toBe(.5);expect(forward.slice(5)).toEqual([1,1,1]);
  expect([1,.55,.04,.03,.02,.01,.001,0].map(environmentDepthBlend)).toEqual([...forward].reverse());
 });
 it('uses complete surfaces in each explicit scene depth state',()=>{
  for(const p of [0,.001,.02,.04,.55,1]){
   expect(environmentDepthState(p,false,0)).toEqual({depthMask:true,night:false});
   expect(environmentDepthState(p,false,1)).toEqual({depthMask:false,night:true});
  }
  expect(environmentDepthState(0)).toEqual({depthMask:true,night:false});expect(environmentDepthState(1)).toEqual({depthMask:false,night:true});
 });
 it('keeps picking solid and depth-tested in either scene mode',()=>{
  for(const p of [0,.3,.8,1])for(const mode of [undefined,0,1])expect(environmentDepthState(p,true,mode)).toEqual({depthMask:true,night:false});
 });
 it('retains models and geometry without extra layer draws',()=>{
  calls.length=0;const geometry={},models=[],draw=vi.fn();
  const layer={context:{gl:{}},props:{environmentDepthProgress:.02,environmentNightBlendFunc:[770,771,1,771]},getModels:()=>models,state:{geometry},draw};
  EnvironmentDepthExtension.prototype.draw.call(layer,{moduleParameters:{environmentDepthMode:0}});
  EnvironmentDepthExtension.prototype.draw.call(layer,{moduleParameters:{environmentDepthMode:1}});
  expect(calls).toEqual([{depthMask:true},{depthMask:false,blendFunc:[770,771,1,771]}]);
  expect(draw).not.toHaveBeenCalled();expect(layer.state.geometry).toBe(geometry);expect(layer.getModels()).toBe(models);
 });
 it('restores daylight without a stale blend override or fragment shader injection',()=>{
  calls.length=0;const layer={context:{gl:{}},props:{environmentDepthProgress:0,environmentNightBlendFunc:[770,771,1,771]}};
  EnvironmentDepthExtension.prototype.draw.call(layer,{moduleParameters:{}});expect(calls).toEqual([{depthMask:true}]);
  expect(new EnvironmentDepthExtension().getShaders()).toBeNull();
 });
});
