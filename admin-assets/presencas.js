"use strict";
const api = "/api/painel-presencas";
const $ = id => document.getElementById(id);
const views = ["login","change","presencas"];
const tabs = [{id:"tabPresencas",panel:"presencas"},{id:"tabPresentes",panel:"presentes"}];
let selectedTab = 0;
let giftEpoch = 0;
const currency = new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"});
const day = new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeZone:"America/Sao_Paulo"});
let rows = [];
let limit = 30;
let epoch = 0;
let working = false;
// Intentionally memory-only. This page carries no analytics or third-party scripts.
let panelKey = "";
function newPanelKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
const date = new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short",timeZone:"America/Sao_Paulo"});
const describe = {
  credenciais:"Usuário ou senha incorretos.",
  senha_forte:"Escolha uma senha diferente da temporária e siga os requisitos acima.",
  temporaria_em_uso:"Já existe uma primeira entrada em andamento. Volte à aba em que começou ou aguarde alguns minutos para tentar de novo.",
  tentativas:"Muitas tentativas. Aguarde cinco minutos antes de tentar de novo.",
  sessao:"A sessão expirou. Entre novamente.",
  indisponivel:"Não foi possível concluir esta etapa agora.",
};
function notice(text="") { $("notice").textContent = text; }
function view(target) {
  $("retry").hidden=true;
  views.forEach(id=>{$(id).hidden = id !== target;});
  $("logout").hidden = target !== "presencas" && target !== "change";
  $("panelTabs").hidden = target !== "presencas";
  $("presentes").hidden = true;
  if (target === "presencas") setTab(0,false);
}
async function call(where, data) {
  const response = await fetch(api + where, {
    credentials:"same-origin", cache:"no-store",
    headers:{...(panelKey?{"X-RSVP-Panel-Key":panelKey}:{}),...(data?{"Content-Type":"application/json"}:{})},
    ...(data ? {method:"POST",body:JSON.stringify(data)} : {}),
  });
  const body = await response.json();
  if (!response.ok) {
    const err = new Error(describe[body.error] || describe.indisponivel);
    err.status=response.status;
    throw err;
  }
  return body;
}
function blankGifts() {
  ++giftEpoch;
  $("giftRows").replaceChildren();
  $("giftTotals").hidden=true;
  $("giftStatus").textContent="";
  $("giftRetry").hidden=true;
  $("giftOrderCount").textContent="";
  $("giftAmount").textContent="";
}
function blank() {
  blankGifts();
  rows=[];
  $("rows").replaceChildren();
  $("resultCount").textContent="";
  $("search").value="";
  $("filter").value="all";
  $("ignored").hidden=true;
  for (const id of ["confirmed","declined","people","review"]) $(id).textContent="";
  $("more").hidden=true;
}
function clean(s) {
  return s.normalize("NFKD").toLocaleLowerCase("pt-BR").replace(/\p{M}/gu,"").trim();
}
function node(tag, text, className) {
  const element=document.createElement(tag);
  if (className) element.className=className;
  if (text) element.textContent=text;
  return element;
}
function render() {
  const q=clean($("search").value), status=$("filter").value;
  const visible=rows.filter(row=>(!q || clean(row.guestName+" "+row.companionName).includes(q)) &&
    (status==="all" || (status==="review"?row.review:row.status===status)));
  const fragment=document.createDocumentFragment();
  for (const row of visible.slice(0,limit)) {
    const entry=node("li","","entry");
    const name=node("div","","entry-name");
    name.append(node("strong",row.guestName));
    if (row.companionName) name.append(node("small","Acompanhante: "+row.companionName));
    const state=node("div");
    state.append(node("span",row.status==="sim"?"Confirmada":"Não vai","badge"+(row.status==="nao"?" no":"")));
    if (row.review) {
      const check=node("div");
      check.append(node("span","Revisar possível repetição","badge review"));
      state.append(check);
    }
    const info=node("div");
    info.append(node("small","Acompanhantes: "+row.companions));
    if (row.at) info.append(node("small",date.format(new Date(row.at))));
    entry.append(name,state,info);
    fragment.append(entry);
  }
  $("rows").replaceChildren(fragment);
  $("more").hidden=visible.length<=limit;
  $("resultCount").textContent=visible.length
    ? `Mostrando ${Math.min(limit,visible.length)} de ${visible.length} respostas.`
    : (rows.length?"Nenhuma resposta para este filtro.":"Nenhuma resposta recebida ainda.");
}
function setTab(index,load=true) {
  if ($("panelTabs").hidden) return;
  selectedTab=index;
  tabs.forEach((tab,i)=>{
    $(tab.id).setAttribute("aria-selected",String(i===index));
    $(tab.id).tabIndex=i===index?0:-1;
    $(tab.panel).hidden=i!==index;
  });
  if (index===1&&load) void refreshGifts();
  else blankGifts();
}
async function refreshGifts() {
  blankGifts();
  const n=giftEpoch;
  $("giftStatus").textContent="Carregando pagamentos verificados…";
  try {
    const result=await call("?view=gifts");
    if(n!==giftEpoch || selectedTab!==1)return;
    if(result.state==="disabled") {
      $("giftStatus").textContent="Histórico ainda não sincronizado. Esta aba ainda não acompanha pagamentos.";
      return;
    }
    const since=new Date(result.since);
    if(result.state!=="ready"||!result.since||!Number.isFinite(since.getTime())) throw new Error("dados");
    $("giftStatus").textContent="Acompanhamento de novos pedidos desde "+day.format(since)+
      ". Compras anteriores não aparecem automaticamente aqui."+
      (result.captureActive?"":" O registro de novos pedidos está pausado.")+
      (result.orders.length===0?" Nenhum pagamento verificado desde o início do acompanhamento.":"");
    $("giftTotals").hidden=false;
    $("giftOrderCount").textContent=String(result.orders.length);
    $("giftAmount").textContent=currency.format(result.totalCents/100);
    const fragment=document.createDocumentFragment();
    for(const order of result.orders) {
      const li=node("li","","gift-order");
      const time=node("time","Confirmação: "+date.format(new Date(order.confirmedAt)));
      time.dateTime=order.confirmedAt;
      const value=node("strong","Valor do pedido: "+currency.format(order.amountCents/100));
      const items=node("ul");
      for(const item of order.items) {
        const line=node("li","","gift-receipt-item");
        line.append(node("span",String(item.quantity)+" ×"),node("span",item.title));
        items.append(line);
      }
      li.append(time,value,items);
      fragment.append(li);
    }
    $("giftRows").replaceChildren(fragment);
  } catch(err) {
    if(n!==giftEpoch||selectedTab!==1)return;
    if(err.status===401) {
      panelKey="";blank();view("login");notice("A sessão expirou. Entre novamente.");
    } else {
      blankGifts();
      $("giftStatus").textContent="Não foi possível consultar os pagamentos agora.";
      $("giftRetry").hidden=false;
    }
  }
}
async function show(state,n) {
  if(n!==epoch)return;
  if (state === "active") {
    view(null);
    $("logout").hidden=false;
    notice("Carregando respostas…");
    let result;
    try { result=await call("?view=responses"); }
    catch(error) {
      if(n!==epoch)return;
      if(error.status===401) {
        panelKey=""; blank(); view("login"); notice("A sessão expirou. Entre novamente.");
      } else {
        $("retry").hidden=false;
        notice("Você entrou, mas as respostas não carregaram. Tente novamente.");
      }
      return;
    }
    if(n!==epoch)return;
    rows=result.rows;
    for (const id of ["confirmed","declined","people","review"]) $(id).textContent=String(result.counts[id]);
    if(result.counts.ignored) {
      $("ignored").textContent="Alguns registros antigos não puderam ser exibidos.";
      $("ignored").hidden=false;
    }
    view("presencas");
    limit=30;
    render();
  } else if (state === "change") {
    view("change"); $("newPassword").focus();
  } else {
    blank(); view("login");
  }
  notice();
}
async function refresh() {
  const n=++epoch;
  try { const result=await call("?view=session");await show(result.state,n); }
  catch(err) { if(n!==epoch)return;blank();view("login");notice(err.message); }
}
async function submit(event,data) {
  event.preventDefault();
  if(working)return;
  working=true;
  const n=++epoch, button=event.currentTarget.querySelector("button");
  const form=event.currentTarget;
  if(data.action==="login")panelKey=newPanelKey();
  button.disabled=true;
  notice("Verificando…");
  try { const result=await call("",data);form.reset();await show(result.state,n); }
  catch(err) {
    if(n===epoch) {
      if(err.status===401&&data.action==="change") { form.reset();view("login"); }
      notice(err.message);
    }
  }
  finally { button.disabled=false;working=false; }
}
$("loginForm").addEventListener("submit",e=>submit(e,{action:"login",username:$("username").value.trim(),password:$("password").value}));
$("changeForm").addEventListener("submit",e=>{
  if($("newPassword").value!==$("confirmPassword").value) {
    e.preventDefault();notice("As duas senhas precisam ser iguais.");$("confirmPassword").focus();return;
  }
  void submit(e,{action:"change",newPassword:$("newPassword").value});
});
$("logout").addEventListener("click",async()=>{
  if(working)return;
  working=true;
  ++epoch;
  blank();
  // Always clear visible data, even if server-side revocation cannot be confirmed.
  view("login");
  notice("Encerrando sessão…");
  try { await call("",{action:"logout"});notice("Sessão encerrada."); }
  catch { notice("Não consegui encerrar a sessão no servidor. Feche esta aba e tente sair novamente."); }
  finally { panelKey="";working=false; }
});
$("export").addEventListener("click",async()=>{
  if(!panelKey)return;
  const button=$("export");
  button.disabled=true;
  try {
    const response=await fetch(api+"?view=csv",{credentials:"same-origin",cache:"no-store",headers:{"X-RSVP-Panel-Key":panelKey}});
    if(!response.ok)throw new Error(response.status===401?"Sua sessão expirou. Entre novamente.":"Não foi possível baixar o arquivo.");
    const file=URL.createObjectURL(await response.blob());
    const anchor=document.createElement("a");
    anchor.href=file;
    anchor.download="presencas-casamento.csv";
    anchor.click();
    setTimeout(()=>URL.revokeObjectURL(file),2000);
  } catch(error) { notice(error.message); }
  finally { button.disabled=false; }
});
for (const id of ["search","filter"]) $(id).addEventListener(id==="search"?"input":"change",()=>{limit=30;render();});
tabs.forEach((tab,index)=>{
  $(tab.id).addEventListener("click",()=>setTab(index));
  $(tab.id).addEventListener("keydown",event=>{
    const next={ArrowLeft:(index+tabs.length-1)%tabs.length,ArrowRight:(index+1)%tabs.length,Home:0,End:tabs.length-1}[event.key];
    if(next===undefined)return;
    event.preventDefault();
    setTab(next);
    $(tabs[next].id).focus();
  });
});
$("giftRetry").addEventListener("click",()=>void refreshGifts());
$("retry").addEventListener("click",()=>void refresh());
$("more").addEventListener("click",()=>{limit+=30;render();});
window.addEventListener("pagehide",()=>{++epoch;panelKey="";$("loginForm").reset();$("changeForm").reset();blank();view(null);});
window.addEventListener("pageshow",e=>{ if(e.persisted)void refresh(); });
void refresh();
