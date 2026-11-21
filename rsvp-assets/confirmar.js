"use strict";

function initRsvp() {
  const rsvpForm = document.querySelector("#rsvpForm");
  const formNote = document.querySelector("#formNote");
  if (!rsvpForm || !formNote) return;

  const companion = document.querySelector("#rsvpCompanion");
  const companionToggle = document.querySelector("#rsvpCompanionToggle");
  const companionFields = document.querySelector("#rsvpCompanionFields");
  const companionName = document.querySelector("#companionName");
  let addingCompanion = false;

  function syncCompanion() {
    if (!companion || !companionToggle || !companionFields || !companionName) return;
    const attending = Boolean(rsvpForm.querySelector('input[name="attendance"][value="sim"]:checked'));
    if (!attending) addingCompanion = false;
    companion.hidden = !attending;
    companionFields.hidden = !addingCompanion;
    companionName.disabled = !addingCompanion;
    companionName.required = addingCompanion;
    if (!addingCompanion) {
      companionName.value = "";
      companionName.setCustomValidity("");
    }
    companionToggle.setAttribute("aria-expanded", String(addingCompanion));
    companionToggle.textContent = addingCompanion ? "Remover acompanhante" : "+ Adicionar acompanhante";
  }

  companionToggle?.addEventListener("click", () => {
    addingCompanion = !addingCompanion;
    syncCompanion();
    if (addingCompanion) companionName.focus();
  });
  companionName?.addEventListener("input", () => companionName.setCustomValidity(""));
  rsvpForm.addEventListener("change", (event) => {
    if (event.target.name === "attendance") syncCompanion();
  });
  syncCompanion();

  const receipt = document.querySelector("#receipt");
  const linkBox = document.querySelector("#receiptLink");
  const editLink = document.querySelector("#editLink");
  const openLink = document.querySelector("#openLink");
  const copyStatus = document.querySelector("#copyStatus");
  document.querySelector("#copyLink").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(editLink.value);
      copyStatus.textContent = "Link copiado.";
    } catch {
      editLink.focus();
      editLink.select();
      editLink.setSelectionRange(0, editLink.value.length);
      copyStatus.textContent = "Link selecionado. Use a opção Copiar do seu aparelho.";
    }
  });

  function newToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  let pending = null;
  let sending = false;
  rsvpForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sending) return;
    const values = Object.fromEntries(new FormData(rsvpForm).entries());
    const signature = JSON.stringify(values);
    if (values.companionName !== undefined) {
      if (values.attendance !== "sim" || values.companionName.trim().length < 2) {
        companionName.setCustomValidity("Informe o nome completo do acompanhante.");
        companionName.reportValidity();
        return;
      }
      values.companions = "1";
    }
    const enabled = [...rsvpForm.querySelectorAll("input:not(:disabled), textarea:not(:disabled), button:not(:disabled)")];
    try {
      if (!pending || pending.signature !== signature) {
        pending = { signature, id: crypto.randomUUID(), editToken: newToken() };
      }
      sending = true;
      for (const control of enabled) control.disabled = true;
      formNote.textContent = "Enviando sua confirmação…";
      const response = await fetch("/api/rsvp", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, submissionId: pending.id, editToken: pending.editToken }),
        signal: AbortSignal.timeout(12000),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) {
        formNote.textContent = response.status === 429
          ? "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente."
          : "Não foi possível confirmar o envio. Confira os dados ou tente novamente.";
        return;
      }
      document.querySelector("#receiptMessage").textContent = values.attendance === "sim"
        ? "Presença confirmada. Que alegria ter você com a gente!"
        : "Resposta registrada. Sentiremos sua falta!";
      if (result.editable === true) {
        const url = new URL("/editar-presenca.html", location.origin);
        url.hash = pending.editToken;
        editLink.value = url.href;
        openLink.href = url.href;
        linkBox.hidden = false;
      } else {
        document.querySelector("#noLink").hidden = false;
      }
      rsvpForm.reset();
      rsvpForm.hidden = true;
      receipt.hidden = false;
      receipt.focus();
      pending = null;
    } catch {
      formNote.textContent = "Não foi possível confirmar o envio. Tente novamente.";
    } finally {
      sending = false;
      for (const control of enabled) control.disabled = false;
    }
  });
}


initRsvp();
