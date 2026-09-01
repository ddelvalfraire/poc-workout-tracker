<!--
DRAFT — NOT LEGAL ADVICE. For attorney review before accepting payments.
Placeholders: [COMPANY], [STATE], [APP NAME], [CONTACT EMAIL],
[EFFECTIVE DATE], [LLM PROVIDER] (current model provider(s) via the coach's
provider seam). The processor table must be kept truthful as the stack
changes — an inaccurate privacy policy is an FTC deception exposure, which
is worse than no policy. Companion document: the standalone Consumer Health
Data Privacy Policy (consumer-health-data-privacy-policy.md), which controls
for health data where the two overlap.
-->

# Privacy Policy

**Effective date:** [EFFECTIVE DATE]

This policy describes how [COMPANY] ("we", "us") collects, uses, and shares
information when you use [APP NAME] (the "Service").

**Health data notice:** much of what you record in [APP NAME] — workouts,
body measurements, progress photos — is health-related. Our separate
**[Consumer Health Data Privacy Policy](./consumer-health-data-privacy-policy.md)**
explains how we handle that data and the consents we ask for. Where the two
policies overlap, the Consumer Health Data Privacy Policy controls for
consumer health data.

## 1. What we collect

**You provide:**
- **Account information** — email address and sign-in credentials, handled by
  our authentication provider (WorkOS); we never see or store your password.
- **Training data** — workouts, sets, exercises, programs, training maxes,
  and related notes.
- **Body data** — bodyweight entries, body measurements, and progress photos
  you choose to add.
- **Coach conversations** — messages you send to the AI coach and its
  responses.

**Collected automatically:**
- **Usage analytics** — pageviews and product events (for example, "a workout
  was completed") with coarse properties such as counts and durations. We
  deliberately exclude training content — exercise names, loads, bodyweight,
  and note text never appear in analytics. Before you consent to analytics at
  signup, events are not linked to your identity.
- **Device and log data** — IP address, browser type, and error reports
  needed to run and debug the Service.

## 2. What we use it for

- To provide the Service: storing and displaying your training data,
  deriving your program targets, and generating coach responses.
- To secure the Service and prevent abuse.
- To understand product usage in aggregate and improve the Service.
- To communicate with you about your account and, with your consent,
  product updates.

## 3. What we never do

- We do **not** sell your personal information, and we do not share it for
  cross-context behavioral advertising.
- We do **not** use your health data for advertising or marketing of any
  kind.
- We do **not** use your data to train AI models, and our contracts with AI
  providers prohibit them from doing so. ⚖️ [Verify against the current
  LLM-provider agreement before publishing.]
- We do **not** run advertising in the Service.
- We do **not** analyze faces or extract biometric identifiers from progress
  photos. Photos are stored for your own viewing; no machine-learning
  processing is applied to them.

## 4. Who processes your data (service providers)

We share personal information only with processors that operate the Service
under contract:

| Provider | Role | Data involved |
|---|---|---|
| WorkOS | Authentication | Email, sign-in metadata |
| Vercel | Application hosting | All Service traffic |
| Supabase | Database hosting | Training and body data |
| Upstash | Cache/queues | Operational data (e.g., rate-limit counters) |
| PostHog | Product analytics | Usage events (no training content; identity only after consent) |
| [LLM PROVIDER] | AI coach responses | Coach conversations and the training context needed to answer |
| Stripe | Payments (web) | Payment details (we never see full card numbers) |
| Apple / Google | Payments (app stores) | Their own purchase records |
| Sentry | Error monitoring | Error reports and diagnostic context |

⚖️ [Keep this table synchronized with the actual stack at every publish.]

## 5. Retention and deletion

- Your data is retained while your account is active.
- Deleting a workout, photo, or note deletes it from the live database
  immediately; backup copies age out on our backup schedule of
  [BACKUP WINDOW, e.g., 30 days].
- Deleting your account deletes your personal data on the same schedule,
  except records we must keep for legal or accounting reasons.
- You can export your training data at any time from the Service.
- To open instantly, the app keeps a short summary of your recent training
  (workout names and dates, program week, bodyweight trend, goal progress)
  in your browser's local storage on your own device. It is never sent
  anywhere, expires within 24 hours, and is removed when you sign out or
  delete your account.

## 6. Your rights

Depending on where you live (including under the GDPR, the California
Consumer Privacy Act, and other U.S. state privacy laws), you may have the
right to access, correct, delete, or receive a portable copy of your
personal information, and to withdraw consent you have given. We honor these
requests for all users regardless of location. Contact [CONTACT EMAIL]; we
will respond within the legally required period. We will never discriminate
against you for exercising a privacy right.

For EU/EEA/UK users: our legal bases are contract performance (operating the
Service), your **explicit consent** for health-related data and identified
analytics, and legitimate interests (security, debugging). You may lodge a
complaint with your supervisory authority.

## 7. Children

The Service is not directed to children and may not be used by anyone under
16. We do not knowingly collect personal information from children under 16;
if we learn we have, we will delete it.

## 8. Security

Data is encrypted in transit; production access is restricted; passwords are
never stored by us (authentication is delegated to WorkOS). No system is
perfectly secure — if a breach affects your data, we will notify you as the
law requires (including under the FTC's Health Breach Notification Rule
where it applies).

## 9. Changes

We will post any changes here and, for material changes affecting how we use
personal data, notify you in the Service or by email before they take
effect.

## 10. Contact

[COMPANY]
[MAILING ADDRESS]
[CONTACT EMAIL]
