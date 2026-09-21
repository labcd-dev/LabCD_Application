# Stripe billing setup

This guide walks through everything needed in the **Stripe Dashboard** to turn on paid
subscriptions for LabCD's **Plus**, **Pro**, and **Business** plans. **Enterprise stays a
"Contact us" plan** — it is never sold through Stripe Checkout, so it needs no Stripe setup.

You do not need to write any code or touch the terminal to follow this guide. Everything
happens in your web browser, split between the [Stripe Dashboard](https://dashboard.stripe.com)
and LabCD's own **Admin panel**.

> **Test mode first.** Stripe has a "Test mode" toggle in the top-right of the Dashboard.
> Do this entire guide once in Test mode, confirm checkout works end-to-end, and only then
> repeat the Product/Price/webhook steps in Live mode (see [Going live](#8-going-live)).

---

## What you're setting up

| Plan       | Monthly  | Yearly  | Sold via Stripe? |
|------------|----------|---------|-------------------|
| Plus       | $14.90   | $149    | Yes |
| Pro (★ Most popular) | $149.90  | $1,499  | Yes |
| Business   | $349.90  | $3,499  | Yes |
| Enterprise | Custom   | Custom  | No — "Contact us" only |

That's **3 Products**, each with **2 Prices** (monthly + yearly) = **6 Prices** total.

---

## 1. Create a Stripe account (if you don't have one)

1. Go to <https://dashboard.stripe.com/register> and sign up.
2. You can complete business verification later — Test mode works immediately without it.

---

## 2. Create the Products and Prices

Repeat this for **Plus**, **Pro**, and **Business**. Do all three before moving on.

1. In the Dashboard, make sure **Test mode** is on (toggle, top-right).
2. Go to **Product catalog** → **+ Add product** (left sidebar: *Product catalog*, or
   <https://dashboard.stripe.com/test/products>).
3. Fill in:
   - **Name**: `LabCD Plus` (or `LabCD Pro` / `LabCD Business`)
   - **Description**: optional, e.g. "LabCD Plus subscription"
4. Under **Pricing**, add the **monthly** price first:
   - **Pricing model**: Standard pricing
   - **Price**: the monthly amount from the table above (e.g. `14.90`)
   - **Billing period**: Monthly
   - **Currency**: USD (or your currency — just be consistent across all plans)
5. Click **Add another price** (still on the same product) and add the **yearly** price:
   - **Price**: the yearly amount from the table above (e.g. `149.00`)
   - **Billing period**: Yearly
6. Click **Save product**.
7. On the product's page, you'll now see **two Prices** listed. For each price, click it and
   copy its **API ID** — it looks like `price_1PXXXXXXXXXXXXXXXXXXXXXX`. Also copy the
   **Product** API ID from the top of the page — it looks like `prod_XXXXXXXXXXXXXX`.
8. Write these down (or keep the tabs open) — you'll paste them into LabCD's Admin panel in
   [Step 5](#5-enter-the-price-ids-in-labcd).

Repeat steps 2–8 for all three plans. You should end up with:

- `LabCD Plus` → 1 product ID, 1 monthly price ID, 1 yearly price ID
- `LabCD Pro` → 1 product ID, 1 monthly price ID, 1 yearly price ID
- `LabCD Business` → 1 product ID, 1 monthly price ID, 1 yearly price ID

---

## 3. Get your API keys

1. Go to **Developers** → **API keys** (<https://dashboard.stripe.com/test/apikeys>).
2. Copy the **Publishable key** (starts with `pk_test_...`).
3. Click **Reveal test key** next to the **Secret key** (starts with `sk_test_...`) and copy it.
   Treat this like a password — never share it or commit it to source control.

You'll enter both in [Step 6](#6-enter-your-keys-in-labcd).

---

## 4. Set up the webhook endpoint

The webhook is how Stripe tells LabCD "this payment succeeded" or "this subscription was
canceled" in real time.

1. Go to **Developers** → **Webhooks** (<https://dashboard.stripe.com/test/webhooks>) →
   **+ Add endpoint**.
2. **Endpoint URL**: `https://YOUR-DOMAIN/api/v1/billing/webhook`
   - Replace `YOUR-DOMAIN` with your deployed API's public domain (the same host as
     `API_PUBLIC_URL` in your `.env`). For local development with the Stripe CLI, see the
     [Testing](#7-testing-in-stripe-test-mode) section instead — you don't need a public
     endpoint to test locally.
3. **Events to send** — click **Select events** and check exactly these four:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Click **Add endpoint**.
5. On the endpoint's page, click **Reveal** next to **Signing secret** and copy it (starts
   with `whsec_...`).

---

## 5. Enter the Price IDs in LabCD

1. Log into LabCD as an admin and go to **Admin → Plans**.
2. LabCD already has **Plus**, **Pro**, **Business**, and **Enterprise** rows pre-created for
   you (they're inactive-for-Checkout until you fill in the Stripe fields below — the
   pricing page only offers "Subscribe" once a plan has a price configured).
3. Click **Edit** on **Plus**. Scroll to the **"Pricing page & Stripe billing"** section and
   fill in:
   - **Stripe product ID**: the `prod_...` ID you copied for LabCD Plus
   - **Stripe monthly price ID**: the `price_...` ID for the monthly price
   - **Stripe yearly price ID**: the `price_...` ID for the yearly price
   - Leave **Contact-sales plan** unchecked.
4. Click **Save changes**.
5. Repeat for **Pro** (also check **"Show 'Most popular' badge"**) and **Business**.
6. You don't need to touch **Enterprise** — it's pre-configured as a contact-sales plan with
   no Stripe price, so it always shows a "Contact us" button instead of "Subscribe".

Once all three are filled in, visit LabCD's **Plans & billing** page (in the app sidebar) —
you should see all four plans with working "Subscribe" buttons on Plus/Pro/Business.

---

## 6. Enter your keys in LabCD

You have two options — **(A) is recommended** because it takes effect immediately without
restarting anything.

### Option A: Admin panel (recommended)

1. Go to **Admin → API keys** in LabCD.
2. Find **STRIPE_SECRET_KEY**, **STRIPE_PUBLISHABLE_KEY**, and **STRIPE_WEBHOOK_SECRET** in the
   list and paste in the values from Steps 3 and 4.
3. Save. Checkout and webhooks work immediately — no restart needed.

### Option B: Environment variables

Add these to your `.env` file (see `.env.example`) and restart the API:

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

> Values saved in the Admin panel (Option A) take priority at runtime and don't require a
> restart. Environment variables are a good fallback / initial value for fresh deployments.
> **Never commit real keys to source control** — `.env` is already git-ignored.

---

## 7. Testing in Stripe test mode

### Forwarding webhooks to your local machine

If you're developing locally (not yet deployed to a public domain), use the
[Stripe CLI](https://docs.stripe.com/stripe-cli) instead of a Dashboard webhook endpoint:

```bash
stripe login
stripe listen --forward-to localhost:8000/api/v1/billing/webhook
```

This prints a webhook signing secret (`whsec_...`) — use that one locally instead of the
Dashboard's, and paste it into **Admin → API keys → STRIPE_WEBHOOK_SECRET**.

### Test card numbers

Use these on the Stripe Checkout page (any future expiry date, any 3-digit CVC, any billing
ZIP):

| Card number           | Result |
|------------------------|--------|
| `4242 4242 4242 4242`  | Payment succeeds |
| `4000 0025 0000 3155`  | Requires 3D Secure authentication (test the "Authorize" prompt) |
| `4000 0000 0000 9995`  | Card is declined (insufficient funds) |
| `4000 0000 0000 0341`  | Payment succeeds, then the *next* invoice fails — good for testing `invoice.payment_failed` |

Full list: <https://docs.stripe.com/testing#cards>.

### End-to-end test checklist

1. Log into LabCD as a regular (non-admin) user.
2. Go to **Plans & billing**, pick **Plus**, click **Subscribe**.
3. Complete Checkout with `4242 4242 4242 4242`.
4. You should be redirected back to LabCD's Profile → Billing tab with a success message,
   and the user's plan should update within a few seconds (this is the
   `checkout.session.completed` webhook).
5. In the Stripe Dashboard, open the subscription you just created and cancel it. Confirm the
   user's plan reverts to the default plan in LabCD (this is `customer.subscription.deleted`).
6. As an admin, open **Admin → Users → (the test user) → Billing** and confirm you can see the
   Stripe customer ID, try **Sync from Stripe**, and try **Cancel at period end**.

---

## 8. Customer Portal settings (optional but recommended)

The Customer Portal is the page LabCD's "Manage billing" button (Profile → Billing) sends
users to, so they can update their card, view invoices, or cancel without contacting support.

1. Go to **Settings → Billing → Customer portal**
   (<https://dashboard.stripe.com/test/settings/billing/portal>).
2. Under **Functionality**, we recommend enabling:
   - **Update payment method**
   - **View invoice history**
   - **Cancel subscriptions** (choose "at end of billing period" so access isn't cut off
     mid-cycle)
   - **Update subscriptions** — if enabled, add Plus/Pro/Business's monthly *and* yearly
     Prices to the list of Prices customers can switch between.
3. Click **Save**.

---

## 9. Tax settings (optional)

If you need to collect sales tax / VAT, enable **Stripe Tax**:

1. Go to **Settings → Tax** (<https://dashboard.stripe.com/settings/tax>).
2. Follow Stripe's setup wizard to register the regions where you need to collect tax.
3. No code changes are needed — LabCD's Checkout Sessions don't hardcode tax behavior, so
   Stripe Tax (once enabled on your account) applies automatically.

This is entirely optional and doesn't block anything else in this guide.

---

## 10. Going live

Once testing looks good:

1. Toggle **Test mode** off in the Dashboard.
2. Repeat [Step 2](#2-create-the-products-and-prices) (Products/Prices), [Step 3](#3-get-your-api-keys)
   (API keys), and [Step 4](#4-set-up-the-webhook-endpoint) (webhook) in **Live mode** — test
   mode and live mode have completely separate Products, Prices, keys, and webhooks.
3. Update **Admin → Plans** with the new **live** `prod_...`/`price_...` IDs (Step 5), and
   **Admin → API keys** with the new **live** `sk_live_...` / `pk_live_...` /
   `whsec_...` values (Step 6).
4. Do one real test purchase with a real card (you can refund it immediately from the
   Dashboard) to confirm everything works end-to-end in Live mode.

---

## Troubleshooting

- **"Subscribe" button says "Coming soon" for a plan.** That plan is missing a Stripe price
  ID for the selected billing interval — double-check Admin → Plans (Step 5).
- **Checkout succeeds but the user's plan never updates.** The webhook likely isn't reaching
  LabCD, or the signing secret is wrong. Check Developers → Webhooks → your endpoint →
  recent deliveries in the Stripe Dashboard for errors, and confirm
  `STRIPE_WEBHOOK_SECRET` in Admin → API keys matches the endpoint's signing secret.
- **"Stripe is not configured" error.** `STRIPE_SECRET_KEY` isn't set — see
  [Step 6](#6-enter-your-keys-in-labcd).
- **A user's billing looks stuck / out of sync.** As an admin, open their user detail page
  (Admin → Users → the user) and click **Sync from Stripe** on the Billing panel — this
  re-fetches their subscription directly from Stripe and re-applies it.
- **You changed a plan's price in Stripe.** Stripe Prices are immutable once created — to
  change a price, create a *new* Price on the same Product in the Dashboard, then update
  the corresponding Stripe monthly/yearly price ID field in Admin → Plans. Existing
  subscribers keep their old price until they resubscribe or you migrate them in Stripe.
