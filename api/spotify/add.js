"use strict";
const C = require("./_common");

const ADDED_PREFIX = "dc:spotify:added:";
const SUGGESTIONS_KEY = "dc:spotify:suggestions";

module.exports = async (req, res) => {
  if (req.method !== "POST") return C.send(res, 405, { error: "Método não permitido." });
  let key = null;
  let posted = false;
  let lockOwner = false;
  try {
    const data = await C.body(req);
    const name = String(data.name || "").trim().replace(/\s+/g, " ").slice(0, 70);
    const id = String(data.trackId || "").trim();
    if (name.length < 2 || name.length > 70 || !/^[A-Za-z0-9]{22}$/.test(id)) {
      return C.send(res, 400, { error: "Informe seu nome e escolha uma música das sugestões." });
    }
    await C.rateLimit(req, "add", 15, 3600);
    const track = await C.spotifyApi("/tracks/" + id);
    if (track.type !== "track" || track.id !== id) {
      return C.send(res, 400, { error: "Música não encontrada." });
    }
    key = ADDED_PREFIX + id;
    let duplicate = (await C.redis("GET", key)) === "added";
    if (!duplicate) {
      const lock = await C.redis("SET", key, "processing", "EX", 120, "NX");
      if (lock !== "OK") {
        const current = await C.redis("GET", key);
        if (current === "added") duplicate = true;
        else return C.send(res, 409, { error: "Essa música já está sendo adicionada. Tente novamente." });
      } else {
        lockOwner = true;
        await C.spotifyApi("/playlists/" + C.PLAYLIST_ID + "/items", {
          method: "POST", body: { uris: ["spotify:track:" + id] }
        });
        posted = true;
        await C.redis("SET", key, "added", "EX", 31536000);
        lockOwner = false;
      }
    }
    const record = {
      name,
      trackId: id,
      track: String(track.name || ""),
      artist: (track.artists || []).map(x => x.name).join(", "),
      at: new Date().toISOString(),
      duplicate
    };
    try {
      await C.redis("LPUSH", SUGGESTIONS_KEY, JSON.stringify(record));
      await C.redis("LTRIM", SUGGESTIONS_KEY, 0, 499);
    } catch (e) {
      // The Spotify write already succeeded. Do not invite retries that would duplicate it.
      return C.send(res, 200, { ok: true, duplicate, note: "Música recebida; o histórico está temporariamente indisponível." });
    }
    return C.send(res, 200, { ok: true, duplicate });
  } catch (e) {
    if (lockOwner && !posted && key) await C.redis("DEL", key).catch(() => {});
    C.fail(res, e);
  }
};
