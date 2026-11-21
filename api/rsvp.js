"use strict";
const { createHash, createHmac } = require("node:crypto");
const { isIP } = require("node:net");
const { PREFIX, EDIT_TOKEN_LIFETIME_MS, tokenDigest, canonicalRequest } = require("./_rsvp-edit-contract");

const MAX_BODY = 8192;
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAX_RECORDS = 3000;
const PER_NETWORK = 40;
const WINDOW_SECONDS = 900;

// All keys share a Redis hash slot. One atomic command makes successful retries safe.
const SAVE = `
local existing = redis.call('HGET', KEYS[1], ARGV[1])
if existing then
  local row = cjson.decode(existing)
  if row.fingerprint == ARGV[2] and (row.editHash or '') == ARGV[8] then return 'duplicate' end
  return 'conflict'
end
local count = redis.call('INCR', KEYS[2])
if count == 1 then redis.call('EXPIRE', KEYS[2], tonumber(ARGV[5])) end
if count > tonumber(ARGV[4]) then return 'limited' end
if redis.call('HLEN', KEYS[1]) >= tonumber(ARGV[6]) then return 'full' end
if ARGV[8] ~= '' and redis.call('HEXISTS',KEYS[3],ARGV[8]) == 1 then return 'conflict' end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
if ARGV[8] ~= '' then redis.call('HSET',KEYS[3],ARGV[8],ARGV[1]) end
if tonumber(ARGV[7]) > 0 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[7])) end
return 'saved'
`;

function send(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(status).json(body);
}

function normalized(value, max, singleLine = false) {
  if (typeof value !== "string" || value.length > max) throw new Error("invalid");
  const clean = value.normalize("NFC").trim();
  if (clean.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(clean)) {
    throw new Error("invalid");
  }
  return singleLine ? clean.replace(/\s+/gu, " ") : clean;
}

function parse(body) {
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (typeof body === "string") {
    if (Buffer.byteLength(body, "utf8") > MAX_BODY) throw new RangeError();
    body = JSON.parse(body);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid");
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_BODY) throw new RangeError();
  const allowed = new Set(["submissionId", "guestName", "attendance", "companions", "diet", "message", "companionName", "editToken"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new Error("invalid");
  const { submissionId, attendance } = body;
  if (typeof submissionId !== "string" || !ID.test(submissionId)) throw new Error("invalid");
  if (attendance !== "sim" && attendance !== "nao") throw new Error("invalid");
  const guestName = normalized(body.guestName, 120, true);
  if (guestName.length < 2) throw new Error("invalid");
  const num = body.companions ?? "0";
  if (typeof num !== "string" || !/^[0-3]$/.test(num)) throw new Error("invalid");
  const diet = normalized(body.diet ?? "", 200, true);
  const message = normalized(body.message ?? "", 1000);
  const entry = { submissionId: submissionId.toLowerCase(), guestName, attendance,
    companions: attendance === "sim" ? Number(num) : 0, diet: attendance === "sim" ? diet : "", message };
  // Old browsers may still send the former selector. Preserve its payload/fingerprint.
  if (Object.hasOwn(body, "companionName")) {
    const name = normalized(body.companionName, 120, true);
    if (attendance !== "sim" || num !== "1" || name.length < 2) throw new Error("invalid");
    entry.companionName = name;
  }
  let editHash = "";
  if (Object.hasOwn(body, "editToken")) {
    editHash = tokenDigest(body.editToken);
    if (!editHash || (attendance === "sim" && (entry.companions > 1 ||
      (entry.companions === 1 && !entry.companionName)))) throw new Error("invalid");
  }
  return {entry,editHash};
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { ok: false });
  }

  const headers = req.headers || {};
  const origin = typeof headers.origin === "string" ? headers.origin : "";
  if ((origin && origin !== "https://" + headers.host) || headers["sec-fetch-site"] === "cross-site") {
    return send(res, 403, { ok: false });
  }
  if (!/^application\/json(?:\s*;.*)?$/i.test(String(headers["content-type"] || ""))) {
    return send(res, 415, { ok: false });
  }
  if (Number(headers["content-length"]) > MAX_BODY) return send(res, 413, { ok: false });

  let entry, editHash;
  try {
    ({entry,editHash}=parse(req.body));
  } catch (error) {
    return send(res, error instanceof RangeError ? 413 : 400, { ok: false });
  }

  try {
    const url = new URL(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "");
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !token) {
      return send(res, 503, { ok: false });
    }
    const mode = process.env.VERCEL_ENV;
    if (mode !== "production" && mode !== "preview") return send(res, 503, { ok: false });
    if (editHash && (mode !== "production" || !canonicalRequest(req))) {
      return send(res, 403, { ok: false });
    }
    const prefix = mode === "production" ? PREFIX : "dc:rsvp:preview:v1:{preview}";
    const inputIp = String(headers["x-vercel-forwarded-for"] || "").split(",")[0].trim();
    const network = isIP(inputIp) ? inputIp : "unclassified";
    const rateHash = createHmac("sha256", token).update("dc-rsvp-rate:" + network).digest("hex");
    const { submissionId, ...values } = entry;
    const fingerprint = createHash("sha256").update(JSON.stringify(values)).digest("hex");
    const headcount = values.attendance === "sim" ? 1 + values.companions : 0;
    const now = Date.now();
    const record = { ...values, headcount, receivedAt: new Date(now).toISOString(), fingerprint,
      ...(editHash ? {editHash, version:1, editExpiresAt:now + EDIT_TOKEN_LIFETIME_MS} : {}) };
    const result = await fetch(url.toString(), {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(["EVAL", SAVE, 3, prefix + ":records", prefix + ":rate:" + rateHash, prefix + ":edit-index",
        submissionId, fingerprint, JSON.stringify(record), String(PER_NETWORK),
        String(WINDOW_SECONDS), String(MAX_RECORDS), mode === "preview" ? "3600" : "0", editHash]),
      redirect: "error",
      signal: AbortSignal.timeout(7500),
    });
    if (!result.ok) return send(res, 503, { ok: false });
    const data = await result.json();
    if (data.error) return send(res, 503, { ok: false });
    if (data.result === "saved" || data.result === "duplicate") return send(res, 200, editHash ? { ok: true, editable: true } : { ok: true });
    if (data.result === "conflict") return send(res, 409, { ok: false });
    if (data.result === "limited") {
      res.setHeader("Retry-After", String(WINDOW_SECONDS));
      return send(res, 429, { ok: false });
    }
    return send(res, 503, { ok: false });
  } catch {
    return send(res, 503, { ok: false });
  }
};
