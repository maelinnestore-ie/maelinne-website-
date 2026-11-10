# MaeLinne Team Studio: secure setup

The existing local Content Studio at /studio/ is still browser-only. The new shared version is at /studio/team.html.

## Security first
**Do not upload private material until these steps are complete.** The team page and API currently fail closed without Cloudflare Access settings. The local /studio/ page is NOT private and remains a separate tool. Do not assume a non-indexed page is access controlled.

## 1. Check Cloudflare Pages
Open Cloudflare > Workers & Pages > your MaeLinne Pages project > Settings.
The existing shop uses Pages Functions, a D1 binding named DB and R2 binding named IMAGES. Reuse those bindings. Check that Production (and Preview, if used) has both. The studio API has separate tables and uses image keys prefixed studio-private/, so they are not exposed by the shop image endpoint.

## 2. Protect BOTH URL areas with Cloudflare Access
In Cloudflare Zero Trust > Access > Applications, create Self-hosted applications:
- app A: maelinne.ie/studio/* (the Studio UI)
- app B: maelinne.ie/api/studio/* (the Studio API)
Use the actual host serving the site (www.maelinne.ie if the canonical address redirects to www). Protect both forms if both are usable without redirects.

For each app, use an Allow policy for ONLY the two adult-managed, approved email identities. Require email one-time PIN or another supported identity provider. If Julia has a separate account, supervise it and include only her approved email. Do not use Everyone, Bypass, or an open email domain policy. Limit duration to a sensible session length.
The API app will have an Application Audience (AUD) tag. Copy **the API app** AUD.

Important: Be sure the Access policy really protects both paths before using the page. An unprotected page only hides the interface; the API authorization remains the security boundary.

## 3. Set production Pages environment variables
Add these **plain environment variables** in Cloudflare Pages > Settings > Variables and Secrets (use the UI appropriate to your current Cloudflare version):
- ACCESS_TEAM_DOMAIN: your actual team domain, e.g. yourteam.cloudflareaccess.com (NO https://)
- STUDIO_ACCESS_AUD: the API application's Audience (AUD), not the Studio UI application's AUD
- STUDIO_ALLOWED_EMAILS: the two exact email addresses separated by a comma, with no extra recipients

Do NOT put these values in public JavaScript or GitHub files. Avoid screenshots showing secret keys. The AUD and email allowlist are configuration, not a substitute for the Access policy.

Redeploy the Pages project after binding and variable changes.

## 4. Open and test
- Open https://www.maelinne.ie/studio/team.html in a private browser window. You should be challenged by Cloudflare Access.
- Sign in with an allowed account. The UI should show the signed-in email and shared content plans.
- Create a test post. On the other permitted account/device, open and refresh to see the same post.
- Upload a harmless test image and verify it appears only while authenticated.
- Open /api/studio/status logged out in a private browser window: you should get an Access challenge or a 403 response, NEVER a successful JSON response.
- Test a non-allowlisted identity: it must not get into the Studio.
- Do not add a public site navigation link to the private area.

## 5. Existing browser-local content
Existing ideas saved at /studio/ do NOT migrate automatically. They are still in that browser's localStorage. Download a backup there first. Add the important ideas manually in the shared team area. Do not delete browser data until you confirm the shared posts.

## Storage details and limits
- Shared posts saved to D1 table studio_posts.
- Uploaded images saved to the existing R2 bucket with studio-private/ prefix, metadata in D1 studio_assets.
- Images only permit JPG, PNG or WebP up to 5 MB. Video uploads are NOT included.
- Uploaded images are viewed through authenticated /api/studio/assets/<id>/image.
- Existing shop /api/images/[key] allows only plain UUID filenames and cannot access studio-private/ paths.
- This version does not automatically publish to Instagram, TikTok or Pinterest, and does not yet attach image IDs to specific posts; use the notes field to refer to image filenames.
- Refresh to see someone else's edits. Simultaneous overwrites are blocked by modified timestamp checks, but this is not a real-time multi-user editor.
- Cloudflare service pricing/quotas depend on the current account and bindings.

## Troubleshooting
- 403 at /api/studio/status: Access variables missing/mismatched, no valid API JWT, or email not in the allowlist.
- 503: DB binding missing.
- Upload reports image storage unavailable: IMAGES R2 binding missing.
- 500 on read/write: check D1 table creation permissions and Cloudflare Pages Functions logs.
- If Access login happens on the studio UI but API returns 403, check the second API Access application and its AUD.
- If Cloudflare does not recognize the wildcard URL path exactly, set up and test the path expression with Cloudflare's supported application configuration. Never weaken the API authorization to make it work.

## Safety note
The Access JWT verifier checks algorithm, issuer, audience, expiry, not-before, email allowlist and the signature against your Cloudflare Access public keys. Cloudflare Access remains the recommended perimeter protection for the web interface.
