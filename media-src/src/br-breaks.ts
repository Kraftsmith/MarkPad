/**
 * Render `<br>` inside the IR editor as an actual line break.
 *
 * In IR mode Lute renders inline HTML like `<br>` as a hidden "marker" node:
 *   <span data-type="html-inline"><code class="vditor-ir__marker">&lt;br&gt;</code></span>
 * Vditor hides that marker for non-focused nodes, so a `<br>` produces no visible
 * break — which collapses multi-line table cells (where literal newlines aren't
 * allowed and `<br>` is the only way to break a line) onto a single run of text.
 *
 * We can't insert a real <br> element into the editable without corrupting Lute's
 * serialization and Vditor's caret handling. Instead we only TAG the marker node
 * with a class and let CSS draw the break via a `::after` newline (see main.css).
 * Tagging changes a class only — no node insertion, no text change — so markdown
 * round-trips unchanged and the caret is never disturbed (unlike the DOM-mutating
 * enhancers; see variables-spec.md §4.7).
 */

const BR_CLASS = 'markpad-br'
// The whole marker text must be exactly a break tag: <br>, <br/>, <br />.
const BR_RE = /^<br\s*\/?>$/i

function irElement(): HTMLElement | null {
  const iv = (window as any).vditor?.vditor
  if (!iv || iv.currentMode !== 'ir') return null
  return iv.ir?.element ?? null
}

export function refreshBrBreaks() {
  const editable = irElement()
  if (!editable) return
  editable
    .querySelectorAll<HTMLElement>('span[data-type="html-inline"]')
    .forEach((node) => {
      node.classList.toggle(BR_CLASS, BR_RE.test((node.textContent || '').trim()))
    })
}

export function enableBrBreaks() {
  if (!irElement()) return
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(refreshBrBreaks, 150)
  }
  // Re-tag at the same stable settle moments the variables layer uses; Vditor
  // rewrites the IR DOM on edits and drops our class, so it must be re-applied.
  document.addEventListener('input', schedule)
  document.addEventListener('keyup', schedule)
  document.addEventListener('focusout', schedule)
  refreshBrBreaks()
}
