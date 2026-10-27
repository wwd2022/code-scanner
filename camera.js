// 원본 또는 보정된 실시간 미리보기를 갱신한다. (페인트 라이브)
// 슬라이더 조절 중에는 공통 입력 처리에 미리보기 갱신을 맡긴다.
function paintLive(time){
 if(!stream||frozenMode){animationId=0;return;}
 if(!settingsAdjusting&&time-lastPaint>=(previewCorrection.checked?250:100)){updatePreview();lastPaint=time;}
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

// 처리 시간이 검사 간격에 이미 포함되며 실행은 한 건만 유지한다.
function scheduleLiveCheck(wait=null){
 clearTimeout(liveTimer);
 if(!stream||frozenMode||activeTab!=='camera'||!liveOcr.checked)return;
 const delay=wait??Math.max(50,Number(liveInterval.value)-(performance.now()-liveLastStarted));
 liveTimer=setTimeout(checkLive,delay);
}
// 실시간 OCR도 촬영 후 인식과 같은 보정·워커 경로를 사용한다.
async function checkLive(){
 clearTimeout(liveTimer);
 if(!stream||frozenMode||activeTab!=='camera'||!liveOcr.checked)return;
 const delay=Number(liveInterval.value);
 if(busy||starting||liveJob||settingsAdjusting||document.hidden){scheduleLiveCheck(Math.max(150,delay));return;}
 const epoch=liveEpoch;
 const isCurrent=()=>epoch===liveEpoch&&!frozenMode&&!!stream&&liveOcr.checked&&!busy;
 liveLastStarted=performance.now();
 if(!dots.childElementCount)liveStatus.textContent='화면 코드 확인 중…';
 const job=(async()=>{
  const settings={...getCorrectionSettings(),ocrMaxEdge:Number(liveSize.value)};
  if(!drawCorrected(liveFrame,0,settings.ocrMaxEdge))return;
  const result=await recognizeCorrected(liveFrame,settings,null,1,null,null,'11',{isCurrent});
  if(!isCurrent())return;
  showDots(result.hits);
  setGlyphGuideRange(result.glyphRange,liveFrame.height,true);
  const elapsed=((performance.now()-liveLastStarted)/1000).toFixed(2)+'초';
  liveStatus.textContent=(result.hits.length?result.hits.length+'곳 감지':'코드 미감지')+' · '+result.resolution+'px · '+elapsed;
 })();
 liveJob=job;
 try{await job;}
 catch(error){if(isCurrent()&&error.name!=='AbortError')liveStatus.textContent='실시간 확인 실패: '+(error.message||String(error));}
 finally{
  if(liveJob===job)liveJob=null;
  scheduleLiveCheck();
 }
}

// 미리보기와 주기적 OCR 검사를 시작한다. (비긴 라이브)
// 이전 표시를 지우고 새 화면의 코드 위치를 검사한다.
function beginLive(){
 clearReviewSource();
 liveEpoch++;dots.replaceChildren();clearTimeout(liveTimer);cancelAnimationFrame(animationId);
 updateOcrInputSize();
 lastPaint=0;animationId=requestAnimationFrame(paintLive);
 liveLastStarted=0;
 if(liveOcr.checked)scheduleLiveCheck(0);
 else liveStatus.textContent='실시간 OCR 꺼짐 · 인식 버튼으로 촬영';
}

// 다시 촬영 시 카메라 미리보기만 재개한다. (리줌 카메라)
// 실시간 검사 설정을 적용하고 새 촬영 버튼 입력을 기다린다.
async function resumeCamera(){
 if(busy||starting)return;
 if(!stream){await startCamera();return;}
 try{
  scanEpoch++;liveEpoch++;clearTimeout(liveTimer);cancelAnimationFrame(animationId);
  await camera.play();frozenMode=false;detectedHits=[];boxes.replaceChildren();dots.replaceChildren();
  frozen.hidden=true;imageViewport.hidden=true;zoomLevel.hidden=true;zoomHint.hidden=true;liveView.hidden=false;resume.disabled=true;strength.disabled=false;readImage.disabled=false;readImage.textContent='코드 인식';
  beginLive();
  liveStatus.textContent=liveOcr.checked?'촬영 준비 완료':'실시간 OCR 꺼짐 · 인식 버튼으로 촬영';
  status.textContent='코드 인식 버튼을 누르면 새 화면을 촬영합니다.';
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
 if(activeScan&&activeTab==='camera')cancelActiveScan();
 if(stream)stream.getTracks().forEach(track=>track.stop());
 liveEpoch++;clearTimeout(liveTimer);cancelAnimationFrame(animationId);dots.replaceChildren();liveStatus.textContent='카메라 꺼짐';
 stream=null;camera.srcObject=null;stop.disabled=true;resume.disabled=true;readImage.disabled=true;start.disabled=busy;
 queueGlyphGuide();
 if(!busy)status.textContent='카메라가 꺼졌습니다.';
}
