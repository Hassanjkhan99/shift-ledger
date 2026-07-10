/* @ds-bundle: {"format":3,"namespace":"ShadcnUiDesignSystem_fd8ccd","components":[{"name":"Badge","sourcePath":"components/actions/Badge.jsx"},{"name":"Button","sourcePath":"components/actions/Button.jsx"},{"name":"Avatar","sourcePath":"components/display/Avatar.jsx"},{"name":"Card","sourcePath":"components/display/Card.jsx"},{"name":"CardHeader","sourcePath":"components/display/Card.jsx"},{"name":"CardTitle","sourcePath":"components/display/Card.jsx"},{"name":"CardDescription","sourcePath":"components/display/Card.jsx"},{"name":"CardContent","sourcePath":"components/display/Card.jsx"},{"name":"CardFooter","sourcePath":"components/display/Card.jsx"},{"name":"Separator","sourcePath":"components/display/Separator.jsx"},{"name":"Skeleton","sourcePath":"components/display/Skeleton.jsx"},{"name":"EvidenceUpload","sourcePath":"components/domain/EvidenceUpload.jsx"},{"name":"NumericKeypad","sourcePath":"components/domain/NumericKeypad.jsx"},{"name":"SignaturePad","sourcePath":"components/domain/SignaturePad.jsx"},{"name":"StatusBadge","sourcePath":"components/domain/StatusBadge.jsx"},{"name":"TaskCard","sourcePath":"components/domain/TaskCard.jsx"},{"name":"ThresholdReadout","sourcePath":"components/domain/ThresholdReadout.jsx"},{"name":"TimelineRow","sourcePath":"components/domain/TimelineRow.jsx"},{"name":"Alert","sourcePath":"components/feedback/Alert.jsx"},{"name":"AlertTitle","sourcePath":"components/feedback/Alert.jsx"},{"name":"AlertDescription","sourcePath":"components/feedback/Alert.jsx"},{"name":"EmptyState","sourcePath":"components/feedback/EmptyState.jsx"},{"name":"OfflineBanner","sourcePath":"components/feedback/OfflineBanner.jsx"},{"name":"Progress","sourcePath":"components/feedback/Progress.jsx"},{"name":"Tabs","sourcePath":"components/feedback/Tabs.jsx"},{"name":"TabsList","sourcePath":"components/feedback/Tabs.jsx"},{"name":"TabsTrigger","sourcePath":"components/feedback/Tabs.jsx"},{"name":"TabsContent","sourcePath":"components/feedback/Tabs.jsx"},{"name":"Toaster","sourcePath":"components/feedback/Toaster.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Label","sourcePath":"components/forms/Label.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Textarea","sourcePath":"components/forms/Textarea.jsx"},{"name":"Combobox","sourcePath":"components/overlays/Combobox.jsx"},{"name":"DateRangePicker","sourcePath":"components/overlays/DateRangePicker.jsx"},{"name":"Dialog","sourcePath":"components/overlays/Dialog.jsx"},{"name":"DialogHeader","sourcePath":"components/overlays/Dialog.jsx"},{"name":"DialogTitle","sourcePath":"components/overlays/Dialog.jsx"},{"name":"DialogDescription","sourcePath":"components/overlays/Dialog.jsx"},{"name":"DialogBody","sourcePath":"components/overlays/Dialog.jsx"},{"name":"DialogFooter","sourcePath":"components/overlays/Dialog.jsx"},{"name":"Sheet","sourcePath":"components/overlays/Sheet.jsx"},{"name":"SheetHeader","sourcePath":"components/overlays/Sheet.jsx"},{"name":"SheetTitle","sourcePath":"components/overlays/Sheet.jsx"},{"name":"SheetDescription","sourcePath":"components/overlays/Sheet.jsx"},{"name":"SheetBody","sourcePath":"components/overlays/Sheet.jsx"},{"name":"SheetFooter","sourcePath":"components/overlays/Sheet.jsx"}],"sourceHashes":{"components/actions/Badge.jsx":"56f022bd108a","components/actions/Button.jsx":"13fc6297b7a7","components/display/Avatar.jsx":"846bb1a9fc78","components/display/Card.jsx":"c0a752bb02de","components/display/Separator.jsx":"f5475f688d0d","components/display/Skeleton.jsx":"a792cc87e2a9","components/domain/EvidenceUpload.jsx":"b046e801d46e","components/domain/NumericKeypad.jsx":"b2237788dac3","components/domain/SignaturePad.jsx":"86b84bc4ba81","components/domain/StatusBadge.jsx":"1d4187e0e66a","components/domain/TaskCard.jsx":"693805bf3ac0","components/domain/ThresholdReadout.jsx":"c9bf4fbead81","components/domain/TimelineRow.jsx":"8120aaf82297","components/feedback/Alert.jsx":"46a1742ab864","components/feedback/EmptyState.jsx":"505e02034173","components/feedback/OfflineBanner.jsx":"ad848ef597c4","components/feedback/Progress.jsx":"d2091a97a40d","components/feedback/Tabs.jsx":"8f2dbab6758b","components/feedback/Toaster.jsx":"38430f1b224f","components/forms/Checkbox.jsx":"c9101f3e62a9","components/forms/Input.jsx":"72a23f86c6f7","components/forms/Label.jsx":"37ce12844f87","components/forms/Select.jsx":"86f4f0ff24b9","components/forms/Switch.jsx":"9f524ae0718f","components/forms/Textarea.jsx":"ebd4d2056b2d","components/overlays/Combobox.jsx":"400ddcdd3121","components/overlays/DateRangePicker.jsx":"3bd45afc16b0","components/overlays/Dialog.jsx":"04097570157a","components/overlays/Sheet.jsx":"5f345e01612e"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.ShadcnUiDesignSystem_fd8ccd = window.ShadcnUiDesignSystem_fd8ccd || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/actions/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.scn-badge{display:inline-flex;width:fit-content;align-items:center;justify-content:center;gap:.25rem;overflow:hidden;border-radius:var(--radius-full);border:1px solid transparent;padding:.125rem .5rem;font-family:var(--font-sans);font-size:var(--text-xs);line-height:1rem;font-weight:var(--font-weight-medium);white-space:nowrap}
.scn-badge svg{width:.75rem;height:.75rem;pointer-events:none}
.scn-badge-v-default{background:var(--primary);color:var(--primary-foreground)}
.scn-badge-v-secondary{background:var(--secondary);color:var(--secondary-foreground)}
.scn-badge-v-destructive{background:var(--destructive);color:#fff}
.scn-badge-v-outline{border-color:var(--border);color:var(--foreground)}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}

/**
 * Badge — a small pill for status, counts, and labels.
 */
function Badge({
  variant = "default",
  className = "",
  children,
  ...props
}) {
  ensureStyle("scn-badge-css", CSS);
  const cls = ["scn-badge", `scn-badge-v-${variant}`, className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("span", _extends({
    "data-slot": "badge",
    className: cls
  }, props), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/Badge.jsx", error: String((e && e.message) || e) }); }

// components/actions/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.scn-btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;white-space:nowrap;border-radius:var(--radius-md);font-family:var(--font-sans);font-size:var(--text-sm);line-height:1.25rem;font-weight:var(--font-weight-medium);transition:background-color .15s ease,color .15s ease,box-shadow .15s ease,opacity .15s ease;cursor:pointer;border:1px solid transparent;outline:none;user-select:none;flex-shrink:0}
.scn-btn:focus-visible{border-color:var(--ring);box-shadow:0 0 0 3px color-mix(in oklab,var(--ring) 50%,transparent)}
.scn-btn:disabled{pointer-events:none;opacity:.5}
.scn-btn svg{width:1rem;height:1rem;flex-shrink:0;pointer-events:none}
.scn-btn:active{opacity:.9}
.scn-btn--default{height:2.25rem;padding:0 1rem}
.scn-btn--default:has(>svg){padding:0 .75rem}
.scn-btn--sm{height:2rem;padding:0 .75rem;gap:.375rem}
.scn-btn--lg{height:2.5rem;padding:0 1.5rem}
.scn-btn--icon{height:2.25rem;width:2.25rem;padding:0}
.scn-btn-v-default{background:var(--primary);color:var(--primary-foreground)}
.scn-btn-v-default:hover{background:color-mix(in oklab,var(--primary) 90%,transparent)}
.scn-btn-v-destructive{background:var(--destructive);color:#fff}
.scn-btn-v-destructive:hover{background:color-mix(in oklab,var(--destructive) 90%,transparent)}
.scn-btn-v-outline{border-color:var(--border);background:var(--background);box-shadow:var(--shadow-xs);color:var(--foreground)}
.scn-btn-v-outline:hover{background:var(--accent);color:var(--accent-foreground)}
.scn-btn-v-secondary{background:var(--secondary);color:var(--secondary-foreground)}
.scn-btn-v-secondary:hover{background:color-mix(in oklab,var(--secondary) 80%,transparent)}
.scn-btn-v-ghost{background:transparent;color:var(--foreground)}
.scn-btn-v-ghost:hover{background:var(--accent);color:var(--accent-foreground)}
.scn-btn-v-link{background:transparent;color:var(--primary);text-underline-offset:4px}
.scn-btn-v-link:hover{text-decoration:underline}
.scn-btn__spinner{width:1rem;height:1rem;flex-shrink:0;animation:scn-spin .7s linear infinite}
@keyframes scn-spin{to{transform:rotate(360deg)}}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}

/**
 * Button — the primary action element. Mirrors shadcn/ui variants + sizes.
 */
function Button({
  variant = "default",
  size = "default",
  loading = false,
  disabled = false,
  className = "",
  children,
  ...props
}) {
  ensureStyle("scn-btn-css", CSS);
  const cls = ["scn-btn", `scn-btn--${size}`, `scn-btn-v-${variant}`, className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("button", _extends({
    "data-slot": "button",
    className: cls,
    disabled: disabled || loading,
    "aria-busy": loading || undefined
  }, props), loading && /*#__PURE__*/React.createElement("svg", {
    className: "scn-btn__spinner",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M21 12a9 9 0 1 1-6.219-8.56"
  })), children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/Button.jsx", error: String((e && e.message) || e) }); }

// components/display/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.scn-avatar{position:relative;display:inline-flex;height:2.5rem;width:2.5rem;flex-shrink:0;overflow:hidden;border-radius:var(--radius-full);user-select:none;vertical-align:middle}
.scn-avatar img{width:100%;height:100%;object-fit:cover;display:block}
.scn-avatar-fallback{display:flex;width:100%;height:100%;align-items:center;justify-content:center;background:var(--muted);color:var(--muted-foreground);font-size:var(--text-sm);font-weight:var(--font-weight-medium)}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}

/** Avatar — a rounded user image with an initials fallback. */
function Avatar({
  src,
  alt = "",
  fallback,
  size = 40,
  className = "",
  ...props
}) {
  ensureStyle("scn-avatar-css", CSS);
  const [errored, setErrored] = React.useState(false);
  const showImg = src && !errored;
  return /*#__PURE__*/React.createElement("span", _extends({
    "data-slot": "avatar",
    className: ["scn-avatar", className].filter(Boolean).join(" "),
    style: {
      width: size,
      height: size
    }
  }, props), showImg ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: alt,
    onError: () => setErrored(true)
  }) : /*#__PURE__*/React.createElement("span", {
    className: "scn-avatar-fallback"
  }, fallback || alt.slice(0, 2).toUpperCase()));
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/display/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.scn-card{display:flex;flex-direction:column;gap:1.5rem;border-radius:var(--radius-xl);border:1px solid var(--border);background:var(--card);color:var(--card-foreground);padding:1.5rem 0;box-shadow:var(--shadow-sm)}
.scn-card-header{display:grid;grid-auto-rows:min-content;gap:.375rem;padding:0 1.5rem}
.scn-card-title{font-weight:var(--font-weight-semibold);line-height:1;font-size:var(--text-base)}
.scn-card-desc{font-size:var(--text-sm);color:var(--muted-foreground);line-height:1.25rem}
.scn-card-content{padding:0 1.5rem}
.scn-card-footer{display:flex;align-items:center;gap:.5rem;padding:0 1.5rem}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}
function cx(base, className) {
  return [base, className].filter(Boolean).join(" ");
}

/** Card — a bordered surface container. Compose with the CardHeader/Title/Description/Content/Footer parts. */
function Card({
  className = "",
  children,
  ...props
}) {
  ensureStyle("scn-card-css", CSS);
  return /*#__PURE__*/React.createElement("div", _extends({
    "data-slot": "card",
    className: cx("scn-card", className)
  }, props), children);
}
function CardHeader({
  className = "",
  children,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    "data-slot": "card-header",
    className: cx("scn-card-header", className)
  }, props), children);
}
function CardTitle({
  className = "",
  children,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    "data-slot": "card-title",
    className: cx("scn-card-title", className)
  }, props), children);
}
function CardDescription({
  className = "",
  children,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    "data-slot": "card-description",
    className: cx("scn-card-desc", className)
  }, props), children);
}
function CardContent({
  className = "",
  children,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    "data-slot": "card-content",
    className: cx("scn-card-content", className)
  }, props), children);
}
function CardFooter({
  className = "",
  children,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    "data-slot": "card-footer",
    className: cx("scn-card-footer", className)
  }, props), children);
}
Object.assign(__ds_scope, { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Card.jsx", error: String((e && e.message) || e) }); }

// components/display/Separator.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.scn-separator{background:var(--border);flex-shrink:0;border:0}
.scn-separator[data-orientation=horizontal]{height:1px;width:100%}
.scn-separator[data-orientation=vertical]{width:1px;height:100%;align-self:stretch}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}

/** Separator — a thin divider line, horizontal or vertical. */
function Separator({
  orientation = "horizontal",
  className = "",
  ...props
}) {
  ensureStyle("scn-separator-css", CSS);
  return /*#__PURE__*/React.createElement("div", _extends({
    "data-slot": "separator",
    role: "separator",
    "data-orientation": orientation,
    className: ["scn-separator", className].filter(Boolean).join(" ")
  }, props));
}
Object.assign(__ds_scope, { Separator });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Separator.jsx", error: String((e && e.message) || e) }); }

// components/display/Skeleton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.scn-skeleton{background:var(--accent);border-radius:var(--radius-md);animation:scn-pulse 1.6s cubic-bezier(.4,0,.6,1) infinite}
@keyframes scn-pulse{50%{opacity:.5}}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}

/** Skeleton — an animated placeholder block for loading states. */
function Skeleton({
  className = "",
  style,
  ...props
}) {
  ensureStyle("scn-skeleton-css", CSS);
  return /*#__PURE__*/React.createElement("div", _extends({
    "data-slot": "skeleton",
    className: ["scn-skeleton", className].filter(Boolean).join(" "),
    style: style
  }, props));
}
Object.assign(__ds_scope, { Skeleton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Skeleton.jsx", error: String((e && e.message) || e) }); }

// components/domain/NumericKeypad.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.sl-keypad{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;width:100%;max-width:320px}
.sl-key{height:56px;min-height:var(--touch-target);display:flex;align-items:center;justify-content:center;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--card);color:var(--foreground);font-family:var(--font-mono);font-size:22px;font-weight:600;cursor:pointer;user-select:none;transition:background .12s ease,border-color .12s ease,opacity .12s ease;-webkit-tap-highlight-color:transparent}
.sl-key:hover{background:var(--accent)}
.sl-key:active{background:var(--muted);opacity:.7}
.sl-key:focus-visible{outline:none;border-color:var(--ring);box-shadow:0 0 0 3px color-mix(in oklab,var(--ring) 40%,transparent)}
.sl-key--util{font-size:15px;font-weight:500;color:var(--muted-foreground)}
.sl-key svg{width:22px;height:22px}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}

/**
 * NumericKeypad — large on-screen keypad for entering temperatures (44px+ targets).
 * Controlled: holds nothing itself; `value` is the current string, `onChange` gets
 * the next string. Supports negatives (freezer) via ± and a single decimal point.
 */
function NumericKeypad({
  value = "",
  onChange,
  allowNegative = true,
  allowDecimal = true,
  className = "",
  ...props
}) {
  ensureStyle("sl-keypad-css", CSS);
  const set = next => onChange && onChange(next);
  const press = k => {
    const v = String(value);
    if (k === "back") return set(v.slice(0, -1));
    if (k === "sign") {
      if (!allowNegative) return;
      return set(v.startsWith("-") ? v.slice(1) : "-" + v);
    }
    if (k === ".") {
      if (!allowDecimal || v.includes(".")) return;
      return set(v === "" || v === "-" ? v + "0." : v + ".");
    }
    // digit — cap length to keep readout sane
    if (v.replace("-", "").replace(".", "").length >= 5) return;
    set(v + k);
  };
  const Key = ({
    k,
    children,
    util
  }) => /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: ["sl-key", util ? "sl-key--util" : ""].filter(Boolean).join(" "),
    onClick: () => press(k),
    "aria-label": typeof children === "string" ? children : k
  }, children);
  return /*#__PURE__*/React.createElement("div", _extends({
    "data-slot": "numeric-keypad",
    className: ["sl-keypad", className].filter(Boolean).join(" ")
  }, props), ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(n => /*#__PURE__*/React.createElement(Key, {
    key: n,
    k: n
  }, n)), /*#__PURE__*/React.createElement(Key, {
    k: "sign",
    util: true
  }, "\xB1"), /*#__PURE__*/React.createElement(Key, {
    k: "0"
  }, "0"), allowDecimal ? /*#__PURE__*/React.createElement(Key, {
    k: "."
  }, ".") : /*#__PURE__*/React.createElement(Key, {
    k: "back",
    util: true
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m18 9-6 6"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m12 9 6 6"
  }))), allowDecimal && /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "sl-key sl-key--util",
    onClick: () => press("back"),
    "aria-label": "Backspace",
    style: {
      gridColumn: "1 / -1"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m18 9-6 6"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m12 9 6 6"
  }))));
}
Object.assign(__ds_scope, { NumericKeypad });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/domain/NumericKeypad.jsx", error: String((e && e.message) || e) }); }

// components/domain/SignaturePad.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.sl-sig{width:100%;font-family:var(--font-sans);display:flex;flex-direction:column;gap:10px}
.sl-sig__toggle{display:flex;gap:6px;background:var(--muted);padding:3px;border-radius:var(--radius-md);width:fit-content}
.sl-sig__tab{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:var(--radius-sm);border:none;background:transparent;color:var(--muted-foreground);font-family:var(--font-sans);font-size:13px;font-weight:500;cursor:pointer}
.sl-sig__tab svg{width:15px;height:15px}
.sl-sig__tab[aria-selected=true]{background:var(--background);color:var(--foreground);box-shadow:var(--shadow-sm)}
.sl-sig__canvas-wrap{position:relative;border:1px solid var(--input);border-radius:var(--radius-lg);background:var(--card);overflow:hidden;touch-action:none}
.sl-sig__canvas{display:block;width:100%;height:150px;cursor:crosshair}
.sl-sig__base{position:absolute;left:0;right:0;bottom:34px;border-top:1px dashed var(--border);pointer-events:none}
.sl-sig__ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--muted-foreground);font-size:14px;pointer-events:none}
.sl-sig__clear{position:absolute;top:8px;right:8px;display:inline-flex;align-items:center;gap:5px;padding:5px 9px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--card);color:var(--muted-foreground);font-size:12px;font-weight:500;cursor:pointer}
.sl-sig__clear svg{width:13px;height:13px}
.sl-sig__typed{display:flex;flex-direction:column;gap:8px}
.sl-sig__input{height:48px;border-radius:var(--radius-md);border:1px solid var(--input);background:transparent;padding:0 14px;font-family:var(--font-sans);font-size:16px;font-weight:500;color:var(--foreground);outline:none;box-shadow:var(--shadow-xs);text-transform:uppercase;letter-spacing:.08em}
.sl-sig__input:focus-visible{border-color:var(--ring);box-shadow:0 0 0 3px color-mix(in oklab,var(--ring) 40%,transparent)}
.sl-sig__preview{height:80px;border-radius:var(--radius-lg);border:1px solid var(--border);background:var(--surface);display:flex;align-items:center;justify-content:center}
.sl-sig__preview span{font-family:var(--font-mono);font-size:34px;font-weight:600;letter-spacing:.12em;color:var(--foreground)}
.sl-sig__preview .ph{font-family:var(--font-sans);font-size:14px;font-weight:400;letter-spacing:0;color:var(--muted-foreground)}
.sl-sig__note{font-size:12px;color:var(--muted-foreground);display:flex;align-items:center;gap:6px}
.sl-sig__note svg{width:13px;height:13px;flex-shrink:0}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}
const I = p => /*#__PURE__*/React.createElement("svg", _extends({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, p));
const PEN = /*#__PURE__*/React.createElement(I, null, /*#__PURE__*/React.createElement("path", {
  d: "M12 20h9"
}), /*#__PURE__*/React.createElement("path", {
  d: "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"
}));
const TYPE = /*#__PURE__*/React.createElement(I, null, /*#__PURE__*/React.createElement("polyline", {
  points: "4 7 4 4 20 4 20 7"
}), /*#__PURE__*/React.createElement("line", {
  x1: "9",
  y1: "20",
  x2: "15",
  y2: "20"
}), /*#__PURE__*/React.createElement("line", {
  x1: "12",
  y1: "4",
  x2: "12",
  y2: "20"
}));
const CLEAR = /*#__PURE__*/React.createElement(I, null, /*#__PURE__*/React.createElement("path", {
  d: "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"
}));
const PAPERCLIP = /*#__PURE__*/React.createElement(I, null, /*#__PURE__*/React.createElement("path", {
  d: "m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"
}));
const INFO = /*#__PURE__*/React.createElement(I, null, /*#__PURE__*/React.createElement("circle", {
  cx: "12",
  cy: "12",
  r: "10"
}), /*#__PURE__*/React.createElement("path", {
  d: "M12 16v-4M12 8h.01"
}));

/**
 * SignaturePad — sign-off with an explicit mode choice (decision D4): DRAW a signature
 * (produces an image attachment) or TYPE initials (no attachment). The mode is never
 * collapsed — the segmented toggle always makes the current mode explicit.
 */
function SignaturePad({
  defaultMode = "drawn",
  allowedModes = ["drawn", "typed"],
  onChange,
  className = "",
  ...props
}) {
  ensureStyle("sl-sig-css", CSS);
  const [mode, setMode] = React.useState(allowedModes.includes(defaultMode) ? defaultMode : allowedModes[0]);
  const [initials, setInitials] = React.useState("");
  const [hasInk, setHasInk] = React.useState(false);
  const canvasRef = React.useRef(null);
  const drawing = React.useRef(false);
  const last = React.useRef(null);
  React.useEffect(() => {
    if (mode !== "drawn") return;
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = cv.getBoundingClientRect();
    cv.width = rect.width * dpr;
    cv.height = rect.height * dpr;
    const ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = getComputedStyle(cv).getPropertyValue("--foreground") || "#0f172a";
  }, [mode]);
  const pos = e => {
    const r = canvasRef.current.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return {
      x: p.clientX - r.left,
      y: p.clientY - r.top
    };
  };
  const start = e => {
    e.preventDefault();
    drawing.current = true;
    last.current = pos(e);
  };
  const move = e => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!hasInk) setHasInk(true);
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (onChange && canvasRef.current) {
      onChange({
        mode: "drawn",
        dataUrl: canvasRef.current.toDataURL("image/png"),
        hasAttachment: true
      });
    }
  };
  const clear = () => {
    const cv = canvasRef.current;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    setHasInk(false);
    if (onChange) onChange({
      mode: "drawn",
      dataUrl: null,
      hasAttachment: true
    });
  };
  const onType = e => {
    const v = e.target.value.toUpperCase().slice(0, 4);
    setInitials(v);
    if (onChange) onChange({
      mode: "typed",
      initials: v,
      hasAttachment: false
    });
  };
  const pick = m => {
    setMode(m);
    if (onChange) onChange(m === "typed" ? {
      mode: "typed",
      initials,
      hasAttachment: false
    } : {
      mode: "drawn",
      dataUrl: hasInk && canvasRef.current ? canvasRef.current.toDataURL("image/png") : null,
      hasAttachment: true
    });
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    "data-slot": "signature-pad",
    "data-mode": mode,
    className: ["sl-sig", className].filter(Boolean).join(" ")
  }, props), allowedModes.length > 1 && /*#__PURE__*/React.createElement("div", {
    className: "sl-sig__toggle",
    role: "tablist"
  }, /*#__PURE__*/React.createElement("button", {
    role: "tab",
    "aria-selected": mode === "drawn",
    className: "sl-sig__tab",
    onClick: () => pick("drawn")
  }, PEN, " Draw"), /*#__PURE__*/React.createElement("button", {
    role: "tab",
    "aria-selected": mode === "typed",
    className: "sl-sig__tab",
    onClick: () => pick("typed")
  }, TYPE, " Type initials")), mode === "drawn" ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "sl-sig__canvas-wrap"
  }, /*#__PURE__*/React.createElement("canvas", {
    ref: canvasRef,
    className: "sl-sig__canvas",
    onMouseDown: start,
    onMouseMove: move,
    onMouseUp: end,
    onMouseLeave: end,
    onTouchStart: start,
    onTouchMove: move,
    onTouchEnd: end
  }), /*#__PURE__*/React.createElement("div", {
    className: "sl-sig__base"
  }), !hasInk && /*#__PURE__*/React.createElement("div", {
    className: "sl-sig__ph"
  }, "Sign here with your finger or a stylus"), hasInk && /*#__PURE__*/React.createElement("button", {
    className: "sl-sig__clear",
    onClick: clear
  }, CLEAR, " Clear")), /*#__PURE__*/React.createElement("div", {
    className: "sl-sig__note"
  }, PAPERCLIP, " Saved as a signature image attached to this record.")) : /*#__PURE__*/React.createElement("div", {
    className: "sl-sig__typed"
  }, /*#__PURE__*/React.createElement("input", {
    className: "sl-sig__input",
    value: initials,
    onChange: onType,
    placeholder: "Your initials",
    maxLength: 4,
    "aria-label": "Initials"
  }), /*#__PURE__*/React.createElement("div", {
    className: "sl-sig__preview"
  }, initials ? /*#__PURE__*/React.createElement("span", null, initials) : /*#__PURE__*/React.createElement("span", {
    className: "ph"
  }, "Preview")), /*#__PURE__*/React.createElement("div", {
    className: "sl-sig__note"
  }, INFO, " Typed initials are recorded as text \u2014 no image attachment.")));
}
Object.assign(__ds_scope, { SignaturePad });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/domain/SignaturePad.jsx", error: String((e && e.message) || e) }); }

// components/domain/StatusBadge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.sl-badge{display:inline-flex;align-items:center;gap:6px;border-radius:var(--radius-full);border:1px solid transparent;font-family:var(--font-sans);font-weight:500;white-space:nowrap;width:fit-content;line-height:1}
.sl-badge svg{flex-shrink:0}
.sl-badge--md{padding:5px 11px 5px 9px;font-size:13px}
.sl-badge--md svg{width:15px;height:15px}
.sl-badge--sm{padding:3px 8px 3px 7px;font-size:12px}
.sl-badge--sm svg{width:13px;height:13px}
.sl-badge--pass{background:var(--status-pass-bg);color:var(--status-pass-fg)}
.sl-badge--fail{background:var(--status-fail-bg);color:var(--status-fail-fg)}
.sl-badge--overdue{background:var(--status-overdue-bg);color:var(--status-overdue-fg)}
.sl-badge--pending{background:var(--status-pending-bg);color:var(--status-pending-fg)}
.sl-badge--critical{background:var(--status-critical-bg);color:var(--status-critical-fg);border-color:var(--status-critical)}
.sl-badge--info{background:var(--status-info-bg);color:var(--status-info-fg)}
.sl-badge--solid.sl-badge--pass{background:var(--status-pass);color:#fff}
.sl-badge--solid.sl-badge--fail{background:var(--status-fail);color:#fff}
.sl-badge--solid.sl-badge--overdue{background:var(--status-overdue);color:#fff}
.sl-badge--solid.sl-badge--pending{background:var(--status-pending);color:#fff}
.sl-badge--solid.sl-badge--critical{background:var(--status-critical);color:#fff}
.sl-badge--solid.sl-badge--info{background:var(--status-info);color:#fff}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}
const P = props => /*#__PURE__*/React.createElement("svg", _extends({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2.25",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, props));
const ICONS = {
  pass: /*#__PURE__*/React.createElement(P, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m9 12 2 2 4-4"
  })),
  fail: /*#__PURE__*/React.createElement(P, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m15 9-6 6"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m9 9 6 6"
  })),
  overdue: /*#__PURE__*/React.createElement(P, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "8",
    x2: "12",
    y2: "12"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "16",
    x2: "12.01",
    y2: "16"
  })),
  pending: /*#__PURE__*/React.createElement(P, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  })),
  critical: /*#__PURE__*/React.createElement(P, null, /*#__PURE__*/React.createElement("path", {
    d: "M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "8",
    x2: "12",
    y2: "12"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "16",
    x2: "12.01",
    y2: "16"
  })),
  info: /*#__PURE__*/React.createElement(P, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 16v-4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 8h.01"
  }))
};
const DEFAULT_LABELS = {
  pass: "Pass",
  fail: "Fail",
  overdue: "Overdue",
  pending: "Pending",
  critical: "Critical",
  info: "Info"
};

/** StatusBadge — the LOCKED compliance status pill: always color + icon + label. */
function StatusBadge({
  status = "pending",
  size = "md",
  solid = false,
  children,
  className = "",
  ...props
}) {
  ensureStyle("sl-badge-css", CSS);
  const cls = ["sl-badge", `sl-badge--${size}`, `sl-badge--${status}`, solid ? "sl-badge--solid" : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("span", _extends({
    "data-slot": "status-badge",
    "data-status": status,
    className: cls
  }, props), ICONS[status], children || DEFAULT_LABELS[status]);
}
Object.assign(__ds_scope, { StatusBadge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/domain/StatusBadge.jsx", error: String((e && e.message) || e) }); }

// components/domain/EvidenceUpload.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.sl-ev{width:100%;font-family:var(--font-sans)}
.sl-ev__drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:20px;border:1px dashed var(--border);border-radius:var(--radius-lg);background:var(--surface);text-align:center}
.sl-ev__drop-ic{width:40px;height:40px;border-radius:var(--radius-md);background:var(--accent);color:var(--primary);display:flex;align-items:center;justify-content:center}
.sl-ev__drop-ic svg{width:21px;height:21px}
.sl-ev__hint{font-size:13px;color:var(--muted-foreground)}
.sl-ev__actions{display:flex;gap:8px;width:100%;margin-top:2px}
.sl-ev__btn{flex:1;min-height:var(--touch-target);height:44px;display:inline-flex;align-items:center;justify-content:center;gap:7px;border-radius:var(--radius-md);font-family:var(--font-sans);font-size:14px;font-weight:500;cursor:pointer;border:1px solid transparent}
.sl-ev__btn svg{width:17px;height:17px}
.sl-ev__btn--primary{background:var(--primary);color:var(--primary-foreground)}
.sl-ev__btn--primary:hover{background:color-mix(in oklab,var(--primary) 90%,transparent)}
.sl-ev__btn--outline{background:var(--card);border-color:var(--border);color:var(--foreground)}
.sl-ev__btn--outline:hover{background:var(--accent)}
.sl-ev__row{display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--card)}
.sl-ev__thumb{width:52px;height:52px;border-radius:var(--radius-md);background:var(--muted);flex-shrink:0;object-fit:cover;display:flex;align-items:center;justify-content:center;color:var(--muted-foreground);overflow:hidden}
.sl-ev__thumb img{width:100%;height:100%;object-fit:cover}
.sl-ev__thumb svg{width:22px;height:22px}
.sl-ev__meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.sl-ev__name{font-size:14px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sl-ev__sub{font-size:12px;color:var(--muted-foreground);display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.sl-ev__sub svg{width:12px;height:12px}
.sl-ev__hash{font-family:var(--font-mono);font-size:11px;color:var(--muted-foreground);background:var(--muted);padding:2px 6px;border-radius:var(--radius-sm);display:inline-flex;align-items:center;gap:4px}
.sl-ev__hash svg{width:11px;height:11px}
.sl-ev__bar{height:6px;border-radius:var(--radius-full);background:var(--muted);overflow:hidden;margin-top:2px}
.sl-ev__bar-fill{height:100%;background:var(--primary);border-radius:inherit;transition:width .2s ease}
.sl-ev__ico-btn{width:34px;height:34px;flex-shrink:0;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--card);color:var(--muted-foreground);display:flex;align-items:center;justify-content:center;cursor:pointer}
.sl-ev__ico-btn:hover{background:var(--muted);color:var(--foreground)}
.sl-ev__ico-btn svg{width:16px;height:16px}
.sl-ev__spin{width:20px;height:20px;color:var(--primary);animation:sl-ev-spin .7s linear infinite}
@keyframes sl-ev-spin{to{transform:rotate(360deg)}}
.sl-ev__ok{color:var(--status-pass-fg);font-weight:500;display:inline-flex;align-items:center;gap:5px}
.sl-ev__ok svg{width:13px;height:13px}
.sl-ev__err{color:var(--status-fail-fg);font-weight:500;display:inline-flex;align-items:center;gap:5px}
.sl-ev__err svg{width:13px;height:13px}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}
const I = p => /*#__PURE__*/React.createElement("svg", _extends({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, p));
const ICON = {
  camera: /*#__PURE__*/React.createElement(I, null, /*#__PURE__*/React.createElement("path", {
    d: "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "13",
    r: "3"
  })),
  upload: /*#__PURE__*/React.createElement(I, null, /*#__PURE__*/React.createElement("path", {
    d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
  }), /*#__PURE__*/React.createElement("polyline", {
    points: "17 8 12 3 7 8"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "3",
    x2: "12",
    y2: "15"
  })),
  image: /*#__PURE__*/React.createElement(I, null, /*#__PURE__*/React.createElement("rect", {
    width: "18",
    height: "18",
    x: "3",
    y: "3",
    rx: "2"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "9",
    cy: "9",
    r: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"
  })),
  check: /*#__PURE__*/React.createElement(I, null, /*#__PURE__*/React.createElement("path", {
    d: "M20 6 9 17l-5-5"
  })),
  retry: /*#__PURE__*/React.createElement(I, null, /*#__PURE__*/React.createElement("path", {
    d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M3 3v5h5"
  })),
  cloudOff: /*#__PURE__*/React.createElement(I, null, /*#__PURE__*/React.createElement("path", {
    d: "m2 2 20 20"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07"
  })),
  alert: /*#__PURE__*/React.createElement(I, null, /*#__PURE__*/React.createElement("path", {
    d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 9v4M12 17h.01"
  })),
  x: /*#__PURE__*/React.createElement(I, null, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18M6 6l12 12"
  })),
  lock: /*#__PURE__*/React.createElement(I, null, /*#__PURE__*/React.createElement("rect", {
    width: "18",
    height: "11",
    x: "3",
    y: "11",
    rx: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M7 11V7a5 5 0 0 1 10 0v4"
  })),
  alarm: /*#__PURE__*/React.createElement(I, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "13",
    r: "8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 9v4l2 2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M5 3 2 6M22 6l-3-3"
  }))
};

/**
 * EvidenceUpload — camera-first photo evidence widget, across its full lifecycle.
 * On finalize a SHA-256 is computed over the (client-compressed WebP) bytes and shown,
 * so the record is tamper-evident. Offline captures are queued and marked pending-sync.
 */
function EvidenceUpload({
  state = "idle",
  fileName = "evidence.webp",
  fileSize = "",
  thumbSrc = null,
  progress = 0,
  hash = "",
  onTakePhoto,
  onChooseFile,
  onRetry,
  onRemove,
  className = "",
  ...props
}) {
  ensureStyle("sl-ev-css", CSS);
  const thumb = /*#__PURE__*/React.createElement("span", {
    className: "sl-ev__thumb"
  }, thumbSrc ? /*#__PURE__*/React.createElement("img", {
    src: thumbSrc,
    alt: ""
  }) : ICON.image);
  let body;
  if (state === "idle") {
    body = /*#__PURE__*/React.createElement("div", {
      className: "sl-ev__drop"
    }, /*#__PURE__*/React.createElement("span", {
      className: "sl-ev__drop-ic"
    }, ICON.camera), /*#__PURE__*/React.createElement("span", {
      className: "sl-ev__hint"
    }, "Add a photo as evidence for this check"), /*#__PURE__*/React.createElement("div", {
      className: "sl-ev__actions"
    }, /*#__PURE__*/React.createElement("button", {
      className: "sl-ev__btn sl-ev__btn--primary",
      onClick: onTakePhoto
    }, ICON.camera, " Take photo"), /*#__PURE__*/React.createElement("button", {
      className: "sl-ev__btn sl-ev__btn--outline",
      onClick: onChooseFile
    }, ICON.upload, " Choose file")));
  } else if (state === "capturing") {
    body = /*#__PURE__*/React.createElement("div", {
      className: "sl-ev__row"
    }, /*#__PURE__*/React.createElement("span", {
      className: "sl-ev__thumb"
    }, /*#__PURE__*/React.createElement("svg", {
      className: "sl-ev__spin",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2.5",
      strokeLinecap: "round"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M21 12a9 9 0 1 1-6.219-8.56"
    }))), /*#__PURE__*/React.createElement("div", {
      className: "sl-ev__meta"
    }, /*#__PURE__*/React.createElement("span", {
      className: "sl-ev__name"
    }, "Opening camera\u2026"), /*#__PURE__*/React.createElement("span", {
      className: "sl-ev__sub"
    }, "Point at the reading or label")));
  } else if (state === "compressing") {
    body = /*#__PURE__*/React.createElement("div", {
      className: "sl-ev__row"
    }, thumb, /*#__PURE__*/React.createElement("div", {
      className: "sl-ev__meta"
    }, /*#__PURE__*/React.createElement("span", {
      className: "sl-ev__name"
    }, fileName), /*#__PURE__*/React.createElement("span", {
      className: "sl-ev__sub"
    }, "Compressing to WebP\u2026 ", Math.round(progress), "%"), /*#__PURE__*/React.createElement("div", {
      className: "sl-ev__bar"
    }, /*#__PURE__*/React.createElement("div", {
      className: "sl-ev__bar-fill",
      style: {
        width: `${progress}%`
      }
    }))));
  } else if (state === "uploaded") {
    body = /*#__PURE__*/React.createElement("div", {
      className: "sl-ev__row"
    }, thumb, /*#__PURE__*/React.createElement("div", {
      className: "sl-ev__meta"
    }, /*#__PURE__*/React.createElement("span", {
      className: "sl-ev__name"
    }, fileName), /*#__PURE__*/React.createElement("span", {
      className: "sl-ev__sub"
    }, /*#__PURE__*/React.createElement("span", {
      className: "sl-ev__ok"
    }, ICON.check, " Uploaded"), fileSize ? /*#__PURE__*/React.createElement("span", null, "\xB7 ", fileSize) : null), hash ? /*#__PURE__*/React.createElement("span", {
      className: "sl-ev__hash"
    }, ICON.lock, " SHA-256 ", hash.slice(0, 10), "\u2026") : null), /*#__PURE__*/React.createElement("button", {
      className: "sl-ev__ico-btn",
      onClick: onRemove,
      "aria-label": "Remove"
    }, ICON.x));
  } else if (state === "error") {
    body = /*#__PURE__*/React.createElement("div", {
      className: "sl-ev__row",
      style: {
        borderColor: "var(--status-fail)"
      }
    }, thumb, /*#__PURE__*/React.createElement("div", {
      className: "sl-ev__meta"
    }, /*#__PURE__*/React.createElement("span", {
      className: "sl-ev__name"
    }, fileName), /*#__PURE__*/React.createElement("span", {
      className: "sl-ev__sub"
    }, /*#__PURE__*/React.createElement("span", {
      className: "sl-ev__err"
    }, ICON.alert, " Upload failed"))), /*#__PURE__*/React.createElement("button", {
      className: "sl-ev__btn sl-ev__btn--outline",
      style: {
        flex: "none",
        width: "auto",
        padding: "0 12px",
        height: 34
      },
      onClick: onRetry
    }, ICON.retry, " Retry"));
  } else if (state === "offline-queued") {
    body = /*#__PURE__*/React.createElement("div", {
      className: "sl-ev__row"
    }, thumb, /*#__PURE__*/React.createElement("div", {
      className: "sl-ev__meta"
    }, /*#__PURE__*/React.createElement("span", {
      className: "sl-ev__name"
    }, fileName), /*#__PURE__*/React.createElement("span", {
      className: "sl-ev__sub"
    }, ICON.cloudOff, " Queued \u2014 will sync when back online")), /*#__PURE__*/React.createElement(__ds_scope.StatusBadge, {
      status: "pending",
      size: "sm"
    }, "Queued"));
  }
  return /*#__PURE__*/React.createElement("div", _extends({
    "data-slot": "evidence-upload",
    "data-state": state,
    className: ["sl-ev", className].filter(Boolean).join(" ")
  }, props), body);
}
Object.assign(__ds_scope, { EvidenceUpload });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/domain/EvidenceUpload.jsx", error: String((e && e.message) || e) }); }

// components/domain/TaskCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.sl-task{display:flex;align-items:center;gap:13px;padding:13px 14px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-xl);min-height:var(--touch-target);cursor:pointer;text-align:left;width:100%;font-family:var(--font-sans);transition:border-color .15s ease,box-shadow .15s ease,opacity .15s ease}
.sl-task:hover{border-color:var(--slate-300);box-shadow:var(--shadow-sm)}
.sl-task:focus-visible{outline:none;border-color:var(--ring);box-shadow:0 0 0 3px color-mix(in oklab,var(--ring) 35%,transparent)}
.sl-task:active{opacity:.7}
.sl-task--done{opacity:.62}
.sl-task__chip{width:40px;height:40px;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--muted);color:var(--muted-foreground)}
.sl-task__chip svg{width:20px;height:20px}
.sl-task--overdue .sl-task__chip{background:var(--status-overdue-bg);color:var(--status-overdue-fg)}
.sl-task--failed .sl-task__chip{background:var(--status-fail-bg);color:var(--status-fail-fg)}
.sl-task--done .sl-task__chip{background:var(--status-pass-bg);color:var(--status-pass-fg)}
.sl-task__body{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.sl-task__title{font-size:15px;font-weight:500;color:var(--foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sl-task--done .sl-task__title{text-decoration:line-through;text-decoration-color:var(--muted-foreground)}
.sl-task__meta{font-size:13px;color:var(--muted-foreground);display:flex;align-items:center;gap:6px}
.sl-task__meta svg{width:13px;height:13px;flex-shrink:0}
.sl-task__result{font-family:var(--font-mono);font-weight:600;font-variant-numeric:tabular-nums}
.sl-task__right{display:flex;align-items:center;gap:10px;flex-shrink:0}
.sl-task__chev{width:18px;height:18px;color:var(--slate-400)}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}
const S = props => /*#__PURE__*/React.createElement("svg", _extends({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, props));
const CHECK_ICONS = {
  temperature: /*#__PURE__*/React.createElement(S, null, /*#__PURE__*/React.createElement("path", {
    d: "M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"
  })),
  cleaning: /*#__PURE__*/React.createElement(S, null, /*#__PURE__*/React.createElement("path", {
    d: "m3 3 8 8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12.5 6.5 18 12"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m14 10 7 7a2.828 2.828 0 0 1-4 4l-7-7"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M5 21v-4a2 2 0 0 1 2-2h4"
  })),
  allergen: /*#__PURE__*/React.createElement(S, null, /*#__PURE__*/React.createElement("path", {
    d: "M2 22 16 8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M3.47 12.53 5 11l1.53 1.53a3.5 3.5 0 0 1 0 4.94L5 19l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M7.47 8.53 9 7l1.53 1.53a3.5 3.5 0 0 1 0 4.94L9 15l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M11.47 4.53 13 3l1.53 1.53a3.5 3.5 0 0 1 0 4.94L13 11l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"
  })),
  opening: /*#__PURE__*/React.createElement(S, null, /*#__PURE__*/React.createElement("path", {
    d: "M12 2v8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m4.93 10.93 1.41 1.41"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M2 18h2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M20 18h2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m19.07 10.93-1.41 1.41"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M22 22H2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m8 6 4-4 4 4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M16 18a4 4 0 0 0-8 0"
  })),
  closing: /*#__PURE__*/React.createElement(S, null, /*#__PURE__*/React.createElement("path", {
    d: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"
  })),
  generic: /*#__PURE__*/React.createElement(S, null, /*#__PURE__*/React.createElement("path", {
    d: "M11 14h1v4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M16 2v4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M8 2v4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M3 10h18"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "4",
    width: "18",
    height: "18",
    rx: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m9 16 1 1 3-3"
  }))
};
const CLOCK = /*#__PURE__*/React.createElement(S, null, /*#__PURE__*/React.createElement("circle", {
  cx: "12",
  cy: "12",
  r: "10"
}), /*#__PURE__*/React.createElement("polyline", {
  points: "12 6 12 12 16 14"
}));
const CLOUD_OFF = /*#__PURE__*/React.createElement(S, null, /*#__PURE__*/React.createElement("path", {
  d: "m2 2 20 20"
}), /*#__PURE__*/React.createElement("path", {
  d: "M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193"
}), /*#__PURE__*/React.createElement("path", {
  d: "M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07"
}));
const CHEVRON = /*#__PURE__*/React.createElement("svg", {
  className: "sl-task__chev",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("path", {
  d: "m9 18 6-6-6-6"
}));

/** TaskCard — a Today-list row for a compliance check, across its lifecycle states. */
function TaskCard({
  title,
  checkType = "generic",
  status = "due",
  time,
  result,
  className = "",
  ...props
}) {
  ensureStyle("sl-task-css", CSS);
  const right = () => {
    if (status === "overdue") return /*#__PURE__*/React.createElement(__ds_scope.StatusBadge, {
      status: "overdue",
      size: "sm"
    });
    if (status === "failed") return /*#__PURE__*/React.createElement(__ds_scope.StatusBadge, {
      status: "fail",
      size: "sm"
    });
    if (status === "done") return /*#__PURE__*/React.createElement(__ds_scope.StatusBadge, {
      status: "pass",
      size: "sm"
    });
    if (status === "pending-sync") return /*#__PURE__*/React.createElement(__ds_scope.StatusBadge, {
      status: "pending",
      size: "sm"
    }, "Syncing");
    return CHEVRON;
  };
  const metaContent = () => {
    if (status === "pending-sync") return /*#__PURE__*/React.createElement(React.Fragment, null, CLOUD_OFF, " Waiting to sync");
    if ((status === "done" || status === "failed") && result != null) return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
      className: "sl-task__result"
    }, result));
    return /*#__PURE__*/React.createElement(React.Fragment, null, CLOCK, " ", time);
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    "data-slot": "task-card",
    "data-status": status,
    className: ["sl-task", `sl-task--${status}`, className].filter(Boolean).join(" ")
  }, props), /*#__PURE__*/React.createElement("span", {
    className: "sl-task__chip"
  }, CHECK_ICONS[checkType] || CHECK_ICONS.generic), /*#__PURE__*/React.createElement("span", {
    className: "sl-task__body"
  }, /*#__PURE__*/React.createElement("span", {
    className: "sl-task__title"
  }, title), /*#__PURE__*/React.createElement("span", {
    className: "sl-task__meta"
  }, metaContent())), /*#__PURE__*/React.createElement("span", {
    className: "sl-task__right"
  }, right()));
}
Object.assign(__ds_scope, { TaskCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/domain/TaskCard.jsx", error: String((e && e.message) || e) }); }

// components/domain/ThresholdReadout.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.sl-readout{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center}
.sl-readout__value{font-family:var(--font-mono);font-weight:var(--readout-weight);line-height:var(--readout-line);letter-spacing:-0.02em;font-variant-numeric:tabular-nums;display:flex;align-items:baseline;gap:2px}
.sl-readout__unit{font-size:.5em;font-weight:500}
.sl-readout--pass .sl-readout__value{color:var(--status-pass)}
.sl-readout--fail .sl-readout__value{color:var(--status-fail)}
.sl-readout--empty .sl-readout__value{color:var(--muted-foreground)}
.sl-readout__hint{font-size:13px;color:var(--muted-foreground)}
.sl-readout__hint b{color:var(--foreground);font-weight:500;font-family:var(--font-mono)}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}
const SIZES = {
  md: 32,
  lg: 56,
  xl: 72
};
function thresholdText(min, max, unit) {
  if (min != null && max != null) return /*#__PURE__*/React.createElement(React.Fragment, null, "Target ", /*#__PURE__*/React.createElement("b", null, min, "\u2013", max, unit));
  if (max != null) return /*#__PURE__*/React.createElement(React.Fragment, null, "Must be ", /*#__PURE__*/React.createElement("b", null, "\u2264 ", max, unit));
  if (min != null) return /*#__PURE__*/React.createElement(React.Fragment, null, "Must be ", /*#__PURE__*/React.createElement("b", null, "\u2265 ", min, unit));
  return null;
}

/**
 * ThresholdReadout — the hero of the temperature-check flow. A large Geist Mono
 * value that recolors green (pass) / red (fail) live against a threshold.
 */
function ThresholdReadout({
  value,
  unit = "°C",
  min = null,
  max = null,
  size = "lg",
  showBadge = true,
  showHint = true,
  className = "",
  ...props
}) {
  ensureStyle("sl-readout-css", CSS);
  const empty = value === null || value === undefined || value === "" || value === "-";
  const num = empty ? null : Number(value);
  const invalid = !empty && Number.isNaN(num);
  let state = "empty";
  if (!empty && !invalid) {
    const okMin = min == null || num >= min;
    const okMax = max == null || num <= max;
    state = okMin && okMax ? "pass" : "fail";
  }
  const px = SIZES[size] || SIZES.lg;
  return /*#__PURE__*/React.createElement("div", _extends({
    "data-slot": "threshold-readout",
    "data-state": state,
    className: ["sl-readout", `sl-readout--${state}`, className].filter(Boolean).join(" ")
  }, props), /*#__PURE__*/React.createElement("div", {
    className: "sl-readout__value",
    style: {
      fontSize: px
    }
  }, empty ? "—" : value, /*#__PURE__*/React.createElement("span", {
    className: "sl-readout__unit"
  }, unit)), showHint && thresholdText(min, max, unit) && /*#__PURE__*/React.createElement("div", {
    className: "sl-readout__hint"
  }, thresholdText(min, max, unit)), showBadge && !empty && !invalid && /*#__PURE__*/React.createElement(__ds_scope.StatusBadge, {
    status: state === "pass" ? "pass" : "fail"
  }));
}
Object.assign(__ds_scope, { ThresholdReadout });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/domain/ThresholdReadout.jsx", error: String((e && e.message) || e) }); }

// components/domain/TimelineRow.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.sl-tl{display:flex;gap:12px;font-family:var(--font-sans)}
.sl-tl__rail{display:flex;flex-direction:column;align-items:center;flex-shrink:0;width:34px}
.sl-tl__dot{width:34px;height:34px;border-radius:var(--radius-full);background:var(--muted);color:var(--muted-foreground);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0}
.sl-tl__dot svg{width:17px;height:17px}
.sl-tl__dot--system{background:var(--accent);color:var(--primary)}
.sl-tl__dot--edit{background:var(--status-overdue-bg);color:var(--status-overdue-fg)}
.sl-tl__line{flex:1;width:2px;background:var(--border);margin-top:4px;min-height:14px}
.sl-tl--last .sl-tl__line{display:none}
.sl-tl__body{flex:1;min-width:0;padding-bottom:20px}
.sl-tl__head{font-size:14px;color:var(--foreground);line-height:1.45}
.sl-tl__head b{font-weight:600}
.sl-tl__head .sub{color:var(--muted-foreground)}
.sl-tl__time{font-size:12px;color:var(--muted-foreground);font-family:var(--font-mono);margin-top:2px}
.sl-tl__edit{margin-top:9px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);padding:10px 12px}
.sl-tl__reason{font-size:13px;color:var(--muted-foreground);margin-bottom:7px}
.sl-tl__reason b{color:var(--foreground);font-weight:500}
.sl-tl__diff{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.sl-tl__chip{font-family:var(--font-mono);font-size:13px;padding:2px 7px;border-radius:var(--radius-sm)}
.sl-tl__before{color:var(--status-fail-fg);background:var(--status-fail-bg);text-decoration:line-through}
.sl-tl__after{color:var(--status-pass-fg);background:var(--status-pass-bg)}
.sl-tl__arrow{color:var(--muted-foreground);display:flex}
.sl-tl__arrow svg{width:15px;height:15px}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}
const I = p => /*#__PURE__*/React.createElement("svg", _extends({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, p));
const SYSTEM = /*#__PURE__*/React.createElement(I, null, /*#__PURE__*/React.createElement("rect", {
  width: "16",
  height: "16",
  x: "4",
  y: "4",
  rx: "2"
}), /*#__PURE__*/React.createElement("rect", {
  width: "6",
  height: "6",
  x: "9",
  y: "9",
  rx: "1"
}), /*#__PURE__*/React.createElement("path", {
  d: "M15 2v2M9 2v2M15 20v2M9 20v2M20 15h2M20 9h2M2 15h2M2 9h2"
}));
const ARROW = /*#__PURE__*/React.createElement(I, null, /*#__PURE__*/React.createElement("path", {
  d: "M5 12h14M12 5l7 7-7 7"
}));
function initials(name) {
  return (name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

/**
 * TimelineRow — one entry in the audit history: actor · action · subject · time.
 * When it represents an edit, it renders the before→after change plus the reason.
 * System actors get a distinct icon + tint.
 */
function TimelineRow({
  actor,
  actorType = "user",
  action,
  subject,
  time,
  edit = null,
  last = false,
  className = "",
  ...props
}) {
  ensureStyle("sl-tl-css", CSS);
  const isSystem = actorType === "system";
  const dotCls = ["sl-tl__dot", isSystem ? "sl-tl__dot--system" : "", edit ? "sl-tl__dot--edit" : ""].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", _extends({
    "data-slot": "timeline-row",
    className: ["sl-tl", last ? "sl-tl--last" : "", className].filter(Boolean).join(" ")
  }, props), /*#__PURE__*/React.createElement("div", {
    className: "sl-tl__rail"
  }, /*#__PURE__*/React.createElement("span", {
    className: dotCls
  }, isSystem ? SYSTEM : initials(actor)), /*#__PURE__*/React.createElement("span", {
    className: "sl-tl__line"
  })), /*#__PURE__*/React.createElement("div", {
    className: "sl-tl__body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sl-tl__head"
  }, /*#__PURE__*/React.createElement("b", null, actor), " ", action, subject ? /*#__PURE__*/React.createElement(React.Fragment, null, " ", /*#__PURE__*/React.createElement("span", {
    className: "sub"
  }, "\xB7"), " ", /*#__PURE__*/React.createElement("b", null, subject)) : null), /*#__PURE__*/React.createElement("div", {
    className: "sl-tl__time"
  }, time), edit && /*#__PURE__*/React.createElement("div", {
    className: "sl-tl__edit"
  }, edit.reason ? /*#__PURE__*/React.createElement("div", {
    className: "sl-tl__reason"
  }, /*#__PURE__*/React.createElement("b", null, "Reason:"), " ", edit.reason) : null, /*#__PURE__*/React.createElement("div", {
    className: "sl-tl__diff"
  }, /*#__PURE__*/React.createElement("span", {
    className: "sl-tl__chip sl-tl__before"
  }, edit.before), /*#__PURE__*/React.createElement("span", {
    className: "sl-tl__arrow"
  }, ARROW), /*#__PURE__*/React.createElement("span", {
    className: "sl-tl__chip sl-tl__after"
  }, edit.after)))));
}
Object.assign(__ds_scope, { TimelineRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/domain/TimelineRow.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Alert.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.scn-alert{position:relative;display:grid;grid-template-columns:0 1fr;width:100%;align-items:start;gap:.125rem .75rem;border-radius:var(--radius-lg);border:1px solid var(--border);padding:.75rem 1rem;font-family:var(--font-sans);font-size:var(--text-sm);background:var(--card);color:var(--card-foreground)}
.scn-alert:has(>svg){grid-template-columns:1rem 1fr}
.scn-alert>svg{width:1rem;height:1rem;transform:translateY(2px);color:currentColor}
.scn-alert-title{grid-column-start:2;font-weight:var(--font-weight-medium);letter-spacing:-.01em;min-height:1rem;line-height:1rem}
.scn-alert-desc{grid-column-start:2;font-size:var(--text-sm);color:var(--muted-foreground);line-height:1.45}
.scn-alert-v-destructive{color:var(--destructive)}
.scn-alert-v-destructive .scn-alert-desc{color:color-mix(in oklab,var(--destructive) 90%,transparent)}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}
function cx(b, c) {
  return [b, c].filter(Boolean).join(" ");
}

/** Alert — a contextual callout. Optionally leads with an icon as the first child. */
function Alert({
  variant = "default",
  className = "",
  children,
  ...props
}) {
  ensureStyle("scn-alert-css", CSS);
  return /*#__PURE__*/React.createElement("div", _extends({
    "data-slot": "alert",
    role: "alert",
    className: cx(`scn-alert scn-alert-v-${variant}`, className)
  }, props), children);
}
function AlertTitle({
  className = "",
  children,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    "data-slot": "alert-title",
    className: cx("scn-alert-title", className)
  }, props), children);
}
function AlertDescription({
  className = "",
  children,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    "data-slot": "alert-description",
    className: cx("scn-alert-desc", className)
  }, props), children);
}
Object.assign(__ds_scope, { Alert, AlertTitle, AlertDescription });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Alert.jsx", error: String((e && e.message) || e) }); }

// components/feedback/EmptyState.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.sl-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:44px 24px;gap:5px}
.sl-empty--compact{padding:28px 20px}
.sl-empty__ic{width:52px;height:52px;border-radius:var(--radius-lg);background:var(--muted);color:var(--muted-foreground);display:flex;align-items:center;justify-content:center;margin-bottom:8px}
.sl-empty__ic svg{width:24px;height:24px}
.sl-empty__title{font-size:16px;font-weight:600;color:var(--foreground)}
.sl-empty__desc{font-size:14px;color:var(--muted-foreground);max-width:320px;line-height:1.5}
.sl-empty__action{margin-top:14px}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}
const DEFAULT_ICON = /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("path", {
  d: "M22 12h-6l-2 3h-4l-2-3H2"
}), /*#__PURE__*/React.createElement("path", {
  d: "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"
}));

/** EmptyState — the "nothing here yet" placeholder for a list/screen, with an optional CTA. */
function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  className = "",
  ...props
}) {
  ensureStyle("sl-empty-css", CSS);
  return /*#__PURE__*/React.createElement("div", _extends({
    "data-slot": "empty-state",
    className: ["sl-empty", compact ? "sl-empty--compact" : "", className].filter(Boolean).join(" ")
  }, props), /*#__PURE__*/React.createElement("span", {
    className: "sl-empty__ic"
  }, icon || DEFAULT_ICON), title ? /*#__PURE__*/React.createElement("div", {
    className: "sl-empty__title"
  }, title) : null, description ? /*#__PURE__*/React.createElement("div", {
    className: "sl-empty__desc"
  }, description) : null, action ? /*#__PURE__*/React.createElement("div", {
    className: "sl-empty__action"
  }, action) : null);
}
Object.assign(__ds_scope, { EmptyState });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/EmptyState.jsx", error: String((e && e.message) || e) }); }

// components/feedback/OfflineBanner.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.sl-offline{display:flex;align-items:center;gap:10px;padding:10px 14px;font-size:13px;font-weight:500;border-radius:var(--radius-md);font-family:var(--font-sans)}
.sl-offline--full{border-radius:0;justify-content:center;width:100%}
.sl-offline--offline{background:var(--status-overdue-bg);color:var(--status-overdue-fg);border:1px solid color-mix(in oklab,var(--status-overdue) 30%,transparent)}
.sl-offline--full.sl-offline--offline{border-left:0;border-right:0;border-top:0}
.sl-offline--syncing{background:var(--status-info-bg);color:var(--status-info-fg);border:1px solid color-mix(in oklab,var(--status-info) 30%,transparent)}
.sl-offline--error{background:var(--status-fail-bg);color:var(--status-fail-fg);border:1px solid color-mix(in oklab,var(--status-fail) 30%,transparent)}
.sl-offline__ic{width:16px;height:16px;flex-shrink:0}
.sl-offline__spin{animation:sl-off-spin .8s linear infinite}
@keyframes sl-off-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.sl-offline__spin{animation:none}}
.sl-offline__count{margin-left:auto;font-family:var(--font-mono);opacity:.9;white-space:nowrap}
.sl-offline__retry{margin-left:auto;background:transparent;border:none;color:inherit;font-weight:600;cursor:pointer;text-decoration:underline;font-size:13px;font-family:var(--font-sans)}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}
const I = p => /*#__PURE__*/React.createElement("svg", _extends({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, p));
const CLOUD_OFF = /*#__PURE__*/React.createElement(I, {
  className: "sl-offline__ic"
}, /*#__PURE__*/React.createElement("path", {
  d: "m2 2 20 20"
}), /*#__PURE__*/React.createElement("path", {
  d: "M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193"
}), /*#__PURE__*/React.createElement("path", {
  d: "M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07"
}));
const SYNC = /*#__PURE__*/React.createElement(I, {
  className: "sl-offline__ic sl-offline__spin"
}, /*#__PURE__*/React.createElement("path", {
  d: "M21 12a9 9 0 1 1-6.219-8.56"
}));
const ALERT = /*#__PURE__*/React.createElement(I, {
  className: "sl-offline__ic"
}, /*#__PURE__*/React.createElement("path", {
  d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"
}), /*#__PURE__*/React.createElement("path", {
  d: "M12 9v4M12 17h.01"
}));
const DEFAULTS = {
  offline: {
    icon: CLOUD_OFF,
    msg: "You're offline — checks are saved and will sync automatically."
  },
  syncing: {
    icon: SYNC,
    msg: "Back online — syncing queued checks…"
  },
  error: {
    icon: ALERT,
    msg: "Sync failed — we'll keep retrying."
  }
};

/**
 * OfflineBanner — the visible half of the offline write-queue (D9). Shows connection
 * state and how many checks are waiting to sync. Pairs with the pending-sync markers
 * on TaskCard / EvidenceUpload.
 */
function OfflineBanner({
  variant = "offline",
  message,
  queuedCount,
  onRetry,
  full = false,
  className = "",
  ...props
}) {
  ensureStyle("sl-offline-css", CSS);
  const d = DEFAULTS[variant] || DEFAULTS.offline;
  return /*#__PURE__*/React.createElement("div", _extends({
    "data-slot": "offline-banner",
    role: "status",
    className: ["sl-offline", `sl-offline--${variant}`, full ? "sl-offline--full" : "", className].filter(Boolean).join(" ")
  }, props), d.icon, /*#__PURE__*/React.createElement("span", null, message || d.msg), onRetry ? /*#__PURE__*/React.createElement("button", {
    className: "sl-offline__retry",
    onClick: onRetry
  }, "Retry now") : queuedCount != null ? /*#__PURE__*/React.createElement("span", {
    className: "sl-offline__count"
  }, queuedCount, " queued") : null);
}
Object.assign(__ds_scope, { OfflineBanner });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/OfflineBanner.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Progress.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.scn-progress{position:relative;width:100%;height:.5rem;overflow:hidden;border-radius:var(--radius-full);background:color-mix(in oklab,var(--primary) 20%,transparent)}
.scn-progress-bar{height:100%;background:var(--primary);border-radius:inherit;transition:width .3s ease}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}

/** Progress — a horizontal completion bar (0–100). */
function Progress({
  value = 0,
  className = "",
  ...props
}) {
  ensureStyle("scn-progress-css", CSS);
  const pct = Math.max(0, Math.min(100, value));
  return /*#__PURE__*/React.createElement("div", _extends({
    "data-slot": "progress",
    role: "progressbar",
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    "aria-valuenow": pct,
    className: ["scn-progress", className].filter(Boolean).join(" ")
  }, props), /*#__PURE__*/React.createElement("div", {
    className: "scn-progress-bar",
    style: {
      width: `${pct}%`
    }
  }));
}
Object.assign(__ds_scope, { Progress });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Progress.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Tabs.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.scn-tabs{display:flex;flex-direction:column;gap:.5rem}
.scn-tabs-list{display:inline-flex;height:2.25rem;width:fit-content;align-items:center;justify-content:center;gap:.25rem;border-radius:var(--radius-lg);background:var(--muted);padding:3px;color:var(--muted-foreground)}
.scn-tabs-trigger{display:inline-flex;height:100%;align-items:center;justify-content:center;gap:.375rem;border-radius:var(--radius-md);border:1px solid transparent;padding:0 .75rem;font-family:var(--font-sans);font-size:var(--text-sm);font-weight:var(--font-weight-medium);color:var(--muted-foreground);white-space:nowrap;cursor:pointer;background:transparent;transition:color .15s ease,background .15s ease,box-shadow .15s ease;outline:none}
.scn-tabs-trigger svg{width:1rem;height:1rem}
.scn-tabs-trigger[data-state=active]{background:var(--background);color:var(--foreground);box-shadow:var(--shadow-sm)}
.scn-tabs-trigger:focus-visible{box-shadow:0 0 0 3px color-mix(in oklab,var(--ring) 50%,transparent)}
.scn-tabs-content{outline:none}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}
function cx(b, c) {
  return [b, c].filter(Boolean).join(" ");
}
const TabsCtx = React.createContext(null);

/** Tabs — switch between panels. Compose with TabsList/TabsTrigger/TabsContent; `value` matches trigger to content. */
function Tabs({
  defaultValue,
  value,
  onValueChange,
  className = "",
  children,
  ...props
}) {
  ensureStyle("scn-tabs-css", CSS);
  const [internal, setInternal] = React.useState(defaultValue);
  const isControlled = value !== undefined;
  const val = isControlled ? value : internal;
  const setVal = v => {
    if (!isControlled) setInternal(v);
    if (onValueChange) onValueChange(v);
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    "data-slot": "tabs",
    className: cx("scn-tabs", className)
  }, props), /*#__PURE__*/React.createElement(TabsCtx.Provider, {
    value: {
      val,
      setVal
    }
  }, children));
}
function TabsList({
  className = "",
  children,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "tablist",
    "data-slot": "tabs-list",
    className: cx("scn-tabs-list", className)
  }, props), children);
}
function TabsTrigger({
  value,
  className = "",
  children,
  ...props
}) {
  const ctx = React.useContext(TabsCtx);
  const active = ctx && ctx.val === value;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    role: "tab",
    "aria-selected": active,
    "data-slot": "tabs-trigger",
    "data-state": active ? "active" : "inactive",
    onClick: () => ctx && ctx.setVal(value),
    className: cx("scn-tabs-trigger", className)
  }, props), children);
}
function TabsContent({
  value,
  className = "",
  children,
  ...props
}) {
  const ctx = React.useContext(TabsCtx);
  if (!ctx || ctx.val !== value) return null;
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "tabpanel",
    "data-slot": "tabs-content",
    className: cx("scn-tabs-content", className)
  }, props), children);
}
Object.assign(__ds_scope, { Tabs, TabsList, TabsTrigger, TabsContent });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toaster.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.sl-toaster{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:1500;display:flex;flex-direction:column;gap:8px;align-items:center;width:max-content;max-width:calc(100vw - 32px);pointer-events:none}
.sl-toast{pointer-events:auto;display:flex;align-items:flex-start;gap:10px;background:var(--popover);color:var(--popover-foreground);border:1px solid var(--border);padding:12px 14px;border-radius:var(--radius-md);box-shadow:var(--shadow-lg);min-width:260px;max-width:440px;animation:sl-toast-in .3s cubic-bezier(0.16,1,0.3,1)}
@keyframes sl-toast-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.sl-toast__ic{width:18px;height:18px;flex-shrink:0;margin-top:1px}
.sl-toast--success .sl-toast__ic{color:var(--status-pass)}
.sl-toast--error .sl-toast__ic{color:var(--status-fail)}
.sl-toast--info .sl-toast__ic{color:var(--status-info)}
.sl-toast--warning .sl-toast__ic{color:var(--status-overdue)}
.sl-toast__body{flex:1;min-width:0}
.sl-toast__title{font-size:14px;font-weight:500;line-height:1.35}
.sl-toast__desc{font-size:13px;color:var(--muted-foreground);margin-top:2px;line-height:1.4}
.sl-toast__action{background:transparent;border:1px solid var(--border);color:var(--foreground);font-size:12px;font-weight:500;padding:6px 11px;border-radius:var(--radius-sm);cursor:pointer;flex-shrink:0;align-self:center;font-family:var(--font-sans)}
.sl-toast__action:hover{background:var(--muted)}
.sl-toast__x{background:transparent;border:none;color:var(--muted-foreground);cursor:pointer;padding:0;width:18px;height:18px;flex-shrink:0}
.sl-toast__x:hover{color:var(--foreground)}
@media (prefers-reduced-motion: reduce){.sl-toast{animation:none}}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}

// --- module-level store (one queue shared across the bundle) ---
let queue = [];
let listeners = [];
let seq = 0;
function emit() {
  listeners.forEach(l => l(queue.slice()));
}
function dismiss(id) {
  queue = queue.filter(t => t.id !== id);
  emit();
}
function show(opts) {
  const o = typeof opts === "string" ? {
    title: opts
  } : opts || {};
  const id = o.id != null ? o.id : ++seq;
  const t = {
    id,
    variant: o.variant || "info",
    title: o.title,
    description: o.description,
    action: o.action
  };
  queue = [...queue.filter(x => x.id !== id), t];
  emit();
  const dur = o.duration == null ? 3200 : o.duration;
  if (dur > 0) setTimeout(() => dismiss(id), dur);
  return id;
}
const I = p => /*#__PURE__*/React.createElement("svg", _extends({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, p));
const ICONS = {
  success: /*#__PURE__*/React.createElement(I, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m9 12 2 2 4-4"
  })),
  error: /*#__PURE__*/React.createElement(I, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m15 9-6 6M9 9l6 6"
  })),
  info: /*#__PURE__*/React.createElement(I, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 16v-4M12 8h.01"
  })),
  warning: /*#__PURE__*/React.createElement(I, null, /*#__PURE__*/React.createElement("path", {
    d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 9v4M12 17h.01"
  }))
};
const X = /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  width: "18",
  height: "18"
}, /*#__PURE__*/React.createElement("path", {
  d: "M18 6 6 18M6 6l12 12"
}));

/**
 * Toaster — mount once near the app root. Fire toasts imperatively from anywhere via
 * Toaster.show / .success / .error / .info / .warning. Uses a polite aria-live region.
 */
function Toaster({
  className = "",
  ...props
}) {
  ensureStyle("sl-toast-css", CSS);
  const [items, setItems] = React.useState(queue.slice());
  React.useEffect(() => {
    listeners.push(setItems);
    setItems(queue.slice());
    return () => {
      listeners = listeners.filter(l => l !== setItems);
    };
  }, []);
  return /*#__PURE__*/React.createElement("div", _extends({
    className: ["sl-toaster", className].filter(Boolean).join(" "),
    role: "region",
    "aria-live": "polite",
    "aria-label": "Notifications"
  }, props), items.map(t => /*#__PURE__*/React.createElement("div", {
    key: t.id,
    className: `sl-toast sl-toast--${t.variant}`,
    role: "status"
  }, /*#__PURE__*/React.createElement("span", {
    className: "sl-toast__ic"
  }, ICONS[t.variant] || ICONS.info), /*#__PURE__*/React.createElement("div", {
    className: "sl-toast__body"
  }, t.title ? /*#__PURE__*/React.createElement("div", {
    className: "sl-toast__title"
  }, t.title) : null, t.description ? /*#__PURE__*/React.createElement("div", {
    className: "sl-toast__desc"
  }, t.description) : null), t.action ? /*#__PURE__*/React.createElement("button", {
    className: "sl-toast__action",
    onClick: () => {
      t.action.onClick && t.action.onClick();
      dismiss(t.id);
    }
  }, t.action.label) : null, /*#__PURE__*/React.createElement("button", {
    className: "sl-toast__x",
    "aria-label": "Dismiss",
    onClick: () => dismiss(t.id)
  }, X))));
}
Toaster.show = show;
Toaster.dismiss = dismiss;
Toaster.success = o => show({
  ...(typeof o === "string" ? {
    title: o
  } : o),
  variant: "success"
});
Toaster.error = o => show({
  ...(typeof o === "string" ? {
    title: o
  } : o),
  variant: "error"
});
Toaster.info = o => show({
  ...(typeof o === "string" ? {
    title: o
  } : o),
  variant: "info"
});
Toaster.warning = o => show({
  ...(typeof o === "string" ? {
    title: o
  } : o),
  variant: "warning"
});
Object.assign(__ds_scope, { Toaster });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toaster.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.scn-checkbox{appearance:none;width:1rem;height:1rem;flex-shrink:0;border-radius:var(--radius-sm);border:1px solid var(--input);background:var(--background);box-shadow:var(--shadow-xs);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:background .15s ease,border-color .15s ease,box-shadow .15s ease;padding:0;color:var(--primary-foreground)}
.scn-checkbox[data-state=checked]{background:var(--primary);border-color:var(--primary)}
.scn-checkbox:focus-visible{border-color:var(--ring);box-shadow:0 0 0 3px color-mix(in oklab,var(--ring) 50%,transparent)}
.scn-checkbox:disabled{cursor:not-allowed;opacity:.5}
.scn-checkbox svg{width:.75rem;height:.75rem}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}

/** Checkbox — a toggleable box. Controlled via `checked`+`onCheckedChange`, or uncontrolled via `defaultChecked`. */
function Checkbox({
  checked,
  defaultChecked = false,
  onCheckedChange,
  disabled = false,
  className = "",
  ...props
}) {
  ensureStyle("scn-checkbox-css", CSS);
  const [internal, setInternal] = React.useState(!!defaultChecked);
  const isControlled = checked !== undefined;
  const val = isControlled ? checked : internal;
  const toggle = () => {
    if (disabled) return;
    const next = !val;
    if (!isControlled) setInternal(next);
    if (onCheckedChange) onCheckedChange(next);
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    role: "checkbox",
    "aria-checked": val,
    "data-slot": "checkbox",
    "data-state": val ? "checked" : "unchecked",
    disabled: disabled,
    onClick: toggle,
    className: ["scn-checkbox", className].filter(Boolean).join(" ")
  }, props), val && /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "3",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M20 6 9 17l-5-5"
  })));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.scn-input{display:flex;height:2.25rem;width:100%;min-width:0;border-radius:var(--radius-md);border:1px solid var(--input);background:transparent;padding:.25rem .75rem;font-family:var(--font-sans);font-size:var(--text-sm);line-height:1.25rem;color:var(--foreground);box-shadow:var(--shadow-xs);transition:color .15s ease,box-shadow .15s ease,border-color .15s ease;outline:none}
.scn-input::placeholder{color:var(--muted-foreground)}
.scn-input:focus-visible{border-color:var(--ring);box-shadow:0 0 0 3px color-mix(in oklab,var(--ring) 50%,transparent)}
.scn-input:disabled{cursor:not-allowed;opacity:.5}
.scn-input[aria-invalid=true]{border-color:var(--destructive);box-shadow:0 0 0 3px color-mix(in oklab,var(--destructive) 20%,transparent)}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}

/** Input — single-line text field. */
function Input({
  className = "",
  type = "text",
  ...props
}) {
  ensureStyle("scn-input-css", CSS);
  return /*#__PURE__*/React.createElement("input", _extends({
    type: type,
    "data-slot": "input",
    className: ["scn-input", className].filter(Boolean).join(" ")
  }, props));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Label.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.scn-label{display:inline-flex;align-items:center;gap:.5rem;font-family:var(--font-sans);font-size:var(--text-sm);line-height:1;font-weight:var(--font-weight-medium);color:var(--foreground);user-select:none}
.scn-label[data-disabled=true]{opacity:.5;cursor:not-allowed}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}

/** Label — accessible caption for a form control. */
function Label({
  className = "",
  children,
  ...props
}) {
  ensureStyle("scn-label-css", CSS);
  return /*#__PURE__*/React.createElement("label", _extends({
    "data-slot": "label",
    className: ["scn-label", className].filter(Boolean).join(" ")
  }, props), children);
}
Object.assign(__ds_scope, { Label });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Label.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CHEVRON = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="%23737373" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>');
const CSS = `
.scn-select{height:2.25rem;width:100%;border-radius:var(--radius-md);border:1px solid var(--input);background-color:transparent;padding:0 2rem 0 .75rem;font-family:var(--font-sans);font-size:var(--text-sm);line-height:1.25rem;color:var(--foreground);box-shadow:var(--shadow-xs);appearance:none;cursor:pointer;outline:none;transition:color .15s ease,box-shadow .15s ease,border-color .15s ease;background-image:url("${CHEVRON}");background-repeat:no-repeat;background-position:right .5rem center;background-size:1rem}
.scn-select:focus-visible{border-color:var(--ring);box-shadow:0 0 0 3px color-mix(in oklab,var(--ring) 50%,transparent)}
.scn-select:disabled{cursor:not-allowed;opacity:.5}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}

/** Select — a native styled dropdown. Pass `<option>` children. */
function Select({
  className = "",
  children,
  ...props
}) {
  ensureStyle("scn-select-css", CSS);
  return /*#__PURE__*/React.createElement("select", _extends({
    "data-slot": "select",
    className: ["scn-select", className].filter(Boolean).join(" ")
  }, props), children);
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.scn-switch{appearance:none;position:relative;display:inline-flex;align-items:center;height:1.15rem;width:2rem;flex-shrink:0;border-radius:var(--radius-full);border:1px solid transparent;background:var(--input);box-shadow:var(--shadow-xs);cursor:pointer;transition:background-color .15s ease,box-shadow .15s ease;padding:0}
.scn-switch[data-state=checked]{background:var(--primary)}
.scn-switch:focus-visible{box-shadow:0 0 0 3px color-mix(in oklab,var(--ring) 50%,transparent)}
.scn-switch:disabled{cursor:not-allowed;opacity:.5}
.scn-switch-thumb{pointer-events:none;display:block;width:1rem;height:1rem;border-radius:var(--radius-full);background:var(--background);box-shadow:var(--shadow-sm);transition:transform .15s ease;transform:translateX(0)}
.scn-switch[data-state=checked] .scn-switch-thumb{transform:translateX(calc(100% - 2px))}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}

/** Switch — an on/off toggle. Controlled via `checked`+`onCheckedChange` or uncontrolled via `defaultChecked`. */
function Switch({
  checked,
  defaultChecked = false,
  onCheckedChange,
  disabled = false,
  className = "",
  ...props
}) {
  ensureStyle("scn-switch-css", CSS);
  const [internal, setInternal] = React.useState(!!defaultChecked);
  const isControlled = checked !== undefined;
  const val = isControlled ? checked : internal;
  const toggle = () => {
    if (disabled) return;
    const next = !val;
    if (!isControlled) setInternal(next);
    if (onCheckedChange) onCheckedChange(next);
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    role: "switch",
    "aria-checked": val,
    "data-slot": "switch",
    "data-state": val ? "checked" : "unchecked",
    disabled: disabled,
    onClick: toggle,
    className: ["scn-switch", className].filter(Boolean).join(" ")
  }, props), /*#__PURE__*/React.createElement("span", {
    className: "scn-switch-thumb",
    "data-slot": "switch-thumb"
  }));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/forms/Textarea.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.scn-textarea{display:flex;min-height:4rem;width:100%;border-radius:var(--radius-md);border:1px solid var(--input);background:transparent;padding:.5rem .75rem;font-family:var(--font-sans);font-size:var(--text-sm);line-height:1.25rem;color:var(--foreground);box-shadow:var(--shadow-xs);transition:color .15s ease,box-shadow .15s ease,border-color .15s ease;outline:none;resize:vertical;field-sizing:content}
.scn-textarea::placeholder{color:var(--muted-foreground)}
.scn-textarea:focus-visible{border-color:var(--ring);box-shadow:0 0 0 3px color-mix(in oklab,var(--ring) 50%,transparent)}
.scn-textarea:disabled{cursor:not-allowed;opacity:.5}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}

/** Textarea — multi-line text field. */
function Textarea({
  className = "",
  ...props
}) {
  ensureStyle("scn-textarea-css", CSS);
  return /*#__PURE__*/React.createElement("textarea", _extends({
    "data-slot": "textarea",
    className: ["scn-textarea", className].filter(Boolean).join(" ")
  }, props));
}
Object.assign(__ds_scope, { Textarea });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Textarea.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Combobox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.sl-cbx{position:relative;font-family:var(--font-sans)}
.sl-cbx__trigger{height:36px;width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;border-radius:var(--radius-md);border:1px solid var(--input);background:transparent;padding:0 10px 0 12px;font-size:14px;color:var(--foreground);box-shadow:var(--shadow-xs);cursor:pointer;font-family:inherit}
.sl-cbx__trigger:focus-visible{outline:none;border-color:var(--ring);box-shadow:0 0 0 3px color-mix(in oklab,var(--ring) 40%,transparent)}
.sl-cbx__trigger[data-placeholder=true]{color:var(--muted-foreground)}
.sl-cbx__trigger svg{width:15px;height:15px;color:var(--muted-foreground);flex-shrink:0}
.sl-cbx__pop{position:absolute;z-index:1400;top:calc(100% + 4px);left:0;width:100%;min-width:200px;background:var(--popover);border:1px solid var(--border);border-radius:var(--radius-md);box-shadow:var(--shadow-lg);overflow:hidden;animation:sl-cbx-in .14s ease}
@keyframes sl-cbx-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){.sl-cbx__pop{animation:none}}
.sl-cbx__search{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--border)}
.sl-cbx__search svg{width:15px;height:15px;color:var(--muted-foreground);flex-shrink:0}
.sl-cbx__search input{border:none;outline:none;background:transparent;font-size:14px;width:100%;color:var(--foreground);font-family:inherit}
.sl-cbx__list{max-height:220px;overflow:auto;padding:4px}
.sl-cbx__opt{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:var(--radius-sm);font-size:14px;cursor:pointer;color:var(--foreground)}
.sl-cbx__opt[data-active=true]{background:var(--accent);color:var(--accent-foreground)}
.sl-cbx__opt svg{width:15px;height:15px;margin-left:auto;color:var(--primary)}
.sl-cbx__empty{padding:16px;text-align:center;font-size:13px;color:var(--muted-foreground)}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}
const CHEVRON = /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("path", {
  d: "m7 15 5 5 5-5M7 9l5-5 5 5"
}));
const CHECK = /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2.5",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("path", {
  d: "M20 6 9 17l-5-5"
}));
const SEARCH = /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("circle", {
  cx: "11",
  cy: "11",
  r: "8"
}), /*#__PURE__*/React.createElement("path", {
  d: "m21 21-4.3-4.3"
}));

/** Combobox — a searchable single-select (role / property picker). Popover with filter + keyboard nav. */
function Combobox({
  options = [],
  value,
  onValueChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  className = "",
  ...props
}) {
  ensureStyle("sl-cbx-css", CSS);
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [active, setActive] = React.useState(0);
  const rootRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const selected = options.find(o => o.value === value);
  const filtered = options.filter(o => o.label.toLowerCase().includes(q.toLowerCase()));
  React.useEffect(() => {
    if (!open) return;
    const onDown = e => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    const t = setTimeout(() => inputRef.current && inputRef.current.focus(), 30);
    return () => {
      document.removeEventListener("mousedown", onDown);
      clearTimeout(t);
    };
  }, [open]);
  const choose = o => {
    onValueChange && onValueChange(o.value);
    setOpen(false);
    setQ("");
  };
  const onKey = e => {
    if (e.key === "Escape") return setOpen(false);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(a => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(a => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[active]) choose(filtered[active]);
    }
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    ref: rootRef,
    className: ["sl-cbx", className].filter(Boolean).join(" ")
  }, props), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "sl-cbx__trigger",
    "data-placeholder": !selected,
    "aria-haspopup": "listbox",
    "aria-expanded": open,
    onClick: () => setOpen(o => !o)
  }, /*#__PURE__*/React.createElement("span", null, selected ? selected.label : placeholder), CHEVRON), open && /*#__PURE__*/React.createElement("div", {
    className: "sl-cbx__pop",
    role: "listbox"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sl-cbx__search"
  }, SEARCH, /*#__PURE__*/React.createElement("input", {
    ref: inputRef,
    value: q,
    placeholder: searchPlaceholder,
    onChange: e => {
      setQ(e.target.value);
      setActive(0);
    },
    onKeyDown: onKey
  })), /*#__PURE__*/React.createElement("div", {
    className: "sl-cbx__list"
  }, filtered.map((o, i) => /*#__PURE__*/React.createElement("div", {
    key: o.value,
    role: "option",
    "aria-selected": o.value === value,
    "data-active": i === active,
    className: "sl-cbx__opt",
    onMouseEnter: () => setActive(i),
    onClick: () => choose(o)
  }, /*#__PURE__*/React.createElement("span", null, o.label), o.value === value ? CHECK : null)), filtered.length === 0 && /*#__PURE__*/React.createElement("div", {
    className: "sl-cbx__empty"
  }, "No matches"))));
}
Object.assign(__ds_scope, { Combobox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Combobox.jsx", error: String((e && e.message) || e) }); }

// components/overlays/DateRangePicker.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.sl-dp{position:relative;font-family:var(--font-sans)}
.sl-dp__trigger{height:36px;min-width:200px;display:flex;align-items:center;gap:9px;border-radius:var(--radius-md);border:1px solid var(--input);background:transparent;padding:0 12px;font-size:14px;color:var(--foreground);box-shadow:var(--shadow-xs);cursor:pointer;font-family:inherit}
.sl-dp__trigger:focus-visible{outline:none;border-color:var(--ring);box-shadow:0 0 0 3px color-mix(in oklab,var(--ring) 40%,transparent)}
.sl-dp__trigger[data-placeholder=true]{color:var(--muted-foreground)}
.sl-dp__trigger svg{width:15px;height:15px;color:var(--muted-foreground);flex-shrink:0}
.sl-dp__pop{position:absolute;z-index:1400;top:calc(100% + 4px);left:0;width:288px;background:var(--popover);border:1px solid var(--border);border-radius:var(--radius-md);box-shadow:var(--shadow-lg);overflow:hidden;animation:sl-dp-in .14s ease}
@keyframes sl-dp-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){.sl-dp__pop{animation:none}}
.sl-dp__hd{display:flex;align-items:center;justify-content:space-between;padding:10px 12px 2px}
.sl-dp__hd b{font-size:14px;font-weight:600}
.sl-dp__navbtn{width:30px;height:30px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--card);display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--foreground)}
.sl-dp__navbtn:hover{background:var(--muted)}
.sl-dp__navbtn svg{width:15px;height:15px}
.sl-dp__grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;padding:6px 12px}
.sl-dp__dow{font-size:11px;color:var(--muted-foreground);text-align:center;padding:4px 0;font-weight:500}
.sl-dp__day{height:34px;border:none;background:transparent;border-radius:var(--radius-sm);font-size:13px;color:var(--foreground);cursor:pointer;font-family:inherit;font-variant-numeric:tabular-nums}
.sl-dp__day:hover{background:var(--accent)}
.sl-dp__day--out{visibility:hidden;pointer-events:none}
.sl-dp__day--in{background:var(--accent);border-radius:0}
.sl-dp__day--edge{background:var(--primary);color:var(--primary-foreground)}
.sl-dp__day--edge:hover{background:var(--primary)}
.sl-dp__day--start{border-radius:var(--radius-sm) 0 0 var(--radius-sm)}
.sl-dp__day--end{border-radius:0 var(--radius-sm) var(--radius-sm) 0}
.sl-dp__foot{display:flex;justify-content:space-between;align-items:center;padding:9px 12px 12px;border-top:1px solid var(--border)}
.sl-dp__lbl{font-size:12px;color:var(--muted-foreground);font-family:var(--font-mono)}
.sl-dp__clear{background:transparent;border:none;color:var(--muted-foreground);font-size:13px;font-weight:500;cursor:pointer;font-family:inherit}
.sl-dp__clear:hover{color:var(--foreground)}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const CAL = /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("path", {
  d: "M8 2v4M16 2v4M3 10h18"
}), /*#__PURE__*/React.createElement("rect", {
  width: "18",
  height: "18",
  x: "3",
  y: "4",
  rx: "2"
}));
const L = /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("path", {
  d: "m15 18-6-6 6-6"
}));
const R = /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("path", {
  d: "m9 18 6-6-6-6"
}));
const ymd = d => d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() : null;
const fmt = d => d ? `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}` : "";

/** DateRangePicker — a from→to calendar range (Monday-first). For the audit filter bar & schedules. */
function DateRangePicker({
  value,
  onChange,
  placeholder = "Pick a date range",
  className = "",
  ...props
}) {
  ensureStyle("sl-dp-css", CSS);
  const [open, setOpen] = React.useState(false);
  const [from, setFrom] = React.useState(value && value.from ? value.from : null);
  const [to, setTo] = React.useState(value && value.to ? value.to : null);
  const [view, setView] = React.useState(() => {
    const b = value && value.from || new Date();
    return new Date(b.getFullYear(), b.getMonth(), 1);
  });
  const rootRef = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDown = e => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const pick = day => {
    if (!from || from && to) {
      setFrom(day);
      setTo(null);
      return;
    }
    if (ymd(day) < ymd(from)) {
      setFrom(day);
      return;
    }
    setTo(day);
    if (onChange) onChange({
      from,
      to: day
    });
  };
  const clear = () => {
    setFrom(null);
    setTo(null);
    if (onChange) onChange({
      from: null,
      to: null
    });
  };

  // build grid (Monday-first)
  const y = view.getFullYear(),
    m = view.getMonth();
  const first = new Date(y, m, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(y, m, d));
  const label = from ? to ? `${fmt(from)} – ${fmt(to)} ${to.getFullYear()}` : `${fmt(from)} …` : "";
  return /*#__PURE__*/React.createElement("div", _extends({
    ref: rootRef,
    className: ["sl-dp", className].filter(Boolean).join(" ")
  }, props), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "sl-dp__trigger",
    "data-placeholder": !from,
    "aria-haspopup": "dialog",
    "aria-expanded": open,
    onClick: () => setOpen(o => !o)
  }, CAL, /*#__PURE__*/React.createElement("span", null, label || placeholder)), open && /*#__PURE__*/React.createElement("div", {
    className: "sl-dp__pop",
    role: "dialog",
    "aria-label": "Choose date range"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sl-dp__hd"
  }, /*#__PURE__*/React.createElement("button", {
    className: "sl-dp__navbtn",
    "aria-label": "Previous month",
    onClick: () => setView(new Date(y, m - 1, 1))
  }, L), /*#__PURE__*/React.createElement("b", null, MONTHS[m], " ", y), /*#__PURE__*/React.createElement("button", {
    className: "sl-dp__navbtn",
    "aria-label": "Next month",
    onClick: () => setView(new Date(y, m + 1, 1))
  }, R)), /*#__PURE__*/React.createElement("div", {
    className: "sl-dp__grid"
  }, DOW.map(d => /*#__PURE__*/React.createElement("div", {
    key: d,
    className: "sl-dp__dow"
  }, d)), cells.map((day, i) => {
    if (!day) return /*#__PURE__*/React.createElement("div", {
      key: i,
      className: "sl-dp__day sl-dp__day--out"
    });
    const t = ymd(day),
      f = ymd(from),
      e = ymd(to);
    const isEdge = t === f || e && t === e;
    const inRange = f && e && t > f && t < e;
    const cls = ["sl-dp__day"];
    if (inRange) cls.push("sl-dp__day--in");
    if (isEdge) {
      cls.push("sl-dp__day--edge");
      if (t === f && e) cls.push("sl-dp__day--start");
      if (e && t === e) cls.push("sl-dp__day--end");
    }
    return /*#__PURE__*/React.createElement("button", {
      key: i,
      className: cls.join(" "),
      onClick: () => pick(day)
    }, day.getDate());
  })), /*#__PURE__*/React.createElement("div", {
    className: "sl-dp__foot"
  }, /*#__PURE__*/React.createElement("span", {
    className: "sl-dp__lbl"
  }, label || "Select start & end"), /*#__PURE__*/React.createElement("button", {
    className: "sl-dp__clear",
    onClick: clear
  }, "Clear"))));
}
Object.assign(__ds_scope, { DateRangePicker });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/DateRangePicker.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Dialog.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.sl-ovl{position:fixed;inset:0;z-index:1200;background:hsl(222.2 47.4% 11.2% / 0.45);display:flex;animation:sl-ovl-in .2s ease}
@keyframes sl-ovl-in{from{opacity:0}to{opacity:1}}
.sl-dialog{position:relative;z-index:1300;margin:auto;width:520px;max-width:calc(100vw - 32px);max-height:calc(100vh - 48px);overflow:auto;background:var(--popover);color:var(--popover-foreground);border:1px solid var(--border);border-radius:var(--radius-xl);box-shadow:var(--shadow-lg);animation:sl-dialog-in .3s cubic-bezier(0.16,1,0.3,1)}
.sl-dialog--sm{width:400px}
.sl-dialog--lg{width:680px}
@keyframes sl-dialog-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
.sl-dialog__x{position:absolute;top:14px;right:14px;width:32px;height:32px;border-radius:var(--radius-md);border:none;background:transparent;color:var(--muted-foreground);display:flex;align-items:center;justify-content:center;cursor:pointer}
.sl-dialog__x:hover{background:var(--muted);color:var(--foreground)}
.sl-dialog__x svg{width:17px;height:17px}
.sl-dialog__head{padding:20px 22px 4px}
.sl-dialog__title{font-size:18px;font-weight:600;letter-spacing:-0.01em;margin:0}
.sl-dialog__desc{margin:5px 0 0;font-size:13px;color:var(--muted-foreground);line-height:1.5}
.sl-dialog__body{padding:14px 22px}
.sl-dialog__foot{padding:14px 22px 18px;display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}
@media (prefers-reduced-motion: reduce){.sl-ovl,.sl-dialog{animation:none}}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}
const FOCUSABLE = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';
function useDismiss(open, onOpenChange, ref) {
  React.useEffect(() => {
    if (!open) return;
    const prev = document.activeElement;
    const onKey = e => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onOpenChange && onOpenChange(false);
      }
      if (e.key === "Tab" && ref.current) {
        const f = ref.current.querySelectorAll(FOCUSABLE);
        if (!f.length) return;
        const first = f[0],
          last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    const t = setTimeout(() => {
      if (ref.current) {
        const f = ref.current.querySelector(FOCUSABLE);
        (f || ref.current).focus();
      }
    }, 40);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      clearTimeout(t);
      document.body.style.overflow = overflow;
      if (prev && prev.focus) prev.focus();
    };
  }, [open, onOpenChange, ref]);
}
const XIcon = () => /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("path", {
  d: "M18 6 6 18M6 6l12 12"
}));

/**
 * Dialog — a centered modal. Radix-equivalent behavior: focus trap, Escape to close,
 * backdrop click to close, body scroll lock, focus restored on close.
 */
function Dialog({
  open,
  onOpenChange,
  size = "default",
  showClose = true,
  className = "",
  children,
  ...props
}) {
  ensureStyle("sl-dialog-css", CSS);
  const ref = React.useRef(null);
  useDismiss(open, onOpenChange, ref);
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "sl-ovl",
    onMouseDown: e => {
      if (e.target === e.currentTarget) onOpenChange && onOpenChange(false);
    }
  }, /*#__PURE__*/React.createElement("div", _extends({
    ref: ref,
    "data-slot": "dialog",
    role: "dialog",
    "aria-modal": "true",
    tabIndex: -1,
    className: ["sl-dialog", size !== "default" ? `sl-dialog--${size}` : "", className].filter(Boolean).join(" ")
  }, props), showClose && /*#__PURE__*/React.createElement("button", {
    className: "sl-dialog__x",
    "aria-label": "Close",
    onClick: () => onOpenChange && onOpenChange(false)
  }, /*#__PURE__*/React.createElement(XIcon, null)), children));
}
function DialogHeader({
  className = "",
  children,
  ...p
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: ["sl-dialog__head", className].filter(Boolean).join(" ")
  }, p), children);
}
function DialogTitle({
  className = "",
  children,
  ...p
}) {
  return /*#__PURE__*/React.createElement("h2", _extends({
    className: ["sl-dialog__title", className].filter(Boolean).join(" ")
  }, p), children);
}
function DialogDescription({
  className = "",
  children,
  ...p
}) {
  return /*#__PURE__*/React.createElement("p", _extends({
    className: ["sl-dialog__desc", className].filter(Boolean).join(" ")
  }, p), children);
}
function DialogBody({
  className = "",
  children,
  ...p
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: ["sl-dialog__body", className].filter(Boolean).join(" ")
  }, p), children);
}
function DialogFooter({
  className = "",
  children,
  ...p
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: ["sl-dialog__foot", className].filter(Boolean).join(" ")
  }, p), children);
}
Object.assign(__ds_scope, { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Sheet.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const CSS = `
.sl-sheet-ovl{position:fixed;inset:0;z-index:1200;background:hsl(222.2 47.4% 11.2% / 0.45);display:flex;animation:sl-sheet-fade .2s ease}
@keyframes sl-sheet-fade{from{opacity:0}to{opacity:1}}
.sl-sheet{position:relative;z-index:1300;background:var(--popover);color:var(--popover-foreground);border:1px solid var(--border);display:flex;flex-direction:column;box-shadow:var(--shadow-lg)}
.sl-sheet--bottom{margin-top:auto;width:100%;max-height:88vh;border-radius:var(--radius-xl) var(--radius-xl) 0 0;animation:sl-sheet-up .3s cubic-bezier(0.16,1,0.3,1)}
.sl-sheet--right{margin-left:auto;height:100%;width:400px;max-width:92vw;border-radius:0;animation:sl-sheet-right .3s cubic-bezier(0.16,1,0.3,1)}
@keyframes sl-sheet-up{from{transform:translateY(100%)}to{transform:none}}
@keyframes sl-sheet-right{from{transform:translateX(100%)}to{transform:none}}
.sl-sheet__grab{width:36px;height:4px;border-radius:2px;background:var(--border);margin:10px auto 2px}
.sl-sheet__head{padding:8px 20px 4px}
.sl-sheet__title{font-size:17px;font-weight:600;letter-spacing:-0.01em;margin:0}
.sl-sheet__desc{margin:4px 0 0;font-size:13px;color:var(--muted-foreground)}
.sl-sheet__body{padding:12px 20px;overflow:auto}
.sl-sheet__foot{padding:12px 20px 22px;display:flex;gap:10px;flex-direction:column}
@media (prefers-reduced-motion: reduce){.sl-sheet-ovl,.sl-sheet{animation:none}}
`;
function ensureStyle(id, css) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}
const FOCUSABLE = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

/**
 * Sheet — a panel that slides in from an edge. The mobile counterpart to Dialog
 * (bottom sheet); also supports a right side panel. Same dismiss behavior.
 */
function Sheet({
  open,
  onOpenChange,
  side = "bottom",
  showGrab = true,
  className = "",
  children,
  ...props
}) {
  ensureStyle("sl-sheet-css", CSS);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const prev = document.activeElement;
    const onKey = e => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onOpenChange && onOpenChange(false);
      }
      if (e.key === "Tab" && ref.current) {
        const f = ref.current.querySelectorAll(FOCUSABLE);
        if (!f.length) return;
        const first = f[0],
          last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    const t = setTimeout(() => {
      if (ref.current) {
        const f = ref.current.querySelector(FOCUSABLE);
        (f || ref.current).focus();
      }
    }, 40);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      clearTimeout(t);
      document.body.style.overflow = overflow;
      if (prev && prev.focus) prev.focus();
    };
  }, [open, onOpenChange]);
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "sl-sheet-ovl",
    onMouseDown: e => {
      if (e.target === e.currentTarget) onOpenChange && onOpenChange(false);
    }
  }, /*#__PURE__*/React.createElement("div", _extends({
    ref: ref,
    "data-slot": "sheet",
    role: "dialog",
    "aria-modal": "true",
    tabIndex: -1,
    className: ["sl-sheet", `sl-sheet--${side}`, className].filter(Boolean).join(" ")
  }, props), side === "bottom" && showGrab && /*#__PURE__*/React.createElement("div", {
    className: "sl-sheet__grab"
  }), children));
}
function SheetHeader({
  className = "",
  children,
  ...p
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: ["sl-sheet__head", className].filter(Boolean).join(" ")
  }, p), children);
}
function SheetTitle({
  className = "",
  children,
  ...p
}) {
  return /*#__PURE__*/React.createElement("h2", _extends({
    className: ["sl-sheet__title", className].filter(Boolean).join(" ")
  }, p), children);
}
function SheetDescription({
  className = "",
  children,
  ...p
}) {
  return /*#__PURE__*/React.createElement("p", _extends({
    className: ["sl-sheet__desc", className].filter(Boolean).join(" ")
  }, p), children);
}
function SheetBody({
  className = "",
  children,
  ...p
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: ["sl-sheet__body", className].filter(Boolean).join(" ")
  }, p), children);
}
function SheetFooter({
  className = "",
  children,
  ...p
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: ["sl-sheet__foot", className].filter(Boolean).join(" ")
  }, p), children);
}
Object.assign(__ds_scope, { Sheet, SheetHeader, SheetTitle, SheetDescription, SheetBody, SheetFooter });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Sheet.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.CardHeader = __ds_scope.CardHeader;

__ds_ns.CardTitle = __ds_scope.CardTitle;

__ds_ns.CardDescription = __ds_scope.CardDescription;

__ds_ns.CardContent = __ds_scope.CardContent;

__ds_ns.CardFooter = __ds_scope.CardFooter;

__ds_ns.Separator = __ds_scope.Separator;

__ds_ns.Skeleton = __ds_scope.Skeleton;

__ds_ns.EvidenceUpload = __ds_scope.EvidenceUpload;

__ds_ns.NumericKeypad = __ds_scope.NumericKeypad;

__ds_ns.SignaturePad = __ds_scope.SignaturePad;

__ds_ns.StatusBadge = __ds_scope.StatusBadge;

__ds_ns.TaskCard = __ds_scope.TaskCard;

__ds_ns.ThresholdReadout = __ds_scope.ThresholdReadout;

__ds_ns.TimelineRow = __ds_scope.TimelineRow;

__ds_ns.Alert = __ds_scope.Alert;

__ds_ns.AlertTitle = __ds_scope.AlertTitle;

__ds_ns.AlertDescription = __ds_scope.AlertDescription;

__ds_ns.EmptyState = __ds_scope.EmptyState;

__ds_ns.OfflineBanner = __ds_scope.OfflineBanner;

__ds_ns.Progress = __ds_scope.Progress;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.TabsList = __ds_scope.TabsList;

__ds_ns.TabsTrigger = __ds_scope.TabsTrigger;

__ds_ns.TabsContent = __ds_scope.TabsContent;

__ds_ns.Toaster = __ds_scope.Toaster;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Label = __ds_scope.Label;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Textarea = __ds_scope.Textarea;

__ds_ns.Combobox = __ds_scope.Combobox;

__ds_ns.DateRangePicker = __ds_scope.DateRangePicker;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.DialogHeader = __ds_scope.DialogHeader;

__ds_ns.DialogTitle = __ds_scope.DialogTitle;

__ds_ns.DialogDescription = __ds_scope.DialogDescription;

__ds_ns.DialogBody = __ds_scope.DialogBody;

__ds_ns.DialogFooter = __ds_scope.DialogFooter;

__ds_ns.Sheet = __ds_scope.Sheet;

__ds_ns.SheetHeader = __ds_scope.SheetHeader;

__ds_ns.SheetTitle = __ds_scope.SheetTitle;

__ds_ns.SheetDescription = __ds_scope.SheetDescription;

__ds_ns.SheetBody = __ds_scope.SheetBody;

__ds_ns.SheetFooter = __ds_scope.SheetFooter;

})();
