// 비교 화면별 확대·이동·인식 결과를 보관한다.
// 원본과 보정본은 공통 OCR 경로를 사용한다.
const testViews=['original','corrected'].map(id=>({id,canvas:document.getElementById('compare-'+id),zoom:1,cx:.5,cy:.5,hits:[],input:null,inputArea:null,points:new Map(),surface:document.getElementById('compare-surface-'+id),boxes:document.getElementById('compare-boxes-'+id)}));
let activeTestResultView=null;
let testCompareMode=window.matchMedia('(max-width:600px)').matches?'corrected':'both',testPreviewVersion=0,testPreviewTimer=0,testCorrectedPreview=null;
function testViewSettings(id){
 const settings=getCorrectionSettings();
 return id==='original'?{...settings,mode:'contrast',brightness:0,strength:0,screenNoise:0,removeSpecks:false,removeLines:false}:settings;
}
function testViewGeometry(view){
 const w=view.canvas.clientWidth,h=view.canvas.clientHeight,sw=photoSource.width,sh=photoSource.height;
 const scale=Math.min(w/sw,h/sh)*view.zoom,dx=w/2-view.cx*sw*scale,dy=h/2-view.cy*sh*scale;
 const x=Math.max(0,-dx/scale),y=Math.max(0,-dy/scale),right=Math.min(sw,(w-dx)/scale),bottom=Math.min(sh,(h-dy)/scale);
 return {w,h,scale,dx,dy,area:{x,y,width:Math.max(1,right-x),height:Math.max(1,bottom-y)}};
}
function drawTestView(view){
 if(activeTab!=='test'||!photoReady||!view.canvas.clientWidth)return;
 const g=testViewGeometry(view),c=view.canvas,ratio=window.devicePixelRatio||1;
 c.width=Math.round(g.w*ratio);c.height=Math.round(g.h*ratio);const ctx=c.getContext('2d');ctx.scale(ratio,ratio);ctx.fillStyle='#17212b';ctx.fillRect(0,0,g.w,g.h);
 const source=view.id==='corrected'?testCorrectedPreview:photoSource;
 if(source)ctx.drawImage(source,g.dx,g.dy,photoSource.width*g.scale,photoSource.height*g.scale);
 if(view.input&&view.inputArea){const a=view.inputArea;ctx.drawImage(view.input,g.dx+a.x*g.scale,g.dy+a.y*g.scale,a.width*g.scale,a.height*g.scale);}
 renderTestResultOverlay(view,g);
 document.getElementById('compare-zoom-'+view.id).value=Math.round(view.zoom*100)+'%';
}
function clearTestView(view,message='화면 변경 · 다시 인식하세요.'){
 if(activeTestResultView===view){activeTestResultView=null;detectedHits=[];clearReviewSource();updateReviewActions();}
 view.boxes.replaceChildren();document.getElementById('compare-records-'+view.id).replaceChildren();
 view.hits=[];if(view.input)view.input.width=view.input.height=1;view.input=null;view.inputArea=null;
 document.getElementById('compare-result-'+view.id).textContent=message;document.getElementById('compare-summary-'+view.id).value=message;
}
function setTestCompareMode(mode){
 if(busy)return;testCompareMode=mode;
 for(const view of testViews)document.getElementById('compare-panel-'+view.id).hidden=mode!=='both'&&mode!==view.id;
 document.querySelectorAll('[data-compare-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.compareMode===mode)));
 for(const view of testViews)drawTestView(view);
}
// 실제 OCR 입력 생성 함수를 사용해 보정본을 표시한다.
// 생성·설정 변경 중 오래된 미리보기는 버린다.
async function refreshTestComparison(reset=false){
 if(activeTab!=='test'||!photoReady)return;
 const version=++testPreviewVersion,revision=imageRevision;
 if(reset){if(testCorrectedPreview)testCorrectedPreview.width=testCorrectedPreview.height=1;testCorrectedPreview=null;for(const view of testViews){view.zoom=1;view.cx=view.cy=.5;document.getElementById('compare-range-'+view.id).value=1;}}
 for(const view of testViews)clearTestView(view,'인식 전 · 확대·드래그 후 이 화면 인식');
 document.getElementById('testComparison').hidden=false;
 for(const view of testViews)drawTestView(view);
 const settings=testViewSettings('corrected'),scale=Math.min(1,settings.ocrMaxEdge/Math.max(photoSource.width,photoSource.height));
 try{
  const rendered=await runOcrSession(()=>renderScanPass(photoSource,{x:0,y:0,width:photoSource.width,height:photoSource.height,scale},settings));
  if(version!==testPreviewVersion||revision!==imageRevision||activeTab!=='test'){rendered.image.width=rendered.image.height=1;return;}
  if(testCorrectedPreview)testCorrectedPreview.width=testCorrectedPreview.height=1;
  testCorrectedPreview=rendered.image;drawTestView(testViews[1]);
 }catch(error){if(version===testPreviewVersion)document.getElementById('compare-result-corrected').textContent='보정 미리보기 실패: '+error.message;}
}
function scheduleTestComparison(){
 clearTimeout(testPreviewTimer);testPreviewTimer=setTimeout(()=>{if(!busy)refreshTestComparison();},250);
}
// 보이는 원본 좌표만 잘라 공통 OCR 함수에 전달한다.
// 각 화면의 결과는 독립적으로 표시하고 작업 기록에는 추가하지 않는다.
async function scanTestComparison(id=null){
 if(busy||starting||!photoReady)return;
 closeTools();document.querySelector('.test-options').open=false;
 const targets=testViews.filter(view=>id?view.id===id:testCompareMode==='both'||view.id===testCompareMode);
 const stages=scanStageInputs.filter(input=>input.checked&&(deepScan.checked||input.dataset.scanStage==='corrected')).map(input=>input.dataset.scanStage);
 if(!stages.length){status.textContent='검사 단계를 하나 이상 선택하세요.';return;}
 const jobs=targets.map(view=>({view,area:{...testViewGeometry(view).area},settings:testViewSettings(view.id)}));
 activeTestResultView=null;detectedHits=[];clearReviewSource();
 const run={epoch:++scanEpoch,cancelled:false,running:0,phase:'비교 인식'};activeScan=run;busy=true;showScanStart(stages);
 const isCurrent=()=>activeScan===run&&!run.cancelled&&scanEpoch===run.epoch;
 try{
  for(const {view,area,settings} of jobs){
   clearTestView(view,'인식 중…');const started=performance.now();
   const result=await recognizeCorrected(photoSource,settings,area,1,(input)=>{
    if(!isCurrent())return;view.input=document.createElement('canvas');view.input.width=input.width;view.input.height=input.height;view.input.getContext('2d').drawImage(input,0,0);view.inputArea=area;drawTestView(view);
   },stages,'11',{isCurrent,run});
   assertOcrCurrent(isCurrent);view.hits=result.hits;activateTestResultView(view);
   renderRecordRows(document.getElementById('compare-records-'+view.id),view.hits);
   const expected=testExpectedRegions.filter(item=>item.bbox.x0>=area.x&&item.bbox.y0>=area.y&&item.bbox.x1<=area.x+area.width&&item.bbox.y1<=area.y+area.height);
   const found=new Set(result.hits.map(hit=>hit.code)),missing=expected.filter(item=>!found.has(item.code));
   const allExpected=new Set(testExpectedCodes),extra=[...found].filter(code=>!allExpected.has(code));
   document.getElementById('compare-result-'+view.id).textContent='발견 '+result.hits.length+' · 영역 내 정답 '+(expected.length-missing.length)+'/'+expected.length+' · 누락 '+missing.length+' · 오인식 '+extra.length+' · '+((performance.now()-started)/1000).toFixed(2)+'초\n입력 '+result.resolution+' · '+(result.errors.length?'일부 검사 실패 · ':'')+'경계에 걸린 코드는 누락 계산 제외 · 시간은 준비 포함\n검사 영역: '+Math.round(area.x)+','+Math.round(area.y)+' / '+Math.round(area.width)+'×'+Math.round(area.height)+' px\n누락: '+(missing.map(item=>item.code).join(', ')||'없음')+'\n오인식: '+(extra.join(', ')||'없음');
   document.getElementById('compare-summary-'+view.id).value='최근 검사 · 발견 '+result.hits.length+' · 누락 '+missing.length+' · 오인식 '+extra.length+' · '+((performance.now()-started)/1000).toFixed(2)+'초'+(result.errors.length?' · 일부 실패':'');
   drawTestView(view);
  }
  status.textContent='비교 인식 완료 · 각 화면의 보이는 영역 기준';
 }catch(error){status.textContent=run.cancelled?'비교 인식 취소':'비교 인식 실패: '+error.message;for(const view of targets)document.getElementById('compare-summary-'+view.id).value=status.textContent;}
 finally{if(activeScan===run){activeScan=null;busy=false;showScanEnd();}}
}
for(const button of document.querySelectorAll('[data-compare-mode]'))button.addEventListener('click',()=>setTestCompareMode(button.dataset.compareMode));
document.getElementById('compare-refresh').addEventListener('click',()=>{if(!busy)refreshTestComparison();});
document.getElementById('compare-align').addEventListener('click',()=>{
 if(busy)return;const from=testViews.find(v=>v.id===testCompareMode)||testViews[0];
 for(const view of testViews){view.zoom=from.zoom;view.cx=from.cx;view.cy=from.cy;clearTestView(view);drawTestView(view);}
});
for(const view of testViews){
 document.getElementById('compare-scan-'+view.id).addEventListener('click',()=>scanTestComparison(view.id));
 document.getElementById('compare-range-'+view.id).addEventListener('input',event=>{
  if(busy)return;view.zoom=Number(event.target.value);clearTestView(view);drawTestView(view);
 });
 view.canvas.addEventListener('dblclick',()=>{if(!busy){view.zoom=1;view.cx=view.cy=.5;document.getElementById('compare-range-'+view.id).value=1;clearTestView(view);drawTestView(view);}});
 view.surface.addEventListener('pointerdown',event=>{
  if(busy||!photoReady)return;event.preventDefault();view.surface.setPointerCapture(event.pointerId);view.points.set(event.pointerId,{x:event.clientX,y:event.clientY});
 });
 view.surface.addEventListener('pointermove',event=>{
  if(busy||!view.points.has(event.pointerId))return;event.preventDefault();
  const old=[...view.points.values()].map(p=>({...p})),point=view.points.get(event.pointerId),previous={...point};point.x=event.clientX;point.y=event.clientY;
  const now=[...view.points.values()],g=testViewGeometry(view);
  if(now.length===2){const before=Math.hypot(old[1].x-old[0].x,old[1].y-old[0].y),after=Math.hypot(now[1].x-now[0].x,now[1].y-now[0].y);if(before>0)view.zoom=Math.max(1,Math.min(8,view.zoom*after/before));}
  else{view.cx=Math.max(0,Math.min(1,view.cx-(point.x-previous.x)/(g.scale*photoSource.width)));view.cy=Math.max(0,Math.min(1,view.cy-(point.y-previous.y)/(g.scale*photoSource.height)));}
  document.getElementById('compare-range-'+view.id).value=view.zoom;clearTestView(view);drawTestView(view);
 });
 for(const type of ['pointerup','pointercancel','lostpointercapture'])view.surface.addEventListener(type,event=>view.points.delete(event.pointerId));
}
new ResizeObserver(()=>{for(const view of testViews)drawTestView(view);}).observe(document.getElementById('testComparison'));

// 모드를 다시 열 때 이전 이미지와 결과를 비운다.
// 원본·보정 미리보기의 오래된 픽셀도 해제한다.
function resetTestComparison(){
 setTestCompareMode(testCompareMode);
 testPreviewVersion++;if(testCorrectedPreview)testCorrectedPreview.width=testCorrectedPreview.height=1;testCorrectedPreview=null;
 for(const view of testViews){view.zoom=1;view.cx=view.cy=.5;view.points.clear();view.canvas.width=view.canvas.width;document.getElementById('compare-range-'+view.id).value=1;clearTestView(view,'이미지를 생성하세요.');}
}

// 메뉴를 접어 비교 이미지 공간을 확보한다.
// 다시 누르면 기본 화면으로 돌아간다.
document.getElementById('compare-focus').addEventListener('click',()=>{
 const focused=document.querySelector('main').classList.toggle('comparison-focus');
 const button=document.getElementById('compare-focus');button.setAttribute('aria-pressed',String(focused));button.textContent=focused?'돌아가기':'넓게';
 for(const view of testViews)drawTestView(view);
});

// 선택한 비교 화면의 입력을 기존 확인 팝업에 전달한다.
// 다른 화면을 인식한 뒤에도 해당 입력 영상을 사용한다.
function activateTestResultView(view){
 if(!view.input||!view.inputArea)return;
 activeTestResultView=view;detectedHits=view.hits;
 clearReviewSource();reviewSource.width=view.input.width;reviewSource.height=view.input.height;
 reviewSource.getContext('2d').drawImage(view.input,0,0);reviewSourceArea={...view.inputArea};reviewSourceEpoch=scanEpoch;
 updateReviewActions();
}
function renderTestResultOverlay(view,g=testViewGeometry(view)){
 view.boxes.style.cssText=boxes.style.cssText;view.boxes.hidden=boxes.hidden;
 if(boxes.hidden||!view.hits.length){view.boxes.replaceChildren();return;}
 renderHitBoxes(view.boxes,view.hits,g.w,g.h,g.scale,g.scale,g.dx,g.dy,hit=>{
  if(busy||starting)return;activateTestResultView(view);openCodeReview(hit);
 });
}
function redrawTestResultOverlays(){
 if(activeTab!=='test')return;
 for(const view of testViews){
  if(view.canvas.clientWidth)renderTestResultOverlay(view);
  renderRecordRows(document.getElementById('compare-records-'+view.id),view.hits);
 }
}
