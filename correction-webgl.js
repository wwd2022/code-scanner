// 보정 워커 안에서만 WebGL2 자원을 만들고 재사용한다.
let gpuCorrection=null,gpuCorrectionFailure='';
function releaseGpuCorrection(){
 if(!gpuCorrection)return;
 const {gl,textures,programs,framebuffer,vao}=gpuCorrection;
 textures.forEach(texture=>gl.deleteTexture(texture));
 programs.forEach(program=>gl.deleteProgram(program));
 gl.deleteFramebuffer(framebuffer);gl.deleteVertexArray(vao);
 gl.getExtension('WEBGL_lose_context')?.loseContext();
 gpuCorrection=null;
}

function createGpuCorrection(){
 if(typeof OffscreenCanvas==='undefined')throw new Error('OffscreenCanvas 미지원');
 const canvas=new OffscreenCanvas(1,1);
 const gl=canvas.getContext('webgl2',{antialias:false,depth:false,stencil:false,premultipliedAlpha:false,powerPreference:'high-performance',failIfMajorPerformanceCaveat:true});
 if(!gl)throw new Error('WebGL2 컨텍스트 사용 불가');
 gpuCorrection={gl,textures:[],programs:[],framebuffer:null,vao:null,width:0,height:0};
 const vertex=`#version 300 es
 void main(){
  vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));
  gl_Position=vec4(p*2.0-1.0,0.0,1.0);
 }`;
 const header=`#version 300 es
 precision highp float;
 precision highp int;
 uniform sampler2D source;
 out vec4 outputColor;
 vec4 pixel(ivec2 p){return texelFetch(source,clamp(p,ivec2(0),textureSize(source,0)-1),0);}
 vec3 bytesAt(ivec2 p){return floor(pixel(p).rgb*255.0+0.5);}
 float grayAt(ivec2 p){return floor(dot(bytesAt(p),vec3(0.299,0.587,0.114))+0.5);}
 `;
 const color=header+`
 uniform float noiseMix;
 uniform float brightness;
 uniform float contrastMix;
 void main(){
  ivec2 p=ivec2(gl_FragCoord.xy);
  vec3 rgb=bytesAt(p);
  if(noiseMix>0.0){
   float values[9];int n=0;
   for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){values[n]=grayAt(p+ivec2(x,y));n++;}
   for(int i=1;i<9;i++)for(int j=8;j>0;j--){
    if(j<=i&&values[j-1]>values[j]){float v=values[j];values[j]=values[j-1];values[j-1]=v;}
   }
   rgb=floor(mix(rgb,vec3(values[4]),noiseMix)+0.5);
  }
  rgb=clamp(rgb+brightness,0.0,255.0);
  if(contrastMix>0.0){
   float gray=dot(rgb,vec3(0.299,0.587,0.114));
   rgb=roundEven(clamp((mix(rgb,vec3(gray),contrastMix)-128.0)*(1.0+contrastMix*1.5)+128.0,0.0,255.0));
  }
  outputColor=vec4(rgb/255.0,pixel(p).a);
 }`;
 const blur=header+`
 void main(){
  ivec2 p=ivec2(gl_FragCoord.xy);float sum=0.0;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
   sum+=grayAt(p+ivec2(x,y))*float((x==0?2:1)*(y==0?2:1));
  }
  float gray=floor(sum/16.0+0.5);
  outputColor=vec4(vec3(gray/255.0),pixel(p).a);
 }`;
 const compile=(type,source)=>{
  const shader=gl.createShader(type);
  if(!shader)throw new Error('WebGL2 셰이더 할당 실패');
  gl.shaderSource(shader,source);gl.compileShader(shader);
  if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){
   const reason=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(reason||'WebGL2 셰이더 준비 실패');
  }
  return shader;
 };
 const createProgram=fragment=>{
  let vs,fs,program;
  try{
   vs=compile(gl.VERTEX_SHADER,vertex);fs=compile(gl.FRAGMENT_SHADER,fragment);program=gl.createProgram();
   if(!program)throw new Error('WebGL2 프로그램 할당 실패');
   gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
   if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'WebGL2 프로그램 연결 실패');
   gpuCorrection.programs.push(program);return program;
  }catch(error){if(program)gl.deleteProgram(program);throw error;}
  finally{if(vs)gl.deleteShader(vs);if(fs)gl.deleteShader(fs);}
 };
 gpuCorrection.colorProgram=createProgram(color);gpuCorrection.blurProgram=createProgram(blur);
 for(let i=0;i<2;i++){
  const texture=gl.createTexture();
  if(!texture)throw new Error('WebGL2 텍스처 할당 실패');
  gpuCorrection.textures.push(texture);gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 }
 gpuCorrection.framebuffer=gl.createFramebuffer();gpuCorrection.vao=gl.createVertexArray();
 if(!gpuCorrection.framebuffer||!gpuCorrection.vao)throw new Error('WebGL2 버퍼 할당 실패');
 const maxTexture=gl.getParameter(gl.MAX_TEXTURE_SIZE),maxViewport=gl.getParameter(gl.MAX_VIEWPORT_DIMS);
 gpuCorrection.maxWidth=Math.min(maxTexture,maxViewport[0]);gpuCorrection.maxHeight=Math.min(maxTexture,maxViewport[1]);
 gl.disable(gl.DITHER);gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);
 gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.pixelStorei(gl.PACK_ALIGNMENT,1);
 gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
 gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
 return gpuCorrection;
}

// 입력·출력 모두 같은 텍스처 행 순서를 사용해 상하 좌표를 유지한다.
function prepareGpuPixels(image,settings){
 const state=gpuCorrection||createGpuCorrection(),{gl,textures,framebuffer,vao}=state;
 const {width,height,data}=image;
 if(gl.isContextLost())throw new Error('WebGL2 컨텍스트 손실');
 if(width>state.maxWidth||height>state.maxHeight)throw new Error('WebGL2 이미지 크기 제한');
 gl.activeTexture(gl.TEXTURE0);
 if(state.width!==width||state.height!==height){
  for(const texture of textures){
   gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  }
  state.width=width;state.height=height;
 }
 gl.bindTexture(gl.TEXTURE_2D,textures[0]);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(data.buffer,data.byteOffset,data.byteLength));
 gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.bindVertexArray(vao);gl.viewport(0,0,width,height);
 const draw=(program,input,output)=>{
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,output,0);
  if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('WebGL2 출력 버퍼 사용 불가');
  gl.useProgram(program);gl.bindTexture(gl.TEXTURE_2D,input);gl.uniform1i(gl.getUniformLocation(program,'source'),0);
  if(program===state.colorProgram){
   gl.uniform1f(gl.getUniformLocation(program,'noiseMix'),Math.max(0,Math.min(100,settings.screenNoise))/100);
   gl.uniform1f(gl.getUniformLocation(program,'brightness'),settings.brightness||0);
   gl.uniform1f(gl.getUniformLocation(program,'contrastMix'),settings.strength/100);
  }
  gl.drawArrays(gl.TRIANGLES,0,3);
 };
 let current=0;
 if(settings.screenNoise||settings.brightness||settings.strength){draw(state.colorProgram,textures[0],textures[1]);current=1;}
 if(settings.mode==='print'){draw(state.blurProgram,textures[current],textures[1-current]);current=1-current;}
 const output=new Uint8Array(data.byteLength);
 gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,textures[current],0);
 gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,output);
 const error=gl.getError();
 if(error!==gl.NO_ERROR||gl.isContextLost())throw new Error('WebGL2 픽셀 처리 실패 ('+error+')');
 if(settings.mode==='print'){
  const blur=new Uint8Array(width*height);
  for(let i=0;i<blur.length;i++)blur[i]=output[i*4];
  return {blur};
 }
 data.set(output);return {};
}

// 실패한 GPU 경로는 해제하고 변경되지 않은 입력을 CPU로 처리한다.
function correctWorkerPixels(image,settings){
 const inkFiltered=['black','nonblack'].includes(settings.inkColor);
 if(inkFiltered){
  filterInkColor(image,settings);settings={...settings,inkColor:'all'};
 }
 let prepared=null,path='CPU 보정 워커';
 if(settings.acceleration==='cpu'){releaseGpuCorrection();gpuCorrectionFailure='';}
 else if(settings.screenNoise||settings.brightness||settings.strength||settings.mode==='print'){
  if(!gpuCorrectionFailure){
   try{prepared=prepareGpuPixels(image,settings);path='WebGL2 보정'+(settings.mode==='print'||settings.removeSpecks?' + CPU 마무리':'');}
   catch(error){gpuCorrectionFailure=(error.message||String(error)).slice(0,140);releaseGpuCorrection();}
  }
  if(!prepared)path+=' · WebGL2 대체: '+gpuCorrectionFailure;
 }else path+=' · GPU 처리 대상 없음';
 applyCorrection(image,settings,prepared);
 return (inkFiltered?'CPU 색상 선별 → ':'')+path;
}
