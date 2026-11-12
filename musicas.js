"use strict";

const form = document.getElementById("musicForm");
const nameInput = document.getElementById("guestName");
const queryInput = document.getElementById("songQuery");
const resultList = document.getElementById("searchResults");
const selectedBox = document.getElementById("selectedTrack");
const submitButton = document.getElementById("submitSong");
const statusEl = document.getElementById("status");
const recentBox = document.getElementById("recentSuggestions");
let selected = null;
let timer = null;
let currentController = null;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function message(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function addArtwork(parent, track) {
  const image = node("img", "cover");
  image.width = 56;
  image.height = 56;
  image.alt = "Capa do álbum";
  image.loading = "lazy";
  if (track.image && /^https:\/\//.test(track.image)) image.src = track.image;
  else image.hidden = true;
  parent.append(image);
}

function showSelection(track) {
  selected = track;
  selectedBox.replaceChildren();
  addArtwork(selectedBox, track);
  const desc = node("div", "track-copy");
  desc.append(node("strong", "", track.name), node("span", "", track.artist));
  selectedBox.append(desc);
  selectedBox.hidden = false;
  resultList.replaceChildren();
  submitButton.disabled = false;
  message("");
}

function renderSearch(tracks) {
  resultList.replaceChildren();
  if (!tracks.length) {
    resultList.append(node("p", "search-note", "Nenhuma música encontrada. Tente outro nome ou artista."));
    return;
  }
  tracks.forEach(track => {
    const button = node("button", "track-option");
    button.type = "button";
    addArtwork(button, track);
    const info = node("span", "track-copy");
    info.append(node("strong", "", track.name), node("span", "", track.artist));
    button.append(info);
    button.addEventListener("click", () => showSelection(track));
    resultList.append(button);
  });
}

queryInput.addEventListener("input", () => {
  const query = queryInput.value.trim();
  selected = null;
  submitButton.disabled = true;
  selectedBox.hidden = true;
  resultList.replaceChildren();
  message("");
  clearTimeout(timer);
  if (currentController) currentController.abort();
  if (query.length < 3) return;
  timer = setTimeout(async () => {
    const controller = new AbortController();
    currentController = controller;
    resultList.replaceChildren(node("p", "search-note", "Buscando músicas…"));
    try {
      const response = await fetch("/api/spotify/search?q=" + encodeURIComponent(query), {
        signal: controller.signal
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível pesquisar agora.");
      if (controller !== currentController) return;
      renderSearch(data.tracks || []);
    } catch (error) {
      if (error.name !== "AbortError") {
        resultList.replaceChildren(node("p", "search-note error", error.message || "Falha ao buscar músicas."));
      }
    }
  }, 550);
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (name.length < 2) return message("Por favor, informe seu nome.", true);
  if (!selected) return message("Escolha uma música nas sugestões.", true);
  submitButton.disabled = true;
  message("Adicionando sua música à nossa história…");
  try {
    const response = await fetch("/api/spotify/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, trackId: selected.id })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível adicionar a música.");
    message(data.duplicate
      ? "Sua música já estava na nossa seleção, mas registramos que você também a escolheu! ♥"
      : "Sua música agora faz parte da nossa história! Obrigado pela escolha! ♥");
    queryInput.value = "";
    selected = null;
    selectedBox.hidden = true;
    submitButton.disabled = true;
    resultList.replaceChildren();
    loadRecent();
  } catch (error) {
    message(error.message || "Tente novamente mais tarde.", true);
    submitButton.disabled = false;
  }
});

async function loadRecent() {
  try {
    const response = await fetch("/api/spotify/recent");
    if (!response.ok) return;
    const data = await response.json();
    if (!data.suggestions?.length) return;
    recentBox.replaceChildren();
    data.suggestions.forEach(item => {
      const card = node("article", "recent-item");
      const song = node("div", "recent-info");
      song.append(node("strong", "", item.track), node("span", "", item.artist));
      card.append(song, node("p", "recent-person", "Escolhida por " + item.name));
      recentBox.append(card);
    });
  } catch {
    // Recent choices are optional; failures should not block song suggestions.
  }
}
loadRecent();
