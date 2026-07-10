# Shift Ledger Design System

The single source of truth for **Shift Ledger's** visual language. Shift Ledger is a
**food-safety compliance app for hospitality** — frontline staff log temperature,
cleaning, allergen, and opening/closing checks on shared kitchen tablets/phones, and
managers review records and export audit histories.

**Design and code share these exact tokens.** The system *is* shadcn/ui + Radix +
Tailwind v4 + Lucide, re-themed: a component in the design maps 1:1 to a component in
the build. Do not invent component patterns — compose from shadcn primitives. The only
additions to stock shadcn are the **status tokens** and the **domain components**.

## Source & lineage
- **Base:** shadcn/ui "New York" — https://github.com/shadcn-ui/ui (theme tokens in
  `apps/v4/app/globals.css`, components in `apps/v4/registry/new-york-v4/ui/*`).
  Explore that repo to build higher-fidelity screens.
- **Theme:** the Shift Ledger spec (Appendix B) — indigo brand, Slate neutrals, locked
  compliance status semantics.

---

## Product context
Compliance is the product. Two audiences:
- **Frontline** (mobile-first, glare-y kitchens, shared devices): must be fast and
  unambiguous. The temperature **Complete-task flow targets < 10 seconds** and is built
  entirely around the ThresholdReadout + NumericKeypad. Shared tablets are PIN-gated.
- **Managers** (desktop): review records, work exceptions, and export audit histories.

Light is the **primary** theme (bright kitchens); dark is a first-class secondary
(shipped in the tokens, screens are light-first).

---

## Content fundamentals
- **Voice:** plain, calm, imperative. "Enter fridge temperature." "Complete — pass."
  Never alarmist — *except* genuine critical failures (cold-chain breach).
- **Person:** addresses staff directly ("your PIN", "your shift"). Product name is
  "Shift Ledger" (title case).
- **Casing:** **sentence case** everywhere (buttons, titles, nav). Tiny uppercased
  eyebrow labels with wide tracking are the only exception.
- **Microcopy:** terse and functional. Button labels 1–3 words. One-sentence
  descriptions. Placeholders are examples ("Search records…").
- **Numbers/temps:** Geist Mono, tabular, with unit ("3°C", "-19°C", "66°C").
- **Status language:** the six locked words — Pass, Fail, Overdue, Pending, Critical,
  Info — always paired with icon + color.
- **i18n:** design in EN but allow **~30% longer German**; no fixed-width labels. 24-hour
  clock and °C for DE/NL. Emoji: none.

---

## Visual foundations

**Vibe.** Calm, cool, Linear/Vercel-adjacent. Slate neutrals + a single indigo brand
color, generous whitespace, hairline borders. Color is used *sparingly* so the status
colors carry real meaning.

- **Color.** Brand = **indigo** (`#4F46E5` light / `#6366F1` dark) — used for primary
  actions, focus ring, selected states. Neutrals = **Slate** (cool). Backgrounds are
  white or a whisper slate-50 `--surface`. **Green is reserved exclusively for the
  `pass` status** so a green control never reads as "passed" — indigo, not green, is the
  primary button. No gradients, no purple/violet, no invented hues.
- **Status semantics (LOCKED).** Six statuses, each with solid / subtle-bg / text
  tokens and a fixed Lucide icon: **pass** green `CheckCircle2` · **fail** red `XCircle`
  · **overdue** amber `AlertCircle` · **pending** slate `Circle` · **critical** dark-red
  `AlertOctagon` · **info** blue `Info`. **Color-blind-safe rule (non-negotiable):**
  status is never color alone — always **color + icon + text label**. `StatusBadge`
  enforces this.
- **Type.** **Geist Sans** for all UI; **Geist Mono** for numeric readouts (temps),
  timestamps, and codes. H1 30/700, H2 24/600, H3 20/600, body 16/400, sm 14, caption
  12/500; **temperature readout in Geist Mono 24–72/600, recolored live by pass/fail**.
  Heading tracking −0.02em. **Inputs render ≥16px on mobile** (prevents iOS auto-zoom).
- **Spacing.** 4px base; scale 4·8·12·16·20·24·32·40·48·64. **Minimum touch target
  44×44px** — frontline is a priority (`--touch-target`).
- **Radius.** `--radius` 8px. Buttons/inputs **8**, cards/sheets **12**, badges/pills +
  avatars **full**.
- **Shadow.** Subtle: `sm` (cards), `md`, `lg`; dark theme prefers borders over shadows.
- **Borders.** 1px hairline in `--border` (slate-200 light / slate-700 dark) do most of
  the separating.
- **Focus ring.** Signature 3px ring at `--ring` (indigo) + border shift, on
  `:focus-visible` only. Every control.
- **Hover / press.** Hover shifts background to `--accent` (indigo-50) or `--muted`;
  press dims (`a:active/button:active` opacity). No scale/bounce.
- **Motion.** Snappy Linear feel: micro 150ms · default 200ms · sheets/modals 300ms,
  easing `cubic-bezier(0.16,1,0.3,1)` for enter. **Respect `prefers-reduced-motion`.**
  The completion flow must feel instant — no gratuitous animation.
- **Breakpoints.** Mobile-first 0 · sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536.
  Design targets phone **375–402**, desktop **1280**.
- **Cards.** White surface, 1px border, `--radius-xl` (12px), `shadow-sm`.

---

## Iconography
- **Set:** [**Lucide**](https://lucide.dev), stroke width **2**, `currentColor`. Linked
  from CDN (`unpkg.com/lucide@0.460.0`) in cards/kits; the `StatusBadge`/`TaskCard`
  components inline the exact Lucide paths so they're self-contained.
- **Sizes:** 16 inline, 20 default (buttons/nav), 24 large.
- **Check-type icons:** temperature `Thermometer`, cleaning `SprayCan`, allergen
  `Wheat`/`ShieldAlert`, opening `Sunrise`, closing `Moon`, generic `ClipboardCheck`.
- **No emoji, no unicode-glyph icons, no PNG icons.**

---

## Index / manifest

**Global CSS** (link this one file): `styles.css` →
`tokens/fonts.css` (**self-hosted** Geist + Geist Mono `.woff2` in `assets/fonts/` — GDPR: not CDN-loaded), `tokens/colors.css` (Slate + indigo ramps,
light + `.dark` semantic tokens, **status tokens**), `tokens/typography.css`,
`tokens/spacing.css` (spacing + radius + touch target), `tokens/shadows.css`.

**Components** (`window.ShadcnUiDesignSystem_fd8ccd`):
- `components/actions/` — **Button** (variants/sizes/**loading**), **Badge**
- `components/forms/` — **Input**, **Textarea**, **Label**, **Checkbox**, **Switch**, **Select**
- `components/display/` — **Card** (+ parts), **Avatar**, **Separator**, **Skeleton**
- `components/feedback/` — **Alert**, **Progress**, **Tabs**, **Toaster** (imperative toast API), **EmptyState**, **OfflineBanner** (D9)
- `components/overlays/` — **Dialog**, **Sheet** (mobile bottom-sheet), **Combobox** (searchable select), **DateRangePicker**
- `components/domain/` — **StatusBadge** (locked), **ThresholdReadout**, **NumericKeypad**, **TaskCard**, **EvidenceUpload** (idle/capturing/compressing/uploaded/error/offline-queued + SHA-256), **SignaturePad** (drawn vs typed, D4), **TimelineRow** (before→after edits)

**Foundation cards** (`guidelines/`): colors (semantic, primary, slate, **status**,
borders), type (scale, body, mono), spacing (scale, radius, shadows), brand (wordmark,
iconography).

**UI kit** (`ui_kits/shift-ledger/`): `index.html` (mobile — PIN, Today, Complete-task
`<10s`, Timeline, Exceptions), `audit-export.html` (desktop — records + export dialog
with the non-certification disclaimer), and `manager.html` (desktop console — Today
rollup, Properties, Users, Templates, Schedules). See its README.

**Other:** `SKILL.md` (Agent-Skills manifest).

---

## Known gaps / next passes
The system is feature-complete for Milestone 0: foundations, primitives, all seven
domain components, the reusable overlay/feedback set, and every screen — frontline (PIN,
Today, Complete-task, Timeline, Exceptions), audit export, and the manager console —
render in **both light and dark** (each screen has a persistent theme toggle;
`.dark` tokens drive it). Geist is self-hosted. **The only deliberate omission** is the
**⌘K command menu**, which stays a reserved nav placeholder (post-MVP, per D-decision).
