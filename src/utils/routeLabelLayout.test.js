import {describe,it,expect} from 'vitest';
import {buildLabelRouteModel,attachRouteLabelProgress,layoutRouteLabels,labelTextLayout,intersects} from './routeLabelLayout';
const path=[{coords:[100,300],floor:1},{coords:[900,300],floor:1}];
const model=buildLabelRouteModel(path);
const candidates=Array.from({length:12},(_,i)=>({key:`F1:${i}`,id:`F1:${i}`,roomName:'Room',floor:1,type:i===0?'start':i===11?'end':'landmark',priority:i===0?100:i===11?110:40,fontSize:12,position:[100+i*70,250+(i%2)*100,0],progress:i*8,...labelTextLayout('Room',12)}));
const base={candidates,model,project:p=>p,width:1000,height:700,buildingPoints:[[30,30,0],[970,670,0]],markers:[]};
describe('responsive route label layout',()=>{
  it('reduces density, not typography, with the projected building',()=>{
    const large=layoutRouteLabels(base),small=layoutRouteLabels({...base,buildingPoints:[[400,250,0],[600,450,0]]});
    expect(large.budget).toBeGreaterThan(small.budget);expect(small.budget).toBe(2);
    expect(small.items.every(d=>d.fontSize===12)).toBe(true);expect(small.items.map(d=>d.type).sort()).toEqual(['end','start']);
  });
  it('never exceeds six labels or the calculated budget',()=>{const r=layoutRouteLabels(base);expect(r.items.length).toBeLessThanOrEqual(r.budget);expect(r.budget).toBeLessThanOrEqual(6);});
  it('removes text at campus scale instead of covering a tiny building',()=>{
    expect(layoutRouteLabels({...base,buildingPoints:[[450,300,0],[550,400,0]]}).items).toEqual([]);
    const compact=layoutRouteLabels({...base,buildingPoints:[[420,280,0],[580,420,0]]});
    expect(compact.budget).toBe(1);expect(compact.items.map(d=>d.type)).toEqual(['end']);
  });
  it('rejects distant interior anchors even when their room touches the route',()=>{
    const far={...candidates[1],position:[300,500,0]};
    expect(layoutRouteLabels({...base,candidates:[far]}).items).toEqual([]);
    expect(layoutRouteLabels({...base,candidates:[{...far,position:[300,370,0]}]}).items).toHaveLength(1);
  });
  it('uses same-floor route geometry and a bounded screen-space hysteresis',()=>{
    const near={...candidates[1],position:[300,390,0]};
    const first=layoutRouteLabels({...base,candidates:[near]});
    expect(first.items).toHaveLength(1);
    const args={...base,candidates:[{...near,position:[300,402,0]}]};
    expect(layoutRouteLabels(args).items).toHaveLength(0);
    expect(layoutRouteLabels({...args,previous:first}).items).toHaveLength(1);
    expect(layoutRouteLabels({...base,candidates:[{...near,floor:2}]}).items).toHaveLength(0);
  });
  it('avoids controls, other labels and endpoint/connector markers',()=>{
    const obstruction={left:750,right:1000,top:0,bottom:700};
    const r=layoutRouteLabels({...base,obstructions:[obstruction],markers:[{position:[100,220,0],radius:30}]});
    r.items.forEach((d,i)=>{expect(intersects(d.box,obstruction)).toBe(false);expect(intersects(d.box,{left:70,right:130,top:190,bottom:250})).toBe(false);r.items.slice(i+1).forEach(e=>expect(intersects(d.box,e.box)).toBe(false));});
  });
  it('preserves distinct rooms with identical names',()=>{const r=layoutRouteLabels(base);expect(new Set(r.items.map(d=>d.id)).size).toBe(r.items.length);expect(r.items.length).toBeGreaterThan(2);});
  it('playing windows prioritize nearby/upcoming labels; pausing restores the overview',()=>{
    const playing=layoutRouteLabels({...base,preview:{isPlaying:true,progressMeters:30,floor:1}});
    expect(playing.items.filter(d=>d.type==='landmark').every(d=>d.progress>=24&&d.progress<=54)).toBe(true);
    const paused=layoutRouteLabels({...base,preview:{isPlaying:false,progressMeters:30,floor:1}});
    expect(paused.items.some(d=>d.type==='landmark'&&(d.progress<24||d.progress>54))).toBe(true);
  });
  it('retains a 4m visibility margin without admitting new distant labels',()=>{
    const c={...candidates[3],progress:24},args={...base,candidates:[c],preview:{isPlaying:true,progressMeters:0,floor:1}};
    const first=layoutRouteLabels(args);
    expect(first.items).toHaveLength(1);
    const changed={...args,candidates:[{...c,progress:27}]};
    expect(layoutRouteLabels(changed).items).toHaveLength(0);
    expect(layoutRouteLabels({...changed,previous:first}).items).toHaveLength(1);
  });
  it('limits stacked secondary labels to active and imminent transition floors',()=>{
    const m={...model,transitions:[{progress:15,from:1,to:2},{progress:50,from:2,to:3}]};
    const cs=candidates.slice(1,5).map((d,i)=>({...d,floor:i+1,type:'connector'}));
    const r=layoutRouteLabels({...base,candidates:cs,model:m,preview:{isPlaying:true,progressMeters:2,floor:1}});
    expect(r.items.map(d=>d.floor).sort()).toEqual([1,2]);
  });
  it('keeps inactive playing timeline panels free of secondary labels',()=>expect(layoutRouteLabels({...base,preview:{isPlaying:true,isActive:false,floor:1}}).items.every(d=>['start','end'].includes(d.type))).toBe(true));
  it('can select late-floor candidates from a pool larger than the display budget',()=>{
    const pool=Array.from({length:8},(_,floor)=>candidates.map((d,i)=>({...d,key:`F${floor}:${i}`,floor,type:'landmark'}))).flat();
    const r=layoutRouteLabels({...base,candidates:pool,model:{...model,segments:model.segments.map(s=>({...s,floor:7}))},preview:{isPlaying:true,progressMeters:20,floor:7}});
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.every(d=>d.floor===7)).toBe(true);
    expect(r.items.length).toBeLessThanOrEqual(12);
  });
  it('clearing the route clears every label',()=>expect(layoutRouteLabels({...base,candidates:[]}).items).toEqual([]));
  it('bounds long names and preserves their full identity separately',()=>{const text=labelTextLayout('Extremely long department '.repeat(12),12);expect(text.labelText.split('\n')).toHaveLength(2);expect(text.labelText.endsWith('...')).toBe(true);expect(text.width).toBeLessThan(220);});
  it('caches candidate route progress separately from layout and detects turns',()=>{
    const m=buildLabelRouteModel([{coords:[0,0],floor:0},{coords:[0.001,0],floor:0},{coords:[0.001,0.001],floor:0},{coords:[0.001,0.001],floor:1},{coords:[0.002,0.001],floor:1}]);
    expect(m.turns).toHaveLength(1);expect(m.transitions).toHaveLength(1);
    const d=attachRouteLabelProgress([{...candidates[0],floor:1,position:[0.0015,0.001,0]}],m)[0];
    expect(d.progress).toBeCloseTo(277.99,1);
  });
});
