/**
 * Render fenced ```bpmn code blocks (BPMN 2.0 XML) as read-only diagrams via
 * bpmn-visualization.
 *
 * Same post-render enhancement approach as table-resize.ts: grab the editor
 * root, watch it with a (debounced) MutationObserver, and re-render only the
 * blocks whose XML actually changed. Rendered SVG is cached by XML hash so the
 * (expensive) bpmn-visualization render runs once per distinct diagram, even
 * though Vditor rewrites the surrounding DOM on every keystroke.
 *
 * The diagram is injected as a non-editable sibling right after the code-block
 * node, so the editable markdown source is never touched.
 */
import { BpmnVisualization, FitType } from 'bpmn-visualization'

const CONTAINER_CLASS = 'markpad-bpmn'
const ERROR_CLASS = 'markpad-bpmn--error'
const HASH_ATTR = 'data-bpmn-hash'

// Cheap, stable string hash (djb2) — only used to detect XML changes.
function hashXml(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return String(h >>> 0)
}

// Static SVG markup keyed by XML hash, so reinserting an unchanged diagram
// after Vditor reflows the DOM is just an innerHTML assignment, not a re-render.
const svgCache = new Map<string, string>()
const MAX_CACHE = 30

// bpmn-visualization does NOT read "BPMN in Color" attributes from the XML, so
// we parse them ourselves and apply them through its styling API. Supports the
// OMG standard (color:background-color / color:border-color) and the bpmn.io
// fallback (bioc:fill / bioc:stroke).
function attrByLocalName(el: Element, local: string): string | null {
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i]
    if (a.localName === local) return a.value
  }
  return null
}

function applyBpmnColors(viz: BpmnVisualization, xml: string) {
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml')
  } catch {
    return
  }
  if (doc.getElementsByTagName('parsererror').length) return

  const all = doc.getElementsByTagName('*')
  for (let i = 0; i < all.length; i++) {
    const el = all[i]
    const isEdge = el.localName === 'BPMNEdge'
    if (el.localName !== 'BPMNShape' && !isEdge) continue
    const id = el.getAttribute('bpmnElement')
    if (!id) continue

    const fill =
      attrByLocalName(el, 'background-color') || attrByLocalName(el, 'fill')
    const stroke =
      attrByLocalName(el, 'border-color') || attrByLocalName(el, 'stroke')

    const style: any = {}
    if (stroke) style.stroke = { color: stroke }
    if (fill && !isEdge) style.fill = { color: fill }
    if (style.fill || style.stroke) {
      try {
        viz.bpmnElementsRegistry.updateStyle(id, style)
      } catch {
        /* unknown id / unsupported element — ignore */
      }
    }
  }
}

// Drop consecutive duplicate <di:waypoint>s. Zero-length edge segments can
// break the rendering engine, and generated / auto-laid-out BPMN often has them.
function sanitizeBpmnXml(xml: string): string {
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml')
  } catch {
    return xml
  }
  if (doc.getElementsByTagName('parsererror').length) return xml

  let changed = false
  const all = doc.getElementsByTagName('*')
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName !== 'BPMNEdge') continue
    let prevX: string | null = null
    let prevY: string | null = null
    for (const wp of Array.from(all[i].children)) {
      if (wp.localName !== 'waypoint') continue
      const x = wp.getAttribute('x')
      const y = wp.getAttribute('y')
      if (x === prevX && y === prevY) {
        wp.remove()
        changed = true
      } else {
        prevX = x
        prevY = y
      }
    }
  }
  if (!changed) return xml
  try {
    return new XMLSerializer().serializeToString(doc)
  } catch {
    return xml
  }
}

function renderInto(container: HTMLElement, xml: string, hash: string) {
  container.classList.remove(ERROR_CLASS)
  if (!xml) {
    container.textContent = ''
    return
  }
  const cached = svgCache.get(hash)
  if (cached !== undefined) {
    container.innerHTML = cached
    return
  }
  container.textContent = ''
  try {
    const viz = new BpmnVisualization({
      container,
      navigation: { enabled: false },
    })
    viz.load(sanitizeBpmnXml(xml), { fit: { type: FitType.Center, margin: 20 } })
    applyBpmnColors(viz, xml)
    if (svgCache.size >= MAX_CACHE) {
      svgCache.delete(svgCache.keys().next().value as string)
    }
    svgCache.set(hash, container.innerHTML)
  } catch (e) {
    // Surface the real cause — generated BPMN often has subtle issues.
    console.error('[MarkPad] BPMN render failed:', e)
    container.classList.add(ERROR_CLASS)
    container.textContent =
      'BPMN render error: ' + (e instanceof Error ? e.message : String(e))
  }
}

function preserveIrSelection(fn: () => void) {
  const editor = (window as any).vditor?.vditor
  const editable = editor?.currentMode === 'ir' ? editor.ir?.element : null
  const sel = window.getSelection()
  const before =
    editable && sel?.rangeCount && editable.contains(sel.anchorNode)
      ? sel.getRangeAt(0).cloneRange()
      : null

  if (before && editor?.ir) editor.ir.range = before.cloneRange()
  fn()
  if (!before || !editable?.isConnected) return

  const after = window.getSelection()
  const stillInside =
    after && after.rangeCount > 0 && editable.contains(after.anchorNode)
  if (stillInside) {
    if (editor?.ir) editor.ir.range = after.getRangeAt(0).cloneRange()
    return
  }

  try {
    const current = window.getSelection()
    current?.removeAllRanges()
    current?.addRange(before)
    if (editor?.ir) editor.ir.range = before.cloneRange()
  } catch {
    /* The original selection node was replaced by Vditor; leave Vditor's saved range as-is. */
  }
}

function refresh(root: HTMLElement) {
  preserveIrSelection(() => {
    const live = new Set<HTMLElement>()

    // Vditor renders each code block's output into `pre.vditor-ir__preview`
    // (shown when the block isn't focused). For a `bpmn` block we render the
    // diagram into that preview; the raw XML there is hidden via CSS, and Vditor
    // reveals the editable source only while the block is being edited.
    root
      .querySelectorAll<HTMLElement>('pre.vditor-ir__preview')
      .forEach((preview) => {
        const code = preview.querySelector<HTMLElement>(
          'code[class~="language-bpmn"]'
        )
        if (!code) return
        const xml = (code.textContent || '').trim()

        let container = preview.querySelector<HTMLElement>(
          ':scope > .' + CONTAINER_CLASS
        )
        if (!container) {
          container = document.createElement('div')
          container.className = CONTAINER_CLASS
          container.contentEditable = 'false'
          preview.appendChild(container)
        }
        live.add(container)

        const hash = hashXml(xml)
        if (container.getAttribute(HASH_ATTR) !== hash) {
          container.setAttribute(HASH_ATTR, hash)
          renderInto(container, xml, hash)
        }
      })

    // Drop diagrams whose source block was removed.
    root
      .querySelectorAll<HTMLElement>('.' + CONTAINER_CLASS)
      .forEach((c) => {
        if (!live.has(c)) c.remove()
      })
  })
}

export function enableBpmnRender() {
  const root = (window as any).vditor?.vditor?.ir?.element as HTMLElement | undefined
  if (!root) return

  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => refresh(root), 250)
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      const node = m.target
      const el =
        node instanceof HTMLElement ? node : node?.parentElement ?? null
      // Ignore the mutations we cause inside our own diagram containers.
      if (el && el.closest('.' + CONTAINER_CLASS)) continue
      schedule()
      return
    }
  })
  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
  })

  refresh(root)
}
