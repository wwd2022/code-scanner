const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function load(context,file,name){
 const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
 const start=source.indexOf('function '+name+'(');assert.notEqual(start,-1,'missing '+name);
 const end=source.indexOf('\n}',start)+2;
 vm.runInContext(source.slice(start,end),context);
}
function context(values){return vm.createContext(values);}
test('generic test results cannot enter operational history',()=>{
 let added=0,refreshed=0;const h=context({activeTab:'test',showTestComparison(){},addRecord(){added++;},refreshRecords(){refreshed++;},showBoxes(){},scanStats:{},status:{},liveStatus:{}});
 load(h,'app.js','showScanResults');h.showScanResults([{code:'1234-123456'}],null,[],1,0);assert.equal(added,0);assert.equal(refreshed,0);
 h.activeTab='photo';h.showScanResults([{code:'1234-123456'}],null,[],1,0);assert.equal(added,1);assert.equal(refreshed,1);
});
test('pending operational reviews require explicit discard consent',()=>{
 let confirms=0;const h=context({activeTab:'photo',detectedHits:[{review:true}],cropReviewAvailable:()=>true,confirm(){confirms++;return false;}});
 load(h,'records.js','confirmDiscardReview');assert.equal(h.confirmDiscardReview(),false);assert.equal(confirms,1);
 h.activeTab='test';assert.equal(h.confirmDiscardReview(),true);assert.equal(confirms,1);
 h.activeTab='photo';h.detectedHits=[];assert.equal(h.confirmDiscardReview(),true);
});
test('cancelled mode switch preserves current result and source',()=>{
 const h=context({busy:false,starting:false,activeTab:'photo',confirmDiscardReview:()=>false});load(h,'app.js','switchTab');h.switchTab('camera');assert.equal(h.activeTab,'photo');
});
test('optimized test commits own a copied input and visible corrected view',()=>{
 const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,{hidden:false,value:'',textContent:'',replaceChildren(){}});return elements.get(id);};
 let activated=null,drawn=null,rows=null;const stale={width:300,height:200};let copied=null;
 const view={id:'corrected',boxes:{replaceChildren(){}},input:stale,hits:[],zoom:3,cx:.1,cy:.2};
 const h=context({activeTab:'test',activeTestResultView:null,testPreviewVersion:0,testPreviewTimer:0,clearTimeout(){},testCompareMode:'original',testViews:[{id:'original'},view],testExpectedCodes:['1234-123456'],testCorrectedPreview:null,
  document:{getElementById:el,createElement:()=>({width:0,height:0,getContext:()=>({drawImage:input=>{copied=input;}})})},
  setTestCompareMode(mode){h.testCompareMode=mode;},activateTestResultView(v){activated=v;},renderRecordRows(target,hits){rows=hits;},drawTestView(v){drawn=v;},status:{}});
 load(h,'test-compare.js','clearTestView');load(h,'test-compare.js','commitOptimizedTestResult');const input={width:640,height:480};const area={x:0,y:0,width:1200,height:1000};const result={hits:[{code:'1234-123456'}],resolution:'640 × 480',errors:[]};
 h.commitOptimizedTestResult(result,input,area,1234);
 assert.equal(copied,input);assert.notEqual(view.input,input);assert.equal(view.input.width,640);assert.equal(stale.width,1);assert.deepEqual(JSON.parse(JSON.stringify(view.inputArea)),area);assert.equal(view.hits,result.hits);assert.equal(rows,result.hits);assert.equal(activated,view);assert.equal(drawn,view);assert.equal(h.testCompareMode,'corrected');assert.equal(view.zoom,1);assert.ok(el('compare-summary-corrected').value.includes('최적화'));
});

test('accepted source discard immediately refreshes history availability',()=>{
 let renders=0;const h=context({activeTab:'photo',detectedHits:[{review:true}],reviewSource:{width:640,height:480},reviewSourceArea:{x:0},reviewSourceEpoch:1,reviewSuggestions:new Map(),codeReview:{open:false},document:{getElementById:()=>({hidden:false})},cropReviewAvailable(){return !!h.reviewSourceArea;},confirm:()=>true,refreshRecords(){renders++;}});
 load(h,'records.js','confirmDiscardReview');load(h,'records.js','resetReviewSession');load(h,'ocr.js','clearReviewSource');
 assert.equal(h.confirmDiscardReview(),true);h.clearReviewSource();assert.equal(renders,1);assert.equal(h.reviewSourceArea,null);assert.equal(h.reviewSource.width,1);
});

test('history explicitly labels missing review image instead of suggesting available correction',()=>{
 const rows=[];const records={replaceChildren(){rows.length=0;},append(row){rows.push(row);}};
 const hit={code:'1234-123456',review:true};const h=context({records,detectedHits:[hit],locations:new Map(),cropReviewAvailable:()=>false,document:{createElement:()=>({classList:{add(){}},textContent:''})}});
 load(h,'records.js','renderRecordRows');h.renderRecordRows(records,[hit]);assert.ok(rows[0].textContent.includes('원본 재촬영 필요'));
 h.cropReviewAvailable=()=>true;h.renderRecordRows(records,[hit]);assert.ok(rows[0].textContent.includes('확인 필요'));assert.equal(rows[0].textContent.includes('재촬영'),false);
});

test('test lookup locations do not relabel operational history',()=>{
 let lookup;const elements={empty:{},count:{}};const operational=new Map([['1234-123456',['real']]]);
 const h=context({activeTab:'test',workbook:null,locations:new Map([['1234-123456',['synthetic']]]),recordedHits:new Set(),records:{},document:{getElementById:id=>elements[id]},renderRecordRows(target,hits,map){lookup=map;return 0;},buildLocations:()=>operational});
 load(h,'records.js','refreshRecords');h.refreshRecords();assert.equal(lookup.size,0);
 h.workbook={sheets:{sheet:[]},selected:'sheet'};h.refreshRecords();assert.equal(lookup,operational);
 h.activeTab='photo';h.refreshRecords();assert.equal(lookup,h.locations);
});
