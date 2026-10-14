// Create a secure Stripe Checkout Session. Prices are read server-side from catalog.json.
const OWNER = "mrbhnco";
const REPO = "mrbhnco";
const CATALOG_PATH = "catalog.json";
async function readCatalog() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Store catalog connection is not configured (GITHUB_TOKEN).");
  const r = await fetch("https://api.github.com/repos/" + OWNER + "/" + REPO + "/contents/" + CATALOG_PATH, { headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
  const file = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Could not load store prices from catalog.");
  return JSON.parse(Buffer.from(file.content || "", "base64").toString("utf8"));
}
function dollarsToCents(value) { const n = Number(value); if (!Number.isFinite(n) || n <= 0 || n > 100000) throw new Error("A product price needs to be checked by the store administrator."); return Math.round(n * 100); }
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed." }); }
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret || !secret.startsWith("sk_")) return res.status(503).json({ error: "Stripe is not configured. Add STRIPE_SECRET_KEY in Vercel Environment Variables, then redeploy." });
  try {
    const body = req.body || {};
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) return res.status(400).json({ error: "Your cart is empty or invalid." });
    const catalog = await readCatalog();
    const products = new Map((catalog.inventory || []).map(p => [String(p.id), p]));
    const lineItems = [];
    for (const item of body.items) {
      const product = products.get(String(item.productId || ""));
      const quantity = Number(item.quantity);
      if (!product || product.active === false) throw new Error("One of the products is unavailable. Refresh the store and try again.");
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error("A cart quantity is invalid.");
      const price = dollarsToCents(product.price);
      const variant = (product.variants || []).find(v => String(v.color) === String(item.color));
      if (Array.isArray(product.variants) && product.variants.length && !variant) throw new Error("That color is unavailable. Return to the store and choose it again.");
      if (variant && Number(variant.stock) < quantity) throw new Error("Not enough stock for " + product.name + " (" + item.color + ").");
      if (Number(product.stock) < quantity) throw new Error("Not enough stock for " + product.name + ".");
      const sizes = String(product.sizes || "").split(",").map(s => s.trim()).filter(Boolean);
      if (sizes.length && !sizes.includes(String(item.size))) throw new Error("Please choose a valid size for " + product.name + ".");
      lineItems.push({ name: product.name + " — " + item.color + " / " + item.size, amount: price, quantity });
    }
    const shipping = body.shippingMethod === "priority" ? { name: "Priority shipping", amount: 1099 } : { name: "Standard shipping", amount: 599 };
    lineItems.push({ name: shipping.name, amount: shipping.amount, quantity: 1 });
    const origin = req.headers.origin || ("https://" + req.headers.host);
    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("success_url", origin + "/?payment=success&session_id={CHECKOUT_SESSION_ID}");
    params.set("cancel_url", origin + "/?payment=cancelled");
    params.set("billing_address_collection", "required");
    params.set("shipping_address_collection[allowed_countries][0]", "US");
    params.set("phone_number_collection[enabled]", "true");
    lineItems.forEach((item, i) => {
      params.set("line_items[" + i + "][price_data][currency]", "usd");
      params.set("line_items[" + i + "][price_data][unit_amount]", String(item.amount));
      params.set("line_items[" + i + "][price_data][product_data][name]", item.name);
      params.set("line_items[" + i + "][quantity]", String(item.quantity));
    });
    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: "Bearer " + secret, "Content-Type": "application/x-www-form-urlencoded" }, body: params });
    const session = await stripeResponse.json().catch(() => ({}));
    if (!stripeResponse.ok) { console.error("Stripe Checkout session failed:", session.error && session.error.message); return res.status(502).json({ error: "Stripe could not start checkout. Check that the Stripe keys in Vercel are active and belong to the same mode." }); }
    return res.status(200).json({ url: session.url });
  } catch (error) { return res.status(400).json({ error: error.message || "Unable to start checkout." }); }
}
