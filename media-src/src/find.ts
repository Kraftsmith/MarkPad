/**
 * In-editor Find (Ctrl/Cmd+F).
 *
 * VS Code's built-in webview find widget is unreliable over Vditor's
 * `contenteditable` editing surface (it targets read-only webview content), so
 * MarkPad provides its own with the standard capabilities: an "N of M" match
 * count and next/previous navigation.
 *
 * Matches are located over the editor's text nodes and rendered with the CSS
 * Custom Highlight API — which paints ranges without inserting any nodes. So
 * find mutates nothing in the DOM: it never triggers the input/persist
 * round-trip or the table-drop guard, and can't corrupt content. (A Selection
 * fallback is used where the Highlight API is unavailable.)
 */

const BOX_ID = 'markpad-find'
const HL_ALL = 'markpad-find-all'
const HL_CURRENT = 'markpad-find-current'

let wired = false

export function enableFind() {
  if (wired) return
  wired = true

  let box: HTMLDivElement | null = null
  let input: HTMLInputElement | null = null
  let status: HTMLElement | null = null

  let query = ''
  let matches: Range[] = []
  let current = -1

  const highlightApi: any =
    (window as any).CSS && (window as any).CSS.highlights && (window as any).Highlight
      ? (window as any).CSS.highlights
      : null

  function irElement(): HTMLElement | undefined {
    return (window as any).vditor?.vditor?.ir?.element as HTMLElement | undefined
  }

  /* -------------------------------------------------------------- match model */

  // Collect every match of `query` as a Range over the editor's text nodes.
  function computeMatches(): Range[] {
    const root = irElement()
    if (!root || !query) return []

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const chunks: { node: Text; start: number; len: number }[] = []
    let full = ''
    let node: Node | null
    while ((node = walker.nextNode())) {
      const text = node.nodeValue || ''
      if (!text) continue
      chunks.push({ node: node as Text, start: full.length, len: text.length })
      full += text
    }
    if (!chunks.length) return []

    const hay = full.toLowerCase()
    const needle = query.toLowerCase()
    if (!needle) return []

    // Map a global string offset back to the text node + local offset it lands in.
    const locate = (offset: number): { node: Text; offset: number } => {
      let lo = 0
      let hi = chunks.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (chunks[mid].start + chunks[mid].len <= offset) lo = mid + 1
        else hi = mid
      }
      const c = chunks[lo]
      return { node: c.node, offset: Math.min(Math.max(offset - c.start, 0), c.len) }
    }

    const ranges: Range[] = []
    let from = 0
    let idx: number
    while ((idx = hay.indexOf(needle, from)) !== -1) {
      const s = locate(idx)
      const e = locate(idx + needle.length)
      const r = document.createRange()
      try {
        r.setStart(s.node, s.offset)
        r.setEnd(e.node, e.offset)
        ranges.push(r)
      } catch {
        /* transient DOM shift; skip this occurrence */
      }
      from = idx + needle.length
    }
    return ranges
  }

  function paintHighlights() {
    if (!highlightApi) return
    highlightApi.delete(HL_ALL)
    highlightApi.delete(HL_CURRENT)
    if (!matches.length) return
    highlightApi.set(HL_ALL, new (window as any).Highlight(...matches))
    if (current >= 0 && matches[current]) {
      highlightApi.set(HL_CURRENT, new (window as any).Highlight(matches[current].cloneRange()))
    }
  }

  function scrollToCurrent() {
    if (current < 0 || !matches[current]) return
    const r = matches[current]
    const el =
      r.startContainer.nodeType === Node.ELEMENT_NODE
        ? (r.startContainer as HTMLElement)
        : r.startContainer.parentElement
    el?.scrollIntoView({ block: 'center', inline: 'nearest' })
    // Where the Highlight API is unavailable, fall back to selecting the match
    // so it's at least visible and scrolled to.
    if (!highlightApi) {
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(r.cloneRange())
    }
  }

  function renderStatus() {
    if (!status) return
    if (!query) {
      status.textContent = ''
      status.classList.remove(`${BOX_ID}__status--none`)
      return
    }
    if (!matches.length) {
      status.textContent = 'No results'
      status.classList.add(`${BOX_ID}__status--none`)
      return
    }
    status.textContent = `${current + 1} of ${matches.length}`
    status.classList.remove(`${BOX_ID}__status--none`)
  }

  // Recompute matches for the current query and jump to the first match at or
  // after the caret (so a fresh search starts near where the user is looking).
  function refresh(resetToCaret: boolean) {
    matches = computeMatches()
    if (!matches.length) {
      current = -1
    } else if (resetToCaret) {
      current = firstMatchFromCaret()
    } else if (current < 0 || current >= matches.length) {
      current = 0
    }
    paintHighlights()
    renderStatus()
    scrollToCurrent()
  }

  function firstMatchFromCaret(): number {
    const sel = window.getSelection()
    const root = irElement()
    if (!sel || !sel.rangeCount || !root) return 0
    const caret = sel.getRangeAt(0)
    if (!root.contains(caret.startContainer)) return 0
    for (let i = 0; i < matches.length; i++) {
      // Match starts at or after the caret position.
      if (matches[i].compareBoundaryPoints(Range.START_TO_START, caret) >= 0) return i
    }
    return 0
  }

  function step(delta: number) {
    if (!matches.length) return
    current = (current + delta + matches.length) % matches.length
    paintHighlights()
    renderStatus()
    scrollToCurrent()
  }

  /* -------------------------------------------------------------------- widget */

  function ensureBox() {
    if (box) return
    box = document.createElement('div')
    box.id = BOX_ID
    box.className = BOX_ID
    box.innerHTML = `
      <input type="text" class="${BOX_ID}__input" placeholder="Find" aria-label="Find" />
      <span class="${BOX_ID}__status" aria-live="polite"></span>
      <button type="button" class="${BOX_ID}__btn" data-act="prev" title="Previous match (Shift+Enter)" aria-label="Previous match">&#9650;</button>
      <button type="button" class="${BOX_ID}__btn" data-act="next" title="Next match (Enter)" aria-label="Next match">&#9660;</button>
      <button type="button" class="${BOX_ID}__btn" data-act="close" title="Close (Esc)" aria-label="Close">&#10005;</button>
    `
    document.body.appendChild(box)
    input = box.querySelector(`.${BOX_ID}__input`)
    status = box.querySelector(`.${BOX_ID}__status`)

    input!.addEventListener('input', () => {
      query = input!.value
      refresh(true)
    })
    input!.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        step(e.shiftKey ? -1 : 1)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    })
    box.querySelectorAll(`.${BOX_ID}__btn`).forEach((b) => {
      // mousedown (not click) + preventDefault so the button never steals the
      // document selection / editor focus.
      b.addEventListener('mousedown', (e) => {
        e.preventDefault()
        const act = (b as HTMLElement).dataset.act
        if (act === 'close') close()
        else step(act === 'prev' ? -1 : 1)
      })
    })
  }

  function open() {
    ensureBox()
    box!.classList.add(`${BOX_ID}--visible`)
    const selected = window.getSelection()?.toString() || ''
    if (selected && selected.length <= 200 && !selected.includes('\n')) {
      input!.value = selected
    }
    query = input!.value
    input!.focus()
    input!.select()
    refresh(true)
  }

  function close() {
    if (!box) return
    box.classList.remove(`${BOX_ID}--visible`)
    matches = []
    current = -1
    if (highlightApi) {
      highlightApi.delete(HL_ALL)
      highlightApi.delete(HL_CURRENT)
    }
    if (status) status.textContent = ''
    irElement()?.focus()
  }

  // Capture phase so we win over anything else listening for Ctrl/Cmd+F.
  document.addEventListener(
    'keydown',
    (e) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        (e.key === 'f' || e.key === 'F')
      ) {
        e.preventDefault()
        e.stopPropagation()
        open()
      }
    },
    true
  )
}
