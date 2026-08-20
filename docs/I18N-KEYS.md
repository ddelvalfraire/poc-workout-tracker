# Translation key naming convention

Applies to every key in `messages/*.json`. Enforced in review; violations block merge.

## 0. The one rule

**A key names the SLOT, never the STRING.** If you can reconstruct the English
copy from the key, the key is wrong.

```jsonc
// BAD  — key is a slug of the sentence
"nothingImportedYetImportsYou": "Nothing imported yet. Imports you confirm…"
// GOOD — key names the slot the sentence sits in
"empty": "Nothing imported yet. Imports you confirm…"
```

Rewrite the copy and the GOOD key still fits. That is the whole test.

### Why content-derived keys are banned

- **Drift.** The key freezes yesterday's copy. Edit the sentence and the key
  becomes a lie that no linter catches — `theExportFormatIsDetected` outliving a
  rewrite to "We detect the format for you" is worse than no name at all.
- **Key churn destroys translations.** Rename a key and every TMS treats it as
  *delete + create*: the German string is orphaned, the new key ships untranslated.
  Copy edits are frequent; translations are expensive. Never couple them.
- **Collisions.** Two components with the button "Save" derive the same key.
  You get `save`, `save2`, or an accidental merge.
- **Translators lose context.** `deletingYourAccountIsPermanent` tells a translator
  nothing about where it renders, how much room it has, or whether it's a heading
  or a warning. `permanenceWarning` does.
- **Grep breaks.** Searching the codebase for the copy finds the key, not the usage.

Sources: [Locize](https://www.locize.com/blog/guide-to-i18n-key-naming) calls
content-as-key "extremely brittle" — "fixing a simple typo or rephrasing the text
changes the key, breaking the link to all existing translations";
[Lokalise](https://lokalise.com/blog/translation-keys-naming-and-organizing/) and
[SimpleLocalize](https://simplelocalize.io/blog/posts/best-practices-for-translation-keys/)
both list copy-mirroring as an anti-pattern.

### The legitimate counter-position, and why it doesn't apply here

GNU gettext and Lingui's default mode use the **source string itself** as the ID
(or a hash of it). That is coherent — but only because the *extractor owns the ID*.
The tool derives it mechanically from the source at build time, so:

- the ID is regenerated on every extraction; it cannot drift,
- the toolchain ships `msgmerge` / fuzzy matching to carry translations across a
  reworded source,
- deduplication is automatic and intentional.

[Lingui documents the tradeoff explicitly](https://lingui.dev/tutorials/explicit-vs-generated-ids):
generated IDs avoid the naming problem and dedupe for free, but "IDs change if
message text changes, potentially disrupting translation workflows"; explicit IDs
"remain stable even when message content updates, making TMS integration smoother."

**Our setup is the explicit-ID case.** next-intl keys are hand-written JSON
identifiers with no extractor, no hash, and no fuzzy-merge safety net. We get
every cost of content-derived IDs and none of the machinery that makes them
survivable. So: semantic keys, always.

## 1. Structure

```
Namespace.element
Namespace.group.element        (only when the namespace has real sub-sections)
```

- **Namespace** = one route or one component, PascalCase, matching the component
  name. `ImportFlow`, `DeleteAccount`, `Trophies`, `Settings`. This is the
  next-intl `useTranslations('ImportFlow')` argument.
- **group** (optional) = a genuine sub-section of that surface, camelCase:
  `steps`, `errors`, `units`. Use it only when a namespace exceeds ~15 keys or
  has a repeated cluster.
- **element** = the leaf, camelCase, drawn from the vocabulary below.

**Max depth 3.** Two is the norm. Every source above converges on 2–3 levels
(Lokalise: "limit the depth of your namespaces to 2-3 levels"; Locize:
namespace → category → leaf).

Do **not** encode file paths (`src.components.import.flow.title`). Paths change
during refactors; the namespace should survive a file move.

## 2. Leaf vocabulary

Use these names. Do not invent synonyms — `heading`/`header`/`titleText` for the
same concept is how a catalog rots.

| Leaf | Use for |
|---|---|
| `title` | The surface's primary heading (h1/h2) |
| `subtitle` | Secondary heading directly under `title` |
| `lede` | Intro paragraph setting up the surface |
| `description` | Explanatory body copy for an item or field |
| `label` | Form field / control label, and visible button-adjacent labels |
| `placeholder` | Input placeholder |
| `hint` | Hint under a field (non-error) |
| `action` | The primary button/link on the surface |
| `actionSecondary` | The secondary button |
| `cancel`, `confirm`, `save`, `delete`, `retry`, `close` | Standard controls, when literally that |
| `error` | Generic failure message |
| `errorX` | Named failure — `errorNotFound`, `errorTooLarge`, `errorUnsupported` |
| `validation` | Field-level validation message |
| `empty` | Empty-state heading |
| `empty` | Empty-state copy |
| `loading` | Loading / pending copy |
| `success` | Success confirmation / toast |
| `tooltip` | Tooltip content |
| `ariaLabel` | Accessible name not shown visually |
| `srOnly` | Visually hidden text that is not an accessible *name* |
| `badge` | Short status pill text |
| `summary` | One-line roll-up, usually with ICU args |
| `unit` | Unit suffix ("kg", "sets") |
| `option.<value>` | One entry of an enum/select, keyed by the enum value |

State variants suffix the base leaf: `titleCompleted`, `actionDisabled`,
`emptyFiltered`. Never `title2`.

## 3. Casing and separators

**camelCase leaves, PascalCase namespaces, nested JSON objects, dots only for access.**

```jsonc
{
  "ImportFlow": {
    "title": "Import from Strong or Hevy",
    "steps": { "indicator": "Step {step} of 3 — {label}" }
  }
}
```

Rationale:

- next-intl reserves `.` as the nesting separator: **"Namespace keys cannot
  contain the character `.` as this is used to express nesting — all other
  characters are fine to use"**
  ([next-intl docs](https://next-intl.dev/docs/usage/messages)). So a literal dot
  inside a key name is out; nest instead and access with `t('steps.indicator')`.
- **No kebab-case.** Android `strings.xml` names become `R.string.<name>` members
  ([Android docs](https://developer.android.com/guide/topics/resources/string-resource):
  "This name is used as the resource ID"), so they must be valid Java
  identifiers — hyphens and leading digits are illegal. camelCase and snake_case
  both export cleanly; kebab does not. Same constraint would bite an
  `.xcstrings` or Crowdin round-trip.
- camelCase over snake_case is a coin flip in the literature (Lokalise, Phrase and
  Tolgee all say "pick one and be consistent"). We pick camelCase because it
  matches the TS identifiers the generated key types produce, and it's already
  the de-facto style in `messages/en.json`.
- ICU argument names are separately constrained: **"Value names are required to be
  alphanumeric and can contain underscores. All other characters, including
  dashes, are not supported"** (next-intl). Use camelCase args: `{fileName}`, not
  `{file-name}`.

## 4. Near-duplicates: two "Save" buttons

**Default: duplicate. Sharing is the exception and must be earned.**

Give each component its own `save` key:

```jsonc
"ProgramEditor": { "save": "Save" },
"ProfileForm":   { "save": "Save" }
```

This looks wasteful in English and is correct everywhere else. The trap: German
splits *speichern* (persist data) from *sichern* (secure), Spanish splits
*guardar* from *salvar*, and a shared key forces one rendering on both. Once
shared, the two contexts can never diverge — and they will, the day one button
becomes "Save draft". Lokalise names exactly this pattern, keeping `order.save`
and `profile.save` separate despite identical English.

**The `Common` namespace is for chrome, not for words.** A string belongs in
`Common` only if all three hold:

1. It renders in ≥3 unrelated surfaces, **and**
2. it is context-free UI furniture — `cancel`, `close`, `back`, `next`,
   `appName`, `loading`, **and**
3. no plausible product change makes one caller's copy diverge.

If you're arguing about whether it qualifies, it doesn't. Duplicating a
five-character string is cheap; un-sharing a key after it's translated into
eight languages is not.

## 5. ICU arguments and plurals

**The key names the slot, not the shape of the message.** Adding a plural or an
argument to a message does not rename it.

```jsonc
// GOOD — name is about role, survives the message gaining/losing a count
"ImportFlow": {
  "summary": "{workouts, plural, one {# workout} other {# workouts}} added.",
  "duplicatesSkipped": "{count, plural, one {# workout} other {# workouts}} skipped."
}
```

Rules:

- **Never suffix `_plural`, `_one`, `_other`.** ICU carries plural categories
  *inside* the value. i18next-style suffixed sibling keys are a different
  library's mechanism and must not leak into an ICU catalog.
- **Never put an argument in the key.** `welcomeMessage_{username}` is a
  documented anti-pattern (Lokalise, SimpleLocalize) — the key must be a static
  literal or the type-safe key generation and the extractor both break.
- **Do use a `count` leaf when the count IS the message**: `countLabel`,
  `remainingCount`. But `summary` beats `workoutAndSetCountSummary`.
- **Name the argument semantically too**: `{fileName}`, `{count}`, `{step}` —
  not `{a}`, `{0}`.
- **Never build a sentence by concatenating keys.** Word order is
  language-specific; pass one full ICU message with arguments instead.

## 6. Anti-patterns

| Anti-pattern | Example | Why it's harmful |
|---|---|---|
| Content in the key | `deletingYourAccountIsPermanent` | Drifts on every copy edit; renaming orphans translations |
| Numbered keys | `label1`, `label2`, `title3` | Encodes render order, not meaning; reordering the UI makes them lie; translator has zero context |
| Abbreviations | `rg_frm_fnam_lb`, `btn.nxt` | Unreadable to translators; ambiguous expansions; no grep affordance |
| Markup/entities in key or value | `hiddenSectionsKeepTrackingMdash`, value `"…&mdash;…"` | Keys leak presentation; **HTML entities in values do not render in JSX and ship literally to users**. Use real characters (`—`, `’`) and `t.rich` for markup |
| Layout in the key | `sidebarRightColTitle` | Ties copy to a layout that will change; move the tile and the key is wrong |
| Over-deep nesting | `settings.account.privacy.analytics.toggle.label.text` | Painful to refactor, breaks TMS flat-key exports, and every level past 3 is noise |
| One key, unrelated meanings | shared `status` for a workout state and an HTTP error | Cannot be translated correctly in both; genders and cases differ per context |
| File paths as namespaces | `src.components.import.ImportFlow.title` | Refactors rename translations |
| Argument or count baked in | `welcomeMessage_{username}`, `items_plural` | Key must be a static literal; ICU already handles plurals in the value |

## 7. Decision procedure

For each string, in order. Stop at the first rule that fires.

1. **Namespace** = the component that renders it. PascalCase, same name as the
   component. If it's rendered by a route-level page, use the route's component
   name. *Never* the file path.
2. **Is it chrome?** Renders in ≥3 unrelated surfaces, context-free, cannot
   diverge → `Common`. Otherwise stay in the component namespace, even if the
   English duplicates.
3. **Leaf from the JSX role**, first match wins:
   - `<h1>/<h2>` primary → `title`; the one right under it → `subtitle`
   - first `<p>` under the heading → `lede`; other explanatory `<p>` → `description`
   - `<label>` / `aria-label` on a field → `label` / `ariaLabel`
   - `placeholder=` → `placeholder`; hint under a field → `hint`
   - primary `<button>` → `action`; the other one → `actionSecondary`;
     a literal Cancel/Save/Delete → `cancel`/`save`/`delete`
   - error/alert region → `error` or `errorX`
   - empty state → `empty`
   - pending copy → `loading`; toast → `success`
   - `<option>` / enum → `option.<enumValue>`
4. **Disambiguate only if the leaf collides** inside the namespace. In order:
   a. Add a `group` segment for the real sub-section — `steps.title`, `unit.title`.
   b. Suffix the *state* — `titleCompleted`, `emptyFiltered`.
   c. Suffix the *subject noun* — `errorFileTooLarge`, `labelWeightUnit`.
   Never a number.
5. **Check the rewrite test.** Rewrite the English in your head. If the key now
   describes the wrong thing, go back to step 3 — you named the copy, not the slot.

**Tie-breakers**

- Two leaves both plausible → pick the one describing *where it renders*, not
  *what it says*.
- Torn between `Common` and duplicating → duplicate.
- Torn between a `group` and a longer leaf → longer leaf; nesting is harder to undo.
- Torn between two namespaces (shared child component) → the namespace of the
  component that owns the *string*, i.e. where the text literal lives, not where
  it's displayed.

## 8. Worked examples

Real keys from `messages/en.json` — kept in step with the catalog, since a
doc that contradicts the code is the same rot this page argues against.

Two families the vocabulary above formalizes, both used verbatim in the
catalog: `<verb>Error` for a failed action (`saveError`, `updateError`) and
`<condition>Notice` for a standing state the user cannot act away
(`unsupportedNotice`, `blockedNotice`). An error is a thing that just went
wrong; a notice is a condition that is simply true.

| # | BAD (content-derived) | GOOD (semantic) |
|---|---|---|
| 1 | `Import.nothingImportedYetImportsYou` | `Import.empty` |
| 2 | `ImportFlow.theExportFormatIsDetected` | `ImportFlow.dropzone.hint` |
| 3 | `ImportFlow.nothingIsSavedUntilYou` | `ImportFlow.preview.reassurance` |
| 4 | `ImportFlow.importFromStrongOrHevy` | `ImportFlow.title` |
| 5 | `ImportFlow.strongFilesDonRsquoT` | `ImportFlow.unit.hint` |
| 6 | `ImportFlow.steps.indicator` | `ImportFlow.steps.indicator` |
| 7 | `DeleteAccount.deletingYourAccountIsPermanent` | `DeleteAccount.permanenceWarning` |
| 8 | `DeleteAccount.yourWorkoutsProgramsTemplatesNotes` | `DeleteAccount.erased.description` |
| 9 | `DeleteAccount.consentRecordsWeAreLegally` | `DeleteAccount.retained.description` |
| 10 | `DeleteAccount.ourAnalyticsProcessorDeletesYour` | `DeleteAccount.propagated.description` |
| 11 | `DeleteAccount.erasedImmediately` | `DeleteAccount.erased.title` |
| 12 | `HomeLayoutEditor.couldnRsquoTSaveTry` | `HomeLayoutEditor.saveError` |
| 13 | `HomeLayoutEditor.tapATileToResize` | `HomeLayoutEditor.hint` |
| 14 | `TileSheet.hiddenSectionsKeepTrackingMdash` | `TileSheet.visibility.hint` |
| 15 | `WorkoutRemindersToggle.notSupportedInThisBrowser` | `WorkoutRemindersToggle.unsupportedNotice` |
| 16 | `WorkoutRemindersToggle.notificationsAreBlockedForThis` | `WorkoutRemindersToggle.blockedNotice` |
| 17 | `AnalyticsConsentToggle.yourBrowserSendsAGlobal` | `AnalyticsConsentToggle.gpcHint` |

Note #6: `stepIndicator` was *already* semantic — it's kept, just regrouped.
Not every existing key is wrong; only the ones that echo the sentence.

## 9. Migration and enforcement

- **Rename in one pass, before any locale but `en` exists.** Key churn is free
  today and expensive the moment a second catalog lands. This is the last cheap
  window.
- **Lint rule:** fail CI on any leaf longer than 24 characters that is not in the
  vocabulary allow-list, and on any leaf whose camelCase-split words appear in
  order in its own value. That second check catches content-derivation directly.
- **Also fix during the pass:** HTML entities in values (`&rsquo;`, `&mdash;`)
  ship literally through next-intl. Replace with the real characters.

## Sources

- [Lokalise — Translation Key Naming Conventions: 11 Best Practices](https://lokalise.com/blog/translation-keys-naming-and-organizing/)
- [Locize — The Art of the Key: A Definitive Guide to i18n Key Naming](https://www.locize.com/blog/guide-to-i18n-key-naming)
- [Tolgee — The Ultimate Guide to Naming Translation Keys](https://tolgee.io/blog/naming-translation-keys)
- [SimpleLocalize — Best practices for creating translation keys](https://simplelocalize.io/blog/posts/best-practices-for-translation-keys/)
- [GlobalLink/Applanga — Key Naming Convention Best Practices](https://www.applanga.com/blog/key-naming-convention-best-practices)
- [Lingui — Explicit vs Generated IDs](https://lingui.dev/tutorials/explicit-vs-generated-ids)
- [next-intl — Messages](https://next-intl.dev/docs/usage/messages)
- [Android — String resources](https://developer.android.com/guide/topics/resources/string-resource)
- [Project Fluent — syntax spec](https://github.com/projectfluent/fluent/blob/master/spec/fluent.ebnf) (`Identifier ::= [a-zA-Z] [a-zA-Z0-9_-]*`)

## 9. Copy that lives outside JSX

The lint gate reads JSX. A pure function in `src/lib/**` that returns a
sentence is invisible to it, so "migrated" means *migrated in its JSX*, not
free of English. Those functions still have to be localized, and there is one
way to do it.

**A pure function returns a message DESCRIPTOR, never a sentence.**

```ts
// Before — the function owns the English.
export function volumeStatusLabel(delta: number): string {
  return delta > 0 ? `${delta} sets ahead` : `${-delta} sets behind`
}

// After — the function owns the DECISION, the catalog owns the words.
export type Message = { key: string; values?: Record<string, string | number> }

export function volumeStatus(delta: number): Message {
  return delta > 0
    ? { key: 'aheadBySets', values: { sets: delta } }
    : { key: 'behindBySets', values: { sets: -delta } }
}
```

The caller renders it: `t(status.key, status.values)`.

Why descriptors rather than passing `t` in:

- The function stays pure, so its tests assert the *decision* (which branch,
  what count) instead of an English string. A test that asserts
  `"3 sets behind"` fails the moment anyone rewords the copy, which is how
  translation work ends up blocked on unrelated test churn.
- Threading `t` through makes every caller in the chain carry a translator,
  including the ones that only forward the value.
- Server and client resolve translators differently (`getTranslations` vs
  `useTranslations`); a descriptor does not care which one renders it.

**Dates, numbers and units are not catalog entries.** `formatWorkoutDate`
returning `"Jun 14, 2026"` is not a string to translate — it is
`Intl.DateTimeFormat(locale)`. A hardcoded `'en-US'` in a `toLocaleString`
call is a localization bug, not a missing message. Same for weights,
percentages and durations: format them with the resolved locale, and put only
the surrounding words in the catalog.

**What is NOT copy**, and must stay out of the catalog: exercise names, muscle
names, equipment and template seed content (catalog/database content, authored
by users or the seed); MCP tool names and descriptions (an owner-only
protocol, not app UI); and anything stored in the database, which must never
be written in the creating user's language.
