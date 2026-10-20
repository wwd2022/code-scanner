// 선택한 사진의 원본을 표시한다. (프리뷰 포토)
// 이전 인식 박스를 지우며 원본 픽셀은 유지한다.
function previewPhoto(){
 frame.width=photoSource.width;frame.height=photoSource.height;
 const ctx=frame.getContext('2d',{willReadFrequently:true});
 ctx.drawImage(photoSource,0,0);
 // 사진 원본 위에 인식 박스를 표시해 보정 결과와 비교한다.
 detectedHits=[];boxes.replaceChildren();raw.textContent='';scanStats.textContent='';
 frozenMode=true;frozen.hidden=false;liveView.hidden=true;zoomImage.hidden=false;
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

// 선택한 사진을 읽고 크기를 줄여 미리 보여준다. (로드 포토)
// 큰 사진은 긴 변 3200픽셀로 줄이고 임시 주소를 해제한다.
async function loadPhoto(){
 const file=photoInput.files[0];if(!file||busy||starting)return;
 busy=true;lockInputs(true);excel.disabled=true;sheet.disabled=true;strength.disabled=true;
 const url=URL.createObjectURL(file);
 try{
  status.textContent='사진을 읽는 중…';
  const picture=new Image();picture.src=url;await picture.decode();
  const scale=Math.min(1,3200/Math.max(picture.naturalWidth,picture.naturalHeight));
  photoSource.width=Math.max(1,Math.round(picture.naturalWidth*scale));
  photoSource.height=Math.max(1,Math.round(picture.naturalHeight*scale));
  photoSource.getContext('2d').drawImage(picture,0,0,photoSource.width,photoSource.height);
  photoReady=true;previewPhoto();
 }catch(error){
  photoReady=false;frozen.hidden=true;zoomImage.hidden=true;boxes.replaceChildren();
  status.textContent='사진을 읽지 못했습니다. JPG 또는 PNG 사진으로 다시 선택하세요.';
 }finally{
  URL.revokeObjectURL(url);photoInput.value='';busy=false;lockInputs(false);
  excel.disabled=false;sheet.disabled=false;strength.disabled=false;
 }
}
