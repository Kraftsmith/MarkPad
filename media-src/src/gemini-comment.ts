/**
 * Inline "Comment with Gemini" Popover.
 * Allows the user to select text/table/lines in MarkPad and attach a prompt or
 * comment (like plan review / inline chat), sending both the quoted context
 * and user comment directly to Gemini Antigravity.
 */

const POPUP_ID = 'markpad-gemini-comment'

let popup: HTMLDivElement | null = null
let currentSelectedText = ''
let activeCaretRange: Range | null = null
let openedTime = 0
let isSubmitting = false

function ensurePopup(): HTMLDivElement {
  if (popup) return popup

  popup = document.createElement('div')
  popup.id = POPUP_ID
  popup.className = POPUP_ID
  popup.innerHTML = `
    <div class="${POPUP_ID}__header">
      <div class="${POPUP_ID}__title">
        <svg class="${POPUP_ID}__icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M12 2L14.4 7.6L20 10L14.4 12.4L12 18L9.6 12.4L4 10L9.6 7.6L12 2Z" />
          <path d="M19 16L20.2 18.8L23 20L20.2 21.2L19 24L17.8 21.2L15 20L17.8 18.8L19 16Z" opacity="0.8" />
        </svg>
        <span>Comment with Gemini</span>
      </div>
      <button type="button" class="${POPUP_ID}__close" title="Close (Esc)" aria-label="Close">&#10005;</button>
    </div>
    <div class="${POPUP_ID}__quote" style="display: none;">
      <div class="${POPUP_ID}__quote-content"></div>
    </div>
    <div class="${POPUP_ID}__body">
      <textarea
        class="${POPUP_ID}__textarea"
        rows="2"
        placeholder="Ask Gemini or add a comment... (Enter to send, Shift+Enter for newline)"
      ></textarea>
    </div>
    <div class="${POPUP_ID}__footer">
      <span class="${POPUP_ID}__hint">Enter ↵ to send &bull; Esc to cancel</span>
      <button type="button" class="${POPUP_ID}__send">Send</button>
    </div>
  `
  document.body.appendChild(popup)

  const textarea = popup.querySelector(`.${POPUP_ID}__textarea`) as HTMLTextAreaElement
  const closeBtn = popup.querySelector(`.${POPUP_ID}__close`) as HTMLButtonElement
  const sendBtn = popup.querySelector(`.${POPUP_ID}__send`) as HTMLButtonElement

  closeBtn.addEventListener('click', (e) => {
    e.preventDefault()
    closeGeminiComment()
  })

  sendBtn.addEventListener('click', (e) => {
    e.preventDefault()
    submitGeminiComment()
  })

  textarea.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submitGeminiComment()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeGeminiComment()
    }
  })

  // Prevent clicks inside popup from stealing editor selection or triggering outside blur
  popup.addEventListener('mousedown', (e) => {
    e.stopPropagation()
  })

  // Close when clicking outside, but ignore clicks within 250ms of opening
  document.addEventListener('mousedown', (e) => {
    if (Date.now() - openedTime < 250) return
    if (popup && popup.classList.contains(`${POPUP_ID}--visible`)) {
      if (!popup.contains(e.target as Node)) {
        closeGeminiComment()
      }
    }
  })

  return popup
}

export function openGeminiComment(
  presetText?: string,
  presetRange?: Range | null,
  fallbackPos?: { x: number; y: number } | null
) {
  const el = ensurePopup()
  openedTime = Date.now()

  const sel = window.getSelection()
  const rawSelected =
    presetText !== undefined
      ? presetText
      : (sel?.toString() || '').replace(/\u00a0/g, ' ').trim()
  currentSelectedText = rawSelected

  let anchorRect: DOMRect | null = null
  const rangeToUse = presetRange || (sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null)
  if (rangeToUse) {
    activeCaretRange = rangeToUse.cloneRange()
    const rects = rangeToUse.getClientRects()
    for (let i = rects.length - 1; i >= 0; i--) {
      if (rects[i].width > 0 && rects[i].height > 0) {
        anchorRect = rects[i]
        break
      }
    }
    if (!anchorRect) {
      anchorRect = rangeToUse.getBoundingClientRect()
    }
  }

  const quoteEl = el.querySelector(`.${POPUP_ID}__quote`) as HTMLElement
  const quoteContent = el.querySelector(`.${POPUP_ID}__quote-content`) as HTMLElement
  const textarea = el.querySelector(`.${POPUP_ID}__textarea`) as HTMLTextAreaElement

  if (currentSelectedText) {
    quoteEl.style.display = 'block'
    const displaySnippet =
      currentSelectedText.length > 180
        ? currentSelectedText.slice(0, 177) + '...'
        : currentSelectedText
    quoteContent.textContent = displaySnippet
  } else {
    quoteEl.style.display = 'none'
    quoteContent.textContent = ''
  }

  textarea.value = ''
  el.classList.add(`${POPUP_ID}--visible`)

  // Positioning logic
  const popWidth = 380
  const margin = 12
  let left = 20
  let top = 60

  if (anchorRect && anchorRect.width > 0 && anchorRect.bottom > 0) {
    left = anchorRect.left
    top = anchorRect.bottom + 8
    // Keep in viewport horizontally
    if (left + popWidth > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - popWidth - margin)
    }
    // If overflowing viewport bottom, show above selection
    if (top + 220 > window.innerHeight) {
      top = Math.max(margin, anchorRect.top - 230)
    }
  } else if (fallbackPos && fallbackPos.x > 0 && fallbackPos.y > 0) {
    left = Math.min(fallbackPos.x, window.innerWidth - popWidth - margin)
    top = Math.min(fallbackPos.y + 8, window.innerHeight - 230)
  } else {
    // Center-top fallback
    left = Math.max(margin, (window.innerWidth - popWidth) / 2)
    top = 80
  }

  top = Math.max(margin, Math.min(top, window.innerHeight - 220))
  left = Math.max(margin, Math.min(left, window.innerWidth - popWidth - margin))

  el.style.left = `${Math.round(left)}px`
  el.style.top = `${Math.round(top)}px`

  setTimeout(() => {
    textarea.focus()
  }, 50)
}

export function closeGeminiComment() {
  if (!popup) return
  popup.classList.remove(`${POPUP_ID}--visible`)
  currentSelectedText = ''
  activeCaretRange = null
  // Return focus to active editor
  const vd = (window as any).vditor?.vditor
  const currentMode = vd?.currentMode
  const editorEl = currentMode && vd[currentMode]?.element ? vd[currentMode].element : vd?.ir?.element
  editorEl?.focus()
}

function submitGeminiComment() {
  if (!popup || isSubmitting) return
  const textarea = popup.querySelector(`.${POPUP_ID}__textarea`) as HTMLTextAreaElement
  const comment = (textarea.value || '').trim()

  if (!comment && !currentSelectedText) {
    closeGeminiComment()
    return
  }

  isSubmitting = true

  // Format message payload for Gemini Antigravity
  let payload = ''
  if (currentSelectedText && comment) {
    // Quoted markdown block + user instruction
    const quoted = currentSelectedText
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n')
    payload = `${quoted}\n\n${comment}`
  } else if (currentSelectedText) {
    payload = currentSelectedText
  } else {
    payload = comment
  }

  // Copy to clipboard as backup
  navigator.clipboard.writeText(payload).catch(() => {})

  // Send message to extension host
  ;(window as any).vscode?.postMessage?.({
    command: 'bring-to-antigravity',
    text: payload,
  })

  try {
    ;(window as any).vditor?.tip?.show?.('Sent comment to Gemini Antigravity', 2200)
  } catch {}

  closeGeminiComment()
  setTimeout(() => {
    isSubmitting = false
  }, 300)
}
