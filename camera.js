// 보정된 실시간 미리보기를 갱신한다. (페인트 라이브)
// 초당 약 10프레임으로 표시하고 정지 화면에서는 갱신을 멈춘다.
function paintLive(time){
 if(!stream||frozenMode){animationId=0;return;}
 if(time-lastPaint>=100){drawCorrected(liveCanvas);lastPaint=time;}
 animationId=requestAnimationFrame(paintLive);
}

// 인식된 각 코드의 중앙에 빨간 점을 표시한다. (쇼 도츠)
// 엑셀 등록 여부와 관계없이 정규식에 맞는 코드만 표시한다.
function showDots(hits){
 dots.replaceChildren();
 for(const hit of hits){
  const dot=document.createElement('span'),b=hit.bbox;dot.className='red-dot';
  dot.style.left=((b.x0+b.x1)/2/liveFrame.width*100)+'%';
  dot.style.top=((b.y0+b.y1)/2/liveFrame.height*100)+'%';
  dot.title=hit.code;dots.append(dot);
 }
}

// 터치 전에 화면 전체를 반복 검사한다. (체크 라이브)
// 기록을 추가하지 않고 최신 검사 결과의 코드 위치에 점만 표시한다.
async function checkLive(){
 clearTimeout(liveTimer);
 if(!stream||frozenMode)return;
 if(busy||starting||liveJob){liveTimer=setTimeout(checkLive,600);return;}
 const epoch=liveEpoch;dots.replaceChildren();liveStatus.textContent='화면 코드 확인 중…';
 liveJob=(async()=>{
  if(!drawCorrected(liveFrame))return;
  const engine=await getWorker();
  if(epoch!==liveEpoch||frozenMode||!stream)return;
  const {data}=await engine.recognize(liveFrame,{}, {text:true,blocks:true});
  if(epoch!==liveEpoch||frozenMode||!stream)return;
  const hits=collectHits(data);showDots(hits);
  liveStatus.textContent=hits.length?hits.length+'곳 감지 · 빨간 점 위치의 코드를 확인하세요.':'정규식에 맞는 코드가 아직 보이지 않습니다.';
 })();
 try{await liveJob;}
 catch(error){if(epoch===liveEpoch&&!frozenMode)liveStatus.textContent='실시간 확인 실패: '+error.message;}
 finally{liveJob=null;if(stream&&!frozenMode)liveTimer=setTimeout(checkLive,600);}
}

// 미리보기와 주기적 OCR 검사를 시작한다. (비긴 라이브)
// 이전 표시를 지우고 새 화면의 코드 위치를 검사한다.
function beginLive(){
 liveEpoch++;dots.replaceChildren();clearTimeout(liveTimer);cancelAnimationFrame(animationId);
 lastPaint=0;animationId=requestAnimationFrame(paintLive);liveTimer=setTimeout(checkLive,600);
}

// 정지 화면을 닫고 실시간 영상으로 돌아간다. (리줌 카메라)
// 이전 박스를 지우고 다음 촬영을 준비한다.
async function resumeCamera(){
 if(busy||!stream)return;
 try{
  await camera.play();frozenMode=false;detectedHits=[];boxes.replaceChildren();
  frozen.hidden=true;imageViewport.hidden=true;zoomLevel.hidden=true;zoomHint.hidden=true;liveView.hidden=false;resume.disabled=true;strength.disabled=false;readImage.disabled=false;readImage.textContent='코드 인식';beginLive();
  status.textContent='코드 인식 시작 버튼을 누르면 화면을 멈추고 코드를 인식합니다.';
 }catch(error){status.textContent='영상 재생 실패: '+error.message;}
}

// 후면 카메라를 켠다. (스타트 카메라)
// 권한 거부와 HTTPS 미사용을 아래 상태 메시지로 안내한다.
async function startCamera(){
 if(starting||stream||busy)return;
 starting=true;lockInputs(true);start.disabled=true;status.textContent='카메라를 켜는 중…';
 try{
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error('HTTPS 주소에서 Chrome으로 열어주세요.');
  const ratio=liveView.clientWidth/Math.max(1,liveView.clientHeight);
  stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080},aspectRatio:{ideal:ratio}},audio:false});
  camera.srcObject=stream;await camera.play();stop.disabled=false;
  frozenMode=false;detectedHits=[];boxes.replaceChildren();frozen.hidden=true;imageViewport.hidden=true;zoomLevel.hidden=true;zoomHint.hidden=true;liveView.hidden=false;resume.disabled=true;strength.disabled=false;beginLive();
  status.textContent='코드 인식 시작 버튼을 누르면 화면을 멈추고 코드를 인식합니다.';
 }catch(error){stopCamera();status.textContent=error.name==='NotAllowedError'?'카메라 권한이 거부되었습니다. 브라우저 사이트 설정에서 허용하세요.':'카메라 오류: '+error.message;}
 finally{starting=false;lockInputs(false);start.disabled=!!stream;}
}

// 사용 중인 카메라를 끈다. (스톱 카메라)
// 모든 영상 트랙을 종료하고 다시 켜기 버튼을 활성화한다.
function stopCamera(){
 if(stream)stream.getTracks().forEach(track=>track.stop());
 liveEpoch++;clearTimeout(liveTimer);cancelAnimationFrame(animationId);dots.replaceChildren();liveStatus.textContent='카메라 꺼짐';
 stream=null;camera.srcObject=null;stop.disabled=true;resume.disabled=true;readImage.disabled=true;start.disabled=busy;
 if(!busy)status.textContent='카메라가 꺼졌습니다.';
}
