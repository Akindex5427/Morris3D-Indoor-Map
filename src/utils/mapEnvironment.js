import { mixValue } from './environment';

// Paint only: no setStyle, sources, layers, camera, or feature-state writes.
// Parse the CSS forms used by streets-v12/outdoors-v12. Unknown forms are retained.
export function parseStyleColor(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  const names = {white:'#ffffff', black:'#000000', transparent:'#00000000'};
  if (names[v]) return parseStyleColor(names[v]);
  if (/^#[\da-f]{3,4}$/.test(v)) return parseStyleColor('#' + [...v.slice(1)].map(c => c+c).join(''));
  if (/^#[\da-f]{6}([\da-f]{2})?$/.test(v)) return [1,3,5].map(i => parseInt(v.slice(i,i+2),16)).concat(v.length === 9 ? parseInt(v.slice(7),16)/255 : 1);
  const match = v.match(/^(rgba?|hsla?)\(([^)]+)\)$/);
  if (!match) return null;
  const fields = match[2].split(/[\s,\/]+/).filter(Boolean);
  const values = fields.map(Number.parseFloat);
  if (values.length < 3 || values.some(n => !Number.isFinite(n))) return null;
  const alpha = values.length > 3 ? values[3] / (fields[3].includes('%') ? 100 : 1) : 1;
  if (match[1].startsWith('rgb')) return values.slice(0,3).map((n,i) => fields[i].includes('%') ? n*2.55 : n).concat(alpha);
  const h = ((values[0]%360)+360)%360/60, s=values[1]/100, l=values[2]/100;
  const c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs(h%2-1)), m=l-c/2;
  const rgb = h<1?[c,x,0]:h<2?[x,c,0]:h<3?[0,c,x]:h<4?[0,x,c]:h<5?[x,0,c]:[c,0,x];
  return rgb.map(n => (n+m)*255).concat(alpha);
}
const css = c => `rgba(${c.slice(0,3).map(v=>Math.round(v)).join(',')},${c[3] ?? 1})`;
// Mapbox rebuilds tile paint buffers/atlases when a feature-dependent color
// expression changes (native transitions do not interpolate these expressions).
// Budget these updates separately: at most ~15Hz on the 8-second timeline.
// Uniform colors, fog and light keep the existing ~30Hz cadence. Endpoints and
// forced samples are exact; original expressions and category semantics remain.
export const FEATURE_COLOR_PROGRESS_STEP = 1 / 120;
export function isFeatureColorExpression(value) {
  if (!Array.isArray(value) || value[0] === 'literal') return false;
  if (['get','has','feature-state','properties','id','geometry-type','line-progress','heatmap-density','accumulated'].includes(value[0])) return true;
  return value.slice(1).some(isFeatureColorExpression);
}
function tint(color, environment, property, id) {
  const l = color[0]*.2126 + color[1]*.7152 + color[2]*.0722;
  const text = property === 'text-color' || property === 'icon-color';
  const halo = property.includes('halo');
  const water = /water|ocean/i.test(id);
  const night = text ? [164,177,194] : halo ? [14,21,31] : water ? [11,24,37] : [12+l*.13,16+l*.14,23+l*.15];
  const golden = mixValue(color.slice(0,3), [Math.min(255,l+34),l*.88,l*.66], .4);
  const blue = mixValue(color.slice(0,3), text?[179,194,216]:[l*.28,l*.36,l*.52], .85);
  const palette = [color.slice(0,3),golden,blue,night];
  const rgb = [0,1,2].map(channel => palette.reduce((sum, c, i) =>
    sum + c[channel] * environment.basemapWeights[i], 0));
  return css([...rgb,color[3]]);
}

// Visit output positions only: match labels, get keys and zoom stops are not colors.
// Preserve zoom at the top level (wrapping zoom expressions is invalid in Mapbox).
export function transformColorExpression(value, transform) {
  const parsed = parseStyleColor(value);
  if (parsed) return transform(parsed);
  if (!Array.isArray(value)) return value;
  const out = value.slice(), op = value[0];
  let indices = [];
  if (op === 'interpolate' || op === 'interpolate-hcl' || op === 'interpolate-lab') {
    for(let i=4;i<value.length;i+=2) indices.push(i);
  } else if (op === 'step') {
    indices=[2]; for(let i=4;i<value.length;i+=2) indices.push(i);
  } else if (op === 'match' || op === 'case') {
    for(let i=op==='match'?3:2;i<value.length-1;i+=2) indices.push(i);
    indices.push(value.length-1);
  } else if (op === 'coalesce') indices=value.slice(1).map((_,i)=>i+1);
  // Dynamic get/to-color/rgb expressions and style imports retain their authored appearance.
  for(const i of indices) out[i]=transformColorExpression(value[i],transform);
  return out;
}

export function createMapEnvironmentAdapter(map) {
  let paints=[], originalFog=null, originalLight=null, current=null, disposed=false;
  const diagnostics={paintProperties:0, featurePaintProperties:0, unsupported:[], failures:[]};
  const safe = (label, fn) => { try { fn(); } catch { if(!diagnostics.failures.includes(label)) diagnostics.failures.push(label); } };
  function capture() {
    const style=map.getStyle();
    if (!style) return;
    paints=[];
    diagnostics.unsupported=[];
    for(const layer of style.layers || []) {
      const source=style.sources?.[layer.source];
      // Exclude application-owned GeoJSON/custom layers, including future overlays.
      if (layer.type!=='background' && !source?.url?.startsWith('mapbox://')) continue;
      for(const [property,value] of Object.entries(layer.paint || {})) {
        if (!property.endsWith('-color')) continue;
        let supported=false;
        transformColorExpression(value,c=>{supported=true;return css(c);});
        if (!supported) {diagnostics.unsupported.push(`${layer.id}:${property}`);continue;}
        paints.push({id:layer.id,property,value,featureDependent:isFeatureColorExpression(value),lastProgress:null,transition:layer.paint[`${property}-transition`]});
        safe(property,()=>map.setPaintProperty(layer.id,`${property}-transition`,{duration:0,delay:0}));
      }
    }
    diagnostics.paintProperties=paints.length;
    diagnostics.featurePaintProperties=paints.filter(p=>p.featureDependent).length;
    originalFog=map.getFog?.() || null;
    originalLight=map.getLight?.() || null;
    if(current) apply(current,true);
  }
  function apply(environment, force=false) {
    if(disposed) return;
    // Paint validation is CPU work; cap it at ~30Hz without quantizing the shared clock.
    if(!force && current && environment.progress!==0 && environment.progress!==1 &&
      Math.abs(environment.progress-current.progress)<1/240) return;
    current=environment;
    const p=environment.progress;
    for(const paint of paints) {
      const {id,property,value,featureDependent,lastProgress}=paint;
      if(!map.getLayer(id)) continue;
      if(featureDependent && !force && p!==0 && p!==1 && lastProgress!==null && Math.abs(p-lastProgress)<FEATURE_COLOR_PROGRESS_STEP) continue;
      safe(`${id}:${property}`,()=>map.setPaintProperty(id,property,p===0?value:
        transformColorExpression(value,c=>tint(c,environment,property,id))));
      paint.lastProgress=p;
    }
    safe('fog',()=>map.setFog?.(p===0 ? originalFog : {
      range:originalFog?.range || [.5,10], 'horizon-blend':.12,
      color:css([...environment.sky,p]), 'high-color':css([...environment.sky,p]),
      'space-color':css([...environment.sky,1]), 'star-intensity':Math.max(0,(p-.7)/.3)*.45,
      'color-transition':{duration:0}, 'high-color-transition':{duration:0},
      'space-color-transition':{duration:0}, 'star-intensity-transition':{duration:0},
    }));
    safe('light',()=>map.setLight?.(p===0 ? originalLight : {
      anchor:'map', color:css([...environment.sunColor,1]), intensity:.5*environment.sun,
      position:[1.15,210-110*p,30+55*p],
      'color-transition':{duration:0},'intensity-transition':{duration:0},'position-transition':{duration:0},
    }));
  }
  map.on('style.load',capture);
  if(map.isStyleLoaded()) capture();
  return {apply,diagnostics,dispose(){
    disposed=true;map.off('style.load',capture);
    // App unmount owns map disposal; restore paint if the adapter is independently replaced.
    for(const {id,property,value,transition} of paints) if(map.getLayer(id)) safe(property,()=>{
      map.setPaintProperty(id,property,value);
      map.setPaintProperty(id,`${property}-transition`,transition || null);
    });
    safe('restore fog',()=>map.setFog?.(originalFog));
    if(originalLight) safe('restore light',()=>map.setLight?.(originalLight));
  }};
}
