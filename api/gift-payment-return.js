"use strict";
const { origin, checkoutConfigured, eventKeys, confirm, reply } = require("./_gift-ledger");
module.exports = async (req,res) => {
  if (req.method !== "GET") { res.setHeader("Allow","GET"); return reply(res,405,{error:"metodo"}); }
  res.setHeader("Referrer-Policy","no-referrer");
  res.setHeader("Cache-Control","no-store");
  const c = checkoutConfigured(req);
  if (c && typeof req.url === "string" && req.url.length <= 4096) {
    try {
      const params = new URL(req.url,origin).searchParams;
      const fields = ["order_nsu","transaction_nsu","slug"];
      if (fields.every(field=>params.getAll(field).length===1)) {
        await confirm(c,eventKeys(Object.fromEntries(fields.map(field=>[field,params.get(field)])),"slug"));
      }
    } catch { /* Optional return is a secondary wake only; provider webhook retries independently. */ }
  }
  // Strip all provider query data before loading the existing analytics-enabled success page.
  res.statusCode = 303;
  res.setHeader("Location",origin+"/checkout-success.html");
  return res.end();
};
