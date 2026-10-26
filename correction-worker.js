// 메인 화면과 같은 필터를 전송된 픽셀에 적용한다.
importScripts('image.js');
let gpuScriptFailure='';
try{importScripts('correction-webgl.js');}catch(error){gpuScriptFailure=error.message||String(error);}
self.onmessage=event=>{
 const {id,width,height,buffer,settings}=event.data;
 try{
  const image={width,height,data:new Uint8ClampedArray(buffer)};
  let path;
  if(gpuScriptFailure){applyCorrection(image,settings);path='CPU 보정 워커 · WebGL2 모듈 불가';}
  else path=correctWorkerPixels(image,settings);
  self.postMessage({id,buffer:image.data.buffer,path},[image.data.buffer]);
 }catch(error){self.postMessage({id,error:error.message||String(error)});}
};
