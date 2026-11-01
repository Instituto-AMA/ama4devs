// @ts-check
/**
 * Choices printed on the sheet instead of a native `<select>`: the select
 * stays in the form as the owner of the value (the code reads `select.value`
 * and listens to its `change`), hidden, and a row of radio chips drives it.
 *
 * A chip shows `option.dataset.short` (or the option's text) and, for a coded
 * value, `option.dataset.code` as a small mono prefix; `option.title` becomes
 * the chip's tooltip.
 */

let uid = 0

/**
 * Draws the chips of a select right after it and hides the select.
 * @param {HTMLSelectElement} select
 * @param {{ compact?: boolean }} [options] compact: short mono keys (the states)
 * @returns {{ refresh(): void }}
 */
export function chipsFor(select, { compact = false } = {}) {
  const name = `chips-${select.id || ++uid}`
  const group = document.createElement('div')
  group.className = compact ? 'choice-chips is-compact' : 'choice-chips'
  group.setAttribute('role', 'radiogroup')
  const labelledBy = select.getAttribute('aria-labelledby')
  if (labelledBy) group.setAttribute('aria-labelledby', labelledBy)
  select.hidden = true
  select.tabIndex = -1
  select.setAttribute('aria-hidden', 'true')
  select.after(group)

  function render() {
    group.replaceChildren(
      ...[...select.options].map((option) => {
        const chip = document.createElement('label')
        chip.className = 'choice-chip'
        if (option.title) chip.title = option.title

        const input = document.createElement('input')
        input.type = 'radio'
        input.name = name
        input.value = option.value
        input.checked = option.selected
        input.addEventListener('change', () => {
          if (!input.checked) return
          select.value = option.value
          select.dispatchEvent(new Event('change', { bubbles: true }))
        })

        const face = document.createElement('span')
        if (option.dataset.code) {
          const code = document.createElement('b')
          code.textContent = option.dataset.code
          face.append(code, ' ')
        }
        face.append(option.dataset.short ?? option.text)
        chip.append(input, face)
        return chip
      }),
    )
  }

  /** Follows a value set on the select by code. */
  function refresh() {
    for (const input of group.querySelectorAll('input')) {
      /** @type {HTMLInputElement} */ (input).checked = /** @type {HTMLInputElement} */ (input).value === select.value
    }
  }

  render()
  select.addEventListener('change', refresh)
  return { refresh }
}
