# MaeLinne shop — development only
This is a **foundation**, not a live shop. Do not merge or announce checkout until payments, fulfillment, stock reservation, customer notifications and returns information have been implemented and tested.

## Current features
- Public `GET /api/products` returns only published, in-stock variant information.
- Admin dashboard at `/admin.html` (its HTML is public, but **all admin data and writes are protected server-side**).
- Admin can create draft products, add SKU-level sizes/colours, adjust stock, publish/unpublish, and see orders when they exist.
- D1 schema for products, variants, orders and order items.
- **No Stripe integration yet**, no customer-facing sale flow yet and no real orders accepted. The existing demo basket remains unchanged.

## Setup — Cloudflare dashboard
1. Create a D1 database named `maelinne-shop` in Cloudflare. Apply `migrations/0001_shop.sql` in D1's SQL console (or Wrangler).
2. In Workers & Pages → `maelinne-website` → Settings → Bindings, add a D1 binding with variable name **DB** pointing at that database. Configure the preview environment separately if appropriate.
3. Set up a **Cloudflare Zero Trust Access application** protecting `maelinne.ie/api/admin/*` (including any alternate production domain) and permit **only specific adult owner email accounts**; do not configure a public bypass. Repeat for preview domain if testing there. Also protect `/admin.html` for convenience. An unprotected dashboard HTML page has no private contents, but should still be gated for usability.
4. Access application must issue tokens with issuer `https://<team>.cloudflareaccess.com`. Add Pages environment variables `ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com` and `ACCESS_AUD=<application audience tag>`. These values are validated by the server. If either is missing, API refuses access.
5. Verify a non-authorized browser receives 403 for `/api/admin/products`; an authorized session works; a random forged JWT gets 403; and public `/api/products` returns only published records.
6. Use the Cloudflare **preview deployment** to test. Do not merge to main without a deliberate release decision.

## Critical next steps
- Decide on legal/business account owner and payment provider onboarding; Stripe must be owned/operated by an eligible adult.
- Add image upload to R2 or direct asset management. Dashboard currently accepts a path/HTTPS image URL but does not upload photos.
- Build secure checkout: server-calculated prices, atomic stock reservations, Stripe hosted Checkout, signed verified webhook, idempotent order creation/stock decrement, shipping, taxes and refunds.
- Add clear consumer-law pages, delivery/returns policy and GDPR-compliant personal data retention.
- Add order detail and fulfillment actions, alerting, backups, and automated tests.
- Never use localStorage for authoritative inventory/order/payment status, trust client-entered prices, or expose customer orders through public routes.
