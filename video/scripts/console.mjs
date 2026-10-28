/**
 * The API console of the Asaas mock — the local server the film shows.
 *
 * It is not a simulation: every button runs a real HTTP request against the
 * mock on :45990 and prints the real answer. The server exists to proxy the
 * call (the mock does not enable CORS for another port) and to give the frame
 * the look of a terminal.
 *
 *   GET  /            the console page
 *   POST /api/call    { method, path, body } -> { status, statusText, body }
 */
import { createServer } from 'node:http'

const MOCK = process.env.ASAAS_BASE ?? 'http://127.0.0.1:45990'
const KEY = process.env.ASAAS_API_KEY ?? '$aact_hmlg_demo_video_2026'
const PORT = Number(process.env.API_CONSOLE_PORT ?? 45992)

/** A real call to the mock. */
async function call(method, path, body) {
  const res = await fetch(MOCK + path, {
    method,
    headers: { 'content-type': 'application/json', access_token: KEY },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = text
  }
  return { status: res.status, statusText: res.statusText, body: parsed }
}

const PAGE = /* html */ `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Console da API · Mock do Asaas</title>
<style>
  :root {
    --bg: #070d18; --panel: #0e1729; --panel2: #131e35; --line: #24324d;
    --text: #e8eefc; --muted: #8fa1c4; --green: #3ddc97; --amber: #ffc857; --red: #ff6b81; --blue: #6aa9ff;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    background: radial-gradient(1200px 700px at 20% -10%, #16233d 0%, var(--bg) 55%);
    color: var(--text);
    font: 15px/1.55 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
    padding: 34px 48px 30px;
    display: flex; flex-direction: column;
  }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  header { display: flex; align-items: center; gap: 16px; margin-bottom: 26px; }
  .logo {
    width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center;
    background: linear-gradient(140deg, var(--green), #2aa6ff); color: #06101f; font-weight: 800; font-size: 19px;
  }
  h1 { font-size: 23px; margin: 0; letter-spacing: -0.2px; }
  .sub { color: var(--muted); font-size: 14px; }
  .live { margin-left: auto; display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--green); box-shadow: 0 0 0 0 rgba(61,220,151,.55); animation: pulse 2s infinite; }
  @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(61,220,151,.5); } 70% { box-shadow: 0 0 0 12px rgba(61,220,151,0); } 100% { box-shadow: 0 0 0 0 rgba(61,220,151,0); } }
  .grid { display: grid; grid-template-columns: 330px 1fr; gap: 24px; align-items: stretch; flex: 1; min-height: 0; }
  .card { background: linear-gradient(180deg, var(--panel2), var(--panel)); border: 1px solid var(--line); border-radius: 16px; padding: 18px; }
  .card h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 1.4px; color: var(--muted); margin: 0 0 14px; }
  .cmd {
    display: block; width: 100%; text-align: left; background: #0b1424; border: 1px solid var(--line);
    border-radius: 12px; padding: 13px 14px; margin-bottom: 10px; color: var(--text); cursor: pointer;
    transition: border-color .18s, transform .18s, background .18s;
  }
  .cmd:hover { border-color: #3a4d72; transform: translateY(-1px); }
  .cmd.sel { border-color: var(--green); background: #0c1b26; box-shadow: 0 0 0 1px rgba(61,220,151,.25) inset; }
  .cmd .m { font-size: 11px; font-weight: 700; letter-spacing: 1px; color: var(--green); }
  .cmd .p { font-size: 13px; margin-top: 3px; }
  .cmd .d { font-size: 12px; color: var(--muted); margin-top: 4px; }
  .term { background: #060b14; border: 1px solid var(--line); border-radius: 16px; overflow: hidden; display: flex; flex-direction: column; }
  .bar { display: flex; align-items: center; gap: 8px; padding: 11px 16px; background: #0b1424; border-bottom: 1px solid var(--line); }
  .bar i { width: 11px; height: 11px; border-radius: 50%; display: block; }
  .bar .t { margin-left: 10px; color: var(--muted); font-size: 12.5px; }
  pre { margin: 0; padding: 20px 22px; font: 13.5px/1.62 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; color: #cfe0ff; flex: 1; min-height: 0; overflow: hidden; }
  .status { font-weight: 700; }
  .ok { color: var(--green); } .warn { color: var(--amber); } .err { color: var(--red); }
  .key { color: #b98cff; } .str { color: #9ae6b4; } .num { color: #ffd479; } .bool { color: #ff9ecb; } .lbl { color: #7fb2ff; }
  .go {
    margin-top: 16px; width: 100%; height: 52px; border-radius: 14px; border: 0; cursor: pointer;
    background: linear-gradient(120deg, var(--green), #35b6ff); color: #06101f; font-weight: 800; font-size: 15px;
    box-shadow: 0 10px 26px rgba(53,182,255,.22);
  }
  .go:disabled { opacity: .55; cursor: progress; }
  .foot { margin-top: 16px; color: var(--muted); font-size: 12.5px; }
  .caret { display: inline-block; width: 9px; height: 16px; background: var(--green); vertical-align: -3px; animation: blink 1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
</style>
</head>
<body>
<header>
  <div class="logo">A</div>
  <div>
    <h1>Console da API</h1>
    <div class="sub">A mesma requisição que a sua aplicação faz — resposta real do mock do Asaas</div>
  </div>
  <div class="live"><span class="dot"></span> mock do Asaas · 127.0.0.1:45990</div>
</header>

<div class="grid">
  <div class="card">
    <h2>Requisições</h2>
    <div id="cmds"></div>
    <button class="go" id="run">Executar requisição</button>
    <div class="foot">Cada execução é uma chamada HTTP real: nada aqui é encenado.</div>
  </div>

  <div class="term">
    <div class="bar">
      <i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i>
      <span class="t mono" id="cmdline">console — escolha uma requisição</span>
    </div>
    <pre id="out">Aguardando a primeira requisição…</pre>
  </div>
</div>

<script>
const CUSTOMER_NAME = 'Helena Duarte Ribeiro'
const REFUSING_LABEL = 'Cartão da paciente — banco recusou'
const REFUSING_FALLBACK = '4000000000000341'

const state = { sel: 'subscription' }

const COMMANDS = [
  {
    id: 'subscription',
    method: 'POST',
    path: '/v3/subscriptions',
    title: 'Assinatura no cartão recusante',
    desc: 'Cria a recorrência com o cartão que recusa ao ser cobrado',
    async body() {
      const [customers, clock, cards] = await Promise.all([
        fetch('/api/call', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method: 'GET', path: '/v3/customers?limit=100' }) }).then((r) => r.json()),
        fetch('/api/call', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method: 'GET', path: '/_admin/clock' }) }).then((r) => r.json()),
        fetch('/api/call', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method: 'GET', path: '/_admin/test-cards' }) }).then((r) => r.json()),
      ])
      const list = customers.body?.data ?? []
      const customer = list.find((c) => c.name === CUSTOMER_NAME)
      const today = clock.body?.today
      const due = new Date(today + 'T12:00:00Z')
      due.setUTCDate(due.getUTCDate() + 30)
      const table = cards.body?.cards ?? []
      const card = table.find((c) => c.label === REFUSING_LABEL) ?? table.find((c) => c.number === REFUSING_FALLBACK)
      return {
        customer: customer?.id,
        billingType: 'CREDIT_CARD',
        value: 349.9,
        description: 'Plano Premium — recorrência no cartão',
        cycle: 'MONTHLY',
        nextDueDate: due.toISOString().slice(0, 10),
        creditCard: {
          number: card?.number,
          holderName: 'HELENA DUARTE RIBEIRO',
          expiryMonth: '12',
          expiryYear: '2030',
          ccv: '123',
        },
        remoteIp: '127.0.0.1',
      }
    },
  },
  {
    id: 'advance30',
    method: 'POST',
    path: '/_admin/clock/advance',
    title: 'Avançar 30 dias',
    desc: 'Um tick completo por dia: o simulador roda a agenda inteira',
    body: async () => ({ days: 30 }),
    format: (body) => {
      const reports = body?.reports ?? []
      const transitions = reports.flatMap((r) => r.transitions ?? [])
      const delivered = reports.flatMap((r) => r.webhooks?.delivered ?? [])
      return {
        agora: body?.now,
        diasSimulados: reports.length,
        transicoes: transitions.length,
        webhooksEntregues: delivered.length,
        ultimasTransicoes: transitions.slice(-6),
        ultimosEventos: delivered.slice(-8).map((d) => d.event ?? d),
      }
    },
  },
  {
    id: 'advance1',
    method: 'POST',
    path: '/_admin/clock/advance',
    title: 'Avançar 1 dia',
    desc: 'Mais um dia de agenda — é onde a retentativa do cartão acontece',
    body: async () => ({ days: 1 }),
    format: (body) => {
      const reports = body?.reports ?? []
      const transitions = reports.flatMap((r) => r.transitions ?? [])
      const delivered = reports.flatMap((r) => r.webhooks?.delivered ?? [])
      return {
        agora: body?.now,
        diasSimulados: reports.length,
        transicoes: transitions.length,
        webhooksEntregues: delivered.length,
        transicoesDoDia: transitions,
        eventosDoDia: delivered.map((d) => d.event ?? d),
      }
    },
  },
]

const el = (id) => document.getElementById(id)

function esc(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
}

function colorJson(value) {
  const raw = JSON.stringify(value, null, 2) ?? 'null'
  return esc(raw)
    .replace(/&quot;([^&]*?)&quot;(\\s*:)/g, '<span class="key">"$1"</span>$2')
    .replace(/^(\\s*)&quot;([^&]*?)&quot;/gm, '$1<span class="str">"$2"</span>')
    .replace(/: (-?\\d+(?:\\.\\d+)?)/g, ': <span class="num">$1</span>')
    .replace(/: (true|false|null)/g, ': <span class="bool">$1</span>')
}

function renderCommands() {
  el('cmds').innerHTML = COMMANDS.map((c) => \`
    <button class="cmd \${c.id === state.sel ? 'sel' : ''}" data-id="\${c.id}">
      <div class="m mono">\${c.method}</div>
      <div class="p">\${c.title}</div>
      <div class="d">\${c.desc}</div>
    </button>\`).join('')
  for (const b of document.querySelectorAll('.cmd')) {
    b.addEventListener('click', () => { state.sel = b.dataset.id; renderCommands(); preview() })
  }
}

const BS = String.fromCharCode(92)

async function preview() {
  const cmd = COMMANDS.find((c) => c.id === state.sel)
  el('cmdline').textContent = \`\${cmd.method} \${cmd.path}\`
  const body = await cmd.body()
  const curl = [
    '$ curl -X ' + cmd.method + " 'http://127.0.0.1:45990" + cmd.path + "' " + BS,
    "  -H 'access_token: \$aact_hmlg_demo_video_2026' " + BS,
    "  -H 'content-type: application/json' " + BS,
    "  -d '" + JSON.stringify(body) + "'",
  ].join('\\n')
  el('out').textContent = curl
}

async function typeOut(html, done) {
  const out = el('out')
  const plain = html.replace(/<[^>]+>/g, '')
  out.innerHTML = ''
  const chunk = Math.max(2, Math.round(plain.length / 90))
  for (let i = 0; i < plain.length; i += chunk) {
    out.textContent = plain.slice(0, i + chunk)
    await new Promise((r) => setTimeout(r, 18))
  }
  out.innerHTML = html + '<span class="caret"></span>'
  if (done) done()
}

el('run').addEventListener('click', async () => {
  const cmd = COMMANDS.find((c) => c.id === state.sel)
  const button = el('run')
  button.disabled = true
  button.textContent = 'Executando…'
  document.body.dataset.done = ''
  document.body.dataset.responded = ''
  const body = await cmd.body()
  const started = performance.now()
  const res = await fetch('/api/call', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: cmd.method, path: cmd.path, body }),
  }).then((r) => r.json())

  const ms = Math.round(performance.now() - started)
  const ok = res.status >= 200 && res.status < 300
  const head = \`HTTP \${res.status} \${res.statusText} · \${ms} ms\`
  const payload = colorJson(cmd.format ? cmd.format(res.body) : res.body)
  document.body.dataset.responded = '1'
  await typeOut(\`<span class="status \${ok ? 'ok' : 'err'}">\${esc(head)}</span>\\n\\n\${payload}\`)
  document.body.dataset.done = '1'
  button.disabled = false
  button.textContent = 'Executar requisição'
  document.body.dataset.done = '1'
})

renderCommands()
preview()
</script>
</body>
</html>`

const server = createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(PAGE)
    return
  }
  if (req.method === 'POST' && req.url === '/api/call') {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      try {
        const { method = 'GET', path, body } = JSON.parse(raw || '{}')
        const out = await call(method, path, body)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(out))
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: String(err) }))
      }
    })
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('not found')
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`api console on http://localhost:${PORT}`)
})
