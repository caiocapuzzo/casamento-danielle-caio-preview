"use strict";
const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {createServer} = require("node:http");
const {test} = require("node:test");
const {resolve, extname} = require("node:path");

test("mobile/desktop guest flow saves a private edit link, retries, resolves a stale version and removes a companion", {skip: !process.env.RSVP_BROWSER_TEST}, async t => {
  const {chromium} = require("playwright");
  const seen = [];
  let submissions = 0;
  let conflict = true;
  let inactive = false;
  const root = resolve(__dirname,"..");
  const headers = JSON.parse(readFileSync(resolve(root,"vercel.json"))).headers;
  const server = createServer(async (req,res) => {
    const path = new URL(req.url,"http://localhost").pathname;
    if (path === "/api/rsvp" || path === "/api/rsvp-edit") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      seen.push({url:req.url,ref:req.headers.referer,data});
      let body, status = 200;
      if (path === "/api/rsvp") {
        submissions++;
        if (submissions === 1) { status = 503; body = {ok:false}; }
        else body = {ok:true, editable:!inactive};
      } else if (data.action === "load") {
        if (inactive) {status = 404; body = {ok:false};}
        else body = {ok:true,version:1,response:{attendance:"sim",companions:1,companionName:"Pessoa de Teste"}};
      } else if (conflict) {
        conflict = false;
        status = 409;
        body = {ok:false,error:"conflict",version:2,response:{attendance:"sim",companions:1,companionName:"Outro Nome de Teste"}};
      } else body = {ok:true,version:3,response:{attendance:data.attendance,companions:data.companions,companionName:data.companionName}};
      res.writeHead(status,{"content-type":"application/json"}).end(JSON.stringify(body));
      return;
    }
    if (!/^\/(confirmar-presenca|editar-presenca)\.html$|^\/rsvp-assets\/(confirmar|editar)\.js$|^\/rsvp-assets\/resposta\.css$/.test(path)) {res.writeHead(404).end();return;}
    for(const {key,value} of headers.find(h=>h.source===path)?.headers??[]) res.setHeader(key,value);
    res.setHeader("content-type",{".html":"text/html; charset=utf-8",".css":"text/css",".js":"text/javascript"}[extname(path)]);
    res.end(readFileSync(resolve(root,path.slice(1))));
  });
  await new Promise(r=>server.listen(0,"127.0.0.1",r));
  t.after(()=>new Promise(r=>server.close(r)));
  const browser = await chromium.launch(process.env.CHROMIUM_BIN ? {executablePath:process.env.CHROMIUM_BIN,args:["--no-sandbox"]} : {});
  t.after(()=>browser.close());
  const base = "http://127.0.0.1:"+server.address().port;
  const page = await browser.newPage({viewport:{width:320,height:700}, isMobile:true, deviceScaleFactor:2, hasTouch:true});
  const issues = [];
  page.on("pageerror", err=>issues.push(String(err)));
  page.on("request", req=>assert.ok(req.url().startsWith(base), "no third-party request"));
  await page.addInitScript(()=>Object.defineProperty(navigator,"clipboard",{value:{writeText:async()=>{throw new Error("unavailable");}}}));
  const response = await page.goto(base+"/confirmar-presenca.html");
  assert.match(response.headers()["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(response.headers()["cross-origin-opener-policy"],"same-origin");
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);
  await page.getByLabel("Nome completo",{exact:true}).fill("Convidado fictício");
  await page.getByText("Sim, estarei lá!",{exact:true}).click();
  await page.getByText("+ Adicionar acompanhante",{exact:true}).click();
  await page.getByLabel("Nome completo do acompanhante").fill("Pessoa de Teste");
  await page.getByRole("button",{name:"Enviar resposta"}).click();
  await page.getByText("Não foi possível confirmar o envio.",{exact:false}).waitFor();
  await page.getByRole("button",{name:"Enviar resposta"}).click();
  await page.getByRole("heading",{name:"Resposta registrada"}).waitFor();
  const editLink = await page.getByLabel("Seu link de edição").inputValue();
  assert.match(editLink,/\/editar-presenca\.html#[A-Za-z0-9_-]{43}$/);
  assert.equal(new URL(editLink).hash.slice(1),seen[0].data.editToken);
  assert.equal(seen[0].data.submissionId,seen[1].data.submissionId);
  assert.equal(seen[0].data.editToken,seen[1].data.editToken);
  assert.equal(seen[0].data.companions,"1");
  await page.getByRole("button",{name:"Copiar link"}).click();
  await page.getByText("Link selecionado.",{exact:false}).waitFor();
  await page.getByRole("link",{name:"Editar minha resposta"}).click();
  await page.getByText("Esta é a sua resposta atual.").waitFor();
  assert.equal(page.url(),base+"/editar-presenca.html");
  assert.equal(await page.getByLabel("Nome completo do acompanhante").inputValue(),"Pessoa de Teste");
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);
  assert.equal(seen[2].url,"/api/rsvp-edit");
  assert.equal(seen[2].ref,undefined);
  assert.equal(seen[2].data.editToken,new URL(editLink).hash.slice(1));
  await page.getByText("Infelizmente não poderei ir").click();
  await page.getByRole("button",{name:"Salvar alterações"}).click();
  await page.getByText("Sua resposta já mudou",{exact:false}).waitFor();
  assert.equal(await page.getByLabel("Nome completo do acompanhante").inputValue(),"Outro Nome de Teste");
  await page.getByText("Infelizmente não poderei ir").click();
  await page.getByRole("button",{name:"Salvar alterações"}).click();
  await page.getByText("Alterações salvas.",{exact:false}).waitFor();
  assert.equal(seen[4].data.version,2);
  assert.equal(seen[4].data.companions,0);
  assert.equal(seen[4].data.companionName,undefined);
  assert.deepEqual(issues,[]);
  assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length]),[0,0]);
  await page.reload();
  await page.getByText("Abra o link de edição",{exact:false}).waitFor();
  assert.equal(seen.length,5);
  inactive = true;
  const desktop=await browser.newPage({viewport:{width:1440,height:900}});
  await desktop.goto(editLink);
  await desktop.getByText("Não foi possível encontrar sua resposta",{exact:false}).waitFor();
  assert.equal(desktop.url(),base+"/editar-presenca.html");
  await desktop.goto(base+"/confirmar-presenca.html");
  await desktop.getByLabel("Nome completo",{exact:true}).fill("Convidado falso");
  await desktop.getByText("Infelizmente não poderei ir").click();
  await desktop.getByRole("button",{name:"Enviar resposta"}).click();
  await desktop.getByText("Se precisar alterar esta resposta, fale com os noivos.").waitFor();
  assert.equal(await desktop.locator("#receiptLink").isVisible(),false);
  await desktop.close();
  await page.close();
});
