import {_LayersPass} from '@deck.gl/core';
import {ClipSpace,Framebuffer,withParameters,clear} from '@luma.gl/core';
import {environmentDepthBlend} from './environmentDepthExtension';

const FRAGMENT_SHADER=`
precision highp float;
uniform sampler2D dayImage;
uniform sampler2D nightImage;
uniform float environmentBlend;
varying vec2 coordinate;
void main() {
  // Framebuffer RGB/alpha already contain the existing scene blending. Mix
  // their stored values and copy without applying alpha a second time.
  gl_FragColor = mix(texture2D(dayImage, coordinate), texture2D(nightImage, coordinate), environmentBlend);
}`;

class EnvironmentScenePass extends _LayersPass {
  shouldDrawLayer(layer){return layer.props.operation.includes('draw')||layer.props.operation.includes('terrain');}
}

// A narrowly scoped depth-state resolve. It uses Deck's two reusable postprocess
// targets only during the existing early handoff. No duplicate layer/mesh/model
// objects, per-frame allocations, shader changes or extra animation clock.
export class EnvironmentDepthEffect {
  id='environment-depth-resolve';
  useInPicking=false;
  constructor(surfaceNight=0){this.props={surfaceNight};this.mix=0;this.composite=this.renderComposite.bind(this);}
  setProps(props){this.props=props;}
  preRender(gl,options){
    this.mix=options.isPicking?0:environmentDepthBlend(this.props.surfaceNight);
    if(this.mix>0&&this.mix<1&&!this.model){
      this.pass=new EnvironmentScenePass(gl,{id:'environment-depth-night'});
      this.model=new ClipSpace(gl,{id:this.id,fs:FRAGMENT_SHADER});
    }
  }
  // At both endpoints Deck renders directly into its usual framebuffer, keeping
  // original MSAA, colors and alpha byte-for-byte. Resources stay cached.
  get postRender(){return this.mix>0&&this.mix<1?this.composite:undefined;}
  getModuleParameters(){return this.mix>0&&this.mix<1?{environmentDepthMode:0}:{};}
  renderComposite(gl,options){
    const {inputBuffer,swapBuffer,target}=options;
    // Only needed if another postprocess effect is appended in the future.
    if(!target&&!this.output)this.output=new Framebuffer(gl,{id:'environment-depth-output'});
    const output=target||this.output;
    if(!target)output.resize();
    withParameters(gl,{},()=>{
      this.pass.render({...options,target:swapBuffer,pass:'environment-depth-night',clearCanvas:true,
        moduleParameters:{...options.moduleParameters,environmentDepthMode:1}});
      withParameters(gl,{framebuffer:output,viewport:[0,0,gl.drawingBufferWidth,gl.drawingBufferHeight],
        blend:false,depthTest:false,depthMask:false,scissorTest:false},()=>{
        clear(gl,{color:[0,0,0,0]});
        this.model.draw({uniforms:{dayImage:inputBuffer.color,nightImage:swapBuffer.color,environmentBlend:this.mix}});
      });
    });
    return output;
  }
  cleanup(){this.model?.delete();this.output?.delete();this.pass?.cleanup();this.model=null;this.pass=null;this.output=null;}
}
