"use strict";
// Calls to the InterviewMeet API from the main process. The bearer token is held here only; it is
// never given to the employer's page or to the workspace panel.
function createApi({ base, token, fetchImpl = globalThis.fetch }) {
  const root = String(base).replace(/\/+$/, "");
  async function call(method, path, body) {
    const headers = { "x-client": "app", authorization: `Bearer ${token}` };
    if (method !== "GET") headers["x-requested-with"] = "meet-practice";
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetchImpl(`${root}/api${path}`, {
      method, headers, credentials: "omit", body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch { /* an empty body */ }
    if (!res.ok) {
      const e = new Error((data && data.error && data.error.message) || `HTTP ${res.status}`);
      e.status = res.status;
      throw e;
    }
    return data;
  }
  return { get: (p) => call("GET", p), post: (p, b = {}) => call("POST", p, b), put: (p, b) => call("PUT", p, b) };
}
// the paths used elsewhere are written without the /api prefix; the executor posts to /autoapply/...
module.exports = { createApi };
