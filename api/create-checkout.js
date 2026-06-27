const INFINITEPAY_API_URL = "https://api.checkout.infinitepay.io/links";
const ALLOWED_HANDLE = "caio-capuzzo";

const sendJson = (res, statusCode, body) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};

const readBody = async (req) => {
  if (req.body && typeof req.body === "object") return req.body;

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
};

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Metodo nao permitido." });
    return;
  }

  try {
    const payload = await readBody(req);

    if (payload.handle !== ALLOWED_HANDLE) {
      sendJson(res, 400, { error: "InfiniteTag invalida para este site." });
      return;
    }

    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      sendJson(res, 400, { error: "Carrinho vazio." });
      return;
    }

    const response = await fetch(INFINITEPAY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    sendJson(res, response.status, data);
  } catch (error) {
    sendJson(res, 500, {
      error: "Nao foi possivel criar o checkout.",
      message: error instanceof Error ? error.message : "Erro inesperado."
    });
  }
};
