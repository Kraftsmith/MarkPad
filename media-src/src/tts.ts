/**
 * Text-to-speech control panel with read-along word highlighting (Web Speech API).
 *
 * "Read aloud" opens a floating bar with play/pause, stop, and language / voice /
 * speed selectors. It reads the current selection, or the whole rendered document
 * when nothing is selected, and uses the utterance `boundary` events to highlight
 * the word currently being spoken via the CSS Custom Highlight API (no DOM
 * mutation). Voices come from the OS; word highlighting needs a voice that emits
 * boundary events (most Windows voices do).
 */

const PANEL = 'markpad-tts'
const HL = 'markpad-tts-word'
const WORD = /[A-Za-z0-9_À-ɏ]/

let panel: HTMLElement | null = null
let langSel: HTMLSelectElement
let voiceSel: HTMLSelectElement
let rateSel: HTMLSelectElement
let playBtn: HTMLButtonElement

// The spoken text plus a map from character offset back to a DOM position.
type Segment = { node: Text; start: number; len: number; nodeOffset: number }
let fullText = ''
let segments: Segment[] = []
let highlight: any = null

function available(): boolean {
  return (
    typeof speechSynthesis !== 'undefined' &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  )
}

export function ttsAvailable(): boolean {
  return available()
}

function allVoices(): SpeechSynthesisVoice[] {
  return available() ? speechSynthesis.getVoices() : []
}

function ensureHighlight() {
  if (highlight || typeof (window as any).Highlight === 'undefined' || !(CSS as any).highlights) {
    return
  }
  highlight = new (window as any).Highlight()
  ;(CSS as any).highlights.set(HL, highlight)
}

function clearHighlight() {
  try {
    highlight?.clear()
  } catch {
    /* ignore */
  }
}

// Build the spoken text + offset→DOM map from the selection, or the whole IR
// editor when nothing is selected. Skips hidden nodes (e.g. collapsed markers).
function buildSegments() {
  segments = []
  fullText = ''
  const sel = window.getSelection()
  const useSel = !!(sel && sel.rangeCount > 0 && !sel.isCollapsed)
  const range = useSel ? sel!.getRangeAt(0) : null
  const root =
    (useSel
      ? range!.commonAncestorContainer
      : ((window as any).vditor?.vditor?.ir?.element as Node)) || null
  if (!root) return
  const rootEl = (root.nodeType === Node.TEXT_NODE ? root.parentNode : root) as Node
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const t = n as Text
      if (!t.textContent || !t.textContent.trim()) return NodeFilter.FILTER_REJECT
      const p = t.parentElement
      if (!p || p.offsetParent === null) return NodeFilter.FILTER_REJECT // hidden
      if (range && !range.intersectsNode(t)) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let prevBlock: Element | null = null
  let node: Node | null
  while ((node = walker.nextNode())) {
    const t = node as Text
    const raw = t.textContent || ''
    let from = 0
    let to = raw.length
    if (range) {
      if (t === range.startContainer) from = range.startOffset
      if (t === range.endContainer) to = range.endOffset
    }
    const text = raw.slice(from, to)
    if (!text) continue
    const block =
      t.parentElement?.closest('p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,pre,div') || null
    if (prevBlock && block !== prevBlock && fullText && !/\s$/.test(fullText)) {
      fullText += '\n'
    }
    prevBlock = block
    segments.push({ node: t, start: fullText.length, len: text.length, nodeOffset: from })
    fullText += text
  }
}

function rangeForWord(charIndex: number): Range | null {
  let s = charIndex
  while (s > 0 && WORD.test(fullText[s - 1])) s--
  let e = charIndex
  while (e < fullText.length && WORD.test(fullText[e])) e++
  if (e <= s) return null
  const segAt = (pos: number) => segments.find((g) => pos >= g.start && pos < g.start + g.len)
  const a = segAt(s)
  const b = segAt(e - 1) || a
  if (!a || !b) return null
  const r = document.createRange()
  try {
    r.setStart(a.node, a.nodeOffset + (s - a.start))
    r.setEnd(b.node, b.nodeOffset + (e - b.start))
  } catch {
    return null
  }
  return r
}

function highlightWordAt(charIndex: number) {
  if (!highlight) return
  const r = rangeForWord(charIndex)
  clearHighlight()
  if (!r) return
  highlight.add(r)
  const rect = r.getBoundingClientRect()
  if (rect.top < 60 || rect.bottom > window.innerHeight - 60) {
    ;(r.startContainer.parentElement as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest' })
  }
}

function isPlaying(): boolean {
  return available() && speechSynthesis.speaking && !speechSynthesis.paused
}

function refreshPlayBtn() {
  if (playBtn) playBtn.textContent = isPlaying() ? '⏸' : '▶'
}

function speak() {
  if (!available() || !fullText.trim()) return
  ensureHighlight()
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(fullText)
  const voice = allVoices().find((v) => v.name === voiceSel.value)
  if (voice) u.voice = voice
  u.lang = langSel.value || (voice && voice.lang) || navigator.language || 'en-US'
  u.rate = parseFloat(rateSel.value) || 1
  u.onboundary = (e) => highlightWordAt(e.charIndex)
  u.onend = u.onerror = () => {
    clearHighlight()
    refreshPlayBtn()
  }
  speechSynthesis.speak(u)
  refreshPlayBtn()
}

function togglePlay() {
  if (!available()) return
  if (speechSynthesis.paused) speechSynthesis.resume()
  else if (speechSynthesis.speaking) speechSynthesis.pause()
  else speak()
  refreshPlayBtn()
}

function stop() {
  if (available()) speechSynthesis.cancel()
  clearHighlight()
  refreshPlayBtn()
}

function fillLanguages() {
  const langs = [...new Set(allVoices().map((v) => v.lang))].sort()
  const prev = langSel.value
  langSel.innerHTML = '<option value="">Auto</option>'
  for (const l of langs) {
    const o = document.createElement('option')
    o.value = l
    o.textContent = l
    langSel.appendChild(o)
  }
  const nav = (navigator.language || '').toLowerCase()
  langSel.value =
    prev && langs.includes(prev) ? prev : langs.find((l) => l.toLowerCase() === nav) || ''
}

function fillVoices() {
  const lang = langSel.value
  const list = allVoices().filter((v) => !lang || v.lang === lang)
  const prev = voiceSel.value
  voiceSel.innerHTML = '<option value="">Default</option>'
  for (const v of list) {
    const o = document.createElement('option')
    o.value = v.name
    o.textContent = v.name + (v.default ? ' (default)' : '')
    voiceSel.appendChild(o)
  }
  if (prev && list.some((v) => v.name === prev)) voiceSel.value = prev
}

function makeBtn(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = PANEL + '__btn'
  b.type = 'button'
  b.textContent = label
  b.title = title
  b.addEventListener('mousedown', (e) => {
    e.preventDefault()
    onClick()
  })
  return b
}

function buildPanel() {
  panel = document.createElement('div')
  panel.className = PANEL
  panel.contentEditable = 'false'

  playBtn = makeBtn('▶', 'Play / Pause', togglePlay)
  const stopBtn = makeBtn('⏹', 'Stop', stop)

  langSel = document.createElement('select')
  langSel.className = PANEL + '__sel'
  voiceSel = document.createElement('select')
  voiceSel.className = PANEL + '__sel'
  rateSel = document.createElement('select')
  rateSel.className = PANEL + '__sel'
  for (const r of ['0.5', '0.75', '1', '1.25', '1.5', '1.75', '2']) {
    const o = document.createElement('option')
    o.value = r
    o.textContent = r + '×'
    if (r === '1') o.selected = true
    rateSel.appendChild(o)
  }

  langSel.addEventListener('change', () => {
    fillVoices()
    if (speechSynthesis.speaking) speak()
  })
  voiceSel.addEventListener('change', () => {
    if (speechSynthesis.speaking) speak()
  })
  rateSel.addEventListener('change', () => {
    if (speechSynthesis.speaking) speak()
  })

  const field = (label: string, el: HTMLElement) => {
    const wrap = document.createElement('span')
    wrap.className = PANEL + '__field'
    const t = document.createElement('span')
    t.textContent = label
    wrap.append(t, el)
    return wrap
  }

  const close = makeBtn('✕', 'Close', () => {
    stop()
    panel?.remove()
    panel = null
  })
  close.classList.add(PANEL + '__close')

  panel.append(
    playBtn,
    stopBtn,
    field('Lang', langSel),
    field('Voice', voiceSel),
    field('Speed', rateSel),
    close
  )
  document.body.appendChild(panel)

  fillLanguages()
  fillVoices()
  speechSynthesis.onvoiceschanged = () => {
    fillLanguages()
    fillVoices()
  }
}

export function readAloud() {
  if (!available()) return
  buildSegments()
  if (!fullText.trim()) return
  if (!panel) buildPanel()
  speak()
}
