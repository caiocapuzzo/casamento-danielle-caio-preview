const createCheckout = require("../../api/create-checkout");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  const req = {
    method: event.httpMethod,
    body: event.body ? JSON.parse(event.body) : {}
  };

  let statusCode = 200;
  const responseHeaders = {};
  let body = "";

  const res = {
    setHeader(name, value) {
      responseHeaders[name] = value;
    },
    end(value = "") {
      body = value;
    },
    get statusCode() {
      return statusCode;
    },
    set statusCode(value) {
      statusCode = value;
    }
  };

  await createCheckout(req, res);

  return {
    statusCode,
    headers: { ...headers, ...responseHeaders },
    body
  };
};
