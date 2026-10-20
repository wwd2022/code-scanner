// OCR 엔진을 한 번 준비해 공유한다. (겟 워커)
// 실시간 검사와 터치 인식을 같은 엔진에서 순서대로 처리한다.
async function getWorker(){
 if(worker)return worker;
 if(!workerPromise)workerPromise=(async()=>{
  if(!window.Tesseract)throw new Error('OCR 라이브러리 로딩 실패. 인터넷 연결 후 새로고침하세요.');
  const created=await Tesseract.createWorker('eng',1,{logger:message=>{
   if(busy&&frozenMode&&message.status==='recognizing text')status.textContent=recognitionStage+' 코드 인식 중… '+Math.round(message.progress*100)+'%';
  }});
  try{await created.setParameters({tessedit_pageseg_mode:'11'});}
  catch(error){await created.terminate();throw error;}
  worker=created;return created;
 })();
 try{return await workerPromise;}finally{workerPromise=null;}
}

// 확대 OCR에 사용할 보조 워커를 최대 두 개 준비한다. (겟 패러렐 워커스)
// 기존 실시간 워커는 유지하며 보조 워커 생성 실패 시 순차 인식으로 돌아간다.
let parallelWorkers=[],parallelPromise=null;
async function getParallelWorkers(){
 if(parallelWorkers.length)return parallelWorkers;
 if(!parallelPromise)parallelPromise=(async()=>{
  const created=[];
  try{
   for(let i=0;i<2;i++){
    const engine=await Tesseract.createWorker('eng',1);
    await engine.setParameters({tessedit_pageseg_mode:'11'});
    created.push(engine);
   }
   parallelWorkers=created;return created;
  }catch(error){
   await Promise.all(created.map(engine=>engine.terminate().catch(()=>{})));
   return [];
  }
 })();
 try{return await parallelPromise;}finally{parallelPromise=null;}
}

// 원본과 보정본을 독립 워커에서 병렬 검사한다. (런 패러렐 패시스)
// 검사별 결과를 원래 순서로 반환하고 캔버스를 사용 후 해제한다.
async function runParallelPasses(passes,settings,source,onResult){
 const engines=await getParallelWorkers();
 const results=new Array(passes.length),count=engines.length||1;
 let next=0;
 async function consume(index){
  const engine=engines[index]||await getWorker();
  while(next<passes.length){
   const i=next++,pass=passes[i];
   let rendered;
   try{
    rendered=renderScanPass(source,pass,settings);
    const {data}=await engine.recognize(rendered.image,{}, {text:true,blocks:true});
    const hits=mapScanHits(collectHits(data),pass,rendered.scaleX,rendered.scaleY);
    results[i]={hits,text:data.text};
   }catch(error){results[i]={hits:[],error:error.message};}
   finally{if(rendered)rendered.image.width=rendered.image.height=1;}
   if(onResult)onResult(i,results[i]);
  }
 }
 await Promise.all(Array.from({length:Math.min(count,passes.length)},(_,i)=>consume(i)));
 return results;
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

// 카메라 또는 선택한 이미지의 원본과 보정본을 읽는다. (스캔 카메라)
// 확대 사진에서는 보이는 부분만 검사하고 박스는 원본 위치에 표시한다.
async function scanCamera(){
 if(busy||starting||(activeTab==='camera'&&frozenMode))return;
 if(activeTab==='camera'&&(!stream||camera.readyState<2)){status.textContent='카메라를 켠 다음 코드 인식 시작을 누르세요.';return;}
 if(activeTab!=='camera'&&!photoReady)return;
 busy=true;lockInputs(true);excel.disabled=true;sheet.disabled=true;resume.disabled=true;strength.disabled=true;liveCanvas.setAttribute('aria-busy','true');
 raw.textContent='';scanStats.textContent='';status.textContent='원본·보정본 인식을 준비합니다…';
 const started=performance.now();
 const settings={mode:filterMode.value,brightness:Number(brightness.value),threshold:Number(threshold.value),removeLines:removeLines.checked,deep:deepScan.checked,strength:Number(strength.value)};
 try{
  if(activeTab==='camera'){
   if(!drawCorrected(originalFrame,0))throw new Error('영상이 아직 준비되지 않았습니다.');
  }else{
   originalFrame.width=photoSource.width;originalFrame.height=photoSource.height;
   originalFrame.getContext('2d').drawImage(photoSource,0,0);
  }
  frame.width=originalFrame.width;frame.height=originalFrame.height;
  const ctx=frame.getContext('2d',{willReadFrequently:true});ctx.drawImage(originalFrame,0,0);
  // 정지 화면도 카메라 미리보기와 같은 대비 강도로 표시한다.
  if(activeTab==='camera'&&Number(strength.value)){
   const pixels=ctx.getImageData(0,0,frame.width,frame.height);
   applyFilter(pixels.data,Number(strength.value));ctx.putImageData(pixels,0,0);
  }
  if(activeTab==='camera')camera.pause();frozenMode=true;liveEpoch++;clearTimeout(liveTimer);cancelAnimationFrame(animationId);dots.replaceChildren();
  imageViewport.classList.toggle('camera-shot',activeTab==='camera');
  liveView.hidden=true;imageViewport.hidden=false;frozen.hidden=false;zoomLevel.hidden=activeTab==='camera';zoomHint.hidden=activeTab==='camera';detectedHits=[];boxes.replaceChildren();liveStatus.textContent='정지 화면 · 인식 결과를 확인하세요.';
  if(liveJob)await liveJob.catch(()=>{});
  const area=activeTab==='camera'?null:getVisiblePhotoRegion();
  let scanSource=originalFrame;
  if(area){
   scanSource=document.createElement('canvas');scanSource.width=area.width;scanSource.height=area.height;
   scanSource.getContext('2d').drawImage(originalFrame,area.x,area.y,area.width,area.height,0,0,area.width,area.height);
  }
  const passes=createScanPasses(scanSource.width,scanSource.height,settings);
  const groups=[],stats=[],errors=[];
  // 확대 검사도 같은 최대 2개 워커 풀을 사용한다.
  const results=await runParallelPasses(passes,settings,scanSource);
  if(area)scanSource.width=scanSource.height=1;
  for(let i=0;i<results.length;i++){
   const pass=passes[i],result=results[i];
   if(result.error){errors.push(pass.name+': '+result.error);raw.textContent+='['+pass.name+' 실패] '+result.error+'\\n\\n';continue;}
   groups.push(area?result.hits.map(hit=>({...hit,bbox:{x0:hit.bbox.x0+area.x,y0:hit.bbox.y0+area.y,x1:hit.bbox.x1+area.x,y1:hit.bbox.y1+area.y}})):result.hits);
   stats.push(pass.name+' '+result.hits.length+'곳');
   raw.textContent+='['+pass.name+']\\n'+result.text+'\\n\\n';
  }
  if(!groups.length)throw new Error(errors.join(' / '));
  detectedHits=mergeHits(groups);showBoxes(detectedHits);
  const seconds=((performance.now()-started)/1000).toFixed(1);
  scanStats.textContent=(area?'확대 영역 · ':'전체 이미지 · ')+stats.join(' · ')+' → 합계 '+detectedHits.length+'곳 · '+seconds+'초'+(errors.length?' · 일부 검사 실패':'');
  status.textContent=detectedHits.length?detectedHits.length+'개 코드 표시 · 확인 표시는 사진과 비교하세요.':'코드를 찾지 못함 · 확대 위치나 보정 설정을 바꿔 재검사하세요.';
  liveStatus.textContent='정지 화면 · 코드와 위치를 확인하세요.';
 }catch(error){status.textContent='인식 실패: '+error.message;if(worker){await worker.terminate().catch(()=>{});worker=null;}}
 finally{recognitionStage='';busy=false;lockInputs(false);excel.disabled=false;sheet.disabled=false;liveCanvas.setAttribute('aria-busy','false');strength.disabled=activeTab==='camera'&&frozenMode;resume.disabled=!stream||!frozenMode;start.disabled=!!stream;readImage.textContent=activeTab==='camera'&&frozenMode?'다시 촬영':'코드 인식';}
}
