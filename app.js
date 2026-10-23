// 처리 중 입력·설정 변경을 잠근다. (록 인풋스)
// 카메라·사진 상태에 따라 인식 버튼을 활성화한다.
function lockInputs(locked){
 tabButtons.forEach(button=>button.disabled=locked);
 correctionInputs.forEach(input=>input.disabled=locked);
 photoInput.disabled=locked;
 readImage.disabled=locked||(activeTab==='camera'?!stream:!photoReady);
 readImage.textContent=activeTab==='camera'&&frozenMode?'다시 촬영':'코드 인식';
}

// 하단 메뉴에서 열린 패널 하나만 유지한다. (클로즈 툴스)
// 이미지 영역을 가리지 않도록 나머지 메뉴를 닫는다.
const toolDrawers=[...document.querySelectorAll('.tool-drawer')];
function closeTools(except=null){
 for(const drawer of toolDrawers)if(drawer!==except)drawer.open=false;
}

// 카메라·사진·테스트 모드를 전환한다. (스위치 탭)
// 이전 인식 결과와 사진 확대 상태를 초기화한다.
function switchTab(tab){
 if(busy||starting||activeTab===tab)return;
 stopCamera();activeTab=tab;photoReady=false;frozenMode=false;
 setPhotoZoom(1);imageViewport.classList.remove('camera-shot');imageViewport.scrollLeft=0;imageViewport.scrollTop=0;closeTools();zoomLevel.hidden=true;zoomHint.hidden=true;
 detectedHits=[];boxes.hidden=false;document.getElementById('boxVisibility').hidden=true;boxes.replaceChildren();raw.textContent='';scanStats.textContent='';
 tabButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.tab===tab)));
 document.getElementById('cameraControls').hidden=tab!=='camera';
 document.getElementById('photoControls').hidden=tab!=='photo';
 document.getElementById('testControls').hidden=tab!=='test';
 readImage.disabled=true;
 liveView.hidden=tab!=='camera';liveStatus.hidden=tab!=='camera';
 imageViewport.hidden=true;frozen.hidden=true;
 strength.disabled=false;photoInput.value='';
 liveCanvas.getContext('2d').clearRect(0,0,liveCanvas.width,liveCanvas.height);
 status.textContent=tab==='camera'?'카메라를 켜고 코드 인식을 누르세요.':'사진을 선택해 주세요.';
 if(tab==='test')makeTestImage();
 else if(workbook){locations=buildLocations(workbook.sheets[workbook.selected]);excelStatus.textContent=workbook.name+' · '+workbook.selected+' · '+locations.size+'개 코드';}
 else{locations=new Map();excelStatus.textContent='엑셀을 선택해 주세요.';}
}

// 두 손가락 중심을 기준으로 사진 배율을 바꾼다. (셋 포토 줌)
// 스크롤 위치를 보정해 확대 전 같은 사진 지점을 유지한다.
let photoZoom=1;
function setPhotoZoom(value,centerX=imageViewport.clientWidth/2,centerY=imageViewport.clientHeight/2){
 const next=Math.max(1,Math.min(6,value)),ratio=next/photoZoom;
 const left=(imageViewport.scrollLeft+centerX)*ratio-centerX;
 const top=(imageViewport.scrollTop+centerY)*ratio-centerY;
 photoZoom=next;imageViewport.classList.toggle('zoomed',next>1.01);frozen.style.width=(next*100)+'%';
 if(detectedHits.length)showBoxes(detectedHits);
 imageViewport.scrollLeft=left;imageViewport.scrollTop=top;
 zoomLevel.textContent=Math.round(next*100)+'%';
}

// 확대 상태에서 현재 보이는 원본 사진 영역을 구한다. (겟 비저블 포토 리전)
// OCR 결과 박스를 원본 좌표로 되돌릴 수 있도록 픽셀 범위를 반환한다.
function getVisiblePhotoRegion(){
 if(photoZoom<=1.01||imageViewport.hidden||frozen.hidden)return null;
 const displayWidth=frozen.clientWidth,displayHeight=frozen.clientHeight;
 if(!displayWidth||!displayHeight)return null;
 const x=Math.max(0,Math.min(frame.width-1,Math.floor(imageViewport.scrollLeft/displayWidth*frame.width)));
 const y=Math.max(0,Math.min(frame.height-1,Math.floor(imageViewport.scrollTop/displayHeight*frame.height)));
 const width=Math.max(1,Math.min(frame.width-x,Math.ceil(imageViewport.clientWidth/displayWidth*frame.width)));
 const height=Math.max(1,Math.min(frame.height-y,Math.ceil(imageViewport.clientHeight/displayHeight*frame.height)));
 return {x,y,width,height};
}

// 사진을 손가락으로 이동하거나 두 손가락으로 확대한다. (핸들 포토 포인터)
// 더블 터치 시 현재 확대 영역 인식을 시작하며 이동 중에는 오인식을 막는다.
const photoPointers=new Map();
let pinchDistance=0,multiTouch=false,lastTap=0,lastTapX=0,lastTapY=0;
function handlePhotoPointer(event){
 if(imageViewport.hidden||busy||!frozenMode||event.pointerType!=='touch')return;
 if(event.type==='pointerdown'){
  imageViewport.setPointerCapture(event.pointerId);
  photoPointers.set(event.pointerId,{x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,moved:false});
  if(photoPointers.size===2){
   const [a,b]=[...photoPointers.values()];
   pinchDistance=Math.hypot(a.x-b.x,a.y-b.y);
   multiTouch=true;lastTap=0;
  }
  return;
 }
 if(!photoPointers.has(event.pointerId))return;
 const prev=photoPointers.get(event.pointerId);
 if(event.type==='pointermove'){
  if(photoPointers.size===1){
   imageViewport.scrollLeft-=event.clientX-prev.x;
   imageViewport.scrollTop-=event.clientY-prev.y;
  }
  if(Math.hypot(event.clientX-prev.startX,event.clientY-prev.startY)>10)prev.moved=true;
  prev.x=event.clientX;prev.y=event.clientY;
  if(photoPointers.size===2){
   const [a,b]=[...photoPointers.values()];
   const distance=Math.hypot(a.x-b.x,a.y-b.y);
   if(pinchDistance>0){
    const bounds=imageViewport.getBoundingClientRect();
    setPhotoZoom(photoZoom*distance/pinchDistance,(a.x+b.x)/2-bounds.left,(a.y+b.y)/2-bounds.top);
   }
   pinchDistance=distance;
  }
  return;
 }
 photoPointers.delete(event.pointerId);
 if(event.type==='pointerup'&&!multiTouch&&!prev.moved){
  const now=performance.now();
  if(now-lastTap<330&&Math.hypot(event.clientX-lastTapX,event.clientY-lastTapY)<35){
   lastTap=0;if(activeTab!=='camera'){closeTools();scanCamera();}
  }else{lastTap=now;lastTapX=event.clientX;lastTapY=event.clientY;}
 }
 if(!photoPointers.size){pinchDistance=0;multiTouch=false;}
}

// 코드·위치 박스의 글꼴과 색상 등을 변경한다. (업데이트 박스 스타일)
// OCR 데이터는 유지하고 글자 크기 변경 시 박스 위치를 다시 계산한다.
function updateBoxStyle(){
 for(const type of ['code','place']){
  const font=document.getElementById(type+'Font').value;
  const size=document.getElementById(type+'Size').value;
  const opacity=document.getElementById(type+'Opacity').value;
  const bg=document.getElementById(type+'Bg').value;
  const color=document.getElementById(type+'Color').value;
  const border=document.getElementById(type+'Border').value;
  boxes.style.setProperty('--'+type+'-font',font);
  boxes.style.setProperty('--'+type+'-size',size+'px');
  boxes.style.setProperty('--'+type+'-opacity',opacity/100);
  boxes.style.setProperty('--'+type+'-bg',bg);
  boxes.style.setProperty('--'+type+'-color',color);
  boxes.style.setProperty('--'+type+'-border',border);
  document.getElementById(type+'SizeValue').value=size+'px';
  document.getElementById(type+'OpacityValue').value=opacity+'%';
 }
 if(detectedHits.length)showBoxes(detectedHits);
}

// 이미지 보정 방식을 변경한다. (스위치 코렉션 모드)
// 선택한 설정을 미리보기와 다음 OCR 검사에 적용한다.
function switchCorrectionMode(mode){
 if(busy||starting)return;
 filterMode.value=mode;
 correctionModeButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.filterMode===mode)));
 updatePreview();
}
toolDrawers.forEach(drawer=>drawer.addEventListener('toggle',()=>{if(drawer.open)closeTools(drawer);}));
imageViewport.addEventListener('pointerdown',handlePhotoPointer);
imageViewport.addEventListener('pointermove',handlePhotoPointer);
imageViewport.addEventListener('pointerup',handlePhotoPointer);
imageViewport.addEventListener('pointercancel',handlePhotoPointer);
imageViewport.addEventListener('dblclick',event=>{
 if(activeTab==='camera'||event.sourceCapabilities?.firesTouchEvents)return;
 closeTools();scanCamera();
});
// 위치 박스를 16방향으로 움직인다. (셋 로케이션 디렉션)
// 드래그 중 기존 OCR 결과의 박스 배치만 갱신한다.
let locationDirectionIndex=12;
const locationDial=document.getElementById('locationDial');
function setLocationDirection(index){
 locationDirectionIndex=(index+16)%16;
 const angle=(locationDirectionIndex-4)*Math.PI/8;
 locationDial.style.setProperty('--stick-x',Math.cos(angle)*55+'px');
 locationDial.style.setProperty('--stick-y',Math.sin(angle)*55+'px');
 document.getElementById('locationDirection').textContent='방향 '+(locationDirectionIndex+1)+'/16';
 if(detectedHits.length)showBoxes(detectedHits);
}
// 코드 박스를 원래 인식 좌표 기준으로 이동한다. (셋 코드 디렉션)
// OCR 좌표는 유지하고 박스 표시 위치만 바꾼다.
let codeDirectionIndex=null;
const codeDial=document.getElementById('codeDial');
function setCodeDirection(index){
 codeDirectionIndex=(index+16)%16;
 const angle=(codeDirectionIndex-4)*Math.PI/8;
 codeDial.style.setProperty('--stick-x',Math.cos(angle)*55+'px');
 codeDial.style.setProperty('--stick-y',Math.sin(angle)*55+'px');
 document.getElementById('codeDirection').textContent='방향 '+(codeDirectionIndex+1)+'/16';
 if(detectedHits.length)showBoxes(detectedHits);
}
// 조이스틱 드래그를 16개 방향으로 맞춘다. (핸들 로케이션 스틱)
// 터치·마우스 포인터의 각도를 이용해 위치 표시 방향을 변경한다.
function handleLocationStick(event){
 if(event.type==='pointerdown')event.currentTarget.setPointerCapture(event.pointerId);
 if(event.type==='pointermove'&&!event.currentTarget.hasPointerCapture(event.pointerId))return;
 if(event.type==='pointerup'||event.type==='pointercancel')return;
 const dial=event.currentTarget;
 const rect=dial.getBoundingClientRect();
 const dx=event.clientX-rect.left-rect.width/2,dy=event.clientY-rect.top-rect.height/2;
 if(Math.hypot(dx,dy)>8){
  const index=Math.round((Math.atan2(dy,dx)+Math.PI/2)/(Math.PI*2)*16);
  if(dial===codeDial)setCodeDirection(index);
  else setLocationDirection(index);
  saveSettings();
 }
}
locationDial.addEventListener('pointerdown',handleLocationStick);
locationDial.addEventListener('pointermove',handleLocationStick);
codeDial.addEventListener('pointerdown',handleLocationStick);
codeDial.addEventListener('pointermove',handleLocationStick);
setLocationDirection(12);
// 사진을 한 번 누르면 두 종류의 박스를 함께 숨기거나 표시한다. (토글 박시스)
// OCR 결과는 그대로 두고 화면 구석의 표시 상태만 변경한다.
function toggleBoxes(){
 if(imageViewport.hidden||!detectedHits.length)return;
 boxes.hidden=!boxes.hidden;
 const indicator=document.getElementById('boxVisibility');
 indicator.hidden=false;indicator.textContent=boxes.hidden?'박스 숨김':'박스 표시';
}
let tapStart=null;
imageViewport.addEventListener('pointerdown',event=>{if(event.isPrimary)tapStart={x:event.clientX,y:event.clientY};});
imageViewport.addEventListener('pointerup',event=>{
 if(event.pointerType==='touch'&&event.isPrimary&&tapStart&&Math.hypot(event.clientX-tapStart.x,event.clientY-tapStart.y)<10&&!multiTouch)toggleBoxes();
 tapStart=null;
});
imageViewport.addEventListener('click',event=>{if(event.pointerType!=='touch')toggleBoxes();});
document.querySelectorAll('.box-style-settings input,.box-style-settings select').forEach(input=>input.addEventListener('input',updateBoxStyle));
correctionModeButtons.forEach(button=>button.addEventListener('click',()=>switchCorrectionMode(button.dataset.filterMode)));
updateBoxStyle();
excel.addEventListener('change',loadExcel);
sheet.addEventListener('change',changeSheet);
start.addEventListener('click',startCamera);
stop.addEventListener('click',stopCamera);
resume.addEventListener('click',resumeCamera);
strength.addEventListener('input',changeFilter);
brightness.addEventListener('input',()=>{document.getElementById('brightnessValue').value=brightness.value;updatePreview();});
threshold.addEventListener('input',()=>{document.getElementById('thresholdValue').value=threshold.value;updatePreview();});
removeLines.addEventListener('change',updatePreview);
previewCorrection.addEventListener('change',updatePreview);
tabButtons.forEach(button=>button.addEventListener('click',()=>switchTab(button.dataset.tab)));
photoInput.addEventListener('change',loadPhoto);
document.getElementById('testGenerate').addEventListener('click',makeTestImage);
document.getElementById('testExport').addEventListener('click',exportTestExcel);
document.getElementById('testCount').addEventListener('change',makeTestImage);
document.getElementById('testLayout').addEventListener('change',makeTestImage);
document.getElementById('testNoise').addEventListener('change',makeTestImage);
// 카메라 정지 상태에서는 재촬영, 그 외에는 코드 인식을 실행한다. (핸들 스캔 버튼)
// 기존 OCR과 카메라 재개 기능을 변경하지 않고 연결한다.
function handleScanButton(){
 closeTools();
 if(activeTab==='camera'&&frozenMode)resumeCamera();
 else scanCamera();
}
readImage.addEventListener('click',handleScanButton);
window.addEventListener('pagehide',stopCamera);
restoreExcel();

// OCR 진행 상태를 화면에 표시한다. (쇼 스캔 프로그레스)
// 인식 엔진 데이터는 변경하지 않는다.
function showScanProgress(progress){
 status.textContent=recognitionStage+' 코드 인식 중… '+Math.round(progress*100)+'%';
}

// 카메라 준비 안내를 표시한다. (쇼 스캔 카메라 리콰이어드)
// 촬영 상태는 변경하지 않는다.
function showScanCameraRequired(){
 status.textContent='카메라를 켠 다음 코드 인식 시작을 누르세요.';
}

// 인식 시작 시 입력과 결과 화면을 잠근다. (쇼 스캔 스타트)
// OCR 실행 중 설정 변경을 방지한다.
function showScanStart(){
 lockInputs(true);excel.disabled=true;sheet.disabled=true;resume.disabled=true;strength.disabled=true;
 liveCanvas.setAttribute('aria-busy','true');
 raw.textContent='';scanStats.textContent='';status.textContent='원본·보정본 인식을 준비합니다…';
}

// 촬영한 이미지를 결과 화면에 표시한다. (쇼 스캔 프레임)
// 카메라와 사진은 기존 화면 비율을 유지한다.
function showScanFrame(){
 imageViewport.classList.toggle('camera-shot',activeTab==='camera');
 if(activeTab==='camera')setPhotoZoom(1);
 liveView.hidden=true;imageViewport.hidden=false;frozen.hidden=false;
 zoomLevel.hidden=false;zoomHint.hidden=false;
 boxes.replaceChildren();liveStatus.textContent='정지 화면 · 인식 결과를 확인하세요.';
}

// OCR 원문과 오류를 상세 창에 추가한다. (어펜드 스캔 로)
// 기록 데이터와 인식 결과에는 영향을 주지 않는다.
function appendScanRaw(name,value,failed){
 raw.textContent+='['+name+(failed?' 실패':'')+']\\n'+value+'\\n\\n';
}

// 인식 결과 박스와 상태 메시지를 표시한다. (쇼 스캔 리절츠)
// OCR 결과를 수정하지 않고 화면에만 반영한다.
function showScanResults(hits,area,stats,seconds,errorCount){
 showBoxes(hits);
 scanStats.textContent=(area?'확대 영역 · ':'전체 이미지 · ')+stats.join(' · ')+' → 합계 '+hits.length+'곳 · '+seconds+'초'+(errorCount?' · 일부 검사 실패':'');
 status.textContent=hits.length?hits.length+'개 코드 표시 · 확인 표시는 사진과 비교하세요.':'코드를 찾지 못함 · 확대 위치나 보정 설정을 바꿔 재검사하세요.';
 liveStatus.textContent='정지 화면 · 코드와 위치를 확인하세요.';
}

// 인식 오류를 화면에 표시한다. (쇼 스캔 페일러)
// OCR 워커 종료와 복구는 기존 인식 코드에서 처리한다.
function showScanFailure(error){
 status.textContent='인식 실패: '+error.message;
}

// 인식 완료 후 입력과 버튼 상태를 복원한다. (쇼 스캔 엔드)
// 다시 촬영 기능 및 사진 모드를 유지한다.
function showScanEnd(){
 lockInputs(false);excel.disabled=false;sheet.disabled=false;liveCanvas.setAttribute('aria-busy','false');
 strength.disabled=false;resume.disabled=!stream||!frozenMode;
 start.disabled=!!stream;readImage.textContent=activeTab==='camera'&&frozenMode?'다시 촬영':'코드 인식';
}

// 꺼진 카메라는 더블탭으로 켜고, 실행 중에는 두 손가락으로 확대한다. (핸들 라이브 터치)
// 미리보기와 촬영 이미지에 같은 확대 영역을 적용한다.
window.liveZoom=1;
const liveTouches=new Map();
let livePinch=0,liveLastTap=0,liveTapPoint=null;
function handleLiveTouch(event){
 if(activeTab!=='camera'||frozenMode||busy||starting||event.pointerType!=='touch')return;
 if(event.type==='pointerdown'){
  liveView.setPointerCapture(event.pointerId);
  liveTouches.set(event.pointerId,{x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY});
  if(liveTouches.size===2){
   const [a,b]=[...liveTouches.values()];
   livePinch=Math.hypot(a.x-b.x,a.y-b.y);liveLastTap=0;
  }
  return;
 }
 const point=liveTouches.get(event.pointerId);
 if(!point)return;
 if(event.type==='pointermove'){
  point.x=event.clientX;point.y=event.clientY;
  if(liveTouches.size===2&&stream){
   const [a,b]=[...liveTouches.values()],distance=Math.hypot(a.x-b.x,a.y-b.y);
   if(livePinch)window.liveZoom=Math.max(1,Math.min(6,window.liveZoom*distance/livePinch));
   livePinch=distance;
   liveStatus.textContent='카메라 확대 '+window.liveZoom.toFixed(1)+'배';
  }
  return;
 }
 const tapped=Math.hypot(point.x-point.startX,point.y-point.startY)<20;
 liveTouches.delete(event.pointerId);
 if(!liveTouches.size)livePinch=0;
 if(event.type==='pointerup'&&tapped&&!livePinch&&!stream){
  const now=performance.now();
  if(now-liveLastTap<350&&liveTapPoint&&Math.hypot(point.x-liveTapPoint.x,point.y-liveTapPoint.y)<40){
   liveLastTap=0;startCamera();
  }else{liveLastTap=now;liveTapPoint=point;}
 }
}
['pointerdown','pointermove','pointerup','pointercancel'].forEach(type=>liveView.addEventListener(type,handleLiveTouch));
liveView.addEventListener('dblclick',()=>{if(activeTab==='camera'&&!stream&&!starting)startCamera();});

// 인식·박스·테스트 입력값을 기기에 저장한다. (세이브 세팅스)
// 같은 주소와 브라우저에서 재접속하면 마지막 설정을 복원한다.
const settingsKey='code-scanner.settings.v1';
const settingsFields=[...document.querySelectorAll('#settingsDrawer input[id],#settingsDrawer select[id],#testControls input[id],#testControls select[id]')];
function saveSettings(){
 const values={};
 for(const input of settingsFields)values[input.id]=input.type==='checkbox'?input.checked:input.value;
 try{
  localStorage.setItem(settingsKey,JSON.stringify({values,codeDirection:codeDirectionIndex,locationDirection:locationDirectionIndex}));
 }catch(error){
  status.textContent='설정을 저장하지 못했습니다. 브라우저 저장 공간 설정을 확인하세요.';
 }
}

// 저장된 설정을 읽고 화면 표시에도 적용한다. (리스토어 세팅스)
// 잘못된 값은 무시하며 사진·OCR 결과·카메라 상태는 복원하지 않는다.
function restoreSettings(){
 try{
  const saved=JSON.parse(localStorage.getItem(settingsKey)||'null');
  if(!saved||!saved.values||typeof saved.values!=='object')return;
  for(const input of settingsFields){
   const value=saved.values[input.id];
   if(input.type==='checkbox'){
    if(typeof value==='boolean')input.checked=value;
   }else if(typeof value==='string'){
    if(input.tagName==='SELECT'&&![...input.options].some(option=>option.value===value))continue;
    if(input.id==='filterMode'&&!['print','contrast'].includes(value))continue;
    if(input.type==='range'||input.type==='number'){
     const number=Number(value);
     if(!value.trim()||!Number.isFinite(number)||number<Number(input.min)||number>Number(input.max))continue;
    }
    if(input.type==='color'&&!/^#[0-9a-f]{6}$/i.test(value))continue;
    input.value=value;
   }
  }
  if(Number.isInteger(saved.codeDirection)&&saved.codeDirection>=0&&saved.codeDirection<16)setCodeDirection(saved.codeDirection);
  if(Number.isInteger(saved.locationDirection)&&saved.locationDirection>=0&&saved.locationDirection<16)setLocationDirection(saved.locationDirection);
  strengthValue.value=strength.value;
  document.getElementById('brightnessValue').value=brightness.value;
  document.getElementById('thresholdValue').value=threshold.value;
  document.getElementById('testNoiseValue').value=document.getElementById('testNoise').value+'%';
  correctionModeButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.filterMode===filterMode.value)));
  updateBoxStyle();updatePreview();
 }catch(error){
  console.warn('저장된 설정을 복원하지 못했습니다.',error);
 }
}
settingsFields.forEach(input=>{
 input.addEventListener('input',saveSettings);
 input.addEventListener('change',saveSettings);
});
correctionModeButtons.forEach(button=>button.addEventListener('click',saveSettings));
restoreSettings();
