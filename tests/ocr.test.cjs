const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const app={};vm.createContext(app);
for(const file of ['image.js','ocr.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),app);
const plain=value=>JSON.parse(JSON.stringify(value));
const codes=text=>plain(app.findCodes(text)).map(hit=>hit.code);
assert.deepEqual(codes('2401-004279 2401-004935'),['2401-004279','2401-004935']);
assert.deepEqual(codes('2026-07-23 B076-0203 SVM-07SS15T'),[]);
assert.deepEqual(codes('B076-0201 CA B076-0203 12'),[]);
assert.deepEqual(codes('2402-001 368✓ 2401 ~003395V 2401-003743V/'),['2402-001368','2401-003395','2401-003743']);
assert.equal(app.findCodes('2401-003743V')[0].review,true);
assert.deepEqual(codes('YR07-00001A'),['YR07-00001A']);
assert.deepEqual(codes('2401-0037439 AB12-ABCDEFQ X2401-003743'),[]);
assert.deepEqual(codes('2401-00374V'),['2401-00374V']); // 정상 6자리의 마지막 V는 보존한다.
const word={text:'2401-003743V',confidence:70,bbox:{x0:10,y0:20,x1:130,y1:40},symbols:[]};
word.symbols=[...word.text].map((text,i)=>({text,bbox:{x0:10+i*10,y0:20,x1:20+i*10,y1:40}}));
const hit=app.collectHits({blocks:[{paragraphs:[{lines:[{words:[word]}]}]}]})[0];
assert.equal(hit.code,'2401-003743');assert.equal(hit.bbox.x1,120); // 체크 V는 박스에서 제외한다.
const mapped=app.mapScanHits([hit],{x:200,y:300},2,4)[0];
assert.deepEqual(plain(mapped.bbox),{x0:205,y0:305,x1:260,y1:310});
const second={...hit,bbox:{...hit.bbox,y0:80,y1:100}};
const merged=app.mergeHits([[hit,second],[{...hit,review:false,confidence:90}],[{...hit,code:'2401-003748',confidence:40}]]);
assert.equal(merged.length,2);assert.equal(merged[0].code,'2401-003743');
assert.equal(merged[0].review,true);assert.deepEqual(plain(merged[0].alternatives),['2401-003748']);
assert.equal(merged[1].code,'2401-003743'); // 다른 행의 같은 코드는 합치지 않는다.
const conflict=app.mergeHits([[{...hit,code:'YR07-00001A',confidence:61}],[{...hit,code:'YRO7-000014',confidence:33}],[{...hit,code:'YRO7-000014',confidence:52}]]);
assert.equal(conflict[0].code,'YR07-00001A');assert.equal(conflict[0].review,true);
const passes=app.createScanPasses(1152,1536,{deep:true,mode:'print'});
assert.equal(passes.length,8);
for(const p of passes){assert.ok(p.x>=0&&p.y>=0);assert.ok(p.x+p.width<=1152&&p.y+p.height<=1536);}
const image={width:100,height:100,data:new Uint8ClampedArray(40000).fill(255)};
for(let y=40;y<60;y++)for(let x=40;x<60;x++)for(let c=0;c<3;c++)image.data[(y*100+x)*4+c]=20;
app.printFilter(image,16,true);assert.equal(image.data[(50*100+50)*4],0);assert.equal(image.data[0],255);
console.log('OCR regression checks passed: parsing, check marks, coordinates, candidate merge, tiles, print filter.');
