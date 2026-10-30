const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'..','photo.js'),'utf8');
function harness(values={}){
 const defaults={testNoise:0,testScene:'plain',testInk:'normal',testWidthCm:12,testHeightCm:10,testPpi:254,testLeft:80,testRight:80,testTop:100,testBottom:100,testGapX:0,testGapY:0,testFont:32,testText:'none',testTable:'off',...values};
 const elements=new Map(Object.entries(defaults).map(([id,value])=>[id,{value:String(value)}]));
 let allocations=0,confirmations=0;
 const context={busy:false,starting:false,workbook:null,status:{textContent:''},Math:Object.create(Math),confirm:()=>{confirmations++;return false;},document:{getElementById:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);},createElement:()=>{allocations++;return {getContext:()=>({font:'',measureText:()=>({width:210})})};}}};
 vm.createContext(context);vm.runInContext(source,context);
 return {context,get allocations(){return allocations;},get confirmations(){return confirmations;}};
}
test('invalid and oversized images are rejected before grid allocation, rows or confirmation',()=>{
 for(const values of [{testWidthCm:1e12},{testWidthCm:'Infinity'},{testHeightCm:0},{testPpi:0},{testPpi:1e9},{testWidthCm:40,testHeightCm:40}]){
  const h=harness(values);let rows=0;h.context.getTestRows=()=>{rows++;return [];};h.context.makeTestImage();
  assert.equal(rows,0);assert.equal(h.confirmations,0);assert.equal(h.allocations,0);assert.ok(h.context.status.textContent);
 }
});
test('too many grid cells rejected before row generation or confirmation',()=>{
 const h=harness();let rows=0;h.context.getTestGrid=()=>({cols:101,rows:10});h.context.getTestRows=()=>{rows++;return [];};h.context.makeTestImage();assert.equal(rows,0);assert.equal(h.confirmations,0);assert.match(h.context.status.textContent,/1000/);
});
test('normal dimensions and exact edge/pixel boundaries can reach confirmation without generating rows',()=>{
 for(const values of [{},{testWidthCm:40.96,testHeightCm:10},{testWidthCm:40,testHeightCm:20}]){
  const h=harness(values);let rows=0;h.context.getTestRows=()=>{rows++;return [];};h.context.makeTestImage();assert.equal(h.confirmations,1);assert.equal(rows,0);
 }
});
test('nonfinite layout inputs are rejected before grid allocation',()=>{
 const h=harness({testLeft:'Infinity'});h.context.makeTestImage();assert.equal(h.allocations,0);assert.equal(h.confirmations,0);
});
test('row count is bounded and constant random output cannot loop indefinitely',()=>{
 const h=harness();h.context.Math.random=()=>0;
 for(const count of [-1,1001,Infinity,1.5])assert.throws(()=>h.context.getTestRows(count),/1000/);
 const rows=vm.runInContext('getTestRows(1000)',h.context,{timeout:1000});assert.equal(rows.length,1000);assert.equal(new Set(rows.map(row=>row[0])).size,1000);assert.ok(rows.every(row=>/^\d{4}-\d{6}$/.test(row[0])));
});
test('existing duplicate generated rows are deduplicated',()=>{
 const h=harness();h.context.Math.random=()=>0;const rows=vm.runInContext("getTestRows(3,[['1000-000000',['T1']],['1000-000000',['T1']]])",h.context,{timeout:1000});assert.equal(rows.length,3);assert.equal(new Set(rows.map(row=>row[0])).size,3);
});

test('accepted normal image renders and commits generated rows',()=>{
 const h=harness();let allocations=0;
 h.context.confirm=()=>true;
 h.context.getTestGrid=()=>({cols:2,rows:2,cellW:100,cellH:40,pad:1});
 const ctx={getImageData:()=>({}),fillRect(){},fillText(){}};
 Object.assign(h.context,{photoSource:{getContext:()=>{allocations++;return ctx;}},testExpectedCodes:[],excelStatus:{},photoReady:false,previewPhoto(){},setPhotoZoom(){},imageViewport:{}});
 assert.equal(h.context.makeTestImage(),true);assert.equal(allocations,1);assert.equal(h.context.testExpectedCodes.length,4);assert.equal(h.context.photoSource.width,1200);assert.equal(h.context.photoSource.height,1000);assert.match(h.context.status.textContent,/4개 생성/);
});
test('loading another photo respects pending-review cancellation before decoding',async()=>{
 const h=harness();let allocations=0;
 h.context.confirmDiscardReview=()=>false;
 h.context.photoInput={files:[{name:'next.png'}],value:'next.png'};
 h.context.URL={createObjectURL(){allocations++;}};
 await h.context.loadPhoto();assert.equal(allocations,0);assert.equal(h.context.photoInput.value,'');assert.equal(h.context.busy,false);
});
