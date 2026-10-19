// 처리 중 이미지 변경과 중복 실행을 막는다. (록 인풋스)
// 탭·파일 선택·인식 버튼의 활성 상태를 함께 바꾼다.
function lockInputs(locked){
 tabButtons.forEach(button=>button.disabled=locked);
 photoInput.disabled=locked;readImage.disabled=locked||!photoReady;
}

// 원본 사진에 현재 보정을 적용해 표시한다. (프리뷰 포토)
// 이전 인식 박스를 지우며 원본 픽셀은 유지한다.
function previewPhoto(){
 frame.width=photoSource.width;frame.height=photoSource.height;
 const ctx=frame.getContext('2d',{willReadFrequently:true});
 ctx.drawImage(photoSource,0,0);
 const pixels=ctx.getImageData(0,0,frame.width,frame.height);
 applyFilter(pixels.data,Number(strength.value));ctx.putImageData(pixels,0,0);
 detectedHits=[];boxes.replaceChildren();raw.textContent='';scanStats.textContent='';
 frozenMode=true;frozen.hidden=false;liveView.hidden=true;
 readImage.disabled=false;strength.disabled=false;
 status.textContent='이미지 인식을 누르세요. 인식한 박스를 누르면 기록됩니다.';
}

// 테스트용 코드 이미지를 만든다. (메이크 테스트 이미지)
// 실제 OCR에 넣을 픽셀을 만들며 엑셀 데이터는 바꾸지 않는다.
function makeTestImage(){
 photoSource.width=1200;photoSource.height=700;
 const ctx=photoSource.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,1200,700);
 ctx.fillStyle='#111';ctx.font='bold 64px monospace';
 ['AB12-A00345','1234-123456','ZX90-B67890'].forEach((code,index)=>ctx.fillText(code,100,160+index*190));
 photoReady=true;previewPhoto();
}

// 카메라·사진·테스트 입력 화면을 전환한다. (스위치 탭)
// 카메라를 종료하고 이전 화면의 결과가 새 입력에 남지 않게 한다.
function switchTab(tab){
 if(busy||starting||activeTab===tab)return;
 stopCamera();activeTab=tab;photoReady=false;frozenMode=false;
 detectedHits=[];boxes.replaceChildren();raw.textContent='';scanStats.textContent='';
 tabButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.tab===tab)));
 document.getElementById('cameraControls').hidden=tab!=='camera';
 document.getElementById('photoControls').hidden=tab!=='photo';
 document.getElementById('testControls').hidden=tab!=='test';
 readImage.hidden=tab==='camera';readImage.disabled=true;
 liveView.hidden=tab!=='camera';liveStatus.hidden=tab!=='camera';frozen.hidden=true;
 strength.disabled=false;photoInput.value='';
 liveCanvas.getContext('2d').clearRect(0,0,liveCanvas.width,liveCanvas.height);
 status.textContent=tab==='camera'?'카메라를 켜고 화면을 터치하세요.':'휴대폰에 저장된 사진을 선택하세요.';
 if(tab==='test')makeTestImage();
}

// 선택한 사진을 읽고 크기를 줄여 미리 보여준다. (로드 포토)
// 큰 사진은 긴 변 2200픽셀로 줄이고 임시 주소를 해제한다.
async function loadPhoto(){
 const file=photoInput.files[0];if(!file||busy||starting)return;
 busy=true;lockInputs(true);excel.disabled=true;sheet.disabled=true;strength.disabled=true;
 const url=URL.createObjectURL(file);
 try{
  status.textContent='사진을 읽는 중…';
  const picture=new Image();picture.src=url;await picture.decode();
  const scale=Math.min(1,2200/Math.max(picture.naturalWidth,picture.naturalHeight));
  photoSource.width=Math.max(1,Math.round(picture.naturalWidth*scale));
  photoSource.height=Math.max(1,Math.round(picture.naturalHeight*scale));
  photoSource.getContext('2d').drawImage(picture,0,0,photoSource.width,photoSource.height);
  photoReady=true;previewPhoto();
 }catch(error){
  photoReady=false;frozen.hidden=true;boxes.replaceChildren();
  status.textContent='사진을 읽지 못했습니다. JPG 또는 PNG 사진으로 다시 선택하세요.';
 }finally{
  URL.revokeObjectURL(url);photoInput.value='';busy=false;lockInputs(false);
  excel.disabled=false;sheet.disabled=false;strength.disabled=false;
 }
}
excel.addEventListener('change',loadExcel);
sheet.addEventListener('change',changeSheet);
start.addEventListener('click',startCamera);
stop.addEventListener('click',stopCamera);
resume.addEventListener('click',resumeCamera);
strength.addEventListener('input',changeFilter);
liveCanvas.addEventListener('click',scanCamera);
liveCanvas.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();scanCamera();}});
tabButtons.forEach(button=>button.addEventListener('click',()=>switchTab(button.dataset.tab)));
photoInput.addEventListener('change',loadPhoto);
readImage.addEventListener('click',scanCamera);
window.addEventListener('pagehide',stopCamera);
restoreExcel();
