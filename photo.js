// 선택한 사진의 원본을 표시한다. (프리뷰 포토)
// 이전 인식 박스를 지우며 원본 픽셀은 유지한다.
function previewPhoto(){
 frame.width=photoSource.width;frame.height=photoSource.height;
 const ctx=frame.getContext('2d',{willReadFrequently:true});
 ctx.drawImage(photoSource,0,0);
 // 사진 원본 위에 인식 박스를 표시해 보정 결과와 비교한다.
 detectedHits=[];boxes.replaceChildren();raw.textContent='';scanStats.textContent='';
 frozenMode=true;frozen.hidden=false;imageViewport.hidden=false;liveView.hidden=true;zoomLevel.hidden=false;zoomHint.hidden=false;
 readImage.disabled=false;strength.disabled=false;
 status.textContent='두 손가락 확대·이동 / 두 번 터치 또는 인식 버튼으로 검사';
}

// 테스트용 물품코드를 개수에 맞춰 만든다. (겟 테스트 로우스)
// 이미지·가상 엑셀·엑셀 파일이 동일한 코드 목록을 공유한다.
function getTestRows(){
 const count=Math.max(1,Math.min(12,Number(document.getElementById('testCount').value)||3));
 return Array.from({length:count},(_,i)=>['TS'+String(i+1).padStart(2,'0')+'-'+String(100001+i).padStart(6,'0'),'TEST-'+String(i+1).padStart(2,'0')]);
}

// 테스트용 이미지와 임시 엑셀 조회표를 만든다. (메이크 테스트 이미지)
// 실제 OCR 입력 경로를 유지하고 사용자가 불러온 엑셀은 변경하지 않는다.
function makeTestImage(){
 if(busy||starting)return;
 const rows=getTestRows(),layout=document.getElementById('testLayout').value,noise=Number(document.getElementById('testNoise').value);
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
 locations=document.getElementById('testExcel').checked?buildLocations(rows):new Map();
 excelStatus.textContent='테스트 · '+(document.getElementById('testExcel').checked?rows.length+'개 가상 엑셀 코드':'엑셀 조회 끔');
 photoReady=true;previewPhoto();setPhotoZoom(1);imageViewport.scrollLeft=0;imageViewport.scrollTop=0;
 status.textContent='테스트 이미지 '+rows.length+'개 생성 · 코드 인식으로 OCR 검사';
}

// 테스트 코드 목록을 실제 엑셀 파일로 내보낸다. (익스포트 테스트 엑셀)
// 현재 불러온 엑셀과 브라우저 자동 복원 데이터는 수정하지 않는다.
function exportTestExcel(){
 if(!window.XLSX){status.textContent='엑셀 라이브러리를 불러오지 못했습니다.';return;}
 const rows=[['코드','위치'],...getTestRows()];
 const book=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'테스트');
 XLSX.writeFile(book,'scanner-test.xlsx');
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
  photoReady=true;previewPhoto();setPhotoZoom(1);imageViewport.scrollLeft=0;imageViewport.scrollTop=0;
 }catch(error){
  photoReady=false;frozen.hidden=true;imageViewport.hidden=true;zoomLevel.hidden=true;zoomHint.hidden=true;boxes.replaceChildren();
  status.textContent='사진을 읽지 못했습니다. JPG 또는 PNG 사진으로 다시 선택하세요.';
 }finally{
  URL.revokeObjectURL(url);photoInput.value='';busy=false;lockInputs(false);
  excel.disabled=false;sheet.disabled=false;strength.disabled=false;
 }
}
