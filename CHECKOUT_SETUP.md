# Stripe checkout setup

The checkout implementation is prepared for testing. It is not activated in production. A missing key, webhook secret, database migration or checkout mode keeps payments disabled.

## Agreed behaviour

- WELCOME10: 10% off items.
- VIP40: 40% off items; distribute to Julia's friends. Possession of the code permits use; it is not an email allowlist. Neither code currently expires or has a redemption cap. Codes do not combine.
- Ireland (IE) deliveries only. Delivery is €5, free at an item total of €40 or more **after discounts**.
- Prices and stock come from D1. Browser prices and totals are never authoritative.
- Apply the code in the MaeLinne bag before opening Stripe. The Stripe line prices already include the discount; the selected code is also recorded with the order.
- Only immediate card payments are enabled. Stripe may display eligible card wallets. No delayed payment methods.

## Connect a test environment

1. Create the Stripe account and stay in its sandbox/test environment. Use the real business details when completing account activation yourself. Do not put passwords or keys in chat or GitHub.
2. In Cloudflare Pages, set up the checkout preview's **DB** binding to an isolated D1 database with synthetic products and stock. Do not point test checkout at production inventory: successful test payments exercise stock deduction.
3. Apply `migrations/0001_shop.sql` to a new database, followed once by `migrations/0002_checkout.sql`. For an existing database with the first schema, apply only 0002. Keep the existing R2 **IMAGES** binding for gallery metadata. Never re-run the ALTER statements after they have been applied.
4. In Stripe, add a webhook endpoint for `https://<preview-host>/api/stripe-webhook`, subscribing to `checkout.session.completed` and `checkout.session.expired`.
5. In the **preview** environment's Cloudflare Pages Variables and Secrets, add:
   - `STRIPE_SECRET_KEY` as an encrypted secret containing the sandbox `sk_test_…` key.
   - `STRIPE_WEBHOOK_SECRET` as an encrypted secret containing that endpoint's `whsec_…` signing secret.
   - `CHECKOUT_MODE` as the text value `test`.
6. Redeploy the preview so its bindings and secrets take effect. `/api/checkout/config` returns `enabled: true, test_mode: true` when the required configuration and schema are present.
7. Browse a synthetic published product, add its size to the bag, apply each code, and check postage below and above €40 after the discount. Complete a Stripe test payment with its documented test card, not real card details.
8. Confirm the test order appears in the admin dashboard marked TEST, with its item quantities, discount and delivery charge, and the stock is deducted exactly once. Replay the webhook. Check cancellation and expiry restore availability without changing total inventory.
9. Enable Stripe customer email receipts in the appropriate environment and test their delivery. The website records the order and delivery address; it does not send its own confirmation email.

## Production release

Complete a real Stripe sandbox end-to-end test and a browser layout review before merging. The automated harness uses simulated Stripe responses and a real SQLite database; it does not replace a Stripe sandbox payment.

Apply migration 0002 once to the production D1 database and retain the existing admin Access protection. Configure a production Stripe webhook endpoint for `https://www.maelinne.ie/api/stripe-webhook`. Add encrypted **live** keys only to production, `CHECKOUT_MODE=live`, and `CHECKOUT_LIVE_APPROVED=true` only after the owner explicitly approves opening payments. Live checkout only works on `www.maelinne.ie`.

Confirm customer receipt emails, the delivery/returns information and the account's business settings are ready before enabling payments. Update the existing “checkout coming soon” announcements as part of that release. The Stripe account owner completes any terms acceptance and account verification.

## Inventory and operations

A D1 transaction creates an order and stock holds. SQL triggers reject overselling and prevent admin quantities from dropping below held stock. Stripe sessions are given a 31-minute expiry. A signed webhook, a verified return-page request or a later checkout visit reconciles paid/expired sessions. Browser cancellation calls Stripe to expire the session before releasing its hold.

Ambiguous network failures retain the hold and retry the exact Stripe request with the same idempotency key. An explicit provider rejection before session creation releases the hold. If an unresolved provider failure remains beyond Stripe's idempotency retention, review the pending order in D1 against Stripe before releasing it manually. Never release a hold solely because its local expiry time passed.

Refunds are handled in Stripe for this version. The integration does not automatically restock a refunded or returned item or synchronise refund status. Do not dispatch TEST orders. Dashboard order details include the purchased size/SKU and delivery address.

## Local verification

`python3 tests/test_checkout.py` from the repository directory exercises the actual JS checkout handlers, real SQLite schema/transactions and HMAC verification through a macOS JavaScriptCore test adapter. The adapter simulates Stripe and Web APIs; it never contacts Stripe or touches the live inventory.
