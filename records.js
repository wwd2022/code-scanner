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
  if(hit.review)button.classList.add('needs-review');
  if(hit.added)button.classList.add('checked');
  if(b.x1>frame.width/2)button.classList.add('label-left');
  button.style.left=(b.x0/frame.width*100)+'%';button.style.top=(b.y0/frame.height*100)+'%';
  button.style.width=((b.x1-b.x0)/frame.width*100)+'%';button.style.height=((b.y1-b.y0)/frame.height*100)+'%';
  button.setAttribute('aria-label',hit.code+' - '+location+' 목록에 추가');
  label.className='box-label';label.textContent=(hit.added?'✓ ':'')+hit.code+(hit.review?' · 확인':'');button.append(label);
  button.title=hit.code+' - '+location;
  button.addEventListener('click',event=>{event.stopPropagation();confirmCode(hit);});
  boxes.append(button);
 }
}

// 선택한 인식 결과를 확인하고 기록한다. (컨펌 코드)
// 수정 취소·규격 오류 시 박스를 유지하고 정상 저장 후에만 체크한다.
function confirmCode(hit){
 if(busy||hit.added)return;
 let code=hit.code;
 if(hit.review){
  const alternatives=hit.alternatives?.length?'\n다른 인식 후보: '+hit.alternatives.join(', '):'';
  const entered=window.prompt('사진과 비교해 품목코드를 확인하거나 수정하세요.'+alternatives,code);
  if(entered===null)return;
  code=normalizeCode(entered);
  if(!/^[A-Z0-9]{4}-[A-Z0-9]{6}$/.test(code)){
   status.textContent='코드는 영문·숫자 4자리-6자리로 입력하세요.';return;
  }
 }
 addRecord(code);hit.code=code;hit.added=true;hit.review=false;showBoxes(detectedHits);
 status.textContent=code+' 추가 완료';
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
