/**
 * Repair markdown tables whose cell content contains a literal newline.
 *
 * GFM requires every table row to sit on a single physical line; a hard newline
 * inside a cell splits the row, and Lute (correctly, per spec) then parses the
 * fragments as separate rows — the cell content "escapes" into a new row and the
 * table looks broken. A newline inside a cell can only be expressed in GFM as
 * `<br>`, so on load we stitch the split lines back into one row, turning the
 * stray newline into `<br>`. The document then round-trips as valid GFM (MarkPad
 * saves the repaired form on the next edit) and renders correctly, while
 * well-formed tables are left byte-for-byte unchanged.
 *
 * Conservative by design:
 *  - Only *bordered* tables (header + delimiter both wrapped in leading/trailing
 *    `|`) are considered; non-bordered tables are skipped entirely.
 *  - A row that already closes with a trailing `|` is emitted untouched — so a
 *    valid table is never altered.
 *  - Only a row that fails to close is stitched, and only until a following line
 *    closes it with a trailing `|`. If no closing line is found before the table
 *    ends, the original lines are left as-is (safe fallback — never guess).
 *  - Fenced code blocks are tracked and never treated as tables.
 */

const DELIM_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/

const startsWithPipe = (l: string): boolean => /^\s*\|/.test(l)

// True when the line's last non-space char is a `|` that isn't backslash-escaped.
function endsWithPipe(l: string): boolean {
  const t = l.replace(/\s+$/, '')
  if (!t.endsWith('|')) return false
  let i = t.length - 2
  let bs = 0
  while (i >= 0 && t[i] === '\\') {
    bs++
    i--
  }
  return bs % 2 === 0
}

const isBordered = (l: string): boolean => {
  const t = l.trim()
  return t.startsWith('|') && t.endsWith('|')
}

export function repairTableCellNewlines(md: string): string {
  if (md.indexOf('|') === -1) return md
  const lines = md.split('\n')
  const out: string[] = []
  let i = 0
  let fence: string | null = null

  const fenceToggle = (line: string): void => {
    const m = FENCE_RE.exec(line)
    if (!m) return
    const marker = m[1][0]
    if (fence === null) fence = marker
    else if (marker === fence) fence = null
  }

  while (i < lines.length) {
    const line = lines[i]
    if (fence !== null) {
      out.push(line)
      fenceToggle(line)
      i++
      continue
    }
    if (FENCE_RE.test(line)) {
      out.push(line)
      fenceToggle(line)
      i++
      continue
    }

    // A bordered table starts at a bordered header line immediately followed by a
    // bordered delimiter row.
    const next = lines[i + 1]
    if (
      startsWithPipe(line) &&
      isBordered(line) &&
      next !== undefined &&
      DELIM_RE.test(next) &&
      isBordered(next)
    ) {
      out.push(line)
      out.push(next)
      i += 2
      while (i < lines.length) {
        const row = lines[i]
        if (row.trim() === '') break // blank line ends the table
        if (FENCE_RE.test(row)) break // safety: a fence ends it too
        if (!startsWithPipe(row)) break // not a row start → table ended
        if (endsWithPipe(row)) {
          out.push(row) // complete row — leave untouched
          i++
          continue
        }
        // Incomplete row: a cell spilled onto the following line(s). Stitch with
        // `<br>` until a line closes the row with a trailing `|`.
        let j = i + 1
        let buf = row
        let closed = false
        while (j < lines.length) {
          const cont = lines[j]
          if (cont.trim() === '') break
          if (startsWithPipe(cont) && DELIM_RE.test(cont)) break // another delimiter — bail
          buf += '<br>' + cont.replace(/^\s+/, '')
          if (endsWithPipe(cont)) {
            closed = true
            j++
            break
          }
          j++
        }
        if (closed) {
          out.push(buf)
          i = j
        } else {
          // Couldn't safely close the row — leave the original line untouched and
          // let the loop's row-start checks end the table naturally.
          out.push(row)
          i++
        }
      }
      continue
    }

    out.push(line)
    i++
  }
  return out.join('\n')
}
