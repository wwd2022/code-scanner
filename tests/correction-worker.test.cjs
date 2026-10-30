const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../image.js'),'utf8');
function harness(mode){
 const warnings=[],timers=new Map(),workers=[];let now=0,timerId=0;
 class FakeWorker{
  constructor(){if(mode==='construct')throw new Error('worker blocked');workers.push(this);}
  terminate(){this.terminated=true;}
  postMessage(message){
   if(mode==='transfer')throw new Error('transfer failed');
   if(mode==='stall')return;
   if(mode==='runtime'){this.onerror({message:'worker crashed',preventDefault(){}});return;}
   if(mode==='messageerror'){this.onmessageerror({message:'message decode failed',preventDefault(){}});return;}
   if(mode==='filter'){this.onmessage({data:{id:message.id,error:'filter failed'}});return;}
   this.onmessage({data:{id:message.id,buffer:message.buffer,path:'CPU 보정 워커'}});
  }
 }
 const context={Uint8ClampedArray,Map,console:{warn:(...args)=>warnings.push(args),error:(...args)=>warnings.push(args)},Date:{now:()=>now},setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),ImageData:class{constructor(data,width,height){Object.assign(this,{data,width,height});}}};
 if(mode!=='unsupported')context.Worker=FakeWorker;
 vm.createContext(context);vm.runInContext(source,context);
 let puts=0;const canvas={width:1,height:1,getContext:()=>({getImageData:()=>({width:1,height:1,data:new Uint8ClampedArray([50,50,50,255])}),putImageData(){puts++;}})};
 return {context,canvas,warnings,workers,timers,puts:()=>puts,advance:ms=>now+=ms,mode:value=>mode=value};
}
const settings={brightness:10,strength:0,mode:'none',screenNoise:0,removeSpecks:false};
test('worker success cleans request timers and preserves primary path',async()=>{
 const h=harness('success');assert.equal(await h.context.correctCanvas(h.canvas,settings),'CPU 보정 워커');assert.equal(h.puts(),1);assert.equal(h.timers.size,0);assert.equal(h.warnings.length,0);
});
for(const [mode,reason] of [['construct','worker blocked'],['transfer','transfer failed'],['runtime','worker crashed'],['messageerror','message decode failed'],['filter','filter failed']])test(mode+' failure exposes cause, falls back, then recovers',async()=>{
 const h=harness(mode);const path=await h.context.correctCanvas(h.canvas,settings);assert.ok(path.includes(reason),path);assert.equal(h.puts(),1);assert.ok(h.warnings.length);assert.equal(h.timers.size,0);
 const diagnostic=h.context.getCorrectionWorkerDiagnostic();assert.equal(diagnostic.reason,reason);
 h.advance(6000);h.mode('success');assert.equal(await h.context.correctCanvas(h.canvas,settings),'CPU 보정 워커');assert.equal(h.context.getCorrectionWorkerDiagnostic().reason,'');
});
test('missing Worker uses explicit unsupported fallback',async()=>{
 const h=harness('unsupported');const path=await h.context.correctCanvas(h.canvas,settings);assert.ok(path.includes('미지원'),path);assert.equal(h.warnings.length,0);assert.equal(h.puts(),1);
});
test('stalled worker times out, terminates and clears every request',async()=>{
 const h=harness('stall');const job=h.context.correctCanvas(h.canvas,settings);assert.equal(h.timers.size,1);[...h.timers.values()][0]();const path=await job;assert.ok(path.includes('시간 초과'),path);assert.equal(h.workers[0].terminated,true);assert.equal(h.timers.size,0);assert.equal(h.puts(),1);
});
test('explicit release rejects pending request without leaking timer',async()=>{
 const h=harness('stall');const job=h.context.correctCanvas(h.canvas,settings);h.context.releaseCorrectionWorker();const path=await job;assert.ok(path.includes('종료'),path);assert.equal(h.timers.size,0);
});
test('one timeout settles concurrent requests and ignores late retired worker responses',async()=>{
 const h=harness('stall');const first=h.context.correctCanvas(h.canvas,settings),second=h.context.correctCanvas(h.canvas,settings);assert.equal(h.timers.size,2);
 const retired=h.workers[0];[...h.timers.values()][0]();const paths=await Promise.all([first,second]);assert.ok(paths.every(path=>path.includes('시간 초과')));assert.equal(h.timers.size,0);
 h.advance(6000);const retry=h.context.correctCanvas(h.canvas,settings);assert.equal(h.timers.size,1);
 retired.onmessage({data:{id:3,buffer:new ArrayBuffer(4),path:'stale'}});assert.equal(h.timers.size,1);
 h.workers[1].onmessage({data:{id:3,buffer:new ArrayBuffer(4),path:'CPU 보정 워커'}});assert.equal(await retry,'CPU 보정 워커');assert.equal(h.timers.size,0);
});
