/**
 * Captures the Asaas mock story as CLEAN stills for the Remotion film.
 *
 * Same navigation as the recorded tour (v4), but the camera never records video:
 * every beat is saved as a still WITHOUT the burned-in caption of the tour, and
 * the script writes a manifest with the caption line, the page and the box the
 * camera must focus on. The film is composed from those stills in Remotion.
 *
 * The overlay of the tour (caption card, spotlight, progress line) is hidden for
 * the screenshot: the film draws its own captions and its own spotlight, in the
 * frame of the film, not inside the picture of the product.
 *
 * What must be running when the capture starts:
 *
 *   the Asaas mock       (default http://localhost:45990)
 *   the WhatsApp mock    (default http://localhost:3020)
 *   Mailpit              (default http://localhost:8025)
 *   the webhook receiver (default http://localhost:45991)
 *   the API console      (default http://localhost:45992) — `node scripts/console.mjs`
 *
 * Every address can be changed with an environment variable.
 */
import { chromium } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const BASE = process.env.ASAAS_BASE ?? 'http://localhost:45990'
const WA_CONSOLE = process.env.WHATSAPP_CONSOLE ?? 'http://localhost:3020'
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025'
/** The local application that receives the webhook deliveries. */
const RECEIVER = process.env.RECEIVER_URL ?? 'http://localhost:45991'
/** The API console of the video: real requests, real responses. */
const API_CONSOLE = process.env.API_CONSOLE_URL ?? 'http://localhost:45992'
const SHOT_DIR = resolve(ROOT, 'public/shots')
const MANIFEST = resolve(ROOT, 'src/shots.json')
const DRY = false
const SHOTS = true
/**
 * The pace of the film. The waits that carry the narration are cut to the bone;
 * the ones that wait for the simulator (a clock tick takes real time) are not.
 */
const SPEED = Number(process.env.SPEED ?? '0.68')
/**
 * How long a caption stays on screen before another one may replace it. This is
 * the fix for "the text went by before I could read it": the line owns the screen
 * for this long, no matter how fast the film moves.
 */
const CAPTION_DWELL = Number(process.env.CAPTION_DWELL ?? 2100)
/**
 * How long the spotlight highlights an element before it fades away on its own.
 * The old version kept the screen half-dark until the next highlight came.
 */
const SPOT_MS = Number(process.env.SPOT_MS ?? 2100)

if (!DRY) rmSync(SHOT_DIR, { recursive: true, force: true })
mkdirSync(SHOT_DIR, { recursive: true })
if (SHOTS) mkdirSync(SHOT_DIR, { recursive: true })

/**
 * The manifest of the film: one entry per beat, with the still, the caption
 * line, the page and the box the camera focuses on.
 */
const manifest = []
/** The caption of the current beat — the line the film prints on the frame. */
let currentCaption = ''
/** The box the camera focuses on (source pixels, 1440x900). */
let focusBox = null
/** The box the film highlights with the spotlight (source pixels). */
let spotBox = null

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
})

/**
 * The film: a cursor the screencast does not draw, a caption, click ripples, a
 * spotlight, status flashes, act cards, a progress line and the curtain that
 * covers every navigation.
 */
await context.addInitScript(() => {
  const install = () => {
    if (document.getElementById('__fx-root')) return

    const style = document.createElement('style')
    style.textContent = `
      @keyframes __fxRipple { from { transform: scale(.4); opacity: .95 } to { transform: scale(3.4); opacity: 0 } }
      @keyframes __fxHalo { 0% { opacity: .95 } 100% { opacity: 0 } }
      @keyframes __fxCaret { 0%,100% { opacity: 1 } 50% { opacity: 0 } }
    `
    document.head.appendChild(style)

    const root = document.createElement('div')
    root.id = '__fx-root'
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;'
    document.body.appendChild(root)

    // ── the cursor ────────────────────────────────────────────────────────────
    const dot = document.createElement('div')
    dot.style.cssText =
      'position:fixed;z-index:2147483006;width:18px;height:18px;border-radius:50%;' +
      'background:rgba(11,75,255,.18);border:2px solid #0b4bff;box-shadow:0 2px 10px rgba(0,0,0,.4);' +
      'transform:translate(-50%,-50%);opacity:0;transition:opacity .25s,width .12s,height .12s;pointer-events:none'
    root.appendChild(dot)

    document.addEventListener(
      'mousemove',
      (e) => {
        dot.style.left = `${e.clientX}px`
        dot.style.top = `${e.clientY}px`
        dot.style.opacity = '1'
      },
      true,
    )

    document.addEventListener(
      'mousedown',
      (e) => {
        dot.style.width = '11px'
        dot.style.height = '11px'
        const ripple = document.createElement('div')
        ripple.style.cssText =
          `position:fixed;left:${e.clientX}px;top:${e.clientY}px;width:20px;height:20px;` +
          'margin:-10px 0 0 -10px;border-radius:50%;border:2px solid rgba(11,75,255,.9);' +
          'animation:__fxRipple .6s ease-out forwards;pointer-events:none'
        root.appendChild(ripple)
        setTimeout(() => ripple.remove(), 700)

        const el = e.target instanceof Element ? e.target.closest('button, a, .nav-item, .tab, .picker-trigger') : null
        if (!el) return
        const r = el.getBoundingClientRect()
        const halo = document.createElement('div')
        halo.style.cssText =
          `position:fixed;left:${r.left - 3}px;top:${r.top - 3}px;width:${r.width + 6}px;height:${r.height + 6}px;` +
          'border-radius:12px;border:2px solid rgba(61,220,151,.95);animation:__fxHalo .9s ease-out forwards;pointer-events:none'
        root.appendChild(halo)
        setTimeout(() => halo.remove(), 1000)
      },
      true,
    )
    document.addEventListener(
      'mouseup',
      () => {
        dot.style.width = '18px'
        dot.style.height = '18px'
      },
      true,
    )

    // ── the caption ───────────────────────────────────────────────────────────
    const cap = document.createElement('div')
    cap.id = '__fx-caption'
    cap.style.cssText =
      'position:fixed;left:30px;bottom:30px;z-index:2147483005;max-width:min(740px,52vw);' +
      'background:linear-gradient(90deg,rgba(6,14,32,.95),rgba(11,23,52,.92));border-left:4px solid #3ddc97;' +
      'color:#eaf1ff;padding:15px 24px;border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.45);' +
      'font:600 17.5px/1.42 system-ui,-apple-system,sans-serif;opacity:0;transform:translateY(12px);' +
      'white-space:normal;max-height:170px;overflow:hidden;' +
      'transition:opacity .38s ease,transform .38s ease;pointer-events:none'
    root.appendChild(cap)

    let capText = ''
    let capTimer = null
    const setCaption = (text, opts) => {
      const options = opts || {}
      if (options.position === 'top') {
        cap.style.top = '26px'
        cap.style.bottom = 'auto'
      } else {
        cap.style.bottom = '30px'
        cap.style.top = 'auto'
      }
      if (text === capText) {
        cap.style.opacity = text ? '1' : '0'
        return Promise.resolve(true)
      }
      capText = text
      // The old line leaves before the new one arrives: no two texts at once.
      cap.style.opacity = '0'
      cap.style.transform = 'translateY(10px)'
      clearTimeout(capTimer)
      return new Promise((resolve) => {
        capTimer = setTimeout(() => {
          cap.textContent = text
          cap.style.opacity = text ? '1' : '0'
          cap.style.transform = 'translateY(0)'
          resolve(true)
        }, 220)
      })
    }

    // ── the progress line of the film ─────────────────────────────────────────
    const prog = document.createElement('div')
    prog.style.cssText =
      'position:fixed;left:0;top:0;height:3px;width:0;z-index:2147483007;' +
      'background:linear-gradient(90deg,#3ddc97,#35b6ff);transition:width .8s ease;pointer-events:none;' +
      'box-shadow:0 0 14px rgba(61,220,151,.55)'
    root.appendChild(prog)

    // ── the spotlight ──────────────────────────────────────────────────────────
    let spotBox = null
    let spotTimer = null
    let spotHideTimer = null
    const clearSpot = () => {
      if (spotTimer) clearInterval(spotTimer)
      if (spotHideTimer) clearTimeout(spotHideTimer)
      if (spotBox) spotBox.remove()
      spotBox = null
      spotTimer = null
      spotHideTimer = null
    }
    /**
     * The highlight. The scrim around it is a soft vignette, not a blackout: the
     * viewer still reads the screen around the element. It fades out on its own
     * after `ms`, so the picture is never left half-dark.
     */
    const spotlight = (selector, label, ms) => {
      clearSpot()
      const target = document.querySelector(selector)
      if (!target) return false
      const box = document.createElement('div')
      box.style.cssText =
        'position:fixed;z-index:2147483001;border:2px solid #3ddc97;border-radius:14px;' +
        'box-shadow:0 0 0 9999px rgba(3,9,22,.14),0 0 24px rgba(61,220,151,.4);' +
        'transition:left .3s ease,top .3s ease,width .3s ease,height .3s ease,opacity .5s ease;pointer-events:none'
      if (label) {
        const tag = document.createElement('div')
        tag.textContent = label
        tag.style.cssText =
          'position:absolute;left:-2px;top:-30px;background:#3ddc97;color:#04121b;' +
          'font:700 12px/1 system-ui,sans-serif;padding:6px 10px;border-radius:8px;white-space:nowrap'
        box.appendChild(tag)
      }
      root.appendChild(box)
      const place = () => {
        const r = target.getBoundingClientRect()
        box.style.left = `${r.left - 8}px`
        box.style.top = `${r.top - 8}px`
        box.style.width = `${r.width + 16}px`
        box.style.height = `${r.height + 16}px`
      }
      place()
      spotTimer = setInterval(place, 200)
      spotBox = box
      const duration = ms || 0
      if (duration > 0) {
        spotHideTimer = setTimeout(() => {
          box.style.opacity = '0'
          setTimeout(() => {
            if (spotBox === box) {
              clearSpot()
            }
          }, 560)
        }, duration)
      }
      return true
    }

    // ── the flash of a status that changed ────────────────────────────────────
    const flash = (selector, tone) => {
      const target = document.querySelector(selector)
      if (!target) return false
      const r = target.getBoundingClientRect()
      const rgb = tone === 'bad' ? '255,107,129' : '61,220,151'
      const halo = document.createElement('div')
      halo.style.cssText =
        `position:fixed;left:${r.left - 6}px;top:${r.top - 6}px;width:${r.width + 12}px;height:${r.height + 12}px;` +
        `border-radius:12px;border:2px solid rgba(${rgb},.95);box-shadow:0 0 26px rgba(${rgb},.6);` +
        'animation:__fxHalo 1.2s ease-out forwards;pointer-events:none'
      root.appendChild(halo)
      setTimeout(() => halo.remove(), 1300)
      return true
    }

    // ── the act card ──────────────────────────────────────────────────────────
    const act = (kicker, title, ms) => {
      const duration = ms || 2200
      return new Promise((resolve) => {
        const wrap = document.createElement('div')
        wrap.style.cssText =
          'position:fixed;inset:0;z-index:2147483009;display:grid;place-items:center;' +
          'background:radial-gradient(1100px 640px at 50% 45%,rgba(9,20,44,.8),rgba(3,7,18,.92));' +
          'opacity:0;transition:opacity .62s ease;pointer-events:none'
        const card = document.createElement('div')
        card.style.cssText =
          'text-align:center;transform:translateY(18px) scale(.98);' +
          'transition:transform .72s cubic-bezier(.2,.8,.2,1);padding:0 40px'
        const kick = document.createElement('div')
        kick.textContent = kicker
        kick.style.cssText =
          'font:700 13px/1 system-ui,sans-serif;letter-spacing:4px;color:#3ddc97;text-transform:uppercase'
        const name = document.createElement('div')
        name.textContent = title
        name.style.cssText =
          'font:800 42px/1.12 system-ui,-apple-system,sans-serif;color:#fff;margin-top:14px;' +
          'text-shadow:0 6px 30px rgba(0,0,0,.6)'
        card.appendChild(kick)
        card.appendChild(name)
        wrap.appendChild(card)
        root.appendChild(wrap)
        requestAnimationFrame(() => {
          wrap.style.opacity = '1'
          card.style.transform = 'translateY(0) scale(1)'
        })
        setTimeout(() => {
          wrap.style.opacity = '0'
          card.style.transform = 'translateY(-12px) scale(.99)'
          setTimeout(() => {
            wrap.remove()
            resolve(true)
          }, 640)
        }, duration)
      })
    }

    // ── the warp of the clock ─────────────────────────────────────────────────
    let warpState = null
    const warpStart = (opts) => {
      const options = opts || {}
      const days = options.days || 30
      const from = options.from
      const label = options.label || 'O tempo do simulador'
      if (warpState) warpState.remove()
      const wrap = document.createElement('div')
      wrap.style.cssText =
        'position:fixed;inset:0;z-index:2147483008;display:grid;place-items:center;' +
        'background:radial-gradient(1100px 640px at 50% 50%,rgba(8,18,40,.84),rgba(2,6,16,.93));' +
        'opacity:0;transition:opacity .55s ease;pointer-events:none'
      const box = document.createElement('div')
      box.style.cssText = 'text-align:center;width:min(760px,80vw)'
      const kick = document.createElement('div')
      kick.textContent = label
      kick.style.cssText =
        'font:700 13px/1 system-ui,sans-serif;letter-spacing:4px;color:#3ddc97;text-transform:uppercase'
      const date = document.createElement('div')
      date.style.cssText = 'font:800 46px/1.1 system-ui,sans-serif;color:#fff;margin-top:16px'
      const sub = document.createElement('div')
      sub.style.cssText = 'font:500 15px/1.4 system-ui,sans-serif;color:#9fb3d8;margin-top:10px'
      const track = document.createElement('div')
      track.style.cssText =
        'height:4px;background:rgba(255,255,255,.12);border-radius:99px;margin-top:22px;overflow:hidden'
      const bar = document.createElement('div')
      bar.style.cssText =
        'height:100%;width:0;background:linear-gradient(90deg,#3ddc97,#35b6ff);transition:width .35s linear'
      track.appendChild(bar)
      box.appendChild(kick)
      box.appendChild(date)
      box.appendChild(sub)
      box.appendChild(track)
      wrap.appendChild(box)
      root.appendChild(wrap)
      requestAnimationFrame(() => {
        wrap.style.opacity = '1'
      })
      const fmt = new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
      const start = Date.parse(`${from}T12:00:00Z`)
      const set = (day) => {
        const d = Math.max(0, Math.min(days, day))
        const unit = days === 1 ? 'dia' : 'dias'
        date.textContent = fmt.format(new Date(start + d * 86400000))
        sub.textContent = `+${d} de ${days} ${unit} · um tick completo por dia`
        bar.style.width = `${((d / days) * 100).toFixed(1)}%`
      }
      set(0)
      warpState = { wrap, set }
    }
    const warpSet = (day) => {
      if (warpState) warpState.set(day)
    }
    const warpStop = () => {
      if (!warpState) return
      const { wrap } = warpState
      warpState = null
      wrap.style.opacity = '0'
      setTimeout(() => wrap.remove(), 450)
    }

    // ── the curtain of every navigation ───────────────────────────────────────
    const curtain = document.createElement('div')
    curtain.style.cssText =
      'position:fixed;inset:0;z-index:2147483011;' +
      'background:radial-gradient(1300px 760px at 50% 50%,#071129,#030a18);opacity:1;' +
      'transition:opacity .82s ease;pointer-events:none'
    root.appendChild(curtain)
    setTimeout(() => {
      curtain.style.opacity = '0'
      setTimeout(() => curtain.remove(), 920)
    }, 360)

    window.__fx = {
      caption: setCaption,
      spotlight,
      clearSpot,
      flash,
      act,
      warpStart,
      warpSet,
      warpStop,
      progress: (p) => {
        prog.style.width = `${(p * 100).toFixed(2)}%`
      },
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install)
  } else {
    install()
  }
})

const page = await context.newPage()
const errors = []
const failed = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(`console: ${m.text()}`)
})
page.on('response', (r) => {
  if (r.status() >= 400 && !r.url().includes('favicon')) {
    failed.push(`${r.status()} ${r.request().method()} ${r.url()}`)
  }
})

const wait = (ms) => new Promise((r) => setTimeout(r, Math.max(320, Math.round(ms * SPEED))))
/** A wait that is NOT cut: the simulator needs real time to run its ticks. */
const waitReal = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (m) => console.log(`▶ ${m}`)

/**
 * The caption card: what the viewer is looking at right now.
 *
 * A caption does not replace the previous one before the viewer had time to read
 * it: the line owns the screen for CAPTION_DWELL. That is the difference between
 * "the text went by" and "the text can be read".
 *
 * On a new screen there is nothing to protect: the line appears right away, and
 * the dwell only applies between two captions of the SAME screen.
 */
let captionFreeAt = 0
let captionUrl = null
async function caption(text, opts) {
  const url = page.url()
  const changed = url !== captionUrl
  captionUrl = url
  if (!changed) {
    const now = Date.now()
    if (now < captionFreeAt) await waitReal(captionFreeAt - now)
  }
  // The film draws the caption in its own frame: nothing is burned into the still.
  currentCaption = text || ''
  captionFreeAt = Date.now() + CAPTION_DWELL
  console.log(`   · ${text}`)
}

/** The act card: the chapter of the film. */
async function act(kicker, title, ms) {
  await page.evaluate(([k, t, m]) => window.__fx?.act(k, t, m), [kicker, title, ms ?? 3000])
  console.log(`   ≡ ${kicker} · ${title}`)
}

/** The progress line of the film. */
async function progress(p) {
  await page.evaluate((v) => window.__fx?.progress(v), p)
}

/** Puts the spotlight on an element and tells the viewer what it is. */
async function spotlight(selector, label, ms = SPOT_MS) {
  const ok = await page.evaluate(
    ([s, l, d]) => window.__fx?.spotlight(s, l, d),
    [selector, label ?? null, ms],
  )
  if (!ok) console.log(`   ! sem elemento para o holofote: ${selector}`)
  return ok
}

/** A flash of light on a status that just changed. */
async function flash(selector, tone) {
  await page.evaluate(([s, t]) => window.__fx?.flash(s, t), [selector, tone ?? 'good'])
}

/** The clock warp: the days of the simulator passing on the screen. */
async function warpStart(opts) {
  await page.evaluate((o) => window.__fx?.warpStart(o), opts)
}

/** Moves the warp to the day the simulator is really on. */
async function warpSet(day) {
  await page.evaluate((d) => window.__fx?.warpSet(d), day)
}

/** The days fly by on the overlay, from the first day to the last real one. */
async function warpSweep(from, to, ms = 1400) {
  const steps = Math.max(1, Math.abs(to - from))
  const per = ms / steps
  for (let d = 0; d <= steps; d++) {
    await warpSet(from + Math.sign(to - from) * d)
    await waitReal(per)
  }
}

/** Stops the warp early, when the real request is already back. */
async function stopWarp() {
  await page.evaluate(() => window.__fx?.warpStop?.())
}

let shotIndex = 0
/**
 * Saves the beat: a clean still (no overlay of the tour) and the manifest entry
 * the film reads — the caption line, the page and the box the camera focuses.
 */
async function shot(name) {
  if (!SHOTS) return
  shotIndex += 1
  const file = `${String(shotIndex).padStart(2, '0')}-${name}.png`
  // The overlay of the tour (caption card, spotlight, cursor, progress line) is
  // hidden for the still: the picture of the product stays clean.
  await page.evaluate(() => {
    const root = document.getElementById('__fx-root')
    if (root) root.style.display = 'none'
  })
  await page.screenshot({ path: `${SHOT_DIR}/${file}` })
  await page.evaluate(() => {
    const root = document.getElementById('__fx-root')
    if (root) root.style.display = ''
  })
  manifest.push({
    file,
    name,
    url: page.url(),
    caption: currentCaption,
    focus: focusBox,
    spot: spotBox,
  })
  // Every beat carries its own framing: the next still starts fresh.
  focusBox = null
  spotBox = null
  console.log(`   ▣ ${file} · ${currentCaption}`)
}

/** Move the pointer over an element and click it, the way a person would. */
async function click(locator, { timeout = 15000 } = {}) {
  const target = locator.first()
  await target.waitFor({ state: 'visible', timeout })
  await target.hover()
  await wait(240)
  // The box of the element the person pressed: the camera of the film may
  // focus on it. The sidebar is not interesting for the camera.
  const box = await target.boundingBox()
  if (box && box.x > 290) focusBox = box
  await target.click()
}

/** Takes the caption off the screen: the next screen brings its own line. */
async function clearCaption() {
  currentCaption = ''
  // Nothing to read on this screen: the next line comes right away.
  captionFreeAt = 0
}

/**
 * Opens a page — and tries again when the mock is briefly restarting.
 */
async function goto(url, opts = {}) {
  const nav = page.goto.bind(page)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await nav(url, { waitUntil: 'networkidle', ...opts })
      await clearCaption()
      return
    } catch (err) {
      console.log(`   ! ${url} did not open (attempt ${attempt})`)
      if (attempt === 3) throw err
      await wait(3000)
    }
  }
}

/**
 * Opens a page that may be down. When it is, the capture goes on without it:
 * a missing console costs two shots, not the whole film.
 */
async function gotoSoft(url, opts = {}) {
  try {
    await goto(url, opts)
    return true
  } catch {
    console.log(`   ! ${url} is down — skipping this step`)
    return false
  }
}

/** A field of the panel form, found by its label. */
function field(label) {
  return page
    .locator('label.field')
    .filter({
      has: page.locator(`xpath=.//span[@class="field-label" and starts-with(normalize-space(.), "${label}")]`),
    })
    .first()
}

/** Types into a field, clearing whatever was there. */
async function fill(label, text, delay = 28) {
  const input = field(label).locator('input, textarea').first()
  await input.waitFor({ state: 'visible', timeout: 10000 })
  const type = await input.getAttribute('type')
  if (type === 'number' || type === 'date') {
    // A number field falls back to its default the moment it empties; a date field
    // only accepts the value as a whole.
    await input.fill(text)
  } else {
    await input.click()
    await input.press('ControlOrMeta+a')
    await input.press('Backspace')
    await wait(180)
    if (text) await input.pressSequentially(text, { delay })
  }
  await wait(320)
}

/** Click a sidebar entry by its label. */
async function nav(label, captionText, ms = 2000) {
  await click(page.locator('.nav-item', { hasText: label }))
  if (captionText) await caption(captionText)
  else await clearCaption()
  await page.waitForLoadState('networkidle').catch(() => {})
  await wait(ms)
}

/** Picks the customer in the form's "Cliente" picker (its popover lives in the body). */
async function pickCustomer(name) {
  await click(page.locator('.picker-trigger[aria-label="Cliente"]').first())
  await wait(1200)
  const option = page.locator('.picker-option', { hasText: name }).first()
  await option.waitFor({ state: 'visible', timeout: 12000 })
  await option.hover()
  await wait(320)
  await option.click()
  await wait(1000)
}

/**
 * Click a tab by its label. The match is exact: "Webhooks" is not "Logs de
 * Webhooks", and picking the wrong one would take the film to another screen.
 */
async function tab(label, captionText, ms = 2000) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const exact = page.locator('.tab').filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`) })
  const target = (await exact.count()) ? exact.first() : page.locator('.tab', { hasText: label }).first()
  await click(target)
  if (captionText) await caption(captionText)
  else await clearCaption()
  await page.waitForLoadState('networkidle').catch(() => {})
  await wait(ms)
}

/**
 * Scrolls the detail panel of the logs so a line of the payload is on screen:
 * the viewer has to SEE the status that arrived, not just the name of the event.
 *
 * `index` picks the body: 0 is the first (the webhook payload, or the request
 * of the application), 1 is the second (the answer of the mock).
 */
async function revealPayload(needle, index = 0) {
  const found = await page.evaluate(
    ([n, idx]) => {
      const card = document.querySelectorAll('.logs-layout > .card')[1]
      const pres = [...document.querySelectorAll('pre.payload')]
      const pre = pres[idx]
      if (!pre) return false
      if (idx === 0) {
        // The detail card starts at the top of the screen: the viewer reads the
        // event, the answer of the application AND the payload, in one frame.
        if (card) {
          card.scrollIntoView({ block: 'start' })
          const main = document.querySelector('main')
          if (main) main.scrollBy({ top: -46 })
          else window.scrollBy({ top: -46 })
        }
      } else {
        // The second body (the answer of the mock) lives below the fold.
        pre.scrollIntoView({ block: 'center' })
      }
      if (!n) return true
      // The JSON is one text node: the needle is a character offset inside it.
      const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT)
      let node
      while ((node = walker.nextNode())) {
        const text = node.textContent || ''
        const at = text.indexOf(n)
        if (at < 0) continue
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + 1)
        const rect = range.getBoundingClientRect()
        pre.scrollTop += rect.top - pre.getBoundingClientRect().top - 80
        return true
      }
      return false
    },
    [needle, index],
  )
  if (!found) console.log(`   ! not in the payload: ${needle}`)
  await wait(1000)
}

/**
 * Opens a log of the webhook deliveries and shows what arrived: the event, the
 * answer of the application and the payload — the charge that failed, the one
 * that is overdue.
 */
async function openWebhookLog(event, captionText, needle) {
  const item = page.locator('button.log-item').filter({ hasText: event }).first()
  if (!(await item.count())) {
    console.log(`   ! no webhook log for: ${event}`)
    return false
  }
  await click(item)
  await wait(1100)
  if (needle) await revealPayload(needle)
  if (captionText) await caption(captionText)
  return true
}

/**
 * Opens a call of the application in the request log (Logs de Requisições), with
 * both bodies.
 * The method matters: the list has a GET of the same path, and the film is
 * about the POST the application made.
 */
async function openRequestLog(method, path, captionText, needle, index = 0) {
  const item = page
    .locator('button.log-item')
    .filter({ hasText: new RegExp(`${method}\\s*${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })
    .first()
  if (!(await item.count())) {
    console.log(`   ! no request found: ${method} ${path}`)
    return false
  }
  await click(item)
  await wait(1100)
  if (needle) await revealPayload(needle, index)
  if (captionText) await caption(captionText)
  return true
}

/**
 * Advances the simulator's clock: clicks the button, waits for the REAL response
 * of the advance (the signal, not a guessed time) and shows the clock overlay
 * following the date the simulator is really on.
 */
async function advanceClock(buttonLabel, warpOpts) {
  const button = page.locator('button', { hasText: buttonLabel }).first()
  if (!(await button.count())) {
    console.log(`   ! clock button not found: ${buttonLabel}`)
    return false
  }
  await warpStart(warpOpts)
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/_admin/clock/advance'), { timeout: 180000 }),
    click(button),
  ])
  console.log(`   · ${buttonLabel} done (${response.status()})`)
  // The days of the overlay end on the date the simulator really reached.
  const reached = await clockState()
  await warpSweep(warpOpts.from, daysBetween(warpOpts.from, reached.today), 1500)
  await stopWarp()
  return true
}

async function scrollTo(y) {
  await page.evaluate((top) => {
    const main = document.querySelector('main')
    if (main) main.scrollTo({ top, behavior: 'smooth' })
    window.scrollTo({ top, behavior: 'smooth' })
  }, y)
  await wait(650)
}

async function closeModal() {
  const close = page.locator('.modal-x')
  if (await close.count()) {
    await click(close)
    await wait(900)
  }
}

/**
 * Marks the first element whose text contains every piece given, so the spotlight
 * and the flash can find it later.
 */
async function mark(texts, tag = 'tr') {
  const wanted = Array.isArray(texts) ? texts : [texts]
  return page.evaluate(
    ({ wanted, tag }) => {
      document.querySelectorAll('[data-fx]').forEach((el) => el.removeAttribute('data-fx'))
      const nodes = [...document.querySelectorAll(tag)]
      const el = nodes.find((n) => {
        const text = n.textContent || ''
        return wanted.every((w) => text.includes(w))
      })
      if (!el) return false
      el.setAttribute('data-fx', 'target')
      // The spotlight only works on what the viewer can see.
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return true
    },
    { wanted, tag },
  )
}

/** The spotlight on a row/element found by its text. */
async function spot(texts, label, tag = 'tr') {
  const found = await mark(texts, tag)
  if (!found) {
    console.log(`   ! not found: ${JSON.stringify(texts)}`)
    return false
  }
  await wait(700)
  // The box the film highlights: the tour draws it on the page, the film draws
  // it on the frame, around the same element.
  const box = await page.evaluate(() => {
    const el = document.querySelector('[data-fx="target"]')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
  })
  if (box) {
    spotBox = box
    focusBox = box
  }
  await spotlight('[data-fx="target"]', label)
  return true
}

/** The dates of the story, read from the simulator itself. */
const clockState = async () => {
  try {
    return await (await fetch(`${BASE}/_admin/clock`)).json()
  } catch {
    return null
  }
}
const clock0 = await clockState()
const TODAY = clock0.today
const day = (offset) => {
  const d = new Date(`${TODAY}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}
/** How many days from `from` to `to`. */
const daysBetween = (from, to) => {
  const a = Date.parse(`${from}T12:00:00Z`)
  const b = Date.parse(`${to}T12:00:00Z`)
  return Math.round((b - a) / 86400000)
}
console.log(`   simulator clock: ${clock0.mode} · ${TODAY}`)

// ── ACT 1 · the patient and the charge ────────────────────────────────────────
log('Opening the panel')
await goto(`${BASE}/#home`, { waitUntil: 'networkidle' })
await wait(2600)
await act('MOCK DO ASAAS', 'O dinheiro andando de verdade', 2400)
await caption('O painel do mock do Asaas — cada tela é o comportamento real da API')
await progress(0.04)
await scrollTo(240)
await wait(900)
await scrollTo(0)
await wait(600)

log('The patient')
await nav('Meus Clientes', '1 · A paciente entra no sistema', 1800)
await click(page.locator('.page-actions button', { hasText: 'Novo cliente' }))
await wait(1200)
await fill('Nome', 'Helena Duarte Ribeiro', 26)
await fill('E-mail', 'helena.ribeiro@exemplo.com', 20)
await fill('Celular', '47996321234', 22)
await fill('Referência externa', 'CLI-2026-101', 20)
const cpfButton = page.locator('.modal button', { hasText: 'Gerar CPF' })
await click(cpfButton)
await wait(700)
await click(page.locator('.modal button[type="submit"]'))
await wait(2600)
await caption('1 · Cliente criado — a ficha dele abre na hora')
await progress(0.1)
await shot('cliente')

log('The charge')
await click(page.locator('button', { hasText: 'Nova cobrança' }))
await wait(1600)
await caption('2 · A cobrança — e a fatura que o pagador recebe')
await fill('Valor (R$)', '480,00', 30)
await fill('Descrição', 'Avaliação de pele — primeira consulta', 18)
await fill('Referência externa', 'CONS-2026-101', 20)
await scrollTo(180)
await wait(700)
await click(page.locator('.modal button[type="submit"]'))
await wait(3200)
await caption('2 · Cobrança criada — a fatura nasce aqui')
const invoiceHref = await page
  .locator('.modal a.btn.primary', { hasText: 'Abrir fatura' })
  .first()
  .getAttribute('href')
console.log('   fatura:', invoiceHref)
await scrollTo(260)
await wait(800)
await click(page.locator('.modal button', { hasText: 'Concluir' }))
await wait(2000)

log('The payer invoice')
await goto(invoiceHref, { waitUntil: 'networkidle' })
await wait(2400)
await caption('3 · A fatura do pagador — a mesma que chega por e-mail e WhatsApp')
await scrollTo(260)
await wait(900)
await scrollTo(0)
await wait(600)
await shot('fatura')

log('Paying with a card')
await click(page.locator('[data-tab="CREDIT_CARD"]'))
await wait(1100)
const approved = page.locator('#card-form select[name="number"] option', { hasText: 'Aprova' }).first()
if (await approved.count()) {
  await page.locator('#card-form select[name="number"]').selectOption(await approved.getAttribute('value'))
  await wait(700)
}
const holder = page.locator('#card-form input[name="holderName"]')
await holder.click()
await holder.press('ControlOrMeta+a')
await holder.press('Backspace')
await holder.pressSequentially('HELENA DUARTE RIBEIRO', { delay: 22 })
await wait(500)
await caption('3 · Pagamento no cartão — o mesmo caminho de um pagamento real')
await click(page.locator('#card-form button[type="submit"]'))
await wait(3600)
await caption('3 · Pago — o status da cobrança vira Confirmada')
await shot('pago')

log('The charge on the panel')
await goto(`${BASE}/#payments`, { waitUntil: 'networkidle' })
await wait(2600)
await caption('3 · No painel, a cobrança já está confirmada')
await progress(0.18)
const paidRow = page.locator('tbody tr.dt-clickable').first()
if (await paidRow.count()) {
  await click(paidRow)
  await wait(2800)
  await scrollTo(220)
  await wait(800)
  await scrollTo(0)
  await wait(500)
  await closeModal()
}

// ── ACT 2 · recurrence, installments and the card that refuses ─────────────────
log('The subscription')
await act('RECORRÊNCIA', 'Uma cobrança que se repete — e um cartão que recusa', 2300)
await click(page.locator('button', { hasText: 'Nova cobrança' }))
await wait(1500)
await click(page.locator('.modal .tab', { hasText: 'Assinatura' }))
await wait(1100)
await caption('4 · Assinatura — uma cobrança por ciclo')
await pickCustomer('Helena Duarte Ribeiro')
await fill('Valor (R$)', '199,90', 30)
await fill('Descrição', 'Plano Mensal — Manutenção de pele', 18)
// The first due date is tomorrow: the clock act shows it becoming due.
await fill('Primeiro vencimento', day(1), 20)
await click(page.locator('.picker-trigger[aria-label="Termina"]'))
await wait(900)
await click(page.locator('.picker-option', { hasText: 'após N cobranças' }).first())
await wait(700)
await fill('Termina', '6', 40)
await scrollTo(200)
await wait(700)
await click(page.locator('.modal button[type="submit"]'))
await wait(3400)
await caption('4 · Assinatura criada — a primeira fatura já nasceu')
await progress(0.26)
await scrollTo(240)
await wait(900)
await scrollTo(0)
await wait(600)
await click(page.locator('.modal button', { hasText: 'Concluir' }))
await wait(2000)

await tab('Assinaturas', '4 · A assinatura na lista, com o próximo vencimento', 2400)
const planRow = page.locator('tbody tr.dt-clickable').first()
if (await planRow.count()) {
  await click(planRow)
  await wait(2800)
  await scrollTo(220)
  await wait(800)
  await scrollTo(0)
  await wait(500)
  await closeModal()
}

log('The installments')
await click(page.locator('button', { hasText: 'Nova cobrança' }))
await wait(1500)
await click(page.locator('.modal .tab', { hasText: 'Parcelada' }))
await wait(1100)
await caption('5 · Parcelamento — o valor dividido, todas as faturas agora')
await pickCustomer('Helena Duarte Ribeiro')
await fill('Número de parcelas', '3', 40)
await fill('Valor total (R$)', '900,00', 30)
await fill('Descrição', 'Pacote de 3 sessões — peeling químico', 18)
await fill('Vencimento da 1ª parcela', day(15), 20)
await scrollTo(200)
await wait(700)
await click(page.locator('.modal button[type="submit"]'))
await wait(3400)
await caption('5 · Parcelamento criado — 3 faturas de R$ 300,00')
await progress(0.32)
await scrollTo(240)
await wait(900)
await scrollTo(0)
await wait(600)
await click(page.locator('.modal button', { hasText: 'Concluir' }))
await wait(2000)

log('The card that refuses')
await nav('Cartões de teste', '6 · Cartões de teste — force o desfecho que o seu código trata', 2400)
await scrollTo(300)
await wait(900)
await scrollTo(0)
await wait(700)
await click(page.locator('button', { hasText: 'Novo cartão' }))
await wait(1400)
await caption('6 · Um cartão que tokeniza, mas recusa quando alguém cobra nele')
// The outcome: "Tokeniza, recusa ao cobrar".
await click(page.locator('.picker-trigger[aria-label="Resultado do cartão"]'))
await wait(900)
await click(page.locator('.picker-option', { hasText: 'Tokeniza, recusa ao cobrar' }).first())
await wait(700)
await fill('Motivo (rótulo)', 'Cartão da paciente — banco recusou', 18)
await scrollTo(220)
await wait(700)
const addCard = page.locator('.inline-form button[type="submit"]')
if (await addCard.count()) {
  await click(addCard)
  await wait(2400)
}
await caption('6 · Cartão cadastrado — ele vive só no simulador, e recusa de verdade')
await progress(0.38)
await scrollTo(300)
await wait(900)
await scrollTo(0)
await wait(600)
await shot('cartao-recusante')

// ── ACT 3 · the channels ───────────────────────────────────────────────────────
log('The channels')
await act('OS CANAIS', 'WhatsApp e e-mail: o pagador fala com a clínica', 2200)
await nav('Integrações', null, 2400)
await tab('WhatsApp', '7 · WhatsApp — o canal do pagador, ligado e respondendo', 2600)
await scrollTo(280)
await wait(900)
await scrollTo(0)
await wait(700)
const sendWa = page.locator('button', { hasText: 'Enviar WhatsApp de teste' })
if (await sendWa.count()) {
  await click(sendWa)
  await wait(2800)
}
await caption('7 · Enviado — e o mock devolve sent, delivered e read')
await wait(3500)
const refresh = page.locator('button', { hasText: 'Atualizar' }).first()
if (await refresh.count()) {
  await click(refresh)
  await wait(2400)
}
await scrollTo(420)
await wait(1000)
await scrollTo(0)
await wait(800)

await tab('E-mail', '8 · E-mail — o mesmo evento, pelo canal de e-mail', 2600)
await scrollTo(280)
await wait(900)
await scrollTo(0)
await wait(700)
const sendMail = page.locator('button', { hasText: 'Enviar e-mail de teste' })
if (await sendMail.count()) {
  await click(sendMail)
  await wait(2800)
}
await caption('8 · Enviado — o e-mail cai no Mailpit')
await wait(2000)
const refresh2 = page.locator('button', { hasText: 'Atualizar' }).first()
if (await refresh2.count()) {
  await click(refresh2)
  await wait(2400)
}
await progress(0.48)
await scrollTo(420)
await wait(1000)
await scrollTo(0)
await wait(800)

log('The WhatsApp console')
await goto(WA_CONSOLE, { waitUntil: 'networkidle' })
await wait(3000)
await caption('9 · A mensagem no WhatsApp do pagador', { position: 'top' })
const threads = page.locator('button.thread')
let thread = threads.filter({ hasText: '99632' }).first()
if (!(await thread.count())) thread = threads.first()
if (await thread.count()) {
  await click(thread)
  const bubble = page.locator('.bubble').first()
  try {
    await bubble.waitFor({ state: 'visible', timeout: 9000 })
  } catch {
    await click(thread)
    await bubble.waitFor({ state: 'visible', timeout: 9000 }).catch(() => {})
  }
  await wait(2600)
}
await scrollTo(260)
await wait(1000)
await scrollTo(0)
await wait(700)
await shot('whatsapp')

log('Mailpit')
await goto(MAILPIT, { waitUntil: 'networkidle' })
await wait(3200)
await caption('10 · O e-mail no Mailpit')
const mail = page.locator('.message, [class*="message"]').first()
if (await mail.count()) {
  await click(mail)
  await wait(2600)
}
await wait(1200)
await progress(0.54)

// ── ACT 4 · the webhook and the new account ────────────────────────────────────
log("The application's webhook")
await goto(`${BASE}/#home`, { waitUntil: 'networkidle' })
await wait(2200)
await nav('Integrações', null, 2600)
await tab('Webhooks', '11 · O destino dos eventos: a sua aplicação', 2600)
await click(page.locator('button', { hasText: 'Adicionar Webhook' }))
await wait(1800)
await fill('Nome do Webhook', 'Eventos da clínica', 24)
await fill('URL do Webhook', `${RECEIVER}/webhook/asaas`, 22)
await wait(600)
const group = page
  .locator('.event-group')
  .filter({ has: page.locator('xpath=.//span[@class="event-group-label" and normalize-space(.)="Cobranças"]') })
if (await group.count()) {
  await click(group.locator('button', { hasText: 'Selecionar todos' }))
  await wait(1200)
}
await caption('12 · Os eventos escolhidos: cada mudança de situação da cobrança')
const hookForm = page.locator('.card').filter({ hasText: 'Nome do Webhook' })
const saveHook = hookForm.locator('button', { hasText: 'Salvar' })
if (await saveHook.count()) {
  await click(saveHook)
  await wait(3200)
}
await caption('13 · Salvo — o mock avisa a sua aplicação, no formato do Asaas')
await scrollTo(300)
await wait(900)
await scrollTo(0)
await wait(800)
await caption('14 · A URL da sua aplicação e os eventos que ela passou a escutar')
await spot(['Eventos da clínica'], 'O destino dos eventos', '.webhook-card')
await shot('webhook-criado')
await progress(0.6)

log('A new account')
await nav('Perfis', '15 · Cada conta é um tenant: chave, carteira e clientes próprios', 2600)
await fill('Nome', 'Clínica Aurora', 26)
await fill('E-mail', 'financeiro@clinica-aurora.local', 20)
await wait(600)
await click(page.locator('button', { hasText: 'Criar perfil' }))
await wait(3200)
await caption('16 · Perfil criado — a chave de API da conta nova, na mão')
await shot('perfil-criado')
const enterProfile = page.locator('button', { hasText: 'Entrar no perfil' })
if (await enterProfile.count()) {
  await click(enterProfile)
  await wait(3400)
  await caption('17 · Entrando na conta nova — vazia, como uma clínica que acabou de abrir')
  await scrollTo(240)
  await wait(900)
  await scrollTo(0)
  await wait(800)
  await shot('conta-nova')
}
await nav('Perfis', null, 2400)
const backToMain = page.locator('tr', { hasText: 'Conta Principal' }).locator('button', { hasText: 'Entrar' })
if (await backToMain.count()) {
  await click(backToMain)
  await wait(2800)
}

// ── ACT 5 · the clock ──────────────────────────────────────────────────────────
log('The virtual clock')
await act('O TEMPO', 'O simulador anda o relógio — e o dinheiro junto', 2500)
await nav('Relógio virtual', '18 · Um tick por dia: vencidos, cartões, assinaturas e webhooks', 2800)
await progress(0.66)
await shot('relogio')

// 18.1 · one day: the subscription's charge becomes due today.
await advanceClock('+1 dia', { from: day(0), days: 1, duration: 2600 })
await caption('19 · Um dia passou — a cobrança da assinatura venceu hoje')
await nav('Cobranças', null, 2600)
await spot(['199,90', day(1)], 'Vence hoje')
await wait(2600)
await shot('cobranca-vence-hoje')

// 18.2 · a week: the charge is overdue and the application hears about it.
await nav('Relógio virtual', null, 2600)
await advanceClock('+7 dias', { from: day(1), days: 7, duration: 7000 })
await caption('20 · Uma semana — a cobrança ficou vencida e o evento saiu')
await nav('Cobranças', null, 2600)
await spot(['199,90', day(1)], 'Vencida')
await flash('[data-fx="target"]', 'bad')
await wait(2800)
await shot('cobranca-vencida')
await nav('Integrações', null, 2400)
await tab('Logs de Webhooks', '21 · PAYMENT_OVERDUE — a entrega do evento na sua aplicação', 3400)
await spot(['PAYMENT_OVERDUE'], 'HTTP 200', 'li')
await shot('log-overdue')
// The detail: what really arrived in the application.
await openWebhookLog(
  'PAYMENT_OVERDUE',
  '22 · PAYMENT_OVERDUE — o que chegou: a cobrança de R$ 199,90 com status OVERDUE',
  '"status": "OVERDUE"',
)
await shot('log-overdue-detalhe')
await progress(0.74)

// 18.3 · 32 days: the card of the first charge credits the balance.
await nav('Relógio virtual', null, 2600)
await advanceClock('+32 dias', { from: day(8), days: 32, duration: 16000 })
await caption('23 · 32 dias — o cartão do D+32 creditou a conta')
await nav('Início', '24 · O saldo: entrou o valor do cartão, menos a taxa', 2800)
await scrollTo(260)
await wait(1200)
await scrollTo(0)
await wait(900)
await shot('saldo')
await nav('Integrações', null, 2400)
await tab('Logs de Webhooks', '25 · PAYMENT_RECEIVED — o dinheiro entrou e o evento foi entregue', 3200)
await spot(['PAYMENT_RECEIVED'], 'HTTP 200', 'li')
await wait(2600)
await shot('log-received')
await progress(0.8)

// ── ACT 6 · the refusal ────────────────────────────────────────────────────────
log('The refusal')
await act('A RECUSA', 'O cartão tokeniza, a assinatura cobra — e o banco recusa', 2500)
await nav('Cartões de teste', '26 · O cartão recusante, pronto para a assinatura', 2600)
await scrollTo(300)
await wait(900)
await scrollTo(0)
await wait(700)
await spot(['Cartão da paciente'], 'Recusa ao cobrar', '.card')
await wait(2600)
await shot('cartao-na-lista')

log('The subscription with the card')
if (await gotoSoft(API_CONSOLE, { waitUntil: 'networkidle' })) {
  await wait(2400)
  await caption('27 · A mesma requisição que a sua aplicação faz — resposta real do mock')
  await progress(0.84)
  await click(page.locator('.cmd', { hasText: 'Assinatura no cartão recusante' }))
  await wait(1400)
  await click(page.locator('#run'))
  await page.waitForFunction(() => document.body.dataset.done === '1', null, { timeout: 40000 })
  await wait(2200)
  await shot('console-assinatura')
}

log('The request log')
// Back to the panel: the call is on the panel's log, not on the console.
await goto(`${BASE}/#home`, { waitUntil: 'networkidle' })
await wait(2200)
await nav('Integrações', null, 2400)
await tab(
  'Logs de Requisições',
  '28 · Logs de Requisições — a chamada da sua aplicação, com o que foi enviado e o que voltou',
  3400,
)
await spot(['POST', '/v3/subscriptions'], 'A chamada real', 'li')
await shot('log-requisicoes')
await openRequestLog(
  'POST',
  '/v3/subscriptions',
  '29 · POST /v3/subscriptions — o que sua aplicação mandou: a recorrência no cartão recusante',
  '"number"',
)
await shot('log-requisicao-pedido')
await revealPayload('"creditCardNumber"', 1)
await caption('30 · E o que o mock devolveu: a assinatura criada, com o cartão já tokenizado')
await shot('log-requisicao-resposta')

log('The subscription on the panel')
await goto(`${BASE}/#payments`, { waitUntil: 'networkidle' })
await wait(2600)
await tab('Assinaturas', '31 · A assinatura recorrente — com o cartão recusante tokenizado', 2600)
const newPlan = page.locator('tbody tr.dt-clickable', { hasText: 'Plano Premium' }).first()
if (await newPlan.count()) {
  await click(newPlan)
  await wait(2800)
  await scrollTo(220)
  await wait(900)
  await scrollTo(0)
  await wait(600)
  await shot('assinatura-cartao')
  await closeModal()
}

log('The saved card')
await nav('Cartões de teste', '32 · O cartão salvo: o banco recusa toda cobrança', 2600)
await scrollTo(420)
await wait(1100)
await scrollTo(0)
await wait(800)
await spot(['Recusa toda cobrança'], 'O banco recusou', 'tr')
await wait(2600)
await shot('cartao-salvo')

log('One month ahead')
if (await gotoSoft(API_CONSOLE, { waitUntil: 'networkidle' })) {
  await wait(2400)
  await click(page.locator('.cmd', { hasText: 'Avançar 30 dias' }))
  await wait(1400)
  await click(page.locator('#run'))
  // The overlay shows the days the simulator really walked, ending on the real date.
  const monthFrom = (await clockState()).today
  await warpStart({ from: monthFrom, days: 30, label: 'Um mês de agenda' })
  await page.waitForFunction(() => document.body.dataset.responded === '1', null, { timeout: 120000 })
  const monthTo = (await clockState()).today
  await warpSweep(monthFrom, daysBetween(monthFrom, monthTo), 1600)
  await stopWarp()
  await page.waitForFunction(() => document.body.dataset.done === '1', null, { timeout: 40000 })
  await wait(2400)
  await shot('console-30-dias')
}

log('The refusal of the bank')
await goto(`${BASE}/#payments`, { waitUntil: 'networkidle' })
await wait(2600)
await nav('Cobranças', null, 2600)
await caption('34 · A cobrança de R$ 349,90 ainda espera — o Asaas tenta de novo no dia seguinte')
await spot(['349,90', 'Aguardando pagamento', day(70)], 'Ainda vai tentar')
await shot('cobranca-aguardando')

// One day: the first three attempts of the card — the bank refuses all of them.
log('The first three attempts')
await nav('Relógio virtual', '35 · Mais um dia: o banco tenta cobrar o cartão — e recusa', 2600)
await advanceClock('+1 dia', { from: day(70), days: 1, duration: 2600 })
await nav('Integrações', null, 2400)
await tab('Logs de Webhooks', '36 · O banco recusou — e cada recusa virou um evento na sua aplicação', 3400)
await spot(['PAYMENT_CREDIT_CARD_CAPTURE_REFUSED'], 'HTTP 200', 'li')
await shot('log-recusa')
// The detail: the refusal that really arrived in the application.
await openWebhookLog(
  'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
  '37 · PAYMENT_CREDIT_CARD_CAPTURE_REFUSED — a recusa que chegou, com a cobrança ainda pendente',
  '"creditCardNumber"',
)
await shot('log-recusa-detalhe')

// One more day: the last three attempts — and then the charge gives up.
log('One more day')
await nav('Relógio virtual', '38 · Mais um dia: as três últimas tentativas — e a cobrança vencida', 2600)
await advanceClock('+1 dia', { from: day(71), days: 1, duration: 2600 })
await nav('Cobranças', null, 2600)
await caption('39 · Sem mais tentativas: a cobrança de R$ 349,90 ficou vencida')
await spot(['349,90', 'Vencida', day(70)], 'Vencida')
await flash('[data-fx="target"]', 'bad')
await wait(2600)
await shot('cobranca-vencida-recusa')

log('The webhooks of the refusal')
await nav('Integrações', null, 2400)
await tab('Logs de Webhooks', '40 · O log completo: seis recusas, cada uma entregue com o 200', 3400)
await spot(['PAYMENT_CREDIT_CARD_CAPTURE_REFUSED'], 'HTTP 200', 'li')
await wait(2200)
await shot('log-recusa-6')
// And the overdue event, with the charge already overdue in the payload.
await openWebhookLog(
  'PAYMENT_OVERDUE',
  '41 · PAYMENT_OVERDUE — a cobrança recusada ficou vencida, e o aviso saiu com o status OVERDUE',
  '"status": "OVERDUE"',
)
await shot('log-overdue-recusa')
await progress(0.94)

// ── the end ────────────────────────────────────────────────────────────────────
log('Back to the present')
await nav('Relógio virtual', null, 2600)
const backNow = page.locator('button', { hasText: 'Voltar ao presente' })
if (await backNow.count()) {
  await click(backNow)
  await waitReal(4500)
}
await caption('42 · De volta ao presente — o tempo real de novo')
await nav('Início', null, 2600)
await scrollTo(240)
await wait(1000)
await scrollTo(0)
await wait(900)
await shot('fim')
await act('MOCK DO ASAAS', 'Venceu, pagou, recusou — e contou tudo', 2600)
await caption('O mock do Asaas: o dinheiro andando de verdade')
await progress(1)
await wait(2400)

await context.close()
await browser.close()

writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`\nmanifest: ${MANIFEST} (${manifest.length} beats)`)

// What the tour really produced, read back from the API.
const key = '$aact_hmlg_demo_video_2026'
const read = async (path) => (await fetch(`${BASE}${path}`, { headers: { access_token: key } })).json()
const inst = (await read('/v3/installments?limit=5')).data ?? []
const subs = (await read('/v3/subscriptions?limit=8')).data ?? []
const pays = (await read('/v3/payments?limit=40')).data ?? []
console.log('\n--- what the capture created ---')
console.log('installments:', inst.map((i) => `${i.installmentCount}x ${i.value} (${i.description})`).join(' | '))
console.log('subscriptions:', subs.map((s) => `${s.value} ${s.cycle} ${s.description} cart=${s.creditCardNumber ?? '-'}`).join(' | '))
console.log('charges     :', pays.map((p) => `${p.value} ${p.status} ${p.dueDate} ${p.description ?? ''}`).join(' | '))
const accounts = await (await fetch(`${BASE}/_admin/accounts`)).json()
console.log('accounts    :', (accounts.accounts ?? []).map((a) => `${a.name} (${a.apiKey ?? 'no key'})`).join(' | '))
const clock = await (await fetch(`${BASE}/_admin/clock`)).json()
console.log('clock       :', clock.mode, clock.now, `drift=${clock.driftDays}`)
const cards = await (await fetch(`${BASE}/_admin/test-cards`)).json()
console.log('cards       :', (cards.cards ?? []).map((c) => `${c.number.slice(-4)} ${c.outcome} ${c.label}`).join(' | '))

console.log('STILLS:', manifest.length, 'em', SHOT_DIR)
if (errors.length) console.log('PAGE ERRORS:', errors.slice(0, 8))
if (failed.length) console.log('FAILED REQUESTS:', [...new Set(failed)].slice(0, 12))
