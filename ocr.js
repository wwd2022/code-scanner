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

// 선택한 박스 주변만 확대하여 OCR을 다시 실행한다. (리체크 코드)
// 원본 좌표를 유지하며 재인식 성공 시 코드와 엑셀 위치 라벨을 갱신한다.
async function recheckCode(hit){
 if(busy||starting||!frozenMode)return;
 busy=true;lockInputs(true);excel.disabled=true;sheet.disabled=true;strength.disabled=true;
 const previous=hit.code,b=hit.bbox;
 status.textContent=previous+' 영역 재인식 중…';
 try{
  const padX=Math.max(20,(b.x1-b.x0)*0.65),padY=Math.max(15,(b.y1-b.y0)*1.2);
  const x=Math.max(0,Math.floor(b.x0-padX)),y=Math.max(0,Math.floor(b.y0-padY));
  const w=Math.min(originalFrame.width-x,Math.ceil(b.x1+padX)-x);
  const h=Math.min(originalFrame.height-y,Math.ceil(b.y1+padY)-y);
  if(w<=0||h<=0)throw new Error('이미지 영역이 올바르지 않습니다.');
  const settings={mode:filterMode.value,brightness:Number(brightness.value),threshold:Number(threshold.value),removeLines:removeLines.checked,strength:Number(strength.value)};
  const scale=Math.min(4,Math.max(1,1400/Math.max(w,h)));
  const pass={x,y,width:w,height:h,mode:'original',scale};
  const engine=await getWorker(),candidates=[];
  for(const mode of ['original',settings.mode]){
   pass.mode=mode;
   const rendered=renderScanPass(originalFrame,pass,settings);
   try{
    const {data}=await engine.recognize(rendered.image,{}, {text:true,blocks:true});
    const hits=mapScanHits(collectHits(data),pass,rendered.scaleX,rendered.scaleY);
    candidates.push(...hits);
   }finally{rendered.image.width=rendered.image.height=1;}
  }
  const centerX=(b.x0+b.x1)/2,centerY=(b.y0+b.y1)/2;
  const nearby=candidates.filter(candidate=>{
   const c=candidate.bbox,cx=(c.x0+c.x1)/2,cy=(c.y0+c.y1)/2;
   return Math.abs(cx-centerX)<=Math.max(30,(b.x1-b.x0)*1.1)&&Math.abs(cy-centerY)<=Math.max(20,(b.y1-b.y0)*1.8);
  });
  nearby.sort((a,b)=>b.confidence-a.confidence);
  if(!nearby.length){status.textContent=previous+' 재인식 실패 · 기존 코드를 유지합니다.';return;}
  const best=nearby[0];
  hit.code=best.code;hit.confidence=best.confidence;
  hit.review=nearby.some(candidate=>candidate.code!==best.code)||best.confidence<60;
  hit.alternatives=[...new Set(nearby.map(candidate=>candidate.code).filter(code=>code!==best.code))];
  showBoxes(detectedHits);
  status.textContent=previous===best.code?best.code+' 재인식 완료 · 기존 코드와 일치':previous+' → '+best.code+' 재인식으로 수정 · 엑셀 위치 갱신';
 }catch(error){status.textContent='재인식 실패 · 기존 코드 유지: '+error.message;}
 finally{busy=false;lockInputs(false);excel.disabled=false;sheet.disabled=false;strength.disabled=activeTab==='camera'&&frozenMode;}
}

// 카메라 또는 선택한 이미지의 원본과 보정본을 읽는다. (스캔 카메라)
// 확대 검사 결과도 원본 위치에 표시하며 선택한 코드만 기록한다.
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
  if(activeTab==='camera')camera.pause();frozenMode=true;liveEpoch++;clearTimeout(liveTimer);cancelAnimationFrame(animationId);dots.replaceChildren();
  liveView.hidden=true;frozen.hidden=false;zoomImage.hidden=false;detectedHits=[];boxes.replaceChildren();liveStatus.textContent='정지 화면 · 인식 완료 후 박스를 선택하세요.';
  if(liveJob)await liveJob.catch(()=>{});
  const engine=await getWorker();
  const passes=createScanPasses(originalFrame.width,originalFrame.height,settings);
  const groups=[],stats=[],errors=[];
  for(let i=0;i<passes.length;i++){
   const pass=passes[i];recognitionStage=pass.name+' ('+(i+1)+'/'+passes.length+')';status.textContent=recognitionStage+' 코드 인식 중…';
   let rendered;
   try{
    rendered=renderScanPass(originalFrame,pass,settings);
    const {data}=await engine.recognize(rendered.image,{}, {text:true,blocks:true});
    const hits=mapScanHits(collectHits(data),pass,rendered.scaleX,rendered.scaleY);groups.push(hits);stats.push(pass.name+' '+hits.length+'곳');
    detectedHits=mergeHits(groups);showBoxes(detectedHits);
    raw.textContent+='['+pass.name+']\n'+data.text+'\n\n';
   }catch(error){errors.push(pass.name+': '+error.message);raw.textContent+='['+pass.name+' 실패] '+error.message+'\n\n';}
   finally{if(rendered)rendered.image.width=rendered.image.height=1;}
  }
  if(!groups.length)throw new Error(errors.join(' / '));
  detectedHits=mergeHits(groups);showBoxes(detectedHits);
  const seconds=((performance.now()-started)/1000).toFixed(1);
  scanStats.textContent=stats.join(' · ')+' → 합계 '+detectedHits.length+'곳 · '+seconds+'초'+(errors.length?' · 일부 검사 실패':'');
  status.textContent=detectedHits.length?detectedHits.length+'개 코드 표시 · 확인 표시가 있는 코드는 사진과 비교하세요.':'코드를 찾지 못함 · 보정 강도를 바꾸거나 다른 이미지로 재시도하세요.';
  liveStatus.textContent='정지 화면 · 추가할 코드 박스를 선택하세요.';
 }catch(error){status.textContent='인식 실패: '+error.message;if(worker){await worker.terminate().catch(()=>{});worker=null;}}
 finally{recognitionStage='';busy=false;lockInputs(false);excel.disabled=false;sheet.disabled=false;liveCanvas.setAttribute('aria-busy','false');strength.disabled=activeTab==='camera'&&frozenMode;resume.disabled=!stream||!frozenMode;start.disabled=!!stream;}
}
