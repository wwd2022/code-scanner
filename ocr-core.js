// DOM과 워커에 의존하지 않는 코드 해석·좌표 구역 함수.
// 코드의 표기를 통일한다. (노멀라이즈 코드)
// 공백과 하이픈을 정리해 엑셀 조회에 사용한다.
function normalizeCode(value){
 return String(value??'').trim().replace(/[‐‑‒–—−﹣－]/g,'-').replace(/\s/g,'').toUpperCase();
}

// OCR 문장에서 규격에 맞는 코드와 문자열 위치를 찾는다. (파인드 코즈)
// 단일 체크 V만 제외하고 임의의 긴 식별자는 코드로 잘라내지 않는다.
function findCodes(text){
 const normalized=text.replace(/[‐‑‒–—−﹣－~]/g,'-'),matches=[];
 const patterns=[
  {regex:/(?:^|[^A-Za-z0-9])([A-Za-z0-9]{4}[ \t]*-[ \t]*(?:[A-Za-z0-9]{6}|[0-9]{3}[ \t]+[0-9]{3}))(?![A-Za-z0-9])/g,review:false},
  {regex:/(?:^|[^A-Za-z0-9])([A-Za-z0-9]{4}[ \t]*-[ \t]*(?:[A-Za-z0-9]{6}|[0-9]{3}[ \t]+[0-9]{3}))(?=[Vv](?:$|[^A-Za-z0-9]))/g,review:true}
 ];
 for(const {regex,review} of patterns)for(const match of normalized.matchAll(regex)){
  const start=match.index+match[0].length-match[1].length,end=start+match[1].length;
  if(matches.some(item=>item.start===start))continue;
  matches.push({code:normalizeCode(match[1]),start,end,review:review||text.slice(start,end).includes('~')});
 }
 return matches.sort((a,b)=>a.start-b.start);
}

// 화면 전체 OCR에서 코드별 좌표를 구한다. (컬렉트 히츠)
// 같은 코드가 여러 곳에 보여도 각 위치에 박스를 만든다.
function collectHits(data){
 const hits=[];
 for(const block of data.blocks||[])for(const paragraph of block.paragraphs||[])for(const line of paragraph.lines||[]){
  let text='';const spans=[];
  for(const word of line.words||[]){
   if(text)text+=' ';const start=text.length;text+=word.text;
   spans.push({start,end:text.length,word});
  }
  for(const match of findCodes(text)){
   const selected=spans.filter(span=>span.end>match.start&&span.start<match.end);
   const bounds=[],glyphHeights=[];
   for(const span of selected){
    const symbols=span.word.symbols||[];
    if(symbols.length&&symbols.map(symbol=>symbol.text).join('')===span.word.text){
     let offset=span.start;
     for(const symbol of symbols){
      const end=offset+symbol.text.length;
      if(end>match.start&&offset<match.end&&symbol.bbox){
       bounds.push(symbol.bbox);
       if(/^[A-Za-z0-9]$/.test(symbol.text)&&symbol.bbox.y1>symbol.bbox.y0)glyphHeights.push(symbol.bbox.y1-symbol.bbox.y0);
      }
      offset=end;
     }
    }else if(span.word.bbox){
     const b=span.word.bbox,length=span.end-span.start;
     if(b.y1>b.y0)glyphHeights.push(b.y1-b.y0);
     bounds.push({...b,x0:b.x0+(b.x1-b.x0)*Math.max(0,match.start-span.start)/length,x1:b.x0+(b.x1-b.x0)*Math.min(length,match.end-span.start)/length});
    }
   }
   if(!bounds.length)continue;
   glyphHeights.sort((a,b)=>a-b);
   hits.push({code:match.code,review:match.review,glyphHeight:glyphHeights.length?glyphHeights[Math.floor(glyphHeights.length/2)]:Math.max(...bounds.map(b=>b.y1))-Math.min(...bounds.map(b=>b.y0)),confidence:Math.min(...selected.map(span=>span.word.confidence??0)),bbox:{x0:Math.min(...bounds.map(b=>b.x0)),y0:Math.min(...bounds.map(b=>b.y0)),x1:Math.max(...bounds.map(b=>b.x1)),y1:Math.max(...bounds.map(b=>b.y1))}});
  }
 }
 return hits;
}

// 같은 위치에서 읽힌 후보들을 비교한다. (머지 히츠)
// 다른 행은 유지하고 결과가 서로 다르면 확인 표시를 붙인다.
function mergeHits(groups){
 const clusters=[];
 for(const hits of groups)for(const hit of hits){
  const b=hit.bbox;
  const cluster=clusters.find(items=>items.some(existing=>{
   const a=existing.bbox;
   const overlap=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))*Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
   const smaller=Math.min((a.x1-a.x0)*(a.y1-a.y0),(b.x1-b.x0)*(b.y1-b.y0));
   return smaller>0&&overlap/smaller>=0.5;
  }));
  if(cluster)cluster.push(hit);else clusters.push([hit]);
 }
 return clusters.map(items=>{
  const choices=new Map();
  for(const hit of items){
   const previous=choices.get(hit.code);
   if(!previous)choices.set(hit.code,{...hit,votes:1});
   else{
    previous.votes++;previous.review=previous.review&&hit.review;
    if(hit.confidence>previous.confidence){previous.confidence=hit.confidence;previous.bbox=hit.bbox;previous.glyphHeight=hit.glyphHeight;}
   }
  }
  // 같은 보정 영상의 반복 오독이 신뢰도 높은 원본을 밀어내지 않게 한다.
  const ranked=[...choices.values()].sort((a,b)=>((b.confidence||0)+Math.min(b.votes-1,2)*3)-((a.confidence||0)+Math.min(a.votes-1,2)*3));
  const best=ranked[0];
  return {...best,alternatives:ranked.slice(1).map(item=>item.code),review:!!best.review||ranked.length>1||(best.confidence??100)<60};
 }).sort((a,b)=>a.bbox.y0-b.bbox.y0||a.bbox.x0-b.bbox.x0);
}

function createOcrRegions(width,height,stages,maxEdge=3200){
 const enabled=new Set(stages||['corrected']),regions=[];
 if(enabled.has('corrected'))regions.push({key:'corrected',name:'전체 보정',x:0,y:0,width,height,scale:1});
 const tw=Math.ceil(width*.5),th=Math.ceil(height*.65);
 for(let row=0;row<2;row++)for(let col=0;col<3;col++){
  const number=row*3+col+1,key='zoom'+number;
  if(!enabled.has(key))continue;
  // 확대 예산을 넘는 구역은 원래 픽셀을 유지한다.
  regions.push({key,name:'확대 '+number,x:Math.round((width-tw)*col/2),y:(height-th)*row,width:tw,height:th,scale:Math.max(1,Math.min(2,Math.min(2000,maxEdge)/Math.max(tw,th)))});
 }
 return regions;
}

