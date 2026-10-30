// @ts-check
/**
 * The language of the panel: Brazilian Portuguese first, English on the switch.
 * Each module registers its own strings, so no file is shared between them.
 * Static text in `index.html` carries `data-i18n`, `data-i18n-placeholder`,
 * `data-i18n-aria` (aria-label and title), `data-i18n-label` (aria-label only, for
 * landmarks that must not show a tooltip) and is translated by `applyTranslations`.
 */

const STORAGE_KEY = 'sms-lang'

/** @type {{ pt: Record<string, string>, en: Record<string, string> }} */
const dictionaries = { pt: {}, en: {} }

/** @type {'pt' | 'en'} */
let lang = 'pt'
try {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'pt' || saved === 'en') lang = saved
} catch {
  // Storage can be blocked: the panel opens in Portuguese.
}

/** @type {Set<(lang: 'pt' | 'en') => void>} */
const listeners = new Set()

/**
 * Adds the strings of a module.
 * @param {{ pt: Record<string, string>, en: Record<string, string> }} strings
 */
export function registerStrings(strings) {
  Object.assign(dictionaries.pt, strings.pt)
  Object.assign(dictionaries.en, strings.en)
}

/** The current language. @returns {'pt' | 'en'} */
export function getLang() {
  return lang
}

/**
 * A string of the current language; `{name}` marks are filled from `vars`.
 * A key without a string reads as the Portuguese one, then as the key itself.
 * @param {string} key
 * @param {Record<string, string | number>} [vars]
 */
export function t(key, vars) {
  let text = dictionaries[lang][key] ?? dictionaries.pt[key] ?? key
  if (vars) text = text.replace(/\{(\w+)\}/g, (mark, name) => (name in vars ? String(vars[name]) : mark))
  return text
}

/**
 * Translates the static text under a root.
 * @param {ParentNode} [root]
 */
export function applyTranslations(root = document) {
  applyLabels(root)
  for (const el of root.querySelectorAll('[data-i18n]')) {
    if (el instanceof HTMLElement && el.dataset.i18n) el.textContent = t(el.dataset.i18n)
  }
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
    if (el instanceof HTMLElement && el.dataset.i18nPlaceholder) el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder))
  }
  for (const el of root.querySelectorAll('[data-i18n-aria]')) {
    if (!(el instanceof HTMLElement) || !el.dataset.i18nAria) continue
    const label = t(el.dataset.i18nAria)
    el.setAttribute('aria-label', label)
    el.setAttribute('title', label)
  }
}

/**
 * Translates the `data-i18n-label` marks of a root: the aria-label only.
 * @param {ParentNode} root
 */
function applyLabels(root) {
  for (const el of root.querySelectorAll('[data-i18n-label]')) {
    if (el instanceof HTMLElement && el.dataset.i18nLabel) el.setAttribute('aria-label', t(el.dataset.i18nLabel))
  }
}

/**
 * Switches the language, translates the page and tells the listeners.
 * @param {'pt' | 'en'} next
 */
export function setLang(next) {
  if ((next !== 'pt' && next !== 'en') || next === lang) return
  lang = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Not saved: the choice lasts until the page closes.
  }
  document.documentElement.lang = next === 'pt' ? 'pt-BR' : 'en'
  applyTranslations(document)
  for (const listener of listeners) listener(next)
}

/**
 * Calls `fn` whenever the language changes; the function returned stops it.
 * @param {(lang: 'pt' | 'en') => void} fn
 */
export function onLangChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
