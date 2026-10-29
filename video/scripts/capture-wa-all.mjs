import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const WA_BASE = process.env.WHATSAPP_BASE ?? 'http://localhost:3010'
const WA_OUT = resolve(ROOT, 'mocks/whatsapp/docs/img')

mkdirSync(WA_OUT, { recursive: true })

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
})
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1.5,
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
  permissions: ['microphone']
})

const page = await context.newPage()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

console.log('Navigating to WhatsApp mock...')
await page.goto(`${WA_BASE}/`, { waitUntil: 'networkidle' })
await wait(1200)

// Helper to open/close tools drawer
const openTools = async () => {
  await page.evaluate(() => {
    const app = document.getElementById('app')
    if (!app.classList.contains('with-tools')) {
      document.getElementById('toggle-tools').click()
    }
  })
  await wait(400)
}

const closeTools = async () => {
  await page.evaluate(() => {
    const app = document.getElementById('app')
    if (app.classList.contains('with-tools')) {
      document.getElementById('toggle-tools').click()
    }
  })
  await wait(400)
}

// 1. CHAT - Select Joana Prado thread
console.log('1. Capturing chat.jpg...')
await closeTools()
const jpThread = page.locator('#threads button.thread').filter({ hasText: 'Joana Prado' })
if (await jpThread.count()) {
  await jpThread.click()
  await wait(600)
}
await page.screenshot({ path: resolve(WA_OUT, 'chat.jpg'), quality: 90 })
console.log('   ✓ chat.jpg')

// 2. CALL - Voice Call screen
console.log('2. Capturing chat-call.jpg...')
const callBtn = page.locator('#call-btn')
if (await callBtn.isVisible()) {
  await callBtn.click()
  await wait(800)
  await page.screenshot({ path: resolve(WA_OUT, 'chat-call.jpg'), quality: 90 })
  console.log('   ✓ chat-call.jpg')
  // End call cleanly via reload
  await page.goto(`${WA_BASE}/`, { waitUntil: 'networkidle' })
  await wait(800)
}

// 3. VOICE MESSAGE & QUICK REPLIES - Select Maria Souza
console.log('3. Capturing chat-voice.jpg...')
const msThread = page.locator('#threads button.thread').filter({ hasText: 'Maria Souza' })
if (await msThread.count()) {
  await msThread.click()
  await wait(600)
  await page.screenshot({ path: resolve(WA_OUT, 'chat-voice.jpg'), quality: 90 })
  console.log('   ✓ chat-voice.jpg')
}

// 4. NEW CONVERSATION MODAL
console.log('4. Capturing chat-new.jpg...')
const newChatBtn = page.locator('#new-chat')
if (await newChatBtn.count()) {
  await newChatBtn.click()
  await wait(400)
  await page.locator('#nd-contact').fill('5511977778888')
  await page.locator('#nd-name').fill('Carlos Eduardo Silva')
  await page.locator('#nd-text').fill('Olá, gostaria de confirmar o horário da minha consulta amanhã às 14h.')
  await wait(300)
  await page.screenshot({ path: resolve(WA_OUT, 'chat-new.jpg'), quality: 90 })
  console.log('   ✓ chat-new.jpg')
  await page.locator('#nd-cancel').click()
  await wait(300)
}

// 5. MESSAGE STATUS CONTEXT MENU
console.log('5. Capturing chat-menu.jpg...')
if (await jpThread.count()) {
  await jpThread.click()
  await wait(500)
  await page.evaluate(() => {
    const bubble = document.querySelector('.row.out .bubble')
    if (bubble) {
      const btn = bubble.querySelector('.msg-menu')
      if (btn) btn.click()
    }
  })
  await wait(400)
  await page.screenshot({ path: resolve(WA_OUT, 'chat-menu.jpg'), quality: 90 })
  console.log('   ✓ chat-menu.jpg')
  // Dismiss menu
  await page.evaluate(() => {
    const menu = document.getElementById('menu')
    if (menu) menu.removeAttribute('data-open')
  })
  await wait(200)
}

// 6. INTERACTIVE PERMISSIONS / CALL LOG - Rafael Lima
console.log('6. Capturing chat-rafael.jpg...')
const rlThread = page.locator('#threads button.thread').filter({ hasText: 'Rafael Lima' })
if (await rlThread.count()) {
  await rlThread.click()
  await wait(600)
  await page.screenshot({ path: resolve(WA_OUT, 'chat-rafael.jpg'), quality: 90 })
  console.log('   ✓ chat-rafael.jpg')
}

// 7. TOOLS - DELIVERY TAB
console.log('7. Capturing tools-delivery.jpg...')
await openTools()
await page.locator('#tab-delivery').click()
await wait(400)
await page.screenshot({ path: resolve(WA_OUT, 'tools-delivery.jpg'), quality: 90 })
console.log('   ✓ tools-delivery.jpg')

// 8. TOOLS - WEBHOOK TAB
console.log('8. Capturing tools-webhooks.jpg...')
await page.locator('#tab-webhook').click()
await wait(500)
await page.screenshot({ path: resolve(WA_OUT, 'tools-webhooks.jpg'), quality: 90 })
console.log('   ✓ tools-webhooks.jpg')

// 9. TOOLS - EVENTS TAB
console.log('9. Capturing tools-events.jpg...')
await page.locator('#tab-events').click()
await wait(500)
await page.screenshot({ path: resolve(WA_OUT, 'tools-events.jpg'), quality: 90 })
console.log('   ✓ tools-events.jpg')

// 10. TOOLS - EVENT DETAIL (EXPANDED PAYLOAD)
console.log('10. Capturing tools-event-detail.jpg...')
await page.evaluate(() => {
  const firstEvBtn = document.querySelector('#events li.event button')
  if (firstEvBtn) firstEvBtn.click()
})
await wait(400)
await page.screenshot({ path: resolve(WA_OUT, 'tools-event-detail.jpg'), quality: 90 })
console.log('   ✓ tools-event-detail.jpg')

// 11. TOOLS - TEMPLATES TAB
console.log('11. Capturing tools-templates.jpg...')
await page.locator('#tab-templates').click()
await wait(600)
await page.screenshot({ path: resolve(WA_OUT, 'tools-templates.jpg'), quality: 90 })
console.log('   ✓ tools-templates.jpg')

// 12. TOOLS - TEMPLATE EDITOR & PHONE PREVIEW
console.log('12. Capturing tools-template-editor.jpg...')
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('#tpl-list button'))
  const target = btns.find(b => b.innerText.includes('asaas_cobranca_criada')) || btns[0]
  if (target) target.click()
})
await wait(600)
await page.screenshot({ path: resolve(WA_OUT, 'tools-template-editor.jpg'), quality: 90 })
console.log('   ✓ tools-template-editor.jpg')

// 13. TOOLS - TEMPLATE CAROUSEL
console.log('13. Capturing tools-template-carousel.jpg...')
await page.evaluate(() => {
  const check = document.getElementById('tpl-carousel')
  if (check && !check.checked) {
    check.checked = true
    check.dispatchEvent(new Event('change', { bubbles: true }))
  }
})
await wait(500)
await page.screenshot({ path: resolve(WA_OUT, 'tools-template-carousel.jpg'), quality: 90 })
console.log('   ✓ tools-template-carousel.jpg')

// 14. TOOLS - NUMBERS TAB
console.log('14. Capturing tools-numbers.jpg...')
await page.locator('#tab-numbers').click()
await wait(500)
await page.screenshot({ path: resolve(WA_OUT, 'tools-numbers.jpg'), quality: 90 })
console.log('   ✓ tools-numbers.jpg')

// 15. TOOLS - API TAB
console.log('15. Capturing tools-api.jpg...')
await page.locator('#tab-api').click()
await wait(700)
await page.screenshot({ path: resolve(WA_OUT, 'tools-api.jpg'), quality: 90 })
console.log('   ✓ tools-api.jpg')

await browser.close()
console.log('\nAll 15 WhatsApp screenshots captured successfully!')
