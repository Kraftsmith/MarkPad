/**
 * Custom right-click context menu for the Vditor editor.
 *
 * A VS Code webview won't let us extend the native context menu, so we replace
 * it. The headline action is "Switch to source / preview" (toggles IR <-> SV,
 * same as the toolbar's `< >` button); the rest are the usual edit actions.
 * Cut/Copy/Select all use execCommand; Paste tries the async clipboard API
 * (best effort — Ctrl+V always works through Vditor's own handler).
 */
import { setEditMode } from 'vditor/src/ts/toolbar/EditMode'

const MENU_CLASS = 'markpad-ctx'
let menu: HTMLElement | null = null

function close() {
  if (menu) {
    menu.remove()
    menu = null
  }
}

async function paste() {
  try {
    const text = await (navigator as any).clipboard.readText()
    if (text) document.execCommand('insertText', false, text)
  } catch {
    try {
      document.execCommand('paste')
    } catch {
      /* webview may block programmatic paste; Ctrl+V still works */
    }
  }
}

type Item = { label: string; run: () => void } | 'sep'

function items(): Item[] {
  const v: any = (window as any).vditor
  const iv = v?.vditor
  const inSource = iv?.currentMode === 'sv'
  return [
    inSource
      ? { label: 'Switch to preview', run: () => setEditMode(iv, 'ir', v.getValue()) }
      : { label: 'Switch to source', run: () => setEditMode(iv, 'sv', v.getValue()) },
    'sep',
    { label: 'Cut', run: () => document.execCommand('cut') },
    { label: 'Copy', run: () => document.execCommand('copy') },
    { label: 'Paste', run: paste },
    { label: 'Select all', run: () => document.execCommand('selectAll') },
  ]
}

function show(x: number, y: number) {
  close()
  menu = document.createElement('div')
  menu.className = MENU_CLASS
  menu.contentEditable = 'false'
  for (const it of items()) {
    if (it === 'sep') {
      const s = document.createElement('div')
      s.className = MENU_CLASS + '__sep'
      menu.appendChild(s)
      continue
    }
    const el = document.createElement('div')
    el.className = MENU_CLASS + '__item'
    el.textContent = it.label
    el.addEventListener('mousedown', (e) => {
      e.preventDefault() // keep selection / editor focus
      close()
      it.run()
    })
    menu.appendChild(el)
  }
  document.body.appendChild(menu)
  const r = menu.getBoundingClientRect()
  menu.style.left = Math.min(x, window.innerWidth - r.width - 4) + 'px'
  menu.style.top = Math.min(y, window.innerHeight - r.height - 4) + 'px'
}

export function enableContextMenu() {
  const iv: any = (window as any).vditor?.vditor
  const targets = [iv?.ir?.element, iv?.sv?.element, iv?.wysiwyg?.element].filter(
    Boolean
  ) as HTMLElement[]
  targets.forEach((el) => {
    if (el.dataset.markpadCtx === '1') return
    el.dataset.markpadCtx = '1'
    el.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      show(e.clientX, e.clientY)
    })
  })

  document.addEventListener(
    'mousedown',
    (e) => {
      if (menu && !menu.contains(e.target as Node)) close()
    },
    true
  )
  document.addEventListener('keydown', (e) => e.key === 'Escape' && close(), true)
  document.addEventListener('scroll', close, true)
}
