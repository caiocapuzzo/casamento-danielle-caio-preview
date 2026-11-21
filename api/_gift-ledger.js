"use strict";
const { createHash, createHmac, randomUUID } = require("node:crypto");
const { isIP } = require("node:net");
const catalog = new Map(require("./_gift-catalog"));
const origin = "https://daniecaio.vercel.app";
const handle = "caio-capuzzo";
const base = "https://api.checkout.infinitepay.io";
// Allow only exact InfinitePay buyer origins, not wildcard subdomains or redirects.
const buyerOrigins = new Set(["https://buy.infinitepay.io", "https://checkout.infinitepay.io"]);
const key = "dc:wedding-gifts:v1:{ledger}";
const ordersKey = key + ":orders", paymentsKey = key + ":paid", verifyKey = key + ":verify";
const validOrder = /^dcg-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const validTx = /^[a-zA-Z0-9_-]{6,128}$/;
const validSlug = /^[a-zA-Z0-9_-]{2,128}$/;
const sha = value => createHash("sha256").update(value).digest("hex");
const LOOKUP = `-- gift_verify_lookup
return {redis.call('HGET',KEYS[1],ARGV[1]) or false,
        redis.call('HGET',KEYS[2],ARGV[2]) or false}
`;
const PENDING_CHECK = `-- gift_verify_throttle
local n = redis.call('INCR',KEYS[1])
if n == 1 then redis.call('EXPIRE',KEYS[1],60) end
if n <= 20 then return 1 end
return 0
`;
const RECORD = `-- gift_snapshot
local ip = redis.call('INCR',KEYS[2])
if ip == 1 then redis.call('EXPIRE',KEYS[2],60) end
local all = redis.call('INCR',KEYS[3])
if all == 1 then redis.call('EXPIRE',KEYS[3],60) end
if ip > 12 or all > 80 or redis.call('HLEN',KEYS[1]) >= 5000 then return 0 end
return redis.call('HSETNX',KEYS[1],ARGV[1],ARGV[2])
`;
const CONFIRM = `-- gift_verify_persist
if redis.call('HGET',KEYS[1],ARGV[1]) ~= ARGV[2] then return 0 end
local existing = redis.call('HGET',KEYS[2],ARGV[3])
if existing then
  local a = cjson.decode(existing)
  if a.orderId == ARGV[1] and a.slugHash == ARGV[5] then return 2 end
  return 0
end
return redis.call('HSETNX',KEYS[2],ARGV[3],ARGV[4])
`;
function config() {
  if (process.env.VERCEL_ENV !== "production" || process.env.WEDDING_GIFTS_TRACKING_ENABLED !== "true") return null;
  const since = process.env.WEDDING_GIFTS_TRACKING_SINCE;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  const uri = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  try {
    const url = new URL(uri);
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(since || "") || !Number.isFinite(Date.parse(since)) ||
        Date.parse(since) > Date.now() || url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !token) return null;
    return { url: url.toString(), token, since, captureActive:process.env.WEDDING_GIFTS_CAPTURE_NEW === "true" };
  } catch { return null; }
}
function header(req, name) {
  const v = req.headers?.[name];
  return typeof v === "string" ? v : "";
}
const checkoutConfigured = req => header(req,"host") === new URL(origin).host ? config() : null;
// Explicit review/rollout split keeps callbacks for already-issued tracked links alive.
function captureConfigured(req) {
  const c = checkoutConfigured(req);
  return c?.captureActive ? c : null;
}
function readBody(req, limit = 20000) {
  if (Number(header(req,"content-length")) > limit) return Promise.reject(new Error("body"));
  return (async () => {
    let data = req.body;
    if (data === undefined) {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > limit) throw new Error("body");
        chunks.push(Buffer.from(chunk));
      }
      data = Buffer.concat(chunks);
    }
    if (typeof data === "string" || Buffer.isBuffer(data)) {
      if (Buffer.byteLength(data) > limit) throw new Error("body");
      data = JSON.parse(data.toString());
    }
    if (!data || typeof data !== "object" || Array.isArray(data) || Buffer.byteLength(JSON.stringify(data)) > limit) throw new Error("body");
    return data;
  })();
}
async function json(url, body, headers = {}, timeout = 3500) {
  const result = await fetch(url,{method:"POST",redirect:"error",signal:AbortSignal.timeout(timeout),
    headers:{"content-type":"application/json", ...headers},body:JSON.stringify(body)});
  if (!result.ok) {
    const error = new Error("upstream");
    error.upstreamStatus = result.status;
    throw error;
  }
  // Real JSON responses here are small; cap before JSON decode, even for chunked responses.
  let raw = "", bytes = 0;
  if (result.body && typeof result.body.getReader === "function") {
    const reader = result.body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.length;
        if (bytes > 2800000) { await reader.cancel(); throw new Error("response"); }
        raw += decoder.decode(part.value,{stream:true});
      }
      raw += decoder.decode();
    } finally { reader.releaseLock(); }
  } else {
    raw = await result.text();
    if (Buffer.byteLength(raw) > 2800000) throw new Error("response");
  }
  return JSON.parse(raw);
}
async function redis(c, ...args) {
  const response = await json(c.url,args,{authorization:"Bearer " + c.token},1500);
  if (!response || response.error || !Object.hasOwn(response,"result")) throw new Error("ledger");
  return response.result;
}
function canon(raw) {
  if (raw.handle !== handle || !Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > catalog.size) return null;
  const seen = new Set();
  const items = [];
  for (const v of raw.items) {
    if (!v || typeof v !== "object") return null;
    const {description:title,quantity,price} = v;
    const unitPriceCents = catalog.get(title);
    if (!unitPriceCents || price !== unitPriceCents || !Number.isInteger(quantity) || quantity < 1 || quantity > 50 || seen.has(title)) return null;
    seen.add(title);
    items.push({ title,quantity,unitPriceCents });
  }
  return items;
}
function prefill(raw) {
  const clean = (v, max) => typeof v === "string" && v.length <= max && !/[\p{Cc}\p{Cf}]/u.test(v) ? v.trim() : "";
  const name = clean(raw.name,120), email = clean(raw.email,254), phone = clean(raw.phone,40).replace(/[^0-9+]/g,"");
  return { ...(name ? {name} : {}), ...(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? {email} : {}),
    ...(phone && /^\+?[0-9]{8,15}$/.test(phone) ? {phone_number:phone} : {}) };
}
function reply(res,status,data) {
  res.statusCode = status;
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  return res.end(JSON.stringify(data));
}
async function createTracked(c, req, res) {
  const requestOrigin = header(req,"origin");
  if (requestOrigin !== origin || !/^application\/json(?:\s*;.*)?$/i.test(header(req,"content-type"))) return reply(res,403,{error:"Origem do checkout inválida."});
  let raw;
  try { raw = await readBody(req); } catch { return reply(res,400,{error:"Carrinho inválido."}); }
  const items = canon(raw);
  if (!items) return reply(res,400,{error:"O carrinho mudou. Atualize a página e confira os preços."});
  const orderId = "dcg-" + randomUUID();
  const createdAt = new Date().toISOString();
  const amountCents = items.reduce((a,v)=>a+v.quantity*v.unitPriceCents,0);
  let tracked = false;
  try {
    const ip = header(req,"x-vercel-forwarded-for").split(",")[0].trim();
    const fingerprint = createHmac("sha256",c.token).update(key + ":ip:" + (isIP(ip) ? ip : "unclassified")).digest("hex");
    tracked = (await redis(c,"EVAL",RECORD,3,ordersKey,key+":capture:"+fingerprint,key+":capture:global",
      orderId,JSON.stringify({ orderId,createdAt,amountCents,items }))) === 1;
  } catch { /* Storage outage must not block guests from paying. */ }
  const customer = prefill(raw);
  const data = {
    handle, order_nsu:orderId,
    redirect_url:origin + "/api/gift-payment-return",
    items:items.map(item=>({description:item.title,quantity:item.quantity,price:item.unitPriceCents})),
    ...(tracked ? { webhook_url:origin + "/api/gift-payment-webhook" } : {}),
    ...(Object.keys(customer).length ? { customer } : {}),
  };
  async function linkFor(payload, timeout) {
    const provider = await json(base + "/links",payload,{},timeout);
    try {
      const url = new URL(provider?.link || provider?.url || provider?.checkout_url);
      if (!buyerOrigins.has(url.origin) || url.username || url.password) throw new Error("unsafe");
      return url.toString();
    } catch {
      const error = new Error("unexpected checkout");
      error.unusableLink = true;
      throw error;
    }
  }
  try {
    return reply(res,200,{ link:await linkFor(data,3400) });
  } catch (error) {
    // Retry at most once after a definitive payload/contract rejection or unusable
    // link. Do not retry outages, rate limits, auth errors, redirects or timeouts.
    // The alternate is canonical, no webhook, and has a distinct reference: it
    // cannot be misclassified as the already-snapshotted order.
    if (tracked && (error.unusableLink || [400,415,422].includes(error.upstreamStatus))) {
      const { webhook_url:unused, ...fallback } = data;
      try {
        return reply(res,200,{ link:await linkFor({...fallback,order_nsu:"dcg-" + randomUUID()},2700) });
      } catch { /* one fallback, then preserve guest-friendly provider error */ }
    }
    return reply(res,502,{error:"Não foi possível abrir o checkout agora. Tente novamente."});
  }
}
function eventKeys(input,slugField) {
  const id=input?.order_nsu, tx=input?.transaction_nsu, slug=input?.[slugField];
  return typeof id === "string" && validOrder.test(id) && typeof tx === "string" && validTx.test(tx) &&
    typeof slug === "string" && validSlug.test(slug) ? { id,tx,slug } : null;
}
function saneOrder(row,id) {
  if (!row || row.orderId !== id || !Array.isArray(row.items) || !row.items.length || row.items.length > 80 ||
      !Number.isSafeInteger(row.amountCents) || row.amountCents < 100 ||
      !Number.isFinite(Date.parse(row.createdAt))) return false;
  let total = 0;
  for (const item of row.items) {
    if (typeof item?.title !== "string" || !item.title.length || item.title.length > 180 || !Number.isSafeInteger(item.quantity) ||
        item.quantity < 1 || item.quantity > 50 || !Number.isSafeInteger(item.unitPriceCents) || item.unitPriceCents < 100) return false;
    total += item.quantity * item.unitPriceCents;
  }
  return total === row.amountCents;
}
async function confirm(c,event) {
  if (!event) return "ignore";
  const {id,tx,slug} = event;
  const digest=sha(tx);
  const saved = await redis(c,"EVAL",LOOKUP,2,paymentsKey,ordersKey,digest,id);
  if (!Array.isArray(saved) || saved.length !== 2) throw new Error("storage");
  const [recorded,snapshot] = saved;
  if (recorded) {
    // Never accept an existing transaction as belonging to a different order or invoice.
    const v = JSON.parse(recorded);
    return v.orderId === id && v.slugHash === sha(slug) ? "confirmed" : "ignore";
  }
  if (!snapshot) return "ignore";
  const order = JSON.parse(snapshot);
  if (!saneOrder(order,id)) throw new Error("invalid snapshot");
  // Limit per-order verification attempts and global provider pressure. Return non-2xx so
  // InfinitePay can retry legitimate callbacks when temporarily throttled.
  if ((await redis(c,"EVAL",PENDING_CHECK,1,verifyKey+":"+id)) !== 1 ||
      (await redis(c,"EVAL",PENDING_CHECK,1,verifyKey)) !== 1) return "retry";
  const checked = await json(base + "/payment_check",{ handle,order_nsu:id,transaction_nsu:tx,slug });
  if (checked?.success !== true || checked?.paid !== true || checked?.amount !== order.amountCents ||
      (Object.hasOwn(checked,"order_nsu") && checked.order_nsu !== id) ||
      (Object.hasOwn(checked,"transaction_nsu") && checked.transaction_nsu !== tx) ||
      (Object.hasOwn(checked,"slug") && checked.slug !== slug) ||
      (Object.hasOwn(checked,"invoice_slug") && checked.invoice_slug !== slug)) return "retry";
  const confirmedAt = new Date().toISOString();
  // `amount` is the order's gross merchandise value, not payout or gross+installment fees.
  const row = { orderId:id,confirmedAt,amountCents:order.amountCents,items:order.items,slugHash:sha(slug) };
  const result = await redis(c,"EVAL",CONFIRM,2,ordersKey,paymentsKey,id,snapshot,digest,JSON.stringify(row),row.slugHash);
  return result === 1 || result === 2 ? "confirmed" : "ignore";
}
async function listConfirmedGifts() {
  const c = config();
  if (!c) return {state:"disabled",since:null,orders:[]};
  const rows = new Map();
  let cursor = "0", pageCount = 0;
  const deadline = Date.now()+6500;
  do {
    if (++pageCount > 36 || Date.now() > deadline) throw new Error("ledger");
    const page = await redis(c,"HSCAN",paymentsKey,cursor,"COUNT",150);
    if (!Array.isArray(page) || page.length !== 2 || !/^\d{1,22}$/.test(String(page[0])) ||
        !Array.isArray(page[1]) || page[1].length % 2) throw new Error("ledger");
    cursor = String(page[0]);
    for (let i=0;i<page[1].length;i+=2) {
      const [id,raw] = [page[1][i],page[1][i+1]];
      if (rows.has(id)) continue;
      if (rows.size >= 5000 || !/^[a-z0-9]{64}$/.test(id) || typeof raw !== "string") throw new Error("ledger");
      const v = JSON.parse(raw);
      // Confirmed rows have no checkout-creation time exposed; validate their immutable
      // item and total structure using the confirmation time in this guard.
      if (!validOrder.test(v.orderId) || !saneOrder({...v,createdAt:v.confirmedAt},v.orderId)) throw new Error("ledger");
      rows.set(id,{
        id:v.orderId+"-"+id.slice(0,16), confirmedAt:v.confirmedAt, amountCents:v.amountCents,
        items:v.items.map(({title,quantity,unitPriceCents})=>({title,quantity,unitPriceCents}))
      });
    }
  } while (cursor !== "0");
  return {state:"ready",since:c.since,captureActive:c.captureActive,orders:[...rows.values()].sort((a,b)=>b.confirmedAt.localeCompare(a.confirmedAt) || a.id.localeCompare(b.id))};
}
module.exports = { origin, checkoutConfigured, captureConfigured, readBody, createTracked, reply, eventKeys, confirm, listConfirmedGifts };
