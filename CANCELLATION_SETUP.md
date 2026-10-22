# Online cancellation setup

The public page is `/cancel.html`, linked as **Cancel contract here** in all customer-page footers. It supports full and partial order notices without a login or reason, a review step and **Confirm cancellation**. Email and post remain alternatives. No order-status or time-window check rejects a notice: delivery dates and entitlement need assessment by the merchant.

## Before opening the form

The existing private D1 `DB` binding stores notices in the `cancellation_notices` table, created automatically on first use. No changes to order status, stock or payments are made. The Cloudflare Access-protected dashboard lists the latest 100 notices and has a button to retry unsent acknowledgements. Keep that Access protection in place.

The implementation uses Resend's transactional email API. Add to the existing Cloudflare Pages production environment:

- `RESEND_API_KEY`: an encrypted, sending-only API secret. Enter it directly in Cloudflare, never in source or chat.
- `CANCELLATION_FROM`: an email sender on a domain verified in that Resend account, e.g. `MaeLinne <returns@mailer.maelinne.ie>`. This is an example, not a configured address.

Verify the sending domain in the provider and redeploy to apply the variables. Do not open live payments until the cancellation process and acknowledgement delivery have been checked. GET `/api/cancellations` returns only `{enabled: true/false}`, no credentials. With missing configuration the form clearly directs customers to email/post instead and does not falsely accept an online submission.

Email goes to the customer's supplied acknowledgement email and a separate operational notification goes to `maelinnestore@gmail.com`. Both contain the statement and original UTC submission timestamp. Resend accepting an email is not proof it arrived: test actual delivery, monitor bounces/provider logs and check the dashboard daily. If email fails after a notice was saved, the page acknowledges receipt, offers a downloadable copy, and the dashboard flags the email for prompt retry/manual acknowledgement. Do not ask the customer to submit a new cancellation; the original notice remains effective when received.

## Verification

Run `python3 tests/test_cancellations.py` on macOS (JavaScriptCore + sqlite, no third-party packages). It exercises the actual server code with simulated mail and SQLite: invalid/cross-origin requests, unavailable setup, repeated submissions, conflict detection, rate limiting, persistence through mail failures and acknowledgement retries. It never contacts a provider or modifies live data.

On a preview with isolated data and the owner's approved test mailbox, confirm two-step submission, inbox delivery, download, private dashboard visibility, and mobile layout. Keep provider keys out of screenshots and logs. A real email test needs an approved recipient; the automated tests alone do not verify inbox delivery.

## Privacy and operations

Notices contain customer contact/order details. They are readable only through the authenticated admin API; the public endpoint cannot list or retrieve saved notices. Do not publish exports or expose D1. Include this processing and transactional email provider in the business privacy information and retention arrangements. IP addresses are stored only as a keyed hash for a short-window abuse check; notice records still need normal business retention management. Review pending notices promptly and handle refunds in Stripe according to the returns terms. The form does not automatically issue refunds or reinstate inventory.
