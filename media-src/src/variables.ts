/**
 * Document variables.
 *
 * Authors define `name: value` pairs in a `vars:` YAML frontmatter key and
 * reference them inline as `{{name}}`. The editor renders the value as a chip;
 * changing a value (via the Variables panel) updates every reference and the
 * file's frontmatter. The document stays parameterized — the markdown on disk
 * keeps `{{name}}` and the `vars:` block, never the baked-in values.
 *
 * Design (see docs/variables-spec.md):
 *  - The `vars:` frontmatter is kept OUT of the Vditor editing surface: it's
 *    parsed off on load (`loadVars`) and re-injected when we read markdown for
 *    saving (`readMarkdown` → `injectVars`). Other frontmatter keys stay in the
 *    document. This keeps the editor body and the variable store from drifting,
 *    with no `setValue` needed when a value changes.
 *  - A reference renders as a non-editable chip: `<span class="markpad-var">`
 *    whose textContent is the literal `{{name}}` (hidden via a nested raw span)
 *    while the value shows through `::before { content: attr(data-value) }`.
 *    Because the chip's text IS `{{name}}`, serialization round-trips correctly;
 *    `readMarkdown` additionally strips chips from a clone before serializing as
 *    a guarantee.
 *  - Chips are (re)applied on a debounce at stable moments only (input / keyup /
 *    mouseup / focus-out settle) — never on `selectionchange` and never via a
 *    MutationObserver, both of which fire mid-edit before the committed caret is
 *    reflected. Before any edit, the affected blocks are stripped back to raw
 *    text (capture-phase listeners), so Vditor only ever serializes clean
 *    `{{name}}` and its <wbr> caret restore is never disturbed. The block holding
 *    the caret is skipped while re-chipping, and `preserveCaret` guarantees the
 *    selection stays inside the editor so Vditor's getEditorRange can never snap
 *    the caret to the top of the document.
 */

import { getSelectPosition } from 'vditor/src/ts/util/selection'

const CHIP_CLASS = 'markpad-var'
const UNDEF_CLASS = 'markpad-var--undef'
const RAW_CLASS = 'markpad-var__raw'
const PANEL_CLASS = 'markpad-vars'
// {{ name }} — letters/digits/_/-/. , optional inner whitespace.
const REF_RE = /\{\{\s*([\w.\-]+)\s*\}\}/g

let varsMap = new Map<string, string>()
let wired = false
let scheduleTimer: ReturnType<typeof setTimeout> | undefined

/* ------------------------------------------------------------------ helpers */

function vd(): any {
  return (window as any).vditor
}
function iv(): any {
  return (window as any).vditor?.vditor
}
function activeEditable(): HTMLElement | null {
  const v = iv()
  if (!v || v.currentMode !== 'ir') return null
  return v.ir?.element ?? null
}

/* ------------------------------------------------------- frontmatter parsing */

function unquote(s: string): string {
  s = s.trim()
  if (
    s.length >= 2 &&
    ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))
  ) {
    const inner = s.slice(1, -1)
    return s[0] === '"' ? inner.replace(/\\(["\\])/g, '$1') : inner
  }
  return s
}

function splitTopCommas(s: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = ''
  for (const ch of s) {
    if (q) {
      cur += ch
      if (ch === q) q = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      q = ch
      cur += ch
      continue
    }
    if (ch === ',') {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

function parseInline(s: string, vars: Map<string, string>) {
  s = s.replace(/^\{/, '').replace(/\}\s*$/, '')
  for (const pair of splitTopCommas(s)) {
    const idx = pair.indexOf(':')
    if (idx === -1) continue
    const k = unquote(pair.slice(0, idx))
    if (k) vars.set(k, unquote(pair.slice(idx + 1)))
  }
}

// Pull `vars:` out of frontmatter lines, returning the parsed map and the
// remaining (non-vars) frontmatter lines.
function extractVars(fmLines: string[]): {
  vars: Map<string, string>
  restLines: string[]
} {
  const vars = new Map<string, string>()
  const restLines: string[] = []
  let i = 0
  while (i < fmLines.length) {
    const line = fmLines[i]
    const m = /^vars\s*:(.*)$/.exec(line)
    if (!m) {
      restLines.push(line)
      i++
      continue
    }
    const inline = m[1].trim()
    if (inline.startsWith('{')) {
      parseInline(inline, vars)
      i++
      continue
    }
    // Block style: consume the indented child lines.
    i++
    while (i < fmLines.length && /^\s+\S/.test(fmLines[i])) {
      const km = /^\s+([\w.\-]+)\s*:\s?(.*)$/.exec(fmLines[i])
      if (km) vars.set(km[1], unquote(km[2]))
      i++
    }
  }
  return { vars, restLines }
}

// Parse `vars:` off the front of a document. Returns the variable map and the
// document body with the `vars:` key removed (other frontmatter kept).
export function splitVars(md: string): {
  vars: Map<string, string>
  body: string
} {
  const norm = md.replace(/^﻿/, '').replace(/\r\n/g, '\n')
  const lines = norm.split('\n')
  if (lines[0]?.trim() !== '---') return { vars: new Map(), body: md }
  let close = -1
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trim()
    if (t === '---' || t === '...') {
      close = i
      break
    }
  }
  if (close === -1) return { vars: new Map(), body: md }

  const { vars, restLines } = extractVars(lines.slice(1, close))
  if (vars.size === 0) return { vars, body: md } // nothing ours — leave untouched
  const bodyLines = lines.slice(close + 1)
  const body =
    restLines.length === 0
      ? bodyLines.join('\n')
      : ['---', ...restLines, '---', ...bodyLines].join('\n')
  return { vars, body }
}

function dq(v: string): string {
  return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}
function quoteIfNeeded(v: string): string {
  if (v === '') return '""'
  if (/^\s|\s$/.test(v)) return dq(v)
  if (/:\s/.test(v) || /:$/.test(v) || v.indexOf('\n') > -1) return dq(v)
  if (/^[#&*!|>%@`"'\[\]{}\-?,]/.test(v)) return dq(v)
  return v
}
function serializeVars(vars: Map<string, string>): string[] {
  const out = ['vars:']
  for (const [k, v] of vars) out.push(`  ${k}: ${quoteIfNeeded(v)}`)
  return out
}

// Re-insert the `vars:` block into a document's frontmatter (creating the block
// if needed). No-op when there are no variables, so plain documents are untouched.
export function injectVars(body: string, vars: Map<string, string>): string {
  if (vars.size === 0) return body
  const block = serializeVars(vars)
  const norm = body.replace(/^﻿/, '').replace(/\r\n/g, '\n')
  const lines = norm.split('\n')
  if (lines[0]?.trim() === '---') {
    let close = -1
    for (let i = 1; i < lines.length; i++) {
      const t = lines[i].trim()
      if (t === '---' || t === '...') {
        close = i
        break
      }
    }
    if (close !== -1) {
      const { restLines } = extractVars(lines.slice(1, close))
      return [
        '---',
        ...restLines,
        ...block,
        '---',
        ...lines.slice(close + 1),
      ].join('\n')
    }
  }
  return ['---', ...block, '---', '', ...lines].join('\n')
}

/* ------------------------------------------------------------- chip rendering */

function decorateChip(chip: HTMLElement, name: string, vars: Map<string, string>) {
  const val = vars.get(name)
  if (val === undefined) {
    chip.classList.add(UNDEF_CLASS)
    chip.removeAttribute('data-value')
    chip.setAttribute(
      'title',
      `{{${name}}} — not defined. Add it in the Variables panel.`
    )
  } else {
    chip.classList.remove(UNDEF_CLASS)
    chip.setAttribute('data-value', val)
    chip.setAttribute('title', `{{${name}}}`)
  }
}

function makeChip(full: string, name: string, vars: Map<string, string>): HTMLElement {
  const chip = document.createElement('span')
  chip.className = CHIP_CLASS
  chip.setAttribute('contenteditable', 'false')
  chip.setAttribute('data-var', name)
  const raw = document.createElement('span')
  raw.className = RAW_CLASS
  raw.textContent = full // exact source text → round-trips on serialize
  chip.appendChild(raw)
  decorateChip(chip, name, vars)
  return chip
}

function inSkippable(
  node: Node,
  boundary: HTMLElement,
  focusedBlocks: Array<HTMLElement | null>
): boolean {
  let el = node.parentElement
  while (el && el !== boundary) {
    if (el.classList.contains(CHIP_CLASS)) return true
    if (el.tagName === 'CODE' || el.tagName === 'PRE') return true
    if (el.classList.contains('vditor-ir__preview')) return true
    if (el.getAttribute('data-type') === 'yaml-front-matter') return true
    if (focusedBlocks.indexOf(el) !== -1) return true
    el = el.parentElement
  }
  return false
}

function wrapTextNode(node: Text, vars: Map<string, string>) {
  const text = node.nodeValue || ''
  REF_RE.lastIndex = 0
  const frag = document.createDocumentFragment()
  let last = 0
  let m: RegExpExecArray | null
  while ((m = REF_RE.exec(text))) {
    const start = m.index
    if (start > last) frag.appendChild(document.createTextNode(text.slice(last, start)))
    frag.appendChild(makeChip(m[0], m[1], vars))
    last = start + m[0].length
  }
  if (last === 0) return
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))
  node.parentNode?.replaceChild(frag, node)
}

// The editable's direct-child block containing `node` (robust across IR's block
// structure rather than guessing element tags).
function topBlock(node: Node | null, editable: HTMLElement): HTMLElement | null {
  if (!node || !editable.contains(node)) return null
  let el: Node | null = node
  while (el && el.parentNode && el.parentNode !== editable) el = el.parentNode
  return el && el.parentNode === editable && el.nodeType === 1
    ? (el as HTMLElement)
    : null
}

function setSelectionByTextOffset(
  start: number,
  end: number,
  editable: HTMLElement
): Range {
  const range = document.createRange()
  const clamp = (n: number) => Math.max(0, Math.min(n, editable.textContent?.length ?? 0))
  start = clamp(start)
  end = clamp(end)

  const pointBefore = (node: Node): { node: Node; offset: number } => {
    const parent = node.parentNode
    return parent
      ? { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, node) }
      : { node: editable, offset: 0 }
  }
  const pointAfter = (node: Node): { node: Node; offset: number } => {
    const parent = node.parentNode
    return parent
      ? { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, node) + 1 }
      : { node: editable, offset: editable.childNodes.length }
  }

  const locate = (target: number): { node: Node; offset: number } => {
    let index = 0
    let last: { node: Node; offset: number } = { node: editable, offset: 0 }

    const walk = (node: Node): { node: Node; offset: number } | null => {
      if (node instanceof HTMLElement && node.classList.contains(CHIP_CLASS)) {
        const len = node.textContent?.length ?? 0
        if (target <= index + len) {
          return target <= index ? pointBefore(node) : pointAfter(node)
        }
        index += len
        last = pointAfter(node)
        return null
      }

      if (node.nodeType === Node.TEXT_NODE) {
        const len = node.nodeValue?.length ?? 0
        if (target <= index + len) return { node, offset: target - index }
        index += len
        last = { node, offset: len }
        return null
      }

      for (const child of Array.from(node.childNodes)) {
        const found = walk(child)
        if (found) return found
      }
      return null
    }

    return walk(editable) ?? last
  }

  const s = locate(start)
  const e = locate(end)
  range.setStart(s.node, s.offset)
  range.setEnd(e.node, e.offset)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
  return range
}


function unchip(chip: Element) {
  chip.replaceWith(document.createTextNode(chip.textContent || ''))
}

// Before Vditor edits the DOM, remove chips from every block the edit can touch
// (the caret's block, its neighbours for merges, and any block a non-collapsed
// selection spans). Vditor re-serializes edited blocks and restores the caret
// via <wbr>; a foreign contenteditable=false chip span breaks that and drops the
// caret to the top of the document. Keeping edited blocks as clean {{name}} text
// avoids it. Chips are re-applied (outside the focused block) once editing settles.
function stripChipsForEdit(target: EventTarget | null) {
  preserveCaret(() => stripChipsForEditUnsafe(target))
}

function stripChipsForEditUnsafe(target: EventTarget | null) {
  const editable = activeEditable()
  if (!editable) return
  const sel = window.getSelection()
  const inEditor =
    (sel && sel.rangeCount > 0 && editable.contains(sel.anchorNode)) ||
    (target instanceof Node && editable.contains(target))
  if (!inEditor) return

  const risk = new Set<Element>()
  const add = (node: Node | null) => {
    const b = topBlock(node, editable)
    if (!b) return
    risk.add(b)
    if (b.previousElementSibling) risk.add(b.previousElementSibling)
    if (b.nextElementSibling) risk.add(b.nextElementSibling)
  }
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0)
    add(range.startContainer)
    add(range.endContainer)
    if (!range.collapsed) {
      editable.querySelectorAll(':scope > *').forEach((b) => {
        try {
          if (range.intersectsNode(b)) risk.add(b)
        } catch {
          /* ignore */
        }
      })
    }
  }
  if (risk.size === 0) return
  risk.forEach((b) => b.querySelectorAll('.' + CHIP_CLASS).forEach(unchip))
}

function applyChips(vars: Map<string, string>, editable: HTMLElement) {
  // 1. Refresh existing chips' values / undefined state.
  editable
    .querySelectorAll<HTMLElement>('.' + CHIP_CLASS)
    .forEach((chip) => decorateChip(chip, chip.getAttribute('data-var') || '', vars))

  // 2. Wrap newly-typed references, but never touch the block(s) the selection is
  // in, nor the exact caret nodes — replacing them would drop the selection (and
  // Vditor would then snap the caret to the top of the document).
  const sel = window.getSelection()
  const caretNodes: Node[] = []
  const focusedBlocks: Array<HTMLElement | null> = []
  if (sel && sel.rangeCount > 0) {
    if (editable.contains(sel.anchorNode)) {
      caretNodes.push(sel.anchorNode as Node)
      focusedBlocks.push(topBlock(sel.anchorNode, editable))
    }
    if (sel.focusNode && editable.contains(sel.focusNode)) {
      caretNodes.push(sel.focusNode)
      focusedBlocks.push(topBlock(sel.focusNode, editable))
    }
  }

  const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT)
  const targets: Text[] = []
  let n: Node | null
  while ((n = walker.nextNode())) {
    const t = n as Text
    if (!t.nodeValue || t.nodeValue.indexOf('{{') === -1) continue
    if (caretNodes.indexOf(t) !== -1) continue
    if (inSkippable(t, editable, focusedBlocks)) continue
    REF_RE.lastIndex = 0
    if (REF_RE.test(t.nodeValue)) targets.push(t)
  }
  targets.forEach((t) => wrapTextNode(t, vars))
}

// Run a chip mutation while guaranteeing the editor's selection stays valid.
// Our DOM writes can leave the selection detached or outside ir.element; Vditor's
// getEditorRange() then falls back to the TOP of the document. If the caret was in
// the editor and escaped, restore it by exact character offset (a chip's
// textContent IS `{{name}}`, so offsets are invariant under chip/unchip) and
// re-seat Vditor's saved range so even its own fallback is correct.
function preserveCaret(fn: () => void) {
  const editor = iv()
  const editable = activeEditable()
  if (!editable) {
    fn()
    return
  }
  const focused =
    !!document.activeElement && editable.contains(document.activeElement)
  let pos: { start: number; end: number } | null = null
  const selBefore = window.getSelection()
  if (
    focused &&
    selBefore &&
    selBefore.rangeCount > 0 &&
    editable.contains(selBefore.anchorNode)
  ) {
    try {
      pos = getSelectPosition(editable, editable, selBefore.getRangeAt(0))
    } catch {
      pos = null
    }
  }

  fn()

  if (!focused || !pos) return
  const selAfter = window.getSelection()
  const stillInside =
    selAfter && selAfter.rangeCount > 0 && editable.contains(selAfter.anchorNode)
  let needsRestore = !stillInside
  if (stillInside) {
    try {
      const afterPos = getSelectPosition(editable, editable, selAfter!.getRangeAt(0))
      needsRestore = afterPos.start !== pos.start || afterPos.end !== pos.end
    } catch {
      needsRestore = true
    }
  }
  if (!needsRestore) {
    if (editor?.ir && selAfter?.rangeCount) editor.ir.range = selAfter.getRangeAt(0).cloneRange()
    return
  }
  try {
    const r = setSelectionByTextOffset(pos.start, pos.end, editable)
    if (editor?.ir) editor.ir.range = r
  } catch {
    /* ignore */
  }
}

// Re-apply chips at a stable moment. Bails mid-IME and preserves the caret.
export function refreshVariables() {
  const editor = iv()
  const editable = activeEditable()
  if (!editable) return
  if (editor?.ir?.composingLock) return
  preserveCaret(() => applyChips(varsMap, editable))
}

/* ----------------------------------------------------------- markdown read/io */

// Serialize the editing surface to markdown with MarkPad-only DOM removed.
// Mirrors Vditor's own getMarkdown (lute.Vditor*DOM2Md(element.innerHTML)) but on
// a clone, so editor enhancements never leak into saved markdown or echo checks.
function serializeBody(): string {
  const v = vd()
  const editor = iv()
  if (!editor) return v?.getValue?.() ?? ''
  const strip = (el: HTMLElement, toMd: (html: string) => string): string => {
    const hasChips = el.innerHTML.indexOf(CHIP_CLASS) !== -1
    const hasArtifacts =
      hasChips ||
      el.querySelector('.markpad-bpmn, .msmd-table-col-resize, table > colgroup') !== null
    if (!hasArtifacts) return v.getValue()

    const clone = el.cloneNode(true) as HTMLElement
    clone
      .querySelectorAll('.' + CHIP_CLASS)
      .forEach((c) => c.replaceWith(document.createTextNode(c.textContent || '')))
    clone
      .querySelectorAll('.markpad-bpmn, .msmd-table-col-resize, table > colgroup')
      .forEach((c) => c.remove())
    return toMd(clone.innerHTML)
  }
  if (editor.currentMode === 'ir' && editor.ir?.element && editor.lute?.VditorIRDOM2Md) {
    return strip(editor.ir.element, (h) => editor.lute.VditorIRDOM2Md(h))
  }
  if (
    editor.currentMode === 'wysiwyg' &&
    editor.wysiwyg?.element &&
    editor.lute?.VditorDOM2Md
  ) {
    return strip(editor.wysiwyg.element, (h) => editor.lute.VditorDOM2Md(h))
  }
  return v.getValue() // sv mode shows raw text — already correct
}

// Markdown to persist: editor body + the `vars:` frontmatter re-injected.
export function readMarkdown(): string {
  return injectVars(serializeBody(), varsMap)
}

// Count GFM table blocks (a header line immediately followed by a delimiter
// row), ignoring fenced code so pipe-art inside code isn't miscounted.
function countMarkdownTables(md: string): number {
  const noFences = md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '')
  const lines = noFences.split('\n')
  let n = 0
  for (let i = 1; i < lines.length; i++) {
    if (
      /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(lines[i]) &&
      lines[i - 1].indexOf('|') !== -1
    ) {
      n++
    }
  }
  return n
}

// Guard for persistence. On every keystroke MarkPad re-serializes the whole IR
// DOM through Lute and overwrites the file. If that serialize lands while an
// async DOM mutation (chip re-apply, colgroup inject, Vditor block re-render)
// has a table momentarily malformed, Lute can drop the entire table — silently
// corrupting a region the user never touched. We can't win the race, so we
// refuse to persist a serialization that lost a table versus the live DOM and
// let the caller retry once the DOM settles. After a few consecutive misses we
// give up and persist anyway, so a genuine (non-transient) mismatch — e.g. a DOM
// table Lute legitimately doesn't emit as GFM — can't wedge saving forever.
let lossyStreak = 0
export function readMarkdownForSave(): string | null {
  const md = readMarkdown()
  const editable = activeEditable()
  if (!editable) {
    lossyStreak = 0
    return md
  }
  const domTables = editable.querySelectorAll('table').length
  const mdTables = countMarkdownTables(md)
  if (domTables > 0 && mdTables < domTables) {
    lossyStreak++
    console.warn(
      `[MarkPad] Skipped save: serialize dropped a table (DOM ${domTables} > markdown ${mdTables}); retry #${lossyStreak}`
    )
    if (lossyStreak < 4) return null
    console.warn(
      '[MarkPad] Persisting despite table-count mismatch after repeated retries'
    )
  }
  lossyStreak = 0
  return md
}

// Parse `vars:` off a document, store them, and return the body to feed Vditor.
export function loadVars(md: string): string {
  const { vars, body } = splitVars(md)
  varsMap = vars
  return body
}

function persistNow() {
  const content = readMarkdownForSave()
  if (content === null) {
    // A transient malformed DOM dropped a table; retry once it settles.
    schedulePersist()
    return
  }
  ;(window as any).vscode?.postMessage({ command: 'edit', content })
}
let persistTimer: ReturnType<typeof setTimeout> | undefined
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(persistNow, 350)
}

/* ----------------------------------------------------------- Variables panel */

let panel: HTMLElement | null = null

export function toggleVariablesPanel() {
  if (panel) {
    closePanel()
    return
  }
  openPanel()
}

function closePanel() {
  panel?.remove()
  panel = null
}

function openPanel() {
  panel = document.createElement('div')
  panel.className = PANEL_CLASS
  document.body.appendChild(panel)
  renderPanel()
}

function renderPanel() {
  if (!panel) return
  panel.innerHTML = `
    <div class="markpad-vars__head">
      <span class="markpad-vars__title">Variables</span>
      <button class="markpad-vars__close" title="Close">✕</button>
    </div>
    <div class="markpad-vars__list"></div>
    <div class="markpad-vars__add">
      <input class="markpad-vars__name" placeholder="name" spellcheck="false" />
      <input class="markpad-vars__val" placeholder="value" />
      <button class="markpad-vars__addbtn" title="Add variable">＋</button>
    </div>
    <div class="markpad-vars__hint">Reference a variable as <code>{{name}}</code> in the text.</div>`

  const list = panel.querySelector('.markpad-vars__list') as HTMLElement
  const names = [...varsMap.keys()].sort((a, b) => a.localeCompare(b))
  if (names.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'markpad-vars__empty'
    empty.textContent = 'No variables yet — add one below.'
    list.appendChild(empty)
  }
  for (const name of names) {
    const row = document.createElement('div')
    row.className = 'markpad-vars__row'

    const label = document.createElement('span')
    label.className = 'markpad-vars__label'
    label.textContent = name
    label.title = name

    const input = document.createElement('input')
    input.className = 'markpad-vars__rowval'
    input.value = varsMap.get(name) ?? ''
    input.addEventListener('input', () => {
      varsMap.set(name, input.value)
      refreshVariables()
      schedulePersist()
    })
    input.addEventListener('change', persistNow)

    const del = document.createElement('button')
    del.className = 'markpad-vars__del'
    del.title = 'Remove variable'
    del.textContent = '✕'
    del.addEventListener('click', () => {
      varsMap.delete(name)
      renderPanel()
      refreshVariables()
      persistNow()
    })

    row.append(label, input, del)
    list.appendChild(row)
  }

  const nameI = panel.querySelector('.markpad-vars__name') as HTMLInputElement
  const valI = panel.querySelector('.markpad-vars__val') as HTMLInputElement
  const add = () => {
    const nm = nameI.value.trim()
    if (!nm || !/^[\w.\-]+$/.test(nm)) {
      nameI.focus()
      return
    }
    varsMap.set(nm, valI.value)
    nameI.value = ''
    valI.value = ''
    renderPanel()
    refreshVariables()
    persistNow()
    ;(panel!.querySelector('.markpad-vars__name') as HTMLInputElement)?.focus()
  }
  ;(panel.querySelector('.markpad-vars__addbtn') as HTMLElement).addEventListener(
    'click',
    add
  )
  ;[nameI, valI].forEach((el) =>
    el.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        add()
      }
    })
  )
  ;(panel.querySelector('.markpad-vars__close') as HTMLElement).addEventListener(
    'click',
    closePanel
  )
}

/* ------------------------------------------------------------------- wiring */

function schedule() {
  if (scheduleTimer) clearTimeout(scheduleTimer)
  scheduleTimer = setTimeout(refreshVariables, 200)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'
  )
}

// Suggestions for the `{{` insertion hint. Vditor inserts the chosen item's
// `value` (the full `{{name}}`) through its own caret-safe hint path, so we never
// edit the editable DOM ourselves here. Only currently-defined variables are
// offered (define them in the Variables panel first).
function buildVarHints(key: string): Array<{ value: string; html: string }> {
  const k = key.trim().toLowerCase()
  const items: Array<{ value: string; html: string }> = []
  for (const [name, val] of varsMap) {
    if (k && name.toLowerCase().indexOf(k) === -1) continue
    items.push({
      value: `{{${name}}}`,
      html: `<span class="markpad-hint__val">${escapeHtml(val)}</span>${escapeHtml(name)}`,
    })
  }
  items.sort((a, b) => a.value.localeCompare(b.value))
  return items
}

// Register `{{` as a trigger in Vditor's built-in hint system (same machinery as
// the `:` emoji hint): dropdown, filtering, ↑/↓ + Enter, and the insertion are all
// handled by Vditor — caret-safe, no manual DOM edits. Idempotent per editor.
function registerHintExtender() {
  const hint = iv()?.options?.hint
  if (!hint) return
  if (!Array.isArray(hint.extend)) hint.extend = []
  if (!hint.extend.some((e: any) => e && e.key === '{{')) {
    hint.extend.push({ key: '{{', hint: (k: string) => buildVarHints(k) })
  }
}

export function enableVariables() {
  if (!iv()?.element) return
  registerHintExtender()

  if (!wired) {
    wired = true

    // Re-chip only at stable settle moments where the selection reliably reflects
    // the caret — NOT on `selectionchange` (fires mid-edit before the committed
    // caret) and NOT via a MutationObserver (Vditor rewrites the DOM constantly).
    // These events bubble to `document`; refreshVariables no-ops without an editor.
    document.addEventListener('input', schedule)
    document.addEventListener('keyup', schedule)
    document.addEventListener('mouseup', schedule)
    document.addEventListener('focusout', schedule)

    // Keep the editor's DOM as clean `{{name}}` text whenever a block is about to
    // be edited or serialized, so Vditor never touches a chip span (its <wbr>
    // caret restore breaks on one). Capture phase: run before Vditor's handlers.
    const strip = (e: Event) => stripChipsForEdit(e.target)
    document.addEventListener('beforeinput', strip, true)
    document.addEventListener('paste', strip, true)
    document.addEventListener('cut', strip, true)
    // Backspace/Delete/Enter are handled by Vditor in keydown (preventing the
    // later beforeinput), so strip on keydown for those.
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter')
          stripChipsForEdit(e.target)
      },
      true
    )
    // Toolbar actions (bold, headings, lists…) serialize the active block.
    document.addEventListener(
      'mousedown',
      (e) => {
        const t = e.target
        if (!(t instanceof Element)) return
        if (t.closest('.vditor-toolbar') || activeEditable()?.contains(t)) {
          stripChipsForEdit(t)
        }
      },
      true
    )
  }

  refreshVariables()
}
