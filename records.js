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
 const indicator=document.getElementById('boxVisibility');
 indicator.hidden=false;indicator.textContent=boxes.hidden?'박스 숨김':'박스 표시';
 // 숨김 중에는 보존하고 다시 표시할 때 최신 좌표로 만든다.
 if(boxes.hidden||imageViewport.hidden||frozen.hidden)return;
 const width=boxes.clientWidth,height=boxes.clientHeight;
 if(!width||!height||!frame.width||!frame.height)return;
 boxes.replaceChildren();
 const codeAngle=codeDirectionIndex===null?-Math.PI/2:(codeDirectionIndex-4)*Math.PI/8;
 const placeAngle=(locationDirectionIndex-4)*Math.PI/8;
 for(const hit of hits){
  const b=hit.bbox,found=locations.get(hit.code),location=found?.length?found.join(' / '):'ㅡ없음';
  const anchor={x:b.x0/frame.width*width,y:b.y0/frame.height*height,w:(b.x1-b.x0)/frame.width*width,h:(b.y1-b.y0)/frame.height*height};
  const code=document.createElement('div'),place=document.createElement('div');
  code.className='code-box';
  if(!found?.length)code.classList.add('missing-box');
  if(hit.review){
   code.classList.add('needs-review');code.setAttribute('role','button');code.tabIndex=0;
   code.setAttribute('aria-label',hit.code+' 확인 및 수정');
   for(const type of ['pointerdown','pointermove','pointerup','pointercancel','dblclick'])code.addEventListener(type,event=>event.stopPropagation());
   code.addEventListener('click',event=>{event.stopPropagation();openCodeReview(hit);});
   code.addEventListener('keydown',event=>{
    if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();openCodeReview(hit);}
   });
  }
  code.textContent=hit.code;code.title=hit.review?'확인 필요: '+hit.code:hit.code;
  place.className='location-box';place.textContent=location;place.title=hit.code+' / '+location;
  boxes.append(code,place);
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
 const codes=new Map();
 for(const hit of recordedHits)codes.set(hit.code,!!hit.review||!!codes.get(hit.code));
 records.replaceChildren();
 for(const [code,review] of codes){
  const row=document.createElement('div');row.className='record';
  const found=locations.get(code);
  if(!found){row.classList.add('missing');row.textContent=code+' - 위치 없음 (엑셀에 없는 코드)';}
  else if(!found.length){row.classList.add('missing');row.textContent=code+' - 위치 없음 (엑셀 위치 미입력)';}
  else row.textContent=code+' - '+found.join(' / ');
  if(review)row.textContent+=' · 확인 필요';
  records.append(row);
 }
 recordCount=codes.size;
 document.getElementById('empty').hidden=recordCount>0;
 document.getElementById('count').textContent=String(recordCount);
}

// 코드 확인 팝업의 입력과 버튼을 한 번 연결한다.
// 적용 전에는 원래 인식 결과를 변경하지 않는다.
const codeReview=document.getElementById('codeReview'),reviewInput=document.getElementById('reviewInput');
const reviewImage=document.getElementById('reviewImage'),reviewMessage=document.getElementById('reviewMessage');
const reviewCandidates=document.getElementById('reviewCandidates');
let reviewHit=null,reviewCrop=null,reviewRunning=false;

// 선택한 코드 주변의 원본을 잘라 확인 창에 표시한다.
// 카메라·사진·테스트에서 같은 원본 좌표와 팝업을 사용한다.
function openCodeReview(hit){
 if(busy||starting||codeReview.open)return;
 reviewHit=hit;reviewCrop=cropReviewRegion(hit);
 reviewImage.width=reviewCrop.image.width;reviewImage.height=reviewCrop.image.height;
 reviewImage.getContext('2d').drawImage(reviewCrop.image,0,0);
 reviewInput.value=hit.code;showReviewCandidates(hit.alternatives||[]);
 reviewMessage.textContent='사진과 비교해 직접 입력하거나 재인식하세요.';
 closeTools();codeReview.showModal();
}

// 인식 후보를 누르면 입력창에 복사한다.
// 후보 선택만으로 코드나 조회 위치를 확정하지 않는다.
function showReviewCandidates(codes){
 reviewCandidates.replaceChildren();
 for(const value of [...new Set(codes)]){
  const button=document.createElement('button');button.type='button';button.textContent=value;
  button.addEventListener('click',()=>{reviewInput.value=value;});
  reviewCandidates.append(button);
 }
}

// 선택한 영역만 기존 OCR·보정 경로로 다시 검사한다.
// 실패하면 입력값을 유지하며 적용은 사용자에게 맡긴다.
async function retryCodeReview(){
 if(reviewRunning||busy||!reviewCrop)return;
 reviewRunning=true;busy=true;
 const controls=[...codeReview.querySelectorAll('button,input')];
 controls.forEach(control=>control.disabled=true);
 codeReview.setAttribute('aria-busy','true');reviewMessage.textContent='선택 영역 재인식 중…';
 try{
  const candidates=await recognizeReviewRegion(reviewCrop);
  if(candidates.length){
   reviewInput.value=candidates[0];showReviewCandidates(candidates);
   reviewMessage.textContent='재인식 결과입니다. 사진과 비교한 뒤 적용하세요.';
  }else reviewMessage.textContent='코드를 찾지 못했습니다. 아래 입력창에서 직접 수정하세요.';
 }catch(error){reviewMessage.textContent='재인식 실패: '+error.message+' · 직접 입력할 수 있습니다.';}
 finally{
  reviewRunning=false;busy=false;codeReview.setAttribute('aria-busy','false');
  controls.forEach(control=>control.disabled=false);
 }
}

// 규격에 맞는 입력만 현재 코드와 조회 위치에 반영한다.
// 취소와 재인식은 기존 결과를 바꾸지 않는다.
function applyCodeReview(event){
 event.preventDefault();
 if(reviewRunning||!reviewHit||!detectedHits.includes(reviewHit))return;
 const value=normalizeCode(reviewInput.value);
 if(!/^[A-Z0-9]{4}-[A-Z0-9]{6}$/.test(value)){
  reviewMessage.textContent='영문·숫자 4자리-6자리로 입력하세요. 예: AB12-A00345';
  reviewInput.focus();return;
 }
 reviewHit.code=value;reviewHit.review=false;reviewHit.alternatives=[];
 refreshRecords();showBoxes(detectedHits);status.textContent=value+' 확인 완료 · 위치 갱신';
 codeReview.close();
}

// 테스트 탭에서 실제 인식 결과로 같은 확인 창을 연다.
// 불확실한 코드를 우선하며 없으면 첫 번째 코드를 보여준다.
function openReviewTest(){
 if(busy||starting)return;
 const hit=detectedHits.find(item=>item.review)||detectedHits[0];
 if(!hit){status.textContent='테스트 이미지를 생성하고 코드 인식을 먼저 실행하세요.';return;}
 openCodeReview(hit);
}
document.getElementById('reviewForm').addEventListener('submit',applyCodeReview);
document.getElementById('reviewRetry').addEventListener('click',retryCodeReview);
document.getElementById('reviewCancel').addEventListener('click',()=>{if(!reviewRunning)codeReview.close();});
codeReview.addEventListener('cancel',event=>{if(reviewRunning)event.preventDefault();});
codeReview.addEventListener('close',()=>{
 reviewHit=null;
 if(reviewCrop)reviewCrop.image.width=reviewCrop.image.height=1;
 reviewCrop=null;reviewImage.width=reviewImage.height=1;
});
document.getElementById('testReview').addEventListener('click',openReviewTest);

