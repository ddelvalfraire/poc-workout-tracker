# SPIKE — Back Navigation Mechanics

Design exploration (2026-08-03), NO implementation. Trigger: "navigation
in this app needs an entire rework. not the design of the sidebar or
design of items but we are lacking simple navigation like correct back
on ios." Scope: history-stack MECHANICS, not visuals — the drawer (#143)
and chevron styling stay.

## 1. The problem, precisely

**Zero `router.back()` calls exist in the app.** Every back chevron is a
hardcoded `<Link href={parent}>` — a PUSH, not a pop. 12 files:
settings, settings/import, programs/[id], programs/[id]/stats,
programs/templates(+[id]), exercises/[source]/[id], history,
templates/[id], workout/[id], workout-logger, ops-header.

Three concrete defects:

- **Stack pollution**: Programs → detail → chevron produces history
  `[home, programs, detail, programs]`. Repeat twice and the stack is 7
  deep. iOS edge-swipe (the ONLY system back in a standalone PWA —
  there is no browser chrome) walks that real stack: swipe after
  tapping the chevron takes you FORWARD to the detail page you just
  left. This is the reported "back is wrong on iOS."
- **Context loss**: hardcoded parents lie about where you came from.
  workout/[id]'s chevron always goes to `/` — but you can arrive from
  /history, a trophy link, program stats, or the drawer's RECENT.
  Back-as-push teleports instead of returning; scroll position and
  in-page state at the origin are lost (push remounts; a real pop
  restores scroll).
- **Chevron/gesture disagreement**: two "back" affordances doing
  different things on the same screen is a broken mental model.

## 2. Platform ground truth (research)

- iOS standalone PWAs: no browser UI; edge-swipe back/forward follows
  the REAL history stack and cannot be disabled or intercepted
  reliably (WebKit-level; a decade of Ionic issues confirm; Android
  disables the equivalent by default). Fighting the gesture is a dead
  end — the stack itself must be correct.
- The Navigation API (programmatic stack control, `canGoBack`) is
  Chromium-only still — usable as progressive enhancement, not as the
  mechanism.
- Framework practice: back affordances should perform `history.back()`
  when the app owns the previous entry, and fall back to a pushed
  parent route ONLY for cold entries (deep link / fresh PWA launch).

## 2b. Who handles this exceptionally well (exemplar research)

- **React Navigation / Expo Router native-stack** — the reference
  implementation of correct back on mobile: it wraps the literal
  UINavigationController, so its two axioms are the ones users'
  muscle memory expects. (1) Back ALWAYS pops — no screen ever
  "navigates back" by pushing. (2) **Synthetic stacks for deep
  links**: cold-entering a detail screen doesn't land you on a
  dead-end — the router CONSTRUCTS the parent stack beneath it
  (`[list, detail]`) so back/swipe works immediately. The web
  translation: on a cold detail-page entry, replace(parent) then
  push(detail) — now even the OS edge-swipe works on a deep link,
  not just our chevron. Strictly stronger than replace-on-tap.
- **Twitter's photo modal / Pairs Engineering's navigable modals** —
  the exemplar for overlays: every modal/overlay gets a HISTORY
  ENTRY (pushState with UI state), so system back closes the overlay
  and returns you exactly where you were — never exits the page.
  This is a gap in our app today: swipe-back with the drawer, a
  sheet, or the photo overlay open leaves the page entirely instead
  of closing the overlay. On iOS, where the swipe is the system
  back, overlays that ignore history feel broken.
- **Next.js intercepting/parallel routes** — the framework-native
  way to make an overlay a real route (used for photo-viewer modals
  that survive back with scroll intact); heavier machinery, noted as
  the escalation path rather than v1.

## 3. THE DIRECTION — one BackLink, a real stack, deep-link fallback

### 3a. `<BackLink fallback="/parent">` (client) replaces all 12 chevrons

- If the app owns in-app history (3b): `router.back()` — a true pop.
  Swipe and chevron become the SAME operation; origin scroll/state
  restore.
- Else (cold deep link, fresh launch): the Expo-style **synthetic
  stack** — on cold entry to a sub-page, NavigationTracker rebuilds
  the parent beneath it (replace(parent) → push(current), one-time,
  before paint). Back AND the OS edge-swipe then work identically on
  deep links. Fallback-on-tap (`router.replace(fallback)`) is the
  degraded path if the rebuild proves racy with Next's router —
  build-time decision, both documented.
- Identical chevron UI (drop-in for the current links); proper
  button-that-navigates semantics.

### 3b. Knowing "do we own the previous entry" (the only subtle part)

`history.length` is useless (counts pre-app entries, never shrinks).
Track it ourselves: a tiny `NavigationTracker` client component in the
root layout increments a `sessionStorage` depth counter on App Router
pathname changes and reconciles on popstate. BackLink asks: depth > 1 →
pop; else → replace(fallback). Progressive enhancement: where
`navigation.canGoBack` exists (Chromium), trust it over the counter.
~40 lines, no dependency.

### 3c. Flow-aware fallbacks (fix the lies)

Fallbacks = the CANONICAL parent (what a cold deep-link user expects):
workout/[id] → /history (not /); programs/[id]/stats → /programs/[id];
templates/[id] → /templates; exercises/[source]/[id] → /exercises;
history → /; settings/import → /settings; ops → unchanged. In warm
flows the fallback almost never fires — a pop returns you to where you
actually came from.

### 3d. Stack hygiene rules (make history mean something)

- **Back affordances never push** — pop or replace only; audit any
  other "go up" links.
- **Redirect-ish hops REPLACE**: logger post-finish navigation to the
  summary replaces the logger entry (swiping back from a summary must
  never resurrect a finished logger session); same for sign-in → home
  and conflict-dialog resolution navigation.
- **Drawer keeps pushing** (forward travel is a push) — but a drawer
  tap targeting the CURRENT page closes the drawer only, no duplicate
  entry.
- **The logger is a modal flow**: entering pushes once; internal
  logger state must never touch history (verify — believed true).

### 3d-bis. Overlays are history entries (the Twitter rule)

The drawer, bottom sheets, and the body photo overlay each push a
history STATE entry on open (pushState with a UI flag, same URL);
popstate closes them. System back/edge-swipe then closes the overlay
instead of exiting the page — the single most "native-feeling" fix on
iOS. Close-by-tap pops its own entry (history.back()) so the stack
never accumulates overlay ghosts. Scope v1: the nav drawer + the photo
overlay (highest-traffic overlays); the sheet recipe gains a shared
`useHistoryDismissable` hook so remaining sheets adopt incrementally.

### 3e. Deliberately NOT doing

Custom swipe-gesture interception (unreliable, fights the OS),
direction-aware page transitions (View Transitions API later, when
Safari matures), breadcrumbs, drawer IA changes, Navigation API as the
primary mechanism (Chromium-only).

## 4. Test surface

- BackLink unit: pop-vs-replace branch on tracked depth; table-driven
  fallback targets per page.
- NavigationTracker: increments on push, reconciles on popstate,
  survives route-change effect-ordering races.
- Replace-not-push rules: logger-finish navigation asserts replace.
- Manual device matrix: cold deep link to workout/[id] → chevron →
  /history with no dead entry behind it; warm home → programs →
  detail → chevron → programs with swipe agreeing at every step.

## 5. Open questions

- [ ] Q1: workout/[id] canonical fallback — /history (lean) or /?
- [ ] Q2: logger back-chevron (abandon flow) — keep its discard-dialog
  semantics (lean), with confirm-exit navigation becoming pop/replace
  per 3d?
- [ ] Q3: ops-header — include for consistency (lean; one line) or
  skip?

## Sources
- https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide
- https://github.com/ionic-team/ionic-framework/issues/22299 (iOS
  swipe-back cannot be disabled in standalone PWAs)
- https://github.com/ionic-team/ionic-framework/issues/29733
- https://meta.discourse.org/t/back-button-in-ios-pwa/93909 (back
  affordance patterns for chrome-less PWAs)
- https://www.alphonsolabs.com/pwa-must-have-features-2026/
- https://docs.expo.dev/router/basics/common-navigation-patterns/
  (synthetic stacks for deep links; back-always-pops axioms)
- https://reactnavigation.org/docs/3.x/stack-navigator/
  (UINavigationController semantics as the reference)
- https://medium.com/eureka-engineering/navigable-modals-with-the-history-api-adventures-in-web-modals-27d94ae2014
  (overlay-as-history-entry; Twitter photo modal as exemplar)
- https://dev.to/derarion/solving-browser-back-resets-infinite-scroll-with-a-nextjs-url-addressable-modal-1doa
  (Next intercepting/parallel routes as the escalation path)
- https://github.com/justinline/useBackNavigation (prior art for the
  depth-tracking hook approach)
