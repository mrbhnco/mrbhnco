// GitHub-backed shared catalog. No Supabase required.
// Configure GITHUB_TOKEN (repo contents write access) and ADMIN_PASSWORD in Vercel.
// ADMIN_SYNC_TOKEN is still accepted as an admin credential for backward compatibility.
import crypto from "node:crypto";
const OWNER = "mrbhnco";
const REPO = "mrbhnco";
const PATH = "catalog.json";
async function githubRequest(method, body) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not configured in Vercel.");
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json"
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || ("GitHub API failed (" + r.status + ")"));
  return data;
}
// Constant-time compare of the x-admin-token header against ADMIN_PASSWORD or ADMIN_SYNC_TOKEN.
function adminConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD || process.env.ADMIN_SYNC_TOKEN);
}
function safeEqual(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
function isAdmin(req) {
  const supplied = req.headers["x-admin-token"];
  if (typeof supplied !== "string" || !supplied) return false;
  let ok = false;
  for (const expected of [process.env.ADMIN_PASSWORD, process.env.ADMIN_SYNC_TOKEN]) {
    if (expected && safeEqual(supplied, expected)) ok = true;
  }
  return ok;
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method === "GET") {
    // With an x-admin-token header this doubles as the admin login check.
    const hasToken = Boolean(req.headers["x-admin-token"]);
    if (hasToken && !adminConfigured()) return res.status(503).json({ ok: false, error: "ADMIN_PASSWORD is not configured in Vercel." });
    if (hasToken && !isAdmin(req)) return res.status(401).json({ ok: false, error: "Admin password not recognized." });
    try {
      const file = await githubRequest("GET");
      const decoded = Buffer.from(file.content || "", "base64").toString("utf8");
      const data = JSON.parse(decoded);
      if (!hasToken && data && typeof data === "object") delete data.orders; // never expose orders publicly
      return res.status(200).json({ ok: true, configured: true, admin: hasToken, data, sha: file.sha });
    } catch (e) {
      const message = String(e.message || e);
      const status = message.includes("not configured") ? 503 : 502;
      return res.status(status).json({ ok: false, configured: false, error: message });
    }
  }
  if (req.method !== "PUT") {
    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "Method not allowed." });
  }
  if (!adminConfigured()) return res.status(503).json({ ok: false, error: "ADMIN_PASSWORD is not configured in Vercel." });
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "Admin password not recognized." });
  const data = req.body?.data;
  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.inventory)) {
    return res.status(400).json({ error: "Expected catalog data with an inventory array." });
  }
  try {
    const file = await githubRequest("GET");
    if (!Array.isArray(data.orders)) {
      // Keep existing orders if the admin page did not send them.
      try { const current = JSON.parse(Buffer.from(file.content || "", "base64").toString("utf8")); if (Array.isArray(current.orders)) data.orders = current.orders; } catch {}
    }
    const encoded = Buffer.from(JSON.stringify(data, null, 2) + "\n", "utf8").toString("base64");
    const saved = await githubRequest("PUT", {
      message: "Update store catalog from admin",
      content: encoded,
      sha: file.sha
    });
    return res.status(200).json({ ok: true, saved: true, commit: saved.commit?.sha || null });
  } catch (e) {
    const message = String(e.message || e);
    return res.status(message.includes("not configured") ? 503 : 502).json({ ok: false, error: message });
  }
}
