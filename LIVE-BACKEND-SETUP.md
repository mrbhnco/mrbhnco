# Live store/admin backend setup

Backend endpoints committed:
- `/api/catalog` — reads shared state; writes require the `x-admin-token` header.
- `/api/webhook` — verifies Stripe webhook signatures and stores events idempotently.

## Before this can run live
1. Create a Supabase project.
2. Run `supabase-schema.sql` in the Supabase SQL Editor.
3. In Vercel → Project → Settings → Environment Variables, add these to Production (and Preview if needed):
   - `SUPABASE_URL` — project URL
   - `SUPABASE_SERVICE_ROLE_KEY` — secret service-role key; server-side only, never in browser code
   - `ADMIN_SYNC_TOKEN` — a long random secret for admin write requests
   - `STRIPE_WEBHOOK_SECRET` — Stripe endpoint signing secret, when Stripe is ready
4. Redeploy after setting variables.
5. In Stripe, register `https://YOUR-PRODUCTION-DOMAIN/api/webhook` as the webhook URL and select the checkout/payment events you need.

## Important current limitation
These endpoints are the backend foundation; the existing static storefront and admin UI have not yet been switched over to read/write this API. Do not treat the store as live-sync or payments as live until that UI integration is completed and tested. The store currently contains demo checkout behavior.
