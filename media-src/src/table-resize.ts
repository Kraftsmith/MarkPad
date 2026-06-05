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

function ensureColgroup(table: HTMLTableElement, widths: number[]): HTMLTableColElement {
  let colgroup = table.querySelector(':scope > colgroup') as HTMLTableColElement | null
  const ncols = table.rows[0]?.cells.length ?? 0
  if (!colgroup) {
    colgroup = document.createElement('colgroup') as HTMLTableColElement
    table.insertBefore(colgroup, table.firstChild)
  }
  while (colgroup.children.length < ncols) {
    colgroup.appendChild(document.createElement('col'))
  }
  while (colgroup.children.length > ncols) {
    colgroup.lastChild?.remove()
  }
  Array.from(colgroup.children).forEach((col, i) => {
    const el = col as HTMLElement
    const w = widths[i]
    el.style.width = w && w > 0 ? `${w}px` : ''
  })
  return colgroup
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
  const colgroup = ensureColgroup(table, widths)

  const startX = e.clientX
  const startWidth = widths[colIdx] || cell.offsetWidth

  const prevBodyCursor = document.body.style.cursor
  const prevBodyUserSelect = document.body.style.userSelect
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  target.classList.add('active')

  const onMove = (ev: MouseEvent) => {
    const dx = ev.clientX - startX
    const newWidth = Math.max(MIN_COL_WIDTH, Math.round(startWidth + dx))
    const col = colgroup.children[colIdx] as HTMLElement | undefined
    if (col) col.style.width = `${newWidth}px`
    widths[colIdx] = newWidth
  }

  const onUp = () => {
    document.removeEventListener('mousemove', onMove, true)
    document.removeEventListener('mouseup', onUp, true)
    document.body.style.cursor = prevBodyCursor
    document.body.style.userSelect = prevBodyUserSelect
    target.classList.remove('active')
    rememberWidths(table, widths)
  }

  document.addEventListener('mousemove', onMove, true)
  document.addEventListener('mouseup', onUp, true)
}

function refreshTables(root: HTMLElement) {
  const tables = root.querySelectorAll('table')
  tables.forEach((t) => {
    const table = t as HTMLTableElement
    const stored = recallWidths(table)
    if (stored && stored.length) {
      ensureColgroup(table, stored)
      // Re-bind in WeakMap in case this is a freshly rendered table element.
      widthsByTable.set(table, stored.slice())
    }
    attachHandles(table)
  })
}

export function enableTableResize() {
  const root = (window as any).vditor?.vditor?.element as HTMLElement | undefined
  if (!root) return

  // Capture-phase to win over Vditor's own mousedown handlers.
  root.addEventListener('mousedown', startDrag, true)

  let pending = false
  const schedule = () => {
    if (pending) return
    pending = true
    requestAnimationFrame(() => {
      pending = false
      refreshTables(root)
    })
  }

  const observer = new MutationObserver((mutations) => {
    // Skip mutations that only add/remove our own handle/colgroup nodes.
    for (const m of mutations) {
      if (m.type !== 'childList') {
        schedule()
        return
      }
      const nodes = [...m.addedNodes, ...m.removedNodes]
      const isOurs = nodes.every((n) => {
        if (!(n instanceof HTMLElement)) return false
        return n.classList.contains(HANDLE_CLASS) || n.tagName === 'COLGROUP'
      })
      if (!isOurs) {
        schedule()
        return
      }
    }
  })
  observer.observe(root, { childList: true, subtree: true })

  refreshTables(root)
}
