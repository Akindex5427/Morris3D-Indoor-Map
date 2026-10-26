import {describe,it,expect,vi} from 'vitest';
const events=vi.hoisted(()=>[]);
vi.mock('@luma.gl/core',async original=>({...(await original()),
 ClipSpace:class{constructor(_gl,props){this.props=props;events.push('create');}draw(props){events.push(props);}delete(){events.push('delete');}},
 withParameters:(_gl,parameters,fn)=>{events.push(parameters);return fn();},clear:()=>{},
}));
import {EnvironmentDepthEffect} from './environmentDepthEffect';
describe('complete-scene depth resolve',()=>{
 it('bypasses postprocessing at endpoints and picking',()=>{
  events.length=0;const effect=new EnvironmentDepthEffect();
  for(const p of [0,.04,.55,1]){effect.setProps({surfaceNight:p});effect.preRender({},{});expect(effect.postRender).toBeUndefined();}
  effect.setProps({surfaceNight:.02});effect.preRender({},{isPicking:true});expect(effect.postRender).toBeUndefined();expect(events).toEqual([]);
 });
 it('reuses one composite model and existing scene targets through reversal',()=>{
  events.length=0;const effect=new EnvironmentDepthEffect(.02),gl={drawingBufferWidth:800,drawingBufferHeight:600};
  effect.preRender(gl,{});const model=effect.model;effect.pass.render=vi.fn();
  const inputBuffer={color:{}},swapBuffer={color:{}},target={};
  effect.postRender(gl,{inputBuffer,swapBuffer,target,moduleParameters:{other:true}});
  expect(effect.pass.render).toHaveBeenCalledWith(expect.objectContaining({target:swapBuffer,moduleParameters:{other:true,environmentDepthMode:1}}));
  expect(events).toContainEqual(expect.objectContaining({blend:false,depthTest:false}));
  expect(events).toContainEqual({uniforms:{dayImage:inputBuffer.color,nightImage:swapBuffer.color,environmentBlend:.5}});
  for(const p of [.03,.04,.03,.02,.001,0,.02]){effect.setProps({surfaceNight:p});effect.preRender(gl,{});expect(effect.model).toBe(model);}
  expect(events.filter(e=>e==='create')).toHaveLength(1);expect(model.props.fs).not.toMatch(/discard|gl_FragCoord|step\(/);
  effect.cleanup();effect.cleanup();expect(events.filter(e=>e==='delete')).toHaveLength(1);
 });
});
