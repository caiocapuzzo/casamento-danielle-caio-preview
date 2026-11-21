"use strict";
const { test }=require("node:test");
const assert=require("node:assert/strict");
const { readFileSync }=require("node:fs");
const { scryptSync }=require("node:crypto");
const endpoint=require("../api/painel-presencas");
const origin="https://daniecaio.vercel.app";
const ip="192.0.2.12";
const browserKey="A".repeat(43);
const temp="synthetic-Pr-Hn9_x67U_T8";
const next="correct-H9k_32-drift!f7";
const encode=(pass,salt)=>"scrypt-v1$"+salt+"$"+scryptSync(pass,Buffer.from(salt,"hex"),32,{N:32768,r:8,p:3,maxmem:67108864}).toString("hex");
const uuid=n=>String(n).padStart(8,"0")+"-1010-4010-8010-101010101010";
const rows=[
  uuid(1),JSON.stringify({guestName:"João de Teste",attendance:"sim",companions:1,companionName:"Pessoa Companheira",receivedAt:"2026-11-21T16:10:00Z",diet:"PRIVATE_1",message:"PRIVATE_2"}),
  uuid(2),JSON.stringify({guestName:"Joao de Teste",attendance:"nao",companions:0,receivedAt:"2026-11-21T16:20:00Z"}),
  uuid(3),JSON.stringify({guestName:"=@MALICIOUS",attendance:"sim",companions:0,receivedAt:"2026-11-21T16:30:00Z"}),
  uuid(4),"bad"
];
function setup(){
  process.env.VERCEL_ENV="production";process.env.RSVP_ADMIN_ORIGIN=origin;process.env.RSVP_ADMIN_ENABLED="true";
  process.env.UPSTASH_REDIS_REST_URL="https://redis.invalid";process.env.UPSTASH_REDIS_REST_TOKEN="FAKE_FIXTURE";
  process.env.RSVP_ADMIN_BOOTSTRAP_HASH=encode(temp,"2a".repeat(16));
  process.env.RSVP_ADMIN_BOOTSTRAP_EXPIRES=new Date(Date.now()+1800000).toISOString().replace(/\.\d{3}Z$/,"Z");
  const s=new Map(), hashes=new Map(), operations=[];
  global.fetch=async(url,options)=>{
    assert.equal(url,"https://redis.invalid/");
    const [op,...a]=JSON.parse(options.body);
    operations.push(op);
    let value;
    if(op==="GET")value=s.get(a[0])??null;
    if(op==="HGET")value=hashes.get(a[0]+":"+a[1])??null;
    if(op==="SET"){if(s.has(a[0])){value=null;}else{s.set(a[0],a[1]);value="OK";}}
    if(op==="HSCAN"){
      assert.equal(a[0],"dc:rsvp:v1:{responses}:records");
      value=a[1]==="0"?["51",rows.slice(0,4)]:["0",rows.slice(4)];
    }
    if(op==="EVAL"){
      const [script,n,...params]=a,args=params.slice(n),k=params.slice(0,n);
      if(script.startsWith("-- rsvp_admin_read_credential")){
        operations.push("read-credential-primary");
        value=hashes.get(k[0]+":credential")??null;
      } else if(script.startsWith("-- rsvp_admin_role")){
        operations.push("read-session-primary");
        value=s.get(k[0])===args[0]?"active":s.get(k[1])===args[1]?"change":"signed-out";
      } else if(script.startsWith("-- rsvp_admin_limit")){
        const count=(s.get(k[0])??0)+1;
        const all=(s.get(k[1])??0)+1;
        s.set(k[0],count);s.set(k[1],all);value=+(count<=12&&all<=80);
      } else if(script.startsWith("-- rsvp_admin_claim")){
        if(hashes.has(k[0]+":credential")||s.has(k[1]))value=0;
        else{s.set(k[1],args[0]);value=1;}
      } else if(script.startsWith("-- rsvp_admin_change")){
        if(hashes.has(k[0]+":credential")||s.get(k[1])!==args[0])value=0;
        else{hashes.set(k[0]+":credential",args[1]);s.delete(k[1]);s.set(k[2],args[3]);value=1;}
      } else if(script.startsWith("-- rsvp_admin_logout")){
        if(s.get(k[0])===args[1])s.delete(k[0]);if(s.get(k[1])===args[0])s.delete(k[1]);value=1;
      }
    }
    assert.notEqual(value,undefined);
    return {ok:true,json:async()=>({result:value})};
  };
  return {operations,s,hashes};
}
async function req(path="",data=null,cookie="",override={}) {
  const out={headers:{},setHeader(n,v){this.headers[n]=v;},status(c){this.code=c;return this;},
    json(v){this.body=v;return this;},send(v){this.body=v;return this;}};
  const headers={host:"daniecaio.vercel.app","content-type":"application/json","origin":origin,"sec-fetch-site":"same-origin",
    "x-vercel-forwarded-for":ip,"x-rsvp-panel-key":browserKey,...(cookie?{cookie}:{}),...override};
  await endpoint({method:data?"POST":"GET",url:"/api/painel-presencas"+path,body:data,headers},out);
  return out;
}
const getCookie=r=>r.headers["Set-Cookie"]?.split(";")[0];
test("production auth, private bounded scan, HTML/CSV safety, revocation",async()=>{
  const f=setup();
  assert.equal((await req("?view=responses")).code,401);
  assert.equal((await req("?view=csv")).code,401);
  assert.deepEqual(f.operations,[]);
  const bad=await req("",{action:"login",username:"caio",password:temp},"",{origin:"https://other.invalid"});
  assert.equal(bad.code,403);assert.deepEqual(f.operations,[]);
  const one=await req("",{action:"login",username:"caio",password:temp});
  assert.equal(one.body.state,"change");
  assert.match(one.headers["Set-Cookie"],/^__Host-wedding-panel=.*; Path=\/; Max-Age=600; Secure; HttpOnly; SameSite=Strict$/);
  const pending=getCookie(one);
  assert.equal((await req("?view=responses",null,pending)).code,401);
  assert.equal((await req("?view=csv",null,pending)).code,401);
  assert.equal(f.operations.includes("HSCAN"),false);
  assert.equal((await req("",{action:"login",username:"caio",password:temp})).code,409);
  assert.equal((await req("",{action:"change",newPassword:"short"},pending)).code,400);
  assert.equal((await req("",{action:"change",newPassword:temp},pending)).code,400);
  const races=await Promise.all([req("",{action:"change",newPassword:next},pending),req("",{action:"change",newPassword:next},pending)]);
  assert.equal(races.filter(r=>r.body.state==="active").length,1);
  const active=getCookie(races.find(r=>r.body.state==="active"));
  assert.notEqual(active,pending);
  assert.equal((await req("",{action:"login",username:"caio",password:temp})).code,401);
  assert.equal((await req("?view=responses",null,pending)).code,401);
  assert.match([...f.hashes.values()][0],/^scrypt-v1\$/);
  assert.ok(![...f.s.keys()].some(k=>k.includes(active.split("=")[1])));
  delete process.env.RSVP_ADMIN_BOOTSTRAP_HASH;delete process.env.RSVP_ADMIN_BOOTSTRAP_EXPIRES;
  assert.equal((await req("",{action:"login",username:"caio",password:next})).body.state,"active");
  const before=f.operations.length;
  assert.equal((await req("?view=responses",null,active,{"x-rsvp-panel-key":""})).code,401);
  assert.equal((await req("?view=csv",null,active,{"x-rsvp-panel-key":"B".repeat(43)})).code,401);
  assert.ok(!f.operations.slice(before).includes("HSCAN"));
  const records=await req("?view=responses",null,active);
  assert.equal(records.code,200);
  assert.equal(records.headers["Cache-Control"],"private, no-store, max-age=0");
  assert.deepEqual(records.body.counts,{confirmed:2,declined:1,people:3,review:2,ignored:1});
  assert.equal(records.body.rows.find(r=>r.companions).companionName,"Pessoa Companheira");
  assert.ok(!JSON.stringify(records.body).includes("PRIVATE_"));
  assert.equal(f.operations.filter(x=>x==="HSCAN").length,2);
  const csv=await req("?view=csv",null,active);
  assert.equal(csv.code,200);
  assert.match(csv.body,/^\ufeff"Nome";"Resposta";/u);
  assert.ok(csv.body.includes('"\'=@MALICIOUS"'));
  assert.equal(csv.headers["Content-Disposition"],'attachment; filename="presencas-casamento.csv"');
  assert.ok(!csv.body.includes("PRIVATE_"));
  assert.equal((await req("",{action:"logout"},active)).code,200);
  assert.equal((await req("?view=responses",null,active)).code,401);
});
test("preview, missing canonical origin, and expired bootstrap fail closed",async()=>{
  const f=setup();
  process.env.RSVP_ADMIN_ENABLED="false";
  assert.equal((await req("?view=responses")).code,404);
  process.env.RSVP_ADMIN_ENABLED="true";
  process.env.VERCEL_ENV="preview";
  assert.equal((await req("",{action:"login",username:"caio",password:temp})).code,404);
  assert.deepEqual(f.operations,[]);
  process.env.VERCEL_ENV="production";
  assert.equal((await req("",{action:"login",username:"caio",password:temp},"",{host:"preview.invalid"})).code,404);
  assert.deepEqual(f.operations,[]);
  process.env.RSVP_ADMIN_BOOTSTRAP_EXPIRES="2000-01-01T00:00:00Z";
  assert.equal((await req("",{action:"login",username:"caio",password:temp})).code,401);
  assert.ok(!f.operations.includes("HSCAN"));
});
test("persistent per-network limiter and secure HTML assets",async()=>{
  const f=setup();
  for(let i=0;i<12;i++) assert.equal((await req("",{action:"login",username:"caio",password:"wrong"})).code,401);
  const capped=await req("",{action:"login",username:"caio",password:temp});
  assert.equal(capped.code,429);
  assert.equal(capped.headers["Retry-After"],"300");
  assert.equal(f.operations.filter(x=>x==="read-credential-primary").length,12);
  assert.ok(!f.operations.includes("HGET"));
  const page=readFileSync("painel-presencas.html","utf8"), frontend=readFileSync("admin-assets/presencas.js","utf8");
  const config=JSON.parse(readFileSync("vercel.json","utf8"));
  assert.match(page,/name="robots" content="noindex/);
  assert.equal((page.match(/<form [^>]*method="post"/g)||[]).length,2);
  assert.doesNotMatch(frontend,/innerHTML|localStorage|sessionStorage/);
  assert.match(frontend,/\.textContent\s*=/);
  assert.equal(config.headers[0].source,"/painel-presencas.html");
});

test("frontend active session can retry after transient response failure",async()=>{
  const { runInNewContext }=require("node:vm");
  const { webcrypto }=require("node:crypto");
  const nodes=new Map(), requests=[];
  const el=id=>{
    if(!nodes.has(id))nodes.set(id,{hidden:true,value:"",textContent:"",events:{},addEventListener(n,fn){this.events[n]=fn;},
      replaceChildren(){},append(){},focus(){},reset(){},querySelector(){return el("submit");}});
    return nodes.get(id);
  };
  const script=readFileSync("admin-assets/presencas.js","utf8");
  let authenticated=false, responses=0;
  const result=(status,body)=>({status,ok:status===200,json:async()=>body});
  runInNewContext(script,{
    document:{getElementById:el,createDocumentFragment:()=>el("fragment"),createElement:()=>el("tag")},
    window:{addEventListener(){}},crypto:webcrypto,btoa,
    fetch:async(path,options)=>{
      requests.push(path);
      if(path.endsWith("?view=session"))return result(200,{state:authenticated?"active":"signed-out"});
      if(options.method==="POST"){
        authenticated=true;
        assert.match(options.headers["X-RSVP-Panel-Key"],/^[A-Za-z0-9_-]{43}$/);
        return result(200,{state:"active"});
      }
      assert.match(options.headers["X-RSVP-Panel-Key"],/^[A-Za-z0-9_-]{43}$/);
      responses++;
      return responses===1?result(503,{error:"indisponivel"}):
        result(200,{rows:[],counts:{confirmed:0,declined:0,people:0,review:0,ignored:0}});
    }
  });
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(el("login").hidden,false);
  el("username").value="caio";el("password").value="synthetic";
  await el("loginForm").events.submit({preventDefault(){},currentTarget:el("loginForm")});
  assert.equal(el("retry").hidden,false);
  assert.equal(el("logout").hidden,false);
  assert.match(el("notice").textContent,/Você entrou.*não carregaram/);
  el("retry").events.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(el("presencas").hidden,false);
  assert.equal(el("retry").hidden,true);
  assert.equal(requests.filter(x=>x.endsWith("?view=responses")).length,2);
});
