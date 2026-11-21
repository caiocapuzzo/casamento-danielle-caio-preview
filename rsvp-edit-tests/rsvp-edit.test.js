"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {randomBytes}=require("node:crypto");
const initial=require("../api/rsvp");
const edit=require("../api/rsvp-edit");
const canary="exclusively-private-memory";
const origin="https://daniecaio.vercel.app";
const headers={host:new URL(origin).host,origin,"content-type":"application/json","sec-fetch-site":"same-origin"};
const uuid="7644c519-2278-4c59-8a12-0be6e4369d55";
const uuid2="13c781c3-8804-4875-960d-5dbe590112c7";
const legacy={submissionId:uuid,guestName:"Nome fictício",attendance:"sim",companions:"0",diet:canary,message:canary};
const token=()=>randomBytes(32).toString("base64url");
async function call(fn,body,options={}) {
  const res={code:null,headers:{},payload:null,
    setHeader(k,v){this.headers[k.toLowerCase()]=v;},
    status(c){this.code=c;return this;},
    json(p){this.payload=p;return this;}
  };
  await fn({method:"POST",headers,body,url:fn===edit?"/api/rsvp-edit":"/api/rsvp",...options},res);
  return [res.code,res.payload,res.headers];
}
function synthetic(t) {
  const initialEnv={...process.env};
  process.env.VERCEL_ENV="production";
  process.env.UPSTASH_REDIS_REST_TOKEN="fictional";
  process.env.UPSTASH_REDIS_REST_URL="https://rsvp-synthetic.example.invalid";
  const fetch0=globalThis.fetch;
  const stores=new Map(), indexes=new Map(), state={calls:[],throttle:false};
  t.after(()=>{
    globalThis.fetch=fetch0;
    for(const k of ["VERCEL_ENV","UPSTASH_REDIS_REST_TOKEN","UPSTASH_REDIS_REST_URL"]) {
      if(Object.hasOwn(initialEnv,k))process.env[k]=initialEnv[k];else delete process.env[k];
    }
  });
  function map(root,k){if(!root.has(k))root.set(k,new Map());return root.get(k);}
  state.stores=stores;state.indexes=indexes;
  globalThis.fetch=async(url,req)=>{
    assert.equal(url,"https://rsvp-synthetic.example.invalid/");
    const a=JSON.parse(req.body);
    state.calls.push(a);
    assert.equal(a[0],"EVAL");
    const [cmd,script,num,...args]=a;
    if (script.includes("return 'duplicate'")) {
      assert.equal(num,3);const [key,rate,idx,id,fp,raw,max,window,cap,ttl,digest]=args;
      const records=map(stores,key);
      const existing=records.get(id);
      const index=map(indexes,idx);
      const result=existing?(existing.fingerprint===fp&&(existing.editHash||"")===digest?"duplicate":"conflict"):
        digest&&index.has(digest)?"conflict":"saved";
      if(result==="saved"){
        records.set(id,JSON.parse(raw));
        if(digest)index.set(digest,id);
      }
      if (key.includes("{preview}")) assert.equal(ttl,"3600");
      return Response.json({result});
    }
    assert.match(script,/rsvp_edit_lookup_update/);
    assert.ok(script.indexOf("if network > 60 then return {'limited'} end") > 0);
    assert.ok(script.indexOf("if network > 60 then return {'limited'} end") < script.indexOf("local all = redis.call('INCR',KEYS[4])"));
    assert.equal(num,4);
    const [key,idx,network,global,digest,action,now,version,attendance,companions,name,savedAt,window]=args;
    assert.equal(key,"dc:rsvp:v1:{responses}:records");
    if(state.throttle)return Response.json({result:["limited"]});
    const id=map(indexes,idx).get(digest);
    const row=map(stores,key).get(id);
    if(!row || row.editHash!==digest || row.editExpiresAt < Number(now)) return Response.json({result:["missing"]});
    const out=code=>Response.json({result:[code,row.version,row.attendance,row.companions,row.companionName||""]});
    if(action==="load")return out("ok");
    const prior=Number(version), wanted=Number(companions);
    const same=row.attendance===attendance&&row.companions===wanted&&(row.companionName||"")===name;
    if(prior!==row.version)return out(row.version===prior+1&&same?"ok":"conflict");
    if(same)return out("ok");
    row.attendance=attendance;row.companions=wanted;row.version++;row.savedAt=savedAt;
    row.headcount=attendance==="sim"?1+wanted:0;
    if(wanted)row.companionName=name;else delete row.companionName;
    return out("ok");
  };
  return state;
}
const recordKey="dc:rsvp:v1:{responses}:records";
test("legacy stays exact, preview namespace remains isolated, existing row cannot be claimed",async t=>{
  const s=synthetic(t);
  assert.deepEqual((await call(initial,legacy)).slice(0,2),[200,{ok:true}]);
  assert.deepEqual((await call(initial,legacy)).slice(0,2),[200,{ok:true}]);
  const editToken=token();
  assert.equal((await call(initial,{...legacy,editToken}))[0],409);
  assert.equal((await call(edit,{action:"load",editToken}))[0],404);
  process.env.VERCEL_ENV="preview";
  assert.equal((await call(initial,legacy))[0],200);
  assert.equal((await call(initial,{...legacy,submissionId:uuid2,editToken}))[0],403);
  assert.equal((await call(edit,{action:"load",editToken}))[0],403);
  assert.ok(s.stores.has("dc:rsvp:preview:v1:{preview}:records"));
  assert.equal(s.stores.get(recordKey).size,1);
});
test("new capability is bound atomically; original fingerprint stays valid after editing",async t=>{
  const s=synthetic(t);
  const editToken=token(), original={...legacy,editToken};
  assert.deepEqual((await call(initial,original)).slice(0,2),[200,{ok:true,editable:true}]);
  assert.equal((await call(initial,{...original,submissionId:uuid2}))[0],409);
  assert.equal((await call(initial,{...original,editToken:token()}))[0],409);
  assert.ok(!JSON.stringify(s.calls).includes(editToken));
  const init=await call(edit,{action:"load",editToken});
  assert.deepEqual(init.slice(0,2),[200,{ok:true,version:1,response:{attendance:"sim",companions:0,companionName:""}}]);
  assert.match(init[2]["cache-control"],/no-store/);
  assert.ok(!JSON.stringify(init).includes(canary));
  const payload={action:"update",editToken,version:1,attendance:"sim",companions:1,companionName:" Nome   Convidado "};
  const success=await call(edit,payload);
  assert.deepEqual(success.slice(0,2),[200,{ok:true,version:2,response:{attendance:"sim",companions:1,companionName:"Nome Convidado"}}]);
  assert.deepEqual((await call(edit,payload)).slice(0,2),success.slice(0,2));
  assert.deepEqual((await call(initial,original)).slice(0,2),[200,{ok:true,editable:true}]);
  assert.equal((await call(edit,{...payload,companionName:"Outro Convidado"}))[0],409);
  const row=s.stores.get(recordKey).get(uuid);
  assert.equal(row.headcount,2);assert.equal(row.diet,canary);assert.equal(row.message,canary);
  assert.equal(s.stores.get(recordKey).size,1);
  assert.doesNotMatch(JSON.stringify({row}),new RegExp(editToken));
  assert.equal((await call(edit,{action:"update",editToken,version:2,attendance:"nao",companions:0}))[0],200);
  assert.equal(row.headcount,0);assert.equal(row.companionName,undefined);
  // Private fields survive a decline without being returned to the link bearer.
  assert.equal(row.diet,canary);assert.equal(row.message,canary);
});
test("origin, method, body, stale edits, expiry and missing rows fail safely",async t=>{
  const s=synthetic(t);
  const editToken=token(), wrong=token();
  const load={action:"load",editToken};
  assert.equal((await call(edit,load,{method:"GET"}))[0],405);
  assert.equal((await call(edit,load,{headers:{...headers,origin:"https://other.example.invalid"}}))[0],403);
  assert.equal((await call(edit,load,{url:"/api/rsvp-edit?x=1"}))[0],400);
  assert.equal((await call(edit,{action:"load",editToken:"A".repeat(42)+"_" }))[0],400);
  assert.equal((await call(edit,load,{headers:{...headers,"content-length":"3000"}}))[0],413);
  assert.equal(s.calls.length,0);
  await call(initial,{...legacy,editToken});
  assert.equal((await call(edit,{action:"load",editToken:wrong}))[0],404);
  assert.equal((await call(edit,{action:"update",editToken,version:1,attendance:"sim",companions:1}))[0],400);
  const editFromV1={action:"update",editToken,version:1,attendance:"sim",companions:1};
  const results=await Promise.all([call(edit,{...editFromV1,companionName:"Companion A"}),call(edit,{...editFromV1,companionName:"Companion B"})]);
  assert.deepEqual(results.map(r=>r[0]).sort(),[200,409]);
  s.throttle=true;assert.equal((await call(edit,load))[0],429);s.throttle=false;
  s.stores.get(recordKey).get(uuid).editExpiresAt=0;
  assert.equal((await call(edit,load))[0],404);
  s.stores.get(recordKey).delete(uuid);
  assert.equal((await call(edit,load))[0],404);
});
