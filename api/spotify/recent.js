"use strict";
const C = require("./_common");

module.exports = async (req, res) => {
  if (req.method !== "GET") return C.send(res, 405, { error: "Método não permitido." });
  try {
    await C.rateLimit(req, "recent", 60, 600);
    const items = await C.redis("LRANGE", "dc:spotify:suggestions", 0, 11);
    const suggestions = (items || []).map(item => {
      try { return JSON.parse(item); } catch { return null; }
    }).filter(Boolean).map(({ name, track, artist, at }) => ({ name, track, artist, at }));
    C.send(res, 200, { suggestions });
  } catch (e) { C.fail(res, e); }
};
