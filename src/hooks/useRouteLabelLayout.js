import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WebMercatorViewport } from '@deck.gl/core';
import { attachRouteLabelProgress, buildLabelRouteModel, layoutRouteLabels } from '../utils/routeLabelLayout';

const EMPTY = Object.freeze([]);
const UI = '.overlap-map-note, .map-camera-controls, .room-color-legend, .sidebar-toggle, .mobile-drawer-toggle, .left-panel, .drawer-backdrop, .directions-sidebar, .app-header, .help-button, .room-info-popup-floating, .directions-sidebar-badge, .room-load-status, .mapboxgl-ctrl-bottom-right, .mapboxgl-ctrl-bottom-left';

export function useRouteLabelLayout({containerRef,deckRef,viewState,candidates,path,buildingPoints,markers,preview,layoutSignal}) {
  const [screen,setScreen]=useState({width:1,height:1,obstructions:EMPTY});
  const [renderedView,setRenderedView]=useState(null);
  const frame=useRef(null),lastView=useRef(''),previous=useRef(null);
  const hasLabels=useRef(false);
  hasLabels.current=candidates.length>0;
  // Read the actual interpolated Deck camera, not a FlyTo destination. At most
  // 10 layout passes/sec during motion; no perpetual render loop is introduced.
  const onAfterRender=useCallback(()=>{
    if(!hasLabels.current)return;
    if(frame.current!==null)return;
    const v=deckRef.current?.deck?.getViewports()?.[0];
    if(!v)return;
    const key=[v.longitude,v.latitude,v.zoom,v.pitch,v.bearing,v.width,v.height].join(',');
    if(key===lastView.current)return;
    frame.current=window.setTimeout(()=>{
      frame.current=null;
      const actual=deckRef.current?.deck?.getViewports()?.[0];
      if(!actual)return;
      lastView.current=[actual.longitude,actual.latitude,actual.zoom,actual.pitch,actual.bearing,actual.width,actual.height].join(',');
      setRenderedView(actual);
    },100);
  },[deckRef]);
  useEffect(()=>()=>window.clearTimeout(frame.current),[]);
  useEffect(()=>{
    const node=containerRef.current;if(!node)return;
    let pending;
    const measure=()=>{
      const r=node.getBoundingClientRect();
      const obstructions=[...document.querySelectorAll(UI)].filter(el=>{const style=getComputedStyle(el);return el!==node && style.visibility!=='hidden' && Number(style.opacity)>0.1;}).map(el=>el.getBoundingClientRect())
        .filter(b=>b.width>0&&b.height>0&&b.right>r.left&&b.left<r.right&&b.bottom>r.top&&b.top<r.bottom)
        .map(b=>({left:b.left-r.left-6,right:b.right-r.left+6,top:b.top-r.top-6,bottom:b.bottom-r.top+6}));
      const next={width:r.width,height:r.height,obstructions};
      setScreen(old=>JSON.stringify(old)===JSON.stringify(next)?old:next);
    };
    const schedule=()=>{cancelAnimationFrame(pending);pending=requestAnimationFrame(measure);};
    const observer=new ResizeObserver(schedule);observer.observe(node);
    document.querySelectorAll(UI).forEach(el=>observer.observe(el));
    const mutation=new MutationObserver(schedule);mutation.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','aria-hidden']});
    window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);
    document.addEventListener('transitionend',schedule);measure();
    return()=>{observer.disconnect();mutation.disconnect();cancelAnimationFrame(pending);window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);document.removeEventListener('transitionend',schedule);};
  },[containerRef,layoutSignal]);
  const model=useMemo(()=>buildLabelRouteModel(path || EMPTY),[path]);
  const prepared=useMemo(()=>attachRouteLabelProgress(candidates,model),[candidates,model]);
  const viewport=useMemo(()=>renderedView || new WebMercatorViewport({...viewState,width:Math.max(1,screen.width),height:Math.max(1,screen.height)}),[renderedView,viewState,screen.width,screen.height]);
  const progress=Math.floor(preview?.progressMeters || 0);
  // Cursor and label decorations use screen pixels. Sample its position in 4px
  // cells; reserve the fixed 18px halo plus 6px clearance at every zoom/pitch.
  const cursor=preview?.position ? viewport.project(preview.position):null;
  const cursorKey=cursor ? `${Math.round(cursor[0]/4)},${Math.round(cursor[1]/4)}`:'';
  const result=useMemo(()=>{
    const radius=24;
    const old=previous.current?.prepared===prepared ? previous.current.result:null;
    const next=layoutRouteLabels({candidates:prepared,model,project:p=>viewport.project(p),width:screen.width,height:screen.height,
      buildingPoints,obstructions:screen.obstructions,markers,preview:preview?{...preview,radius}:null,previous:old});
    // Keep layer data identity when a preview tick changes no accepted labels.
    if(old && JSON.stringify(old.items.map(d=>[d.key,d.pixelOffset]))===JSON.stringify(next.items.map(d=>[d.key,d.pixelOffset])))next.items=old.items;
    previous.current={prepared,result:next};return next;
    // Geographic work is outside this memo. Preview objects are intentionally
    // represented by their quantized progress/cursor and playback state.
  },[prepared,model,viewport,screen,buildingPoints,markers,progress,cursorKey,preview?.isPlaying,preview?.isActive,preview?.floor,Boolean(preview)]);
  const groups=useMemo(()=>({focus:result.items.filter(d=>d.group==='focus'),landmarks:result.items.filter(d=>d.group==='landmarks'),connectors:result.items.filter(d=>d.group==='connectors'),transitions:result.items.filter(d=>d.group==='transitions')}),[result.items]);
  return {...result,...groups,onAfterRender};
}
