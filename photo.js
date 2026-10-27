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
 readImage.disabled=false;strength.disabled=stripeReduce.checked;
 updateOcrInputSize();
 status.textContent='두 손가락 확대·이동 / 두 번 터치 또는 인식 버튼으로 검사';
}

// 불러온 엑셀 시트에서 중복 없이 무작위 코드를 고른다. (겟 테스트 로우스)
// 실제 엑셀 조회표와 같은 유효 코드만 사용하며 원본 파일은 수정하지 않는다.
function getTestRows(){
 if(!workbook)return [];
 const rows=[...buildLocations(workbook.sheets[workbook.selected]).entries()];
 for(let i=rows.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[rows[i],rows[j]]=[rows[j],rows[i]];}
 const count=Math.max(1,Math.min(12,Number(document.getElementById('testCount').value)||3));
 return rows.slice(0,count);
}

// 등록된 엑셀에서 고른 코드로 OCR 테스트 이미지를 만든다. (메이크 테스트 이미지)
// 노이즈·배치는 조절하고 원본 엑셀과 OCR 인식 경로는 변경하지 않는다.
function makeTestImage(){
 if(busy||starting)return;
 const rows=getTestRows();
 testExpectedCodes=rows.map(row=>row[0]);
 if(!rows.length){photoReady=false;readImage.disabled=true;imageViewport.hidden=true;frozen.hidden=true;status.textContent='먼저 엑셀 탭에서 파일을 등록하세요.';return;}
 const layout=document.getElementById('testLayout').value,noise=Number(document.getElementById('testNoise').value);
 document.getElementById('testNoiseValue').value=noise+'%';
 const cols=layout==='column'?1:layout==='random'?3:2;
 const width=1200,cellW=width/cols,cellH=145,height=Math.max(530,Math.ceil(rows.length/cols)*cellH+80);
 photoSource.width=width;photoSource.height=height;
 const ctx=photoSource.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
 let seed=8392;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 ctx.fillStyle='#111';ctx.font='bold '+(cols===3?39:cols===1?62:50)+'px monospace';
 for(let i=0;i<rows.length;i++){
  const x=cols===1?105:(i%cols)*cellW+35;
  const y=Math.floor(i/cols)*cellH+112;
  const dx=layout==='random'?(random()-.5)*55:0,dy=layout==='random'?(random()-.5)*48:0;
  ctx.fillText(rows[i][0],x+dx,y+dy);
 }
 if(noise){
  const image=ctx.getImageData(0,0,width,height),pixels=image.data;
  const chance=noise/100*.17;
  for(let i=0;i<pixels.length;i+=4){
   if(random()<chance){const value=random()<.5?0:255;pixels[i]=pixels[i+1]=pixels[i+2]=value;}
  }
  ctx.putImageData(image,0,0);
  ctx.globalAlpha=noise/250;
  for(let i=0;i<Math.floor(noise/8);i++){ctx.fillStyle=random()<.5?'#888':'#fff';ctx.fillRect(random()*width,random()*height,5+random()*130,2+random()*7);}
  ctx.globalAlpha=1;
 }
 locations=buildLocations(workbook.sheets[workbook.selected]);
 excelStatus.textContent=workbook.name+' · '+workbook.selected+' · '+locations.size+'개 코드';
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
  excel.disabled=false;sheet.disabled=false;strength.disabled=stripeReduce.checked;
 }
}
