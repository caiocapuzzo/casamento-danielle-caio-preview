"use strict";

(() => {
  const received = location.hash.slice(1);
  // Never retain the capability in the visible URL, history entry, query or browser storage.
  if (location.hash || location.search) {
    try { history.replaceState(null, "", location.pathname); }
    catch { document.querySelector("#status").textContent = "Não foi possível abrir o link com segurança. Fale com os noivos."; return; }
  }
  const get = id => document.getElementById(id);
  const status = get("status");
  const form = get("editor");
  const companion = get("companion");
  const companionField = get("companionField");
  const companionName = get("companionName");
  const toggle = get("toggle");
  const retry = get("retry");
  const attendance = () => form.querySelector('input[name="attendance"]:checked')?.value;
  let adding = false;
  let version;
  let busy = false;

  if (!/^[A-Za-z0-9_-]{43}$/.test(received)) {
    status.textContent = "Abra o link de edição que você guardou ao enviar sua resposta. Se não tiver o link, fale com os noivos.";
    return;
  }

  function sync(focus = false) {
    if (attendance() !== "sim") adding = false;
    companion.hidden = attendance() !== "sim";
    companionField.hidden = !adding;
    companionName.disabled = !adding;
    companionName.required = adding;
    if (!adding) {
      companionName.value = "";
      companionName.setCustomValidity("");
    }
    toggle.setAttribute("aria-expanded", String(adding));
    toggle.textContent = adding ? "Remover acompanhante" : "+ Adicionar acompanhante";
    if (focus && adding) companionName.focus();
  }

  function apply(result) {
    const answer = result.response;
    if (!answer || !["sim","nao"].includes(answer.attendance) || !Number.isSafeInteger(result.version) || result.version < 1) throw new Error("format");
    version = result.version;
    form.querySelector('input[value="sim"]').checked = answer.attendance === "sim";
    form.querySelector('input[value="nao"]').checked = answer.attendance === "nao";
    adding = answer.attendance === "sim" && Number(answer.companions) === 1;
    if (adding) companionName.value = typeof answer.companionName === "string" ? answer.companionName : "";
    sync();
    form.hidden = false;
  }

  async function send(payload) {
    if (busy) return;
    busy = true;
    const enabled = [...form.querySelectorAll("input:not(:disabled), button:not(:disabled)")];
    for (const control of enabled) control.disabled = true;
    retry.hidden = true;
    status.textContent = payload.action === "load" ? "Abrindo sua resposta…" : "Salvando as alterações…";
    try {
      const response = await fetch("/api/rsvp-edit", {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({...payload, editToken: received}),
        signal: AbortSignal.timeout(12000),
      });
      const result = await response.json();
      if (response.status === 409 && result.error === "conflict") {
        apply(result);
        status.textContent = "Sua resposta já mudou desde que você abriu a página. Confira a versão mais recente e faça novamente as alterações que quiser.";
      } else if (response.ok && result.ok === true) {
        apply(result);
        status.textContent = payload.action === "load" ? "Esta é a sua resposta atual." : "Alterações salvas. Obrigado por nos avisar!";
      } else if ([401,403,404,410].includes(response.status)) {
        form.hidden = true;
        status.textContent = "Não foi possível encontrar sua resposta com este link. Se precisar corrigir alguma coisa, fale com os noivos.";
      } else if (response.status === 429) {
        status.textContent = "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
        retry.hidden = payload.action !== "load";
      } else {
        throw new Error("request");
      }
    } catch {
      status.textContent = payload.action === "load"
        ? "Não foi possível abrir sua resposta agora. Tente novamente."
        : "Não foi possível confirmar as alterações. Tente salvar novamente.";
      retry.hidden = payload.action !== "load";
    } finally {
      busy = false;
      for (const control of enabled) control.disabled = false;
      sync();
    }
  }

  toggle.addEventListener("click", () => { adding = !adding; sync(true); });
  form.addEventListener("change", event => { if (event.target.name === "attendance") sync(); });
  companionName.addEventListener("input", () => companionName.setCustomValidity(""));
  retry.addEventListener("click", () => send({action: "load"}));
  form.addEventListener("submit", event => {
    event.preventDefault();
    const value = attendance();
    if (!value || !Number.isSafeInteger(version) || busy) return;
    const name = companionName.value.trim();
    if (adding && name.length < 2) {
      companionName.setCustomValidity("Informe o nome completo do acompanhante.");
      companionName.reportValidity();
      return;
    }
    void send({action: "update", version, attendance: value, companions: adding ? 1 : 0, ...(adding ? {companionName: name} : {})});
  });
  void send({action: "load"});
})();
