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
  if(amount===null)applyCorrection(image,{...getCorrectionSettings(),pixelScale:Math.max(width,height)/correctionReferenceEdge});
  else applyFilter(image.data,amount);
  ctx.putImageData(image,0,0);
 }
 return true;
}

// 조절 중에는 작은 이미지에 보정하고 표시 크기는 유지한다.
// 원본·OCR 좌표는 보존하며 미리보기용 캔버스를 재사용한다.
const previewBuffer=typeof document==='undefined'?null:document.createElement('canvas');
function renderPreview(source,target){
 const width=source.width,height=source.height;
 const corrected=previewCorrection.checked||settingsAdjusting;
 let image=source;
 if(corrected){
  const scale=Math.min(1,getPreviewMaxSize()/Math.max(width,height));
  const w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
  if(previewBuffer.width!==w)previewBuffer.width=w;
  if(previewBuffer.height!==h)previewBuffer.height=h;
  const ctx=previewBuffer.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(source,0,0,w,h);
  const pixels=ctx.getImageData(0,0,w,h);
  applyCorrection(pixels,{...getCorrectionSettings(),pixelScale:Math.max(w,h)/correctionReferenceEdge});
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
  if(stream&&drawCorrected(liveCanvas,0,settingsAdjusting?getPreviewMaxSize():previewCorrection.checked?Math.min(960,getPreviewMaxSize()):2200))renderPreview(liveCanvas,liveCanvas);
 }else if(frozenMode){
  const source=activeTab==='camera'?originalFrame:photoSource;
  if(source.width&&source.height)renderPreview(source,frame);
 }
}

// 공간 보정값은 전체 이미지의 긴 변 2200px 기준이다.
const correctionReferenceEdge=2200;
// 주변 밝기와 긴 표 선의 처리 범위를 해상도에 맞춘다.
function printFilter(image,offset=16,cleanLines=true,pixelScale=1){
 const {width:w,height:h,data}=image,n=w*h,gray=new Uint8Array(n),blur=new Uint8Array(n);
 const radius=Math.max(1,Math.round(25*pixelScale));
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
  const x0=Math.max(0,x-radius),y0=Math.max(0,y-radius),x1=Math.min(w,x+radius+1),y1=Math.min(h,y+radius+1);
  const mean=(integral[y1*stride+x1]-integral[y0*stride+x1]-integral[y1*stride+x0]+integral[y0*stride+x0])/((x1-x0)*(y1-y0));
  mask[y*w+x]=blur[y*w+x]<mean-offset?1:0;
 }
 if(cleanLines){
  const lines=new Uint8Array(n),length=Math.max(2,Math.round(80*pixelScale)),padding=Math.max(0,Math.round(pixelScale));
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
   for(let dy=-padding;dy<=padding;dy++)for(let dx=-padding;dx<=padding;dx++)if(x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<h)mask[(y+dy)*w+x+dx]=0;
  }
 }
 for(let i=0;i<n;i++){const v=mask[i]?0:255;data[i*4]=data[i*4+1]=data[i*4+2]=v;}
}

// 모니터 노이즈·밝기·대비·인쇄물 보정을 차례로 적용한다. (어플라이 코렉션)
// 미리보기와 모든 OCR 입력에서 같은 필터를 사용한다.
function applyCorrection(image,settings){
 if(settings.screenNoise)reduceScreenNoise(image,settings.screenNoise);
 if(settings.brightness)for(let i=0;i<image.data.length;i+=4)for(let c=0;c<3;c++)image.data[i+c]+=settings.brightness;
 applyFilter(image.data,settings.strength);
 if(settings.mode==='print')printFilter(image,settings.threshold,settings.removeLines,settings.pixelScale??1);
 if(settings.removeSpecks){
  const area=Math.floor(settings.speckArea*(settings.pixelScale??1)**2);
  if(area>0)removeSmallDarkRegions(image,area,settings.speckThreshold);
 }
}

// 낮은 해상도는 먼저 축소한 뒤 보정해 픽셀 연산도 줄인다.
// 확대 시에는 보정을 한 번 적용한 결과만 확대하고 실제 좌표 배율을 반환한다.
async function renderScanPass(source,pass,settings){
 const workingScale=Math.min(1,pass.scale);
 const image=document.createElement('canvas');
 image.width=Math.max(1,Math.round(pass.width*workingScale));image.height=Math.max(1,Math.round(pass.height*workingScale));
 const ctx=image.getContext('2d',{willReadFrequently:true});
 ctx.drawImage(source,pass.x,pass.y,pass.width,pass.height,0,0,image.width,image.height);
 // 잘라낸 영역도 전체 이미지의 기준 배율을 유지한다.
 const pixelScale=(settings.referenceEdge||Math.max(source.width,source.height))/correctionReferenceEdge*Math.min(image.width/pass.width,image.height/pass.height);
 let correctionPath;
 try{correctionPath=await correctCanvas(image,{...settings,pixelScale});}
 catch(error){image.width=image.height=1;throw error;}
 if(pass.scale<=1)return {image,scaleX:image.width/pass.width,scaleY:image.height/pass.height,correctionPath};
 const output=document.createElement('canvas');
 output.width=Math.max(1,Math.round(pass.width*pass.scale));output.height=Math.max(1,Math.round(pass.height*pass.scale));
 output.getContext('2d').drawImage(image,0,0,output.width,output.height);
 image.width=image.height=1;
 return {image:output,scaleX:output.width/pass.width,scaleY:output.height/pass.height,correctionPath};
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
function getCorrectionSettings(referenceEdge=0){
 return {referenceEdge,ocrMaxEdge:Number(ocrSize.value),ocrWorkers:Number(workerCount.value),removeSpecks:removeSpecks.checked,speckArea:Number(speckArea.value),speckThreshold:Number(speckThreshold.value),screenNoise:Number(screenNoise.value),mode:filterMode.value,brightness:Number(brightness.value),strength:Number(strength.value),threshold:Number(threshold.value),removeLines:removeLines.checked};
}

// 대각선을 포함해 연결된 검은 영역 중 지정 면적 이하만 지운다.
// 원래 픽셀의 연결을 기준으로 판정하고 크기·좌표·투명도는 유지한다.
function removeSmallDarkRegions(image,maxArea,threshold){
 const {width,height,data}=image,length=width*height;
 const mask=new Uint8Array(length),queue=new Int32Array(length);
 for(let i=0;i<length;i++){
  const p=i*4;
  if(data[p+3]&&data[p]*.299+data[p+1]*.587+data[p+2]*.114<threshold)mask[i]=1;
 }
 for(let start=0;start<length;start++){
  if(!mask[start])continue;
  let head=0,tail=1;queue[0]=start;mask[start]=0;
  while(head<tail){
   const p=queue[head++],x=p%width,y=Math.floor(p/width);
   for(let ny=Math.max(0,y-1);ny<=Math.min(height-1,y+1);ny++){
    for(let nx=Math.max(0,x-1);nx<=Math.min(width-1,x+1);nx++){
     const next=ny*width+nx;
     if(mask[next]){mask[next]=0;queue[tail++]=next;}
    }
   }
  }
  if(tail<=maxArea)for(let i=0;i<tail;i++){
   const p=queue[i]*4;data[p]=data[p+1]=data[p+2]=255;
  }
 }
}

// 표시용 보정 픽셀 수는 OCR 해상도와 별도로 제한한다.
function getPreviewMaxSize(){
 return previewQuality.value==='low'?640:960;
}

// 큰 OCR 입력의 픽셀 연산만 옮기고 필터 구현은 공유한다.
let correctionWorker=null,correctionWorkerFailed=false,correctionRequestId=0;
const correctionRequests=new Map();
function releaseCorrectionWorker(){
 if(correctionWorker)correctionWorker.terminate();
 correctionWorker=null;
 for(const request of correctionRequests.values())request.reject(new Error('보정 워커 종료'));
 correctionRequests.clear();
}
function getCorrectionWorker(){
 if(correctionWorkerFailed||typeof Worker==='undefined')return null;
 if(correctionWorker)return correctionWorker;
 try{
  const created=new Worker('correction-worker.js');correctionWorker=created;
  created.onmessage=event=>{
   const message=event.data,request=correctionRequests.get(message.id);
   if(!request)return;
   correctionRequests.delete(message.id);
   if(message.error)request.reject(new Error(message.error));
   else request.resolve(message.buffer);
  };
  const fail=event=>{event.preventDefault?.();correctionWorkerFailed=true;releaseCorrectionWorker();};
  created.onerror=fail;created.onmessageerror=fail;
  return created;
 }catch(error){correctionWorkerFailed=true;return null;}
}

// 전송 실패 시 원본 픽셀을 다시 읽어 같은 필터로 처리한다.
async function correctCanvas(canvas,settings){
 if(!settings.screenNoise&&!settings.brightness&&!settings.strength&&settings.mode!=='print'&&!settings.removeSpecks)return '원본';
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 const width=canvas.width,height=canvas.height;
 let pixels=ctx.getImageData(0,0,width,height);
 const target=getCorrectionWorker();
 if(target){
  const id=++correctionRequestId;
  try{
   const buffer=await new Promise((resolve,reject)=>{
    correctionRequests.set(id,{resolve,reject});
    try{target.postMessage({id,width,height,buffer:pixels.data.buffer,settings},[pixels.data.buffer]);}
    catch(error){correctionRequests.delete(id);reject(error);}
   });
   ctx.putImageData(new ImageData(new Uint8ClampedArray(buffer),width,height),0,0);
   return '보정 워커';
  }catch(error){
   correctionWorkerFailed=true;releaseCorrectionWorker();
   pixels=ctx.getImageData(0,0,width,height);
  }
 }
 applyCorrection(pixels,settings);ctx.putImageData(pixels,0,0);
 return '화면 스레드 · 대체 처리';
}

