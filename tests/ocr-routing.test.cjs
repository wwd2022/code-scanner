const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const vm=require('node:vm');
const calls=[];
const canvas=()=>({width:1,height:1,getContext:()=>({drawImage:()=>{}})});
const app={document:{createElement:canvas},activeTab:'test',originalFrame:{width:1200,height:1000},scanEpoch:7,
 commitOptimizedTestResult:(...args)=>calls.push(args),
 showScanFrame:()=>{},appendScanRaw:()=>{},showScanResults:()=>{throw new Error('Test must never enter production history');}};
vm.createContext(app);vm.runInContext(readFileSync(join(__dirname,'..','ocr.js'),'utf8'),app);
const result={hits:[{code:'1000-000001'}],text:'synthetic',stats:[]},input=canvas();
assert.equal(typeof app.commitOptimizedScan,'function');
app.commitOptimizedScan(result,input,250);
assert.equal(calls.length,1);assert.equal(calls[0][0],result);assert.equal(calls[0][1],input);
assert.deepEqual(JSON.parse(JSON.stringify(calls[0][2])),{x:0,y:0,width:1200,height:1000});assert.equal(calls[0][3],250);
// Production keeps the normal frame/review/history path.
app.activeTab='photo';app.frame=canvas();app.previewCorrection={checked:true};
app.showScanResults=(hits,area,stats,seconds,errors)=>{assert.equal(hits,result.hits);assert.equal(area,null);assert.equal(seconds,'0.25');assert.equal(errors,0);};
app.commitOptimizedScan(result,input,250);assert.equal(calls.length,1);
console.log('Optimizer result destination checks passed.');
