/**
 * "Add column" affordance for tables in the Vditor editor.
 *
 * A floating "+" button hugs the right edge of whichever table the pointer is
 * over (Notion/Google-Docs style). Clicking it appends a column on the right.
 *
 * Insertion goes through Vditor's own `insertColumn` — the very function its
 * IR-mode `⇧⌘=` hotkey calls (see vditor processKeydown.ts). It mutates the
 * table DOM and runs `execAfterRender`, which re-serializes to markdown and
 * fires the `input` callback, so the new column is saved like any other edit
 * and lands on the undo stack. The button lives in the outer `.vditor` frame
 * (never inside the contenteditable), so it is never serialized into markdown.
 */
import { insertColumn } from 'vditor/src/ts/util/fixBrowserBehavior'

const BTN_CLASS = 'msmd-table-add-col'
const HIDE_DELAY = 250

export function enableTableAddColumn() {
  const ivditor = (window as any).vditor?.vditor
  const root = ivditor?.element as HTMLElement | undefined
  if (!root) return

  if (getComputedStyle(root).position === 'static') {
    root.style.position = 'relative'
  }

  let btn = root.querySelector<HTMLButtonElement>(`:scope > .${BTN_CLASS}`)
  if (!btn) {
    btn = document.createElement('button')
    btn.type = 'button'
    btn.className = BTN_CLASS
    btn.title = 'Add column'
    btn.setAttribute('aria-label', 'Add column')
    btn.contentEditable = 'false'
    btn.textContent = '+'
    // Don't let pressing the button steal focus/selection from the editor.
    btn.addEventListener('mousedown', (e) => e.preventDefault())
    root.appendChild(btn)
  }
  const addBtn = btn

  let currentTable: HTMLTableElement | null = null
  let hideTimer: number | undefined

  function reposition() {
    if (!currentTable || !root!.contains(currentTable)) {
      hide()
      return
    }
    const tableRect = currentTable.getBoundingClientRect()
    const rootRect = root!.getBoundingClientRect()
    addBtn.style.top = `${tableRect.top - rootRect.top}px`
    addBtn.style.left = `${tableRect.right - rootRect.left}px`
    addBtn.style.height = `${tableRect.height}px`
  }

  function show(table: HTMLTableElement) {
    window.clearTimeout(hideTimer)
    currentTable = table
    addBtn.classList.add(`${BTN_CLASS}--visible`)
    reposition()
  }

  function hide() {
    addBtn.classList.remove(`${BTN_CLASS}--visible`)
    currentTable = null
  }

  function scheduleHide() {
    window.clearTimeout(hideTimer)
    hideTimer = window.setTimeout(hide, HIDE_DELAY)
  }

  root.addEventListener('mouseover', (e) => {
    const table = (e.target as HTMLElement)?.closest?.('table') as HTMLTableElement | null
    if (table) show(table)
  })

  root.addEventListener('mouseout', (e) => {
    const to = e.relatedTarget as HTMLElement | null
    // Stay visible while the pointer is still inside the same table or on the button.
    if (to && (to === addBtn || addBtn.contains(to) || to.closest?.('table') === currentTable)) {
      return
    }
    scheduleHide()
  })

  addBtn.addEventListener('mouseenter', () => window.clearTimeout(hideTimer))
  addBtn.addEventListener('mouseleave', scheduleHide)

  // Keep the button glued to the table edge as the editor scrolls/resizes.
  const contentEl = ivditor.ir?.element as HTMLElement | undefined
  contentEl?.addEventListener(
    'scroll',
    () => {
      if (currentTable) reposition()
    },
    { passive: true }
  )
  window.addEventListener('resize', () => {
    if (currentTable) reposition()
  })

  addBtn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!currentTable || currentTable.rows.length === 0) return
    const headerRow = currentTable.rows[0]
    const lastCell = headerRow.cells[headerRow.cells.length - 1] as HTMLElement
    if (!lastCell) return
    insertColumn(ivditor, currentTable, lastCell, 'afterend')
    // The table just grew wider — re-glue the button to its new right edge.
    requestAnimationFrame(reposition)
  })
}
