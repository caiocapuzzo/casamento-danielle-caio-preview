"use strict";
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const path=require("node:path");
const {test}=require("node:test");
const {runInNewContext}=require("node:vm");
const {webcrypto}=require("node:crypto");
const read=name=>readFileSync(path.join(__dirname,"..",name),"utf8");
function elements() {
  const all=new Map();
  function el(id) {
    if(!all.has(id))all.set(id,{hidden:true,value:"",textContent:"",disabled:false,checked:false,
      handlers:{},addEventListener(name,fn){this.handlers[name]=fn;},focus(){this.focused=true;},select(){this.selected=true;},
      setSelectionRange(){},setAttribute(){},setCustomValidity(){},reset(){},reportValidity(){},
      querySelectorAll(){return [];},querySelector(){return undefined;}});
    return all.get(id);
  }
  return el;
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const res=(status,data)=>({status,ok:status===200,json:async()=>data});
test("create retry reuses token and submission id; link stays hidden until bound",async()=>{
  const el=elements(), calls=[];
  const location={origin:"https://example.test"}, fetch=async(url,opts)=>{
    calls.push([url,JSON.parse(opts.body)]);
    return calls.length===1?res(503,{ok:false}):res(200,{ok:true,editable:true});
  };
  runInNewContext(read("rsvp-assets/confirmar.js"),{document:{querySelector:el},location,
    URL,crypto:webcrypto,Uint8Array,btoa,AbortSignal,fetch,
    FormData:class { entries() {return Object.entries({guestName:"Fixture",attendance:"nao"});} },
    navigator:{clipboard:{writeText:async()=>{throw Error("unavailable");}}}});
  const submit=el("#rsvpForm").handlers.submit, event={preventDefault(){}};
  await submit(event);
  assert.equal(el("#receiptLink").hidden,true);
  await submit(event);
  assert.deepEqual(calls[0],calls[1]);
  assert.equal(calls[0][0],"/api/rsvp");
  assert.match(calls[0][1].editToken,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(new URL(el("#editLink").value).hash.slice(1),calls[0][1].editToken);
  assert.equal(el("#receiptLink").hidden,false);
  await el("#copyLink").handlers.click();
  assert.equal(el("#editLink").selected,true);
});
test("edit clears fragment before fetch, renders conflict and retains version for explicit resubmit",async()=>{
  const el=elements(), calls=[], token="F".repeat(43);
  const location={pathname:"/editar-presenca.html",hash:"#"+token,search:""};
  const radio={sim:{value:"sim",checked:false},nao:{value:"nao",checked:false}};
  el("editor").querySelector=selector => selector.includes(":checked")?Object.values(radio).find(x=>x.checked):(selector.includes('"sim"')?radio.sim:radio.nao);
  const answer=(status,version,attendance,companions,companionName)=>res(status,{ok:status===200,error:status===409?"conflict":undefined,version,response:{attendance,companions,companionName}});
  const fetch=async(url,opts)=>{
    assert.equal(location.hash,"");
    assert.equal(url,"/api/rsvp-edit");
    assert.equal(opts.credentials,"omit");
    const body=JSON.parse(opts.body);calls.push(body);
    if(calls.length===1)return answer(200,1,"sim",1,"Pessoa de Teste");
    if(calls.length===2)return answer(409,2,"sim",1,"Outro Teste");
    return answer(200,3,"nao",0,"");
  };
  runInNewContext(read("rsvp-assets/editar.js"),{location,history:{replaceState(_a,_b,path){assert.equal(path,location.pathname);location.hash="";}},document:{getElementById:el},fetch,AbortSignal});
  await settle();
  assert.equal(el("companionName").value,"Pessoa de Teste");
  assert.deepEqual(calls[0],{action:"load",editToken:token});
  function decline() {
    radio.sim.checked=false;radio.nao.checked=true;
    el("editor").handlers.change({target:{name:"attendance"}});
    el("editor").handlers.submit({preventDefault(){}});
  }
  decline();await settle();
  assert.match(el("status").textContent,/já mudou/);
  assert.equal(el("companionName").value,"Outro Teste");
  decline();await settle();
  assert.deepEqual(calls[2],{action:"update",version:2,attendance:"nao",companions:0,editToken:token});
  assert.match(el("status").textContent,/salvas/);
});
test("only protected pages render forms and load first-party assets, homepage still has RSVP CTA",()=>{
  const {headers}=JSON.parse(read("vercel.json"));
  for(const path of ["/confirmar-presenca.html","/editar-presenca.html"]) {
    const html=read(path.slice(1));
    assert.doesNotMatch(html, /https?:|gtag|GTM-/i);
    const hs=Object.fromEntries(headers.find(h=>h.source===path).headers.map(h=>[h.key,h.value]));
    assert.match(hs["Content-Security-Policy"],/default-src 'none'.*form-action 'none'.*frame-ancestors 'none'/);
    assert.equal(hs["Cross-Origin-Opener-Policy"],"same-origin");
    assert.equal(hs["Referrer-Policy"],"no-referrer");
    assert.match(hs["Cache-Control"],/no-store/);
  }
  const page=read("index.html");
  assert.match(page,/id="rsvp"/);
  assert.match(page,/href="\/confirmar-presenca.html"/);
  assert.doesNotMatch(page,/id="rsvpForm"|editar-presenca\.html/);
});
