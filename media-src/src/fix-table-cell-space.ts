/**
 * Restore the space Lute deletes in front of the first inline node of a table cell.
 *
 * Lute's `renderTableCell` (the Vditor DOM renderers, not `Md2HTML`) runs the
 * cell's *first child* through `TrimSpace` to strip the `| ` padding — but the
 * parser has already stripped that padding, so the only thing the trim actually
 * removes is the trailing space of the cell's leading text run:
 *
 *     | set at **channel level** |   ->   set at<strong>channel level</strong>
 *
 * That is not just a display glitch. MarkPad saves whatever the DOM serializes
 * back to, so the next keystroke writes `set at**channel level**` into the file.
 * Every inline construct is affected (strong, em, code, del, links, images), and
 * only the leading run of each cell — `x **one** y **two** z` loses the space
 * before `one` and keeps the one before `two`.
 *
 * Lute lets a JS function replace a node renderer outright (`SetJSRenderers`), so
 * we install a faithful copy of `renderTableCell` with the trim left out. Two
 * wrinkles:
 *
 *  - `Spin*` — which Vditor runs on every keystroke — builds its renderer without
 *    the JS overrides, so it would undo the fix on the first edit. It is exactly
 *    `Md2*(<mode>DOM2Md(html))` with `<wbr>` swapped for Lute's caret token on
 *    either side, so we re-express it that way to route it through the patched
 *    renderer. (Verified byte-identical to the built-in on a corpus of blocks.)
 *  - Vditor calls `SetJSRenderers` itself while handling a paste, passing a config
 *    that would drop ours, so `SetJSRenderers` is wrapped to merge them back in.
 *
 * The patch is installed by intercepting the assignment of the global `Lute`
 * (Vditor loads lute.min.js through a CDN script tag): the document's first
 * render happens inside the Vditor constructor, before the `after()` callback, so
 * patching the instance from there would leave the loaded document unfixed.
 */

// lute.NodeTableHead — a cell whose grandparent is the head renders as `<th>`.
const NODE_TABLE_HEAD = 107

// Renderer names `SetJSRenderers` accepts that build a Vditor editing DOM. The
// `Spin*` entry points share these renderers but reject the name, hence the
// re-expression below.
const PATCHED_RENDERERS = [
  'Md2VditorIRDOM',
  'Md2VditorDOM',
  'HTML2VditorIRDOM',
  'HTML2VditorDOM',
]

// Reading any field off Lute's nil node pointer throws, so guard every access.
function isNil(node: any): boolean {
  try {
    return node.Type === undefined
  } catch {
    return true
  }
}

function tokensOf(node: any): string {
  try {
    return node.TokensStr()
  } catch {
    return ''
  }
}

// Lute hands JS a node's tokens as its raw UTF-8 bytes, one character per byte,
// so the (non-ASCII) caret marker has to be compared in that same form.
function toTokenBytes(s: string): string {
  return Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join('')
}

function makeRenderTableCell(Lute: any) {
  const caret = toTokenBytes(Lute.Caret)
  return (node: any, entering: boolean): [string, number] => {
    const cell = node.__internal_object__
    let tag = 'td'
    try {
      if (cell.Parent.Parent.Type === NODE_TABLE_HEAD) tag = 'th'
    } catch {
      /* detached node — `td` is the safe default */
    }

    if (!entering) {
      const first = cell.FirstChild
      // Lute pads an empty cell — and one holding nothing but the caret — with a
      // space so the caret has somewhere to land. Keep doing that.
      const needsFiller =
        isNil(first) || (first === cell.LastChild && tokensOf(first) === caret)
      return [`${needsFiller ? ' ' : ''}</${tag}>`, Lute.WalkContinue]
    }

    const align = cell.TableCellAlign
    const attr =
      align === 1
        ? ' align="left"'
        : align === 2
        ? ' align="center"'
        : align === 3
        ? ' align="right"'
        : ''
    return [`<${tag}${attr}>`, Lute.WalkContinue]
  }
}

function patchInstance(lute: any, Lute: any) {
  const renderTableCell = makeRenderTableCell(Lute)
  const setJSRenderers = lute.SetJSRenderers

  // Always merge our renderer in, so Vditor's own paste-time SetJSRenderers call
  // (which passes a freshly built config) can't drop it.
  lute.SetJSRenderers = (config: any) => {
    const merged: any = { ...(config && config.renderers) }
    PATCHED_RENDERERS.forEach((name) => {
      merged[name] = { ...merged[name], renderTableCell }
    })
    return setJSRenderers.call(lute, { ...config, renderers: merged })
  }
  lute.SetJSRenderers({})

  const caret = Lute.Caret
  const respin = (dom2md: string, md2dom: string) => (html: string) =>
    lute[md2dom](lute[dom2md](html.split('<wbr>').join(caret)))
      .split(caret)
      .join('<wbr>')
  lute.SpinVditorIRDOM = respin('VditorIRDOM2Md', 'Md2VditorIRDOM')
  lute.SpinVditorDOM = respin('VditorDOM2Md', 'Md2VditorDOM')
}

function patchLute(Lute: any): any {
  if (!Lute || Lute.__markpadCellSpacePatched) return Lute
  const create = Lute.New
  Lute.New = (...args: any[]) => {
    const lute = create(...args)
    try {
      patchInstance(lute, Lute)
    } catch (e) {
      // A patch failure must never take the editor down with it; worst case the
      // table-cell space bug is back.
      console.error('markpad: table-cell space patch failed', e)
    }
    return lute
  }
  Lute.__markpadCellSpacePatched = true
  return Lute
}

export function fixTableCellSpace() {
  const w = window as any
  if (w.Lute) {
    patchLute(w.Lute)
    return
  }
  // lute.min.js assigns `$global.Lute = ...`; intercept that assignment so the
  // patch is in place before Vditor renders the document.
  let value: any
  Object.defineProperty(w, 'Lute', {
    configurable: true,
    get: () => value,
    set: (v: any) => {
      value = patchLute(v)
    },
  })
}
