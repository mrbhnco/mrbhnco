// Stripe webhook endpoint. Configure STRIPE_WEBHOOK_SECRET and Supabase env vars in Vercel.
// Create table store_webhook_events (event_id text primary key, event_type text, payload jsonb, received_at timestamptz default now()).
import crypto from "node:crypto";

function verifyStripeSignature(rawBody, header, secret) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map(p => p.split("=", 2)));
  const timestamp = parts.t;
  if (!timestamp || !parts.v1 || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const signed = timestamp + "." + rawBody;
  const digest = crypto.createHmac("sha256", secret).update(signed).digest("hex");
  const a = Buffer.from(digest, "hex"), b = Buffer.from(parts.v1, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export const config = { api: { bodyParser: false } };
async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).end("Method not allowed"); }
  if (!process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).json({ received: false, error: "Webhook secret is not configured." });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ received: false, error: "Shared database is not configured." });
  }
  const raw = await readRawBody(req);
  if (!verifyStripeSignature(raw, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET)) {
    return res.status(400).json({ received: false, error: "Invalid Stripe signature." });
  }
  let event;
  try { event = JSON.parse(raw); } catch { return res.status(400).json({ received: false, error: "Invalid JSON." }); }
  try {
    const r = await fetch(process.env.SUPABASE_URL + "/rest/v1/store_webhook_events?on_conflict=event_id", {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal"
      },
      body: JSON.stringify({ event_id: event.id, event_type: event.type, payload: event })
    });
    if (!r.ok) return res.status(502).json({ received: false, error: "Could not persist event." });
    return res.status(200).json({ received: true });
  } catch { return res.status(502).json({ received: false, error: "Database unavailable." }); }
}
