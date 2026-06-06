/**
 * "Tab appends a row" affordance for tables in the Vditor editor.
 *
 * Standard table keyboard behaviour: pressing Tab in the last cell of the last
 * row adds a new empty row and drops the caret into its first cell
 * (Word / Excel / Google-Docs style). Vditor's own Tab handler walks from cell
 * to cell but does nothing once there is no next cell (see fixBrowserBehavior
 * `fixTable`), so we take over that one case here.
 *
 * The listener runs on the *capture* phase of the IR element's keydown, ahead
 * of Vditor's own bubble-phase handler, and calls `stopImmediatePropagation()`
 * so Vditor doesn't also act on the same Tab. Row insertion mirrors Vditor's
 * `insertRow`: it mutates the table DOM and runs `execAfterRender`, which
 * re-serializes to markdown and fires the `input` callback, so the new row is
 * saved like any other edit and lands on the undo stack. The caret is placed
 * via a `<wbr>` marker + `setRangeByWbr` — the same idiom Vditor uses to keep
 * the cursor across renders (and which removes the marker before save).
 */
import { execAfterRender } from 'vditor/src/ts/util/fixBrowserBehavior'
import { setRangeByWbr } from 'vditor/src/ts/util/selection'

function closestCell(node: Node | null): HTMLTableCellElement | null {
  const el = node instanceof HTMLElement ? node : node?.parentElement ?? null
  return (el?.closest('td, th') as HTMLTableCellElement | null) ?? null
}

export function enableTableTabNewRow() {
  const ivditor = (window as any).vditor?.vditor
  const contentEl = ivditor?.ir?.element as HTMLElement | undefined
  if (!contentEl) return

  contentEl.addEventListener(
    'keydown',
    (event: KeyboardEvent) => {
      // Plain Tab only — Shift/Ctrl/Alt/Cmd+Tab keep Vditor's behaviour.
      if (
        event.key !== 'Tab' ||
        event.shiftKey ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey
      ) {
        return
      }
      if (ivditor.currentMode !== 'ir') return

      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) return
      const range = selection.getRangeAt(0)

      const cell = closestCell(range.startContainer)
      if (!cell) return
      const table = cell.closest('table') as HTMLTableElement | null
      if (!table || table.rows.length === 0) return

      // Act only on the very last cell of the table (last cell of last row) —
      // every other cell still has a "next cell" for Vditor to navigate to.
      const lastRow = table.rows[table.rows.length - 1]
      const lastCell = lastRow.cells[lastRow.cells.length - 1]
      if (cell !== lastCell) return

      // This is the no-op case in Vditor's Tab handler — append a row instead.
      event.preventDefault()
      event.stopImmediatePropagation()

      const rowHTML = Array.from(lastRow.cells)
        .map((c, i) => {
          const align = c.getAttribute('align')
          const alignAttr = align ? ` align="${align}"` : ''
          // Caret marker goes into the first cell of the new row.
          return `<td${alignAttr}>${i === 0 ? '<wbr> ' : ' '}</td>`
        })
        .join('')

      let newRow: Element | null
      if (lastCell.tagName === 'TH') {
        // Header-only table: the new row needs its own <tbody>.
        const thead = lastRow.parentElement as HTMLElement
        thead.insertAdjacentHTML('afterend', `<tbody><tr>${rowHTML}</tr></tbody>`)
        newRow = thead.nextElementSibling?.firstElementChild ?? null
      } else {
        lastRow.insertAdjacentHTML('afterend', `<tr>${rowHTML}</tr>`)
        newRow = lastRow.nextElementSibling
      }

      // Place the caret (removes the <wbr>), then persist + push to undo stack.
      setRangeByWbr(contentEl, range)
      execAfterRender(ivditor)
      newRow?.scrollIntoView({ block: 'nearest' })
    },
    true
  )
}
