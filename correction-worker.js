// 메인 화면과 같은 필터를 전송된 픽셀에 적용한다.
importScripts('image.js');
self.onmessage=event=>{
 const {id,width,height,buffer,settings}=event.data;
 try{
  const image={width,height,data:new Uint8ClampedArray(buffer)};
  applyCorrection(image,settings);
  self.postMessage({id,buffer:image.data.buffer},[image.data.buffer]);
 }catch(error){self.postMessage({id,error:error.message||String(error)});}
};
