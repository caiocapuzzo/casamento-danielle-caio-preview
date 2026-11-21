"use strict";
const { createHmac } = require("node:crypto");
const { isIP } = require("node:net");
const {PREFIX,tokenDigest,canonicalRequest}=require("./_rsvp-edit-contract");
const MAX_BODY=2048, WINDOW_SECONDS=300;
const CHANGE = `-- rsvp_edit_lookup_update
local network = redis.call('INCR',KEYS[3])
if network == 1 then redis.call('EXPIRE',KEYS[3],tonumber(ARGV[9])) end
if network > 60 then return {'limited'} end
local all = redis.call('INCR',KEYS[4])
if all == 1 then redis.call('EXPIRE',KEYS[4],tonumber(ARGV[9])) end
if all > 450 then return {'limited'} end
local id = redis.call('HGET',KEYS[2],ARGV[1])
if not id then return {'missing'} end
local raw = redis.call('HGET',KEYS[1],id)
if not raw then return {'missing'} end
local row = cjson.decode(raw)
if row.editHash ~= ARGV[1] or type(row.version) ~= 'number' or
   type(row.editExpiresAt) ~= 'number' or row.editExpiresAt < tonumber(ARGV[3]) then
  return {'missing'}
end
local function answer(code)
  return {code,row.version,row.attendance,row.companions,row.companionName or ''}
end
if ARGV[2] == 'load' then return answer('ok') end
local prior = tonumber(ARGV[4])
local wanted = tonumber(ARGV[6])
local currentCompanionName = row.companionName or ''
if prior ~= row.version then
  if row.version == prior + 1 and row.attendance == ARGV[5] and
    row.companions == wanted and currentCompanionName == ARGV[7] then
    return answer('ok')
  end
  return answer('conflict')
end
if row.version >= 999 or (row.attendance == ARGV[5] and
  row.companions == wanted and currentCompanionName == ARGV[7]) then
  if row.version >= 999 then return {'limited'} end
  return answer('ok')
end
row.attendance = ARGV[5]
row.companions = wanted
if wanted == 1 then row.companionName = ARGV[7] else row.companionName = nil end
row.headcount = row.attendance == 'sim' and 1 + wanted or 0
row.savedAt = ARGV[8]
row.version = row.version + 1
redis.call('HSET',KEYS[1],id,cjson.encode(row))
return answer('ok')
`;
function send(res,status,body) {
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","private, no-store, max-age=0");
  res.setHeader("X-Robots-Tag","noindex, nofollow, noarchive");
  res.setHeader("Referrer-Policy","no-referrer");
  res.setHeader("X-Content-Type-Options","nosniff");
  return res.status(status).json(body);
}
function input(body) {
  if (Buffer.isBuffer(body)) body=body.toString("utf8");
  if(typeof body==="string") {
    if(Buffer.byteLength(body,"utf8")>MAX_BODY) throw new RangeError();
    body=JSON.parse(body);
  }
  if(!body || typeof body!=="object" || Array.isArray(body)) throw new Error("invalid");
  if(Buffer.byteLength(JSON.stringify(body),"utf8")>MAX_BODY) throw new RangeError();
  const digest=tokenDigest(body.editToken);
  const action=body.action;
  if(!digest || (action!=="load" && action!=="update")) throw new Error("invalid");
  const allowed=action==="load"?["action","editToken"]:["action","editToken","version","attendance","companions","companionName"];
  if(Object.keys(body).some(k=>!allowed.includes(k))) throw new Error("invalid");
  if(action==="load") return {digest,action,version:0,attendance:"",companions:0,name:""};
  const {version,attendance,companions}=body;
  if(!Number.isSafeInteger(version) || version<1 || version>999 ||
     !["sim","nao"].includes(attendance) || ![0,1].includes(companions) ||
     (attendance==="nao" && companions!==0)) throw new Error("invalid");
  const raw=body.companionName??"";
  if(typeof raw!=="string" || raw.length>120 || /[\p{Cc}\p{Cf}]/u.test(raw)) throw new Error("invalid");
  const name=raw.normalize("NFC").trim().replace(/\s+/gu," ");
  if(name.length>120 || (companions===0 && name) || (companions===1 && name.length<2)) throw new Error("invalid");
  return {digest,action,version,attendance,companions,name};
}
module.exports=async (req,res)=>{
  if(req.method!=="POST") {
    res.setHeader("Allow","POST");
    return send(res,405,{ok:false,error:"method"});
  }
  if(process.env.VERCEL_ENV!=="production" || !canonicalRequest(req)) return send(res,403,{ok:false,error:"origin"});
  // Capabilities are accepted only in JSON, never in a URL or query string.
  if(typeof req.url==="string" && /[?#]/.test(req.url)) return send(res,400,{ok:false,error:"invalid"});
  const headers=req.headers||{};
  if(!/^application\/json(?:\s*;.*)?$/i.test(String(headers["content-type"]||""))) return send(res,415,{ok:false,error:"invalid"});
  if(Number(headers["content-length"])>MAX_BODY) return send(res,413,{ok:false,error:"invalid"});
  let data;
  try { data=input(req.body); } catch(error) { return send(res,error instanceof RangeError?413:400,{ok:false,error:"invalid"}); }
  try {
    const url=new URL(process.env.UPSTASH_REDIS_REST_URL||process.env.KV_REST_API_URL||"");
    const token=process.env.UPSTASH_REDIS_REST_TOKEN||process.env.KV_REST_API_TOKEN;
    if(url.protocol!=="https:" || url.username || url.password || url.search || url.hash || !token) throw new Error("storage");
    const ip=String(headers["x-vercel-forwarded-for"]||"").split(",")[0].trim();
    const net=createHmac("sha256",token).update("dc-rsvp-edit-rate:"+(isIP(ip)?ip:"unclassified")).digest("hex");
    const now=Date.now();
    const result=await fetch(url.toString(),{
      method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
      body:JSON.stringify(["EVAL",CHANGE,4,PREFIX+":records",PREFIX+":edit-index",PREFIX+":edit-rate:"+net,PREFIX+":edit-global",
        data.digest,data.action,String(now),String(data.version),data.attendance,String(data.companions),data.name,new Date(now).toISOString(),String(WINDOW_SECONDS)]),
      redirect:"error",signal:AbortSignal.timeout(5000),
    });
    if(!result.ok) throw new Error("storage");
    const body=await result.json();
    if(body.error || !Array.isArray(body.result)) throw new Error("storage");
    const [status,version,attendance,companions,name]=body.result;
    if(status==="missing") return send(res,404,{ok:false,error:"not_found"});
    if(status==="limited") {
      res.setHeader("Retry-After",String(WINDOW_SECONDS));
      return send(res,429,{ok:false,error:"rate_limited"});
    }
    if((status!=="ok" && status!=="conflict") || !Number.isInteger(version) ||
       !["sim","nao"].includes(attendance) || ![0,1].includes(companions) || typeof name!=="string") throw new Error("storage");
    return send(res,status==="ok"?200:409,{
      ok:status==="ok",...(status==="conflict"?{error:"conflict"}:{}),version,
      response:{attendance,companions,companionName:name},
    });
  } catch { return send(res,503,{ok:false,error:"unavailable"}); }
};
