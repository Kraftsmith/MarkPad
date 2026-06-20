/**
 * Give the emoji toolbar panel the full emoji set.
 *
 * Typing `:name` already searches Lute's complete emoji set, but the click-to-pick
 * toolbar panel is built from the small default `options.hint.emoji`. This swaps in
 * Lute's full set (available once Lute has loaded, i.e. by the `after()` hook) for
 * both the empty `:` hint and the panel, then rebuilds the panel's buttons. The
 * toolbar's existing delegated click handler still picks up the new buttons.
 */
export function enableRichEmoji() {
  const v: any = (window as any).vditor
  const iv = v?.vditor
  if (!iv?.lute?.GetEmojis) return

  const emojis: Record<string, string> = iv.lute.GetEmojis()
  if (!emojis || Object.keys(emojis).length === 0) return

  // Used for the empty `:` hint state too.
  iv.options.hint.emoji = emojis

  const emojiItem = iv.toolbar?.elements?.['emoji'] as HTMLElement | undefined
  const container = emojiItem?.querySelector('.vditor-emojis') as HTMLElement | null
  if (!container) return

  let html = ''
  for (const key of Object.keys(emojis)) {
    const val = emojis[key]
    if (typeof val === 'string' && val.indexOf('.') > -1) {
      // image-backed emoji
      html +=
        `<button data-value=":${key}: " data-key=":${key}:">` +
        `<img data-value=":${key}: " data-key=":${key}:" class="vditor-emojis__icon" src="${val}"/></button>`
    } else {
      html +=
        `<button data-value="${val} " data-key="${key}">` +
        `<span class="vditor-emojis__icon">${val}</span></button>`
    }
  }
  container.innerHTML = html
}
