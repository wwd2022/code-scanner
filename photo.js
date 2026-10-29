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
 status.textContent='두 손가락 확대·이동 / 두 번 터치 또는 인식 버튼으로 검사';
}

// 엑셀 코드 또는 임시 코드와 위치를 선택한다.
// 임시 데이터는 테스트 화면에서만 사용한다.
function getTestRows(){
 const count=Math.max(1,Math.min(12,Number(document.getElementById('testCount').value)||3));
 if(!workbook){
  const rows=[];
  while(rows.length<count){
   const code=String(1000+Math.floor(Math.random()*9000))+'-'+String(Math.floor(Math.random()*1000000)).padStart(6,'0');
   if(!rows.some(row=>row[0]===code))rows.push([code,['T'+String(rows.length+1).padStart(2,'0')]]);
  }
  return rows;
 }
 const rows=[...buildLocations(workbook.sheets[workbook.selected]).entries()];
 for(let i=rows.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[rows[i],rows[j]]=[rows[j],rows[i]];}
 return rows.slice(0,count);
}

// 종이 문서 또는 모니터 환경의 테스트 이미지를 만든다.
// 생성한 코드와 위치를 조회표와 목록에 반영한다.
function makeTestImage(){
 if(busy||starting)return;
 const rows=getTestRows();
 testExpectedCodes=rows.map(row=>row[0]);
 if(!rows.length){photoReady=false;readImage.disabled=true;imageViewport.hidden=true;frozen.hidden=true;document.getElementById('testLogText').textContent='사용 가능한 엑셀 코드가 없습니다.';status.textContent='엑셀에 유효한 코드가 없습니다.';return;}
 const layout=document.getElementById('testLayout').value,noise=Number(document.getElementById('testNoise').value);
 const scene=document.getElementById('testScene').value,ink=document.getElementById('testInk').value;
 document.getElementById('testNoiseValue').value=noise+'%';
 const cols=layout==='column'?1:layout==='random'?3:2;
 const width=1200,cellW=width/cols,cellH=145,height=Math.max(530,Math.ceil(rows.length/cols)*cellH+120);
 photoSource.width=width;photoSource.height=height;
 const ctx=photoSource.getContext('2d',{willReadFrequently:true});
 let seed=8392;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 ctx.fillStyle=scene==='paper'?'#e8e6df':scene==='screen'?'#dfe5e4':'#fff';ctx.fillRect(0,0,width,height);
 if(scene!=='plain'){
  const shade=ctx.createLinearGradient(0,0,width,height);
  shade.addColorStop(0,'rgba(255,255,255,.16)');shade.addColorStop(1,'rgba(40,40,40,.12)');ctx.fillStyle=shade;ctx.fillRect(0,0,width,height);
  ctx.strokeStyle=scene==='paper'?'rgba(35,35,35,.4)':'rgba(60,70,70,.28)';ctx.lineWidth=1;
  for(let x=0;x<=width;x+=cellW){ctx.beginPath();ctx.moveTo(x,35);ctx.lineTo(x,height-20);ctx.stroke();}
  for(let y=35;y<height;y+=cellH){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();}
 }
 ctx.fillStyle=ink==='normal'?'#191919':ink==='light'?'#777773':'#a5a59e';
 ctx.font=(scene==='plain'?'bold ':'')+(cols===3?35:cols===1?50:42)+'px monospace';
 for(let i=0;i<rows.length;i++){
  const x=cols===1?105:(i%cols)*cellW+35,y=Math.floor(i/cols)*cellH+112;
  const dx=layout==='random'?(random()-.5)*45:0,dy=layout==='random'?(random()-.5)*35:0;
  ctx.fillText(rows[i][0],x+dx,y+dy);
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
 locations=workbook?buildLocations(workbook.sheets[workbook.selected]):new Map(rows);
 excelStatus.textContent=workbook?workbook.name+' · '+workbook.selected+' · '+locations.size+'개 코드':'테스트용 임시 코드 · 위치';
 document.getElementById('testLogText').textContent=(workbook?'엑셀에서 선택한 코드':'임시 코드 · 임시 위치')+'\n'+rows.map(([code,place])=>code+' → '+(place.length?place.join(', '):'없음')).join('\n');
 photoReady=true;previewPhoto();setPhotoZoom(1);imageViewport.scrollLeft=0;imageViewport.scrollTop=0;
 status.textContent='테스트 이미지 '+rows.length+'개 생성 · 코드 인식으로 OCR 검사';
}

// 엑셀에서 새로운 무작위 코드들을 가져온다. (익스포트 테스트 엑셀)
// 기존 이미지의 코드만 교체하고 엑셀 파일을 생성하지 않는다.
function exportTestExcel(){makeTestImage();}

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
  photoReady=true;previewPhoto();setPhotoZoom(1);imageViewport.scrollLeft=0;imageViewport.scrollTop=0;
 }catch(error){
  photoReady=false;frozen.hidden=true;imageViewport.hidden=true;zoomLevel.hidden=true;zoomHint.hidden=true;boxes.replaceChildren();
  status.textContent='사진을 읽지 못했습니다. JPG 또는 PNG 사진으로 다시 선택하세요.';
 }finally{
  URL.revokeObjectURL(url);photoInput.value='';busy=false;lockInputs(false);
  excel.disabled=false;sheet.disabled=false;strength.disabled=false;
 }
}
