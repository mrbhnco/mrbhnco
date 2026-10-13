// Shared store/admin state API. Configure SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// and ADMIN_SYNC_TOKEN in Vercel before enabling writes.
// Supabase table: store_state (id text primary key, data jsonb not null, updated_at timestamptz default now()).
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(503).json({ ok: false, configured: false, error: "Shared database is not configured yet." });
    }
    try {
      const r = await fetch(process.env.SUPABASE_URL + "/rest/v1/store_state?id=eq=main&select=data", {
        headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY }
      });
      if (!r.ok) return res.status(502).json({ ok: false, error: "Database read failed." });
      const rows = await r.json();
      return res.status(200).json({ ok: true, configured: true, data: rows[0]?.data ?? null });
    } catch { return res.status(502).json({ ok: false, error: "Database unavailable." }); }
  }
  if (req.method !== "PUT") {
    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "Method not allowed." });
  }
  const expected = process.env.ADMIN_SYNC_TOKEN;
  if (!expected) return res.status(503).json({ ok: false, configured: false, error: "Admin sync token is not configured." });
  if (req.headers["x-admin-token"] !== expected) return res.status(401).json({ ok: false, error: "Unauthorized." });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ ok: false, configured: false, error: "Shared database is not configured yet." });
  }
  const data = req.body?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return res.status(400).json({ error: "Expected a data object." });
  try {
    const r = await fetch(process.env.SUPABASE_URL + "/rest/v1/store_state?on_conflict=id", {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify({ id: "main", data, updated_at: new Date().toISOString() })
    });
    if (!r.ok) return res.status(502).json({ ok: false, error: "Database write failed." });
    return res.status(200).json({ ok: true, saved: true });
  } catch { return res.status(502).json({ ok: false, error: "Database unavailable." }); }
}
