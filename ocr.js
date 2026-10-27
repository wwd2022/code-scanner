// OCR 호출과 워커 개수 변경을 같은 대기열에서 처리한다.
let ocrWorkers=[],ocrLane=Promise.resolve();
const reviewSource=document.createElement('canvas');
let reviewSourceArea=null,reviewSourceEpoch=-1;
function clearReviewSource(){
 reviewSource.width=reviewSource.height=1;reviewSourceArea=null;reviewSourceEpoch=-1;
 if(typeof resetReviewSession==='function')resetReviewSession();
}
function runOcrSession(task,isCurrent=()=>true){
 const next=ocrLane.then(()=>{assertOcrCurrent(isCurrent);return task();});
 ocrLane=next.catch(()=>{});
 return next;
}
function assertOcrCurrent(isCurrent){
 if(!isCurrent())throw new DOMException('이전 인식 결과 폐기','AbortError');
}

// 진행 중인 호출이 끝난 뒤에만 워커를 줄인다.
async function trimOcrWorkers(limit){
 while(ocrWorkers.length>limit){
  const entry=ocrWorkers.pop();
  await entry.engine.terminate().catch(()=>{});
 }
}

// 각 워커에 같은 언어·사전·문자 설정을 적용해 재사용한다.
async function prepareOcrWorkers(limit,jobs,isCurrent){
 limit=Math.max(1,Math.min(4,Number(limit)||1));
 if(!window.Tesseract)throw new Error('OCR 라이브러리 로딩 실패. 인터넷 연결 후 새로고침하세요.');
 await trimOcrWorkers(limit);
 const needed=Math.min(limit,jobs);
 let warning='';
 while(ocrWorkers.length<needed){
  assertOcrCurrent(isCurrent);
  const entry={engine:null,psm:'11',progress:null,broken:false};
  let created;
  try{
   created=await Tesseract.createWorker('eng',1,{logger:message=>entry.progress?.(message),errorHandler:()=>{}},{load_system_dawg:'0',load_freq_dawg:'0'});
   await created.setParameters({tessedit_pageseg_mode:'11',tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'});
   entry.engine=created;ocrWorkers.push(entry);
  }catch(error){
   if(created)await created.terminate().catch(()=>{});
   if(!ocrWorkers.length)throw error;
   warning='추가 워커 준비 실패 · '+ocrWorkers.length+'개로 처리';break;
  }
 }
 assertOcrCurrent(isCurrent);
 return {entries:ocrWorkers.slice(0,needed),warning};
}

// 결과 폐기와 실제 작업 완료 대기를 구분한다.
function cancelActiveScan(){
 if(!activeScan||activeScan.cancelled||activeScan.committed)return;
 activeScan.cancelled=true;scanEpoch++;
 cancelScan.disabled=true;
 document.getElementById('optimizeCancel').disabled=true;
 document.getElementById('scanSingleCount').value='취소 요청 · 실행 중 결과 폐기';
 document.querySelectorAll('[data-stage-count]').forEach(output=>{if(output.value==='대기')output.value='대기 취소';});
 status.textContent='대기 작업 제거 · '+(activeScan.running?'실행 중 OCR '+activeScan.running+'개':activeScan.phase)+' 완료 대기 · 결과는 반영하지 않습니다.';
}

// 코드의 표기를 통일한다. (노멀라이즈 코드)
// 공백과 하이픈을 정리해 엑셀 조회에 사용한다.
function normalizeCode(value){
 return String(value??'').trim().replace(/[‐‑‒–—−﹣－]/g,'-').replace(/\s/g,'').toUpperCase();
}

// OCR 문장에서 규격에 맞는 코드와 문자열 위치를 찾는다. (파인드 코즈)
// 코드 박스를 계산할 수 있도록 각 일치의 시작과 끝을 반환한다.
function findCodes(text){
 const normalized=text.replace(/[‐‑‒–—−﹣－~]/g,'-'),matches=[];
 const patterns=[
  {regex:/(?:^|[^A-Za-z0-9])([A-Za-z0-9]{4}[ \t]*-[ \t]*(?:[A-Za-z0-9]{6}|[0-9]{3}[ \t]+[0-9]{3}))(?![A-Za-z0-9])/g,review:false},
  {regex:/(?:^|[^A-Za-z0-9])([0-9]{4}[ \t]*-[ \t]*(?:[0-9]{6}|[0-9]{3}[ \t]+[0-9]{3}))(?=[VvYy](?![A-Za-z0-9]))/g,review:true}
 ];
 for(const {regex,review} of patterns)for(const match of normalized.matchAll(regex)){
  const start=match.index+match[0].length-match[1].length,end=start+match[1].length;
  if(matches.some(item=>item.start===start))continue;
  matches.push({code:normalizeCode(match[1]),start,end,review:review||text.slice(start,end).includes('~')});
 }
 return matches.sort((a,b)=>a.start-b.start);
}

// 화면 전체 OCR에서 코드별 좌표를 구한다. (컬렉트 히츠)
// 같은 코드가 여러 곳에 보여도 각 위치에 박스를 만든다.
function collectHits(data){
 const hits=[];
 for(const block of data.blocks||[])for(const paragraph of block.paragraphs||[])for(const line of paragraph.lines||[]){
  let text='';const spans=[];
  for(const word of line.words||[]){
   if(text)text+=' ';const start=text.length;text+=word.text;
   spans.push({start,end:text.length,word});
  }
  for(const match of findCodes(text)){
   const selected=spans.filter(span=>span.end>match.start&&span.start<match.end);
   const bounds=[],glyphHeights=[];
   for(const span of selected){
    const symbols=span.word.symbols||[];
    if(symbols.length&&symbols.map(symbol=>symbol.text).join('')===span.word.text){
     let offset=span.start;
     for(const symbol of symbols){
      const end=offset+symbol.text.length;
      if(end>match.start&&offset<match.end&&symbol.bbox){
       bounds.push(symbol.bbox);
       if(/^[A-Za-z0-9]$/.test(symbol.text)&&symbol.bbox.y1>symbol.bbox.y0)glyphHeights.push(symbol.bbox.y1-symbol.bbox.y0);
      }
      offset=end;
     }
    }else if(span.word.bbox){
     const b=span.word.bbox,length=span.end-span.start;
     if(b.y1>b.y0)glyphHeights.push(b.y1-b.y0);
     bounds.push({...b,x0:b.x0+(b.x1-b.x0)*Math.max(0,match.start-span.start)/length,x1:b.x0+(b.x1-b.x0)*Math.min(length,match.end-span.start)/length});
    }
   }
   if(!bounds.length)continue;
   glyphHeights.sort((a,b)=>a-b);
   hits.push({code:match.code,review:match.review,glyphHeight:glyphHeights.length?glyphHeights[Math.floor(glyphHeights.length/2)]:Math.max(...bounds.map(b=>b.y1))-Math.min(...bounds.map(b=>b.y0)),confidence:Math.min(...selected.map(span=>span.word.confidence??0)),bbox:{x0:Math.min(...bounds.map(b=>b.x0)),y0:Math.min(...bounds.map(b=>b.y0)),x1:Math.max(...bounds.map(b=>b.x1)),y1:Math.max(...bounds.map(b=>b.y1))}});
  }
 }
 return hits;
}

// 같은 위치에서 읽힌 후보들을 비교한다. (머지 히츠)
// 다른 행은 유지하고 결과가 서로 다르면 확인 표시를 붙인다.
function mergeHits(groups){
 const clusters=[];
 for(const hits of groups)for(const hit of hits){
  const b=hit.bbox;
  const cluster=clusters.find(items=>items.some(existing=>{
   const a=existing.bbox;
   const overlap=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))*Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
   const smaller=Math.min((a.x1-a.x0)*(a.y1-a.y0),(b.x1-b.x0)*(b.y1-b.y0));
   return smaller>0&&overlap/smaller>=0.5;
  }));
  if(cluster)cluster.push(hit);else clusters.push([hit]);
 }
 return clusters.map(items=>{
  const choices=new Map();
  for(const hit of items){
   const previous=choices.get(hit.code);
   if(!previous)choices.set(hit.code,{...hit,votes:1});
   else{
    previous.votes++;previous.review=previous.review&&hit.review;
    if(hit.confidence>previous.confidence){previous.confidence=hit.confidence;previous.bbox=hit.bbox;previous.glyphHeight=hit.glyphHeight;}
   }
  }
  // 같은 보정 영상의 반복 오독이 신뢰도 높은 원본을 밀어내지 않게 한다.
  const ranked=[...choices.values()].sort((a,b)=>((b.confidence||0)+Math.min(b.votes-1,2)*3)-((a.confidence||0)+Math.min(a.votes-1,2)*3));
  const best=ranked[0];
  return {...best,alternatives:ranked.slice(1).map(item=>item.code),review:!!best.review||ranked.length>1||(best.confidence??100)<60};
 }).sort((a,b)=>a.bbox.y0-b.bbox.y0||a.bbox.x0-b.bbox.x0);
}

// 촬영·사진·테스트는 같은 설정과 인식 경로를 사용한다.
async function scanCamera(rescanFrozen=false){
 const reuseCameraFrame=activeTab==='camera'&&frozenMode&&rescanFrozen===true&&originalFrame.width>0;
 if(busy||starting||(activeTab==='camera'&&frozenMode&&!reuseCameraFrame))return;
 if(activeTab==='camera'&&!reuseCameraFrame&&(!stream||camera.readyState<2)){showScanCameraRequired();return;}
 if(activeTab!=='camera'&&!photoReady)return;
 const stages=scanStageInputs.filter(input=>input.checked&&(deepScan.checked||input.dataset.scanStage==='corrected')).map(input=>input.dataset.scanStage);
 if(!stages.length){status.textContent='인식 설정에서 검사 단계를 하나 이상 선택하세요.';return;}
 clearReviewSource();
 const run={epoch:++scanEpoch,cancelled:false,running:0,phase:'화면 준비'};activeScan=run;
 const isCurrent=()=>activeScan===run&&!run.cancelled&&run.epoch===scanEpoch;
 const started=performance.now(),settings=getCorrectionSettings(),preset=performancePreset.value;
 busy=true;showScanStart(stages);
 liveEpoch++;clearTimeout(liveTimer);cancelAnimationFrame(animationId);dots.replaceChildren();
 try{
  const area=activeTab!=='camera'||reuseCameraFrame?getVisiblePhotoRegion():null;
  if(activeTab==='camera'&&!reuseCameraFrame){
   if(!drawCorrected(originalFrame,0,settings.ocrMaxEdge))throw new Error('영상이 아직 준비되지 않았습니다.');
  }else if(activeTab!=='camera'){
   originalFrame.width=photoSource.width;originalFrame.height=photoSource.height;
   originalFrame.getContext('2d').drawImage(photoSource,0,0);
  }
  frame.width=originalFrame.width;frame.height=originalFrame.height;
  frame.getContext('2d').drawImage(originalFrame,0,0);
  if(activeTab==='camera')camera.pause();
  frozenMode=true;detectedHits=[];showScanFrame(!reuseCameraFrame);
  const captureMs=performance.now()-started,waiting=performance.now();
  if(liveJob){run.phase='실시간 OCR';status.textContent='진행 중 실시간 OCR 완료 대기 · 결과 폐기';await liveJob.catch(()=>{});}
  const liveWaitMs=performance.now()-waiting;
  assertOcrCurrent(isCurrent);
  const result=await recognizeCorrected(originalFrame,settings,area,1,(image,pass)=>{
   if(!isCurrent())return;
   reviewSource.width=image.width;reviewSource.height=image.height;
   reviewSource.getContext('2d').drawImage(image,0,0);
   reviewSourceArea={x:pass.x,y:pass.y,width:pass.width,height:pass.height};reviewSourceEpoch=run.epoch;
   if(previewCorrection.checked)frame.getContext('2d').drawImage(image,pass.x,pass.y,pass.width,pass.height);
  },stages,'11',{isCurrent,run});
  assertOcrCurrent(isCurrent);
  appendScanRaw('전체·분리 검사',result.text,false);
  detectedHits=result.hits;
  document.getElementById('scanSingleCount').value=detectedHits.length+'곳 · OCR '+result.attempts+'회'+(result.errors.length?' · 실패 '+result.errors.length+'회':'');
  showScanResults(detectedHits,area,['보정 '+result.correctionResolution+' → 입력 '+result.resolution,...result.stats,result.glyphSummary],((performance.now()-started)/1000).toFixed(1),result.errors.length);
  showPerformanceResult({...result,captureMs,liveWaitMs,totalMs:performance.now()-started,preset,source:activeTab,imageRevision,area});
 }catch(error){
  if(error.name==='AbortError'||!isCurrent()){
   document.getElementById('scanSingleCount').value='취소 · 실행 중 결과 폐기 완료';
   status.textContent='인식 취소 · 실행 중 작업 완료, 결과 폐기';
  }else showScanFailure({message:error.message||String(error)});
 }finally{
  if(activeScan===run){if(run.cancelled)clearReviewSource();activeScan=null;busy=false;showScanEnd();}
 }
}

// 전체와 겹치는 여섯 구역의 좌표를 보정 이미지 기준으로 만든다.
// 선택된 단계만 반환하며 구역 간 여백을 겹쳐 경계의 글자 잘림을 줄인다.
function createOcrRegions(width,height,stages,maxEdge=3200){
 const enabled=new Set(stages||['corrected']),regions=[];
 if(enabled.has('corrected'))regions.push({key:'corrected',name:'전체 보정',x:0,y:0,width,height,scale:1});
 const tw=Math.ceil(width*.5),th=Math.ceil(height*.65);
 for(let row=0;row<2;row++)for(let col=0;col<3;col++){
  const number=row*3+col+1,key='zoom'+number;
  if(!enabled.has(key))continue;
  // 확대 예산을 넘는 구역은 원래 픽셀을 유지한다.
  regions.push({key,name:'확대 '+number,x:Math.round((width-tw)*col/2),y:(height-th)*row,width:tw,height:th,scale:Math.max(1,Math.min(2,Math.min(2000,maxEdge)/Math.max(tw,th)))});
 }
 return regions;
}

// 보정은 한 번만 수행하고 독립 영역을 워커별 큐로 분배한다.
// 활성 호출은 완료를 기다리고 취소된 대기 영역은 실행하지 않는다.
async function recognizeCorrected(source,settings,area=null,scale=1,onPrepared=null,stages=null,psm='11',context={}){
 const epoch=scanEpoch,isCurrent=context.isCurrent||(()=>epoch===scanEpoch),queued=performance.now();
 return runOcrSession(async()=>{
  const queueMs=performance.now()-queued;
  const pass=area?{...area}:{x:0,y:0,width:source.width,height:source.height};
  const maxEdge=settings.ocrMaxEdge||3200;
  pass.scale=Math.min(scale,maxEdge/Math.max(pass.width,pass.height));
  let rendered,entries=[];
  try{
   if(context.run)context.run.phase='이미지 보정';
   if(stages)status.textContent='OCR 입력 보정 중…';
   const prepareStart=performance.now();
   rendered=await renderScanPass(source,pass,settings);
   const prepMs=performance.now()-prepareStart;
   assertOcrCurrent(isCurrent);
   if(onPrepared)onPrepared(rendered.image,pass);
   const smart=settings.extraScanMode==='smart'&&psm==='11'&&stages?.some(key=>key.startsWith('zoom'));
   const enabled=smart?[...new Set(['corrected',...stages])]:stages;
   const regions=createOcrRegions(rendered.image.width,rendered.image.height,enabled,maxEdge);
   const resolution=rendered.image.width+'×'+rendered.image.height;
   if(stages)document.getElementById('ocrInputSize').value='보정 '+rendered.correctionResolution+'px → OCR 기준 '+resolution+'px';
   if(stages){status.textContent='OCR 워커 준비 중…';document.getElementById('accelerationStatus').value='최근 경로: '+rendered.correctionPath;}
   if(context.run)context.run.phase='OCR 워커 준비';
   const workerStart=performance.now();
   const pool=await prepareOcrWorkers(settings.ocrWorkers||1,smart?1:regions.length,isCurrent);entries=pool.entries;
   for(const entry of entries){
    assertOcrCurrent(isCurrent);
    if(entry.psm!==psm){
     try{await entry.engine.setParameters({tessedit_pageseg_mode:psm});entry.psm=psm;}
     catch(error){entry.broken=true;throw error;}
    }
   }
   let workersMs=performance.now()-workerStart;
   const groups=Array(regions.length),texts=Array(regions.length),stageStats=Array(regions.length),errors=[];
   let cursor=0,attempts=0,lastProgress=0,activeJobs=0,peakJobs=0,extraWorkersMs=0,selectionPending=smart;
   let tasks=smart?[0]:regions.map((_,index)=>index),fullData=null,fullHits=[],selectionSummary='';
   const states=regions.map(()=>({state:'waiting',progress:0}));
   const report=(force=false)=>{
    if(!stages||!isCurrent()||(!force&&performance.now()-lastProgress<100))return;
    lastProgress=performance.now();
    const done=states.filter(item=>['done','failed'].includes(item.state)).length;
    const running=states.flatMap((item,i)=>item.state==='running'?[regions[i].name+' '+Math.round(item.progress*100)+'%']:[]);
    const skipped=states.filter(item=>item.state==='skipped').length;
    status.textContent='완료 '+done+'/'+(selectionPending?1:regions.length-skipped)+' · '+running.join(' / ')+' · 대기 '+(selectionPending?Math.max(0,1-cursor):states.filter(item=>item.state==='waiting').length)+(selectionPending?' · 추가 구역 선택 대기':skipped?' · 생략 '+skipped:'');
   };
   const ocrStart=performance.now();
   if(context.run)context.run.phase='영역 OCR';
   const consume=async entry=>{
    while(cursor<tasks.length&&!entry.broken&&isCurrent()){
     const index=tasks[cursor++],region=regions[index];
     let image=rendered.image,launched=false;
     const stageStart=performance.now();
     try{
      if(region.key!=='corrected'){
       image=document.createElement('canvas');
       image.width=Math.max(1,Math.round(region.width*region.scale));image.height=Math.max(1,Math.round(region.height*region.scale));
       image.getContext('2d').drawImage(rendered.image,region.x,region.y,region.width,region.height,0,0,image.width,image.height);
      }
      assertOcrCurrent(isCurrent);
      attempts++;states[index].state='running';launched=true;activeJobs++;peakJobs=Math.max(peakJobs,activeJobs);
      if(context.run)context.run.running++;
      if(stages)showScanStageResult(region,0,false,'처리 중');
      entry.progress=message=>{
       if(message.status==='recognizing text'){
        states[index].progress=Math.max(0,Math.min(1,Number(message.progress)||0));report();
       }
      };
      report(true);
      const {data}=await entry.engine.recognize(image,{}, {text:true,blocks:true});
      assertOcrCurrent(isCurrent);
      const localHits=collectHits(data);
      if(smart&&region.key==='corrected'){fullData=data;fullHits=localHits;}
      const hits=mapScanHits(mapScanHits(localHits,region,image.width/region.width,image.height/region.height),pass,rendered.scaleX,rendered.scaleY);
      groups[index]=hits;texts[index]='['+region.name+']\n'+data.text;
      states[index]={state:'done',progress:1};
      stageStats[index]={...region,width:image.width,height:image.height,count:hits.length,ms:performance.now()-stageStart};
      if(stages)showScanStageResult(region,hits.length,false);
     }catch(error){
      if(!isCurrent()){
       states[index].state='cancelled';
       if(stages)showScanStageResult(region,0,false,'결과 폐기');
      }else{
       states[index].state='failed';entry.broken=true;
       errors.push(region.name+': '+(error.message||String(error)));
       texts[index]='['+region.name+' 실패] '+(error.message||String(error));
       stageStats[index]={...region,width:image.width,height:image.height,count:0,ms:performance.now()-stageStart,failed:true};
       if(stages)showScanStageResult(region,0,true);
      }
     }finally{
      entry.progress=null;
      if(launched){activeJobs--;if(context.run)context.run.running=Math.max(0,context.run.running-1);}
      if(image!==rendered.image)image.width=image.height=1;
      report(true);
     }
     if(entry.broken)break;
    }
   };
   const outcomes=await Promise.allSettled(entries.map(consume));
   if(smart&&isCurrent()){
    if(context.run)context.run.phase='추가 구역 선택';
    const selection=chooseExtraRegions(fullData,fullHits,regions.slice(1),rendered.image.width,rendered.image.height);
    tasks=[];cursor=0;
    for(let i=1;i<regions.length;i++){
     const region=regions[i];region.reason=selection.reasons.get(region.key)||'전체 인식에서 추가 검사 후보 없음';
     if(selection.selected.has(region.key))tasks.push(i);
     else{
      states[i].state='skipped';stageStats[i]={...region,skipped:true,width:0,height:0,count:0,ms:0};
      if(stages)showScanStageResult(region,0,false,'자동 생략');
     }
    }
    selectionSummary='추가 검사 자동 선택 '+tasks.length+'/'+(regions.length-1)+'구역 · '+selection.reason;
    selectionPending=false;
    fullData=null;fullHits=[];
    if(tasks.length){
     if(context.run)context.run.phase='추가 OCR 워커 준비';
     const extraStart=performance.now();
     for(const entry of entries)if(entry.broken){
      ocrWorkers=ocrWorkers.filter(item=>item!==entry);await entry.engine.terminate().catch(()=>{});
     }
     const extra=await prepareOcrWorkers(settings.ocrWorkers||1,tasks.length,isCurrent);
     entries=[...new Set([...entries,...extra.entries])];
     const extraMs=performance.now()-extraStart;workersMs+=extraMs;extraWorkersMs+=extraMs;
     if(extra.warning)pool.warning=extra.warning;
     if(context.run)context.run.phase='추가 영역 OCR';
     outcomes.push(...await Promise.allSettled(extra.entries.map(consume)));
    }
    report(true);
   }
   const ocrMs=performance.now()-ocrStart-extraWorkersMs;
   assertOcrCurrent(isCurrent);
   const rejected=outcomes.find(item=>item.status==='rejected');
   if(rejected)throw rejected.reason;
   for(let i=0;i<regions.length;i++)if(states[i].state==='waiting'){
    errors.push(regions[i].name+': 사용 가능한 워커 없음');
    if(stages)showScanStageResult(regions[i],0,false,'미실행 · 워커 실패');
   }
   if(!groups.some(Boolean))throw new Error(errors.join(' / ')||'검사할 영역이 없습니다.');
   const mergeStart=performance.now(),sized=selectGlyphSizes(mergeHits(groups.filter(Boolean)),settings),hits=sized.hits,mergeMs=performance.now()-mergeStart;
   const completed=stageStats.filter(Boolean);
   return {hits,glyphRange:sized.range,glyphSummary:sized.summary,text:texts.filter(Boolean).join('\n\n'),stats:completed.map(item=>item.skipped?item.name+' 자동 생략':item.name+' '+item.width+'×'+item.height+' · '+item.count+'곳').concat(selectionSummary?[selectionSummary]:[]),errors,attempts,resolution,stageStats:completed,queueMs,prepMs,workersMs,ocrMs,mergeMs,usedWorkers:peakJobs,warning:pool.warning,correctionPath:rendered.correctionPath,correctionResolution:rendered.correctionResolution};
  }finally{
   if(rendered)rendered.image.width=rendered.image.height=1;
   for(const entry of entries){
    entry.progress=null;
    if(!entry.broken&&entry.psm!=='11'){
     try{await entry.engine.setParameters({tessedit_pageseg_mode:'11'});entry.psm='11';}
     catch(error){entry.broken=true;}
    }
    if(entry.broken){
     ocrWorkers=ocrWorkers.filter(item=>item!==entry);
     await entry.engine.terminate().catch(()=>{});
    }
   }
  }
 },isCurrent);
}

// 전체 OCR에 사용한 보정 영상에서 코드 주변을 잘라낸다.
// 원본 좌표를 보정 영상의 크기·검사 영역에 맞춰 변환한다.
function cropReviewRegion(hit){
 if(!reviewSourceArea||reviewSourceEpoch!==scanEpoch)return null;
 const area=reviewSourceArea,scaleX=reviewSource.width/area.width,scaleY=reviewSource.height/area.height;
 const original=hit.bbox;
 const b={x0:(original.x0-area.x)*scaleX,y0:(original.y0-area.y)*scaleY,x1:(original.x1-area.x)*scaleX,y1:(original.y1-area.y)*scaleY};
 const w=b.x1-b.x0,h=b.y1-b.y0;
 const x=Math.max(0,Math.floor(b.x0-Math.max(12,w*.08)));
 const y=Math.max(0,Math.floor(b.y0-Math.max(8,h*.6)));
 const right=Math.min(reviewSource.width,Math.ceil(b.x1+Math.max(12,w*.08)));
 const bottom=Math.min(reviewSource.height,Math.ceil(b.y1+Math.max(8,h*.6)));
 const padding=Math.max(3,Math.round(h*.3)),width=Math.max(1,right-x),height=Math.max(1,bottom-y);
 const image=document.createElement('canvas');image.width=width+padding*2;image.height=height+padding*2;
 const ctx=image.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,image.width,image.height);
 ctx.drawImage(reviewSource,x,y,width,height,padding,padding,width,height);
 return {image,glyphHeight:Math.max(1,(hit.glyphHeight||h/scaleY)*scaleY),centerX:(b.x0+b.x1)/2-x+padding,centerY:(b.y0+b.y1)/2-y+padding};
}

// 잘라낸 코드는 한 줄 모드로 읽은 뒤 전체 인식 모드를 복원한다.
// 대상 중심에 가장 가까운 결과와 해당 후보만 반환한다.
async function recognizeReviewRegion(crop,onPrepared=null){
 const width=crop.image.width,height=crop.image.height;
 const base=getCorrectionSettings();
 const scaleInput=document.getElementById('reviewScale');
 const maxEdge=Math.round(readNumericSetting(document.getElementById('reviewOcrSize'),1800));
 const requestedScale=scaleInput.value.trim()?readNumericSetting(scaleInput,1):Math.max(1,Math.min(4,32/crop.glyphHeight));
 const scale=Math.min(requestedScale,maxEdge/Math.max(width,height));
 // 이미 보정된 픽셀은 확대만 하고 필터를 다시 적용하지 않는다.
 const settings={...base,ocrMaxEdge:maxEdge,correctionMaxEdge:0,mode:'contrast',strength:0,brightness:0,screenNoise:0,removeLines:false,removeSpecks:false,glyphMode:'manual',glyphMin:Math.max(1,crop.glyphHeight*.5),glyphMax:crop.glyphHeight*2};
 const result=await recognizeCorrected(crop.image,settings,null,scale,onPrepared,null,'7');
 const hits=result.hits;
 const distance=hit=>Math.hypot(((hit.bbox.x0+hit.bbox.x1)/2-crop.centerX)/width,((hit.bbox.y0+hit.bbox.y1)/2-crop.centerY)/height);
 hits.sort((a,b)=>distance(a)-distance(b));
 const best=hits[0];
 return {candidates:best?[best.code,...best.alternatives]:[],correctionPath:'전체 OCR 입력 재사용 · 추가 보정 없음'};
}


// 사용자가 실행할 때만 같은 정지 이미지로 설정 조합을 비교한다.
// 워커·가속 경로는 같은 입력의 교차 확인 표로 중복 계산하지 않는다.
function optimizationImageKey(settings,sourceEdge){
 const edge=Math.min(sourceEdge,settings.ocrMaxEdge);
 return JSON.stringify([edge,hasImageCorrection(settings)?Math.min(edge,settings.correctionMaxEdge||edge):edge,
  settings.screenNoise,settings.brightness,settings.strength,settings.mode,
  settings.mode==='print'?[settings.threshold,settings.removeLines]:null,
  settings.removeSpecks?[settings.speckArea,settings.speckThreshold]:null]);
}
function optimizationOverlap(a,b){
 const overlap=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))*Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
 const smaller=Math.min((a.x1-a.x0)*(a.y1-a.y0),(b.x1-b.x0)*(b.y1-b.y0));
 return smaller>0?overlap/smaller:0;
}
function buildOptimizationReference(entries){
 const groups=[];
 for(const entry of entries){
  for(const hit of [...entry.hits].sort((a,b)=>(b.confidence||0)-(a.confidence||0))){
   const nearby=groups.filter(group=>!group.sources.has(entry.key)&&optimizationOverlap(group.bbox,hit.bbox)>=.5);
   nearby.sort((a,b)=>optimizationOverlap(b.bbox,hit.bbox)-optimizationOverlap(a.bbox,hit.bbox));
   let group=nearby[0];
   if(!group){group={bbox:{...hit.bbox},sources:new Set(),votes:new Map(),code:null};groups.push(group);}
   group.sources.add(entry.key);
   if(!hit.review&&(hit.confidence??0)>=60)group.votes.set(hit.code,(group.votes.get(hit.code)||0)+1);
  }
 }
 for(const group of groups){
  const ranked=[...group.votes].sort((a,b)=>b[1]-a[1]);
  const total=ranked.reduce((sum,item)=>sum+item[1],0);
  if(ranked[0]?.[1]>=2&&ranked[0][1]*2>total)group.code=ranked[0][0];
 }
 // 한 조건에서만 나타난 위치는 누락 기준으로 고정하지 않는다.
 return groups.filter(group=>group.sources.size>=2).sort((a,b)=>Number(!!b.code)-Number(!!a.code));
}
function scoreOptimization(hits,reference,expectedCodes){
 const matchedKeys=new Set();
 let matched=0,miss=0,regionMiss=0,conflicts=0;
 if(expectedCodes.length){
  const expected=new Map(),counts=new Map();
  for(const code of expectedCodes)expected.set(code,(expected.get(code)||0)+1);
  for(const hit of hits)counts.set(hit.code,(counts.get(hit.code)||0)+1);
  for(const [code,count] of expected){
   const found=Math.min(count,counts.get(code)||0);matched+=found;miss+=count-found;
   for(let i=0;i<found;i++)matchedKeys.add(code+':'+i);
  }
  for(const [code,count] of counts)conflicts+=Math.max(0,count-(expected.get(code)||0));
 }else{
  const used=new Set();
  for(let i=0;i<reference.length;i++){
   const group=reference[i];
   const nearby=hits.map((hit,index)=>({hit,index,overlap:optimizationOverlap(group.bbox,hit.bbox)})).filter(item=>!used.has(item.index)&&item.overlap>=.5);
   nearby.sort((a,b)=>Number(b.hit.code===group.code&&!b.hit.review)-Number(a.hit.code===group.code&&!a.hit.review)||b.overlap-a.overlap);
   const found=nearby[0];
   if(found)used.add(found.index);
   if(group.code){
    if(found&&found.hit.code===group.code&&!found.hit.review){matched++;matchedKeys.add(i);}
    else miss++;
    if(found&&found.hit.code!==group.code)conflicts++;
   }else if(!found)regionMiss++;
  }
 }
 return {matched,miss,regionMiss,conflicts,review:hits.filter(hit=>hit.review).length,matchedKeys};
}

async function optimizePerformance(){
 if(busy||starting)return;
 const output=document.getElementById('optimizationStatus'),referenceOutput=document.getElementById('optimizationReference');
 const fail=message=>{output.value=message;status.textContent=message;};
 if(activeTab==='camera'&&(!frozenMode||!originalFrame.width)){
  fail('먼저 카메라 화면을 촬영한 뒤 최적화를 실행하세요.');return;
 }
 if(activeTab!=='camera'&&!photoReady){fail('사진 또는 테스트 이미지를 준비하세요.');return;}
 const stages=scanStageInputs.filter(input=>input.checked&&(deepScan.checked||input.dataset.scanStage==='corrected')).map(input=>input.dataset.scanStage);
 if(!stages.length){fail('검사 단계를 하나 이상 선택하세요.');return;}
 const base=getCorrectionSettings(),expectedCodes=activeTab==='test'?[...testExpectedCodes]:[];
 const sourceEdge=activeTab==='camera'?Math.max(originalFrame.width,originalFrame.height):Math.max(photoSource.width,photoSource.height);
 const filters=[],keys=new Set();
 const addFilter=(name,changes={})=>{
  const settings={...base,...changes},key=optimizationImageKey(settings,sourceEdge);
  if(keys.has(key))return;keys.add(key);filters.push({name,settings,key});
 };
 addFilter('현재 설정');
 addFilter('1280px · 현재 필터',{ocrMaxEdge:1280,correctionMaxEdge:1280});
 const neutral={ocrMaxEdge:1280,correctionMaxEdge:1280,mode:'contrast',strength:0,brightness:0,screenNoise:0,removeSpecks:false,removeLines:false};
 addFilter('1280px · 외부 보정 없음',neutral);
 addFilter('1280px · 대비 20%',{...neutral,strength:20});
 for(const value of [8,16,24])addFilter('1280px · 인쇄 농도 '+value,{...neutral,mode:'print',threshold:value,removeLines:base.removeLines});
 addFilter('1280px · 인쇄 농도 16 · 노이즈 20%',{...neutral,mode:'print',threshold:16,removeLines:base.removeLines,screenNoise:20});
 const compareQuality=(a,b)=>a.miss-b.miss||a.regionMiss-b.regionMiss||a.conflicts-b.conflicts||a.review-b.review;
 const previousSourceValid=reviewSourceArea&&reviewSourceEpoch===scanEpoch;
 const run={epoch:++scanEpoch,cancelled:false,running:0,phase:'필터 탐색',optimization:true};activeScan=run;
 const isCurrent=()=>activeScan===run&&!run.cancelled&&scanEpoch===run.epoch;
 const prepared=document.createElement('canvas'),started=performance.now();
 let applied=false,best=null,reference=[],expected=expectedCodes.length,baselineQuality=null;
 busy=true;showScanStart(stages);
 document.getElementById('optimizationPanel').open=true;
 document.getElementById('optimizationConflictLabel').textContent=expectedCodes.length?'추가 오인식':'충돌';
 referenceOutput.value='1/3 · 필터별 인식에서 위치별 비교 기준을 찾는 중';
 const rows=document.getElementById('optimizationRows');rows.replaceChildren();
 liveEpoch++;clearTimeout(liveTimer);cancelAnimationFrame(animationId);
 const showEntry=entry=>{
  const q=entry.quality;
  entry.cells[1].textContent=q?q.matched+'/'+expected:'기준 수집 중';
  entry.cells[2].textContent=q?(q.miss+q.regionMiss)+'곳':'—';
  entry.cells[3].textContent=q?q.conflicts+'곳':'—';
  entry.cells[4].textContent=q?q.review+'곳':entry.hits.filter(hit=>hit.review).length+'곳';
 };
 const evaluate=async(candidate,label,measure=false)=>{
  assertOcrCurrent(isCurrent);
  const row=document.createElement('tr'),cells=[];rows.append(row);
  for(const value of [label+' · '+candidate.name,'준비 중','—','—','—','—']){
   const cell=document.createElement('td');cell.textContent=value;row.append(cell);cells.push(cell);
  }
  try{
   if(measure){
    output.value=label+' · '+candidate.name+' · 준비 인식';
    const warm=await recognizeCorrected(originalFrame,candidate.settings,null,1,null,stages,'11',{isCurrent,run});
    assertOcrCurrent(isCurrent);
    if(warm.errors.length||warm.warning)throw new Error('준비 인식 중 일부 영역 또는 워커 실패');
   }
   output.value=label+' · '+candidate.name+(measure?' · 시간 측정':' · 인식 중');
   const began=performance.now();
   const result=await recognizeCorrected(originalFrame,candidate.settings,null,1,null,stages,'11',{isCurrent,run});
   const ms=performance.now()-began;
   assertOcrCurrent(isCurrent);
   if(result.errors.length||result.warning)throw new Error('일부 영역 또는 워커 준비 실패');
   const entry={candidate,key:candidate.key,hits:result.hits,attempts:result.attempts,ms,row,cells,quality:null};
   cells[0].textContent=label+' · '+candidate.name+' · 보정 '+result.correctionResolution+' → OCR '+result.resolution+' · 실제 '+result.usedWorkers+'워커 · '+result.correctionPath;
   cells[5].textContent=(measure?'측정 ':'탐색 ')+(ms/1000).toFixed(2)+'초';
   if(reference.length||expectedCodes.length)entry.quality=scoreOptimization(entry.hits,reference,expectedCodes);
   showEntry(entry);return entry;
  }catch(error){
   if(!isCurrent())throw error;
   cells[1].textContent='비교 제외';cells[5].textContent=error.message||String(error);return null;
  }
 };
 const preservesBaseline=entry=>[...baselineQuality.matchedKeys].every(key=>entry.quality.matchedKeys.has(key));
 try{
  if(activeTab!=='camera'){
   originalFrame.width=photoSource.width;originalFrame.height=photoSource.height;
   originalFrame.getContext('2d').drawImage(photoSource,0,0);
  }
  setPhotoZoom(1);imageViewport.scrollLeft=imageViewport.scrollTop=0;
  if(liveJob)await liveJob.catch(()=>{});
  const entries=[];
  for(let i=0;i<filters.length;i++){
   const entry=await evaluate(filters[i],'1/3 필터 '+(i+1)+'/'+filters.length);
   if(entry)entries.push(entry);
   else if(i===0)throw new Error('현재 설정의 비교 인식에 실패해 기존 설정을 유지합니다.');
  }
  reference=buildOptimizationReference(entries);
  if(!expectedCodes.length)expected=reference.filter(group=>group.code).length;
  referenceOutput.value=expectedCodes.length?'생성 코드 '+expected+'개 · 오인식 비교 가능':
   '교차 일치 '+expected+'곳 · 미확정 위치 '+reference.filter(group=>!group.code).length+'곳 · 서로 다른 입력 '+entries.length+'개 · 이후 비교 기준 고정';
  if(!expected)throw new Error('서로 다른 조건에서 일치한 코드가 부족합니다. 이미지나 필터를 조정한 뒤 다시 실행하세요. 기존 설정을 유지합니다.');
  for(const entry of entries){entry.quality=scoreOptimization(entry.hits,reference,expectedCodes);showEntry(entry);}
  baselineQuality=entries[0].quality;
  // 같은 품질이면 1280px에 가까운 후보를 먼저 유지하고 속도는 마지막에 비교한다.
  const ordered=entries.filter(preservesBaseline).sort((a,b)=>compareQuality(a.quality,b.quality)||Math.abs(a.candidate.settings.ocrMaxEdge-1280)-Math.abs(b.candidate.settings.ocrMaxEdge-1280));
  let qualityBest=ordered[0];
  if(!qualityBest?.quality.matched)throw new Error('기준 코드를 보존하는 필터를 찾지 못해 기존 설정을 유지합니다.');
  const resolutionBase=qualityBest.candidate;
  const resolutionCandidates=[];
  for(const edge of [960,1920]){
   const settings={...resolutionBase.settings,ocrMaxEdge:edge,correctionMaxEdge:0},key=optimizationImageKey(settings,sourceEdge);
   if(keys.has(key))continue;keys.add(key);
   resolutionCandidates.push({name:resolutionBase.name+' → '+edge+'px · 입력 크기 보정',settings,key});
  }
  for(let i=0;i<resolutionCandidates.length;i++){
   const entry=await evaluate(resolutionCandidates[i],'2/3 해상도 '+(i+1)+'/'+resolutionCandidates.length);
   if(entry&&preservesBaseline(entry)&&compareQuality(entry.quality,qualityBest.quality)<0)qualityBest=entry;
  }
  assertOcrCurrent(isCurrent);
  const targetQuality=qualityBest.quality,speedCandidates=[],speedKeys=new Set();
  const addSpeed=(candidate,count,acceleration)=>{
   const settings={...candidate.settings,ocrWorkers:count,acceleration};
   const key=JSON.stringify([optimizationImageKey(settings,sourceEdge),count,acceleration]);
   if(speedKeys.has(key))return;speedKeys.add(key);
   speedCandidates.push({name:candidate.name+' · '+count+'워커 · '+(acceleration==='auto'?'가속 자동':'CPU'),settings});
  };
  for(const count of qualityBest.attempts>1?[1,2,4]:[1])addSpeed(qualityBest.candidate,count,'auto');
  addSpeed(qualityBest.candidate,qualityBest.attempts>1?2:1,'cpu');
  if(compareQuality(baselineQuality,targetQuality)===0)addSpeed(entries[0].candidate,base.ocrWorkers,base.acceleration);
  for(let i=0;i<speedCandidates.length;i++){
   const entry=await evaluate(speedCandidates[i],'3/3 실행 '+(i+1)+'/'+speedCandidates.length,true);
   if(!entry)continue;
   if(!preservesBaseline(entry)||compareQuality(entry.quality,targetQuality)>0){entry.cells[1].textContent+=' · 품질 미달';continue;}
   if(!best||compareQuality(entry.quality,best.quality)<0||(compareQuality(entry.quality,best.quality)===0&&entry.ms<best.ms))best=entry;
  }
  assertOcrCurrent(isCurrent);
  if(!best)throw new Error('실행 비교에서 인식 결과를 유지하지 못해 기존 설정을 유지합니다.');
  output.value='추천 조합으로 최종 인식 중 · '+best.candidate.name;
  const finalStart=performance.now();
  const result=await recognizeCorrected(originalFrame,best.candidate.settings,null,1,image=>{
   if(!isCurrent())return;
   prepared.width=image.width;prepared.height=image.height;prepared.getContext('2d').drawImage(image,0,0);
  },stages,'11',{isCurrent,run});
  const totalMs=performance.now()-finalStart;
  assertOcrCurrent(isCurrent);
  const finalQuality=scoreOptimization(result.hits,reference,expectedCodes);
  if(result.errors.length||result.warning||!preservesBaseline({quality:finalQuality})||compareQuality(finalQuality,best.quality)>0)throw new Error('최종 인식에서 비교 결과를 유지하지 못해 기존 설정을 유지합니다.');
  run.committed=true;cancelScan.disabled=true;document.getElementById('optimizeCancel').disabled=true;
  const selected=best.candidate.settings;
  ocrSize.value=selected.ocrMaxEdge;workerCount.value=selected.ocrWorkers;
  preprocessAcceleration.value=selected.acceleration;correctionSize.value=selected.correctionMaxEdge;
  printCorrection.checked=selected.mode==='print';
  for(const [input,value] of [[strength,selected.strength],[brightness,selected.brightness],[screenNoise,selected.screenNoise],[threshold,selected.threshold]])input.value=value;
  removeLines.checked=selected.removeLines;removeSpecks.checked=selected.removeSpecks;
  performancePreset.value='custom';syncSettingsDisplay();
  clearReviewSource();reviewSource.width=prepared.width;reviewSource.height=prepared.height;
  reviewSource.getContext('2d').drawImage(prepared,0,0);
  reviewSourceArea={x:0,y:0,width:originalFrame.width,height:originalFrame.height};reviewSourceEpoch=scanEpoch;
  frame.width=originalFrame.width;frame.height=originalFrame.height;
  frame.getContext('2d').drawImage(previewCorrection.checked?prepared:originalFrame,0,0,frame.width,frame.height);
  frozenMode=true;detectedHits=result.hits;showScanFrame();
  appendScanRaw('자동 최적화 추천',result.text,false);
  showScanResults(detectedHits,null,result.stats,(totalMs/1000).toFixed(2),0);
  showPerformanceResult({...result,totalMs,captureMs:0,liveWaitMs:0,preset:'custom',source:activeTab,imageRevision,area:null});
  document.getElementById('scanSingleCount').value=detectedHits.length+'곳 · 추천 설정 적용';
  queueSettingsSave();const saved=saveSettings();applied=true;best.row.classList.add('optimizer-best');
  output.value='추천 적용: '+best.candidate.name+' · 기준 '+finalQuality.matched+'/'+expected+'곳 · 측정 '+(best.ms/1000).toFixed(2)+'초 · 전체 탐색 '+((performance.now()-started)/1000).toFixed(1)+'초';
  status.textContent=saved?'자동 최적화 완료 · 필터·성능 설정 저장':'추천 설정 적용 · 브라우저 저장 실패';
 }catch(error){
  const message=!isCurrent()?'최적화 취소 · 실행 중 작업 완료 후 폐기 · 기존 설정 유지':'최적화 중단: '+(error.message||String(error));
  output.value=message;status.textContent=message;
 }finally{
  prepared.width=prepared.height=1;
  if(!applied&&previousSourceValid)reviewSourceEpoch=scanEpoch;
  await runOcrSession(()=>trimOcrWorkers(Number(workerCount.value))).catch(()=>{});
  if(activeScan===run){activeScan=null;busy=false;showScanEnd();}
 }
}

// 크기는 원본 좌표에서 비교해 분할 확대율의 영향을 받지 않는다.
function selectGlyphSizes(hits,settings){
 const height=hit=>hit.glyphHeight||hit.bbox.y1-hit.bbox.y0;
 let low=settings.glyphMin||4,high=settings.glyphMax||120;
 const manual=settings.glyphMode==='manual';
 if(!manual){
  const reliable=hits.filter(hit=>!hit.review&&hit.confidence>=60);
  const sizes=(reliable.length>=5?reliable:hits).map(height).filter(value=>Number.isFinite(value)&&value>0).sort((a,b)=>a-b);
  if(!sizes.length)return {hits,range:null,summary:'글자 크기 자동 · 기준 코드 없음'};
  const first=sizes.length>=5?sizes[Math.floor((sizes.length-1)*.1)]:sizes[0];
  const last=sizes.length>=5?sizes[Math.ceil((sizes.length-1)*.9)]:sizes[sizes.length-1];
  low=Math.max(1,Math.floor(first*.5));high=Math.min(3200,Math.ceil(last*2));
 }
 const selected=hits.filter(hit=>height(hit)>=low&&height(hit)<=high);
 return {hits:selected,range:{min:low,max:high},summary:'글자 높이 '+(manual?'수동':'자동')+' '+Math.round(low)+'~'+Math.round(high)+'px · 범위 밖 '+(hits.length-selected.length)+'곳 제외'};
}

// 부분 문자열과 불확실 코드의 좌표로 필요한 확대 구역을 고른다.
function chooseExtraRegions(data,hits,regions,width,height){
 const selected=new Set(),reasons=new Map();
 const all=reason=>{
  for(const region of regions){selected.add(region.key);reasons.set(region.key,reason);}
  return {selected,reasons,reason};
 };
 if(!data||!hits.length)return all('전체 인식에서 코드 없음 · 선택 구역 전체 검사');
 const merged=mergeHits([hits]);
 const targets=merged.filter(hit=>hit.review).map(hit=>({...hit.bbox,reason:'불확실 코드'}));
 const patterns=[/(?:^|[^A-Z0-9])([A-Z0-9]{3,5}[ \t]*-[ \t]*[A-Z0-9]{5,8})(?![A-Z0-9])/g,/(?:^|[^A-Z0-9])([A-Z0-9]{4}[ \t]+[A-Z0-9]{6})(?![A-Z0-9])/g];
 for(const block of data.blocks||[])for(const paragraph of block.paragraphs||[])for(const line of paragraph.lines||[]){
  let text='';const spans=[];
  for(const word of line.words||[]){
   if(text)text+=' ';const start=text.length;text+=word.text;spans.push({start,end:text.length,bbox:word.bbox});
  }
  text=text.toUpperCase().replace(/[‐‑‒–—−﹣－~]/g,'-');
  for(const pattern of patterns)for(const match of text.matchAll(pattern)){
   if(merged.some(hit=>hit.code===normalizeCode(match[1])))continue;
   const start=match.index+match[0].length-match[1].length,end=start+match[1].length;
   const boxes=spans.filter(span=>span.end>start&&span.start<end&&span.bbox).map(span=>span.bbox);
   if(boxes.length)targets.push({x0:Math.min(...boxes.map(b=>b.x0)),y0:Math.min(...boxes.map(b=>b.y0)),x1:Math.max(...boxes.map(b=>b.x1)),y1:Math.max(...boxes.map(b=>b.y1)),reason:'코드 일부 인식'});
  }
 }
 for(const target of targets){
  const padding=Math.max(8,(target.y1-target.y0)*.5);
  const b={x0:Math.max(0,target.x0-padding),y0:Math.max(0,target.y0-padding),x1:Math.min(width,target.x1+padding),y1:Math.min(height,target.y1+padding)};
  const area=(b.x1-b.x0)*(b.y1-b.y0);if(area<=0)continue;
  const ranked=regions.map(region=>{
   const overlap=Math.max(0,Math.min(b.x1,region.x+region.width)-Math.max(b.x0,region.x))*Math.max(0,Math.min(b.y1,region.y+region.height)-Math.max(b.y0,region.y));
   const distance=Math.hypot((b.x0+b.x1)/2-region.x-region.width/2,(b.y0+b.y1)/2-region.y-region.height/2);
   return {region,coverage:overlap/area,distance};
  }).sort((a,b)=>b.coverage-a.coverage||a.distance-b.distance);
  const choices=ranked[0]?.coverage>=.95?[ranked[0]]:ranked.filter(item=>item.coverage>0);
  for(const {region} of choices){selected.add(region.key);reasons.set(region.key,target.reason);}
 }
 return {selected,reasons,reason:targets.length?targets.length+'개 후보 영역':'추가 검사 후보 없음'};
}
