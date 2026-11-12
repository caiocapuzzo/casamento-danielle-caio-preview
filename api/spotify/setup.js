"use strict";
const crypto = require("node:crypto");
const C = require("./_common");

module.exports = async (req, res) => {
  C.preventIndex(res);
  if (req.method !== "POST") return C.send(res, 405, { error: "Método não permitido." });
  try {
    C.requiredEnv();
    const input = await C.body(req);
    const provided = Buffer.from(String(input.setupKey || ""));
    const expected = Buffer.from(process.env.SPOTIFY_SETUP_KEY);
    if (!provided.length || provided.length !== expected.length ||
        !crypto.timingSafeEqual(provided, expected)) {
      return C.send(res, 403, { error: "Chave de configuração incorreta." });
    }
    if (await C.redis("GET", C.TOKEN_KEY)) {
      return C.send(res, 409, { error: "Spotify já está conectado. Não é necessário autorizar novamente." });
    }
    const nonce = crypto.randomBytes(32).toString("hex");
    const signature = crypto.createHmac("sha256", process.env.SPOTIFY_SETUP_KEY)
      .update(nonce).digest("hex");
    res.setHeader("Set-Cookie",
      "dc_spotify_state=" + nonce + "." + signature +
      "; HttpOnly; Secure; SameSite=Lax; Path=/api/spotify; Max-Age=600");
    const url = new URL("https://accounts.spotify.com/authorize");
    url.search = new URLSearchParams({
      client_id: C.CLIENT_ID,
      response_type: "code",
      redirect_uri: C.REDIRECT_URI,
      state: nonce,
      scope: "playlist-modify-public playlist-modify-private user-read-private",
      show_dialog: "true"
    }).toString();
    C.send(res, 200, { authorizeUrl: url.toString() });
  } catch (e) { C.fail(res, e); }
};
