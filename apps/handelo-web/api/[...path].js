import sharedHandler from "../src/proxy-handler.js";

export const config = { api: { bodyParser: false, responseLimit: false } };

export default function handler(req, res) {
  return sharedHandler(req, res);
}
