"use strict";
const crypto = require("node:crypto");

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || "1aaa4eef7ece4e00bc2fa91376d67f88";
const PLAYLIST_ID = "2u5ZOx6YYH05UDJ9UE3oae";
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || "https://daniecaio.vercel.app/api/spotify/callback";
const TOKEN_KEY = "dc:spotify:refresh";
const ACCESS_KEY = "dc:spotify:access";

function send(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.status(status).json(body);
}

function fail(res, error) {
  const status = Number(error.status) || 503;
  const message = status === 429
    ? "Muitas tentativas ou limite do Spotify atingido. Tente novamente mais tarde."
    : status === 400
      ? error.message
      : status === 403
        ? "A conta Spotify não autorizou essa operação. Verifique a conexão."
        : "A integração está indisponível. Tente novamente mais tarde.";
  send(res, status, { error: message });
}

async function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let raw = "";
  for await (const part of req) {
    raw += part.toString();
    if (raw.length > 4096) throw Object.assign(new Error("Dados muito grandes."), { status: 400 });
  }
  try { return JSON.parse(raw || "{}"); }
  catch { throw Object.assign(new Error("Dados inválidos."), { status: 400 }); }
}

function requiredEnv() {
  if (!process.env.SPOTIFY_CLIENT_SECRET ||
      !process.env.SPOTIFY_SETUP_KEY ||
      !process.env.UPSTASH_REDIS_REST_URL ||
      !process.env.UPSTASH_REDIS_REST_TOKEN) {
    throw Object.assign(new Error("Variáveis de ambiente ausentes."), { status: 503 });
  }
}

async function redis() {
  requiredEnv();
  const response = await fetch(process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, ""), {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.UPSTASH_REDIS_REST_TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(Array.from(arguments)),
    signal: AbortSignal.timeout(8000)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.error) throw new Error("Redis indisponível.");
  return json.result;
}

async function tokenRequest(params) {
  requiredEnv();
  const credentials = Buffer.from(CLIENT_ID + ":" + process.env.SPOTIFY_CLIENT_SECRET).toString("base64");
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + credentials,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(10000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw Object.assign(new Error("Não foi possível autenticar no Spotify."), { status: 403 });
  return data;
}

async function accessToken() {
  let token = await redis("GET", ACCESS_KEY);
  if (token) return token;
  const refresh = await redis("GET", TOKEN_KEY);
  if (!refresh) throw Object.assign(new Error("Spotify ainda não conectado."), { status: 503 });
  const result = await tokenRequest({ grant_type: "refresh_token", refresh_token: refresh });
  if (result.refresh_token) await redis("SET", TOKEN_KEY, result.refresh_token);
  token = result.access_token;
  await redis("SET", ACCESS_KEY, token, "EX", Math.max(60, Math.min(3300, (result.expires_in || 3600) - 180)));
  return token;
}

async function spotifyApi(path, options = {}) {
  const token = options.token || await accessToken();
  const response = await fetch("https://api.spotify.com/v1" + path, {
    method: options.method || "GET",
    headers: {
      Authorization: "Bearer " + token,
      ...(options.body ? { "Content-Type": "application/json" } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(12000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !options.token) await redis("DEL", ACCESS_KEY);
    const error = new Error("Spotify " + response.status);
    error.status = [400, 403, 429].includes(response.status) ? response.status : 503;
    throw error;
  }
  return data;
}

function ipKey(req) {
  const raw = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  return crypto.createHmac("sha256", process.env.SPOTIFY_SETUP_KEY || "no-key")
    .update(raw).digest("hex").slice(0, 24);
}

async function rateLimit(req, label, max, seconds) {
  const bucket = Math.floor(Date.now() / (seconds * 1000));
  const key = "dc:rate:" + label + ":" + ipKey(req) + ":" + bucket;
  const count = Number(await redis("INCR", key));
  await redis("EXPIRE", key, seconds * 2);
  if (count > max) throw Object.assign(new Error("Limite de solicitações atingido."), { status: 429 });
}

function preventIndex(res) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
}

module.exports = {
  CLIENT_ID, PLAYLIST_ID, REDIRECT_URI, TOKEN_KEY, ACCESS_KEY,
  send, fail, body, requiredEnv, redis, tokenRequest, accessToken, spotifyApi,
  ipKey, rateLimit, preventIndex
};
