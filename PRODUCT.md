# Product

## Register

product

## Users
Lifters who train on a schedule and log their sessions **on a phone, at the gym** — often one-handed, between sets, sometimes with sweaty hands and in low or harsh lighting. The app is installed to the home screen and launched standalone, so it must feel like a native iOS/Android app, not a website in a browser tab. The primary job on any screen is fast capture: start a workout, find an exercise, punch in sets/reps/weight, save, and later review or correct history.

## Product Purpose
A friction-free start → log → review loop in an installable PWA so lifters reliably capture training. Success = logging a full workout in under two minutes on a phone, and trusting the history days later.

## Brand Personality
Athletic, bold, focused. Three words: **strong, fast, no-nonsense.** It should feel like a piece of gym equipment — confident and high-contrast — not a delicate productivity tool. Energy is carried by condensed display type and a single high-voltage accent, not by decoration.

## Anti-references
- Generic light shadcn/Tailwind default UI (gray-on-white, uniform cards, 14px everything) — the current biggest tell.
- Corporate SaaS dashboards (navy + blue accent, dense data tables).
- Delicate/airy wellness-app pastels. This is a barbell app, not a meditation app.
- Anything that reveals it's "a website": tap-to-zoom on inputs, browser-chrome spacing, hover-only affordances, desktop density on a phone.

## Design Principles
- **Thumb-first.** Every primary action sits in the thumb arc with a ≥44px target. The save action is always reachable without scrolling to a corner.
- **Native, not web.** Respect safe areas, standalone display, no input zoom, momentum scroll, instant feedback. It should be indistinguishable from a native app once installed.
- **Glanceable under load.** High contrast, large numerals, clear hierarchy — readable mid-set without focus.
- **Speed is the feature.** Instant search, no spinners where data is cached, minimal taps from open to logged.
- **One bold accent, used with discipline.** The volt accent marks the primary action and active state only — never decoration.

## Accessibility & Inclusion
WCAG 2.2 AA. Body text ≥4.5:1 on the near-black surface; large/bold text ≥3:1. Touch targets ≥44×44px. **User zoom stays enabled** (no `maximum-scale` lock) — the input-zoom issue is fixed by 16px inputs, not by disabling accessibility. Full `prefers-reduced-motion` alternatives for every transition. Visible focus states for keyboard/switch users.
