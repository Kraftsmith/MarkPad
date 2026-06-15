/**
 * Custom right-click context menu for the Vditor editor.
 *
 * A VS Code webview won't let us extend the native context menu, so we replace
 * it. The headline action is "Switch to source / preview" (toggles IR <-> SV,
 * same as the toolbar's `< >` button); the rest are the usual edit actions.
 * Cut/Copy/Select all use execCommand; Paste tries the async clipboard API
 * (best effort — Ctrl+V always works through Vditor's own handler).
 */
import { readAloud, ttsAvailable } from './tts'

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

// "Bring to Claude": copy the selection and focus Claude Code's input. There's
// no API to inject text into Claude's chat, so we copy + focus its input and the
// user finishes with a single paste.
function bringToClaude() {
  const text = (window.getSelection()?.toString() || '')
    .replace(/ /g, ' ')
    .trim()
  if (!text) return
  navigator.clipboard.writeText(text).catch(() => {})
  ;(window as any).vscode?.postMessage?.({ command: 'bring-to-claude' })
  try {
    ;(window as any).vditor?.tip?.show?.('Copied — now paste into Claude (Ctrl+V)', 2000)
  } catch {
    /* tip is best-effort */
  }
}

type Item = { label: string; run: () => void } | 'sep'

function items(): Item[] {
  const hasSelection = !!(window.getSelection()?.toString() || '').trim()

  const list: Item[] = []
  if (ttsAvailable()) {
    list.push({ label: 'Read aloud', run: readAloud }, 'sep')
  }
  if (hasSelection) {
    list.push({ label: 'Bring to Claude  (Ctrl+Alt+C)', run: bringToClaude }, 'sep')
  }
  list.push(
    {
      label: 'Open in text editor',
      run: () => (window as any).vscode?.postMessage?.({ command: 'open-source' }),
    },
    'sep',
    { label: 'Cut', run: () => document.execCommand('cut') },
    { label: 'Copy', run: () => document.execCommand('copy') },
    { label: 'Paste', run: paste },
    { label: 'Select all', run: () => document.execCommand('selectAll') }
  )
  return list
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
    // Ctrl+Alt+C → copy selection for Claude (KeyC is layout-independent).
    el.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.ctrlKey && e.altKey && !e.shiftKey && e.code === 'KeyC') {
          e.preventDefault()
          e.stopImmediatePropagation()
          bringToClaude()
        }
      },
      true
    )
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
