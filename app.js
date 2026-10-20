// 처리 중 이미지 변경과 중복 실행을 막는다. (록 인풋스)
// 탭·파일 선택·인식 버튼의 활성 상태를 함께 바꾼다.
function lockInputs(locked){
 tabButtons.forEach(button=>button.disabled=locked);
 correctionInputs.forEach(input=>input.disabled=locked);
 photoInput.disabled=locked;readImage.disabled=locked||(activeTab==='camera'?(!stream||frozenMode):!photoReady);
}

// 카메라·사진·테스트 입력 화면을 전환한다. (스위치 탭)
// 카메라를 종료하고 이전 화면의 결과가 새 입력에 남지 않게 한다.
function switchTab(tab){
 if(busy||starting||activeTab===tab)return;
 stopCamera();activeTab=tab;photoReady=false;frozenMode=false;
 imageViewport.classList.remove('zoomed');zoomImage.setAttribute('aria-pressed','false');zoomImage.textContent='사진 2배 확대';zoomImage.hidden=true;
 detectedHits=[];boxes.replaceChildren();raw.textContent='';scanStats.textContent='';
 tabButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.tab===tab)));
 document.getElementById('cameraControls').hidden=tab!=='camera';
 document.getElementById('photoControls').hidden=tab!=='photo';
 document.getElementById('testControls').hidden=tab!=='test';
 readImage.disabled=true;
 liveView.hidden=tab!=='camera';liveStatus.hidden=tab!=='camera';frozen.hidden=true;
 strength.disabled=false;photoInput.value='';
 liveCanvas.getContext('2d').clearRect(0,0,liveCanvas.width,liveCanvas.height);
 status.textContent=tab==='camera'?'카메라를 켠 다음 코드 인식 시작을 누르세요.':'사진을 선택한 뒤 코드 인식 시작을 누르세요.';
 if(tab==='test')makeTestImage();
}

// 작은 코드 박스를 확대하거나 원래 배율로 돌린다. (토글 이미지 줌)
// 박스와 사진을 함께 확대하고 가로·세로 스크롤을 허용한다.
function toggleImageZoom(){
 const zoomed=imageViewport.classList.toggle('zoomed');
 zoomImage.setAttribute('aria-pressed',String(zoomed));zoomImage.textContent=zoomed?'사진 원래 크기':'사진 2배 확대';
}
// 인식 박스의 진하기만 조절한다. (체인지 박스 오패시티)
// 원본 사진·인식 결과·박스 클릭 영역은 유지한다.
function changeBoxOpacity(){
 boxOpacityValue.value=boxOpacity.value;
 boxes.style.setProperty('--box-opacity',String(Number(boxOpacity.value)/100));
}

// 선택한 이미지 보정 탭을 바꾼다. (스위치 코렉션 모드)
// OCR에 적용될 보정 방식과 탭 표시를 함께 갱신한다.
function switchCorrectionMode(mode){
 if(busy||starting)return;
 filterMode.value=mode;
 correctionModeButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.filterMode===mode)));
}
boxOpacity.addEventListener('input',changeBoxOpacity);
correctionModeButtons.forEach(button=>button.addEventListener('click',()=>switchCorrectionMode(button.dataset.filterMode)));
changeBoxOpacity();
zoomImage.addEventListener('click',toggleImageZoom);
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
readImage.addEventListener('click',scanCamera);
window.addEventListener('pagehide',stopCamera);
restoreExcel();
