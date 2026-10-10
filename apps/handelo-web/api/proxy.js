import sharedHandler from "./[...path].js";

export const config = { api: { bodyParser: false, responseLimit: false } };

function reject(res, status, error) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify({ error }));
}

export default function handler(req, res) {
  const incoming = new URL(req.url || "/", "https://handelo.invalid");
  const target = incoming.searchParams.get("__route") || "";
  const segments = target.split("/");
  if (
    !target ||
    segments.some(segment => !segment || segment === "." || segment === ".." || !/^[A-Za-z0-9._-]+$/.test(segment))
  ) {
    return reject(res, 400, "Invalid routed API path.");
  }

  const query = new URLSearchParams(incoming.searchParams);
  query.delete("__route");
  const search = query.toString();
  req.url = "/api/" + segments.map(encodeURIComponent).join("/") + (search ? "?" + search : "");
  return sharedHandler(req, res);
}
