"use strict";
const {createHash}=require("node:crypto");
const CANONICAL_ORIGIN="https://daniecaio.vercel.app";
const PREFIX="dc:rsvp:v1:{responses}";
const EDIT_TOKEN_LIFETIME_MS=2*365*24*60*60*1000;
const editTokenPattern=/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
function tokenDigest(token) {
  if(typeof token!=="string" || !editTokenPattern.test(token)) return null;
  return createHash("sha256").update("dc-rsvp-edit-v1:").update(token).digest("hex");
}
function canonicalRequest(req) {
  const h=req.headers||{};
  return h.host===new URL(CANONICAL_ORIGIN).host && h.origin===CANONICAL_ORIGIN &&
    !["cross-site","same-site"].includes(h["sec-fetch-site"]);
}
module.exports={PREFIX,EDIT_TOKEN_LIFETIME_MS,tokenDigest,canonicalRequest};
