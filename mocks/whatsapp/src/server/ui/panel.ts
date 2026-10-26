export const panelHtml = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WhatsApp (mock)</title>
<style>
:root { --bg:#f5f5f4; --fg:#1c1917; --card:#fff; --line:#d6d3d1; --muted:#78716c; --out:#dcfce7; --in:#e7e5e4; --accent:#15803d; --err:#b91c1c; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#1c1917; --fg:#f5f5f4; --card:#292524; --line:#44403c; --muted:#a8a29e; --out:#14532d; --in:#44403c; --accent:#4ade80; --err:#f87171; }
}
* { box-sizing:border-box; }
body { margin:0; font:15px/1.4 system-ui,sans-serif; background:var(--bg); color:var(--fg); }
header { padding:12px 16px; border-bottom:1px solid var(--line); display:flex; flex-wrap:wrap; gap:8px 16px; align-items:center; }
header h1 { font-size:18px; margin:0; }
.muted { color:var(--muted); font-size:13px; }
main { display:grid; grid-template-columns:minmax(0,1fr); gap:12px; padding:12px; max-width:1100px; margin:0 auto; }
@media (min-width: 720px) { main { grid-template-columns:300px minmax(0,1fr); } .wide { grid-column:1 / -1; } }
section { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:12px; min-width:0; }
h2 { font-size:15px; margin:0 0 8px; }
ul { list-style:none; margin:0; padding:0; }
li.conv { padding:8px; border-radius:6px; cursor:pointer; overflow-wrap:anywhere; }
li.conv:hover, li.conv.active { background:var(--in); }
.msg { max-width:85%; padding:6px 10px; border-radius:8px; margin:6px 0; overflow-wrap:anywhere; white-space:pre-wrap; }
.msg.sent { background:var(--out); margin-left:auto; }
.msg.received { background:var(--in); }
.msg .meta { display:block; font-size:11px; color:var(--muted); }
label { display:block; margin:6px 0 2px; font-size:13px; }
input { width:100%; padding:8px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--fg); font:inherit; }
button { padding:8px 12px; border:1px solid var(--line); border-radius:6px; background:var(--accent); color:#fff; font:inherit; cursor:pointer; margin:8px 8px 0 0; }
button.secondary { background:transparent; color:var(--fg); }
#result.error { color:var(--err); }
</style>
</head>
<body>
<header>
  <h1>WhatsApp (mock)</h1>
  <span id="health" class="muted">Servidor: verificando…</span>
  <span id="webhook" class="muted"></span>
  <span id="live" class="muted"></span>
</header>
<main>
  <section>
    <h2>Conversas</h2>
    <ul id="conversations"></ul>
    <button id="refresh" class="secondary" type="button">Atualizar</button>
    <button id="clear" class="secondary" type="button">Limpar conversas</button>
  </section>
  <section>
    <h2 id="thread-title">Mensagens</h2>
    <div id="messages"></div>
  </section>
  <section class="wide">
    <h2>Simular mensagem do paciente</h2>
    <label for="business">Número da clínica (phone number id)</label>
    <input id="business" autocomplete="off">
    <label for="contact">Número do paciente</label>
    <input id="contact" autocomplete="off" placeholder="5511999999999">
    <label for="text">Mensagem</label>
    <input id="text" autocomplete="off">
    <button id="send" type="button">Enviar como paciente</button>
    <p id="result" class="muted"></p>
  </section>
</main>
<script>
(function () {
  var state = { messages: [], selected: null, clearTimer: null };
  var $ = function (id) { return document.getElementById(id); };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function norm(n) { return String(n || '').replace(/^\\+/, ''); }

  // A conversation is a business number paired with a contact number.
  function pairOf(m) {
    return m.direction === 'sent'
      ? { business: m.from, contact: m.to }
      : { business: m.to, contact: m.from };
  }

  function keyOf(p) { return norm(p.business) + '|' + norm(p.contact); }

  function groups() {
    var map = {};
    state.messages.forEach(function (m) {
      var p = pairOf(m);
      var k = keyOf(p);
      if (!map[k]) map[k] = { key: k, business: p.business, contact: p.contact, items: [] };
      map[k].items.push(m);
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  function render() {
    var list = $('conversations');
    list.textContent = '';
    var gs = groups();
    if (!gs.length) {
      list.appendChild(el('li', 'muted', 'Nenhuma conversa ainda. Simule uma mensagem abaixo ou envie pela aplicação.'));
    }
    gs.forEach(function (g) {
      var li = el('li', 'conv' + (g.key === state.selected ? ' active' : ''), g.business + ' ↔ ' + g.contact);
      li.addEventListener('click', function () {
        state.selected = g.key;
        $('business').value = norm(g.business);
        $('contact').value = norm(g.contact);
        render();
      });
      list.appendChild(li);
    });
    var box = $('messages');
    box.textContent = '';
    var sel = gs.filter(function (g) { return g.key === state.selected; })[0];
    $('thread-title').textContent = sel ? sel.business + ' ↔ ' + sel.contact : 'Mensagens';
    if (!sel) {
      box.appendChild(el('p', 'muted', 'Selecione uma conversa.'));
      return;
    }
    sel.items.slice().sort(function (a, b) {
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    }).forEach(function (m) {
      var div = el('div', 'msg ' + m.direction, m.text);
      var when = new Date(m.timestamp);
      var meta = isNaN(when.getTime()) ? '' : when.toLocaleString('pt-BR');
      if (m.status) meta += ' · ' + m.status;
      div.appendChild(el('span', 'meta', (m.direction === 'sent' ? 'Aplicação' : 'Paciente') + (meta ? ' · ' + meta : '')));
      box.appendChild(div);
    });
  }

  function load() {
    return fetch('/conversation').then(function (r) { return r.json(); }).then(function (data) {
      state.messages = data.messages || [];
      render();
    }).catch(function () {});
  }

  function loadHeader() {
    fetch('/health').then(function (r) { return r.json(); }).then(function (h) {
      $('health').textContent = h.ok ? 'Servidor: saudável' : 'Servidor: com problema';
    }).catch(function () { $('health').textContent = 'Servidor: fora do ar'; });
    fetch('/mock/config').then(function (r) { return r.json(); }).then(function (c) {
      var urls = [];
      if (c.fallbackUrl) urls.push(c.fallbackUrl);
      (c.mappings || []).forEach(function (m) { urls.push(m.phone + ' → ' + m.url); });
      $('webhook').textContent = urls.length ? 'Webhook: ' + urls.join(', ') : 'nenhum webhook configurado';
      if (!$('business').value && c.mappings && c.mappings.length) $('business').value = norm(c.mappings[0].phone);
    }).catch(function () {});
  }

  function connect() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var ws = new WebSocket(proto + '//' + location.host + '/ws');
    ws.onopen = function () { $('live').textContent = 'Ao vivo'; };
    ws.onmessage = function () { load(); };
    ws.onclose = function () { $('live').textContent = 'Sem atualização automática'; };
  }

  $('refresh').addEventListener('click', function () { load(); loadHeader(); });

  $('clear').addEventListener('click', function () {
    var btn = $('clear');
    if (state.clearTimer === null) {
      btn.textContent = 'Clique de novo para confirmar';
      state.clearTimer = setTimeout(function () {
        btn.textContent = 'Limpar conversas';
        state.clearTimer = null;
      }, 3000);
      return;
    }
    clearTimeout(state.clearTimer);
    state.clearTimer = null;
    btn.textContent = 'Limpar conversas';
    fetch('/conversation', { method: 'DELETE' }).then(function () {
      state.selected = null;
      return load();
    });
  });

  $('send').addEventListener('click', function () {
    var result = $('result');
    var body = {
      from: $('contact').value.trim(),
      to: $('business').value.trim(),
      message: {
        id: 'wamid.panel-' + Date.now(),
        type: 'text',
        timestamp: String(Math.floor(Date.now() / 1000)),
        text: { body: $('text').value }
      }
    };
    fetch('/mock/simulate-message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (data) { return { ok: r.ok, data: data }; });
    }).then(function (res) {
      result.className = res.ok ? 'muted' : 'error';
      result.textContent = res.ok
        ? 'Enviado. Webhook: ' + (res.data.webhookUrl || '')
        : (res.data && res.data.error && res.data.error.message) || 'Erro ao enviar.';
      if (res.ok) { $('text').value = ''; load(); }
    }).catch(function () {
      result.className = 'error';
      result.textContent = 'Falha ao chamar o servidor.';
    });
  });

  loadHeader();
  load();
  connect();
})();
</script>
</body>
</html>
`
