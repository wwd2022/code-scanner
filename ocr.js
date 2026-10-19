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
 const normalized=text.replace(/[‐‑‒–—−﹣－]/g,'-');
 const regex=/(?:^|[^A-Za-z0-9])([A-Za-z0-9]{4}[ \t]*-[ \t]*[A-Za-z0-9]{6})(?![A-Za-z0-9])/g;
 const matches=[];
 for(const match of normalized.matchAll(regex)){
  const start=match.index+match[0].length-match[1].length;
  matches.push({code:normalizeCode(match[1]),start,end:start+match[1].length});
 }
 return matches;
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
    }else if(span.word.bbox)bounds.push(span.word.bbox);
   }
   if(!bounds.length)continue;
   hits.push({code:match.code,bbox:{x0:Math.min(...bounds.map(b=>b.x0)),y0:Math.min(...bounds.map(b=>b.y0)),x1:Math.max(...bounds.map(b=>b.x1)),y1:Math.max(...bounds.map(b=>b.y1))}});
  }
 }
 return hits;
}

// 두 인식 결과에서 같은 위치의 같은 코드를 합친다. (머지 히츠)
// 다른 행의 동일 코드는 유지하고 겹치는 중복 박스만 제거한다.
function mergeHits(groups){
 const merged=[];
 for(const hits of groups)for(const hit of hits){
  const b=hit.bbox;
  const duplicate=merged.some(existing=>{
   if(existing.code!==hit.code)return false;
   const a=existing.bbox;
   const overlap=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))*Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
   const smaller=Math.min((a.x1-a.x0)*(a.y1-a.y0),(b.x1-b.x0)*(b.y1-b.y0));
   return smaller>0&&overlap/smaller>=0.5;
  });
  if(!duplicate)merged.push(hit);
 }
 return merged.sort((a,b)=>a.bbox.y0-b.bbox.y0||a.bbox.x0-b.bbox.x0);
}

// 카메라 또는 선택한 이미지의 원본과 보정본을 읽는다. (스캔 카메라)
// 두 결과를 합쳐 박스로 표시하며 선택한 코드만 목록에 추가한다.
async function scanCamera(){
 if(busy||starting||(activeTab==='camera'&&frozenMode))return;
 if(activeTab==='camera'&&(!stream||camera.readyState<2)){status.textContent='카메라를 켜고 영상이 나올 때 터치하세요.';return;}
 if(activeTab!=='camera'&&!photoReady)return;
 busy=true;lockInputs(true);excel.disabled=true;sheet.disabled=true;resume.disabled=true;strength.disabled=true;liveCanvas.setAttribute('aria-busy','true');
 raw.textContent='';scanStats.textContent='';status.textContent='원본·보정본 인식을 준비합니다…';
 const started=performance.now(),amount=Number(strength.value);
 try{
  if(activeTab==='camera'){
   if(!drawCorrected(originalFrame,0))throw new Error('영상이 아직 준비되지 않았습니다.');
  }else{
   originalFrame.width=photoSource.width;originalFrame.height=photoSource.height;
   originalFrame.getContext('2d').drawImage(photoSource,0,0);
  }
  frame.width=originalFrame.width;frame.height=originalFrame.height;
  const ctx=frame.getContext('2d',{willReadFrequently:true});ctx.drawImage(originalFrame,0,0);
  if(amount){const image=ctx.getImageData(0,0,frame.width,frame.height);applyFilter(image.data,amount);ctx.putImageData(image,0,0);}
  camera.pause();frozenMode=true;liveEpoch++;clearTimeout(liveTimer);cancelAnimationFrame(animationId);dots.replaceChildren();
  liveView.hidden=true;frozen.hidden=false;detectedHits=[];boxes.replaceChildren();liveStatus.textContent='정지 화면 · 인식 완료 후 박스를 선택하세요.';
  if(liveJob)await liveJob.catch(()=>{});
  const engine=await getWorker();
  const passes=[{name:'원본',image:originalFrame}];
  if(amount)passes.push({name:'보정본',image:frame});
  const groups=[],stats=[],errors=[];
  for(let i=0;i<passes.length;i++){
   const pass=passes[i];recognitionStage=pass.name+' ('+(i+1)+'/'+passes.length+')';status.textContent=recognitionStage+' 코드 인식 중…';
   try{
    const {data}=await engine.recognize(pass.image,{}, {text:true,blocks:true});
    const hits=collectHits(data);groups.push(hits);stats.push(pass.name+' '+hits.length+'곳');
    raw.textContent+='['+pass.name+']\n'+data.text+'\n\n';
   }catch(error){errors.push(pass.name+': '+error.message);raw.textContent+='['+pass.name+' 실패] '+error.message+'\n\n';}
  }
  if(!groups.length)throw new Error(errors.join(' / '));
  detectedHits=mergeHits(groups);showBoxes(detectedHits);
  const seconds=((performance.now()-started)/1000).toFixed(1);
  scanStats.textContent=stats.join(' · ')+' → 합계 '+detectedHits.length+'곳 · '+seconds+'초'+(!amount?' · 보정 0%: 원본만 검사':'')+(errors.length?' · 일부 검사 실패':'');
  status.textContent=detectedHits.length?detectedHits.length+'개 코드 표시 · 사진과 비교한 뒤 박스를 누르세요.':'코드를 찾지 못함 · 보정 강도를 바꾸거나 다른 이미지로 재시도하세요.';
  liveStatus.textContent='정지 화면 · 추가할 코드 박스를 선택하세요.';
 }catch(error){status.textContent='인식 실패: '+error.message;if(worker){await worker.terminate().catch(()=>{});worker=null;}}
 finally{recognitionStage='';busy=false;lockInputs(false);excel.disabled=false;sheet.disabled=false;liveCanvas.setAttribute('aria-busy','false');strength.disabled=activeTab==='camera'&&frozenMode;resume.disabled=!stream||!frozenMode;start.disabled=!!stream;}
}
