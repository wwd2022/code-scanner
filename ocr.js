// OCR 엔진을 한 번 준비해 공유한다. (겟 워커)
// 실시간 검사와 터치 인식을 같은 엔진에서 순서대로 처리한다.
async function getWorker(){
 if(worker)return worker;
 if(!workerPromise)workerPromise=(async()=>{
  if(!window.Tesseract)throw new Error('OCR 라이브러리 로딩 실패. 인터넷 연결 후 새로고침하세요.');
  const created=await Tesseract.createWorker('eng',1,{logger:message=>{
   if(busy&&frozenMode&&message.status==='recognizing text')showScanProgress(message.progress);
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

// 보정 이미지를 한 번 만들고 선택한 전체·분리 구역을 검사한다.
// 확대 사진은 보이는 영역만 처리하고 결과 좌표는 원본에 맞춘다.
async function scanCamera(){
 if(busy||starting||(activeTab==='camera'&&frozenMode))return;
 if(activeTab==='camera'&&(!stream||camera.readyState<2)){showScanCameraRequired();return;}
 if(activeTab!=='camera'&&!photoReady)return;
 const stages=scanStageInputs.filter(input=>input.checked&&(deepScan.checked||input.dataset.scanStage==='corrected')).map(input=>input.dataset.scanStage);
 if(!stages.length){status.textContent='인식 설정에서 검사 단계를 하나 이상 선택하세요.';return;}
 busy=true;showScanStart(stages);
 const started=performance.now(),settings=getCorrectionSettings();
 try{
  if(activeTab==='camera'){
   if(!drawCorrected(originalFrame,0))throw new Error('영상이 아직 준비되지 않았습니다.');
  }else{
   originalFrame.width=photoSource.width;originalFrame.height=photoSource.height;
   originalFrame.getContext('2d').drawImage(photoSource,0,0);
  }
  frame.width=originalFrame.width;frame.height=originalFrame.height;
  frame.getContext('2d').drawImage(originalFrame,0,0);
  if(activeTab==='camera')camera.pause();
  frozenMode=true;liveEpoch++;clearTimeout(liveTimer);cancelAnimationFrame(animationId);dots.replaceChildren();
  detectedHits=[];showScanFrame();
  if(liveJob)await liveJob.catch(()=>{});
  const area=activeTab==='camera'?null:getVisiblePhotoRegion();
  recognitionStage='보정 이미지';
  const result=await recognizeCorrected(originalFrame,settings,area,1,(image,pass)=>{
   if(previewCorrection.checked)frame.getContext('2d').drawImage(image,pass.x,pass.y,pass.width,pass.height);
  },stages);
  appendScanRaw('전체·분리 검사',result.text,false);
  detectedHits=result.hits;
  document.getElementById('scanSingleCount').value=detectedHits.length+'개 · OCR '+result.attempts+'회'+(result.errors.length?' · 실패 '+result.errors.length+'회':'');
  showScanResults(detectedHits,area,result.stats,((performance.now()-started)/1000).toFixed(1),result.errors.length);
 }catch(error){
  showScanFailure(error);
  if(worker){await worker.terminate().catch(()=>{});worker=null;}
 }finally{recognitionStage='';busy=false;showScanEnd();}
}

// 전체와 겹치는 여섯 구역의 좌표를 보정 이미지 기준으로 만든다.
// 선택된 단계만 반환하며 구역 간 여백을 겹쳐 경계의 글자 잘림을 줄인다.
function createOcrRegions(width,height,stages){
 const enabled=new Set(stages||['corrected']),regions=[];
 if(enabled.has('corrected'))regions.push({key:'corrected',name:'전체 보정',x:0,y:0,width,height,scale:1});
 const tw=Math.ceil(width*.5),th=Math.ceil(height*.65);
 for(let row=0;row<2;row++)for(let col=0;col<3;col++){
  const number=row*3+col+1,key='zoom'+number;
  if(!enabled.has(key))continue;
  regions.push({key,name:'확대 '+number,x:Math.round((width-tw)*col/2),y:(height-th)*row,width:tw,height:th,scale:Math.min(2,2000/Math.max(tw,th))});
 }
 return regions;
}

// 보정 이미지는 한 번 생성하고 전체·분리 검사에서 재사용한다.
// 부분 재인식은 기본 한 번만 검사하며 모든 좌표를 원본에 맞춰 반환한다.
async function recognizeCorrected(source,settings,area=null,scale=1,onPrepared=null,stages=null){
 const pass=area?{...area,scale}:{x:0,y:0,width:source.width,height:source.height,scale};
 let rendered;
 try{
  const engine=await getWorker();
  rendered=renderScanPass(source,pass,settings);
  if(onPrepared)onPrepared(rendered.image,pass);
  const regions=createOcrRegions(rendered.image.width,rendered.image.height,stages);
  const groups=[],texts=[],stats=[],errors=[];
  for(let i=0;i<regions.length;i++){
   const region=regions[i];
   recognitionStage=region.name+' ('+(i+1)+'/'+regions.length+')';
   let image=rendered.image;
   try{
    if(region.key!=='corrected'){
     image=document.createElement('canvas');
     image.width=Math.max(1,Math.round(region.width*region.scale));image.height=Math.max(1,Math.round(region.height*region.scale));
     image.getContext('2d').drawImage(rendered.image,region.x,region.y,region.width,region.height,0,0,image.width,image.height);
    }
    const {data}=await engine.recognize(image,{}, {text:true,blocks:true});
    const hits=mapScanHits(mapScanHits(collectHits(data),region,image.width/region.width,image.height/region.height),pass,rendered.scaleX,rendered.scaleY);
    groups.push(hits);texts.push('['+region.name+']\n'+data.text);
    stats.push(region.name+' '+hits.length+'곳');
    if(stages)showScanStageResult(region,hits.length,false);
   }catch(error){
    errors.push(region.name+': '+error.message);texts.push('['+region.name+' 실패] '+error.message);
    if(stages)showScanStageResult(region,0,true);
   }finally{if(image!==rendered.image)image.width=image.height=1;}
  }
  if(!groups.length)throw new Error(errors.join(' / ')||'검사할 영역이 없습니다.');
  return {hits:mergeHits(groups),text:texts.join('\n\n'),stats,errors,attempts:regions.length};
 }finally{if(rendered)rendered.image.width=rendered.image.height=1;}
}

// 불확실한 코드 주변을 여백과 함께 원본에서 잘라낸다.
// 화면 확대율과 관계없이 원본 이미지의 픽셀 좌표를 사용한다.
function cropReviewRegion(hit){
 const b=hit.bbox,w=b.x1-b.x0,h=b.y1-b.y0;
 const x=Math.max(0,Math.floor(b.x0-Math.max(12,w*.08)));
 const y=Math.max(0,Math.floor(b.y0-Math.max(8,h*.6)));
 const right=Math.min(originalFrame.width,Math.ceil(b.x1+Math.max(12,w*.08)));
 const bottom=Math.min(originalFrame.height,Math.ceil(b.y1+Math.max(8,h*.6)));
 const image=document.createElement('canvas');image.width=Math.max(1,right-x);image.height=Math.max(1,bottom-y);
 image.getContext('2d').drawImage(originalFrame,x,y,image.width,image.height,0,0,image.width,image.height);
 return {image,centerX:(b.x0+b.x1)/2-x,centerY:(b.y0+b.y1)/2-y};
}

// 잘라낸 영역도 보정 이미지 한 장만 확대해 한 번 읽는다.
// 대상 중심에 가장 가까운 결과와 해당 후보만 반환한다.
async function recognizeReviewRegion(crop){
 const width=crop.image.width,height=crop.image.height;
 const result=await recognizeCorrected(crop.image,getCorrectionSettings(),null,Math.min(4,1800/Math.max(width,height)));
 const hits=result.hits;
 const distance=hit=>Math.hypot(((hit.bbox.x0+hit.bbox.x1)/2-crop.centerX)/width,((hit.bbox.y0+hit.bbox.y1)/2-crop.centerY)/height);
 hits.sort((a,b)=>distance(a)-distance(b));
 const best=hits[0];
 return best?[best.code,...best.alternatives]:[];
}
