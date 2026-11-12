"use strict";
const C = require("./_common");

module.exports = async (req, res) => {
  if (req.method !== "GET") return C.send(res, 405, { error: "Método não permitido." });
  const query = String(req.query?.q || "").trim().slice(0, 90);
  if (query.length < 3) return C.send(res, 200, { tracks: [] });
  try {
    await C.rateLimit(req, "search", 120, 600);
    const data = await C.spotifyApi("/search?" + new URLSearchParams({
      q: query, type: "track", limit: "8", market: "BR"
    }));
    const tracks = (data.tracks?.items || [])
      .filter(item => item && item.id && item.type === "track")
      .map(item => ({
        id: item.id,
        name: item.name,
        artist: (item.artists || []).map(x => x.name).join(", "),
        album: item.album?.name || "",
        image: item.album?.images?.[1]?.url || item.album?.images?.[0]?.url || "",
        spotifyUrl: item.external_urls?.spotify || ""
      }));
    return C.send(res, 200, { tracks });
  } catch (e) { C.fail(res, e); }
};
