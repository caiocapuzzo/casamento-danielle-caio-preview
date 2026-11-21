"use strict";
const { test }=require("node:test");
const assert=require("node:assert/strict");
const { readFileSync }=require("node:fs");
const { runInNewContext }=require("node:vm");
const { webcrypto }=require("node:crypto");
const Module=require("node:module");
const endpoint=require("../api/painel-presencas");
const since="2027-01-01T13:00:00.000Z";
const at="2027-01-02T16:20:00.000Z";
const realFixture={state:"ready",since,captureActive:true,orders:[{id:"fixture-only",confirmedAt:at,amountCents:24590,totalPaid:99999,
  buyer:"MUST_NOT_ESCAPE",email:"MUST_NOT_ESCAPE",items:[{title:"Café em <São Paulo>",quantity:2,unitPriceCents:12295,buyer:"MUST_NOT_ESCAPE"}]}]};
test("gifts endpoint cannot load ledger before active role; reauth and response minimizes data", async () => {
  process.env.VERCEL_ENV="production";
  process.env.RSVP_ADMIN_ENABLED="true";
  process.env.RSVP_ADMIN_ORIGIN="https://daniecaio.vercel.app";
  process.env.UPSTASH_REDIS_REST_URL="https://redis.invalid";
  process.env.UPSTASH_REDIS_REST_TOKEN="SYNTHETIC_ADMIN_ONLY";
  let roles=[], ledgerReads=0, fixture=realFixture, broken=false;
  const originalFetch=global.fetch;
  const originalLoad=Module._load;
  global.fetch=async(url,opts)=>{
    assert.equal(url,"https://redis.invalid/");
    const [op,script]=JSON.parse(opts.body);
    assert.equal(op,"EVAL");assert.match(script,/^-- rsvp_admin_role/);
    assert.ok(roles.length);
    return {ok:true,json:async()=>({result:roles.shift()})};
  };
  Module._load=function(request,...args){
    if(request==="./_gift-ledger")return {listConfirmedGifts:async()=>{
      ledgerReads++;
      if(broken)throw new Error("MUST_NOT_ESCAPE");
      return fixture;
    }};
    return originalLoad.call(this,request,...args);
  };
  const get=async(auth=true)=>{
    const out={headers:{},setHeader(n,v){this.headers[n]=v;},status(c){this.code=c;return this;},json(v){this.body=v;return this;}};
    const headers={host:"daniecaio.vercel.app",...(auth?{cookie:"__Host-wedding-panel="+"A".repeat(43),"x-rsvp-panel-key":"B".repeat(43)}:{})};
    await endpoint({method:"GET",url:"/api/painel-presencas?view=gifts",headers},out);
    return out;
  };
  try {
    assert.equal((await get(false)).code,401);assert.equal(ledgerReads,0);
    roles=["change"];assert.equal((await get()).code,401);assert.equal(ledgerReads,0);
    roles=["active","signed-out"];assert.equal((await get()).code,401);assert.equal(ledgerReads,1);
    roles=["active","active"];const r=await get();
    assert.equal(r.code,200);assert.equal(r.headers["Cache-Control"],"private, no-store, max-age=0");
    assert.deepEqual(r.body,{state:"ready",since,captureActive:true,orders:[{confirmedAt:at,amountCents:24590,items:[{title:"Café em <São Paulo>",quantity:2}]}],totalCents:24590});
    assert.doesNotMatch(JSON.stringify(r.body),/MUST_NOT_ESCAPE|fixture-only|totalPaid|unitPrice/);
    roles=["active","active"];fixture={state:"disabled",orders:[realFixture.orders[0]]};
    assert.deepEqual((await get()).body,{state:"disabled",since:null,orders:[],totalCents:null});
    roles=["active"];broken=true;const err=await get();
    assert.equal(err.code,503);assert.doesNotMatch(JSON.stringify(err.body),/MUST_NOT_ESCAPE/);
  } finally {global.fetch=originalFetch;Module._load=originalLoad;}
});

test("active owner opens default Presenças; keyboard tab exposes only verified gifts and scope", async () => {
  const script=readFileSync("admin-assets/presencas.js","utf8");
  const nodes=new Map(), requests=[];
  const el=id=>{
    if(!nodes.has(id))nodes.set(id,{hidden:true,value:"",textContent:"",children:[],attr:{},events:{},addEventListener(n,f){this.events[n]=f;},
      replaceChildren(...xs){this.children=xs;},append(...xs){this.children.push(...xs);},focus(){this.focused=true;},reset(){},
      setAttribute(k,v){this.attr[k]=v;},querySelector(){return el("submit");}});
    return nodes.get(id);
  };
  const result=(body)=>({status:200,ok:true,json:async()=>body});
  let serial=0, giftState="disabled", body={state:"ready",since,captureActive:true,orders:[],totalCents:0};
  runInNewContext(script,{document:{getElementById:el,createDocumentFragment:()=>el("fragment"+serial++),createElement:()=>el("node"+serial++)},
    window:{addEventListener(){}},crypto:webcrypto,btoa,fetch:async(path,options)=>{
      requests.push(path);
      if(path.endsWith("?view=session"))return result({state:"signed-out"});
      if(options.method==="POST")return result({state:"active"});
      assert.match(options.headers["X-RSVP-Panel-Key"],/^[A-Za-z0-9_-]{43}$/);
      if(path.endsWith("?view=gifts"))return result(giftState==="disabled"?{state:"disabled"}:body);
      return result({rows:[],counts:{confirmed:0,declined:0,people:0,review:0,ignored:0}});
    }});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(el("panelTabs").hidden,true);
  el("username").value="caio";el("password").value="synthetic";
  await el("loginForm").events.submit({preventDefault(){},currentTarget:el("loginForm")});
  assert.equal(el("panelTabs").hidden,false);
  assert.equal(el("presencas").hidden,false);
  assert.ok(!requests.some(p=>p.endsWith("?view=gifts")));
  el("tabPresencas").events.keydown({key:"ArrowRight",preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(el("tabPresentes").attr["aria-selected"],"true");
  assert.equal(el("tabPresentes").focused,true);
  assert.equal(el("giftTotals").hidden,true);
  assert.match(el("giftStatus").textContent,/Histórico ainda não sincronizado/);
  giftState="ready";
  el("tabPresentes").events.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(el("giftTotals").hidden,false);
  assert.match(el("giftStatus").textContent,/Compras anteriores não aparecem.*Nenhum pagamento verificado desde/);
  body={state:"ready",since,totalCents:24590,orders:realFixture.orders};
  el("tabPresentes").events.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(el("giftOrderCount").textContent,"1");
  assert.match(el("giftAmount").textContent,/245,90/);
  assert.match(JSON.stringify(el("giftRows").children),/Café em <São Paulo>/);
  assert.doesNotMatch(JSON.stringify(el("giftRows").children),/MUST_NOT_ESCAPE|fixture-only/);
  el("tabPresencas").events.click();
  assert.equal(el("presencas").hidden,false);
  assert.equal(el("presentes").hidden,true);
  assert.equal(el("giftRows").children.length,0);
});
