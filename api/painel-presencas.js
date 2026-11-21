"use strict";
const { randomBytes, createHash, createHmac, scrypt, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");
const { isIP } = require("node:net");
const derive = promisify(scrypt);
const ADMIN = "dc:rsvp-admin:v1:{admin}";
const RECORDS = "dc:rsvp:v1:{responses}:records";
const COOKIE = "__Host-wedding-panel";
const OWNER = "caio";
const SESSION_TTL = 8 * 60 * 60;
const PENDING_TTL = 600;
const MAX_ROWS = 3000;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const KDF_RE = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{64})$/;
const dummy = "scrypt-v1$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000";
const keyDigest = token => createHash("sha256").update(token).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const kdf = (pass, salt) => derive(pass, Buffer.from(salt, "hex"), 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
async function verifies(pass, encoded) {
  const fields = KDF_RE.exec(encoded || "") || KDF_RE.exec(dummy);
  const actual = await kdf(pass, fields[1]);
  return timingSafeEqual(actual, Buffer.from(fields[2], "hex")) && KDF_RE.test(encoded || "");
}
async function credential(pass) {
  const salt = randomBytes(16).toString("hex");
  return "scrypt-v1$" + salt + "$" + (await kdf(pass, salt)).toString("hex");
}

const LIMIT = `-- rsvp_admin_limit
local ip = redis.call('INCR',KEYS[1])
if ip == 1 then redis.call('EXPIRE',KEYS[1],300) end
local all = redis.call('INCR',KEYS[2])
if all == 1 then redis.call('EXPIRE',KEYS[2],300) end
if ip > 12 or all > 80 then return 0 end
return 1
`;
const CLAIM = `-- rsvp_admin_claim
if redis.call('HEXISTS',KEYS[1],'credential') == 1 then return 0 end
local result = redis.call('SET',KEYS[2],ARGV[1],'NX','EX',tonumber(ARGV[2]))
if result then return 1 end
return 0
`;
const CHANGE = `-- rsvp_admin_change
if redis.call('HEXISTS',KEYS[1],'credential') == 1 then return 0 end
if redis.call('GET',KEYS[2]) ~= ARGV[1] then return 0 end
redis.call('HSET',KEYS[1],'credential',ARGV[2])
redis.call('DEL',KEYS[2])
redis.call('SET',KEYS[3],ARGV[4],'EX',tonumber(ARGV[3]))
return 1
`;
// Upstash EVAL (not EVAL_RO) routes these consistency-critical checks to the write primary.
const ROLE = `-- rsvp_admin_role
if redis.call('GET',KEYS[1]) == ARGV[1] then return 'active' end
if redis.call('GET',KEYS[2]) == ARGV[2] then return 'change' end
return 'signed-out'
`;
const READ_CREDENTIAL = `-- rsvp_admin_read_credential
return redis.call('HGET',KEYS[1],'credential')
`;
const LOGOUT = `-- rsvp_admin_logout
if redis.call('GET',KEYS[1]) == ARGV[2] then redis.call('DEL',KEYS[1]) end
if redis.call('GET',KEYS[2]) == ARGV[1] then redis.call('DEL',KEYS[2]) end
return 1
`;

function header(req, name) {
  const v = req.headers?.[name];
  return typeof v === "string" ? v : "";
}
function sessionToken(req) {
  const all = header(req, "cookie").split(";").map(x => x.trim()).filter(x => x.startsWith(COOKIE + "="));
  const val = all.length === 1 ? all[0].slice(COOKIE.length + 1) : "";
  return TOKEN_RE.test(val) ? val : null;
}
function setCookie(res, value, ttl) {
  res.setHeader("Set-Cookie", COOKIE + "=" + value + "; Path=/; Max-Age=" + ttl + "; Secure; HttpOnly; SameSite=Strict");
}
function respond(res, code, data) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(code).json(data);
}
function config(req) {
  if (process.env.VERCEL_ENV !== "production" || process.env.RSVP_ADMIN_ENABLED !== "true") return null;
  const origin = process.env.RSVP_ADMIN_ORIGIN || "";
  const secret = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  try {
    const home = new URL(origin);
    const redis = new URL(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "");
    if (home.protocol !== "https:" || origin !== home.origin || header(req,"host") !== home.host || !secret ||
        redis.protocol !== "https:" || redis.username || redis.password || redis.search || redis.hash) return null;
    return { origin, secret, url: redis.toString() };
  } catch { return null; }
}
async function redis(c, ...args) {
  const r = await fetch(c.url, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(4200),
    headers: { Authorization: "Bearer " + c.secret, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error("storage");
  const data = await r.json();
  if (!data || data.error || !Object.hasOwn(data, "result")) throw new Error("storage");
  return data.result;
}
const key = suffix => ADMIN + ":" + suffix;
const sessionKey = digest => key("session:" + digest);
async function role(c,digest,cap) {
  if (!digest || !cap) return "signed-out";
  return redis(c,"EVAL",ROLE,2,sessionKey(digest),key("pending"),cap,digest+":"+cap);
}
async function rate(c, req) {
  const input = header(req,"x-vercel-forwarded-for").split(",")[0].trim();
  const ip = isIP(input) ? input : "unclassified";
  const opaque = createHmac("sha256", c.secret).update(ADMIN + ":ip:" + ip).digest("hex");
  return Number(await redis(c,"EVAL",LIMIT,2,key("rl:"+opaque),key("rl:global"))) === 1;
}

function payload(req) {
  if (!/^application\/json(?:\s*;.*)?$/i.test(header(req,"content-type"))) return null;
  if (Number(header(req,"content-length")) > 8192) return null;
  let data = req.body;
  try {
    if (Buffer.isBuffer(data)) data = data.toString("utf8");
    if (typeof data === "string") {
      if (Buffer.byteLength(data,"utf8") > 8192) return null;
      data = JSON.parse(data);
    }
    if (!data || typeof data !== "object" || Array.isArray(data) || Buffer.byteLength(JSON.stringify(data),"utf8") > 8192) return null;
    return data;
  } catch { return null; }
}
function rawPass(x) { return typeof x === "string" && x.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(x); }
function validNew(pass) {
  return rawPass(pass) && pass.length >= 16 && pass.trim() === pass && /\p{L}/u.test(pass) &&
    /[0-9]|[^\p{L}\s]/u.test(pass) && !/(.)\1{6}/u.test(pass) &&
    !/^(?:danielle|caio|casamento|convidado|wedding|password|senha)/i.test(pass);
}
function bootstrap() {
  const encoded = process.env.RSVP_ADMIN_BOOTSTRAP_HASH || "";
  const until = process.env.RSVP_ADMIN_BOOTSTRAP_EXPIRES || "";
  // Require a UTC ISO timestamp, valid digest, and no more than 24h from now.
  if (!KDF_RE.test(encoded) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(until)) return null;
  const seconds = Math.floor((Date.parse(until) - Date.now()) / 1000);
  return seconds > 0 && seconds <= 86400 ? { encoded, seconds } : null;
}

function duplicateKey(name) {
  return name.normalize("NFKD").toLocaleLowerCase("pt-BR").replace(/\p{M}/gu,"").replace(/[^\p{L}\p{N}]+/gu," ").trim();
}
function cleanText(value, size) {
  return typeof value === "string" ? value.replace(/[\p{Cc}\p{Cf}]/gu," ").trim().slice(0,size) : "";
}
function cleanRow(value, id) {
  if (typeof value !== "string" || typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)) return null;
  try {
    const v = JSON.parse(value);
    if (!v || !["sim","nao"].includes(v.attendance)) return null;
    const guestName = cleanText(v.guestName,120);
    if (!guestName) return null;
    const companions = v.attendance === "sim" && Number.isInteger(v.companions) && v.companions >= 0 && v.companions <= 3 ? v.companions : 0;
    const at = typeof v.receivedAt === "string" && /^\d{4}-\d\d-\d\dT/.test(v.receivedAt) && Number.isFinite(Date.parse(v.receivedAt))
      ? new Date(v.receivedAt).toISOString() : "";
    return { guestName, status:v.attendance, companions,
      companionName:companions ? cleanText(v.companionName,120) : "",
      headcount:v.attendance === "sim" ? 1+companions : 0, at };
  } catch { return null; }
}
async function list(c) {
  const rowsById = new Map();
  let cursor = "0";
  let calls = 0;
  const deadline = Date.now() + 8500;
  let malformed = 0;
  do {
    if (++calls > 35 || Date.now() > deadline) throw new Error("read-limit");
    const page = await redis(c,"HSCAN",RECORDS,cursor,"COUNT",150);
    if (!Array.isArray(page) || page.length !== 2 || !/^\d{1,22}$/.test(String(page[0])) ||
        !Array.isArray(page[1]) || page[1].length % 2 || page[1].length > 6400) throw new Error("read-format");
    cursor = String(page[0]);
    for (let i=0; i<page[1].length; i+=2) {
      const id = page[1][i];
      if (rowsById.has(id)) continue;
      if (rowsById.size >= MAX_ROWS) throw new Error("read-limit");
      const row = cleanRow(page[1][i+1],id);
      if (!row) malformed++;
      rowsById.set(id,row);
    }
  } while (cursor !== "0");
  const rows = [...rowsById.values()].filter(Boolean);
  const names = new Map();
  for (const row of rows) {
    const n = duplicateKey(row.guestName);
    if (n) names.set(n,(names.get(n) || 0) + 1);
  }
  let confirmed = 0, declined = 0, people = 0, review = 0;
  for (const row of rows) {
    const n = duplicateKey(row.guestName);
    row.review = Boolean(n && names.get(n) > 1);
    review += Number(row.review);
    confirmed += Number(row.status === "sim");
    declined += Number(row.status === "nao");
    people += row.headcount;
  }
  rows.sort((a,b)=>b.at.localeCompare(a.at) || a.guestName.localeCompare(b.guestName,"pt-BR"));
  return { rows, counts:{confirmed,declined,people,review,ignored:malformed} };
}
function csvCell(v) {
  let s = String(v ?? "");
  if (/^[\s\p{Cf}]*[=+\-@]/u.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g,'""') + '"';
}
function csv(result) {
  const headers = ["Nome","Resposta","Acompanhantes","Nome do acompanhante","Pessoas previstas","Recebido em (UTC)","Revisar duplicidade"];
  const rows = result.rows.map(r=>[r.guestName,r.status==="sim"?"Sim":"Não",r.companions,r.companionName,r.headcount,r.at,r.review?"Sim":""]);
  return "\ufeff" + [headers,...rows].map(r=>r.map(csvCell).join(";")).join("\r\n") + "\r\n";
}

module.exports = async (req,res) => {
  res.setHeader("Cache-Control","private, no-store, max-age=0");
  res.setHeader("Vary","Cookie, X-RSVP-Panel-Key");
  res.setHeader("X-Robots-Tag","noindex, nofollow, noarchive");
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("X-Frame-Options","DENY");
  res.setHeader("Referrer-Policy","no-referrer");
  const c = config(req);
  if (!c) return respond(res,404,{error:"indisponivel"});
  const old = sessionToken(req);
  const digest = old ? keyDigest(old) : null;
  const rawCap = header(req,"x-rsvp-panel-key");
  const cap = TOKEN_RE.test(rawCap) ? keyDigest(rawCap) : null;
  try {
    if (req.method === "POST") {
      if (header(req,"origin") !== c.origin || ["cross-site","same-site"].includes(header(req,"sec-fetch-site"))) {
        return respond(res,403,{error:"origem"});
      }
      const data = payload(req);
      if (!data) return respond(res,400,{error:"entrada"});
      if (data.action === "logout") {
        if (digest && !cap) return respond(res,401,{error:"sessao"});
        if (digest && cap) await redis(c,"EVAL",LOGOUT,2,sessionKey(digest),key("pending"),digest+":"+cap,cap);
        setCookie(res,"",0);
        return respond(res,200,{state:"signed-out"});
      }
      if (!cap || !["login","change"].includes(data.action)) return respond(res,400,{error:"entrada"});
      if (!await rate(c,req)) {
        res.setHeader("Retry-After","300");
        return respond(res,429,{error:"tentativas"});
      }
      if (data.action === "login") {
        if (!rawPass(data.password) || !data.password || typeof data.username !== "string" || data.username.length > 64) {
          return respond(res,400,{error:"entrada"});
        }
        const saved = await redis(c,"EVAL",READ_CREDENTIAL,1,key("state"));
        const setup = !saved ? bootstrap() : null;
        const ok = await verifies(data.password,saved || setup?.encoded || dummy);
        if (!ok || data.username !== OWNER || (!saved && !setup)) return respond(res,401,{error:"credenciais"});
        const value = token(), hash = keyDigest(value);
        if (saved) {
          if (await redis(c,"SET",sessionKey(hash),cap,"NX","EX",String(SESSION_TTL)) !== "OK") throw new Error("session");
          setCookie(res,value,SESSION_TTL);
          return respond(res,200,{state:"active"});
        }
        const ttl = Math.min(PENDING_TTL,setup.seconds);
        if (Number(await redis(c,"EVAL",CLAIM,2,key("state"),key("pending"),hash+":"+cap,String(ttl))) !== 1) {
          return respond(res,409,{error:"temporaria_em_uso"});
        }
        setCookie(res,value,ttl);
        return respond(res,200,{state:"change"});
      }
      const setup = bootstrap();
      if (!setup || !digest || (await role(c,digest,cap)) !== "change") return respond(res,401,{error:"sessao"});
      if (!validNew(data.newPassword) || await verifies(data.newPassword,setup.encoded)) {
        return respond(res,400,{error:"senha_forte"});
      }
      const cred = await credential(data.newPassword);
      const value = token(), hash = keyDigest(value);
      if (!bootstrap() || Number(await redis(c,"EVAL",CHANGE,3,key("state"),key("pending"),sessionKey(hash),digest+":"+cap,cred,String(SESSION_TTL),cap)) !== 1) {
        return respond(res,409,{error:"sessao"});
      }
      setCookie(res,value,SESSION_TTL);
      return respond(res,200,{state:"active"});
    }
    if (req.method !== "GET") {
      res.setHeader("Allow","GET, POST");
      return respond(res,405,{error:"metodo"});
    }
    const view = new URL(req.url || "/",c.origin).searchParams.get("view") || "session";
    const state = await role(c,digest,cap);
    if (view === "session") return respond(res,200,{state});
    if (state !== "active") return respond(res,401,{error:"sessao"});
    if (view !== "responses" && view !== "csv") return respond(res,404,{error:"indisponivel"});
    const result = await list(c);
    if ((await role(c,digest,cap)) !== "active") return respond(res,401,{error:"sessao"});
    if (view === "responses") return respond(res,200,result);
    res.setHeader("Content-Type","text/csv; charset=utf-8");
    res.setHeader("Content-Disposition",'attachment; filename="presencas-casamento.csv"');
    return res.status(200).send(csv(result));
  } catch {
    return respond(res,503,{error:"indisponivel"});
  }
};
