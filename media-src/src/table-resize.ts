/**
 * Column resize for tables in the Vditor editor.
 *
 * Markdown has no native column-width syntax, so widths are session-only:
 * they survive Vditor's internal re-renders (typing inside cells, structural
 * edits) by being re-applied through a MutationObserver, but they are lost
 * when the document is reloaded.
 */

const HANDLE_CLASS = 'msmd-table-col-resize'
const MIN_COL_WIDTH = 40

const widthsByTable = new WeakMap<HTMLTableElement, number[]>()
const widthsByFingerprint = new Map<string, number[]>()

function fingerprintOf(table: HTMLTableElement): string {
  const firstRow = table.rows[0]
  if (!firstRow) return ''
  const headers = Array.from(firstRow.cells)
    .map((c) => (c.textContent || '').trim().slice(0, 32))
    .join('|')
  return `${firstRow.cells.length}::${headers}`
}

function rememberWidths(table: HTMLTableElement, widths: number[]) {
  widthsByTable.set(table, widths.slice())
  widthsByFingerprint.set(fingerprintOf(table), widths.slice())
}

function recallWidths(table: HTMLTableElement): number[] | undefined {
  return widthsByTable.get(table) || widthsByFingerprint.get(fingerprintOf(table))
}

// Apply session-only column widths by setting an explicit width on each header
// cell. We deliberately do NOT use a `<colgroup>`: Lute drops the ENTIRE table
// when it re-serializes one containing a `<colgroup>` — and Vditor re-serializes
// the edited block through Lute on every keystroke (SpinVditorIRDOM), so a resized
// table would lose all its content and snap the caret to the top of the document
// the moment you typed in it. Inline cell widths survive that round-trip (Lute
// just strips the style); we re-apply them on the next refresh.
function applyColumnWidths(table: HTMLTableElement, widths: number[]) {
  const firstRow = table.rows[0]
  if (!firstRow) return
  Array.from(firstRow.cells).forEach((cell, i) => {
    const w = widths[i]
    ;(cell as HTMLElement).style.width = w && w > 0 ? `${w}px` : ''
  })
}

function measureWidths(table: HTMLTableElement): number[] {
  const firstRow = table.rows[0]
  if (!firstRow) return []
  return Array.from(firstRow.cells).map((c) => (c as HTMLElement).getBoundingClientRect().width)
}

function attachHandles(table: HTMLTableElement) {
  const firstRow = table.rows[0]
  if (!firstRow) return
  const cells = Array.from(firstRow.cells)
  // No handle on the last column — there's nothing to resize against the table edge.
  for (let i = 0; i < cells.length - 1; i++) {
    const cell = cells[i] as HTMLTableCellElement
    if (cell.querySelector(`:scope > .${HANDLE_CLASS}`)) continue
    if (!cell.style.position) cell.style.position = 'relative'
    const handle = document.createElement('div')
    handle.className = HANDLE_CLASS
    handle.contentEditable = 'false'
    handle.setAttribute('data-col-index', String(i))
    // Prevent focus/selection landing on the handle.
    handle.addEventListener('mousedown', (e) => e.preventDefault())
    cell.appendChild(handle)
  }
}

// True while a column drag is in progress. The MutationObserver refresh is
// suppressed for the duration so it can't re-apply widths / re-attach handles
// midway and fight the drag.
let dragging = false

function startDrag(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  if (!target || !target.classList || !target.classList.contains(HANDLE_CLASS)) return
  const cell = target.closest('th, td') as HTMLTableCellElement | null
  if (!cell) return
  const table = cell.closest('table') as HTMLTableElement | null
  if (!table) return
  const colIdx = Number(target.getAttribute('data-col-index') || '0')

  e.preventDefault()
  e.stopPropagation()

  // Snapshot current rendered widths so resizing one column doesn't redistribute the others.
  const widths = measureWidths(table)
  const headerCells = Array.from(table.rows[0]?.cells ?? []) as HTMLElement[]
  // Pin every column to its current width up front (so dragging one doesn't reflow
  // the rest), preserving the caret in case the write disturbs the selection.
  dragging = true
  preserveIrSelection(() => applyColumnWidths(table, widths))

  const startX = e.clientX
  const startWidth = widths[colIdx] || cell.offsetWidth
  const startNextWidth = widths[colIdx + 1] || 0

  const prevBodyCursor = document.body.style.cursor
  const prevBodyUserSelect = document.body.style.userSelect
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  target.classList.add('active')

  const onMove = (ev: MouseEvent) => {
    // The table is stretched to the full editor width (see main.css), so its total
    // is fixed: widening a column has to take the space from its right-hand
    // neighbour. Without that trade the browser would just rescale every column to
    // fit the same total and the drag would barely move the boundary.
    const raw = ev.clientX - startX
    const dx = Math.round(
      Math.min(startNextWidth - MIN_COL_WIDTH, Math.max(MIN_COL_WIDTH - startWidth, raw))
    )
    const col = headerCells[colIdx]
    const next = headerCells[colIdx + 1]
    if (col) col.style.width = `${startWidth + dx}px`
    if (next) next.style.width = `${startNextWidth - dx}px`
    widths[colIdx] = startWidth + dx
    widths[colIdx + 1] = startNextWidth - dx
  }

  const onUp = () => {
    document.removeEventListener('mousemove', onMove, true)
    document.removeEventListener('mouseup', onUp, true)
    document.body.style.cursor = prevBodyCursor
    document.body.style.userSelect = prevBodyUserSelect
    target.classList.remove('active')
    dragging = false
    rememberWidths(table, widths)
  }

  document.addEventListener('mousemove', onMove, true)
  document.addEventListener('mouseup', onUp, true)
}

function preserveIrSelection<T>(fn: () => T): T {
  const editor = (window as any).vditor?.vditor
  const editable = editor?.currentMode === 'ir' ? editor.ir?.element : null
  const sel = window.getSelection()
  const before =
    editable && sel?.rangeCount && editable.contains(sel.anchorNode)
      ? sel.getRangeAt(0).cloneRange()
      : null

  if (before && editor?.ir) editor.ir.range = before.cloneRange()
  const result = fn()
  if (!before || !editable?.isConnected) return result

  const after = window.getSelection()
  const stillInside =
    after && after.rangeCount > 0 && editable.contains(after.anchorNode)
  if (stillInside) {
    if (editor?.ir) editor.ir.range = after.getRangeAt(0).cloneRange()
    return result
  }

  try {
    const current = window.getSelection()
    current?.removeAllRanges()
    current?.addRange(before)
    if (editor?.ir) editor.ir.range = before.cloneRange()
  } catch {
    /* The original selection was replaced by Vditor; keep the saved range. */
  }
  return result
}

// The table the caret is currently inside, if any (only when the IR editable is
// focused). We avoid re-attaching resize handles to this table mid-edit: injecting
// a foreign node into the block being edited can leave the selection outside
// ir.element, so Vditor's getEditorRange() snaps the caret to the top of the
// document (variables-spec.md §4.7). Widths are applied as inline cell styles,
// which Lute tolerates (see applyColumnWidths).
function focusedTable(root: HTMLElement): HTMLTableElement | null {
  if (!document.activeElement || !root.contains(document.activeElement)) return null
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const anchor = sel.anchorNode
  if (!anchor || !root.contains(anchor)) return null
  const el = anchor instanceof HTMLElement ? anchor : anchor.parentElement
  return (el?.closest('table') as HTMLTableElement | null) ?? null
}

function refreshTables(root: HTMLElement) {
  preserveIrSelection(() => {
    // Leave the table being edited untouched; its widths/handles re-apply on the
    // next refresh once the caret moves out of it.
    const editing = focusedTable(root)
    const tables = root.querySelectorAll('table')
    tables.forEach((t) => {
      const table = t as HTMLTableElement
      if (table === editing) return
      const stored = recallWidths(table)
      if (stored && stored.length) {
        applyColumnWidths(table, stored)
        // Re-bind in WeakMap in case this is a freshly rendered table element.
        widthsByTable.set(table, stored.slice())
      }
      attachHandles(table)
    })
  })
}

export function enableTableResize() {
  const root = (window as any).vditor?.vditor?.ir?.element as HTMLElement | undefined
  if (!root) return

  // Capture-phase to win over Vditor's own mousedown handlers.
  root.addEventListener('mousedown', startDrag, true)

  let pending = false
  const schedule = () => {
    if (dragging || pending) return
    pending = true
    requestAnimationFrame(() => {
      pending = false
      refreshTables(root)
    })
  }

  const observer = new MutationObserver((mutations) => {
    // Skip mutations that only add/remove our own resize-handle nodes.
    for (const m of mutations) {
      if (m.type !== 'childList') {
        schedule()
        return
      }
      const nodes = [...m.addedNodes, ...m.removedNodes]
      const isOurs = nodes.every((n) => {
        if (!(n instanceof HTMLElement)) return false
        return n.classList.contains(HANDLE_CLASS)
      })
      if (!isOurs) {
        schedule()
        return
      }
    }
  })
  observer.observe(root, { childList: true, subtree: true })

  // The observer only reacts to structural (childList) changes. Moving the caret
  // OUT of a table isn't structural, so the table just edited — which refreshTables
  // deliberately skips while it holds the caret — wouldn't get its widths/handles
  // back until some later unrelated edit. Re-run on caret-settle events so a
  // resized column reappears as soon as you leave the cell. These listeners live on
  // `root` (recreated on every re-init, so they can't accumulate); schedule() is
  // rAF-coalesced and no-ops during a drag.
  ;(['keyup', 'mouseup', 'focusout'] as const).forEach((ev) =>
    root.addEventListener(ev, schedule)
  )

  refreshTables(root)
}
