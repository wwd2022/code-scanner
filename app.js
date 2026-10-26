// 처리 중 입력·설정 변경을 잠근다. (록 인풋스)
// 카메라·사진 상태에 따라 인식 버튼을 활성화한다.
function lockInputs(locked){
 tabButtons.forEach(button=>button.disabled=locked);
 correctionInputs.forEach(input=>input.disabled=locked);
 syncScanStageInputs(locked);
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
// 예시 박스도 실제 박스의 스타일과 배치 함수를 사용한다.
function updateDesignPreview(){
 const preview=document.getElementById('designPreview');
 preview.style.cssText=boxes.style.cssText;
 const width=preview.clientWidth,height=preview.clientHeight;
 if(!width||!height)return;
 const anchor={x:width*.25,y:height*70/160,w:width*.5,h:height*24/160};
 placeLabel(document.getElementById('previewCodeBox'),anchor,codeDirectionIndex===null?-Math.PI/2:(codeDirectionIndex-4)*Math.PI/8,width,height);
 placeLabel(document.getElementById('previewPlaceBox'),anchor,(locationDirectionIndex-4)*Math.PI/8,width,height);
}
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
 updateDesignPreview();
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
// 연속 방향 변경은 마지막 값만 저장한다.
let locationDirectionIndex=12;
const locationDial=document.getElementById('locationDial');
function setLocationDirection(index,persist=true){
 const next=((index%16)+16)%16;
 if(persist&&locationDirectionIndex===next)return;
 locationDirectionIndex=next;
 if(persist)queueSettingsSave();
 const angle=(locationDirectionIndex-4)*Math.PI/8;
 locationDial.style.setProperty('--stick-x',Math.cos(angle)*55+'px');
 locationDial.style.setProperty('--stick-y',Math.sin(angle)*55+'px');
 document.getElementById('locationDirection').textContent='방향 '+(locationDirectionIndex+1)+'/16';
 updateDesignPreview();
 if(detectedHits.length)showBoxes(detectedHits);
}
// 코드 박스를 원래 인식 좌표 기준으로 이동한다. (셋 코드 디렉션)
// OCR 좌표는 유지하고 마지막 방향을 저장한다.
let codeDirectionIndex=null;
const codeDial=document.getElementById('codeDial');
function setCodeDirection(index,persist=true){
 const next=((index%16)+16)%16;
 if(persist&&codeDirectionIndex===next)return;
 codeDirectionIndex=next;
 if(persist)queueSettingsSave();
 const angle=(codeDirectionIndex-4)*Math.PI/8;
 codeDial.style.setProperty('--stick-x',Math.cos(angle)*55+'px');
 codeDial.style.setProperty('--stick-y',Math.sin(angle)*55+'px');
 document.getElementById('codeDirection').textContent='방향 '+(codeDirectionIndex+1)+'/16';
 updateDesignPreview();
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
 }
}
locationDial.addEventListener('pointerdown',handleLocationStick);
locationDial.addEventListener('pointermove',handleLocationStick);
codeDial.addEventListener('pointerdown',handleLocationStick);
codeDial.addEventListener('pointermove',handleLocationStick);
// 사진을 한 번 누르면 두 종류의 박스를 함께 숨기거나 표시한다. (토글 박시스)
// OCR 결과는 그대로 두고 화면 구석의 표시 상태만 변경한다.
function toggleBoxes(){
 if(imageViewport.hidden||!detectedHits.length)return;
 boxes.hidden=!boxes.hidden;
 if(!boxes.hidden)showBoxes(detectedHits);
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
updateBoxStyle();
excel.addEventListener('change',loadExcel);
sheet.addEventListener('change',changeSheet);
start.addEventListener('click',startCamera);
stop.addEventListener('click',stopCamera);
resume.addEventListener('click',resumeCamera);
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
function showScanStart(stages){
 lockInputs(true);excel.disabled=true;sheet.disabled=true;resume.disabled=true;strength.disabled=true;
 liveCanvas.setAttribute('aria-busy','true');
 document.getElementById('scanSingleCount').value='검사 중…';
 document.querySelectorAll('[data-stage-count]').forEach(output=>output.value=stages.includes(output.dataset.stageCount)?'대기':'미실행');
 raw.textContent='';scanStats.textContent='';status.textContent='보정 이미지 준비 · 선택한 '+stages.length+'단계 검사';
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
// 같은 결과를 조회 기록과 연결한다.
function showScanResults(hits,area,stats,seconds,errorCount){
 for(const hit of hits)addRecord(hit);
 refreshRecords();
 showBoxes(hits);
 scanStats.textContent=(area?'확대 영역 · ':'전체 이미지 · ')+stats.join(' · ')+' → 합계 '+hits.length+'곳 · '+seconds+'초'+(errorCount?' · 일부 검사 실패':'');
 status.textContent=hits.length?hits.length+'개 코드 표시 · 확인 표시는 사진과 비교하세요.':'코드를 찾지 못함 · 확대 위치나 보정 설정을 바꿔 재검사하세요.';
 liveStatus.textContent='정지 화면 · 코드와 위치를 확인하세요.';
}

// 인식 오류를 화면에 표시한다. (쇼 스캔 페일러)
// OCR 워커 종료와 복구는 기존 인식 코드에서 처리한다.
function showScanFailure(error){
 document.getElementById('scanSingleCount').value='실패';
 document.querySelectorAll('[data-stage-count]').forEach(output=>{if(output.value==='대기')output.value='실패';});
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
let settingsSaveTimer=0,settingsDirty=false;
// 연속 입력은 마지막 값만 저장하고 페이지를 떠날 때 마무리한다.
function queueSettingsSave(){
 settingsDirty=true;clearTimeout(settingsSaveTimer);
 settingsSaveTimer=setTimeout(saveSettings,300);
}
function saveSettings(){
 clearTimeout(settingsSaveTimer);settingsSaveTimer=0;
 if(!settingsDirty)return;
 settingsDirty=false;
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
  if(!saved||typeof saved!=='object')return;
  const values=saved.values&&typeof saved.values==='object'?saved.values:{};
  for(const input of settingsFields){
   const value=values[input.id];
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
  const codeDirection=Number(saved.codeDirection),locationDirection=Number(saved.locationDirection);
  if(saved.codeDirection!=null&&Number.isInteger(codeDirection)&&codeDirection>=0&&codeDirection<16)setCodeDirection(codeDirection,false);
  if(saved.locationDirection!=null&&Number.isInteger(locationDirection)&&locationDirection>=0&&locationDirection<16)setLocationDirection(locationDirection,false);
  strengthValue.value=strength.value;
  document.getElementById('screenNoiseValue').value=screenNoise.value;
  updateSpeckOutputs();
  document.getElementById('brightnessValue').value=brightness.value;
  document.getElementById('thresholdValue').value=threshold.value;
  document.getElementById('testNoiseValue').value=document.getElementById('testNoise').value+'%';
  if(typeof values.printCorrection!=='boolean')printCorrection.checked=filterMode.value==='print';
  filterMode.value=printCorrection.checked?'print':'contrast';
  updateBoxStyle();updatePreview();
 }catch(error){
  console.warn('저장된 설정을 복원하지 못했습니다.',error);
 }
}
settingsFields.forEach(input=>{
 input.addEventListener('input',queueSettingsSave);
 input.addEventListener('change',queueSettingsSave);
});
window.addEventListener('pagehide',saveSettings);
setLocationDirection(locationDirectionIndex,false);
restoreSettings();

// 조절하는 슬라이더와 제목만 하단에 표시한다.
// 설정창은 투명하게 만들고 원본 표시 선택은 유지한다.
const settingsDrawer=document.getElementById('settingsDrawer');
const settingsPanelButtons=[...settingsDrawer.querySelectorAll('[data-settings-panel]')];
settingsPanelButtons.forEach(button=>button.addEventListener('click',()=>{
 endSettingsPreview();
 for(const tab of settingsPanelButtons){
  const selected=tab===button;
  tab.setAttribute('aria-pressed',String(selected));
  document.getElementById(tab.dataset.settingsPanel).hidden=!selected;
 }
 settingsDrawer.querySelector('.drawer-body').scrollTop=0;
 updateDesignPreview();
}));
const previewInputs=new Set([strength,previewQuality,ocrSize,removeSpecks,speckArea,speckThreshold,screenNoise,printCorrection,brightness,threshold,removeLines,previewCorrection]);
let adjustmentPointer=null,adjustmentTimer=0,adjustmentFrame=0;
let adjustmentSlider=null,adjustmentLabel=null;
function beginSettingsPreview(event){
 if(!previewInputs.has(event.target)||!event.target.matches('input[type=range]')||busy||starting)return;
 if(event.type==='pointerdown'){
  adjustmentPointer=event.pointerId;
  event.target.setPointerCapture(event.pointerId);
 }
 clearTimeout(adjustmentTimer);
 if(adjustmentSlider!==event.target){
  adjustmentSlider?.classList.remove('adjustment-slider');
  adjustmentLabel?.classList.remove('adjustment-label');
  adjustmentSlider=event.target;
  adjustmentLabel=adjustmentSlider.closest('label')||settingsDrawer.querySelector('label[for="'+adjustmentSlider.id+'"]');
  adjustmentSlider.classList.add('adjustment-slider');
  adjustmentLabel?.classList.add('adjustment-label');
 }
 settingsAdjusting=true;settingsDrawer.classList.add('adjusting');
 settingsDrawer.closest('main').classList.add('adjusting-settings');
 queueSettingsPreview();
 if(adjustmentPointer===null)adjustmentTimer=setTimeout(endSettingsPreview,700);
}

// 여러 입력 이벤트를 한 화면 갱신으로 모은다.
// 가장 최근 설정값만 사용하고 중간 값의 중복 보정은 생략한다.
function queueSettingsPreview(){
 if(!adjustmentFrame)adjustmentFrame=requestAnimationFrame(paintSettingsPreview);
}
function paintSettingsPreview(){
 adjustmentFrame=0;
 updatePreview();
}

// 보정 입력의 표시·무효화·미리보기 갱신을 한 경로로 모은다.
function handleCorrectionInput(event){
 const input=event.target;
 if(!previewInputs.has(input))return;
 if(input===printCorrection)filterMode.value=printCorrection.checked?'print':'contrast';
 const output=document.getElementById(input.id+'Value');
 if(input.type==='range'&&output)output.value=input.value;
 liveEpoch++;dots.replaceChildren();
 if(input.type==='range')beginSettingsPreview(event);
 else queueSettingsPreview();
}

// 슬라이더 조절이 끝나면 원래 표시 설정으로 돌아간다. (엔드 세팅스 프리뷰)
// 슬라이더·제목의 원래 배치와 미리보기 ON/OFF 선택을 복원한다.
function endSettingsPreview(event){
 if(event?.pointerId!==undefined&&event.pointerId!==adjustmentPointer)return;
 if(!settingsAdjusting)return;
 clearTimeout(adjustmentTimer);adjustmentPointer=null;
 cancelAnimationFrame(adjustmentFrame);adjustmentFrame=0;
 settingsAdjusting=false;settingsDrawer.classList.remove('adjusting');
 settingsDrawer.closest('main').classList.remove('adjusting-settings');
 adjustmentSlider?.classList.remove('adjustment-slider');
 adjustmentLabel?.classList.remove('adjustment-label');
 adjustmentSlider=null;adjustmentLabel=null;
 queueSettingsPreview();
}
settingsDrawer.addEventListener('pointerdown',beginSettingsPreview);
settingsDrawer.addEventListener('input',handleCorrectionInput);
settingsDrawer.addEventListener('toggle',()=>{if(!settingsDrawer.open)endSettingsPreview();});
window.addEventListener('pointerup',endSettingsPreview);
window.addEventListener('pointercancel',endSettingsPreview);
window.addEventListener('blur',endSettingsPreview);

// 회전·화면 크기·이미지 배치가 바뀌면 현재 좌표로 다시 배치한다.
if(typeof ResizeObserver!=='undefined'){
 const boxResizeObserver=new ResizeObserver(()=>{if(frozenMode)showBoxes(detectedHits);});
 boxResizeObserver.observe(frozen);
}else window.addEventListener('resize',()=>{if(frozenMode)showBoxes(detectedHits);});



// 확대 검사 사용 여부와 처리 상태에 맞춰 단계 선택을 잠근다.
// 선택값은 유지하며 기존 설정 저장·복원 방식을 사용한다.
function syncScanStageInputs(locked=busy||starting){
 for(const input of scanStageInputs)input.disabled=locked||(!deepScan.checked&&input.dataset.scanStage.startsWith('zoom'));
}

// 각 단계의 최신 발견 수 또는 실패 상태를 표시한다.
// 최종 결과는 별도로 중복 통합하므로 단계별 수에는 중복이 포함된다.
function showScanStageResult(region,count,failed){
 const output=document.querySelector('[data-stage-count="'+region.key+'"]');
 if(output)output.value=failed?'실패':count+'개';
}
deepScan.addEventListener('change',()=>syncScanStageInputs());
syncScanStageInputs();

// 작은 영역 제거 설정의 현재 숫자를 표시한다.
// 입력·저장값 복원 시 같은 표시 처리를 사용한다.
function updateSpeckOutputs(){
 document.getElementById('speckAreaValue').value=speckArea.value;
 document.getElementById('speckThresholdValue').value=speckThreshold.value;
}


window.addEventListener('resize',updateDesignPreview);
