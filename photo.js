// 선택한 사진을 표시 옵션에 따라 보여준다. (프리뷰 포토)
// 이전 인식 박스를 지우며 원본 픽셀은 유지한다.
function previewPhoto(){
 clearReviewSource();
 scanEpoch++;imageRevision++;
 if(activeTab==='test')document.getElementById('testPerformance').value='현재 이미지를 유지하고 성능 설정을 바꿔 같은 이미지 재인식을 누르세요.';
 frame.width=photoSource.width;frame.height=photoSource.height;
 renderPreview(photoSource,frame);
 detectedHits=[];boxes.replaceChildren();raw.textContent='';scanStats.textContent='';
 frozenMode=true;frozen.hidden=false;imageViewport.hidden=false;liveView.hidden=true;zoomLevel.hidden=false;zoomHint.hidden=false;
 readImage.disabled=false;strength.disabled=false;
 updateOcrInputSize();
 if(activeTab==='test')refreshTestComparison(true);
 status.textContent='두 손가락 확대·이동 / 두 번 터치 또는 인식 버튼으로 검사';
}

// 엑셀 코드 또는 임시 코드와 위치를 선택한다.
// 임시 데이터는 테스트 화면에서만 사용한다.
const testImageLimits={maxEdge:4096,maxPixels:8000000,maxCodes:1000};
function getTestRows(count,existing=[]){
 if(!Number.isSafeInteger(count)||count<0||count>testImageLimits.maxCodes)throw new Error('테스트 코드는 최대 1000개까지 생성할 수 있습니다.');
 const unique=new Map(existing.map(row=>[row[0],row]));
 if(!workbook){
  const rows=[...unique.values()].slice(0,count),used=new Set(rows.map(row=>row[0]));
  const capacity=9000000000;
  let cursor=0;
  const codeAt=index=>String(1000+Math.floor(index/1000000))+'-'+String(index%1000000).padStart(6,'0');
  while(rows.length<count){
   let code=codeAt(Math.floor(Math.random()*capacity));
   if(used.has(code)){
    while(used.has(codeAt(cursor)))cursor=(cursor+1)%capacity;
    code=codeAt(cursor);cursor=(cursor+1)%capacity;
   }
   used.add(code);rows.push([code,['T'+String(rows.length+1).padStart(2,'0')]]);
  }
  return rows;
 }
 const available=buildLocations(workbook.sheets[workbook.selected]);
 const rows=[...unique.values()].filter(([code])=>available.has(code)).slice(0,count).map(([code])=>[code,available.get(code)]);
 const used=new Set(rows.map(row=>row[0]));
 const remaining=[...available.entries()].filter(([code])=>!used.has(code));
 for(let i=remaining.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[remaining[i],remaining[j]]=[remaining[j],remaining[i]];}
 return rows.concat(remaining.slice(0,count-rows.length));
}

// 글자 크기와 간격으로 표에 들어갈 행·열을 계산한다.
// 간격 0은 최소 여유만 남긴 밀집 배치다.
function getTestGrid(width,height,font,gapX,gapY,textMode){
 const ctx=document.createElement('canvas').getContext('2d');ctx.font=font+'px monospace';
 const pad=Math.max(.5,font*.025),cellW=Math.ceil(ctx.measureText(textMode==='attached'?'MMMM-MMMMMMM':'MMMM-MMMMMM').width+pad*2);
 const cellH=Math.ceil(font*((textMode==='near'||textMode==='other')?1.9:1.1));
 const cols=Math.max(0,Math.floor((width+gapX)/(cellW+gapX))),rows=Math.max(0,Math.floor((height+gapY)/(cellH+gapY)));
 return {cols,rows,cellW,cellH,pad};
}

// 종이 문서 또는 모니터 환경의 테스트 이미지를 만든다.
// 생성한 코드와 위치를 조회표와 목록에 반영한다.
let testRows=[],testCodesNeedRefresh=true,testImageLayout=null,testExpectedRegions=[];
function makeTestImage(newCodes=false){
 if(busy||starting)return;
 const noise=Number(document.getElementById('testNoise').value);
 const scene=document.getElementById('testScene').value,ink=document.getElementById('testInk').value;
 document.getElementById('testNoiseValue').value=noise+'%';
 const number=(id,min,max)=>Math.max(min,Math.min(max,Number(document.getElementById(id).value)||min));
 const widthCm=Number(document.getElementById('testWidthCm').value),heightCm=Number(document.getElementById('testHeightCm').value),ppi=Number(document.getElementById('testPpi').value);
 const width=Math.round(widthCm*ppi/2.54),height=Math.round(heightCm*ppi/2.54);
 if(!Number.isFinite(ppi)||ppi<1||!Number.isFinite(widthCm)||!Number.isFinite(heightCm)||widthCm<=0||heightCm<=0||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1){status.textContent='이미지 크기와 PPI에 올바른 값을 입력하세요.';return;}
 if(width>testImageLimits.maxEdge||height>testImageLimits.maxEdge||width*height>testImageLimits.maxPixels){status.textContent='테스트 이미지는 한 변 최대 4096px, 총 800만 픽셀까지 가능합니다. 크기 또는 PPI를 줄여주세요.';return;}
 const scale=ppi/254;
 const margin=id=>Math.max(0,Number(document.getElementById(id).value)||0)*scale;
 const left=margin('testLeft'),right=margin('testRight'),top=margin('testTop'),bottom=margin('testBottom');
 const gapX=number('testGapX',0,500)*scale,gapY=number('testGapY',0,500)*scale,font=number('testFont',8,100)*scale;
 const textMode=document.getElementById('testText').value,table=document.getElementById('testTable').value==='on';
 if(![left,right,top,bottom,gapX,gapY,font].every(Number.isFinite)){status.textContent='여백과 글자 크기에 올바른 값을 입력하세요.';return;}
 const {cols,rows:rowCount,cellW,cellH,pad}=getTestGrid(width-left-right,height-top-bottom,font,gapX,gapY,textMode);
 if(!cols||!rowCount){status.textContent='코드를 넣을 공간이 부족합니다. 표를 늘리거나 글자 크기를 줄여주세요.';return;}
 const count=cols*rowCount;
 if(!Number.isSafeInteger(count)||count>testImageLimits.maxCodes){status.textContent='테스트 코드는 최대 1000개까지 가능합니다. 글자 크기나 간격을 늘려주세요.';return;}
 if(!confirm(width+' × '+height+' px 이미지를 생성하시겠습니까?'))return;
 try{
 const rows=getTestRows(count,newCodes||testCodesNeedRefresh?[]:testRows);
 if(!rows.length){status.textContent='엑셀에 유효한 코드가 없습니다.';return;}
 photoSource.width=width;photoSource.height=height;
 const ctx=photoSource.getContext('2d',{willReadFrequently:true});
 if(!ctx||photoSource.width!==width||photoSource.height!==height)throw new Error('이미지 생성 실패');
 ctx.getImageData(0,0,1,1);
 let seed=8392;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 ctx.fillStyle=scene==='paper'?'#e8e6df':scene==='screen'?'#dfe5e4':'#fff';ctx.fillRect(0,0,width,height);
 if(scene!=='plain'){
  const shade=ctx.createLinearGradient(0,0,width,height);
  shade.addColorStop(0,'rgba(255,255,255,.16)');shade.addColorStop(1,'rgba(40,40,40,.12)');ctx.fillStyle=shade;ctx.fillRect(0,0,width,height);
 }
 ctx.fillStyle=ink==='normal'?'#191919':ink==='light'?'#777773':'#a5a59e';
 ctx.font=font+'px monospace';ctx.textBaseline='middle';
 if(table){
  ctx.strokeStyle='rgba(35,35,35,.45)';ctx.lineWidth=1;
  for(let row=0;row<rowCount;row++)for(let col=0;col<cols;col++)ctx.strokeRect(left+col*(cellW+gapX),top+row*(cellH+gapY),cellW,cellH);
 }
 const labels=['RESISTOR','PART','DIODE','QTY 12','MODEL'];
 for(let i=0;i<rows.length;i++){
  const x=left+(i%cols)*(cellW+gapX)+pad,y=top+Math.floor(i/cols)*(cellH+gapY)+font*.55;
  let code=rows[i][0];
  if(textMode==='attached')code+=String.fromCharCode(65+Math.floor(random()*26));
  ctx.fillText(code,x,y);
  if(textMode==='near'||textMode==='other'){
   ctx.font=Math.max(8,font*.48)+'px monospace';
   ctx.fillText(textMode==='near'?labels[Math.floor(random()*labels.length)]:'B'+String(100+Math.floor(random()*900))+'-0'+String(Math.floor(random()*1000)).padStart(3,'0'),x,y+font*.8);
   ctx.font=font+'px monospace';
  }
 }
 if(scene==='screen'&&noise){
  ctx.lineWidth=2;
  for(let x=0;x<width;x+=8){ctx.strokeStyle=x%24===0?'rgba(215,70,110,'+(noise/500)+')':'rgba(65,120,190,'+(noise/650)+')';ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x+height*.09,height);ctx.stroke();}
 }
 if(noise){
  const image=ctx.getImageData(0,0,width,height),pixels=image.data,chance=noise/100*.12;
  for(let i=0;i<pixels.length;i+=4)if(random()<chance){const value=random()<.5?35:240;pixels[i]=pixels[i+1]=pixels[i+2]=value;}
  ctx.putImageData(image,0,0);
  ctx.globalAlpha=noise/300;
  for(let i=0;i<Math.floor(noise/10);i++){ctx.fillStyle=random()<.5?'#777':'#fff';ctx.fillRect(random()*width,random()*height,5+random()*130,2+random()*7);}
  ctx.globalAlpha=1;
 }
 testExpectedRegions=rows.map(([code],i)=>({code,bbox:{x0:left+(i%cols)*(cellW+gapX),y0:top+Math.floor(i/cols)*(cellH+gapY),x1:left+(i%cols)*(cellW+gapX)+cellW,y1:top+Math.floor(i/cols)*(cellH+gapY)+cellH}}));
 testRows=rows;testCodesNeedRefresh=false;testExpectedCodes=rows.map(row=>row[0]);document.getElementById('testCompareText').textContent='인식 후 표시됩니다.';
 locations=workbook?buildLocations(workbook.sheets[workbook.selected]):new Map(rows);
 excelStatus.textContent=workbook?workbook.name+' · '+workbook.selected+' · '+locations.size+'개 코드':'테스트용 임시 코드 · 위치';
 document.getElementById('testLogText').textContent=(workbook?'엑셀에서 선택한 코드':'임시 코드 · 임시 위치')+'\n'+rows.map(([code,place])=>code+' → '+(place.length?place.join(', '):'없음')).join('\n');
 testImageLayout={width,height,scale,left,top,right,bottom,textMode,values:Object.fromEntries(['testWidthCm','testHeightCm','testPpi','testGapX','testGapY','testFont'].map(id=>[id,document.getElementById(id).value]))};
 photoReady=true;previewPhoto();setPhotoZoom(1);imageViewport.scrollLeft=0;imageViewport.scrollTop=0;
 status.textContent='테스트 이미지 '+rows.length+'개 생성'+(rows.length<cols*rowCount?' · 엑셀 코드 부족으로 일부 칸 비움':'')+' · 코드 인식으로 OCR 검사';
 return true;
 }catch(error){photoReady=false;readImage.disabled=true;imageViewport.hidden=true;frozen.hidden=true;status.textContent='이미지를 만들 수 없습니다. 브라우저가 처리할 수 있는 크기로 줄여주세요.';}
}

// 생성 코드와 전체 이미지 인식 결과를 비교한다.
// 확대 영역과 일부 실패는 전체 정확도로 표시하지 않는다.
function showTestComparison(hits,area,errorCount){
 const out=document.getElementById('testCompareText');
 if(area||errorCount){out.textContent='전체 이미지가 아니거나 일부 검사가 실패해 비교하지 않았습니다.';return;}
 const expected=new Set(testExpectedCodes),found=new Set(hits.map(hit=>hit.code));
 const matched=[...expected].filter(code=>found.has(code)),missing=[...expected].filter(code=>!found.has(code)),extra=[...found].filter(code=>!expected.has(code));
 out.textContent='일치 '+matched.length+' / '+expected.size+' · 누락 '+missing.length+' · 오인식 '+extra.length+'\n누락: '+(missing.join(', ')||'없음')+'\n오인식: '+(extra.join(', ')||'없음');
}

// 엑셀에서 새로운 무작위 코드들을 가져온다. (익스포트 테스트 엑셀)
// 기존 이미지의 코드만 교체하고 엑셀 파일을 생성하지 않는다.
function exportTestExcel(){makeTestImage(true);}

// 선택한 사진을 읽고 크기를 줄여 미리 보여준다. (로드 포토)
// 큰 사진은 긴 변 3200픽셀로 줄이고 임시 주소를 해제한다.
async function loadPhoto(){
 const file=photoInput.files[0];if(!file||busy||starting)return;
 if(!confirmDiscardReview()){photoInput.value='';return;}
 busy=true;lockInputs(true);excel.disabled=true;sheet.disabled=true;strength.disabled=true;
 const url=URL.createObjectURL(file);
 try{
  status.textContent='사진을 읽는 중…';
  const picture=new Image();picture.src=url;await picture.decode();
  const scale=Math.min(1,3200/Math.max(picture.naturalWidth,picture.naturalHeight));
  photoSource.width=Math.max(1,Math.round(picture.naturalWidth*scale));
  photoSource.height=Math.max(1,Math.round(picture.naturalHeight*scale));
  photoSource.getContext('2d').drawImage(picture,0,0,photoSource.width,photoSource.height);
  photoReady=true;previewPhoto();setPhotoZoom(1);imageViewport.scrollLeft=0;imageViewport.scrollTop=0;
 }catch(error){
  photoReady=false;frozen.hidden=true;imageViewport.hidden=true;zoomLevel.hidden=true;zoomHint.hidden=true;boxes.replaceChildren();
  status.textContent='사진을 읽지 못했습니다. JPG 또는 PNG 사진으로 다시 선택하세요.';
 }finally{
  URL.revokeObjectURL(url);photoInput.value='';busy=false;lockInputs(false);
  excel.disabled=false;sheet.disabled=false;strength.disabled=false;
 }
}
