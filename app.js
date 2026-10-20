// 처리 중 입력·설정 변경을 잠근다. (록 인풋스)
// 카메라·사진 상태에 따라 인식 버튼을 활성화한다.
function lockInputs(locked){
 tabButtons.forEach(button=>button.disabled=locked);
 correctionInputs.forEach(input=>input.disabled=locked);
 photoInput.disabled=locked;
 readImage.disabled=locked||(activeTab==='camera'?(!stream||frozenMode):!photoReady);
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
 detectedHits=[];boxes.replaceChildren();raw.textContent='';scanStats.textContent='';
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
}

// 두 손가락 중심을 기준으로 사진 배율을 바꾼다. (셋 포토 줌)
// 스크롤 위치를 보정해 확대 전 같은 사진 지점을 유지한다.
let photoZoom=1;
function setPhotoZoom(value,centerX=imageViewport.clientWidth/2,centerY=imageViewport.clientHeight/2){
 const next=Math.max(1,Math.min(6,value)),ratio=next/photoZoom;
 const left=(imageViewport.scrollLeft+centerX)*ratio-centerX;
 const top=(imageViewport.scrollTop+centerY)*ratio-centerY;
 photoZoom=next;frozen.style.width=(next*100)+'%';
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
 if(activeTab==='camera'||imageViewport.hidden||busy||!frozenMode||event.pointerType!=='touch')return;
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
   lastTap=0;closeTools();scanCamera();
  }else{lastTap=now;lastTapX=event.clientX;lastTapY=event.clientY;}
 }
 if(!photoPointers.size){pinchDistance=0;multiTouch=false;}
}

// 인식 박스 투명도를 변경한다. (체인지 박스 오패시티)
// 이미지나 OCR 결과는 수정하지 않는다.
function changeBoxOpacity(){
 boxOpacityValue.value=boxOpacity.value;
 boxes.style.setProperty('--box-opacity',String(Number(boxOpacity.value)/100));
}

// 이미지 보정 방식을 변경한다. (스위치 코렉션 모드)
// 선택한 설정을 다음 OCR 검사에 적용한다.
function switchCorrectionMode(mode){
 if(busy||starting)return;
 filterMode.value=mode;
 correctionModeButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.filterMode===mode)));
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
boxOpacity.addEventListener('input',changeBoxOpacity);
correctionModeButtons.forEach(button=>button.addEventListener('click',()=>switchCorrectionMode(button.dataset.filterMode)));
changeBoxOpacity();
excel.addEventListener('change',loadExcel);
sheet.addEventListener('change',changeSheet);
start.addEventListener('click',startCamera);
stop.addEventListener('click',stopCamera);
resume.addEventListener('click',resumeCamera);
strength.addEventListener('input',changeFilter);
brightness.addEventListener('input',()=>document.getElementById('brightnessValue').value=brightness.value);
threshold.addEventListener('input',()=>document.getElementById('thresholdValue').value=threshold.value);
tabButtons.forEach(button=>button.addEventListener('click',()=>switchTab(button.dataset.tab)));
photoInput.addEventListener('change',loadPhoto);
readImage.addEventListener('click',()=>{closeTools();scanCamera();});
window.addEventListener('pagehide',stopCamera);
restoreExcel();
