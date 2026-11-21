"use strict";
const { checkoutConfigured, readBody, reply, eventKeys, confirm } = require("./_gift-ledger");
module.exports = async (req,res) => {
  const config = checkoutConfigured(req);
  if (!config) return reply(res,404,{error:"indisponivel"});
  if (req.method !== "POST") { res.setHeader("Allow","POST"); return reply(res,405,{error:"metodo"}); }
  if (!/^application\/json(?:\s*;.*)?$/i.test(req.headers?.["content-type"] || "")) return reply(res,400,{error:"entrada"});
  let body;
  try { body = await readBody(req,24000); } catch { return reply(res,400,{error:"entrada"}); }
  const event = eventKeys(body,"invoice_slug");
  if (!event) return reply(res,400,{error:"entrada"});
  try {
    const result = await confirm(config,event);
    return result === "retry" ? reply(res,503,{ok:false}) : reply(res,200,{ok:true});
  } catch { return reply(res,503,{ok:false}); }
};
