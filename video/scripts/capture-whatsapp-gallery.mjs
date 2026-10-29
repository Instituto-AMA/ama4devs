import { chromium } from 'playwright'
import { mkdirSync, copyFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const WA_BASE = process.env.WHATSAPP_BASE ?? 'http://localhost:3010'
const WA_OUT = resolve(ROOT, 'mocks/whatsapp/docs/img')

mkdirSync(WA_OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1.5,
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
})

const page = await context.newPage()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

console.log('Navigating to WhatsApp mock...')
await page.goto(`${WA_BASE}/`, { waitUntil: 'networkidle' })
await wait(1200)

// Helper to close tools and popups
const closeTools = async () => {
  await page.evaluate(() => {
    const app = document.getElementById('app')
    if (app && app.classList.contains('with-tools')) {
      document.getElementById('toggle-tools').click()
    }
    const callBox = document.getElementById('call')
    if (callBox) callBox.hidden = true
    const newDlg = document.getElementById('new-dialog')
    if (newDlg && newDlg.open) newDlg.close()
    const menu = document.getElementById('menu')
    if (menu) menu.removeAttribute('data-open')
  })
  await wait(300)
}

// Helper to open tools
const openTools = async () => {
  await page.evaluate(() => {
    const app = document.getElementById('app')
    if (app && !app.classList.contains('with-tools')) {
      document.getElementById('toggle-tools').click()
    }
    const callBox = document.getElementById('call')
    if (callBox) callBox.hidden = true
    const newDlg = document.getElementById('new-dialog')
    if (newDlg && newDlg.open) newDlg.close()
  })
  await wait(400)
}

// 1. CHAT (Joana Prado with billing templates and delivery ticks - Light Mode)
console.log('1. Capturing chat.jpg...')
await page.emulateMedia({ colorScheme: 'light' })
await closeTools()
const jpThread = page.locator('#threads button.thread').filter({ hasText: 'Joana Prado' })
if (await jpThread.count()) await jpThread.first().click()
await wait(500)
await page.screenshot({ path: resolve(WA_OUT, 'chat.jpg'), quality: 90 })
console.log('   ✓ chat.jpg')

// 2. VOICE CALL (WebRTC calling screen with dark background, caller avatar, ringing animation, buttons)
console.log('2. Capturing chat-call.jpg...')
await page.evaluate(() => {
  const callBox = document.getElementById('call')
  callBox.hidden = false
  callBox.classList.add('ringing')
  document.getElementById('call-avatar').textContent = 'JP'
  document.getElementById('call-avatar').style.background = '#00a884'
  document.getElementById('call-name').textContent = 'Joana Prado'
  document.getElementById('call-state').textContent = 'Chamando… (00:15)'
  document.getElementById('call-role').textContent = 'Ligação de voz via WebRTC'

  const actions = document.getElementById('call-actions')
  actions.innerHTML = `
    <button type="button" class="call-btn"><span class="circle"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M4 4l16 16"/></svg></span><span>Mudo</span></button>
    <button type="button" class="call-btn end"><span class="circle"><svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z"/></svg></span><span>Encerrar</span></button>
  `
})
await wait(500)
await page.screenshot({ path: resolve(WA_OUT, 'chat-call.jpg'), quality: 90 })
console.log('   ✓ chat-call.jpg')
await page.evaluate(() => { document.getElementById('call').hidden = true })
await wait(300)

// 3. TEMPLATE BUILDER & SMARTPHONE PREVIEW (Editor with variables and live phone simulation - Light)
console.log('3. Capturing tools-template-editor.jpg...')
await openTools()
await page.evaluate(() => document.getElementById('tab-templates').click())
await wait(400)
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('#tpl-list button'))
  const target = btns.find(b => b.innerText.includes('asaas_cobranca_criada')) || btns[0]
  if (target) target.click()
})
await wait(600)
await page.screenshot({ path: resolve(WA_OUT, 'tools-template-editor.jpg'), quality: 90 })
console.log('   ✓ tools-template-editor.jpg')

// 4. DARK THEME WHATSAPP WEB (Complete UI in Dark Mode with Maria Souza Audio Messages)
console.log('4. Capturing chat-dark.jpg...')
await closeTools()
await page.emulateMedia({ colorScheme: 'dark' })
await wait(400)
const msThread = page.locator('#threads button.thread').filter({ hasText: 'Maria Souza' })
if (await msThread.count()) await msThread.first().click()
await wait(500)
await page.screenshot({ path: resolve(WA_OUT, 'chat-dark.jpg'), quality: 90 })
console.log('   ✓ chat-dark.jpg')

// Revert to light scheme for next light screens
await page.emulateMedia({ colorScheme: 'light' })
await wait(300)

// 5. WEBHOOK EVENTS QUEUE (Event deliveries list with 200 OK badges)
console.log('5. Capturing tools-events.jpg...')
await openTools()
await page.evaluate(() => document.getElementById('tab-events').click())
await wait(500)
await page.screenshot({ path: resolve(WA_OUT, 'tools-events.jpg'), quality: 90 })
console.log('   ✓ tools-events.jpg')

// 6. NEW CONVERSATION MODAL (Simulated user message form modal)
console.log('6. Capturing chat-new.jpg...')
await closeTools()
await page.locator('#new-chat').click()
await wait(400)
await page.locator('#nd-contact').fill('5511977778888')
await page.locator('#nd-name').fill('Carlos Eduardo Silva')
await page.locator('#nd-text').fill('Olá! Gostaria de confirmar meu agendamento de consulta para amanhã às 14h.')
await wait(300)
await page.screenshot({ path: resolve(WA_OUT, 'chat-new.jpg'), quality: 90 })
console.log('   ✓ chat-new.jpg')
await page.locator('#nd-cancel').click()
await wait(300)

// 7. CLOUD API REFERENCE EXPLORER (Meta Graph API v23.0 spec with cURL snippets)
console.log('7. Capturing tools-api.jpg...')
await openTools()
await page.evaluate(() => document.getElementById('tab-api').click())
await wait(700)
await page.screenshot({ path: resolve(WA_OUT, 'tools-api.jpg'), quality: 90 })
console.log('   ✓ tools-api.jpg')

// 8. MARKETING CAROUSEL CARDS PHONE PREVIEW (Vitrine Carousel Template in Dark Mode Tools)
console.log('8. Capturing tools-template-carousel.jpg...')
await page.emulateMedia({ colorScheme: 'dark' })
await page.evaluate(() => document.getElementById('tab-templates').click())
await wait(400)
await page.evaluate(() => {
  const d = document.querySelector('details.tpl-examples')
  if (d) d.open = true
})
await wait(300)
const vitrineBtn = page.locator('#tpl-list button').filter({ hasText: 'vitrine' })
if (await vitrineBtn.count()) await vitrineBtn.first().click()
await wait(700)
await page.screenshot({ path: resolve(WA_OUT, 'tools-template-carousel.jpg'), quality: 90 })
console.log('   ✓ tools-template-carousel.jpg')

// 9. WEBHOOK CONFIGURATION (Destination URLs, HMAC token, and skip verification knob)
console.log('9. Capturing tools-webhooks.jpg...')
await page.emulateMedia({ colorScheme: 'light' })
await wait(300)
await page.evaluate(() => {
  document.getElementById('tab-webhook').click()
  document.getElementById('wh-url').value = 'http://localhost:8080/hooks/whatsapp'
  document.getElementById('wh-token').value = 'my_secure_verify_token_2026'
})
await wait(500)
await page.screenshot({ path: resolve(WA_OUT, 'tools-webhooks.jpg'), quality: 90 })
console.log('   ✓ tools-webhooks.jpg')

// 10. CLOUD API EVENT JSON PAYLOAD IN DARK MODE (Expanded event showing formatted JSON payload)
console.log('10. Capturing tools-event-detail.jpg...')
await page.emulateMedia({ colorScheme: 'dark' })
await wait(300)
await page.evaluate(() => document.getElementById('tab-events').click())
await wait(400)
await page.evaluate(() => {
  const firstEvBtn = document.querySelector('#events li.event button')
  if (firstEvBtn) firstEvBtn.click()
})
await wait(500)
await page.screenshot({ path: resolve(WA_OUT, 'tools-event-detail.jpg'), quality: 90 })
console.log('   ✓ tools-event-detail.jpg')

// 11. PHONE NUMBERS & WABAS (Meta business accounts, phone IDs, and quality rating)
console.log('11. Capturing tools-numbers.jpg...')
await page.emulateMedia({ colorScheme: 'light' })
await wait(300)
await page.evaluate(() => document.getElementById('tab-numbers').click())
await wait(500)
await page.screenshot({ path: resolve(WA_OUT, 'tools-numbers.jpg'), quality: 90 })
console.log('   ✓ tools-numbers.jpg')

// 12. DELIVERY ENGINE MODE (Automatic vs Manual status advancement and data wipe)
console.log('12. Capturing tools-delivery.jpg...')
await page.emulateMedia({ colorScheme: 'dark' })
await wait(300)
await page.evaluate(() => document.getElementById('tab-delivery').click())
await wait(400)
await page.screenshot({ path: resolve(WA_OUT, 'tools-delivery.jpg'), quality: 90 })
console.log('   ✓ tools-delivery.jpg')

// 13. TEMPLATES CATALOG WITH EXAMPLES (Full library of 20 templates with categories)
console.log('13. Capturing tools-templates.jpg...')
await page.emulateMedia({ colorScheme: 'light' })
await wait(300)
await page.evaluate(() => {
  document.getElementById('tab-templates').click()
  const d = document.querySelector('details.tpl-examples')
  if (d) d.open = true
  const pane = document.getElementById('pane-templates')
  if (pane) pane.scrollTop = 120
})
await wait(600)
await page.screenshot({ path: resolve(WA_OUT, 'tools-templates.jpg'), quality: 90 })
console.log('   ✓ tools-templates.jpg')

// 14. CHAT WITH ACTIVE FILTER & SEARCH (Filter "Não lidas" active with badge counts)
console.log('14. Capturing chat-filter.jpg...')
await closeTools()
await page.emulateMedia({ colorScheme: 'light' })
await wait(400)
await page.evaluate(() => {
  const unreadBtn = Array.from(document.querySelectorAll('.filter')).find(f => f.innerText.includes('Não lidas'))
  if (unreadBtn) unreadBtn.click()
  const searchInput = document.getElementById('search')
  if (searchInput) {
    searchInput.value = 'Maria'
    searchInput.dispatchEvent(new Event('input', { bubbles: true }))
  }
})
await wait(500)
await page.screenshot({ path: resolve(WA_OUT, 'chat-filter.jpg'), quality: 90 })
console.log('   ✓ chat-filter.jpg')

// 15. LOCATION TEMPLATE WITH MAP (Interactive Map Preview inside Smartphone)
console.log('15. Capturing tools-template-map.jpg...')
await openTools()
await page.evaluate(() => document.getElementById('tab-templates').click())
await wait(400)
await page.evaluate(() => {
  const d = document.querySelector('details.tpl-examples')
  if (d) d.open = true
})
await wait(300)
const mapBtn = page.locator('#tpl-list button').filter({ hasText: 'como_chegar' })
if (await mapBtn.count()) await mapBtn.first().click()
await wait(400)
await page.evaluate(() => {
  const lightBtn = document.querySelector('#tpl-phone-theme button[data-theme="light"]')
  if (lightBtn) lightBtn.click()
})
await wait(600)
await page.screenshot({ path: resolve(WA_OUT, 'tools-template-map.jpg'), quality: 90 })
console.log('   ✓ tools-template-map.jpg')

// Legacy alias files for READMEs and existing references
console.log('Copying legacy aliases...')
copyFileSync(resolve(WA_OUT, 'tools-templates.jpg'), resolve(WA_OUT, 'templates.jpg'))
copyFileSync(resolve(WA_OUT, 'tools-numbers.jpg'), resolve(WA_OUT, 'numbers.jpg'))
copyFileSync(resolve(WA_OUT, 'tools-api.jpg'), resolve(WA_OUT, 'api.jpg'))
copyFileSync(resolve(WA_OUT, 'tools-events.jpg'), resolve(WA_OUT, 'events.jpg'))
copyFileSync(resolve(WA_OUT, 'tools-webhooks.jpg'), resolve(WA_OUT, 'webhooks.jpg'))
copyFileSync(resolve(WA_OUT, 'chat-dark.jpg'), resolve(WA_OUT, 'chat-buttons.jpg'))

await browser.close()
console.log('\nAll 15 screenshots successfully captured!')
