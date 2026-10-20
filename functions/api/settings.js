// 최신 사용자 설정을 GitHub의 단일 JSON 파일로 저장한다. (온 리퀘스트 포스트)
// Cloudflare Access로 보호된 API에서만 사용하며 서버 비밀 토큰을 브라우저에 노출하지 않는다.
export async function onRequestPost({request,env}){
 if(!env.GITHUB_TOKEN)return new Response('GITHUB_TOKEN missing',{status:503});
 if(!request.headers.get('Cf-Access-Jwt-Assertion'))return new Response('Cloudflare Access required',{status:403});
 let data;
 try{data=await request.json();}catch{return new Response('Invalid JSON',{status:400});}
 const keys=['strength','filterMode','brightness','threshold','removeLines','deepScan','boxOpacity','locationDirection'];
 if(!data||typeof data!=='object'||keys.some(key=>!(key in data)))return new Response('Invalid settings',{status:400});
 const settings=Object.fromEntries(keys.map(key=>[key,data[key]]));
 settings.savedAt=new Date().toISOString();
 const path='settings/current.json';
 const url='https://api.github.com/repos/wwd2022/code-scanner/contents/'+path;
 const headers={Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:'application/vnd.github+json','User-Agent':'code-scanner-settings','X-GitHub-Api-Version':'2022-11-28'};
 const existing=await fetch(url+'?ref=test',{headers});
 if(!existing.ok&&existing.status!==404)return new Response('GitHub read failed',{status:502});
 const previous=existing.ok?await existing.json():null;
 const encoded=btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(settings,null,2))));
 const payload={message:'Update current scanner settings',branch:'test',content:encoded};
 if(previous?.sha)payload.sha=previous.sha;
 const result=await fetch(url,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(payload)});
 return new Response(result.ok?'Saved':'GitHub save failed',{status:result.ok?200:502});
}
