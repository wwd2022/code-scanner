// 코드 박스와 그 옆의 위치를 표시한다. (쇼 박시스)
// 사용자가 누른 박스만 기록하고 같은 박스의 재추가를 막는다.
function showBoxes(hits){
 boxes.replaceChildren();
 for(const hit of hits){
  const button=document.createElement('button'),label=document.createElement('span');
  const found=locations.get(hit.code),location=found?.length?found.join(' / '):'위치 없음';
  const b=hit.bbox;
  button.disabled=!!hit.added;button.type='button';button.className='code-box';
  if(!found?.length)button.classList.add('missing-box');
  if(b.x1>frame.width/2)button.classList.add('label-left');
  button.style.left=(b.x0/frame.width*100)+'%';button.style.top=(b.y0/frame.height*100)+'%';
  button.style.width=((b.x1-b.x0)/frame.width*100)+'%';button.style.height=((b.y1-b.y0)/frame.height*100)+'%';
  button.setAttribute('aria-label',hit.code+' - '+location+' 목록에 추가');
  label.className='box-label';label.textContent=location;button.append(label);
  button.addEventListener('click',event=>{
   event.stopPropagation();if(busy||button.disabled)return;
   addRecord(hit.code);hit.added=true;button.disabled=true;status.textContent=hit.code+' - '+location+' 추가 완료';
  });
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
