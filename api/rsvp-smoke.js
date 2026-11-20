"use strict";
const app = require("./rsvp");
const uid = "0e9efb9e-727e-4746-834e-4e6645ca7117";
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" || process.env.VERCEL_ENV !== "preview") return res.status(404).json({ok:false});
  const invoke = () => new Promise((resolve, reject) => app({method:"POST",headers:{"content-type":"application/json"},body:{
    submissionId:uid,guestName:"Verificação automática RSVP",attendance:"nao",companions:"0",diet:"",message:""
  }},{setHeader(){},status(code){ this.code=code;return this; },json(data){resolve({code:this.code, ok:data.ok===true});}}).catch(reject));
  try {
    const write = await invoke(), retry = await invoke();
    res.status(write.ok && retry.ok ? 200 : 503).json({checked:write.ok&&retry.ok,write:write.code,retry:retry.code});
  } catch { res.status(503).json({checked:false}); }
};