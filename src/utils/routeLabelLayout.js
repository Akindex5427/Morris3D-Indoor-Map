import { buildPathMetrics } from '../hooks/useRoutePreview';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const area = b => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
const intersection = (a, b) => ({left:Math.max(a.left,b.left),right:Math.min(a.right,b.right),top:Math.max(a.top,b.top),bottom:Math.min(a.bottom,b.bottom)});
const boxAt = (x,y,w,h) => ({left:x-w/2,right:x+w/2,top:y-h/2,bottom:y+h/2});
const endpoint = d => d.type === 'start' || d.type === 'end';
// Screen-space limits affect visibility, never typography. Endpoint pins remain
// visible when a campus-scale view has too little room for readable text.
export const ROUTE_LABEL_LIMITS = Object.freeze({maxLabels:6, corridorPixels:96, areaPerLabel:100000, routePixelsPerLabel:180});
const segmentDistance = (p,a,b) => {
  const dx=b[0]-a[0],dy=b[1]-a[1];
  const t=clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1),0,1);
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
};

// Bound the existing TextLayers to two lines. Full names stay in roomName and
// in the details panel. Explicit line breaks make CPU exclusion boxes reliable.
export function labelTextLayout(name, size) {
  const words=String(name || '').trim().split(/\s+/), lines=[];
  let line='';
  for (let word of words) {
    if (line && line.length + word.length + 1 > 25) { lines.push(line); line=''; }
    while (word.length > 25) { lines.push(word.slice(0,25)); word=word.slice(25); }
    line += (line ? ' ' : '') + word;
  }
  if (line) lines.push(line);
  const shown=lines.slice(0,2);
  if (lines.length > 2) shown[1]=shown[1].slice(0,22)+'...';
  return {labelText:shown.join('\n'),width:Math.max(1,...shown.map(s=>s.length))*size*0.68+12,height:Math.max(1,shown.length)*size*1.2+10};
}

// Route distances use the very same metric as preview playback. This model and
// candidate attachment are built only when source/route identities change.
export function buildLabelRouteModel(path = []) {
  const {cumulative,total}=buildPathMetrics(path), segments=[], turns=[], transitions=[];
  const scale=Math.cos((path[0]?.coords[1] || 0)*Math.PI/180);
  for(let i=1;i<path.length;i++) {
    const a=path[i-1],b=path[i];
    if(Number(a.floor)!==Number(b.floor)) {transitions.push({progress:cumulative[i],from:Number(a.floor),to:Number(b.floor)});continue;}
    const dx=(b.coords[0]-a.coords[0])*scale,dy=b.coords[1]-a.coords[1];
    if(dx===0 && dy===0) continue;
    const s={a,b,dx,dy,start:cumulative[i-1],length:cumulative[i]-cumulative[i-1],floor:Number(a.floor)};
    const prev=segments.at(-1);
    if(prev && prev.floor===s.floor && Math.acos(clamp((prev.dx*dx+prev.dy*dy)/(Math.hypot(prev.dx,prev.dy)*Math.hypot(dx,dy)),-1,1))>Math.PI/6) turns.push(s.start);
    segments.push(s);
  }
  return {path,segments,turns,transitions,total,scale};
}

export function attachRouteLabelProgress(candidates, model) {
  return candidates.map(d=>{
    let best=Infinity,progress=0;
    const p=d.routePosition || d.position;
    for(const s of model.segments) {
      if(Number(d.floor)!==s.floor) continue;
      const x=(p[0]-s.a.coords[0])*model.scale,y=p[1]-s.a.coords[1];
      const t=clamp((x*s.dx+y*s.dy)/(s.dx*s.dx+s.dy*s.dy),0,1);
      const distance=Math.hypot(x-t*s.dx,y-t*s.dy);
      if(distance<best) {best=distance;progress=s.start+t*s.length;}
    }
    return {...d,progress,nearTurn:model.turns.some(t=>Math.abs(t-progress)<6),...labelTextLayout(d.roomName,d.fontSize)};
  });
}

export function layoutRouteLabels({candidates,model,project,width,height,buildingPoints=[],obstructions=[],markers=[],preview=null,previous=null}) {
  const viewport={left:8,top:8,right:width-8,bottom:height-8};
  const valid=p=>p && Number.isFinite(p[0]) && Number.isFinite(p[1]) && (p.length<3 || (p[2]>=-1 && p[2]<=1));
  const points=buildingPoints.map(project).filter(valid);
  const bounds=points.length ? intersection(viewport,{left:Math.min(...points.map(p=>p[0])),right:Math.max(...points.map(p=>p[0])),top:Math.min(...points.map(p=>p[1])),bottom:Math.max(...points.map(p=>p[1]))}) : viewport;
  const freeArea=Math.max(0,area(bounds)-obstructions.reduce((sum,b)=>sum+area(intersection(bounds,b)),0));
  // Route length is clipped to the viewport, so zooming into an offscreen path
  // cannot inflate the budget. Footprint and corridor space must both allow it.
  let routePixels=0;
  const projectedSegments=[];
  for(const s of model.segments) {
    const z=candidates.find(d=>Number(d.floor)===s.floor)?.position[2] || 0;
    const a=project([...s.a.coords,z]),b=project([...s.b.coords,z]);
    if(!valid(a)||!valid(b))continue;
    projectedSegments.push({a,b,floor:s.floor});
    let lo=0,hi=1;
    for(const [p,q] of [[a[0]-b[0],a[0]-8],[b[0]-a[0],width-8-a[0]],[a[1]-b[1],a[1]-8],[b[1]-a[1],height-8-a[1]]]) {
      if(p===0) {if(q<0)hi=-1;} else if(p<0)lo=Math.max(lo,q/p);else hi=Math.min(hi,q/p);
    }
    routePixels+=Math.max(0,hi-lo)*Math.hypot(b[0]-a[0],b[1]-a[1]);
  }
  const capacity=2+Math.min(freeArea/ROUTE_LABEL_LIMITS.areaPerLabel,routePixels/ROUTE_LABEL_LIMITS.routePixelsPerLabel);
  let budget=clamp(Math.floor(capacity),2,ROUTE_LABEL_LIMITS.maxLabels);
  // A small dead band prevents a budget oscillating at a camera threshold.
  if(previous && Math.abs(capacity-previous.budget)<0.2) budget=previous.budget;
  // Two long names can cover an entire distant building. Keep the pins and
  // route, and progressively remove text instead of shrinking the font.
  if(freeArea<32000 || routePixels<100)budget=1;
  if(freeArea<12000 || routePixels<45)budget=0;
  if(!candidates.length)budget=0;
  const old=new Map((previous?.items || []).map(d=>[d.key,d]));
  const progress=Math.floor(preview?.progressMeters || 0),playing=Boolean(preview?.isPlaying);
  const activeFloor=Number(preview?.floor ?? model.path[0]?.floor);
  const next=model.transitions.find(t=>t.progress>=progress-0.5 && t.from===activeFloor);
  const floors=new Set([activeFloor]);
  if(next && (!playing || next.progress-progress<16))floors.add(next.to);
  const exclusions=[...obstructions];
  for(const m of markers) {
    const p=project(m.position);if(!valid(p))continue;
    exclusions.push(boxAt(p[0],p[1]+(m.offsetY||0),m.radius*2,m.radius*2));
  }
  if(preview?.position) {
    const p=project(preview.position);
    if(valid(p))exclusions.push(boxAt(p[0],p[1],(preview.radius || 30)*2,(preview.radius || 30)*2));
  }
  const multipleFloors=new Set(candidates.map(d=>Number(d.floor))).size>1;
  const ranked=candidates.filter(d=>{
    if(endpoint(d))return true;
    if(d.type==='landmark' && (freeArea<90000 || routePixels<240))return false;
    // A large room can touch the route while its interior label is far away.
    // Keep polygon proximity as the geographic gate and also require the
    // displayed anchor to sit near the visible route on the SAME floor.
    if(d.type==='landmark') {
      const p=project(d.position);
      const distance=valid(p)?Math.min(...projectedSegments.filter(s=>s.floor===Number(d.floor)).map(s=>segmentDistance(p,s.a,s.b))):Infinity;
      if(distance>ROUTE_LABEL_LIMITS.corridorPixels+(old.has(d.key)?12:0))return false;
    }
    if(multipleFloors && model.path.length && !floors.has(Number(d.floor)))return false;
    if(playing && preview?.isActive===false)return false;
    if(playing && d.type==='landmark') {
      const margin=old.has(d.key)?4:0;
      return d.progress>=progress-6-margin && d.progress<=progress+24+margin;
    }
    return true;
  }).map(d=>({...d,rank:d.priority+(old.has(d.key)?2:0)+(playing && !endpoint(d) ? (d.type==='connector'?12:0)+(d.nearTurn && d.progress>=progress?8:0)+Math.max(0,6-Math.abs(d.progress-progress)/5):0)}))
    .sort((a,b)=>b.rank-a.rank || a.key.localeCompare(b.key));
  const items=[],boxes=[];
  for(const d of ranked) {
    if(items.length>=budget)break;
    const p=project(d.textPosition || d.position);if(!valid(p))continue;
    // Never drag labels for offscreen rooms back onto the map.
    if(p[0]<0||p[0]>width||p[1]<0||p[1]>height)continue;
    const lift=d.height/2+24;
    const offsets=[old.get(d.key)?.pixelOffset,[0,-lift],[d.width/2+25,0],[-d.width/2-25,0],[0,lift]].filter(Boolean);
    for(const offset of offsets) {
      const box=boxAt(p[0]+offset[0],p[1]+offset[1],d.width,d.height);
      if(box.left<viewport.left||box.right>viewport.right||box.top<viewport.top||box.bottom>viewport.bottom)continue;
      if([...exclusions,...boxes].some(b=>intersects(box,b)))continue;
      boxes.push(box);items.push({...d,pixelOffset:offset,box});break;
    }
  }
  return {items,budget,capacity,routePixels,freeArea,boxes};
}
