<!--
DRAFT — NOT LEGAL ADVICE. The UI strings and flows that make the three legal
documents operative. These ship inside PRs (consent step = the PostHog PR 4;
checkout strings = the billing PR; AI label = coach UI), so this file is the
spec the PRs implement, not a published page.
-->

# In-Product Legal Copy & Flows

## 1. Signup: clickwrap acceptance

At account creation, beneath the sign-up action:

> By creating an account you agree to the **Terms of Service** and
> acknowledge the **Privacy Policy** and **Consumer Health Data Privacy
> Policy**.

Requirements:
- Links go to the live documents.
- The action is an affirmative click (Clerk's sign-up flow satisfies this);
  record the acceptance timestamp and Terms version against the user
  (California ARL: keep consent records 3 years).

## 2. Signup: the two MHMDA consents (PR 4 scope)

A single onboarding step, two separate affirmative checkboxes — not
pre-checked, not bundled into one:

**Checkbox A — collection (required to use the app):**
> I consent to [APP NAME] collecting the health-related data I record —
> workouts, measurements, photos, and notes — to provide the service.
> *(Required — this data is what the app is.)*

**Checkbox B — processing/sharing with service providers (required) +
analytics identity (optional):**
> I consent to my health-related data being processed by [APP NAME]'s
> service providers (hosting, database, AI coach provider) as described in
> the Consumer Health Data Privacy Policy.

**Checkbox C — optional, defaults off:**
> Link my product usage (not my workout content) to my account to help
> improve [APP NAME]. Analytics never includes exercises, loads, bodyweight,
> photos, or notes.

Implementation notes:
- A and B gate account creation; C gates `posthog.identify()` — decline
  means analytics stays anonymous forever for this user.
- Store all three as timestamped consent records; expose toggles for B/C in
  Settings (withdrawal path required by MHMDA).

## 3. Coach UI: persistent AI disclosure (Utah high-risk tier)

Visible at all times in the coach surface (not dismissible, not only in
onboarding):

> **AI coach** — responses are AI-generated and can be wrong. Not medical
> advice.

First-open interstitial (once per user):

> The coach is an AI. It knows your training history and can edit your
> program — but it can make mistakes, and it isn't a doctor. Check anything
> that matters, and see your physician before making health decisions.

## 4. Checkout (web/Stripe — billing PR scope)

On the plan-selection/payment screen, adjacent to the pay button (CA AB 2863
requirements):

> **[PLAN] — $X.XX / [month|year].** Renews automatically each
> [month|year] at the then-current price until you cancel. Cancel anytime in
> Settings → Billing; cancellation takes effect at the end of the current
> period. [If trial: **Your trial ends [DATE], when your subscription starts
> and your card is charged $X.XX.**]

Requirements:
- Affirmative consent: the pay button may not double as terms acceptance —
  show the renewal terms above/beside it, with the checkout click as consent
  to *clearly displayed* terms.
- Cancellation must be possible online, in no more steps than signup
  ("cancel-same-method").
- Annual plans: schedule a renewal-reminder email (Stripe billing settings +
  a cron fallback).
- Post-purchase email must restate price, period, renewal terms, and how to
  cancel.

## 5. Body photos: point-of-use notice

First time a user adds a progress photo:

> Photos are stored privately for your own progress tracking. [APP NAME]
> never analyzes faces or bodies in your photos, and never uses them for
> anything but showing them to you. Delete any photo at any time.

## 6. Footer / homepage links

Every marketing page footer and the app's settings screen link to:
Terms of Service · Privacy Policy · **Consumer Health Data Privacy Policy**
(the third link is an MHMDA requirement — prominent homepage link).

---

# Implementation checklist (maps to PRs)

- [ ] Legal pages PR: render the three documents at `/terms`, `/privacy`,
      `/health-privacy`; footer links; settings links.
- [ ] PR 4 (consent): onboarding step with checkboxes A/B/C; consent records
      table `(user_id, doc, version, granted_at, revoked_at)`; Settings
      toggles; `identify()` gated on C.
- [ ] Coach UI: persistent AI label + first-open interstitial.
- [ ] Billing PR: checkout disclosure block, cancel flow parity, renewal
      reminder, post-purchase email.
- [ ] Photos: point-of-use notice.
- [ ] Before charging money: one attorney hour on ToS §7/§12/§14 and the
      CHD policy; fill every [PLACEHOLDER]; form the LLC and set [STATE].
