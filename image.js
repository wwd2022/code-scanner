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

// 카메라를 화면 비율로 잘라 캔버스에 그린다. (드로 코렉티드)
// 미리보기·실시간 OCR·촬영에 같은 중앙 영역을 사용한다.
function drawCorrected(target,amount=null,maxSize=2200){
 if(camera.readyState<2||!camera.videoWidth)return false;
 const viewWidth=liveView.clientWidth,viewHeight=liveView.clientHeight;
 if(!viewWidth||!viewHeight)return false;
 const ratio=viewWidth/viewHeight;
 let sourceWidth=camera.videoWidth,sourceHeight=camera.videoHeight;
 if(sourceWidth/sourceHeight>ratio)sourceWidth=sourceHeight*ratio;
 else sourceHeight=sourceWidth/ratio;
 const zoom=window.liveZoom||1;
 sourceWidth/=zoom;sourceHeight/=zoom;
 const sourceX=(camera.videoWidth-sourceWidth)/2,sourceY=(camera.videoHeight-sourceHeight)/2;
 const scale=Math.min(1,maxSize/Math.max(sourceWidth,sourceHeight));
 const width=Math.max(1,Math.round(sourceWidth*scale)),height=Math.max(1,Math.round(sourceHeight*scale));
 if(target.width!==width||target.height!==height){target.width=width;target.height=height;}
 const ctx=target.getContext('2d',{willReadFrequently:true});
 ctx.drawImage(camera,sourceX,sourceY,sourceWidth,sourceHeight,0,0,width,height);
 if(amount===null||amount){
  const image=ctx.getImageData(0,0,width,height);
  if(amount===null)applyCorrection(image,{mode:filterMode.value,brightness:Number(brightness.value),strength:Number(strength.value),threshold:Number(threshold.value),removeLines:removeLines.checked});
  else applyFilter(image.data,amount);
  ctx.putImageData(image,0,0);
 }
 return true;
}

// 원본 또는 현재 설정의 보정 이미지를 표시한다. (렌더 프리뷰)
// OCR 보정 함수를 재사용하고 원본 픽셀과 결과 좌표를 유지한다.
function renderPreview(source,target){
 let rendered;
 if(previewCorrection.checked||settingsAdjusting){
  const settings={mode:filterMode.value,brightness:Number(brightness.value),threshold:Number(threshold.value),removeLines:removeLines.checked,strength:Number(strength.value)};
  rendered=renderScanPass(source,{x:0,y:0,width:source.width,height:source.height,scale:1,mode:settings.mode},settings);
 }
 const image=rendered?rendered.image:source;
 if(target!==image){
  if(target.width!==image.width)target.width=image.width;
  if(target.height!==image.height)target.height=image.height;
  target.getContext('2d').drawImage(image,0,0);
 }
 if(rendered)rendered.image.width=rendered.image.height=1;
}

// 표시 옵션과 보정 설정을 즉시 반영한다. (업데이트 프리뷰)
// 확대·박스·인식 기록을 유지하며 화면 이미지만 다시 그린다.
function updatePreview(){
 document.getElementById('previewCorrectionValue').value=settingsAdjusting?'조절 중 · 보정':previewCorrection.checked?'ON · 보정':'OFF · 원본';
 if(activeTab==='camera'&&!frozenMode){
  if(stream&&drawCorrected(liveCanvas,0,previewCorrection.checked||settingsAdjusting?960:2200))renderPreview(liveCanvas,liveCanvas);
 }else if(frozenMode){
  const source=activeTab==='camera'?originalFrame:photoSource;
  if(source.width&&source.height)renderPreview(source,frame);
 }
}

// 보정 강도와 미리보기를 변경한다. (체인지 필터)
// 다음 OCR에 새 강도를 적용하고 기존 인식 박스는 유지한다.
function changeFilter(){
 strengthValue.value=strength.value;liveEpoch++;dots.replaceChildren();
 updatePreview();
}

// 그림자를 줄이고 인쇄 글자를 흑백으로 분리한다. (프린트 필터)
// 원본은 보존하며 주변 밝기 기준과 긴 표 선만 보정한다.
function printFilter(image,offset=16,cleanLines=true){
 const {width:w,height:h,data}=image,n=w*h,gray=new Uint8Array(n),blur=new Uint8Array(n);
 for(let i=0;i<n;i++)gray[i]=Math.round(data[i*4]*.299+data[i*4+1]*.587+data[i*4+2]*.114);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  let sum=0;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   sum+=gray[Math.max(0,Math.min(h-1,y+dy))*w+Math.max(0,Math.min(w-1,x+dx))]*(dy===0?2:1)*(dx===0?2:1);
  }
  blur[y*w+x]=Math.round(sum/16);
 }
 const stride=w+1,integral=new Float64Array(stride*(h+1)),mask=new Uint8Array(n);
 for(let y=0;y<h;y++){
  let sum=0;
  for(let x=0;x<w;x++){sum+=blur[y*w+x];integral[(y+1)*stride+x+1]=integral[y*stride+x+1]+sum;}
 }
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const x0=Math.max(0,x-25),y0=Math.max(0,y-25),x1=Math.min(w,x+26),y1=Math.min(h,y+26);
  const mean=(integral[y1*stride+x1]-integral[y0*stride+x1]-integral[y1*stride+x0]+integral[y0*stride+x0])/((x1-x0)*(y1-y0));
  mask[y*w+x]=blur[y*w+x]<mean-offset?1:0;
 }
 if(cleanLines){
  const lines=new Uint8Array(n),length=80;
  for(let y=0;y<h;y++){
   let begin=-1;
   for(let x=0;x<=w;x++){
    if(x<w&&mask[y*w+x]){if(begin<0)begin=x;}
    else if(begin>=0){if(x-begin>=length)for(let xx=begin;xx<x;xx++)lines[y*w+xx]=1;begin=-1;}
   }
  }
  for(let x=0;x<w;x++){
   let begin=-1;
   for(let y=0;y<=h;y++){
    if(y<h&&mask[y*w+x]){if(begin<0)begin=y;}
    else if(begin>=0){if(y-begin>=length)for(let yy=begin;yy<y;yy++)lines[yy*w+x]=1;begin=-1;}
   }
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(lines[y*w+x]){
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<h)mask[(y+dy)*w+x+dx]=0;
  }
 }
 for(let i=0;i<n;i++){const v=mask[i]?0:255;data[i*4]=data[i*4+1]=data[i*4+2]=v;}
}

// 전체 사진과 겹치는 확대 구역을 준비한다. (크리에이트 스캔 패시스)
// 구역 경계의 코드도 포함하고 한 번에 캔버스 한 장씩 처리한다.
function createScanPasses(width,height,settings){
 const full={x:0,y:0,width,height};
 const passes=[{...full,name:'전체 원본',mode:'original',scale:Math.min(1,2400/Math.max(width,height))}];
 passes.push({...full,name:'전체 보정',mode:settings.mode,scale:Math.min(1,2400/Math.max(width,height))});
 if(settings.deep){
  const tw=Math.ceil(width*.5),th=Math.ceil(height*.65);
  for(let row=0;row<2;row++)for(let col=0;col<3;col++)passes.push({
   x:Math.round((width-tw)*col/2),y:(height-th)*row,width:tw,height:th,
   name:'확대 '+(row*3+col+1),mode:settings.mode,scale:Math.min(2,2000/Math.max(tw,th))
  });
 }
 return passes;
}

// 밝기·흑백 대비·인쇄물 보정을 차례로 적용한다. (어플라이 코렉션)
// 미리보기와 모든 OCR 입력에서 같은 필터를 사용한다.
function applyCorrection(image,settings){
 if(settings.brightness)for(let i=0;i<image.data.length;i+=4)for(let c=0;c<3;c++)image.data[i+c]+=settings.brightness;
 applyFilter(image.data,settings.strength);
 if(settings.mode==='print')printFilter(image,settings.threshold,settings.removeLines);
}

// 인식할 구역에 밝기·대비·인쇄물 보정을 적용한다. (렌더 스캔 패스)
// 실제 확대 비율을 반환하여 박스를 원본 사진 좌표로 되돌린다.
function renderScanPass(source,pass,settings){
 const crop=document.createElement('canvas');crop.width=pass.width;crop.height=pass.height;
 const ctx=crop.getContext('2d',{willReadFrequently:true});
 ctx.drawImage(source,pass.x,pass.y,pass.width,pass.height,0,0,crop.width,crop.height);
 if(pass.mode!=='original'){
  const pixels=ctx.getImageData(0,0,crop.width,crop.height);
  applyCorrection(pixels,{...settings,mode:pass.mode});
  ctx.putImageData(pixels,0,0);
 }
 const output=document.createElement('canvas');output.width=Math.max(1,Math.round(crop.width*pass.scale));output.height=Math.max(1,Math.round(crop.height*pass.scale));
 output.getContext('2d').drawImage(crop,0,0,output.width,output.height);crop.width=crop.height=1;
 return {image:output,scaleX:output.width/pass.width,scaleY:output.height/pass.height};
}

// 확대 구역의 박스를 원본 사진 위치로 변환한다. (맵 스캔 히츠)
// 전체 화면과 확대 검사 결과를 같은 좌표계에서 비교한다.
function mapScanHits(hits,pass,scaleX,scaleY){
 return hits.map(hit=>({...hit,bbox:{x0:hit.bbox.x0/scaleX+pass.x,y0:hit.bbox.y0/scaleY+pass.y,x1:hit.bbox.x1/scaleX+pass.x,y1:hit.bbox.y1/scaleY+pass.y}}));
}
