/**
 * In-document word autocompletion for the Vditor IR editor.
 *
 * As you type a word, suggest words already present in the document that start
 * with the same prefix. Navigate with Up/Down, accept with Tab/Enter (or click),
 * dismiss with Esc. Insertion goes through `execCommand('insertText')` after
 * selecting the prefix, so Vditor receives a normal input event and re-renders /
 * saves the change like any other edit — we never poke its DOM model directly.
 *
 * IR mode only (MarkPad's default). The prefix/words are derived fresh from the
 * live caret at accept time, so it tolerates Vditor re-rendering as you type.
 */

const POPUP_CLASS = 'markpad-ac'
const ITEM_CLASS = 'markpad-ac__item'
const ACTIVE_CLASS = 'markpad-ac__item--active'
const MIN_PREFIX = 2
const MAX_ITEMS = 8
// Word = letters/digits/underscore plus the Latin-1/Latin-Extended ranges.
const WORD_END = /[A-Za-z0-9_À-ɏ]+$/
const WORD_START = /^[A-Za-z0-9_À-ɏ]/
const TOKEN = /[A-Za-z0-9_À-ɏ]{2,}/g
const NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'])

let popup: HTMLElement | null = null
let items: string[] = []
let activeIndex = 0

function closePopup() {
  if (popup) {
    popup.remove()
    popup = null
  }
  items = []
  activeIndex = 0
}

// The word prefix immediately before a collapsed caret (or null if none / mid-word).
function caretPrefix(): { node: Text; start: number; end: number; prefix: string } | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null
  const range = sel.getRangeAt(0)
  if (range.startContainer.nodeType !== Node.TEXT_NODE) return null
  const node = range.startContainer as Text
  const offset = range.startOffset
  const text = node.textContent || ''
  if (WORD_START.test(text.slice(offset))) return null // mid-word
  const m = text.slice(0, offset).match(WORD_END)
  if (!m || m[0].length < MIN_PREFIX) return null
  return { node, start: offset - m[0].length, end: offset, prefix: m[0] }
}

function collectWords(root: HTMLElement, prefix: string): string[] {
  const lower = prefix.toLowerCase()
  const firstSeen = new Map<string, string>()
  const counts = new Map<string, number>()
  for (const w of (root.textContent || '').match(TOKEN) || []) {
    const wl = w.toLowerCase()
    if (w.length <= prefix.length || !wl.startsWith(lower) || wl === lower) continue
    if (!firstSeen.has(wl)) firstSeen.set(wl, w)
    counts.set(wl, (counts.get(wl) || 0) + 1)
  }
  return [...firstSeen.entries()]
    .sort(
      (a, b) =>
        counts.get(b[0])! - counts.get(a[0])! ||
        a[1].length - b[1].length ||
        a[1].localeCompare(b[1])
    )
    .map(([, w]) => w)
    .slice(0, MAX_ITEMS)
}

function renderPopup() {
  if (!popup) return
  popup.innerHTML = ''
  items.forEach((w, i) => {
    const el = document.createElement('div')
    el.className = ITEM_CLASS + (i === activeIndex ? ' ' + ACTIVE_CLASS : '')
    el.textContent = w
    el.addEventListener('mousedown', (e) => {
      e.preventDefault() // keep editor focus
      accept(i)
    })
    popup!.appendChild(el)
    if (i === activeIndex) el.scrollIntoView({ block: 'nearest' })
  })
}

function positionPopup() {
  const sel = window.getSelection()
  if (!popup || !sel || sel.rangeCount === 0) return
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  popup.style.top = `${(rect.bottom || rect.top) + 2}px`
  popup.style.left = `${rect.left}px`
}

function showPopup(root: HTMLElement) {
  const ctx = caretPrefix()
  if (!ctx) return closePopup()
  const matches = collectWords(root, ctx.prefix)
  if (matches.length === 0) return closePopup()
  items = matches
  activeIndex = 0
  if (!popup) {
    popup = document.createElement('div')
    popup.className = POPUP_CLASS
    popup.contentEditable = 'false'
    document.body.appendChild(popup)
  }
  renderPopup()
  positionPopup()
}

function accept(index: number) {
  const word = items[index]
  const ctx = caretPrefix() // re-derive from the live caret
  const sel = window.getSelection()
  if (!word || !ctx || !sel) return closePopup()
  const range = document.createRange()
  try {
    range.setStart(ctx.node, ctx.start)
    range.setEnd(ctx.node, ctx.end)
  } catch {
    return closePopup()
  }
  sel.removeAllRanges()
  sel.addRange(range)
  document.execCommand('insertText', false, word)
  closePopup()
}

export function enableWordAutocomplete() {
  const iv: any = (window as any).vditor?.vditor
  const root = iv?.ir?.element as HTMLElement | undefined
  if (!root || root.dataset.markpadAc === '1') return
  root.dataset.markpadAc = '1'

  // Capture phase so we win over Vditor's own Tab/Enter handling while the popup
  // is open; when it's closed we no-op and let Vditor (and table-tab-row) run.
  root.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (!popup || !NAV_KEYS.has(e.key)) return
      if (e.key === 'ArrowDown') {
        activeIndex = (activeIndex + 1) % items.length
        renderPopup()
      } else if (e.key === 'ArrowUp') {
        activeIndex = (activeIndex - 1 + items.length) % items.length
        renderPopup()
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        accept(activeIndex)
      } else {
        closePopup() // Escape
      }
      e.preventDefault()
      e.stopImmediatePropagation()
    },
    true
  )

  root.addEventListener('keyup', (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || NAV_KEYS.has(e.key)) return
    if (['Shift', 'Control', 'Alt', 'Meta', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    showPopup(root)
  })

  root.addEventListener('blur', () => setTimeout(closePopup, 150))
  document.addEventListener('scroll', closePopup, true)
}
