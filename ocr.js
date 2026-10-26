// OCR 호출과 워커 개수 변경을 같은 대기열에서 처리한다.
let ocrWorkers=[],ocrLane=Promise.resolve();
const reviewSource=document.createElement('canvas');
let reviewSourceArea=null,reviewSourceEpoch=-1;
function clearReviewSource(){
 reviewSource.width=reviewSource.height=1;reviewSourceArea=null;reviewSourceEpoch=-1;
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
   const bounds=[];
   for(const span of selected){
    const symbols=span.word.symbols||[];
    if(symbols.length&&symbols.map(symbol=>symbol.text).join('')===span.word.text){
     let offset=span.start;
     for(const symbol of symbols){
      const end=offset+symbol.text.length;
      if(end>match.start&&offset<match.end&&symbol.bbox)bounds.push(symbol.bbox);
      offset=end;
     }
    }else if(span.word.bbox){
     const b=span.word.bbox,length=span.end-span.start;
     bounds.push({...b,x0:b.x0+(b.x1-b.x0)*Math.max(0,match.start-span.start)/length,x1:b.x0+(b.x1-b.x0)*Math.min(length,match.end-span.start)/length});
    }
   }
   if(!bounds.length)continue;
   hits.push({code:match.code,review:match.review,confidence:Math.min(...selected.map(span=>span.word.confidence??0)),bbox:{x0:Math.min(...bounds.map(b=>b.x0)),y0:Math.min(...bounds.map(b=>b.y0)),x1:Math.max(...bounds.map(b=>b.x1)),y1:Math.max(...bounds.map(b=>b.y1))}});
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
    if(hit.confidence>previous.confidence){previous.confidence=hit.confidence;previous.bbox=hit.bbox;}
   }
  }
  // 같은 보정 영상의 반복 오독이 신뢰도 높은 원본을 밀어내지 않게 한다.
  const ranked=[...choices.values()].sort((a,b)=>((b.confidence||0)+Math.min(b.votes-1,2)*3)-((a.confidence||0)+Math.min(a.votes-1,2)*3));
  const best=ranked[0];
  return {...best,alternatives:ranked.slice(1).map(item=>item.code),review:!!best.review||ranked.length>1||(best.confidence??100)<60};
 }).sort((a,b)=>a.bbox.y0-b.bbox.y0||a.bbox.x0-b.bbox.x0);
}

// 촬영·사진·테스트는 같은 설정과 인식 경로를 사용한다.
async function scanCamera(){
 if(busy||starting||(activeTab==='camera'&&frozenMode))return;
 if(activeTab==='camera'&&(!stream||camera.readyState<2)){showScanCameraRequired();return;}
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
  if(activeTab==='camera'){
   if(!drawCorrected(originalFrame,0,settings.ocrMaxEdge))throw new Error('영상이 아직 준비되지 않았습니다.');
  }else{
   originalFrame.width=photoSource.width;originalFrame.height=photoSource.height;
   originalFrame.getContext('2d').drawImage(photoSource,0,0);
  }
  frame.width=originalFrame.width;frame.height=originalFrame.height;
  frame.getContext('2d').drawImage(originalFrame,0,0);
  if(activeTab==='camera')camera.pause();
  frozenMode=true;detectedHits=[];showScanFrame();
  const captureMs=performance.now()-started,waiting=performance.now();
  if(liveJob){run.phase='실시간 OCR';status.textContent='진행 중 실시간 OCR 완료 대기 · 결과 폐기';await liveJob.catch(()=>{});}
  const liveWaitMs=performance.now()-waiting;
  assertOcrCurrent(isCurrent);
  const area=activeTab==='camera'?null:getVisiblePhotoRegion();
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
  showScanResults(detectedHits,area,['보정 '+result.correctionResolution+' → 입력 '+result.resolution,...result.stats],((performance.now()-started)/1000).toFixed(1),result.errors.length);
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
   const regions=createOcrRegions(rendered.image.width,rendered.image.height,stages,maxEdge);
   const resolution=rendered.image.width+'×'+rendered.image.height;
   if(stages)document.getElementById('ocrInputSize').value='보정 '+rendered.correctionResolution+'px → OCR 기준 '+resolution+'px';
   if(stages){status.textContent='OCR 워커 준비 중…';document.getElementById('accelerationStatus').value='최근 경로: '+rendered.correctionPath;}
   if(context.run)context.run.phase='OCR 워커 준비';
   const workerStart=performance.now();
   const pool=await prepareOcrWorkers(settings.ocrWorkers||1,regions.length,isCurrent);entries=pool.entries;
   for(const entry of entries){
    assertOcrCurrent(isCurrent);
    if(entry.psm!==psm){
     try{await entry.engine.setParameters({tessedit_pageseg_mode:psm});entry.psm=psm;}
     catch(error){entry.broken=true;throw error;}
    }
   }
   const workersMs=performance.now()-workerStart;
   const groups=Array(regions.length),texts=Array(regions.length),stageStats=Array(regions.length),errors=[];
   let cursor=0,attempts=0,lastProgress=0;
   const states=regions.map(()=>({state:'waiting',progress:0}));
   const report=(force=false)=>{
    if(!stages||!isCurrent()||(!force&&performance.now()-lastProgress<100))return;
    lastProgress=performance.now();
    const done=states.filter(item=>['done','failed'].includes(item.state)).length;
    const running=states.flatMap((item,i)=>item.state==='running'?[regions[i].name+' '+Math.round(item.progress*100)+'%']:[]);
    status.textContent='완료 '+done+'/'+regions.length+' · '+running.join(' / ')+' · 대기 '+states.filter(item=>item.state==='waiting').length;
   };
   const ocrStart=performance.now();
   if(context.run)context.run.phase='영역 OCR';
   const consume=async entry=>{
    while(cursor<regions.length&&isCurrent()){
     const index=cursor++,region=regions[index];
     let image=rendered.image;
     const stageStart=performance.now();
     try{
      if(region.key!=='corrected'){
       image=document.createElement('canvas');
       image.width=Math.max(1,Math.round(region.width*region.scale));image.height=Math.max(1,Math.round(region.height*region.scale));
       image.getContext('2d').drawImage(rendered.image,region.x,region.y,region.width,region.height,0,0,image.width,image.height);
      }
      assertOcrCurrent(isCurrent);
      attempts++;states[index].state='running';
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
      const hits=mapScanHits(mapScanHits(collectHits(data),region,image.width/region.width,image.height/region.height),pass,rendered.scaleX,rendered.scaleY);
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
      if(context.run&&states[index].state!=='waiting')context.run.running=Math.max(0,context.run.running-1);
      if(image!==rendered.image)image.width=image.height=1;
      report(true);
     }
     if(entry.broken)break;
    }
   };
   const outcomes=await Promise.allSettled(entries.map(consume));
   const ocrMs=performance.now()-ocrStart;
   assertOcrCurrent(isCurrent);
   const rejected=outcomes.find(item=>item.status==='rejected');
   if(rejected)throw rejected.reason;
   for(let i=0;i<regions.length;i++)if(states[i].state==='waiting'){
    errors.push(regions[i].name+': 사용 가능한 워커 없음');
    if(stages)showScanStageResult(regions[i],0,false,'미실행 · 워커 실패');
   }
   if(!groups.some(Boolean))throw new Error(errors.join(' / ')||'검사할 영역이 없습니다.');
   const mergeStart=performance.now(),hits=mergeHits(groups.filter(Boolean)),mergeMs=performance.now()-mergeStart;
   const completed=stageStats.filter(Boolean);
   return {hits,text:texts.filter(Boolean).join('\n\n'),stats:completed.map(item=>item.name+' '+item.width+'×'+item.height+' · '+item.count+'곳'),errors,attempts,resolution,stageStats:completed,queueMs,prepMs,workersMs,ocrMs,mergeMs,usedWorkers:entries.length,warning:pool.warning,correctionPath:rendered.correctionPath,correctionResolution:rendered.correctionResolution};
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
 return {image,glyphHeight:Math.max(1,h),centerX:(b.x0+b.x1)/2-x+padding,centerY:(b.y0+b.y1)/2-y+padding};
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
 const settings={...base,ocrMaxEdge:maxEdge,correctionMaxEdge:0,mode:'contrast',strength:0,brightness:0,screenNoise:0,removeLines:false,removeSpecks:false};
 const result=await recognizeCorrected(crop.image,settings,null,scale,onPrepared,null,'7');
 const hits=result.hits;
 const distance=hit=>Math.hypot(((hit.bbox.x0+hit.bbox.x1)/2-crop.centerX)/width,((hit.bbox.y0+hit.bbox.y1)/2-crop.centerY)/height);
 hits.sort((a,b)=>distance(a)-distance(b));
 const best=hits[0];
 return {candidates:best?[best.code,...best.alternatives]:[],correctionPath:'전체 OCR 입력 재사용 · 추가 보정 없음'};
}


// 사용자가 실행할 때만 같은 정지 이미지로 설정 조합을 비교한다.
async function optimizePerformance(){
 if(busy||starting)return;
 const output=document.getElementById('optimizationStatus');
 const fail=message=>{output.value=message;status.textContent=message;};
 if(activeTab==='camera'&&(!frozenMode||!originalFrame.width||!detectedHits.length)){
  fail('먼저 카메라 화면을 인식한 뒤 최적화를 실행하세요.');return;
 }
 if(activeTab!=='camera'&&!photoReady){fail('사진 또는 테스트 이미지를 준비하세요.');return;}
 const stages=scanStageInputs.filter(input=>input.checked&&(deepScan.checked||input.dataset.scanStage==='corrected')).map(input=>input.dataset.scanStage);
 if(!stages.length){fail('검사 단계를 하나 이상 선택하세요.');return;}
 const typed=document.getElementById('optimizerExpected').value.trim();
 const reference=new Map();
 let known=false,referenceLabel='기존의 확실한 인식 코드';
 let codes=[];
 if(typed){
  codes=typed.split(/[\s,;]+/).map(normalizeCode);
  if(codes.some(code=>!/^[A-Z0-9]{4}-[A-Z0-9]{6}$/.test(code))){fail('기준 코드를 4자리-6자리 형식으로 입력하세요.');return;}
  known=true;referenceLabel='직접 입력한 기준 코드';
 }else if(activeTab==='test'&&testExpectedCodes.length){codes=[...testExpectedCodes];known=true;referenceLabel='테스트 이미지의 생성 코드';}
 else codes=detectedHits.filter(hit=>!hit.review).map(hit=>hit.code);
 for(const code of codes)reference.set(code,(reference.get(code)||0)+1);
 if(!reference.size){fail('확실한 기준 코드가 없습니다. 먼저 인식하거나 기준 코드를 입력하세요.');return;}
 const strictExpected=activeTab==='test'&&!typed&&testExpectedCodes.length>0;
 const expected=codes.length,base=getCorrectionSettings();
 const candidates=[],keys=new Set();
 const sourceEdge=activeTab==='camera'?Math.max(originalFrame.width,originalFrame.height):Math.max(photoSource.width,photoSource.height);
 const add=(name,changes={})=>{
  const settings={...base,...changes};
  const effectiveEdge=Math.min(settings.ocrMaxEdge,sourceEdge);
  const key=JSON.stringify([effectiveEdge,settings.ocrWorkers,settings.acceleration,Math.min(settings.correctionMaxEdge||effectiveEdge,effectiveEdge)]);
  if(keys.has(key))return;keys.add(key);
  candidates.push({name,settings});
 };
 add('현재 설정');
 for(const count of [1,2,4])add('1280px · '+count+'워커 · 가속 자동',{ocrMaxEdge:1280,ocrWorkers:count,acceleration:'auto'});
 add('1280px · 2워커 · CPU',{ocrMaxEdge:1280,ocrWorkers:2,acceleration:'cpu'});
 add('960px · 2워커 · 가속 자동',{ocrMaxEdge:960,ocrWorkers:2,acceleration:'auto'});
 add('1920px · 2워커 · 가속 자동',{ocrMaxEdge:1920,ocrWorkers:2,acceleration:'auto'});
 add('1280px · 2워커 · 입력 크기 보정',{ocrMaxEdge:1280,ocrWorkers:2,acceleration:'auto',correctionMaxEdge:0});
 const score=result=>{
  const counts=new Map(),allCounts=new Map();
  for(const hit of result.hits){
   allCounts.set(hit.code,(allCounts.get(hit.code)||0)+1);
   if(known||!hit.review)counts.set(hit.code,(counts.get(hit.code)||0)+1);
  }
  let matched=0,extra=0;
  for(const [code,count] of reference)matched+=Math.min(count,counts.get(code)||0);
  if(strictExpected)for(const [code,count] of allCounts)extra+=Math.max(0,count-(reference.get(code)||0));
  return {matched,miss:expected-matched,extra:strictExpected?extra:null,review:result.hits.filter(hit=>hit.review).length};
 };
 const originalQuality=score({hits:detectedHits});
 const compareQuality=(a,b)=>a.miss-b.miss||(a.extra||0)-(b.extra||0)||a.review-b.review;
 const previousSourceValid=reviewSourceArea&&reviewSourceEpoch===scanEpoch;
 const run={epoch:++scanEpoch,cancelled:false,running:0,phase:'최적화 준비',optimization:true};activeScan=run;
 const isCurrent=()=>activeScan===run&&!run.cancelled&&scanEpoch===run.epoch;
 const prepared=document.createElement('canvas');
 const started=performance.now();
 let applied=false,best=null;
 busy=true;showScanStart(stages);
 document.getElementById('optimizationPanel').open=true;
 const rows=document.getElementById('optimizationRows');rows.replaceChildren();
 liveEpoch++;clearTimeout(liveTimer);cancelAnimationFrame(animationId);
 try{
  if(activeTab!=='camera'){
   originalFrame.width=photoSource.width;originalFrame.height=photoSource.height;
   originalFrame.getContext('2d').drawImage(photoSource,0,0);
  }
  setPhotoZoom(1);imageViewport.scrollLeft=imageViewport.scrollTop=0;
  if(liveJob)await liveJob.catch(()=>{});
  assertOcrCurrent(isCurrent);
  for(let i=0;i<candidates.length;i++){
   assertOcrCurrent(isCurrent);
   const candidate=candidates[i],row=document.createElement('tr');rows.append(row);
   const rowCells=[];
   for(const value of [candidate.name,'준비 중','—','—','—']){
    const cell=document.createElement('td');cell.textContent=value;row.append(cell);rowCells.push(cell);
   }
   const prefix=(i+1)+'/'+candidates.length+' · '+candidate.name;
   try{
    output.value=prefix+' · 준비 인식 중 · 기준: '+referenceLabel+' '+expected+'개';
    await recognizeCorrected(originalFrame,candidate.settings,null,1,null,stages,'11',{isCurrent,run});
    assertOcrCurrent(isCurrent);
    output.value=prefix+' · 시간 측정 중';
    const measured=performance.now();
    const result=await recognizeCorrected(originalFrame,candidate.settings,null,1,null,stages,'11',{isCurrent,run});
    const ms=performance.now()-measured;
    assertOcrCurrent(isCurrent);
    if(result.errors.length||result.warning)throw new Error('일부 영역 또는 워커 준비 실패');
    const quality=score(result);
    rowCells[0].textContent=candidate.name+' · 입력 '+result.resolution+' · 실제 '+result.usedWorkers+'워커 · '+result.correctionPath;
    rowCells[1].textContent=quality.matched+'/'+expected;
    rowCells[2].textContent=strictExpected?quality.extra+'개':'정답 미상';
    rowCells[3].textContent=quality.review+'개';rowCells[4].textContent=(ms/1000).toFixed(2)+'초';
    const entry={candidate,quality,ms,row};
    if(!best||compareQuality(quality,best.quality)<0||(compareQuality(quality,best.quality)===0&&ms<best.ms))best=entry;
   }catch(error){
    if(!isCurrent())throw error;
    rowCells[1].textContent='비교 제외';rowCells[4].textContent=error.message||String(error);
   }
  }
  assertOcrCurrent(isCurrent);
  if(!best||!best.quality.matched)throw new Error('기준 코드를 인식하는 조합을 찾지 못해 기존 설정을 유지합니다.');
  if(compareQuality(best.quality,originalQuality)>0)throw new Error('기존 인식 결과를 유지하는 조합이 없어 설정을 유지합니다.');
  output.value='추천 조합으로 최종 인식 중 · '+best.candidate.name;
  const finalStart=performance.now();
  const result=await recognizeCorrected(originalFrame,best.candidate.settings,null,1,image=>{
   if(!isCurrent())return;
   prepared.width=image.width;prepared.height=image.height;prepared.getContext('2d').drawImage(image,0,0);
  },stages,'11',{isCurrent,run});
  const totalMs=performance.now()-finalStart;
  assertOcrCurrent(isCurrent);
  if(result.errors.length||compareQuality(score(result),best.quality)>0)throw new Error('최종 인식에서 비교 결과를 유지하지 못해 기존 설정을 유지합니다.');
  run.committed=true;cancelScan.disabled=true;document.getElementById('optimizeCancel').disabled=true;
  const selected=best.candidate.settings;
  ocrSize.value=selected.ocrMaxEdge;workerCount.value=selected.ocrWorkers;
  preprocessAcceleration.value=selected.acceleration;correctionSize.value=selected.correctionMaxEdge;
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
  output.value='추천 적용: '+best.candidate.name+' · 기준 '+best.quality.matched+'/'+expected+'개 · 비교 측정 '+(best.ms/1000).toFixed(2)+'초 · 전체 비교 '+((performance.now()-started)/1000).toFixed(1)+'초';
  status.textContent=saved?'자동 최적화 완료 · 추천 설정 저장':'추천 설정 적용 · 브라우저 저장 실패';
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
