// 저장된 엑셀용 데이터베이스를 연다. (오픈 캐시)
// 페이지를 다시 열 때도 같은 브라우저에서 데이터를 읽는다.
function openCache(){
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open('item-location-cache',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('files');
  request.onsuccess=()=>{database=request.result;resolve();};
  request.onerror=()=>reject(request.error);
  request.onblocked=()=>reject(new Error('다른 탭을 닫고 다시 시도하세요.'));
 });
}

// 엑셀 데이터 한 건을 읽거나 저장한다. (캐시 워크북)
// 저장 완료 이후에만 다음 접속에서도 복원된다고 안내한다.
function cacheWorkbook(value){
 return new Promise((resolve,reject)=>{
  if(!database){reject(new Error('브라우저 저장소를 사용할 수 없습니다.'));return;}
  const transaction=database.transaction('files',value===undefined?'readonly':'readwrite');
  const store=transaction.objectStore('files');
  const request=value===undefined?store.get('excel'):store.put(value,'excel');
  transaction.oncomplete=()=>resolve(request.result);
  transaction.onerror=()=>reject(transaction.error);
  transaction.onabort=()=>reject(transaction.error||new Error('저장 중단'));
 });
}

// 선택한 시트의 코드와 위치를 조회표로 만든다. (빌드 로케이션스)
// 헤더와 잘못된 코드는 제외하고 중복 코드의 위치는 함께 표시한다.
function buildLocations(rows){
 const map=new Map();
 for(const row of rows){
  const code=normalizeCode(row[0]);
  if(!/^[A-Z0-9]{4}-[A-Z0-9]{6}$/.test(code))continue;
  const location=String(row[1]??'').trim();
  if(!map.has(code))map.set(code,[]);
  if(location&&!map.get(code).includes(location))map.get(code).push(location);
 }
 return map;
}

// 불러온 엑셀의 시트와 조회표를 화면에 반영한다. (쇼 워크북)
// 저장된 시트를 선택하고 유효한 물품코드 수를 표시한다.
function showWorkbook(){
 sheet.replaceChildren();
 for(const name of Object.keys(workbook.sheets)){
  const option=document.createElement('option');option.value=name;option.textContent=name;sheet.append(option);
 }
 if(!Object.hasOwn(workbook.sheets,workbook.selected))workbook.selected=sheet.value;
 sheet.value=workbook.selected;
 document.getElementById('sheetLabel').hidden=sheet.options.length<2;
 locations=buildLocations(workbook.sheets[workbook.selected]);
 refreshRecords();
 if(frozenMode)showBoxes(detectedHits);
 excelStatus.textContent=workbook.name+' · '+workbook.selected+' · '+locations.size+'개 코드';
 start.disabled=!!stream||starting;
}

// 엑셀 파일을 읽고 다음 접속용 데이터를 저장한다. (로드 엑셀)
// A열과 B열만 사용하며 기존 카메라와 기록은 유지한다.
async function loadExcel(){
 const file=excel.files[0];if(!file||busy||starting)return;
 excel.disabled=true;sheet.disabled=true;start.disabled=true;busy=true;
 excelStatus.textContent='엑셀을 읽는 중…';
 try{
  if(!window.XLSX)throw new Error('엑셀 라이브러리 로딩 실패. 인터넷 연결 후 새로고침하세요.');
  const book=XLSX.read(await file.arrayBuffer(),{type:'array'}),sheets=Object.create(null);
  for(const name of book.SheetNames){
   const rows=XLSX.utils.sheet_to_json(book.Sheets[name],{header:1,raw:false,defval:''});
   sheets[name]=rows.map(row=>[row[0]??'',row[1]??'']);
  }
  if(!book.SheetNames.length)throw new Error('시트가 없습니다.');
  workbook={name:file.name,sheets,selected:book.SheetNames[0]};showWorkbook();
  try{await cacheWorkbook(workbook);excelStatus.textContent+=' · 자동 복원 저장 완료';}
  catch(error){excelStatus.textContent+=' · 저장 실패: 이번 접속에서만 사용 가능';}
  status.textContent=locations.size?'엑셀 준비 완료 · 인식 버튼으로 코드를 검사하세요.':'이 시트에 규격에 맞는 코드가 없습니다. 다른 시트를 선택하세요.';
 }catch(error){excelStatus.textContent='엑셀 읽기 실패: '+error.message;if(workbook)showWorkbook();status.textContent='엑셀 파일을 다시 선택하세요.';}
 finally{excel.value='';excel.disabled=false;sheet.disabled=false;busy=false;start.disabled=!!stream||starting;}
}

// 조회할 시트를 바꾸고 선택을 저장한다. (체인지 시트)
// 이후 코드 조회와 다음 접속에서 같은 시트를 사용한다.
async function changeSheet(){
 if(!workbook||busy)return;
 busy=true;sheet.disabled=true;excel.disabled=true;
 workbook.selected=sheet.value;showWorkbook();
 try{await cacheWorkbook(workbook);excelStatus.textContent+=' · 자동 복원 저장 완료';}
 catch(error){excelStatus.textContent+=' · 시트 선택 저장 실패';}
 finally{busy=false;sheet.disabled=false;excel.disabled=false;}
}

// 저장된 엑셀 데이터를 페이지 시작 시 복원한다. (리스토어 엑셀)
// 파일을 다시 고르지 않고 이전 코드와 위치로 조회할 수 있게 한다.
async function restoreExcel(){
 busy=true;lockInputs(true);excel.disabled=true;
 try{
  await openCache();const saved=await cacheWorkbook();
  if(saved){workbook=saved;showWorkbook();excelStatus.textContent+=' · 저장 데이터 복원 완료';status.textContent='엑셀 복원 완료 · 카메라 또는 사진을 선택하세요.';}
  else excelStatus.textContent='엑셀을 한 번 선택하면 다음 접속부터 자동 복원합니다.';
 }catch(error){excelStatus.textContent='자동 저장소를 사용할 수 없습니다. 엑셀을 직접 선택하세요.';}
 finally{busy=false;lockInputs(false);excel.disabled=false;}
}

