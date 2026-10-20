// 인식한 코드 위에 코드 박스, 지정 방향에 위치 박스를 그린다. (쇼 박시스)
// OCR 좌표를 유지하며 투명도는 코드 박스에만 적용한다.
function showBoxes(hits){
 boxes.replaceChildren();
 const angle=(Number(locationDirectionIndex)-8)*Math.PI/16;
 const dx=Math.cos(angle)*110,dy=Math.sin(angle)*65;
 for(const hit of hits){
  const b=hit.bbox,found=locations.get(hit.code),location=found?.length?found.join(' / '):'ㅡ없음';
  const code=document.createElement('div'),place=document.createElement('div');
  code.className='code-box';
  if(!found?.length)code.classList.add('missing-box');
  if(hit.review)code.classList.add('needs-review');
  code.style.left=b.x0/frame.width*100+'%';code.style.top=b.y0/frame.height*100+'%';
  code.style.width=(b.x1-b.x0)/frame.width*100+'%';code.style.height=(b.y1-b.y0)/frame.height*100+'%';
  code.textContent=hit.code+(hit.review?' · 확인':'');
  code.style.opacity=Number(boxOpacity.value)/100;
  place.className='location-box';place.textContent=location;
  place.style.left=(b.x0+b.x1)/2/frame.width*100+'%';
  place.style.top=(b.y0+b.y1)/2/frame.height*100+'%';
  place.style.transform='translate(calc(-50% + '+dx+'px),calc(-50% + '+dy+'px))';
  place.title=hit.code+' / '+location;
  boxes.append(code,place);
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
