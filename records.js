// 인식 코드와 엑셀 위치를 박스 아래 양쪽에 표시한다. (쇼 박시스)
// 박스는 코드와 엑셀 위치만 보여주며 클릭 동작은 없다.
function showBoxes(hits){
 boxes.replaceChildren();
 for(const hit of hits){
  const button=document.createElement('div'),label=document.createElement('span');
  const found=locations.get(hit.code),location=found?.length?found.join(' / '):'ㅡ없음';
  const b=hit.bbox;
  button.className='code-box';
  if(!found?.length)button.classList.add('missing-box');
  if(hit.review)button.classList.add('needs-review');
  if(b.x1>frame.width/2)button.classList.add('label-left');
  button.style.left=b.x0/frame.width*100+'%';button.style.top=b.y0/frame.height*100+'%';
  button.style.width=(b.x1-b.x0)/frame.width*100+'%';button.style.height=(b.y1-b.y0)/frame.height*100+'%';
  button.setAttribute('aria-label',hit.code+' · 위치 '+location);
  label.className='box-label';
  const codeText=document.createElement('span'),locationText=document.createElement('span');
  codeText.textContent=hit.code+(hit.review?' · 확인':'');
  locationText.textContent=location;
  label.append(codeText,locationText);button.append(label);
  button.title=hit.code+' / '+location;
  boxes.append(button);
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
