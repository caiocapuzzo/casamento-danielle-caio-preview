"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const checkout = require("../api/create-checkout");
const webhook = require("../api/gift-payment-webhook");
const returning = require("../api/gift-payment-return");
const {listConfirmedGifts} = require("../api/_gift-ledger");
const catalog = require("../api/_gift-catalog");
const origin="https://daniecaio.vercel.app";
const headers={host:"daniecaio.vercel.app",origin,"content-type":"application/json"};
const absent = Symbol();
const fx = {
  name:"Comprador Fictício", email:"test@example.invalid", phone:"+55 11 98765-4321",
  order_nsu:"old-browser-ref",redirect_url:"https://previous.example.invalid/success",
  handle:"caio-capuzzo",item:"",items:[{description:catalog[0][0],quantity:2,price:catalog[0][1]}]
};
async function call(fn, method, body, override={}) {
  const res={ code:null, headers:{}, raw:null,
    setHeader(k,v){ this.headers[k.toLowerCase()]=v; },
    end(text){this.code=this.statusCode;this.raw=text;}
  };
  await fn({method,headers,body,...override},res);
  return {status:res.code,headers:res.headers,body:res.raw ? JSON.parse(res.raw) : null};
}
function mock(t) {
  const vars = { VERCEL_ENV:"production", WEDDING_GIFTS_TRACKING_ENABLED:"true",
    WEDDING_GIFTS_CAPTURE_NEW:"true", WEDDING_GIFTS_TRACKING_SINCE:"2025-01-01T00:00:00Z",
    UPSTASH_REDIS_REST_URL:"https://redis-synthetic.example.invalid",
    UPSTASH_REDIS_REST_TOKEN:"mock-only",KV_REST_API_URL:"",KV_REST_API_TOKEN:"" };
  const before=Object.entries(vars).map(([k,v])=>[k,Object.hasOwn(process.env,k)?process.env[k]:absent]);
  Object.assign(process.env,vars);
  const original=globalThis.fetch;
  t.after(()=>{globalThis.fetch=original;for (const [k,v] of before) if(v===absent) delete process.env[k]; else process.env[k]=v;});
  const state = { links:[], checks:[], calls:[], orders:new Map(), payments:new Map(),
    throttles:new Map(), failStore:false, amount:fx.items[0].price*2, truth:true, inject:{},
    link:"https://buy.infinitepay.io/synthetic-path",rejectTracked:null,trackedLink:null };
  globalThis.fetch = async (url,{body})=>{
    body=JSON.parse(body);
    if (url==="https://api.checkout.infinitepay.io/links") {
      state.links.push(body);
      if (body.webhook_url) {
        assert.ok(state.orders.has(body.order_nsu));
        if (state.rejectTracked) return Response.json({error:"synthetic rejection"},{status:state.rejectTracked});
        if (state.trackedLink) return Response.json({url:state.trackedLink});
      }
      return Response.json({url:state.link});
    }
    if (url==="https://api.checkout.infinitepay.io/payment_check") {
      state.checks.push(body);
      return Response.json({success:state.truth,paid:state.truth,amount:state.amount,paid_amount:state.amount+19,...state.inject});
    }
    assert.equal(url,"https://redis-synthetic.example.invalid/");
    state.calls.push(body);
    const [cmd,script,n,...args]=body;
    let result;
    if (cmd==="HSCAN") result=["0",[...state.payments.entries()].flat()];
    else if (cmd==="EVAL"&&script.startsWith("-- gift_snapshot")) {
      const [orderKey,netKey,globalKey,id,row]=args;
      assert.equal(n,3);assert.match(netKey,/capture:[0-9a-f]{64}$/);assert.match(globalKey,/capture:global$/);
      if (state.failStore) throw new Error("synthetic storage error");
      if(state.orders.has(id)) result=0;
      else {state.orders.set(id,row);result=1;}
    } else if(cmd==="EVAL"&&script.startsWith("-- gift_verify_lookup")) {
      const [,,digest,id]=args;
      result=[state.payments.get(digest)||null,state.orders.get(id)||null];
    } else if(cmd==="EVAL"&&script.startsWith("-- gift_verify_throttle")) {
      const [k]=args;
      const ns=(state.throttles.get(k)||0)+1;
      state.throttles.set(k,ns);
      result=ns<=20?1:0;
    } else if (cmd==="EVAL"&&script.startsWith("-- gift_verify_persist")) {
      const [,,id,snapshot,digest,row,slugHash] = args;
      if (state.orders.get(id)!==snapshot) result=0;
      else if (state.payments.has(digest)) {
        const old=JSON.parse(state.payments.get(digest));
        result=old.orderId===id&&old.slugHash===slugHash?2:0;
      } else {state.payments.set(digest,row);result=1;}
    } else assert.fail("Unexpected mock storage command: "+cmd);
    return Response.json({result});
  };
  return state;
}
const callback = (id,tx="tx-Synthetic-a",extra={})=>({ order_nsu:id,transaction_nsu:tx,invoice_slug:"invoice-fake-1",amount:1,items:[{title:"discard"}],...extra });
test("catalog projection matches every gift and the displayed browser rounding",()=>{
  const local=path.join(__dirname,".."), repo=path.join(local,"gifts.html");
  const html=fs.readFileSync(fs.existsSync(repo)?repo:path.join(local,"base/gifts.html"),"utf8");
  const multiplier=Number(html.match(/data-price-multiplier="([^"]+)/)[1]);
  const expected=[...html.matchAll(/<article\b([^>]*\bgift-card\b[^>]*)>([\s\S]*?)<\/article>/g)].map(([,a,b])=>{
    const title=b.match(/<h3>([^<]+)<\/h3>/)[1].trim();
    const named={amp:"&",quot:'"',apos:"'",lt:"<",gt:">",nbsp:"\u00a0"};
    const decoded=title.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(_,code)=>{
      if(code.startsWith("#x")) return String.fromCodePoint(parseInt(code.slice(2),16));
      if(code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
      assert.ok(Object.hasOwn(named,code));return named[code];
    });
    return [decoded,Math.round(Number(a.match(/data-price="([^"]+)/)[1])*multiplier)*100];
  });
  assert.equal(expected.length,57);
  assert.deepEqual(catalog,expected);
});
test("dark, preview, and paused capture keep the exact legacy payload; disabled reader never accesses Redis",async t=>{
  const s=mock(t);
  delete process.env.WEDDING_GIFTS_TRACKING_ENABLED;
  assert.deepEqual(await listConfirmedGifts(),{state:"disabled",since:null,orders:[]});
  assert.equal((await call(checkout,"POST",fx)).status,200);
  assert.deepEqual(s.links[0],fx);
  assert.equal((await call(webhook,"POST",callback("historical"))).status,404);
  process.env.WEDDING_GIFTS_TRACKING_ENABLED="true";
  process.env.VERCEL_ENV="preview";
  assert.equal((await call(checkout,"POST",fx)).status,200);
  assert.deepEqual(s.links[1],fx);
  assert.equal((await call(webhook,"POST",callback("historical"))).status,404);
  assert.deepEqual(s.calls,[]);
  process.env.VERCEL_ENV="production";
  process.env.WEDDING_GIFTS_CAPTURE_NEW="false";
  assert.equal((await call(checkout,"POST",fx)).status,200);
  assert.deepEqual(s.links[2],fx);
  assert.deepEqual(await listConfirmedGifts(),{state:"ready",since:"2025-01-01T00:00:00Z",captureActive:false,orders:[]});
});
test("stores server-owned immutable canonical order before provider and sends only documented prefill",async t=>{
  const s=mock(t);
  const result=await call(checkout,"POST",{...fx,webhook_url:"https://previous.example.invalid/hook",options:{single_payment:true}});
  assert.deepEqual(result.body,{link:s.link});
  const [req]=s.links;
  const {order_nsu:id}=req;
  assert.match(id,/^dcg-/);assert.notEqual(id,fx.order_nsu);
  assert.deepEqual(req.items,fx.items);
  assert.equal(req.redirect_url,origin+"/api/gift-payment-return");
  assert.equal(req.webhook_url,origin+"/api/gift-payment-webhook");
  assert.deepEqual(req.customer,{name:fx.name,email:fx.email,phone_number:"+5511987654321"});
  assert.ok(!("options" in req));
  const row=JSON.parse(s.orders.get(id));
  assert.equal(row.amountCents,s.amount);
  assert.deepEqual(row.items,[{title:catalog[0][0],quantity:2,unitPriceCents:catalog[0][1]}]);
  assert.ok(!s.orders.get(id).includes(fx.email));
  assert.deepEqual((await listConfirmedGifts()).orders,[]);
  const bads = [ { ...fx,items:[{...fx.items[0],price:1}] }, { ...fx, items:[{...fx.items[0],quantity:1.5}] }, {...fx,items:[...fx.items,...fx.items]} ];
  for(const bad of bads) assert.equal((await call(checkout,"POST",bad)).status,400);
  assert.equal((await call(checkout,"POST",fx,{headers:{...headers,origin:"https://external.example.invalid"}})).status,403);
  assert.equal(s.links.length,1);
});
test("storage outage keeps checkout working without false coverage; provider redirect is constrained",async t=>{
  const s=mock(t);s.failStore=true;
  assert.equal((await call(checkout,"POST",fx)).status,200);
  assert.equal(s.links[0].redirect_url,origin+"/api/gift-payment-return");
  assert.ok(!("webhook_url" in s.links[0]));
  assert.deepEqual((await listConfirmedGifts()).orders,[]);
  s.link="https://previous.example.invalid/success";
  assert.equal((await call(checkout,"POST",fx)).status,502);
});
test("validates only with provider, does not trust callback body, handles duplicate or second payment atomically",async t=>{
  const s=mock(t);
  await call(checkout,"POST",fx);
  const [{order_nsu:id}]=s.links;
  const event=callback(id);
  s.truth=false;
  assert.equal((await call(webhook,"POST",event)).status,503);
  s.truth=true;s.amount=111;
  assert.equal((await call(webhook,"POST",event)).status,503);
  s.amount=fx.items[0].price*2;
  s.inject={order_nsu:"unknown"};
  assert.equal((await call(webhook,"POST",event)).status,503);
  s.inject={};
  assert.deepEqual((await listConfirmedGifts()).orders,[]);
  const done=await Promise.all([call(webhook,"POST",event),call(webhook,"POST",event)]);
  assert.deepEqual(done.map(x=>x.status),[200,200]);assert.equal(s.payments.size,1);
  assert.deepEqual(s.checks[0],{handle:fx.handle,order_nsu:id,transaction_nsu:event.transaction_nsu,slug:event.invoice_slug});
  const before=s.checks.length;
  assert.equal((await call(webhook,"POST",event)).status,200);
  assert.equal(s.checks.length,before);
  const second = callback(id,"tx-Synthetic-b");
  // Pausing capture leaves already issued links and history alive.
  process.env.WEDDING_GIFTS_CAPTURE_NEW="false";
  const res=await call(returning,"GET",undefined,{url:"/api/gift-payment-return?order_nsu="+id+"&transaction_nsu="+second.transaction_nsu+"&slug="+second.invoice_slug+"&receipt_url=synthetic"});
  assert.equal(res.status,303);assert.equal(res.headers.location,origin+"/checkout-success.html");
  assert.equal(res.headers["referrer-policy"],"no-referrer");
  const data=await listConfirmedGifts();
  assert.equal(data.orders.length,2);assert.ok(data.orders[0].id!==data.orders[1].id);
  for(const row of data.orders) {
    assert.equal(row.amountCents,s.amount);assert.equal(row.items[0].title,catalog[0][0]);
    assert.ok(!JSON.stringify(row).includes(event.transaction_nsu));
  }
  const old=callback("dcg-00000000-0000-4000-8000-000000000000","tx-Synthetic-another");
  const prev=s.checks.length;assert.equal((await call(webhook,"POST",old)).status,200);assert.equal(s.checks.length,prev);
});

test("definitive tracked link rejection or unsafe link falls back once to canonical untracked checkout",async t=>{
  const s=mock(t);
  s.rejectTracked=422;
  assert.equal((await call(checkout,"POST",fx)).body.link,s.link);
  assert.equal(s.links.length,2);
  const [tracked,fallback]=s.links;
  assert.ok(tracked.webhook_url);
  assert.ok(!("webhook_url" in fallback));
  assert.notEqual(tracked.order_nsu,fallback.order_nsu);
  assert.ok(!s.orders.has(fallback.order_nsu));
  assert.deepEqual(fallback.items,tracked.items);
  assert.equal(fallback.redirect_url,origin+"/api/gift-payment-return");
  assert.equal((await call(webhook,"POST",callback(fallback.order_nsu))).status,200);
  assert.equal(s.checks.length,0);
  assert.deepEqual((await listConfirmedGifts()).orders,[]);
  s.rejectTracked=null;
  s.trackedLink="https://other.example.invalid/private";
  assert.equal((await call(checkout,"POST",fx)).body.link,s.link);
  assert.equal(s.links.length,4);
  s.rejectTracked=503;
  s.trackedLink=null;
  assert.equal((await call(checkout,"POST",fx)).status,502);
  assert.equal(s.links.length,5);
});
