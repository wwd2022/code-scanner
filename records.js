// OCR 글자를 가리지 않는 방향에 표시 박스를 배치한다. (플레이스 레이블)
// 화면 경계·다른 인식 글자·이미 배치한 박스와의 겹침을 최소화한다.
function placeLabel(element,anchor,angle,obstacles,placed,width,height){
 const w=element.offsetWidth,h=element.offsetHeight,gap=5;
 const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
 let best=null,bestScore=Infinity;
 for(let step=0;step<16;step++){
  const theta=angle+(step%2? -1:1)*Math.ceil(step/2)*Math.PI/8;
  const dx=Math.cos(theta),dy=Math.sin(theta);
  const distance=Math.min((anchor.w/2+gap)/Math.max(.01,Math.abs(dx)),(anchor.h/2+gap)/Math.max(.01,Math.abs(dy)));
  const x=Math.max(0,Math.min(width-w,anchor.x+anchor.w/2+dx*(distance+Math.max(w,h)/2)-w/2));
  const y=Math.max(0,Math.min(height-h,anchor.y+anchor.h/2+dy*(distance+Math.max(w,h)/2)-h/2));
  const rect={x,y,w,h};
  const score=obstacles.reduce((s,r)=>s+overlap(rect,r)*100,0)+placed.reduce((s,r)=>s+overlap(rect,r)*10,0)+step*2;
  if(score<bestScore){bestScore=score;best=rect;}
  if(score===0)break;
 }
 element.style.left=best.x+'px';element.style.top=best.y+'px';
 placed.push(best);
}

// 인식한 글자 바깥에 코드·위치 박스를 배치한다. (쇼 박시스)
// OCR 좌표와 사용자 설정은 유지하고 기준 글자의 가림만 줄인다.
function showBoxes(hits){
 boxes.replaceChildren();
 const indicator=document.getElementById('boxVisibility');
 indicator.hidden=false;indicator.textContent=boxes.hidden?'박스 숨김':'박스 표시';
 const width=boxes.clientWidth,height=boxes.clientHeight;
 if(!width||!height||!frame.width||!frame.height)return;
 const obstacles=hits.map(hit=>({x:hit.bbox.x0/frame.width*width,y:hit.bbox.y0/frame.height*height,w:(hit.bbox.x1-hit.bbox.x0)/frame.width*width,h:(hit.bbox.y1-hit.bbox.y0)/frame.height*height}));
 const placed=[];
 const codeAngle=codeDirectionIndex===null?-Math.PI/2:(codeDirectionIndex-4)*Math.PI/8;
 const placeAngle=(locationDirectionIndex-4)*Math.PI/8;
 for(let i=0;i<hits.length;i++){
  const hit=hits[i],found=locations.get(hit.code),location=found?.length?found.join(' / '):'ㅡ없음';
  const code=document.createElement('div'),place=document.createElement('div');
  code.className='code-box';
  if(!found?.length)code.classList.add('missing-box');
  if(hit.review)code.classList.add('needs-review');
  code.textContent=hit.code;code.title=hit.review?'확인 필요: '+hit.code:hit.code;
  place.className='location-box';place.textContent=location;place.title=hit.code+' / '+location;
  boxes.append(code,place);
  placeLabel(code,obstacles[i],codeAngle,obstacles,placed,width,height);
  placeLabel(place,obstacles[i],placeAngle,obstacles,placed,width,height);
 }
}

// 유효한 코드와 조회 위치를 한 줄로 기록한다. (애드 레코드)
// 엑셀에 없는 코드도 위치 없음으로 추가하고 규격 밖 코드는 제외한다.
function addRecord(code){
 if(!/^[A-Z0-9]{4}-[A-Z0-9]{6}$/.test(code))return;
 const row=document.createElement('div');row.className='record';
 const found=locations.get(code);
 if(!found){row.classList.add('missing');row.textContent=code+' - 위치 없음 (엑셀에 없는 코드)';}
 else if(!found.length){row.classList.add('missing');row.textContent=code+' - 위치 없음 (엑셀 위치 미입력)';}
 else row.textContent=code+' - '+found.join(' / ');
 records.append(row);document.getElementById('empty').hidden=true;
 document.getElementById('count').textContent=String(++recordCount);
}
