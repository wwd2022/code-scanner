// 인식 영역의 지정 방향에 박스를 일정하게 배치한다. (플레이스 레이블)
// 이미지 경계만 보정하고 다른 코드 주변으로 자동 이동하지 않는다.
function placeLabel(element,anchor,angle,width,height){
 const w=element.offsetWidth,h=element.offsetHeight,gap=4;
 const dx=Math.cos(angle),dy=Math.sin(angle);
 const x=anchor.x+anchor.w/2+dx*(anchor.w/2+w/2+gap)-w/2;
 const y=anchor.y+anchor.h/2+dy*(anchor.h/2+h/2+gap)-h/2;
 element.style.left=Math.max(0,Math.min(width-w,x))+'px';
 element.style.top=Math.max(0,Math.min(height-h,y))+'px';
}

// 인식 글자는 그대로 두고 코드·위치 라벨을 주변에 표시한다. (쇼 박시스)
// 기존 색상·조이스틱 설정을 유지하며 OCR 박스 위 덮개를 제거한다.
function showBoxes(hits){
 boxes.replaceChildren();
 const indicator=document.getElementById('boxVisibility');
 indicator.hidden=false;indicator.textContent=boxes.hidden?'박스 숨김':'박스 표시';
 const width=boxes.clientWidth,height=boxes.clientHeight;
 if(!width||!height||!frame.width||!frame.height)return;
 const codeAngle=codeDirectionIndex===null?-Math.PI/2:(codeDirectionIndex-4)*Math.PI/8;
 const placeAngle=(locationDirectionIndex-4)*Math.PI/8;
 for(const hit of hits){
  const b=hit.bbox,found=locations.get(hit.code),location=found?.length?found.join(' / '):'ㅡ없음';
  const anchor={x:b.x0/frame.width*width,y:b.y0/frame.height*height,w:(b.x1-b.x0)/frame.width*width,h:(b.y1-b.y0)/frame.height*height};
  const code=document.createElement('div'),place=document.createElement('div');
  code.className='code-box';
  if(!found?.length)code.classList.add('missing-box');
  if(hit.review)code.classList.add('needs-review');
  code.textContent=hit.code;code.title=hit.review?'확인 필요: '+hit.code:hit.code;
  place.className='location-box';place.textContent=location;place.title=hit.code+' / '+location;
  boxes.append(code,place);
  placeLabel(code,anchor,codeAngle,width,height);
  placeLabel(place,anchor,placeAngle,width,height);
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
