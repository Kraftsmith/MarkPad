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

function bpmnCodeElements(root: HTMLElement): HTMLElement[] {
  // Vditor adds `language-<lang>` to the <code> element in IR / WYSIWYG / SV.
  return Array.from(
    root.querySelectorAll<HTMLElement>('code[class~="language-bpmn"]')
  )
}

// The editable source lives inside this wrapper — we attach the diagram *after*
// the whole block, never inside it.
function anchorFor(code: HTMLElement): HTMLElement {
  return (
    (code.closest(
      '.vditor-ir__node, .vditor-wysiwyg__block, .vditor-sv'
    ) as HTMLElement) ||
    (code.closest('pre') as HTMLElement) ||
    code
  )
}

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
    viz.load(xml, { fit: { type: FitType.Center, margin: 20 } })
    applyBpmnColors(viz, xml)
    if (svgCache.size >= MAX_CACHE) {
      svgCache.delete(svgCache.keys().next().value as string)
    }
    svgCache.set(hash, container.innerHTML)
  } catch (e) {
    container.classList.add(ERROR_CLASS)
    container.textContent =
      'BPMN render error: ' + (e instanceof Error ? e.message : String(e))
  }
}

function refresh(root: HTMLElement) {
  const live = new Set<HTMLElement>()

  bpmnCodeElements(root).forEach((code) => {
    const xml = (code.textContent || '').trim()
    const anchor = anchorFor(code)

    let container = anchor.nextElementSibling as HTMLElement | null
    if (!container || !container.classList.contains(CONTAINER_CLASS)) {
      container = document.createElement('div')
      container.className = CONTAINER_CLASS
      container.contentEditable = 'false'
      anchor.parentNode?.insertBefore(container, anchor.nextSibling)
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
}

export function enableBpmnRender() {
  const root = (window as any).vditor?.vditor?.element as HTMLElement | undefined
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
