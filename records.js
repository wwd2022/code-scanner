// 인식 영역의 지정 방향에 박스를 일정하게 배치한다. (플레이스 레이블)
// 이미지 경계만 보정하고 다른 코드 주변으로 자동 이동하지 않는다.
function placeLabel(element,anchor,angle,width,height){
 const w=element.offsetWidth,h=element.offsetHeight,gap=4;
 const dx=Math.cos(angle),dy=Math.sin(angle);
 const x=anchor.x+anchor.w/2+dx*(anchor.w/2+w/2+gap)-w/2;
 const y=anchor.y+anchor.h/2+dy*(anchor.h/2+h/2+gap)-h/2;
 element.style.left=Math.max(0,Math.min(width-w,x))+'px';
 element.style.top=Math.max(0,Math.min(height-h,y))+'px';
}

// 인식 글자는 그대로 두고 코드·위치 라벨을 주변에 표시한다. (쇼 박시스)
// 기존 색상·조이스틱 설정을 유지하며 OCR 박스 위 덮개를 제거한다.
function showBoxes(hits){
 updateReviewActions();
 if(activeTab==='test'&&typeof redrawTestResultOverlays==='function'){redrawTestResultOverlays();return;}
 const indicator=document.getElementById('boxVisibility');
 indicator.hidden=false;indicator.textContent=boxes.hidden?'박스 숨김':'박스 표시';
 // 숨김 중에는 보존하고 다시 표시할 때 최신 좌표로 만든다.
 if(boxes.hidden||imageViewport.hidden||frozen.hidden)return;
 const width=boxes.clientWidth,height=boxes.clientHeight;
 if(!width||!height||!frame.width||!frame.height)return;
 boxes.replaceChildren();
 renderHitBoxes(boxes,hits,width,height,width/frame.width,height/frame.height);
}

// 코드·위치 라벨을 각 화면 좌표에 배치한다.
// 카메라·사진·비교 화면에서 같은 표시 설정을 쓴다.
function renderHitBoxes(target,hits,width,height,scaleX,scaleY,offsetX=0,offsetY=0,onOpen=null){
 target.replaceChildren();
 const codeAngle=codeDirectionIndex===null?-Math.PI/2:(codeDirectionIndex-4)*Math.PI/8;
 const placeAngle=(locationDirectionIndex-4)*Math.PI/8;
 for(const hit of hits){
  const b=hit.bbox,found=locations.get(hit.code),location=found?.length?found.join(' / '):'ㅡ없음';
  const anchor={x:offsetX+b.x0*scaleX,y:offsetY+b.y0*scaleY,w:(b.x1-b.x0)*scaleX,h:(b.y1-b.y0)*scaleY};
  if(anchor.x+anchor.w<0||anchor.y+anchor.h<0||anchor.x>width||anchor.y>height)continue;
  const code=document.createElement('div'),place=document.createElement('div');
  code.className='code-box';
  if(!found?.length)code.classList.add('missing-box');
  if(hit.review)code.classList.add('needs-review');
  code.scanHit=hit;code.setAttribute('role','button');code.tabIndex=0;
  code.setAttribute('aria-label',hit.code+' 확인 및 수정');
  code.addEventListener('click',event=>{
   event.stopPropagation();
   if(onOpen)onOpen(hit);else queueMousePhotoTap(event,hit);
  });
  code.addEventListener('keydown',event=>{
   if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();if(onOpen)onOpen(hit);else openCodeReview(hit);}
  });
  if(onOpen)code.addEventListener('pointerdown',event=>event.stopPropagation());
  const codeText=document.createElement('span');codeText.className='box-text';codeText.textContent=hit.code;code.append(codeText);
  code.title=hit.review?'확인 필요: '+hit.code:hit.code;
  place.className='location-box';
  const placeText=document.createElement('span');placeText.className='box-text';placeText.textContent=location;place.append(placeText);
  place.title=hit.code+' / '+location;
  target.append(code,place);
  placeLabel(code,anchor,codeAngle,width,height);
  placeLabel(place,anchor,placeAngle,width,height);
 }
}

// 같은 인식 객체를 보관해 직접 수정도 기록에 반영한다.
const recordedHits=new Set();
function addRecord(hit){
 if(/^[A-Z0-9]{4}-[A-Z0-9]{6}$/.test(hit.code))recordedHits.add(hit);
}

// 누적 기록은 코드별로 합치고 현재 엑셀의 위치를 조회한다.
function refreshRecords(){
 const total=renderRecordRows(records,recordedHits);
 recordCount=total;
 document.getElementById('empty').hidden=recordCount>0;
 document.getElementById('count').textContent=String(recordCount);
}

// 확인 초안과 재인식 후보는 적용하기 전까지 실제 코드를 바꾸지 않는다.
const codeReview=document.getElementById('codeReview'),reviewInput=document.getElementById('reviewInput');
const reviewImage=document.getElementById('reviewImage'),reviewMessage=document.getElementById('reviewMessage');
const reviewCandidates=document.getElementById('reviewCandidates'),reviewSuggestions=new Map();
let reviewHit=null,reviewCrop=null,reviewRunning=false,reviewQueue=[],reviewIndex=-1,reviewStopRequested=false;

function updateReviewActions(){
 const pending=detectedHits.filter(hit=>hit.review).length;
 document.getElementById('reviewActions').hidden=!detectedHits.length;
 document.getElementById('reviewPendingCount').textContent='확인 필요 '+pending+'개 · 모든 코드 박스를 눌러 수정 가능';
 for(const id of ['openUncertain','batchReview'])document.getElementById(id).disabled=busy||starting||!pending;
 document.getElementById('batchReview').textContent='일괄 재인식 ('+pending+')';
}
function resetReviewSession(){
 reviewSuggestions.clear();
 if(!codeReview.open){reviewQueue=[];reviewIndex=-1;}
 document.getElementById('reviewActions').hidden=true;
}
function rememberReviewDraft(){
 if(!reviewHit)return;
 const previous=reviewSuggestions.get(reviewHit)||{};
 reviewSuggestions.set(reviewHit,{...previous,draft:reviewInput.value,dirty:normalizeCode(reviewInput.value)!==reviewHit.code});
}
function syncReviewNavigation(){
 document.getElementById('reviewPrevious').disabled=reviewRunning||reviewIndex<=0;
 document.getElementById('reviewNext').disabled=reviewRunning||reviewIndex>=reviewQueue.length-1;
 document.getElementById('reviewPosition').value=(reviewIndex+1)+' / '+reviewQueue.length+' · 미확인 '+reviewQueue.filter(hit=>hit.review).length;
 document.getElementById('reviewApply').textContent=reviewIndex<reviewQueue.length-1?'적용 · 다음':'적용';
}

// 이전·다음 이동 시 입력 초안을 보존하고 보정 영상의 같은 좌표를 쓴다.
function selectReviewItem(index){
 if(reviewRunning||index<0||index>=reviewQueue.length)return;
 const hit=reviewQueue[index];
 if(!detectedHits.includes(hit))return;
 const crop=cropReviewRegion(hit);
 if(!crop){reviewMessage.textContent='전체 인식을 다시 실행한 뒤 코드를 선택하세요.';return;}
 rememberReviewDraft();
 if(reviewCrop)reviewCrop.image.width=reviewCrop.image.height=1;
 reviewIndex=index;reviewHit=hit;reviewCrop=crop;
 reviewImage.width=crop.image.width;reviewImage.height=crop.image.height;
 reviewImage.getContext('2d').drawImage(crop.image,0,0);
 reviewImage.setAttribute('aria-label','전체 OCR 보정 영상에서 자른 코드 · 흰 여백 포함');
 document.getElementById('reviewPreviewLabel').textContent='전체 OCR 입력에서 자른 이미지';
 const suggestion=reviewSuggestions.get(hit);
 reviewInput.value=suggestion?.draft??hit.code;
 showReviewCandidates(suggestion?.candidates||hit.alternatives||[]);
 reviewMessage.textContent=suggestion?.message||'사진과 비교해 직접 입력하거나 재인식하세요. 다음으로 이동해도 입력 초안은 유지됩니다.';
 syncReviewNavigation();
}
function openCodeReview(hit,queue=null){
 if(busy||starting||codeReview.open)return;
 if(!cropReviewAvailable()){status.textContent='전체 인식을 다시 실행한 뒤 코드를 선택하세요.';return;}
 reviewQueue=queue||detectedHits.filter(item=>!hit.review||item.review);
 if(!reviewQueue.includes(hit))reviewQueue=[hit];
 selectReviewItem(reviewQueue.indexOf(hit));
 if(!reviewCrop)return;
 closeTools();codeReview.showModal();
}
function cropReviewAvailable(){return !!reviewSourceArea&&reviewSourceEpoch===scanEpoch;}
function showReviewCandidates(codes){
 reviewCandidates.replaceChildren();
 for(const value of [...new Set(codes)]){
  const button=document.createElement('button');button.type='button';button.textContent=value;
  button.addEventListener('click',()=>{reviewInput.value=value;rememberReviewDraft();});
  reviewCandidates.append(button);
 }
}

// 일괄 재인식은 기존 단일 코드 경로를 순서대로 호출하고 후보만 보관한다.
async function runReviewJobs(targets){
 if(reviewRunning||busy||!targets.length)return;
 rememberReviewDraft();reviewRunning=true;reviewStopRequested=false;busy=true;
 lockInputs(true);excel.disabled=true;sheet.disabled=true;updateReviewActions();
 const controls=[...codeReview.querySelectorAll('button,input,select')];
 controls.forEach(control=>control.disabled=true);
 const stopButton=document.getElementById('reviewStop');stopButton.hidden=false;stopButton.disabled=false;
 codeReview.setAttribute('aria-busy','true');syncReviewNavigation();
 const epoch=scanEpoch;
 const previewFor=reviewHit,preparedPreview=document.createElement('canvas');preparedPreview.width=preparedPreview.height=1;
 let completed=0,failures=0,notFound=0,previewDescription='';
 try{
  for(const hit of targets){
   if(reviewStopRequested||epoch!==scanEpoch)break;
   if(!detectedHits.includes(hit))continue;
   const crop=cropReviewRegion(hit);
   if(!crop)break;
   reviewMessage.textContent='재인식 '+(completed+1)+' / '+targets.length+' · 코드는 자동 확정하지 않습니다.';
   try{
    const result=await recognizeReviewRegion(crop,image=>{
     if(reviewStopRequested||epoch!==scanEpoch||hit!==reviewHit||!codeReview.open)return;
     reviewImage.width=image.width;reviewImage.height=image.height;reviewImage.getContext('2d').drawImage(image,0,0);
     const description='실제 OCR 입력 · 기존 보정 유지 · '+image.width+'×'+image.height+'px';
     preparedPreview.width=image.width;preparedPreview.height=image.height;preparedPreview.getContext('2d').drawImage(image,0,0);previewDescription=description;
     reviewImage.setAttribute('aria-label',description);document.getElementById('reviewPreviewLabel').textContent=description;
    });
    if(reviewStopRequested||epoch!==scanEpoch)break;
    const previous=reviewSuggestions.get(hit)||{};
    if(!result.candidates.length)notFound++;
    const candidates=[...new Set([...result.candidates,...(hit.alternatives||[])])];
    reviewSuggestions.set(hit,{...previous,candidates,draft:previous.dirty?previous.draft:(result.candidates[0]||hit.code),message:result.candidates.length?'재인식 후보입니다. 사진과 비교한 뒤 적용하세요.':'재인식에서 코드를 찾지 못했습니다. 직접 수정할 수 있습니다.'});
   }catch(error){
    if(reviewStopRequested||epoch!==scanEpoch)break;
    failures++;
    const previous=reviewSuggestions.get(hit)||{};
    reviewSuggestions.set(hit,{...previous,draft:previous.draft??hit.code,message:'재인식 실패: '+(error.message||String(error))});
   }finally{crop.image.width=crop.image.height=1;}
   completed++;
  }
 }finally{
  reviewRunning=false;busy=false;codeReview.setAttribute('aria-busy','false');
  controls.forEach(control=>control.disabled=false);stopButton.hidden=true;
  lockInputs(false);excel.disabled=false;sheet.disabled=false;updateReviewActions();
  // 현재 입력을 다시 저장해 새 후보를 덮지 않도록 선택을 비운다.
  reviewHit=null;
  if(epoch===scanEpoch&&codeReview.open)selectReviewItem(reviewIndex);
  if(epoch===scanEpoch&&reviewHit===previewFor&&preparedPreview.width>1){
   reviewImage.width=preparedPreview.width;reviewImage.height=preparedPreview.height;reviewImage.getContext('2d').drawImage(preparedPreview,0,0);
   reviewImage.setAttribute('aria-label',previewDescription);document.getElementById('reviewPreviewLabel').textContent=previewDescription;
  }
  preparedPreview.width=preparedPreview.height=1;
  const summary=(reviewStopRequested?'중단 · 실행 중 결과 폐기 · ':'완료 · ')+completed+'/'+targets.length+'개 처리'+(failures?' · 실패 '+failures:'')+(notFound?' · 미검출 '+notFound:'')+' · 후보를 확인해 적용하세요.';
  reviewMessage.textContent=summary;status.textContent='코드 재인식 '+summary;
  syncReviewNavigation();
 }
}
function retryCodeReview(){if(reviewHit)runReviewJobs([reviewHit]);}
function openUncertainReview(runBatch=false){
 if(busy||starting||codeReview.open)return;
 const targets=detectedHits.filter(hit=>hit.review);
 if(!targets.length){status.textContent='확인할 불확실 코드가 없습니다.';return;}
 openCodeReview(targets[0],targets);
 if(runBatch&&codeReview.open)runReviewJobs(targets);
}
function applyCodeReview(event){
 event.preventDefault();
 if(reviewRunning||!reviewHit||!detectedHits.includes(reviewHit))return;
 const value=normalizeCode(reviewInput.value);
 if(!/^[A-Z0-9]{4}-[A-Z0-9]{6}$/.test(value)){
  reviewMessage.textContent='영문·숫자 4자리-6자리로 입력하세요. 예: AB12-A00345';reviewInput.focus();return;
 }
 reviewHit.code=value;reviewHit.review=false;reviewHit.alternatives=[];reviewSuggestions.delete(reviewHit);
 refreshRecords();showBoxes(detectedHits);status.textContent=value+' 확인 완료 · 위치 갱신';
 if(reviewIndex<reviewQueue.length-1){reviewHit=null;selectReviewItem(reviewIndex+1);}
 else codeReview.close();
}
function openReviewTest(){
 if(busy||starting)return;
 const hit=detectedHits.find(item=>item.review)||detectedHits[0];
 if(!hit){status.textContent='테스트 이미지를 생성하고 코드 인식을 먼저 실행하세요.';return;}
 openCodeReview(hit);
}
document.getElementById('reviewForm').addEventListener('submit',applyCodeReview);
document.getElementById('reviewRetry').addEventListener('click',retryCodeReview);
document.getElementById('reviewPrevious').addEventListener('click',()=>selectReviewItem(reviewIndex-1));
document.getElementById('reviewNext').addEventListener('click',()=>selectReviewItem(reviewIndex+1));
document.getElementById('reviewInput').addEventListener('input',rememberReviewDraft);
document.getElementById('reviewCancel').addEventListener('click',()=>{if(!reviewRunning)codeReview.close();});
document.getElementById('reviewStop').addEventListener('click',()=>{
 reviewStopRequested=true;document.getElementById('reviewStop').disabled=true;
 reviewMessage.textContent='대기 작업 제거 · 실행 중 재인식 완료 대기 · 해당 결과는 폐기합니다.';
});
codeReview.addEventListener('cancel',event=>{if(reviewRunning)event.preventDefault();});
codeReview.addEventListener('close',()=>{
 rememberReviewDraft();reviewHit=null;reviewQueue=[];reviewIndex=-1;
 if(reviewCrop)reviewCrop.image.width=reviewCrop.image.height=1;
 reviewCrop=null;reviewImage.width=reviewImage.height=1;
});
document.getElementById('testReview').addEventListener('click',openReviewTest);
document.getElementById('openUncertain').addEventListener('click',()=>openUncertainReview());
document.getElementById('batchReview').addEventListener('click',()=>openUncertainReview(true));
document.getElementById('testBatchReview').addEventListener('click',()=>openUncertainReview(true));

// 코드별 위치·확인 상태 목록을 같은 형식으로 표시한다.
// 테스트 목록은 실제 누적 기록과 분리한다.
function renderRecordRows(target,hits){
 const codes=new Map();
 for(const hit of hits)codes.set(hit.code,!!hit.review||!!codes.get(hit.code));
 target.replaceChildren();
 for(const [code,review] of codes){
  const row=document.createElement('div');row.className='record';
  const found=locations.get(code);
  if(!found){row.classList.add('missing');row.textContent=code+' - 위치 없음 (엑셀에 없는 코드)';}
  else if(!found.length){row.classList.add('missing');row.textContent=code+' - 위치 없음 (엑셀 위치 미입력)';}
  else row.textContent=code+' - '+found.join(' / ');
  if(review)row.textContent+=' · 확인 필요';
  target.append(row);
 }
 return codes.size;
}
