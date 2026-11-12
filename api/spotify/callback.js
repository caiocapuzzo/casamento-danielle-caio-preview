"use strict";
const crypto = require("node:crypto");
const C = require("./_common");

function page(res, status, title, message) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'");
  res.end('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Spotify — Dani & Caio</title><style>body{font:16px system-ui;max-width:540px;margin:12vh auto;padding:24px;background:#fbf9f3;color:#283523}h1{font-size:28px}a{color:#56603c}</style><h1>' +
    title + '</h1><p>' + message + '</p><p><a href="/musicas.html">Voltar à página de músicas</a></p></html>');
}

module.exports = async (req, res) => {
  C.preventIndex(res);
  if (req.method !== "GET") return page(res, 405, "Método não permitido", "Use a autorização iniciada pelo painel de configuração.");
  const cookies = String(req.headers.cookie || "").split(";").map(x => x.trim());
  const cookie = cookies.find(x => x.startsWith("dc_spotify_state="));
  res.setHeader("Set-Cookie", "dc_spotify_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/spotify; Max-Age=0");
  try {
    C.requiredEnv();
    const stored = cookie ? cookie.slice("dc_spotify_state=".length).split(".") : [];
    const state = String(req.query?.state || "");
    const nonce = stored[0] || "";
    const signature = stored[1] || "";
    const expected = crypto.createHmac("sha256", process.env.SPOTIFY_SETUP_KEY)
      .update(nonce).digest("hex");
    if (!state || state !== nonce || signature.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return page(res, 403, "Autorização inválida", "A sessão de configuração expirou. Abra novamente o painel e tente outra vez.");
    }
    if (req.query?.error) return page(res, 403, "Autorização cancelada", "A conta Spotify não concedeu a permissão.");
    const code = String(req.query?.code || "");
    if (!code) return page(res, 400, "Código ausente", "Volte ao painel de configuração.");
    if (await C.redis("GET", C.TOKEN_KEY)) {
      return page(res, 409, "Spotify já conectado", "A playlist já está vinculada.");
    }
    const token = await C.tokenRequest({
      grant_type: "authorization_code", code, redirect_uri: C.REDIRECT_URI
    });
    if (!token.refresh_token) return page(res, 503, "Conexão incompleta", "O Spotify não retornou a autorização duradoura.");
    const [me, playlist] = await Promise.all([
      C.spotifyApi("/me", { token: token.access_token }),
      C.spotifyApi("/playlists/" + C.PLAYLIST_ID, { token: token.access_token })
    ]);
    if (!me.id || playlist.owner?.id !== me.id) {
      return page(res, 403, "Conta diferente", "Conecte a conta Spotify que é proprietária da playlist do casamento.");
    }
    await C.redis("SET", C.TOKEN_KEY, token.refresh_token);
    await C.redis("SET", C.ACCESS_KEY, token.access_token, "EX",
      Math.max(60, Math.min(3300, (token.expires_in || 3600) - 180)));
    return page(res, 200, "Spotify conectado!", "Sua conta foi autorizada para adicionar músicas à playlist do casamento. Nenhuma música foi alterada nesta etapa.");
  } catch (e) {
    return page(res, 503, "Não foi possível conectar", "Verifique as variáveis de ambiente, a URL de retorno e a conta proprietária da playlist.");
  }
};
