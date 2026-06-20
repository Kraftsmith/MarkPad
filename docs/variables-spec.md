# MarkPad — Document Variables: Functional & Technical Spec

## 1. Summary
Let authors define named variables with values, reference them inline in the
document, have the editor render the **value** in place, and have **all
references update** when a value changes. The document stays *parameterized* —
the source keeps the references, not the baked-in values — so it's portable and
re-usable.

## 2. Goals / Non-goals

**Goals (v1)**
- Define document-scoped variables (`name → value`).
- Reference a variable inline; editor renders its current value.
- Edit a value once → every reference updates live.
- Persist in the `.md` file in a portable, plain-text-readable way.
- Clear visual distinction between a variable and normal text; clear
  "undefined variable" state.

**Non-goals (v1)**
- Expressions/computation, conditionals, loops (templating logic).
- Variables inside code blocks (left literal), links/URLs/attributes, or other files.
- Nested/recursive variable resolution.
- Multi-document / global variable libraries.

---

## 3. Functional Spec

### 3.1 Syntax
- **Definition** — YAML frontmatter under a `vars:` key (standard, portable,
  agent/tool-readable):
  ```markdown
  ---
  vars:
    productName: MarkPad
    version: 0.2.12
    company: Ship-Lab
  ---
  ```
- **Reference** — `{{ name }}` in body text (whitespace optional):
  `Welcome to {{productName}} v{{version}}.`

### 3.2 Rendering behavior
- A defined reference renders as its **value**, styled as a subtle **chip**
  (rounded background) so it's recognizable as a variable. Hovering shows the
  variable name (`{{productName}}`).
- An **undefined** reference renders as the literal `{{name}}` in a warning style
  (dashed/red), so the author notices.
- References **inside inline code or fenced code blocks are NOT substituted**
  (stay literal).
- **Escape**: `\{{name}}` renders the literal text `{{name}}`.

### 3.3 Update behavior
- Changing a value (via the Variables panel) updates **every** chip for that
  variable immediately and writes the new value to frontmatter.
- Adding/removing/renaming a variable updates frontmatter; existing references to
  a removed variable become "undefined" chips.

### 3.4 UI
- **Variables panel** — opened from a toolbar button (`{x}` icon) or the `⋯`
  menu. Lists each variable as `name | value` (editable), with **+ add** and
  **× remove**. Editing a value is live.
- **Inline chip** — non-editable unit; the author inserts a reference by typing
  `{{name}}` (autocomplete of known names after `{{` is a nice-to-have), and
  removes it by deleting the chip.

### 3.5 Persistence / portability
- The `.md` on disk contains the `vars:` frontmatter **+ `{{name}}` references** —
  never the baked values. Opened in any other editor it's plain, legible
  markdown; MarkPad renders the values.

### 3.6 Examples
Source on disk:
```markdown
---
vars: { productName: MarkPad, version: 0.2.12 }
---
# {{productName}} {{version}}
{{productName}} is a visual markdown editor.
```
Editor shows: **MarkPad 0.2.12** / "**MarkPad** is a visual markdown editor."
Change `productName` → `MarkPad Pro` in the panel → both render "MarkPad Pro";
file still stores `{{productName}}`.

---

## 4. Technical Spec

### 4.1 Where it fits
A webview module `variables.ts` wired into the Vditor `after()` hook, plus a small
floating **Variables panel** (like the TTS bar) and frontmatter parsing. Chips are
(re)applied at **stable settle moments only** — debounced `input` / `keyup` /
`mouseup` / `focusout` — **not** via a `MutationObserver` or `selectionchange`, both
of which fire mid-edit before the committed caret exists and corrupt the selection
(this caused a cursor-jump bug; see §4.7).

### 4.2 The round-trip problem — and the chosen solution
The hard part in a Vditor/Lute WYSIWYG: if we *replace* `{{name}}` text with the
value, `vditor.getValue()` serializes the value, corrupting the source.

**Chosen approach — keep `{{name}}` as the real DOM text; show the value via CSS:**
```html
<span class="markpad-var" contenteditable="false" data-var="productName" data-value="MarkPad"><span class="markpad-var__raw">{{productName}}</span></span>
```
```css
.markpad-var__raw { display: none; }            /* hide the literal {{name}} */
.markpad-var::before {                          /* show the value */
  content: attr(data-value);
  background: var(--vscode-badge-background, rgba(110,118,129,.25));
  border-radius: 4px; padding: 0 5px; font-size: 0.95em;
}
.markpad-var--undef .markpad-var__raw { display: inline; }   /* show raw {{name}} */
.markpad-var--undef::before { content: none; }
```
Why this works:
- The chip's **textContent is `{{name}}`** (held in the hidden `.markpad-var__raw`),
  so `vditor.getValue()` always emits `{{name}}` — round-trip is correct by
  construction; `readMarkdown` additionally strips chips from a clone before
  serializing as a guarantee.
- The displayed value is a **CSS pseudo-element** (`::before` from `data-value`) —
  not in the DOM text model, so it never leaks into the markdown.
- The chip is purely visual: if Vditor re-renders a block the underlying text is
  still `{{name}}`; the settle re-chip re-applies it.

### 4.3 Components
1. **Frontmatter parse/serialize** — on load, parse the `vars:` map (Lute already
   supports frontmatter; parse the YAML subset for `vars`). Keep an in-webview
   `Map<string,string>`. Serialize back into the frontmatter block on change.
2. **`variables.ts` chip layer** — walk visible IR text nodes (skip `code`/`pre`,
   `vditor-ir__preview`, yaml-front-matter, already-wrapped chips), find
   `{{\s*name\s*}}` via regex, wrap each match in the chip span (or `--undef` if
   unknown). Re-applied on the debounced settle events, **always skipping the
   block(s) holding the caret and the exact caret nodes**, and wrapped in
   `preserveCaret` (§4.7). Before any edit, capture-phase listeners strip chips back
   to raw text in the affected blocks so Vditor never serializes a chip span.
3. **Variables panel** — floating widget: rows of `name | <input value>`,
   add/remove. On input change → update the Map → update **all** chips'
   `data-value` (a single pass setting `data-value` by `data-var`) → rewrite
   frontmatter → trigger save.
4. **Insertion autocomplete (nice-to-have)** — when the user types `{{`, suggest
   known variable names (reuse the `autocomplete.ts` popup machinery).

### 4.4 Update propagation
Value change → set `el.dataset.value` on every `.markpad-var[data-var="X"]` (CSS
`::before` updates instantly) → no Vditor re-render needed for display → write
frontmatter → the normal edit-sync persists it.

### 4.5 Edge cases
| Case | Handling |
|---|---|
| Undefined var | `--undef` chip, literal `{{name}}`, warning style |
| In code / inline-code | Skip (don't wrap) |
| `\{{name}}` escape | Skip; strip the `\` on render |
| Nested `{{a{{b}}}}` | Not supported in v1; treat outer as undefined |
| Duplicate frontmatter keys | Last wins; surface a warning |
| Value contains markdown | v1: rendered as plain text (no nested markdown) |

### 4.6 Files
- **New:** `media-src/src/variables.ts` (enhancer + panel), styles in `main.css`.
- **Changed:** `main.ts` (call `enableVariables()` in `after()`), `toolbar.ts`
  (Variables button), possibly a tiny YAML-frontmatter helper.
- **No `extension.ts` change** for v1 (everything is in the webview; persistence
  rides the existing edit-sync).

### 4.7 Caret safety — the hard part (resolved)
Chips are foreign `contenteditable=false` nodes inside Vditor's own IR
contenteditable. **Confirmed root cause of an early cursor-jump bug:** any chip DOM
mutation that leaves the browser selection detached or outside `ir.element` makes
Vditor's `getEditorRange()` (`util/selection.ts`) fall back to
`range.setStart(ir.element, 0)` — i.e. the caret snaps to the **top of the
document**. The triggers were a `MutationObserver` and a `selectionchange` listener
that re-chipped *mid-edit* (when `getSelection()` doesn't yet reflect the caret),
plus a chip left inside a block Vditor then re-serialized (breaking its `<wbr>`
caret restore). Independently reproduced and confirmed.

Implemented mitigations (all in `variables.ts`):
- **Settle-only re-chip** — `input` / `keyup` / `mouseup` / `focusout`, debounced.
  No `MutationObserver`, no `selectionchange`.
- **Strip-before-edit** — capture-phase `beforeinput`, `keydown`(Backspace/Delete/
  Enter), `paste`, `cut`, and `.vditor-toolbar` `mousedown` remove chips from the
  affected blocks, so Vditor only ever serializes clean `{{name}}` text.
- **Never re-chip the caret's block(s) or nodes** — `applyChips` skips the anchor
  and focus blocks and the exact caret nodes; bails during IME (`ir.composingLock`).
- **`preserveCaret`** — captures the caret as a character offset (invariant because
  a chip's textContent IS `{{name}}`), and if a mutation leaves the selection
  outside `ir.element`, restores it via Vditor's `setSelectionByPosition` and
  re-seats `vditor.ir.range`, so the top-fallback can never fire.

Considered but rejected: a `position:absolute` overlay layer (Vditor DOM stays plain
text) — cleanest for caret-safety, but the raw `{{name}}` keeps its own text width so
a different-width value overlay misaligns; unsuitable for inline value rendering.

### 4.8 Other notes
- **Frontmatter visibility** — resolved: the `vars:` block is kept OUT of the editing
  surface (parsed on load, re-injected on save) and managed via the panel; other
  frontmatter keys stay visible.
- **Performance** — regex scan only on debounced settle events; fine for normal docs.

---

## 5. Phased plan
1. **P1 — Core:** frontmatter parse, `variables.ts` chip rendering
   (pseudo-element), defined/undefined states, round-trip verified.
2. **P2 — Editing:** Variables panel (list/add/edit/remove), live propagation,
   frontmatter write-back.
3. **P3 — Polish:** `{{`-autocomplete, hide-frontmatter option,
   rename-with-reference-update, escape handling.

## 6. Test plan
- Round-trip: type `{{x}}`, save, reopen → file still has `{{x}}` + chip renders value.
- Update: change value in panel → all chips update, file frontmatter updated, undo works.
- Undefined → define → it resolves; remove → reverts to undefined.
- Code blocks/inline code: `{{x}}` stays literal.
- Vditor reflow: edit text around a chip → chip re-applies, source intact.
- External edit (agent/git) changes frontmatter value → chips update (rides the
  existing external-sync).
