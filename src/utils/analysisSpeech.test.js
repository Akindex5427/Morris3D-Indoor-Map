import { afterEach, expect, it, vi } from "vitest";
import { createAnalysisSpeech } from "./analysisSpeech";
const players=[];
afterEach(()=>{players.forEach(p=>p.dispose());players.length=0;vi.useRealTimers();});
function setup(options={}) {
  const states=[], events={};
  const synthesis={getVoices:()=>[{localService:true,lang:"en-US",name:"Device voice",default:true}],
    speak:vi.fn(),cancel:vi.fn(),paused:false,
    pause(){this.paused=true;},resume(){this.paused=false;},
    addEventListener:(name,fn)=>events[name]=fn,removeEventListener:vi.fn(),...options};
  const player=createAnalysisSpeech({synthesis,Utterance:class{constructor(text){this.text=text;}},onChange:state=>states.push(state)});
  players.push(player);
  return {player,synthesis,states,events,utterance:()=>synthesis.speak.mock.calls.at(-1)?.[0]};
}
it("is user initiated and supports pause, resume, replay, and stop",()=>{
  const {player,synthesis,states,utterance}=setup();
  expect(synthesis.speak).not.toHaveBeenCalled();
  player.play("Exact summary");const first=utterance();expect(first.text).toBe("Exact summary");first.onstart();
  player.pause();expect(states.at(-1).status).toBe("paused");
  player.resume();expect(states.at(-1).status).toBe("speaking");
  player.play("Exact summary");expect(synthesis.cancel).toHaveBeenCalledTimes(1);
  player.stop();expect(synthesis.cancel).toHaveBeenCalledTimes(2);expect(states.at(-1).status).toBe("idle");
});
it("cancels old narration across instances and ignores late callbacks",()=>{
  const a=setup(),b=setup();a.player.play("Previous room");const late=a.utterance().onend;
  b.player.play("New room");expect(a.synthesis.cancel).toHaveBeenCalledTimes(1);
  const count=a.states.length;late();expect(a.states.length).toBe(count);
  b.player.dispose();expect(b.synthesis.cancel).toHaveBeenCalledTimes(1);
  expect(b.synthesis.removeEventListener).toHaveBeenCalledWith("voiceschanged",expect.any(Function));
});
it("does not send text to remote voices and recovers when local voices arrive",()=>{
  const f=setup({getVoices:()=>[{localService:false,lang:"en-US"}]});
  f.player.play("Building details");expect(f.synthesis.speak).not.toHaveBeenCalled();expect(f.states.at(-1).status).toBe("unavailable");
  f.synthesis.getVoices=()=>[{localService:true,lang:"en-GB"}];f.events.voiceschanged();
  expect(f.states.at(-1).status).toBe("idle");expect(f.synthesis.speak).not.toHaveBeenCalled();
  f.player.play("Building details");expect(f.utterance().voice.localService).toBe(true);
});
it("reports unsupported APIs, playback errors, and engines that never start",()=>{
  vi.useFakeTimers();
  const states=[];const unsupported=createAnalysisSpeech({onChange:s=>states.push(s)});players.push(unsupported);
  expect(states.at(-1).status).toBe("unavailable");
  const f=setup();f.player.play("Test");f.utterance().onerror({error:"audio-busy"});
  expect(f.states.at(-1).message).toContain("audio-busy");
  f.player.play("Test");vi.advanceTimersByTime(8000);
  expect(f.states.at(-1).message).toContain("did not start");
});
it("cleans up rapid play/stop cycles and does not advertise absent pause APIs",()=>{
  vi.useFakeTimers();const f=setup({pause:undefined,resume:undefined});
  for(let i=0;i<20;i++){f.player.play("Room "+i);f.player.stop();}
  expect(f.synthesis.cancel).toHaveBeenCalledTimes(20);expect(vi.getTimerCount()).toBe(0);
  expect(f.states.at(-1).canPause).toBe(false);
});
