"use strict";
const api = "/api/painel-presencas";
const $ = id => document.getElementById(id);
const views = ["login","change","presencas"];
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
function blank() {
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
$("retry").addEventListener("click",()=>void refresh());
$("more").addEventListener("click",()=>{limit+=30;render();});
window.addEventListener("pagehide",()=>{++epoch;panelKey="";$("loginForm").reset();$("changeForm").reset();blank();view(null);});
window.addEventListener("pageshow",e=>{ if(e.persisted)void refresh(); });
void refresh();
