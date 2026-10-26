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
  if(amount===null)applyCorrection(image,getCorrectionSettings());
  else applyFilter(image.data,amount);
  ctx.putImageData(image,0,0);
 }
 return true;
}

// 조절 중에는 작은 이미지에 보정하고 표시 크기는 유지한다.
// 원본·OCR 좌표는 보존하며 미리보기용 캔버스를 재사용한다.
const previewBuffer=document.createElement('canvas');
function renderPreview(source,target){
 const width=source.width,height=source.height;
 const corrected=previewCorrection.checked||settingsAdjusting;
 let image=source;
 if(corrected){
  const scale=settingsAdjusting?Math.min(1,640/Math.max(width,height)):1;
  const w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
  if(previewBuffer.width!==w)previewBuffer.width=w;
  if(previewBuffer.height!==h)previewBuffer.height=h;
  const ctx=previewBuffer.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(source,0,0,w,h);
  const pixels=ctx.getImageData(0,0,w,h);
  applyCorrection(pixels,getCorrectionSettings());
  ctx.putImageData(pixels,0,0);
  image=previewBuffer;
 }
 if(target!==image){
  if(target.width!==width)target.width=width;
  if(target.height!==height)target.height=height;
  target.getContext('2d').drawImage(image,0,0,width,height);
 }
}

// 표시 옵션과 보정 설정을 즉시 반영한다. (업데이트 프리뷰)
// 확대·박스·인식 기록을 유지하며 화면 이미지만 다시 그린다.
function updatePreview(){
 document.getElementById('previewCorrectionValue').value=settingsAdjusting?'조절 중 · 보정':previewCorrection.checked?'ON · 보정':'OFF · 원본';
 if(activeTab==='camera'&&!frozenMode){
  if(stream&&drawCorrected(liveCanvas,0,settingsAdjusting?640:previewCorrection.checked?960:2200))renderPreview(liveCanvas,liveCanvas);
 }else if(frozenMode){
  const source=activeTab==='camera'?originalFrame:photoSource;
  if(source.width&&source.height)renderPreview(source,frame);
 }
}

// 보정 강도 표시와 다음 OCR 설정을 갱신한다.
// 미리보기는 설정창의 공통 입력 처리에서 한 번만 갱신한다.
function changeFilter(){
 strengthValue.value=strength.value;liveEpoch++;dots.replaceChildren();
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

// 모니터 노이즈·밝기·대비·인쇄물 보정을 차례로 적용한다. (어플라이 코렉션)
// 미리보기와 모든 OCR 입력에서 같은 필터를 사용한다.
function applyCorrection(image,settings){
 if(settings.screenNoise){
  if(settings.noiseMethod==='gaussian')applyGaussian(image,settings);
  else reduceScreenNoise(image,settings.screenNoise);
 }
 if(settings.brightness)for(let i=0;i<image.data.length;i+=4)for(let c=0;c<3;c++)image.data[i+c]+=settings.brightness;
 applyFilter(image.data,settings.strength);
 if(settings.mode==='print')printFilter(image,settings.threshold,settings.removeLines);
}

// 선택 영역의 보정 이미지 한 장을 만든다.
// 배율 1에서는 추가 캔버스 복사 없이 OCR에 바로 전달한다.
function renderScanPass(source,pass,settings){
 const image=document.createElement('canvas');image.width=pass.width;image.height=pass.height;
 const ctx=image.getContext('2d',{willReadFrequently:true});
 ctx.drawImage(source,pass.x,pass.y,pass.width,pass.height,0,0,image.width,image.height);
 const pixels=ctx.getImageData(0,0,image.width,image.height);
 applyCorrection(pixels,settings);ctx.putImageData(pixels,0,0);
 if(pass.scale===1)return {image,scaleX:1,scaleY:1};
 const output=document.createElement('canvas');output.width=Math.max(1,Math.round(image.width*pass.scale));output.height=Math.max(1,Math.round(image.height*pass.scale));
 output.getContext('2d').drawImage(image,0,0,output.width,output.height);
 image.width=image.height=1;
 return {image:output,scaleX:output.width/pass.width,scaleY:output.height/pass.height};
}

// 확대 구역의 박스를 원본 사진 위치로 변환한다. (맵 스캔 히츠)
// 전체 화면과 확대 검사 결과를 같은 좌표계에서 비교한다.
function mapScanHits(hits,pass,scaleX,scaleY){
 return hits.map(hit=>({...hit,bbox:{x0:hit.bbox.x0/scaleX+pass.x,y0:hit.bbox.y0/scaleY+pass.y,x1:hit.bbox.x1/scaleX+pass.x,y1:hit.bbox.y1/scaleY+pass.y}}));
}

// 주변 3×3 픽셀의 중간 밝기로 화면 색 점과 잔무늬를 완화한다.
// 강도 0은 원본이며 크기·좌표·투명도는 유지한다.
function reduceScreenNoise(image,amount){
 const {width,height,data}=image,gray=new Uint8Array(width*height),values=new Uint8Array(9);
 const mix=Math.max(0,Math.min(100,amount))/100;
 if(!mix)return;
 for(let i=0;i<gray.length;i++)gray[i]=Math.round(data[i*4]*.299+data[i*4+1]*.587+data[i*4+2]*.114);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let count=0;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   const value=gray[Math.max(0,Math.min(height-1,y+dy))*width+Math.max(0,Math.min(width-1,x+dx))];
   let index=count++;
   while(index>0&&values[index-1]>value){values[index]=values[index-1];index--;}
   values[index]=value;
  }
  const offset=(y*width+x)*4,median=values[4];
  for(let c=0;c<3;c++)data[offset+c]=Math.round(data[offset+c]*(1-mix)+median*mix);
 }
}

// 모든 입력 모드에서 현재 보정값을 같은 형식으로 읽는다.
// 미리보기·전체 인식·부분 재인식의 설정 누락을 막는다.
function getCorrectionSettings(){
 return {noiseMethod:noiseMethod.value,gaussianSize:Number(gaussianSize.value),gaussianX:Number(gaussianX.value),gaussianY:Number(gaussianY.value),screenNoise:Number(screenNoise.value),mode:filterMode.value,brightness:Number(brightness.value),strength:Number(strength.value),threshold:Number(threshold.value),removeLines:removeLines.checked};
}

// 가우시안 가중치를 정규화해 가로·세로에 따로 사용한다.
// 넓은 2차원 필터 대신 두 번의 1차원 계산으로 연산량을 줄인다.
function gaussianKernel(size,sigma){
 const kernel=new Float32Array(size),radius=(size-1)/2;
 let sum=0;
 for(let i=0;i<size;i++){const x=i-radius;kernel[i]=Math.exp(-x*x/(2*sigma*sigma));sum+=kernel[i];}
 for(let i=0;i<size;i++)kernel[i]/=sum;
 return kernel;
}

// 밝기 영상에 가로·세로 가우시안을 적용하고 원본과 혼합한다.
// 크기·좌표·투명도는 유지하며 강도 0은 공통 처리에서 생략한다.
function applyGaussian(image,settings){
 const {width,height,data}=image,size=Math.max(3,Math.min(15,Math.round(settings.gaussianSize/2)*2-1)),radius=(size-1)/2;
 const kx=gaussianKernel(size,Math.max(.1,settings.gaussianX)),ky=gaussianKernel(size,Math.max(.1,settings.gaussianY));
 const gray=new Float32Array(width*height),horizontal=new Float32Array(width*height),mix=settings.screenNoise/100;
 for(let i=0;i<gray.length;i++)gray[i]=data[i*4]*.299+data[i*4+1]*.587+data[i*4+2]*.114;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let sum=0;
  for(let k=0;k<size;k++)sum+=gray[y*width+Math.max(0,Math.min(width-1,x+k-radius))]*kx[k];
  horizontal[y*width+x]=sum;
 }
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let sum=0;
  for(let k=0;k<size;k++)sum+=horizontal[Math.max(0,Math.min(height-1,y+k-radius))*width+x]*ky[k];
  const offset=(y*width+x)*4;
  for(let c=0;c<3;c++)data[offset+c]=Math.round(data[offset+c]*(1-mix)+sum*mix);
 }
}
