// 픽셀에 흑백과 대비 보정을 적용한다. (어플라이 필터)
// 강도 0은 원본이며 미리보기와 OCR에 동일한 픽셀을 사용한다.
function applyFilter(pixels,amount){
 if(!amount)return;
 const mix=amount/100,contrast=1+mix*1.5;
 for(let i=0;i<pixels.length;i+=4){
  const gray=pixels[i]*0.299+pixels[i+1]*0.587+pixels[i+2]*0.114;
  for(let channel=0;channel<3;channel++){
   const blended=pixels[i+channel]*(1-mix)+gray*mix;
   pixels[i+channel]=Math.max(0,Math.min(255,(blended-128)*contrast+128));
  }
 }
}

// 카메라 프레임을 보정해서 캔버스에 그린다. (드로 코렉티드)
// 화면 전체 비율을 유지하며 이 영상에서 코드를 인식한다.
function drawCorrected(target,amount=Number(strength.value)){
 if(camera.readyState<2||!camera.videoWidth)return false;
 const scale=Math.min(1,2200/Math.max(camera.videoWidth,camera.videoHeight));
 const width=Math.round(camera.videoWidth*scale),height=Math.round(camera.videoHeight*scale);
 if(target.width!==width||target.height!==height){target.width=width;target.height=height;}
 const ctx=target.getContext('2d',{willReadFrequently:true});ctx.drawImage(camera,0,0,width,height);
 if(amount){
  const image=ctx.getImageData(0,0,width,height);applyFilter(image.data,amount);ctx.putImageData(image,0,0);
 }
 return true;
}

// 보정 강도를 바꾸고 이전 점 표시를 지운다. (체인지 필터)
// 다음 검사부터 새 보정 강도로 코드를 읽는다.
function changeFilter(){
 strengthValue.value=strength.value;liveEpoch++;dots.replaceChildren();
 if(stream&&!frozenMode){drawCorrected(liveCanvas);liveStatus.textContent='보정 변경 · 다음 코드 검사 중…';}
 if(activeTab!=='camera'&&photoReady)previewPhoto();
}
