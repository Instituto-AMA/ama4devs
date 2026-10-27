/**
 * The web console of the WhatsApp mock (GET /): a WhatsApp-Web-like view of
 * every conversation between the clinic's numbers (the app under test) and
 * patients, with the controls a developer needs: reply as the patient, move a
 * message to delivered / read / failed, switch the delivery mode, point the
 * webhook, and read every webhook attempt with its HTTP result.
 *
 * One self-contained page: no external host, no build step. The client script
 * avoids template literals, backslash escapes and the dollar-brace sequence,
 * because this whole page lives inside a TypeScript template literal.
 */
export const panelHtml = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WhatsApp Business · mock</title>
<style>
:root {
  --app: #f0f2f5;
  --panel: #ffffff;
  --panel-2: #f0f2f5;
  --hover: #f5f6f6;
  --active: #f0f2f5;
  --line: #e9edef;
  --ink: #111b21;
  --ink-2: #54656f;
  --ink-3: #667781;
  --green: #008069;
  --green-ink: #ffffff;
  --green-soft: #d9fdd3;
  --badge: #25d366;
  --wall: #efeae2;
  --wall-dot: rgba(17, 27, 33, 0.045);
  --bubble-in: #ffffff;
  --bubble-out: #d9fdd3;
  --tick: #8696a0;
  --tick-read: #53bdeb;
  --danger: #ea0038;
  --chip: #ffffff;
  --shadow: 0 1px 0.5px rgba(11, 20, 26, 0.13);
  --focus: #008069;
}
@media (prefers-color-scheme: dark) {
  :root {
    --app: #0c1317;
    --panel: #111b21;
    --panel-2: #202c33;
    --hover: #202c33;
    --active: #2a3942;
    --line: #222d34;
    --ink: #e9edef;
    --ink-2: #aebac1;
    --ink-3: #8696a0;
    --green: #00a884;
    --green-ink: #111b21;
    --green-soft: #005c4b;
    --badge: #00a884;
    --wall: #0b141a;
    --wall-dot: rgba(233, 237, 239, 0.035);
    --bubble-in: #202c33;
    --bubble-out: #005c4b;
    --tick: #8696a0;
    --tick-read: #53bdeb;
    --danger: #f15c6d;
    --chip: #202c33;
    --shadow: 0 1px 0.5px rgba(11, 20, 26, 0.5);
    --focus: #00a884;
  }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { height: 100%; }
body {
  margin: 0;
  background: var(--app);
  color: var(--ink);
  font: 14.2px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
button, input, select, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 6px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.app {
  display: grid;
  grid-template-columns: minmax(300px, 400px) minmax(0, 1fr);
  height: 100vh;
  max-width: 1700px;
  margin: 0 auto;
  background: var(--panel);
  box-shadow: 0 6px 18px rgba(11, 20, 26, 0.05);
}
.app.with-tools { grid-template-columns: minmax(300px, 400px) minmax(0, 1fr) 360px; }

/* ---------- left: chats ---------- */
.side { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--line); background: var(--panel); }
.bar {
  height: 60px; flex: none; display: flex; align-items: center; gap: 10px;
  padding: 0 16px; background: var(--panel-2);
}
.brand { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
.brand-mark { width: 40px; height: 40px; border-radius: 50%; background: var(--green); color: #fff; display: grid; place-items: center; flex: none; }
.brand-name { font-size: 16px; font-weight: 600; line-height: 1.15; }
.brand-sub { font-size: 12.5px; color: var(--ink-3); display: flex; align-items: center; gap: 6px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ink-3); display: inline-block; }
.dot.on { background: var(--badge); }
.dot.off { background: var(--danger); }
.icon-btn {
  width: 40px; height: 40px; border-radius: 50%; border: 0; background: transparent;
  color: var(--ink-2); display: grid; place-items: center; flex: none;
}
.icon-btn:hover { background: rgba(11, 20, 26, 0.06); }
.icon-btn[aria-pressed="true"] { background: rgba(0, 128, 105, 0.12); color: var(--green); }
.icon-btn svg { width: 22px; height: 22px; }

.number { padding: 8px 12px 0; display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-3); }
.number select {
  flex: 1; min-width: 0; border: 0; background: var(--panel-2); border-radius: 8px; padding: 7px 10px;
}
.search { padding: 8px 12px; }
.search input {
  width: 100%; border: 0; border-radius: 8px; background: var(--panel-2); padding: 8px 12px 8px 36px;
  background-image: radial-gradient(circle at 18px 50%, transparent 0, transparent 0);
}
.search-wrap { position: relative; }
.search-wrap svg { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); width: 18px; height: 18px; color: var(--ink-3); pointer-events: none; }
.filters { display: flex; gap: 8px; padding: 0 12px 8px; }
.filter {
  border: 0; border-radius: 16px; padding: 5px 12px; background: var(--panel-2); color: var(--ink-2); font-size: 13.5px;
}
.filter[aria-pressed="true"] { background: var(--green-soft); color: var(--green); font-weight: 600; }
@media (prefers-color-scheme: dark) { .filter[aria-pressed="true"] { color: #d9fdd3; } }

.threads { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; min-height: 0; }
.thread {
  display: grid; grid-template-columns: 49px minmax(0, 1fr) auto; gap: 0 14px; align-items: center;
  padding: 0 14px; height: 72px; cursor: pointer; border: 0; background: transparent; width: 100%; text-align: left;
}
.thread:hover { background: var(--hover); }
.thread[aria-current="true"] { background: var(--active); }
.thread .body { border-bottom: 1px solid var(--line); height: 72px; display: flex; flex-direction: column; justify-content: center; min-width: 0; }
.thread .meta { border-bottom: 1px solid var(--line); height: 72px; display: flex; flex-direction: column; justify-content: center; align-items: flex-end; gap: 4px; }
.thread .title { font-size: 16.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.thread .preview { font-size: 14px; color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 3px; }
.thread .time { font-size: 12px; color: var(--ink-3); }
.thread.unread .time { color: var(--badge); }
.unread-badge { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: var(--badge); color: #fff; font-size: 12px; font-weight: 600; display: grid; place-items: center; }
@media (prefers-color-scheme: dark) { .unread-badge { color: #111b21; } }
.avatar {
  width: 49px; height: 49px; border-radius: 50%; display: grid; place-items: center;
  font-weight: 600; font-size: 17px; color: #fff; flex: none;
}
.side-empty { padding: 32px 24px; color: var(--ink-3); text-align: center; font-size: 14px; }
.side-empty button { margin-top: 12px; }

/* ---------- center: conversation ---------- */
.chat { display: flex; flex-direction: column; min-height: 0; min-width: 0; background: var(--wall); position: relative; }
.chat::before {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background-image:
    radial-gradient(var(--wall-dot) 1.2px, transparent 1.3px),
    radial-gradient(var(--wall-dot) 1.2px, transparent 1.3px);
  background-size: 26px 26px, 26px 26px;
  background-position: 0 0, 13px 13px;
}
.chat > * { position: relative; }
.chat-head { height: 60px; flex: none; display: flex; align-items: center; gap: 14px; padding: 0 16px; background: var(--panel-2); border-left: 1px solid var(--line); }
.chat-head .avatar { width: 40px; height: 40px; font-size: 15px; }
.chat-head .who { flex: 1; min-width: 0; }
.chat-head .who b { display: block; font-weight: 500; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chat-head .who span { display: block; font-size: 13px; color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chat-head .who span.typing { color: var(--green); }
.back { display: none; }

.stream { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 7% 8px; display: flex; flex-direction: column; gap: 2px; }
.day { align-self: center; margin: 12px 0 8px; padding: 5px 12px; border-radius: 8px; background: var(--chip); color: var(--ink-2); font-size: 12.5px; box-shadow: var(--shadow); text-transform: uppercase; letter-spacing: 0.02em; }
.notice { align-self: center; margin: 6px 0 10px; max-width: 560px; padding: 6px 12px; border-radius: 8px; background: #ffeecd; color: #54656f; font-size: 12.5px; text-align: center; box-shadow: var(--shadow); }
@media (prefers-color-scheme: dark) { .notice { background: #182229; color: #ffd279; } }

.row { display: flex; margin: 1px 0; }
.row.out { justify-content: flex-end; }
.row.gap { margin-top: 10px; }
.bubble {
  position: relative; max-width: min(65%, 560px); padding: 6px 7px 8px 9px; border-radius: 7.5px;
  background: var(--bubble-in); box-shadow: var(--shadow); font-size: 14.2px; overflow-wrap: anywhere; white-space: pre-wrap;
}
.row.out .bubble { background: var(--bubble-out); }
.row.tail.in .bubble { border-top-left-radius: 0; }
.row.tail.out .bubble { border-top-right-radius: 0; }
.row.tail.in .bubble::before, .row.tail.out .bubble::before {
  content: ""; position: absolute; top: 0; width: 8px; height: 13px; background: inherit;
}
.row.tail.in .bubble::before { left: -8px; clip-path: polygon(100% 0, 0 0, 100% 100%); }
.row.tail.out .bubble::before { right: -8px; clip-path: polygon(0 0, 100% 0, 0 100%); }
.stamp { float: right; margin: 6px 0 -4px 12px; font-size: 11px; color: var(--ink-3); display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; }
.tick { width: 16px; height: 11px; color: var(--tick); }
.tick.read { color: var(--tick-read); }
.tick.failed { color: var(--danger); width: 14px; height: 14px; }
.sender-name { display: block; font-size: 12.8px; font-weight: 500; color: var(--green); margin-bottom: 2px; }

.tpl-head { display: block; font-weight: 700; margin-bottom: 4px; }
.tpl-foot { display: block; margin-top: 4px; color: var(--ink-3); font-size: 13px; }
.tpl-buttons { margin: 6px -7px -8px -9px; border-top: 1px solid rgba(11, 20, 26, 0.08); }
.tpl-buttons div { padding: 9px; text-align: center; color: #027eb5; font-size: 14px; border-top: 1px solid rgba(11, 20, 26, 0.08); }
.tpl-buttons div:first-child { border-top: 0; }
@media (prefers-color-scheme: dark) { .tpl-buttons div { color: #53bdeb; } .tpl-buttons, .tpl-buttons div { border-color: rgba(233, 237, 239, 0.08); } }
.tpl-tag { display: inline-block; font-size: 11px; color: var(--ink-3); margin-bottom: 4px; }

.msg-menu {
  position: absolute; top: 2px; right: 2px; width: 24px; height: 22px; border: 0; border-radius: 6px;
  background: linear-gradient(to left, var(--bubble-out) 60%, transparent); color: var(--ink-3);
  display: none; place-items: center;
}
.row.out .bubble:hover .msg-menu, .row.out .bubble:focus-within .msg-menu { display: grid; }
.menu {
  position: fixed; z-index: 20; min-width: 220px; padding: 8px 0; border-radius: 6px; background: var(--panel);
  box-shadow: 0 2px 5px rgba(11, 20, 26, 0.26), 0 2px 10px rgba(11, 20, 26, 0.16); display: none;
}
.menu[data-open="true"] { display: block; }
.menu button { display: block; width: 100%; text-align: left; border: 0; background: transparent; padding: 10px 24px; font-size: 14.5px; color: var(--ink); }
.menu button:hover { background: var(--hover); }
.menu button.danger { color: var(--danger); }
.menu .menu-title { padding: 4px 24px 8px; font-size: 12.5px; color: var(--ink-3); }

.typing-row .bubble { color: var(--ink-3); font-style: italic; }

.compose { flex: none; padding: 6px 16px 10px; background: var(--panel-2); border-left: 1px solid var(--line); }
.quick { display: flex; gap: 6px; overflow-x: auto; padding: 4px 0 8px; }
.quick button { flex: none; border: 1px solid var(--line); background: var(--panel); border-radius: 16px; padding: 4px 12px; font-size: 13px; color: var(--ink-2); }
.quick button:hover { border-color: var(--green); color: var(--green); }
.compose-line { display: flex; align-items: flex-end; gap: 8px; }
.compose textarea {
  flex: 1; resize: none; border: 0; border-radius: 8px; background: var(--panel); padding: 10px 12px;
  max-height: 140px; min-height: 42px; line-height: 1.4;
}
.send { width: 42px; height: 42px; border-radius: 50%; border: 0; background: var(--green); color: #fff; display: grid; place-items: center; flex: none; }
.send:disabled { opacity: 0.45; cursor: default; }
.send svg { width: 22px; height: 22px; }
.compose-hint { font-size: 12px; color: var(--ink-3); padding: 4px 2px 0; }
.compose-hint.warn { color: #b26b00; }
@media (prefers-color-scheme: dark) { .compose-hint.warn { color: #ffd279; } }

.welcome { flex: 1; display: grid; place-items: center; text-align: center; padding: 32px; background: var(--panel-2); border-left: 1px solid var(--line); }
.welcome h1 { font-size: 30px; font-weight: 300; margin: 18px 0 10px; color: var(--ink); }
.welcome p { margin: 0 auto 6px; max-width: 470px; color: var(--ink-3); font-size: 14px; }
.welcome .art { width: 120px; height: 120px; border-radius: 50%; background: var(--green-soft); display: grid; place-items: center; margin: 0 auto; color: var(--green); }
.welcome .art svg { width: 56px; height: 56px; }
.welcome .actions { margin-top: 22px; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }

.btn { border: 0; border-radius: 20px; padding: 9px 20px; background: var(--green); color: var(--green-ink); font-weight: 500; }
.btn.ghost { background: transparent; color: var(--green); box-shadow: inset 0 0 0 1px var(--line); }
.btn.danger { background: transparent; color: var(--danger); box-shadow: inset 0 0 0 1px var(--line); }
.btn:disabled { opacity: 0.5; cursor: default; }

/* ---------- right: tools ---------- */
.tools { display: none; flex-direction: column; min-height: 0; border-left: 1px solid var(--line); background: var(--panel); }
.app.with-tools .tools { display: flex; }
.tools .bar { gap: 16px; }
.tools .bar h2 { flex: 1; margin: 0; font-size: 16px; font-weight: 500; }
.tabs { display: flex; border-bottom: 1px solid var(--line); flex: none; }
.tab { flex: 1; border: 0; background: transparent; padding: 12px 2px; color: var(--ink-3); font-size: 13px; border-bottom: 3px solid transparent; }
.tab[aria-selected="true"] { color: var(--green); border-bottom-color: var(--green); font-weight: 600; }
.pane { overflow-y: auto; flex: 1; min-height: 0; padding: 16px; }
.pane[hidden] { display: none; }
.pane h3 { font-size: 14px; font-weight: 600; margin: 0 0 6px; }
.pane p.help { margin: 0 0 14px; color: var(--ink-3); font-size: 13px; }
.field { display: block; margin-bottom: 12px; }
.field span { display: block; font-size: 13px; color: var(--green); margin-bottom: 4px; }
.field input, .field textarea, .field select {
  width: 100%; border: 0; border-bottom: 2px solid var(--line); background: transparent; padding: 6px 0;
}
.field input:focus, .field textarea:focus { outline: none; border-bottom-color: var(--green); }
.seg { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border-radius: 10px; background: var(--panel-2); padding: 3px; margin-bottom: 10px; }
.seg button { border: 0; border-radius: 8px; background: transparent; padding: 8px; color: var(--ink-2); }
.seg button[aria-pressed="true"] { background: var(--panel); color: var(--ink); font-weight: 600; box-shadow: var(--shadow); }
.kv { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 12px; font-size: 13px; margin: 0 0 16px; }
.kv dt { color: var(--ink-3); }
.kv dd { margin: 0; overflow-wrap: anywhere; }
.pill { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 2px 9px; border-radius: 10px; background: var(--panel-2); color: var(--ink-2); }
.pill.ok { background: var(--green-soft); color: var(--green); }
.pill.bad { background: rgba(234, 0, 56, 0.1); color: var(--danger); }
@media (prefers-color-scheme: dark) { .pill.ok { color: #d9fdd3; } }
.events { list-style: none; margin: 0; padding: 0; }
.event { border-bottom: 1px solid var(--line); }
.event > button { width: 100%; border: 0; background: transparent; padding: 10px 0; text-align: left; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; }
.event .ev-kind { font-weight: 500; }
.event .ev-url, .event .ev-time { font-size: 12px; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.event pre { margin: 0 0 10px; padding: 10px; border-radius: 8px; background: var(--panel-2); font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-x: auto; max-height: 320px; }
.tpl-card { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; }
.tpl-card b { font-weight: 600; }
.tpl-card small { color: var(--ink-3); }
.tpl-card p { margin: 6px 0 0; font-size: 13px; color: var(--ink-2); white-space: pre-wrap; }
.danger-zone { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); }

/* ---------- dialog / toast ---------- */
dialog { border: 0; border-radius: 12px; padding: 0; width: min(440px, 92vw); background: var(--panel); color: var(--ink); box-shadow: 0 17px 50px rgba(11, 20, 26, 0.19); }
dialog::backdrop { background: rgba(11, 20, 26, 0.45); }
dialog form { padding: 22px 24px 18px; }
dialog h2 { margin: 0 0 4px; font-size: 18px; font-weight: 500; }
dialog p.help { margin: 0 0 16px; color: var(--ink-3); font-size: 13px; }
dialog .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 30;
  background: #3b4a54; color: #fff; padding: 10px 18px; border-radius: 8px; font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.25);
  opacity: 0; pointer-events: none; transition: opacity 0.2s;
}
.toast[data-show="true"] { opacity: 1; }
.toast.err { background: #b3002a; }

@media (max-width: 1180px) {
  .app.with-tools { grid-template-columns: minmax(280px, 360px) minmax(0, 1fr); }
  .app.with-tools .tools { position: fixed; right: 0; top: 0; bottom: 0; width: min(380px, 100vw); z-index: 15; box-shadow: -6px 0 20px rgba(11, 20, 26, 0.18); }
}
@media (max-width: 760px) {
  .app, .app.with-tools { grid-template-columns: minmax(0, 1fr); }
  .app.in-chat .side { display: none; }
  .app:not(.in-chat) .chat { display: none; }
  .back { display: grid; }
  .stream { padding: 12px 10px 6px; }
  .bubble { max-width: 85%; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; scroll-behavior: auto !important; } }
</style>
</head>
<body>
<div class="app" id="app">
  <aside class="side" aria-label="Conversas">
    <div class="bar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3a.5.5 0 0 0 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.3c0-.1-.2-.2-.4-.3Z"/></svg>
        </div>
        <div>
          <div class="brand-name">WhatsApp Business</div>
          <div class="brand-sub"><span class="dot" id="live-dot"></span><span id="live-text">conectando…</span></div>
        </div>
      </div>
      <button class="icon-btn" id="new-chat" type="button" aria-label="Nova conversa como paciente" title="Nova conversa">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 20l1.3-3.9A8 8 0 1 1 8.6 19L4 20Z"/><path d="M12 8.5v7M8.5 12h7"/></svg>
      </button>
      <button class="icon-btn" id="toggle-tools" type="button" aria-label="Painel de controle" aria-pressed="false" title="Painel de controle">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>
      </button>
    </div>
    <label class="number"><span>Número da clínica</span>
      <select id="business"><option value="">Todos os números</option></select>
    </label>
    <div class="search">
      <div class="search-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg>
        <input id="search" type="search" placeholder="Pesquisar por nome ou número" aria-label="Pesquisar conversas">
      </div>
    </div>
    <div class="filters" role="group" aria-label="Filtro">
      <button class="filter" type="button" data-filter="all" aria-pressed="true">Tudo</button>
      <button class="filter" type="button" data-filter="unread" aria-pressed="false">Não lidas</button>
      <button class="filter" type="button" data-filter="awaiting" aria-pressed="false">Sem resposta da clínica</button>
    </div>
    <ul class="threads" id="threads"></ul>
  </aside>

  <main class="chat" id="chat">
    <section class="welcome" id="welcome">
      <div>
        <div class="art" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 20l1.3-3.9A8 8 0 1 1 8.6 19L4 20Z"/><path d="M9 10h6M9 13.5h4"/></svg>
        </div>
        <h1>Conversas do mock</h1>
        <p>As mensagens que a aplicação envia pela API do WhatsApp aparecem aqui, com os tiques de entrega e leitura.</p>
        <p>Para testar a entrada, fale como paciente: a mensagem chega à aplicação pelo webhook.</p>
        <div class="actions">
          <button class="btn" type="button" id="welcome-new">Nova conversa como paciente</button>
          <button class="btn ghost" type="button" id="welcome-tools">Abrir painel de controle</button>
        </div>
      </div>
    </section>
    <header class="chat-head" id="chat-head" hidden>
      <button class="icon-btn back" id="back" type="button" aria-label="Voltar para as conversas">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg>
      </button>
      <div class="avatar" id="head-avatar" aria-hidden="true"></div>
      <div class="who"><b id="head-name"></b><span id="head-sub"></span></div>
      <button class="icon-btn" id="read-all" type="button" aria-label="Marcar todas as mensagens da clínica como lidas" title="Marcar tudo como lido">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 13l4 4 8-9"/><path d="M10 15l2 2 8-9"/></svg>
      </button>
    </header>
    <div class="stream" id="stream" hidden aria-live="polite"></div>
    <form class="compose" id="compose" hidden>
      <div class="quick" id="quick" aria-label="Respostas rápidas do paciente"></div>
      <div class="compose-line">
        <label class="sr" for="reply">Responder como paciente</label>
        <textarea id="reply" rows="1" placeholder="Responder como paciente"></textarea>
        <button class="send" id="send" type="submit" aria-label="Enviar como paciente" disabled>
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z"/></svg>
        </button>
      </div>
      <div class="compose-hint" id="compose-hint">Enter envia · Shift+Enter quebra a linha</div>
    </form>
  </main>

  <aside class="tools" id="tools" aria-label="Painel de controle">
    <div class="bar">
      <h2>Painel de controle</h2>
      <button class="icon-btn" id="close-tools" type="button" aria-label="Fechar painel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
    </div>
    <div class="tabs" role="tablist">
      <button class="tab" role="tab" type="button" id="tab-delivery" aria-controls="pane-delivery" aria-selected="true">Entrega</button>
      <button class="tab" role="tab" type="button" id="tab-webhook" aria-controls="pane-webhook" aria-selected="false">Webhook</button>
      <button class="tab" role="tab" type="button" id="tab-events" aria-controls="pane-events" aria-selected="false">Eventos</button>
      <button class="tab" role="tab" type="button" id="tab-templates" aria-controls="pane-templates" aria-selected="false">Templates</button>
    </div>
    <section class="pane" id="pane-delivery" role="tabpanel" aria-labelledby="tab-delivery">
      <h3>Como as mensagens da clínica avançam</h3>
      <p class="help">Automática: cada mensagem enviada vira entregue e lida em poucos segundos, como um paciente atento. Manual: ela fica como enviada até você marcar entregue, lida ou falha no menu da mensagem.</p>
      <div class="seg" role="group" aria-label="Modo de entrega">
        <button type="button" data-mode="auto" aria-pressed="false">Automática</button>
        <button type="button" data-mode="manual" aria-pressed="false">Manual</button>
      </div>
      <dl class="kv" id="server-kv"></dl>
      <div class="danger-zone">
        <h3>Começar do zero</h3>
        <p class="help">Apaga todas as conversas e o histórico de eventos deste mock. A aplicação não é avisada.</p>
        <button class="btn danger" type="button" id="clear-all">Apagar todas as conversas</button>
      </div>
    </section>
    <section class="pane" id="pane-webhook" role="tabpanel" aria-labelledby="tab-webhook" hidden>
      <h3>Para onde vão os eventos</h3>
      <p class="help">O mock chama este endereço com cada mensagem do paciente e cada mudança de status, no formato da Cloud API. Endereços em localhost chegam à sua máquina mesmo com o mock em container.</p>
      <dl class="kv" id="webhook-kv"></dl>
      <form id="webhook-form">
        <label class="field"><span>Número da clínica (phone number id)</span><input id="wh-phone" required autocomplete="off"></label>
        <label class="field"><span>Endereço do webhook</span><input id="wh-url" required placeholder="localhost:8080/hooks/meta" autocomplete="off"></label>
        <button class="btn" type="submit">Salvar webhook</button>
      </form>
    </section>
    <section class="pane" id="pane-events" role="tabpanel" aria-labelledby="tab-events" hidden>
      <h3>Chamadas ao webhook</h3>
      <p class="help">Cada tentativa de entrega, com a resposta da aplicação. Toque para ver o corpo enviado.</p>
      <ul class="events" id="events"></ul>
    </section>
    <section class="pane" id="pane-templates" role="tabpanel" aria-labelledby="tab-templates" hidden>
      <h3>Templates conhecidos</h3>
      <p class="help">Os templates que a aplicação pode enviar. Um template fora desta lista é recusado como na Cloud API.</p>
      <div id="templates"></div>
    </section>
  </aside>
</div>

<div class="menu" id="menu" role="menu" aria-label="Status da mensagem">
  <div class="menu-title">Simular o lado do paciente</div>
  <button type="button" role="menuitem" data-status="delivered">Marcar como entregue</button>
  <button type="button" role="menuitem" data-status="read">Marcar como lida</button>
  <button type="button" role="menuitem" data-status="failed" class="danger">Marcar como não entregue</button>
</div>

<dialog id="new-dialog">
  <form method="dialog" id="new-form">
    <h2>Nova conversa como paciente</h2>
    <p class="help">A mensagem entra como se o paciente tivesse escrito para a clínica e segue para o webhook.</p>
    <label class="field"><span>Número da clínica (phone number id)</span><input id="nd-business" required autocomplete="off"></label>
    <label class="field"><span>Número do paciente</span><input id="nd-contact" required inputmode="tel" placeholder="5511999999999" autocomplete="off"></label>
    <label class="field"><span>Nome do paciente (opcional)</span><input id="nd-name" autocomplete="off" placeholder="Maria Souza"></label>
    <label class="field"><span>Mensagem</span><textarea id="nd-text" rows="2" required placeholder="Oi, quero marcar uma consulta"></textarea></label>
    <div class="actions">
      <button class="btn ghost" type="button" id="nd-cancel">Cancelar</button>
      <button class="btn" type="submit" id="nd-send">Enviar como paciente</button>
    </div>
  </form>
</dialog>

<div class="toast" id="toast" role="status" aria-live="polite"></div>

<script>
(function () {
  'use strict';

  var QUICK = ['Sim, confirmo', 'Quero remarcar', 'Qual o valor?', 'Já paguei', 'Obrigado!'];
  var AVATAR_COLORS = ['#00a884', '#027eb5', '#a5b337', '#d3396d', '#fa6533', '#7f66ff', '#06cf9c', '#ff9b0f'];
  var SEEN_KEY = 'whatsapp-mock-seen';

  var state = {
    messages: [],
    config: null,
    mode: 'auto',
    events: [],
    templates: [],
    selected: null,
    business: '',
    filter: 'all',
    query: '',
    typing: {},
    seen: readSeen(),
    menuFor: null,
    healthy: null,
    live: false
  };

  function el(id) { return document.getElementById(id); }
  function readSeen() {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch (e) { return {}; }
  }
  function writeSeen() {
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(state.seen)); } catch (e) { /* private window */ }
  }
  function digits(s) {
    var out = '';
    var str = String(s || '');
    for (var i = 0; i < str.length; i++) { var ch = str.charAt(i); if (ch >= '0' && ch <= '9') out += ch; }
    return out;
  }
  function formatPhone(raw) {
    var d = digits(raw);
    if (d.length === 13 && d.indexOf('55') === 0) return '+55 ' + d.slice(2, 4) + ' ' + d.slice(4, 9) + '-' + d.slice(9);
    if (d.length === 12 && d.indexOf('55') === 0) return '+55 ' + d.slice(2, 4) + ' ' + d.slice(4, 8) + '-' + d.slice(8);
    return d ? '+' + d : String(raw || '');
  }
  function keyOf(m) { return m.businessId + '|' + m.contact; }
  function colorFor(key) {
    var h = 0;
    for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 997;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }
  function initials(name, contact) {
    if (name) {
      var parts = name.trim().split(' ').filter(Boolean);
      return ((parts[0] || '').charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
    }
    return digits(contact).slice(-2) || '?';
  }
  function time(iso) {
    var d = new Date(iso);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function dayKey(iso) { var d = new Date(iso); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
  function dayLabel(iso) {
    var d = new Date(iso);
    var today = new Date();
    var yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    if (dayKey(d) === dayKey(today)) return 'Hoje';
    if (dayKey(d) === dayKey(yesterday)) return 'Ontem';
    return d.toLocaleDateString('pt-BR');
  }
  function listTime(iso) {
    var d = new Date(iso);
    var today = new Date();
    if (dayKey(d) === dayKey(today)) return time(iso);
    var yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    if (dayKey(d) === dayKey(yesterday)) return 'Ontem';
    return d.toLocaleDateString('pt-BR');
  }
  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function svg(markup, cls) {
    var span = document.createElement('span');
    span.innerHTML = markup;
    var s = span.firstChild;
    if (cls) s.setAttribute('class', cls);
    return s;
  }
  var TICK_ONE = '<svg viewBox="0 0 16 11" fill="currentColor" aria-hidden="true"><path d="M11.1.6a.5.5 0 0 1 .1.7L5.4 9.6a.5.5 0 0 1-.8.1L1.3 6.6a.5.5 0 1 1 .7-.7l2.9 2.7L10.4.7a.5.5 0 0 1 .7-.1Z"/></svg>';
  var TICK_TWO = '<svg viewBox="0 0 16 11" fill="currentColor" aria-hidden="true"><path d="M11.1.6a.5.5 0 0 1 .1.7L5.4 9.6a.5.5 0 0 1-.8.1L1.3 6.6a.5.5 0 1 1 .7-.7l2.9 2.7L10.4.7a.5.5 0 0 1 .7-.1Z"/><path d="M15.1.6a.5.5 0 0 1 .1.7L9.4 9.6a.5.5 0 0 1-.8.1l-.9-.8.7-.8.5.5L14.4.7a.5.5 0 0 1 .7-.1Z"/></svg>';
  var CLOCK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.3 1.4"/></svg>';
  var FAILED = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="8" cy="8" r="7"/><rect x="7.2" y="3.8" width="1.6" height="5.4" rx=".8" fill="#fff"/><rect x="7.2" y="10.6" width="1.6" height="1.6" rx=".8" fill="#fff"/></svg>';
  var CHEVRON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 10l5 5 5-5"/></svg>';

  function statusIcon(status) {
    if (status === 'read') return svg(TICK_TWO, 'tick read');
    if (status === 'delivered') return svg(TICK_TWO, 'tick');
    if (status === 'failed') return svg(FAILED, 'tick failed');
    if (status === 'sent') return svg(TICK_ONE, 'tick');
    return svg(CLOCK, 'tick');
  }
  var STATUS_TEXT = { sent: 'enviada', delivered: 'entregue', read: 'lida', failed: 'não entregue' };

  function toast(text, isError) {
    var t = el('toast');
    t.textContent = text;
    t.className = isError ? 'toast err' : 'toast';
    t.setAttribute('data-show', 'true');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.setAttribute('data-show', 'false'); }, 3200);
  }

  function api(path, options) {
    var opts = options || {};
    var init = { method: opts.method || 'GET', headers: {} };
    if (opts.body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch(path, init).then(function (r) {
      return r.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!r.ok) {
          var message = (data && data.error && data.error.message) || ('HTTP ' + r.status);
          throw new Error(message);
        }
        return data;
      });
    });
  }

  /* ---------- threads ---------- */
  function threads() {
    var map = {};
    state.messages.forEach(function (m) {
      if (state.business && m.businessId !== state.business) return;
      var k = keyOf(m);
      var t = map[k] || (map[k] = { key: k, businessId: m.businessId, contact: m.contact, name: null, last: null, messages: [] });
      if (m.contactName) t.name = m.contactName;
      t.messages.push(m);
      t.last = m;
    });
    var list = Object.keys(map).map(function (k) {
      var t = map[k];
      var seenAt = state.seen[k] || '';
      t.unread = t.messages.filter(function (m) { return m.direction === 'in' && m.timestamp > seenAt; }).length;
      return t;
    });
    var q = state.query.trim().toLowerCase();
    if (q) {
      var qd = digits(q);
      list = list.filter(function (t) {
        return (t.name || '').toLowerCase().indexOf(q) >= 0 || (qd && t.contact.indexOf(qd) >= 0);
      });
    }
    if (state.filter === 'unread') list = list.filter(function (t) { return t.unread > 0; });
    if (state.filter === 'awaiting') list = list.filter(function (t) { return t.last && t.last.direction === 'in'; });
    list.sort(function (a, b) { return a.last.timestamp < b.last.timestamp ? 1 : -1; });
    return list;
  }
  function selectedThread() {
    if (!state.selected) return null;
    var found = null;
    threads().concat([]).forEach(function (t) { if (t.key === state.selected) found = t; });
    if (found) return found;
    var parts = state.selected.split('|');
    return { key: state.selected, businessId: parts[0], contact: parts[1], name: null, messages: [], last: null, unread: 0 };
  }
  function displayName(t) { return t.name || formatPhone(t.contact); }

  function renderBusinessOptions() {
    var select = el('business');
    var ids = {};
    state.messages.forEach(function (m) { ids[m.businessId] = true; });
    var current = state.business;
    while (select.options.length > 1) select.remove(1);
    Object.keys(ids).sort().forEach(function (id) {
      var o = document.createElement('option');
      o.value = id;
      o.textContent = id;
      select.appendChild(o);
    });
    select.value = ids[current] ? current : '';
  }

  function renderThreads() {
    var ul = el('threads');
    ul.textContent = '';
    var list = threads();
    if (!list.length) {
      var empty = node('li', 'side-empty');
      empty.appendChild(node('div', null, state.messages.length ? 'Nenhuma conversa com esse filtro.' : 'Nenhuma conversa ainda. Quando a aplicação enviar uma mensagem, ela aparece aqui.'));
      if (!state.messages.length) {
        var b = node('button', 'btn ghost', 'Começar como paciente');
        b.type = 'button';
        b.addEventListener('click', openNewDialog);
        empty.appendChild(b);
      }
      ul.appendChild(empty);
      return;
    }
    list.forEach(function (t) {
      var li = document.createElement('li');
      var btn = node('button', 'thread' + (t.unread ? ' unread' : ''));
      btn.type = 'button';
      if (t.key === state.selected) btn.setAttribute('aria-current', 'true');
      var av = node('div', 'avatar', initials(t.name, t.contact));
      av.style.background = colorFor(t.key);
      av.setAttribute('aria-hidden', 'true');
      var body = node('div', 'body');
      body.appendChild(node('div', 'title', displayName(t)));
      var preview = node('div', 'preview');
      if (t.last.direction === 'out') preview.appendChild(statusIcon(t.last.status));
      var label = t.last.type === 'template' ? 'Template ' + t.last.template.name + ': ' + t.last.text : t.last.text;
      preview.appendChild(node('span', null, label));
      body.appendChild(preview);
      var meta = node('div', 'meta');
      meta.appendChild(node('span', 'time', listTime(t.last.timestamp)));
      if (t.unread) meta.appendChild(node('span', 'unread-badge', String(t.unread)));
      else meta.appendChild(node('span', null, ''));
      btn.appendChild(av);
      btn.appendChild(body);
      btn.appendChild(meta);
      btn.setAttribute('aria-label', displayName(t) + (t.unread ? ', ' + t.unread + ' não lidas' : ''));
      btn.addEventListener('click', function () { openThread(t.key); });
      li.appendChild(btn);
      ul.appendChild(li);
    });
  }

  /* ---------- conversation ---------- */
  function openThread(key) {
    state.selected = key;
    el('app').classList.add('in-chat');
    markSeen();
    render();
    var reply = el('reply');
    if (reply && window.matchMedia('(min-width: 761px)').matches) reply.focus();
  }
  function markSeen() {
    var t = selectedThread();
    if (!t || !t.last) return;
    state.seen[t.key] = t.last.timestamp;
    writeSeen();
  }
  function webhookFor(businessId) {
    var c = state.config;
    if (!c) return null;
    var url = null;
    (c.mappings || []).forEach(function (m) { if (m.phone === businessId) url = m.url; });
    return url || c.fallbackUrl || null;
  }

  function renderChat() {
    var t = selectedThread();
    var has = !!t;
    el('welcome').hidden = has;
    el('chat-head').hidden = !has;
    el('stream').hidden = !has;
    el('compose').hidden = !has;
    if (!has) return;

    var av = el('head-avatar');
    av.textContent = initials(t.name, t.contact);
    av.style.background = colorFor(t.key);
    el('head-name').textContent = displayName(t);
    var sub = el('head-sub');
    if (state.typing[t.businessId]) {
      sub.textContent = 'clínica digitando…';
      sub.className = 'typing';
    } else {
      sub.textContent = (t.name ? formatPhone(t.contact) + ' · ' : '') + 'conversa com a clínica ' + t.businessId;
      sub.className = '';
    }

    var stream = el('stream');
    var nearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 80;
    stream.textContent = '';
    if (!webhookFor(t.businessId)) {
      stream.appendChild(node('div', 'notice', 'Sem webhook para este número: o que o paciente escrever fica registrado aqui, mas não chega à aplicação. Configure em Painel de controle, Webhook.'));
    }
    var lastDay = null;
    var prev = null;
    t.messages.forEach(function (m) {
      var dk = dayKey(m.timestamp);
      if (dk !== lastDay) { stream.appendChild(node('div', 'day', dayLabel(m.timestamp))); lastDay = dk; prev = null; }
      var first = !prev || prev.direction !== m.direction;
      stream.appendChild(renderMessage(m, first, prev));
      prev = m;
    });
    if (state.typing[t.businessId]) {
      var tr = node('div', 'row out typing-row');
      tr.appendChild(node('div', 'bubble', 'digitando…'));
      stream.appendChild(tr);
    }
    if (nearBottom || renderChat.lastKey !== t.key || renderChat.lastCount !== t.messages.length) {
      stream.scrollTop = stream.scrollHeight;
    }
    renderChat.lastKey = t.key;
    renderChat.lastCount = t.messages.length;

    var hint = el('compose-hint');
    if (webhookFor(t.businessId)) {
      hint.textContent = 'Enter envia · Shift+Enter quebra a linha';
      hint.className = 'compose-hint';
    } else {
      hint.textContent = 'Sem webhook: a resposta fica só aqui.';
      hint.className = 'compose-hint warn';
    }
  }

  function renderMessage(m, first, prev) {
    var row = node('div', 'row ' + m.direction + (first ? ' tail' : '') + (first && prev ? ' gap' : ''));
    var bubble = node('div', 'bubble');
    if (m.type === 'template' && m.template) {
      bubble.appendChild(node('span', 'tpl-tag', 'Template ' + m.template.name + ' · ' + m.template.language));
      if (m.template.header) bubble.appendChild(node('span', 'tpl-head', m.template.header));
      bubble.appendChild(document.createTextNode(m.template.body || m.text));
      if (m.template.footer) bubble.appendChild(node('span', 'tpl-foot', m.template.footer));
    } else {
      bubble.appendChild(document.createTextNode(m.text));
    }
    var stamp = node('span', 'stamp');
    stamp.appendChild(node('span', null, time(m.timestamp)));
    if (m.direction === 'out') {
      stamp.appendChild(statusIcon(m.status));
      stamp.setAttribute('title', STATUS_TEXT[m.status] || 'enviando');
      stamp.setAttribute('aria-label', time(m.timestamp) + ', ' + (STATUS_TEXT[m.status] || 'enviando'));
      var menuBtn = node('button', 'msg-menu');
      menuBtn.type = 'button';
      menuBtn.setAttribute('aria-label', 'Mudar o status desta mensagem');
      menuBtn.setAttribute('aria-haspopup', 'menu');
      menuBtn.appendChild(svg(CHEVRON));
      menuBtn.addEventListener('click', function (e) { e.stopPropagation(); openMenu(m.id, menuBtn); });
      bubble.appendChild(menuBtn);
    }
    bubble.appendChild(stamp);
    if (m.type === 'template' && m.template && m.template.buttons && m.template.buttons.length) {
      var buttons = node('div', 'tpl-buttons');
      m.template.buttons.forEach(function (b) { buttons.appendChild(node('div', null, b)); });
      bubble.appendChild(buttons);
    }
    row.appendChild(bubble);
    return row;
  }

  /* ---------- status menu ---------- */
  function openMenu(id, anchor) {
    var menu = el('menu');
    state.menuFor = id;
    var r = anchor.getBoundingClientRect();
    menu.setAttribute('data-open', 'true');
    var w = menu.offsetWidth;
    var h = menu.offsetHeight;
    var left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
    var top = r.bottom + 4 + h > window.innerHeight ? r.top - h - 4 : r.bottom + 4;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    var firstItem = menu.querySelector('button');
    if (firstItem) firstItem.focus();
  }
  function closeMenu() { el('menu').setAttribute('data-open', 'false'); state.menuFor = null; }
  function setStatus(id, status) {
    return api('/mock/messages/' + encodeURIComponent(id) + '/status', { method: 'POST', body: { status: status } })
      .then(function () { applyStatus(id, status); toast('Mensagem marcada como ' + STATUS_TEXT[status] + '.'); })
      .catch(function (e) { toast(e.message, true); });
  }
  function applyStatus(id, status) {
    state.messages.forEach(function (m) { if (m.id === id) m.status = status; });
    render();
  }

  /* ---------- sending as the patient ---------- */
  function sendAsPatient(businessId, contact, name, text) {
    var body = { from: digits(contact), to: businessId, message: { type: 'text', text: { body: text } } };
    if (name) body.name = name;
    return api('/mock/simulate-message', { method: 'POST', body: body }).then(function (res) {
      if (res && res.delivered === false) toast('Registrada aqui. Sem webhook, a aplicação não recebeu.');
      return load().then(function () { return res; });
    });
  }
  function submitReply(e) {
    if (e) e.preventDefault();
    var t = selectedThread();
    var text = el('reply').value.trim();
    if (!t || !text) return;
    el('send').disabled = true;
    sendAsPatient(t.businessId, t.contact, t.name, text).then(function () {
      el('reply').value = '';
      autosize();
    }).catch(function (err) { toast(err.message, true); }).then(function () { updateSend(); });
  }
  function autosize() {
    var r = el('reply');
    r.style.height = 'auto';
    r.style.height = Math.min(140, r.scrollHeight) + 'px';
  }
  function updateSend() { el('send').disabled = !el('reply').value.trim(); }

  function openNewDialog() {
    var t = selectedThread();
    el('nd-business').value = state.business || (t ? t.businessId : '') || (state.messages[0] ? state.messages[0].businessId : '');
    el('nd-contact').value = '';
    el('nd-name').value = '';
    el('nd-text').value = '';
    el('new-dialog').showModal();
    (el('nd-business').value ? el('nd-contact') : el('nd-business')).focus();
  }

  /* ---------- tools ---------- */
  function setTools(open) {
    el('app').classList.toggle('with-tools', open);
    el('toggle-tools').setAttribute('aria-pressed', open ? 'true' : 'false');
  }
  function selectTab(name) {
    ['delivery', 'webhook', 'events', 'templates'].forEach(function (n) {
      el('tab-' + n).setAttribute('aria-selected', n === name ? 'true' : 'false');
      el('pane-' + n).hidden = n !== name;
    });
  }
  function kv(dl, rows) {
    dl.textContent = '';
    rows.forEach(function (r) {
      dl.appendChild(node('dt', null, r[0]));
      var dd = node('dd');
      if (r[1] instanceof Node) dd.appendChild(r[1]); else dd.textContent = r[1];
      dl.appendChild(dd);
    });
  }
  function pill(text, tone) { return node('span', 'pill' + (tone ? ' ' + tone : ''), text); }

  function renderTools() {
    document.querySelectorAll('.seg button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-mode') === state.mode ? 'true' : 'false');
    });
    var outCount = state.messages.filter(function (m) { return m.direction === 'out'; }).length;
    kv(el('server-kv'), [
      ['Servidor', pill(state.healthy === false ? 'fora do ar' : 'no ar', state.healthy === false ? 'bad' : 'ok')],
      ['Tempo real', pill(state.live ? 'conectado' : 'reconectando', state.live ? 'ok' : 'bad')],
      ['Mensagens', state.messages.length + ' (' + outCount + ' da clínica)']
    ]);
    var c = state.config;
    var rows = [];
    if (!c) rows.push(['Estado', 'carregando…']);
    else {
      rows.push(['Estado', c.configured ? pill('configurado', 'ok') : pill('sem webhook', 'bad')]);
      if (c.fallbackUrl) rows.push(['Padrão', c.fallbackUrl]);
      (c.mappings || []).forEach(function (m) { rows.push([m.phone, m.url]); });
      rows.push(['Assinatura', c.secretSet ? pill('HMAC ativo', 'ok') : pill('sem segredo')]);
    }
    kv(el('webhook-kv'), rows);
    if (!el('wh-phone').value) {
      var t = selectedThread();
      el('wh-phone').value = state.business || (t ? t.businessId : '');
    }
    renderEvents();
    renderTemplates();
  }
  var KIND = { message: 'Mensagem do paciente', status: 'Status de mensagem', template_status: 'Status de template' };
  function renderEvents() {
    var ul = el('events');
    ul.textContent = '';
    if (!state.events.length) { ul.appendChild(node('li', 'side-empty', 'Nenhuma chamada ao webhook ainda.')); return; }
    state.events.slice(0, 200).forEach(function (ev) {
      var li = node('li', 'event');
      var b = node('button');
      b.type = 'button';
      b.setAttribute('aria-expanded', 'false');
      b.appendChild(node('span', 'ev-kind', KIND[ev.kind] || 'Evento'));
      var ok = ev.status === 'delivered';
      b.appendChild(pill((ok ? 'entregue' : 'falhou') + (ev.httpStatus ? ' · ' + ev.httpStatus : ''), ok ? 'ok' : 'bad'));
      b.appendChild(node('span', 'ev-url', ev.error ? ev.error : (ev.url || '')));
      b.appendChild(node('span', 'ev-time', time(ev.timestamp)));
      var pre = node('pre', null, JSON.stringify(ev.payload, null, 2));
      pre.hidden = true;
      b.addEventListener('click', function () {
        pre.hidden = !pre.hidden;
        b.setAttribute('aria-expanded', pre.hidden ? 'false' : 'true');
      });
      li.appendChild(b);
      li.appendChild(pre);
      ul.appendChild(li);
    });
  }
  function renderTemplates() {
    var box = el('templates');
    box.textContent = '';
    if (!state.templates.length) { box.appendChild(node('div', 'side-empty', 'Nenhum template carregado.')); return; }
    state.templates.forEach(function (tpl) {
      var card = node('div', 'tpl-card');
      card.appendChild(node('b', null, tpl.name));
      card.appendChild(document.createTextNode(' '));
      card.appendChild(node('small', null, (tpl.language || '') + (tpl.category ? ' · ' + tpl.category.toLowerCase() : '')));
      var body = '';
      (tpl.components || []).forEach(function (c) { if (c.type === 'BODY' && c.text) body = c.text; });
      if (body) card.appendChild(node('p', null, body));
      box.appendChild(card);
    });
  }

  /* ---------- data ---------- */
  function load() {
    return api('/mock/messages').then(function (data) {
      state.messages = (data && data.messages) || [];
      render();
    }).catch(function (e) { toast('Não consegui ler as mensagens: ' + e.message, true); });
  }
  function loadSide() {
    api('/mock/config').then(function (c) { state.config = c; render(); }).catch(function () {});
    api('/mock/delivery-mode').then(function (d) { state.mode = d.mode; renderTools(); }).catch(function () {});
    api('/mock/events').then(function (d) { state.events = (d && d.events) || []; renderTools(); }).catch(function () {});
    api('/mock/templates').then(function (d) { state.templates = (d && d.templates) || []; renderTools(); }).catch(function () {});
    api('/health').then(function () { state.healthy = true; renderTools(); }).catch(function () { state.healthy = false; renderTools(); });
  }
  function render() {
    renderBusinessOptions();
    renderThreads();
    renderChat();
    renderTools();
    el('live-dot').className = 'dot ' + (state.live ? 'on' : 'off');
    el('live-text').textContent = state.live ? 'ao vivo' : 'reconectando…';
  }

  function connect() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var ws;
    try { ws = new WebSocket(proto + '//' + location.host + '/ws'); } catch (e) { setTimeout(connect, 3000); return; }
    ws.onopen = function () { state.live = true; render(); load(); loadSide(); };
    ws.onclose = function () { state.live = false; render(); setTimeout(connect, 3000); };
    ws.onmessage = function (event) {
      var data;
      try { data = JSON.parse(event.data); } catch (e) { return; }
      if (data.type === 'NEW_MESSAGE' && data.payload && data.payload.direction) {
        var exists = state.messages.some(function (m) { return m.id === data.payload.id; });
        if (!exists) state.messages.push(data.payload);
        if (state.selected === keyOf(data.payload)) markSeen();
        render();
      } else if (data.type === 'STATUS_UPDATE' && data.payload) {
        applyStatus(data.payload.id, data.payload.status);
      } else if (data.type === 'WEBHOOK_EVENT' && data.payload) {
        state.events.unshift(data.payload);
        // A delivery attempt means a webhook exists now, maybe configured elsewhere.
        api('/mock/config').then(function (c) { state.config = c; render(); }).catch(function () {});
        renderTools();
      } else if (data.type === 'TYPING_INDICATOR' && data.payload) {
        state.typing[data.payload.phoneNumberId] = !!data.payload.isTyping;
        renderChat();
      }
    };
  }

  /* ---------- wiring ---------- */
  el('business').addEventListener('change', function (e) { state.business = e.target.value; render(); });
  el('search').addEventListener('input', function (e) { state.query = e.target.value; renderThreads(); });
  document.querySelectorAll('.filter').forEach(function (b) {
    b.addEventListener('click', function () {
      state.filter = b.getAttribute('data-filter');
      document.querySelectorAll('.filter').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      renderThreads();
    });
  });
  el('new-chat').addEventListener('click', openNewDialog);
  el('welcome-new').addEventListener('click', openNewDialog);
  el('welcome-tools').addEventListener('click', function () { setTools(true); });
  el('toggle-tools').addEventListener('click', function () { setTools(!el('app').classList.contains('with-tools')); });
  el('close-tools').addEventListener('click', function () { setTools(false); });
  el('back').addEventListener('click', function () { state.selected = null; el('app').classList.remove('in-chat'); render(); });
  ['delivery', 'webhook', 'events', 'templates'].forEach(function (n) {
    el('tab-' + n).addEventListener('click', function () { selectTab(n); });
  });
  document.querySelectorAll('.seg button').forEach(function (b) {
    b.addEventListener('click', function () {
      var mode = b.getAttribute('data-mode');
      api('/mock/delivery-mode', { method: 'POST', body: { mode: mode } }).then(function (d) {
        state.mode = d.mode;
        renderTools();
        toast(mode === 'auto' ? 'Entrega automática: as mensagens viram lidas sozinhas.' : 'Entrega manual: marque cada mensagem no menu dela.');
      }).catch(function (e) { toast(e.message, true); });
    });
  });
  el('webhook-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var url = el('wh-url').value.trim();
    if (url.indexOf('://') < 0) url = 'http' + '://' + url;
    api('/mock/configure', { method: 'POST', body: { phoneNumberId: el('wh-phone').value.trim(), url: url, enabled: true } })
      .then(function () { toast('Webhook salvo.'); el('wh-url').value = ''; loadSide(); })
      .catch(function (err) { toast(err.message, true); });
  });
  el('clear-all').addEventListener('click', function () {
    var b = el('clear-all');
    if (b.getAttribute('data-confirm') !== 'true') {
      b.setAttribute('data-confirm', 'true');
      b.textContent = 'Toque de novo para apagar';
      setTimeout(function () { b.removeAttribute('data-confirm'); b.textContent = 'Apagar todas as conversas'; }, 4000);
      return;
    }
    b.removeAttribute('data-confirm');
    b.textContent = 'Apagar todas as conversas';
    Promise.all([
      api('/conversation', { method: 'DELETE' }),
      api('/mock/events', { method: 'DELETE' })
    ]).then(function () {
      state.messages = [];
      state.events = [];
      state.selected = null;
      state.seen = {};
      writeSeen();
      el('app').classList.remove('in-chat');
      render();
      toast('Conversas apagadas.');
    }).catch(function (e) { toast(e.message, true); });
  });

  el('read-all').addEventListener('click', function () {
    var t = selectedThread();
    if (!t) return;
    var pending = t.messages.filter(function (m) { return m.direction === 'out' && m.status !== 'read' && m.status !== 'failed'; });
    if (!pending.length) { toast('Nada a marcar: tudo já foi lido.'); return; }
    Promise.all(pending.map(function (m) {
      return api('/mock/messages/' + encodeURIComponent(m.id) + '/status', { method: 'POST', body: { status: 'read' } })
        .then(function () { m.status = 'read'; });
    })).then(function () { render(); toast(pending.length + ' mensagem(ns) marcada(s) como lida(s).'); })
      .catch(function (e) { toast(e.message, true); });
  });

  el('menu').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-status]');
    if (!b || !state.menuFor) return;
    var id = state.menuFor;
    closeMenu();
    setStatus(id, b.getAttribute('data-status'));
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('#menu')) closeMenu(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

  el('compose').addEventListener('submit', submitReply);
  el('reply').addEventListener('input', function () { autosize(); updateSend(); });
  el('reply').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submitReply(); }
  });
  QUICK.forEach(function (q) {
    var b = node('button', null, q);
    b.type = 'button';
    b.addEventListener('click', function () { el('reply').value = q; updateSend(); submitReply(); });
    el('quick').appendChild(b);
  });

  el('nd-cancel').addEventListener('click', function () { el('new-dialog').close(); });
  el('new-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var business = el('nd-business').value.trim();
    var contact = digits(el('nd-contact').value);
    var name = el('nd-name').value.trim();
    var text = el('nd-text').value.trim();
    if (!business || !contact || !text) return;
    el('nd-send').disabled = true;
    sendAsPatient(business, contact, name, text).then(function () {
      el('new-dialog').close();
      openThread(business + '|' + contact);
    }).catch(function (err) { toast(err.message, true); }).then(function () { el('nd-send').disabled = false; });
  });

  render();
  load();
  loadSide();
  connect();
})();
</script>
</body>
</html>
`
