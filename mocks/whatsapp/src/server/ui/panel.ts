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
  /* The variable filled: the value where the placeholder was. */
  --var-fill: #1f9d55;
  --var-fill-ink: #ffffff;
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
  /* What only the mock has (X-Mock-* headers, /mock routes): amber, never green. */
  --mock: #9a5b00;
  --mock-soft: rgba(255, 176, 46, 0.16);
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
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
    --var-fill: #1f9d55;
    --var-fill-ink: #ffffff;
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
    --mock: #ffb02e;
    --mock-soft: rgba(255, 176, 46, 0.12);
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
/* The control panel is an overlay (see .tools): the grid never grows for it. */

/* ---------- left: chats ---------- */
.side { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--line); background: var(--panel); }
.bar {
  height: 60px; flex: none; display: flex; align-items: center; gap: 8px;
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
/*
 * The language of the panel: two letters, held in the header. The console is
 * read at a glance, so the switch stays quiet and never competes with the
 * content.
 */
.lang { display: inline-flex; align-items: center; gap: 1px; padding: 1px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); flex: none; }
.lang button { border: 0; border-radius: 6px; background: transparent; padding: 2px 5px; font-size: 10px; font-weight: 600; letter-spacing: 0.06em; line-height: 1.5; color: var(--ink-3); }
.lang button:hover { color: var(--ink-2); }
.lang button[aria-pressed="true"] { background: var(--green); color: var(--green-ink); }

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
.tpl-offer { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; margin: 0 0 6px; padding: 7px 9px; border-radius: 6px; background: rgba(0, 168, 132, 0.12); color: var(--green); font-size: 13px; }
.tpl-offer svg { width: 18px; height: 18px; flex: none; }
.tpl-offer small { width: 100%; color: var(--ink-3); font-size: 11.5px; }
.bubble a { color: #027eb5; }
.bubble code { font: 13px/1.35 var(--mono); }
@media (prefers-color-scheme: dark) { .bubble a { color: #53bdeb; } }
.tpl-foot { display: block; margin-top: 4px; color: var(--ink-3); font-size: 13px; }
.tpl-buttons { margin: 6px -7px -8px -9px; border-top: 1px solid rgba(11, 20, 26, 0.08); }
.tpl-buttons div { padding: 9px; text-align: center; color: #027eb5; font-size: 14px; border-top: 1px solid rgba(11, 20, 26, 0.08); }
.tpl-buttons div:first-child { border-top: 0; }
.tpl-buttons div { display: flex; align-items: center; justify-content: center; gap: 6px; }
.tpl-buttons svg { width: 15px; height: 15px; flex: none; }
.tpl-buttons small { display: block; width: 100%; font-size: 11px; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tpl-buttons .btn-col { display: flex; flex-direction: column; align-items: center; min-width: 0; }
@media (prefers-color-scheme: dark) { .tpl-buttons div { color: #53bdeb; } .tpl-buttons, .tpl-buttons div { border-color: rgba(233, 237, 239, 0.08); } }

/* A media inside a bubble: drawn edge to edge, as the phone does. */
.media { display: block; margin: -3px -4px 6px -6px; border-radius: 6px; overflow: hidden; background: rgba(11, 20, 26, 0.06); }
.media img, .media video { display: block; width: 100%; max-height: 320px; object-fit: cover; }
.media.sticker { background: transparent; width: 160px; }
.media.sticker img { object-fit: contain; }
.media audio { display: block; width: 260px; max-width: 100%; margin: 6px; }
.media-missing { display: grid; place-items: center; height: 120px; color: var(--ink-3); font-size: 12.5px; gap: 4px; text-align: center; padding: 10px; }
.media-missing svg { width: 28px; height: 28px; }
.doc { display: flex; align-items: center; gap: 10px; margin: -2px -3px 6px -5px; padding: 10px 12px; border-radius: 6px; background: rgba(11, 20, 26, 0.05); color: inherit; text-decoration: none; }
.doc svg { width: 30px; height: 30px; flex: none; color: #e1554a; }
.doc b { display: block; font-weight: 500; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.doc small { color: var(--ink-3); font-size: 11.5px; }
.doc-text { min-width: 0; }
.loc { display: block; margin: -3px -4px 6px -6px; padding: 26px 12px 10px; border-radius: 6px; background: linear-gradient(135deg, #d8ecd9, #c6e1f0); color: #1f3b2c; font-size: 12.5px; }
.loc b { display: block; font-size: 13.5px; }
@media (prefers-color-scheme: dark) { .media, .doc { background: rgba(233, 237, 239, 0.06); } .loc { background: linear-gradient(135deg, #20392c, #1d3445); color: #d9eadf; } }

/* A carousel: the cards under the bubble, side by side, scrolled sideways. */
.cards { display: flex; gap: 8px; overflow-x: auto; padding: 6px 2px 4px; max-width: min(80%, 640px); scroll-snap-type: x mandatory; scrollbar-width: thin; }
.row.out .cards { margin-left: auto; }
.card { flex: 0 0 220px; scroll-snap-align: start; border-radius: 8px; background: var(--bubble-out); box-shadow: var(--shadow); padding: 6px 7px 0 9px; font-size: 13.5px; white-space: pre-wrap; display: flex; flex-direction: column; }
.row.in .card { background: var(--bubble-in); }
.card .media { margin-top: 0; }
.card .card-body { flex: 1; }
.card .tpl-buttons { margin-top: 8px; }
.row.has-cards { flex-direction: column; align-items: flex-end; }
.row.in.has-cards { align-items: flex-start; }

/* The file the next message carries, above the reply box. */
.compose-field { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.attachment { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 8px; background: var(--panel); font-size: 12.5px; }
.attachment img { width: 40px; height: 40px; object-fit: cover; border-radius: 5px; }
.attachment .att-icon { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 5px; background: var(--panel-2); color: var(--ink-3); }
.attachment .att-icon svg { width: 22px; height: 22px; }
.attachment .att-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.attachment small { color: var(--ink-3); }
.attachment button { border: 0; background: transparent; color: var(--ink-3); font-size: 18px; line-height: 1; padding: 2px 6px; border-radius: 6px; }
.attachment button:hover { color: var(--danger); }
.attach { align-self: center; color: var(--ink-3); }
/* The template builder: the parts on the left, the phone on the right. */
.tpl-builder { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 26px; align-items: start; }
.tpl-compose { min-width: 0; display: flex; flex-direction: column; gap: 14px; }
.tpl-part { display: flex; flex-direction: column; gap: 8px; }
.tpl-part-head { display: flex; align-items: baseline; gap: 8px; font-size: 13px; }
.tpl-part-head b { font-weight: 600; color: var(--ink-2); }
.tpl-part-head small { color: var(--ink-3); font-size: 12px; }
.tpl-part input:not([type]), .tpl-part input[type="text"], .tpl-part input[type="url"], .tpl-part input[type="tel"], .tpl-row input, .tpl-card textarea {
  min-width: 0; border: 1px solid var(--line); border-radius: 8px; background: var(--panel-2); padding: 8px 11px; color: var(--ink); font: inherit; font-size: 13.5px;
}
.tpl-part input:focus, .tpl-row input:focus, .tpl-card textarea:focus { outline: none; border-color: var(--green); }
.tpl-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.tpl-row input { flex: 1 1 200px; }
.tpl-sample { font-size: 12.5px; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chips button { border: 1px solid var(--line); background: var(--panel); color: var(--ink-2); border-radius: 999px; padding: 5px 12px; font-size: 12.5px; }
.chips button:hover { border-color: var(--ink-3); color: var(--ink); }
.chips button[aria-checked="true"] { background: var(--green); border-color: var(--green); color: var(--green-ink); font-weight: 600; }
.chips.add button { border-style: dashed; }
.chips.add button:disabled { opacity: 0.4; cursor: default; }
.btn.small { padding: 5px 12px; font-size: 12.5px; }
.tpl-buttons-edit { display: flex; flex-direction: column; gap: 6px; }
.tpl-btn-row { display: grid; grid-template-columns: 26px minmax(0, 1fr) minmax(0, 1.3fr) 28px; gap: 6px; align-items: center; }
.tpl-btn-row > svg { width: 18px; height: 18px; color: var(--ink-3); justify-self: center; }
.tpl-btn-row input { width: 100%; }
.tpl-btn-row .solo { grid-column: span 2; }
.icon-x { border: 0; background: transparent; color: var(--ink-3); font-size: 18px; line-height: 1; border-radius: 6px; padding: 3px; }
.icon-x:hover { color: var(--danger); background: rgba(234, 0, 56, 0.08); }
.tpl-switch { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; }
.tpl-switch input { margin-top: 3px; accent-color: var(--green); }
.tpl-switch b { display: block; font-weight: 600; font-size: 13px; color: var(--ink-2); }
.tpl-switch small { color: var(--ink-3); font-size: 12px; }
.tpl-cards-edit { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; }
.tpl-card { flex: 0 0 240px; display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); }
.tpl-card-head { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--ink-3); }
.tpl-card textarea { resize: vertical; min-height: 56px; }
.tpl-card .tpl-btn-row { grid-template-columns: 22px minmax(0, 1fr) 24px; }
.tpl-card .tpl-btn-row input + input { grid-column: 2; }
/*
 * The phone: the template as the patient's WhatsApp draws it. It carries its
 * own light and dark (the switch under it), apart from the panel's, because
 * the person reviewing a template wants to see both.
 */
.tpl-phone { position: sticky; top: 0; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.tpl-phone-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; max-width: 330px; font-size: 12px; color: var(--ink-3); }
.tpl-phone-hint { font-size: 11.5px; color: var(--ink-3); text-align: center; max-width: 300px; margin: 0; }
.phone {
  --ph-head: #ffffff; --ph-head-ink: #111b21; --ph-sub: #667781; --ph-wall: #efeae2; --ph-dot: rgba(17, 27, 33, 0.07);
  --ph-in: #ffffff; --ph-out: #d9fdd3; --ph-ink: #111b21; --ph-mute: #667781; --ph-btn: #027eb5; --ph-line: rgba(11, 20, 26, 0.1);
  --ph-chip: #ffffff; --ph-notice: #fdf4c5; --ph-notice-ink: #54656f; --ph-compose: #ffffff; --ph-icon: #54656f;
  --ph-quote: rgba(11, 20, 26, 0.05); --ph-media: #dfe5e7; --ph-sheet: #ffffff; --ph-offer: #e7f8f1; --ph-offer-ink: #0a6b51;
  position: relative; width: 320px; max-width: 100%; padding: 9px; border-radius: 46px; background: #1d2225;
  box-shadow: 0 0 0 1.5px #3a4246 inset, 0 0 0 1px rgba(0, 0, 0, 0.25), 0 26px 50px -18px rgba(11, 20, 26, 0.45), 0 8px 18px -10px rgba(11, 20, 26, 0.3);
  color: var(--ph-ink); font: 14.4px/1.38 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
.phone[data-theme="dark"] {
  --ph-head: #1f2c34; --ph-head-ink: #e9edef; --ph-sub: #8696a0; --ph-wall: #0b141a; --ph-dot: rgba(233, 237, 239, 0.05);
  --ph-in: #202c33; --ph-out: #005c4b; --ph-ink: #e9edef; --ph-mute: #8696a0; --ph-btn: #53bdeb; --ph-line: rgba(233, 237, 239, 0.1);
  --ph-chip: #182229; --ph-notice: #182229; --ph-notice-ink: #ffd279; --ph-compose: #1f2c34; --ph-icon: #8696a0;
  --ph-quote: rgba(0, 0, 0, 0.18); --ph-media: #2a3942; --ph-sheet: #1f2c34; --ph-offer: #0f3a30; --ph-offer-ink: #7ee2c1;
}
.phone::before { content: ""; position: absolute; left: -2px; top: 120px; width: 3px; height: 54px; border-radius: 2px; background: #2b3236; }
.phone::after { content: ""; position: absolute; right: -2px; top: 150px; width: 3px; height: 80px; border-radius: 2px; background: #2b3236; }
.ph-screen { position: relative; height: 640px; border-radius: 38px; overflow: hidden; display: flex; flex-direction: column; background: var(--ph-wall); }
.ph-status { flex: none; height: 34px; display: flex; align-items: center; justify-content: space-between; padding: 4px 26px 0 30px; background: var(--ph-head); color: var(--ph-head-ink); font-size: 13px; font-weight: 600; letter-spacing: 0.01em; position: relative; }
.ph-status svg { height: 11px; width: auto; }
.ph-status-icons { display: flex; align-items: center; gap: 5px; }
.ph-island { position: absolute; left: 50%; top: 8px; width: 92px; height: 24px; margin-left: -46px; border-radius: 14px; background: #000; }
.ph-head { flex: none; display: flex; align-items: center; gap: 8px; padding: 6px 10px 8px 6px; background: var(--ph-head); color: var(--ph-head-ink); box-shadow: 0 1px 0 var(--ph-line); position: relative; z-index: 1; }
.ph-head svg { width: 20px; height: 20px; color: var(--ph-icon); flex: none; }
.ph-head .ph-back { color: var(--ph-head-ink); }
.ph-avatar { width: 36px; height: 36px; border-radius: 50%; flex: none; display: grid; place-items: center; background: #00a884; color: #fff; font-size: 14px; font-weight: 700; }
.ph-who { flex: 1; min-width: 0; line-height: 1.2; }
.ph-who b { display: flex; align-items: center; gap: 4px; font-size: 15.5px; font-weight: 600; min-width: 0; }
.ph-who b span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ph-who b svg { width: 15px; height: 15px; color: #25d366; flex: none; }
.ph-who small { display: block; font-size: 12px; color: var(--ph-sub); }
.ph-head-actions { display: flex; gap: 14px; padding-right: 2px; }
.ph-chat {
  flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 10px 10px 14px; display: flex; flex-direction: column; gap: 4px; scrollbar-width: none;
  background-color: var(--ph-wall);
  background-image: radial-gradient(var(--ph-dot) 1.1px, transparent 1.2px), radial-gradient(var(--ph-dot) 1.1px, transparent 1.2px);
  background-size: 22px 22px, 22px 22px; background-position: 0 0, 11px 11px;
}
.ph-chat::-webkit-scrollbar { display: none; }
.ph-day { align-self: center; padding: 4px 10px; border-radius: 7px; background: var(--ph-chip); color: var(--ph-mute); font-size: 12px; box-shadow: 0 1px 0.5px rgba(11, 20, 26, 0.13); margin: 2px 0 6px; }
.ph-notice { align-self: center; display: flex; gap: 6px; align-items: flex-start; max-width: 92%; padding: 6px 10px; border-radius: 7px; background: var(--ph-notice); color: var(--ph-notice-ink); font-size: 11.6px; line-height: 1.35; text-align: center; margin-bottom: 8px; box-shadow: 0 1px 0.5px rgba(11, 20, 26, 0.13); }
.ph-notice svg { width: 11px; height: 11px; flex: none; margin-top: 2px; }
.ph-row { display: flex; flex-direction: column; align-items: flex-start; }
.ph-row.out { align-items: flex-end; }
.ph-bubble { position: relative; max-width: 88%; min-width: 120px; border-radius: 9px; border-top-left-radius: 0; background: var(--ph-in); box-shadow: 0 1px 0.5px rgba(11, 20, 26, 0.13); }
.ph-bubble::before { content: ""; position: absolute; top: 0; left: -7px; width: 8px; height: 12px; background: inherit; clip-path: polygon(100% 0, 0 0, 100% 100%); }
.ph-row.out .ph-bubble { background: var(--ph-out); border-top-left-radius: 9px; border-top-right-radius: 0; }
.ph-row.out .ph-bubble::before { left: auto; right: -7px; clip-path: polygon(0 0, 100% 0, 0 100%); }
.ph-content { padding: 6px 8px 7px 9px; white-space: pre-wrap; overflow-wrap: anywhere; }
.ph-content .ph-time { float: right; margin: 6px -2px -6px 10px; font-size: 11px; color: var(--ph-mute); display: inline-flex; align-items: center; gap: 3px; }
.ph-content .ph-time svg { width: 16px; height: 11px; color: #53bdeb; }
.ph-title { display: block; font-weight: 700; font-size: 15px; margin-bottom: 3px; }
.ph-foot { display: block; margin-top: 4px; font-size: 12.8px; color: var(--ph-mute); }
.ph-content a { color: var(--ph-btn); text-decoration: none; }
.ph-content code { font: 13px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; }
.ph-var-empty { border-radius: 3px; background: rgba(255, 176, 46, 0.25); padding: 0 2px; }
/* The header of the bubble: a media edge to edge, three pixels in, as the phone draws it. */
.ph-media { position: relative; display: block; margin: 3px 3px 0; border-radius: 7px; overflow: hidden; background: var(--ph-media); aspect-ratio: 1.91 / 1; }
.ph-media img, .ph-media video { display: block; width: 100%; height: 100%; object-fit: cover; }
.ph-media-empty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: var(--ph-mute); font-size: 11.5px; text-align: center; padding: 8px; }
.ph-media-empty svg { width: 30px; height: 30px; opacity: 0.75; }
.ph-play { position: absolute; left: 50%; top: 50%; width: 46px; height: 46px; margin: -23px 0 0 -23px; border: 0; border-radius: 50%; background: rgba(11, 20, 26, 0.55); color: #fff; display: grid; place-items: center; }
.ph-play svg { width: 20px; height: 20px; margin-left: 3px; }
.ph-media.playing .ph-play { opacity: 0; }
.ph-duration { position: absolute; left: 8px; bottom: 6px; display: inline-flex; align-items: center; gap: 4px; color: #fff; font-size: 11px; font-weight: 500; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6); }
.ph-duration svg { width: 13px; height: 13px; }
.ph-doc { display: block; margin: 3px 3px 0; border-radius: 7px; overflow: hidden; background: var(--ph-quote); color: inherit; text-decoration: none; }
.ph-doc-page { height: 112px; display: grid; place-items: center; background: var(--ph-media); }
.ph-doc-sheet { width: 64px; height: 86px; border-radius: 3px; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18); padding: 10px 8px; display: flex; flex-direction: column; gap: 5px; }
.ph-doc-sheet i { display: block; height: 3px; border-radius: 2px; background: #d6dde0; }
.ph-doc-sheet i:first-child { background: #0b8a63; width: 60%; height: 5px; }
.ph-doc-sheet i:nth-child(3) { width: 80%; }
.ph-doc-sheet i:last-child { width: 45%; margin-top: auto; }
.ph-doc-strip { display: flex; align-items: center; gap: 9px; padding: 9px 10px; }
.ph-doc-strip svg { width: 26px; height: 30px; flex: none; }
.ph-doc-strip b { display: block; font-size: 13.5px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ph-doc-strip small { color: var(--ph-mute); font-size: 11.5px; }
.ph-doc-text { min-width: 0; }
.ph-map {
  position: relative; display: block; margin: 3px 3px 0; border-radius: 7px; overflow: hidden; aspect-ratio: 1.91 / 1;
  background-color: #e8eee4;
  background-image:
    linear-gradient(28deg, transparent 46%, #ffffff 46%, #ffffff 54%, transparent 54%),
    linear-gradient(118deg, transparent 47%, #fff7d6 47%, #fff7d6 53%, transparent 53%),
    linear-gradient(0deg, transparent 70%, #cfe3c4 70%, #cfe3c4 86%, transparent 86%),
    repeating-linear-gradient(90deg, transparent 0 38px, rgba(255, 255, 255, 0.85) 38px 42px),
    repeating-linear-gradient(0deg, transparent 0 30px, rgba(255, 255, 255, 0.85) 30px 33px);
}
.phone[data-theme="dark"] .ph-map { background-color: #1f2b2f; filter: brightness(0.75) saturate(0.7); }
.ph-pin { position: absolute; left: 50%; top: 50%; width: 30px; height: 40px; margin: -38px 0 0 -15px; color: #e8453c; filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.3)); }
.ph-place { display: block; margin-bottom: 4px; font-size: 12.8px; color: var(--ph-mute); }
.ph-place b { display: block; color: var(--ph-ink); font-size: 14px; font-weight: 600; }
.ph-offer { display: flex; align-items: center; gap: 10px; margin: 3px 3px 0; padding: 9px 10px; border-radius: 7px; background: var(--ph-offer); color: var(--ph-offer-ink); }
.ph-offer svg { width: 26px; height: 26px; flex: none; }
.ph-offer b { display: block; font-size: 14px; font-weight: 700; }
.ph-offer small { font-size: 12px; opacity: 0.85; }
/* The buttons hang under the text, one row each, divided as the phone divides them. */
.ph-btns { border-top: 1px solid var(--ph-line); }
.ph-btn { display: flex; width: 100%; align-items: center; justify-content: center; gap: 7px; min-height: 40px; padding: 8px 10px; border: 0; border-top: 1px solid var(--ph-line); background: transparent; color: var(--ph-btn); font: inherit; font-size: 14.4px; font-weight: 500; }
.ph-btn:first-child { border-top: 0; }
.ph-btn svg { width: 17px; height: 17px; flex: none; }
.ph-btn:hover { background: var(--ph-quote); }
.ph-btn:focus-visible { outline: 2px solid var(--ph-btn); outline-offset: -2px; border-radius: 0; }
.ph-btns:last-child .ph-btn:last-child { border-bottom-left-radius: 9px; border-bottom-right-radius: 9px; }
/* The carousel: cards that scroll sideways under the bubble, one snapped at a time. */
.ph-cards { display: flex; gap: 8px; margin: 6px -10px 0 -10px; padding: 2px 10px 4px; overflow-x: auto; scroll-snap-type: x mandatory; scroll-padding: 0 10px; scrollbar-width: none; align-self: stretch; }
.ph-cards::-webkit-scrollbar { display: none; }
.ph-card { flex: 0 0 232px; scroll-snap-align: start; display: flex; flex-direction: column; border-radius: 9px; background: var(--ph-in); box-shadow: 0 1px 0.5px rgba(11, 20, 26, 0.13); overflow: hidden; }
.ph-card .ph-media { aspect-ratio: 1 / 1; }
.ph-card .ph-content { flex: 1; font-size: 14px; }
.ph-dots { display: flex; justify-content: center; gap: 5px; margin-top: 4px; align-self: stretch; }
.ph-dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--ph-mute); opacity: 0.35; }
.ph-dots i.on { opacity: 0.9; }
.ph-quote { display: block; margin: 3px 3px 0; padding: 5px 8px 6px; border-left: 4px solid #06cf9c; border-radius: 6px; background: var(--ph-quote); font-size: 12.8px; color: var(--ph-mute); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ph-quote b { display: block; color: #06cf9c; font-size: 12.5px; font-weight: 600; }
.ph-compose { flex: none; display: flex; align-items: center; gap: 6px; padding: 6px 8px 14px; background: transparent; }
.ph-input { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; height: 42px; padding: 0 12px; border-radius: 22px; background: var(--ph-compose); color: var(--ph-mute); font-size: 15px; box-shadow: 0 1px 0.5px rgba(11, 20, 26, 0.13); }
.ph-input span { flex: 1; }
.ph-input svg { width: 21px; height: 21px; color: var(--ph-icon); flex: none; }
.ph-mic { width: 42px; height: 42px; border-radius: 50%; background: #00a884; color: #fff; display: grid; place-items: center; flex: none; }
.ph-mic svg { width: 20px; height: 20px; }
.ph-empty { margin: auto 14px; padding: 14px; border-radius: 10px; background: var(--ph-chip); color: var(--ph-mute); font-size: 12.5px; text-align: center; }
.ph-scrim { position: absolute; inset: 0; background: rgba(11, 20, 26, 0.4); opacity: 0; pointer-events: none; transition: opacity 0.18s ease; z-index: 3; }
.ph-sheet { position: absolute; left: 0; right: 0; bottom: 0; z-index: 4; padding: 8px 0 18px; border-radius: 18px 18px 0 0; background: var(--ph-sheet); transform: translateY(105%); transition: transform 0.22s ease; box-shadow: 0 -6px 18px rgba(11, 20, 26, 0.18); }
.phone.sheet-open .ph-scrim { opacity: 1; pointer-events: auto; }
.phone.sheet-open .ph-sheet { transform: none; }
.ph-grip { width: 36px; height: 4px; border-radius: 2px; background: var(--ph-line); margin: 0 auto 8px; }
.ph-sheet-title { display: flex; align-items: center; justify-content: space-between; padding: 2px 16px 8px; font-weight: 600; font-size: 15px; }
.ph-sheet-title button { border: 0; background: transparent; color: var(--ph-mute); font-size: 20px; line-height: 1; padding: 2px 6px; border-radius: 6px; }
.ph-sheet .ph-btn { justify-content: flex-start; padding: 10px 18px; font-weight: 400; }
.ph-toast { position: absolute; left: 50%; bottom: 78px; z-index: 5; max-width: 86%; transform: translate(-50%, 8px); padding: 8px 14px; border-radius: 18px; background: rgba(32, 44, 51, 0.94); color: #e9edef; font-size: 12.5px; text-align: center; opacity: 0; pointer-events: none; transition: opacity 0.18s ease, transform 0.18s ease; overflow-wrap: anywhere; }
.ph-toast.on { opacity: 1; transform: translate(-50%, 0); }
@media (prefers-reduced-motion: reduce) { .ph-sheet, .ph-scrim, .ph-toast { transition: none; } }
.theme-seg { display: inline-flex; padding: 2px; gap: 2px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel); }
.theme-seg button { border: 0; border-radius: 6px; background: transparent; padding: 3px 9px; font-size: 11.5px; color: var(--ink-3); }
.theme-seg button[aria-pressed="true"] { background: var(--panel-2); color: var(--ink); font-weight: 600; }
@media (max-width: 1180px) { .tpl-builder { grid-template-columns: minmax(0, 1fr); } .tpl-phone { position: static; } }

.nd-attach { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; margin: 2px 0 14px; }
.nd-attach .btn { display: inline-flex; align-items: center; gap: 8px; }
.nd-attach .btn svg { width: 18px; height: 18px; }
.nd-attach .attachment { align-self: stretch; background: var(--panel-2); }
.nd-attach .help { margin: 0; }
.tpl-tag { display: block; font-size: 11px; color: var(--ink-3); margin-bottom: 4px; }

/* ---------- voice notes: the recorder in the composer, the player in the bubble ---------- */
.send.voice { background: var(--green); }
.recorder { display: flex; align-items: center; gap: 10px; padding: 4px 4px 4px 0; }
.recorder .icon-btn { color: var(--ink-3); }
.recorder .icon-btn:hover { color: var(--danger); }
.rec-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--danger); animation: rec-blink 1.2s ease-in-out infinite; flex: none; }
@keyframes rec-blink { 50% { opacity: 0.25; } }
.rec-time { font-variant-numeric: tabular-nums; font-size: 14px; color: var(--ink-2); min-width: 38px; }
.rec-wave { flex: 1; min-width: 0; height: 32px; }
@media (prefers-reduced-motion: reduce) { .rec-dot { animation: none; } }
.voice-note { display: grid; grid-template-columns: 40px 34px minmax(140px, 1fr); align-items: center; gap: 8px; width: 290px; max-width: 100%; padding: 2px 2px 0 0; }
.voice-note .vn-avatar { position: relative; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-weight: 600; font-size: 14px; }
.voice-note .vn-avatar svg { position: absolute; right: -3px; bottom: -2px; width: 17px; height: 17px; color: #53bdeb; background: var(--bubble-in); border-radius: 50%; padding: 1px; }
.row.out .voice-note .vn-avatar svg { background: var(--bubble-out); }
.voice-note .vn-play { width: 34px; height: 34px; border: 0; border-radius: 50%; background: transparent; color: var(--ink-2); display: grid; place-items: center; padding: 0; }
.voice-note .vn-play svg { width: 26px; height: 26px; }
.voice-note .vn-track { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.voice-note .vn-bars { position: relative; display: flex; align-items: center; gap: 2px; height: 26px; cursor: pointer; }
.voice-note .vn-bars i { flex: 1; min-width: 2px; border-radius: 2px; background: rgba(84, 101, 111, 0.45); }
.voice-note .vn-bars i.on { background: #53bdeb; }
.row.out .voice-note .vn-bars i { background: rgba(17, 27, 33, 0.28); }
.row.out .voice-note .vn-bars i.on { background: #2fa36b; }
.voice-note .vn-meta { display: flex; justify-content: space-between; font-size: 11px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
@media (prefers-color-scheme: dark) { .row.out .voice-note .vn-bars i { background: rgba(233, 237, 239, 0.3); } .row.out .voice-note .vn-bars i.on { background: #7ee2c1; } }

/* ---------- calls: the log in the chat, the call screen ---------- */
.call-log { display: flex; align-items: center; gap: 10px; min-width: 210px; padding: 2px 4px 2px 0; white-space: normal; }
.call-log .cl-icon { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; background: rgba(0, 128, 105, 0.12); color: var(--green); flex: none; }
.call-log .cl-icon svg { width: 20px; height: 20px; }
.call-log.missed .cl-icon { background: rgba(234, 0, 56, 0.1); color: var(--danger); }
.call-log b { display: block; font-weight: 500; font-size: 14px; }
.call-log small { color: var(--ink-3); font-size: 12.5px; }
.call-log button { margin-left: auto; border: 0; background: transparent; color: var(--green); font-weight: 600; font-size: 13px; padding: 4px 6px; border-radius: 6px; }
.call-log button:hover { background: rgba(0, 128, 105, 0.1); }
.perm-card { display: block; margin: -2px -3px 4px -5px; padding: 10px 12px; border-radius: 6px; background: rgba(11, 20, 26, 0.05); white-space: normal; }
.perm-card .perm-title { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; }
.perm-card .perm-title svg { width: 20px; height: 20px; color: var(--green); flex: none; }
.perm-card p { margin: 4px 0 0; color: var(--ink-2); font-size: 13px; }
.perm-actions { margin: 6px -7px -8px -9px; border-top: 1px solid rgba(11, 20, 26, 0.08); }
.perm-actions button { display: block; width: 100%; border: 0; border-top: 1px solid rgba(11, 20, 26, 0.08); background: transparent; color: #027eb5; padding: 9px; font-size: 14px; }
.perm-actions button:first-child { border-top: 0; }
.perm-actions button:hover { background: rgba(11, 20, 26, 0.04); }
.perm-actions small { display: block; padding: 7px 9px; text-align: center; color: var(--ink-3); font-size: 11.5px; }
.perm-reply { display: flex; align-items: center; gap: 8px; white-space: normal; }
.perm-reply svg { width: 18px; height: 18px; flex: none; color: var(--green); }
.perm-reply.no svg { color: var(--danger); }
@media (prefers-color-scheme: dark) { .perm-card { background: rgba(233, 237, 239, 0.06); } .perm-actions, .perm-actions button { border-color: rgba(233, 237, 239, 0.08); } .perm-actions button { color: #53bdeb; } }

/*
 * The call screen covers the chat, as the phone's does: who, the state, the
 * round buttons at the bottom. The rings around the avatar are the one
 * motion here, and only while it rings.
 */
.call {
  position: absolute; inset: 0; z-index: 20; display: grid; grid-template-rows: auto 1fr auto auto; justify-items: center;
  padding: 22px 20px 34px; color: #e9edef;
  background: radial-gradient(120% 80% at 50% 30%, #1d3a33 0%, #0f1f1c 55%, #0a1412 100%);
}
.call-top { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.call-lock { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: rgba(233, 237, 239, 0.7); }
.call-lock svg { width: 12px; height: 12px; }
.call-role { font-size: 12px; padding: 3px 10px; border-radius: 999px; background: rgba(255, 176, 46, 0.14); color: #ffd279; }
.call-who { align-self: center; display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; }
.call-avatar { position: relative; width: 112px; height: 112px; border-radius: 50%; display: grid; place-items: center; font-size: 40px; font-weight: 600; color: #fff; }
.call.ringing .call-avatar::before, .call.ringing .call-avatar::after { content: ""; position: absolute; inset: -6px; border-radius: 50%; border: 2px solid rgba(37, 211, 102, 0.55); animation: call-ring 2s ease-out infinite; }
.call.ringing .call-avatar::after { animation-delay: 1s; }
@keyframes call-ring { from { transform: scale(1); opacity: 0.9; } to { transform: scale(1.55); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .call.ringing .call-avatar::before, .call.ringing .call-avatar::after { animation: none; opacity: 0.4; } }
.call-name { margin: 6px 0 0; font-size: 26px; font-weight: 500; }
.call-state { margin: 0; font-size: 15px; color: rgba(233, 237, 239, 0.75); font-variant-numeric: tabular-nums; }
.call-note { max-width: 420px; margin: 0 0 18px; padding: 8px 12px; border-radius: 10px; background: rgba(255, 255, 255, 0.07); color: rgba(233, 237, 239, 0.8); font-size: 12.5px; text-align: center; }
.call-actions { display: flex; gap: 22px; align-items: flex-start; }
.call-btn { display: flex; flex-direction: column; align-items: center; gap: 7px; border: 0; background: transparent; color: rgba(233, 237, 239, 0.85); font-size: 12px; padding: 0; }
.call-btn span.circle { width: 58px; height: 58px; border-radius: 50%; display: grid; place-items: center; background: rgba(255, 255, 255, 0.12); color: #fff; }
.call-btn:hover span.circle { background: rgba(255, 255, 255, 0.2); }
.call-btn[aria-pressed="true"] span.circle { background: #e9edef; color: #0f1f1c; }
.call-btn.end span.circle { background: #ea0038; }
.call-btn.end:hover span.circle { background: #ff1f55; }
.call-btn.end svg { transform: rotate(135deg); }
.call-btn.take span.circle { background: #25d366; }
.call-btn.take:hover span.circle { background: #3ae07a; }
.call-btn svg { width: 26px; height: 26px; }
.call-btn:focus-visible { outline: 2px solid #25d366; outline-offset: 4px; border-radius: 12px; }

/* ---------- numbers: businesses, their WABAs, their numbers ---------- */
.accounts { display: flex; flex-direction: column; gap: 18px; }
.biz-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.biz-head h4 { margin: 0; font-size: 15px; }
.biz-head code, .waba-head code, .num-id { font: 12px var(--mono); color: var(--ink-3); }
.waba { border: 1px solid var(--line); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 12px; background: var(--panel); }
.waba-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.waba-head b { font-size: 14px; }
.waba-head .btn { margin-left: auto; }
.inline-form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.inline-form input { border: 1px solid var(--line); border-radius: 8px; background: var(--panel-2); padding: 7px 10px; min-width: 0; font-size: 13.5px; }
.inline-form input:focus { outline: none; border-color: var(--green); }
.inline-form .cc { width: 64px; }
.inline-form .grow { flex: 1 1 160px; }
.num { border-top: 1px solid var(--line); padding-top: 12px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 14px; }
.num:first-of-type { border-top: 0; padding-top: 0; }
.num-who b { display: block; font-size: 15px; font-variant-numeric: tabular-nums; }
.num-who span { color: var(--ink-2); font-size: 13px; }
.num-badges { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; align-content: flex-start; }
.badge { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 600; background: var(--panel-2); color: var(--ink-3); }
.badge.ok { background: rgba(0, 168, 132, 0.14); color: var(--green); }
.badge.warn { background: rgba(255, 176, 46, 0.16); color: var(--mock); }
.badge.bad { background: rgba(234, 0, 56, 0.1); color: var(--danger); }
.num-body { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 10px; }
.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; counter-reset: step; }
.steps li { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 10px; align-items: start; counter-increment: step; }
.steps li::before { content: counter(step); width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 700; background: var(--panel-2); color: var(--ink-3); }
.steps li.done::before { content: ""; background: var(--green); box-shadow: inset 0 0 0 7px var(--green), inset 0 0 0 9px #fff; }
.steps li.now::before { background: var(--green); color: var(--green-ink); }
.steps .step-text { font-size: 13px; color: var(--ink-2); padding-top: 3px; }
.steps .step-text b { color: var(--ink); font-weight: 600; }
.sms { display: inline-flex; align-items: center; gap: 8px; margin-top: 6px; padding: 6px 10px; border-radius: 10px; background: var(--green-soft); color: var(--ink); font-size: 13px; }
.sms code { font: 600 16px var(--mono); letter-spacing: 0.18em; }
.toggles { display: flex; flex-wrap: wrap; gap: 8px 20px; }
.toggle { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
.toggle input { accent-color: var(--green); width: 16px; height: 16px; }
.num-foot { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; font-size: 12.5px; color: var(--ink-3); }
.num-foot .btn { margin-left: auto; }

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
.as { display: flex; flex: none; align-self: center; gap: 2px; padding: 3px; border-radius: 20px; background: var(--panel); }
.as button { border: 0; background: transparent; border-radius: 16px; padding: 6px 12px; font-size: 13px; color: var(--ink-2); }
.as button[aria-pressed="true"] { background: var(--green); color: var(--green-ink); font-weight: 600; }
.compose.owner textarea { box-shadow: inset 3px 0 0 var(--green); }
.compose textarea {
  width: 100%; flex: 1; resize: none; border: 0; border-radius: 8px; background: var(--panel); padding: 10px 12px;
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
/*
 * The control panel is a console that takes the whole screen: it sweeps in from
 * the right edge and the chat behind it never moves. A drawer that only pushed
 * a third column squeezed the chat and still had room for nothing else.
 */
.tools {
  position: fixed; inset: 0; z-index: 40;
  display: flex; flex-direction: column; min-height: 0;
  background: var(--panel);
  transform: translateX(100%); visibility: hidden;
  transition: transform 240ms cubic-bezier(0.4, 0, 1, 1), visibility 0s linear 240ms;
}
.app.with-tools .tools {
  transform: translateX(0); visibility: visible;
  transition: transform 360ms cubic-bezier(0.22, 1, 0.36, 1), visibility 0s;
}
.tools .bar { gap: 16px; }
.tools .bar h2 { flex: 1; margin: 0; font-size: 16px; font-weight: 500; }
.tools-body { flex: 1; min-height: 0; display: flex; }
/*
 * The sections become a rail. At full width a stretched tab bar would leave the
 * content floating in the middle of the screen; a rail keeps the reading column
 * anchored to the left edge, where the eye already is.
 */
.tabs { display: flex; flex-direction: column; gap: 2px; width: 216px; flex: none; padding: 14px 10px; border-right: 1px solid var(--line); }
.tab { flex: none; border: 0; background: transparent; padding: 10px 12px; border-radius: 8px; color: var(--ink-3); font-size: 13.5px; text-align: left; }
.tab:hover { background: var(--panel-2); }
.tab[aria-selected="true"] { color: var(--green); background: rgba(0, 128, 105, 0.1); font-weight: 600; }
@media (prefers-color-scheme: dark) { .tab[aria-selected="true"] { background: var(--green-soft); color: #d9fdd3; } }
.panes { flex: 1; min-width: 0; display: flex; }
.pane { flex: 1; overflow-y: auto; min-height: 0; padding: 26px 30px; display: flex; flex-direction: column; }
/*
 * The console is a workspace, not a reading column: the content fills the
 * width in blocks, and a long list breaks into columns of its own. A single
 * capped column would leave half the screen empty.
 */
.pane-grid, .split { flex: 1; min-height: 0; }
.pane-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 18px; align-items: stretch; }
@media (min-width: 1100px) { .pane-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.block { border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; background: var(--panel); display: flex; flex-direction: column; min-height: 0; }
.block > h3 { margin-top: 0; }
/* The action of a block sits at its foot, so the card reads as a whole. */
.block .push-bottom { margin-top: auto; }
.block form { display: flex; flex-direction: column; flex: 1; }
.block form button[type="submit"] { margin-top: auto; align-self: flex-start; }
.pane[hidden] { display: none; }
.pane h3 { font-size: 14px; font-weight: 600; margin: 0 0 6px; }
.pane p.help { margin: 0 0 14px; color: var(--ink-3); font-size: 13px; }
.pane-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.pane-head p.help { margin: 0; }
.field { display: block; margin-bottom: 12px; }
.field > span { display: block; font-size: 13px; color: var(--green); margin-bottom: 4px; }
.field input, .field textarea, .field select {
  width: 100%; border: 0; border-bottom: 2px solid var(--line); background: transparent; padding: 6px 0;
}
.field input:focus, .field textarea:focus { outline: none; border-bottom-color: var(--green); }
.seg { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border-radius: 10px; background: var(--panel-2); padding: 3px; margin-bottom: 10px; max-width: 340px; }
.seg button { border: 0; border-radius: 8px; background: transparent; padding: 8px; color: var(--ink-2); }
.seg button[aria-pressed="true"] { background: var(--panel); color: var(--ink); font-weight: 600; box-shadow: var(--shadow); }
.kv { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 12px; font-size: 13px; margin: 0 0 16px; }
.kv dt { color: var(--ink-3); }
.kv dd { margin: 0; overflow-wrap: anywhere; }
.pill { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 2px 9px; border-radius: 10px; background: var(--panel-2); color: var(--ink-2); }
.pill.ok { background: var(--green-soft); color: var(--green); }
.pill.bad { background: rgba(234, 0, 56, 0.1); color: var(--danger); }
@media (prefers-color-scheme: dark) { .pill.ok { color: #d9fdd3; } }
.events { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; align-items: start; }
.event { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
.event > button { width: 100%; border: 0; background: transparent; padding: 10px 12px; text-align: left; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; }
.event .ev-kind { font-weight: 500; }
.event .ev-url, .event .ev-time { font-size: 12px; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.event pre { margin: 0; padding: 10px 12px; border-top: 1px solid var(--line); background: var(--panel-2); font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-x: auto; max-height: 320px; }
/* The template list: one column of what exists, one column of what it is. */
.split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 18px; align-items: start; }
@media (min-width: 900px) { .split { grid-template-columns: 300px minmax(0, 1fr); } }
.tpl-list { display: flex; flex-direction: column; gap: 8px; }
.tpl-item { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; text-align: left; border: 1px solid var(--line); border-radius: 10px; background: transparent; padding: 10px 12px; }
.tpl-item:hover { background: var(--panel-2); }
.tpl-item.on { border-color: var(--green); background: rgba(0, 128, 105, 0.1); }
.tpl-item b { font-weight: 600; }
.tpl-item small { color: var(--ink-3); }
.tpl-item .tpl-preview { font-size: 12.5px; color: var(--ink-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
@media (prefers-color-scheme: dark) { .tpl-item.on { background: var(--green-soft); } }
.tpl-examples { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; padding-top: 10px; border-top: 1px dashed var(--line); }
.tpl-examples > summary { display: flex; align-items: center; gap: 8px; cursor: pointer; list-style: none; padding: 4px 2px; font-size: 13px; color: var(--ink-2); border-radius: 6px; }
.tpl-examples > summary::-webkit-details-marker { display: none; }
.tpl-examples > summary::before { content: ""; width: 7px; height: 7px; border-right: 1.6px solid currentColor; border-bottom: 1.6px solid currentColor; transform: rotate(-45deg); transition: transform 0.15s ease; margin: 0 2px; }
.tpl-examples[open] > summary::before { transform: rotate(45deg); }
.tpl-examples > summary b { font-weight: 600; }
.tpl-examples-count { min-width: 20px; padding: 0 6px; border-radius: 10px; background: var(--panel-2); color: var(--ink-3); font-size: 11.5px; text-align: center; }
.tpl-examples .help { margin: 0 0 4px; font-size: 12px; }
.tpl-examples[open] { gap: 8px; }
/*
 * A select of our own: the native dropdown cannot be styled, and these fields
 * need the friendly label next to the raw value.
 */
.sel { position: relative; }
.sel-trigger { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; border: 1px solid var(--line); border-radius: 8px; background: var(--panel-2); padding: 8px 10px; color: var(--ink); text-align: left; }
.sel-trigger:hover { border-color: var(--ink-3); }
.sel-trigger[aria-expanded="true"] { border-color: var(--green); }
.sel-trigger:disabled { opacity: 0.6; cursor: default; }
.sel-value { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.sel-value b { font-weight: 500; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sel-value small { color: var(--ink-3); font-size: 11.5px; white-space: nowrap; }
.sel-caret { color: var(--ink-3); transition: transform 0.15s; }
.sel-trigger[aria-expanded="true"] .sel-caret { transform: rotate(180deg); }
.sel-menu { position: absolute; z-index: 6; left: 0; right: 0; top: calc(100% + 6px); max-height: 280px; overflow-y: auto; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); box-shadow: 0 10px 28px rgba(11, 20, 26, 0.2); padding: 6px; display: none; }
.sel-menu[data-open="true"] { display: block; }
.sel-option { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%; border: 0; background: transparent; border-radius: 8px; padding: 8px 10px; text-align: left; color: var(--ink); }
.sel-option:hover { background: var(--panel-2); }
.sel-option[aria-selected="true"] { color: var(--green); }
.sel-option small { color: var(--ink-3); font-size: 12px; }
/* The template form: the name and the options are a header, the body is the work. */
.tpl-meta { display: grid; grid-template-columns: minmax(140px, 1.4fr) repeat(3, minmax(0, 1fr)); gap: 12px; align-items: end; margin-bottom: 14px; }
.tpl-meta-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.tpl-meta-field > span { font-size: 11px; letter-spacing: 0.04em; color: var(--ink-3); }
.tpl-meta-field input { border: 1px solid var(--line); border-radius: 8px; background: var(--panel-2); padding: 8px 10px; color: var(--ink); width: 100%; }
.tpl-meta-field input:focus { outline: none; border-color: var(--green); }
.tpl-reason { max-width: 420px; margin-bottom: 14px; }
.tpl-body { display: block; margin-bottom: 16px; }
.tpl-body > span { display: block; font-size: 11px; letter-spacing: 0.04em; color: var(--ink-3); margin-bottom: 6px; }
.tpl-body textarea { width: 100%; min-height: 180px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel-2); padding: 14px 16px; color: var(--ink); font: 15px/1.6 inherit; resize: vertical; }
.tpl-body textarea:focus { outline: none; border-color: var(--green); }
/* The variables the body asks for: an example and a description for each one. */
.vars { display: flex; flex-direction: column; gap: 8px; margin: 0 0 16px; }
.vars-head { font-size: 11px; letter-spacing: 0.04em; color: var(--ink-3); }
.var-row { display: grid; grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr); gap: 8px; align-items: center; }
.var-chip { display: flex; align-items: center; gap: 4px; font: 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--green); background: rgba(0, 128, 105, 0.1); border-radius: 6px; padding: 9px 4px 9px 8px; text-align: center; }
/* The variable is filled: the chip shows the value, in green and white. */
.var-chip.filled { color: var(--var-fill-ink); background: var(--var-fill); font-family: inherit; font-size: 13px; padding: 9px 4px 9px 9px; }
.var-input { border: 1px solid var(--line); border-radius: 8px; background: var(--panel-2); padding: 9px 10px; color: var(--ink); width: 100%; }
.var-input:focus { outline: none; border-color: var(--green); }
/* The × that deletes a variable: in the row and in the body. */
.var-x { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; flex: none; border: 0; border-radius: 5px; background: transparent; color: inherit; font-size: 14px; line-height: 1; cursor: pointer; opacity: .7; }
.var-x:hover { opacity: 1; background: rgba(0, 0, 0, .08); }
.var-row > .var-x { color: var(--ink-3); }
/* The body with the variables filled: what the patient will read. */
.tpl-preview { margin-top: 10px; padding: 10px 12px; border: 1px dashed var(--line); border-radius: 10px; background: var(--panel-2); font-size: 14px; line-height: 1.65; color: var(--ink-2); white-space: pre-wrap; overflow-wrap: anywhere; }
.tpl-preview-head { display: block; font-size: 10.5px; letter-spacing: 0.07em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 6px; }
.var-fill { display: inline-flex; align-items: center; gap: 3px; padding: 0 5px; border-radius: 5px; background: var(--var-fill); color: var(--var-fill-ink); font-weight: 500; }
.var-fill.empty { background: transparent; color: var(--ink-3); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
.var-fill .var-x { color: var(--var-fill-ink); opacity: .85; }
.var-fill .var-x:hover { background: rgba(0, 0, 0, .18); }
@media (max-width: 900px) { .tpl-meta { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 760px) { .var-row { grid-template-columns: auto minmax(0, 1fr); } }
@media (prefers-color-scheme: dark) { .var-chip { background: var(--green-soft); color: #d9fdd3; } .var-chip.filled { color: var(--var-fill-ink); background: var(--var-fill); } }
.actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 4px; }
.danger-zone { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); }

/*
 * The review is a test knob, not the work: it sits under the body and the
 * variables, small and quiet, and only speaks up when the send will fail.
 */
.tpl-review { display: flex; align-items: flex-end; gap: 16px; flex-wrap: wrap; margin: 2px 0 14px; padding-top: 14px; border-top: 1px solid var(--line); }
.tpl-review-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.tpl-review-field > span { font-size: 10.5px; letter-spacing: 0.07em; text-transform: uppercase; color: var(--ink-3); }
.tpl-review .sel { width: 230px; }
.tpl-review .sel-trigger { background: transparent; padding: 6px 9px; }
.tpl-review .sel-value b { font-size: 12.5px; font-weight: 500; color: var(--ink-2); }
.tpl-review input { border: 1px solid var(--line); border-radius: 8px; background: transparent; padding: 6px 9px; color: var(--ink-2); width: 100%; max-width: 340px; }
.tpl-review input:focus { outline: none; border-color: var(--green); }
.tpl-review .sel[data-tone="warn"] .sel-trigger { border-color: rgba(234, 0, 56, 0.45); }
.tpl-review .sel[data-tone="warn"] .sel-value b { color: var(--danger); }

/* The response timer: a number, a unit and a save. */
.delay { display: flex; align-items: flex-end; gap: 8px; flex: none; }
.block .delay { flex-direction: row; }
.delay-field { display: flex; align-items: baseline; gap: 6px; }
.delay-field > span { font-size: 11px; letter-spacing: 0.04em; color: var(--ink-3); white-space: nowrap; }
.delay-field input { width: 74px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel-2); padding: 6px 9px; color: var(--ink); text-align: right; }
.delay-field input.wide { width: 230px; text-align: left; }
.delay-field input:focus { outline: none; border-color: var(--green); }
.delay-field input[readonly] { color: var(--ink-3); }
.delay-field small { color: var(--ink-3); font-size: 11.5px; }
.block .delay button[type="submit"] { margin-top: 0; align-self: flex-end; }

/*
 * The api reference. One reading column of topics and a table of contents on
 * the right that follows the scroll. The one loud idea of the console lives
 * here: what Meta has is drawn green, what only the mock has is drawn amber,
 * from the topic rule down to the header line inside a curl.
 */
.pane-api { padding: 0; }
.api-layout { display: grid; grid-template-columns: minmax(0, 1fr) 248px; gap: 40px; padding: 28px 32px 80px; align-items: start; }
.api-main { min-width: 0; max-width: 980px; }
.api-intro h3 { font-size: 20px; font-weight: 600; margin: 0 0 6px; letter-spacing: -0.01em; }
.api-intro p.help { max-width: 68ch; font-size: 13.5px; line-height: 1.55; }
.api-base { display: inline-flex; align-items: center; gap: 10px; margin: 2px 0 14px; padding: 6px 6px 6px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel-2); font-size: 12px; color: var(--ink-3); }
.api-base code { font: 600 12.5px/1 var(--mono); color: var(--ink); background: var(--panel); padding: 5px 8px; border-radius: 6px; }
.api-legend { list-style: none; margin: 0 0 6px; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 22px; font-size: 12.5px; color: var(--ink-3); }
.api-legend li { display: flex; align-items: baseline; gap: 8px; }
.api-legend li::before { content: ""; width: 10px; height: 10px; border-radius: 3px; align-self: center; flex: none; }
.api-legend li[data-kind="meta"]::before { background: var(--green); }
.api-legend li[data-kind="mock"]::before { background: var(--mock); }
.api-legend b { color: var(--ink-2); font-weight: 600; }

.topic { margin-top: 40px; padding-top: 18px; border-top: 2px solid var(--green); scroll-margin-top: 18px; }
.topic[data-kind="mock"] { border-top-color: var(--mock); }
.topic-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.topic h4 { margin: 0; font-size: 17px; font-weight: 600; letter-spacing: -0.005em; }
.topic-kind { font-size: 12px; font-weight: 600; color: var(--green); }
.topic[data-kind="mock"] .topic-kind { color: var(--mock); }
.topic > p { margin: 6px 0 0; max-width: 72ch; color: var(--ink-3); font-size: 13px; line-height: 1.55; }
.hdr-table { margin: 14px 0 0; border-collapse: collapse; width: 100%; font-size: 12.5px; }
.hdr-table th, .hdr-table td { text-align: left; padding: 7px 12px 7px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
.hdr-table th { font-weight: 500; color: var(--ink-3); }
.hdr-table code { font: 12px/1.4 var(--mono); color: var(--mock); white-space: nowrap; }
.hdr-table td:last-child { color: var(--ink-2); }

.ep { padding: 22px 0 4px; scroll-margin-top: 18px; }
.ep + .ep { border-top: 1px dashed var(--line); }
.ep-line { display: flex; align-items: center; gap: 10px; min-width: 0; }
.ep-method { flex: none; min-width: 56px; text-align: center; font: 700 11px/1 var(--mono); padding: 5px 7px; border-radius: 6px; background: var(--panel-2); color: var(--ink-2); }
.ep-method[data-method="GET"] { background: rgba(0, 128, 105, 0.13); color: var(--green); }
.ep-method[data-method="POST"] { background: rgba(2, 126, 181, 0.13); color: #027eb5; }
.ep-method[data-method="DELETE"] { background: rgba(234, 0, 56, 0.12); color: var(--danger); }
.ep-path { font: 600 14px/1.4 var(--mono); overflow-wrap: anywhere; min-width: 0; }
.ep-path i { font-style: normal; color: var(--ink-3); font-weight: 500; }
.ep-method[data-method="PUT"] { background: rgba(154, 91, 0, 0.13); color: var(--mock); }
.ep-state { margin-left: auto; flex: none; display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--ink-3); white-space: nowrap; }
.ep-state::before { content: ""; width: 7px; height: 7px; border-radius: 50%; border: 1.5px solid currentColor; }
.ep-state[data-simulated="true"] { color: var(--green); }
.ep-state[data-simulated="true"]::before { background: currentColor; }
.ep-summary { margin: 10px 0 0; font-size: 15px; font-weight: 600; letter-spacing: -0.005em; }
.ep-desc { margin: 6px 0 0; font-size: 13.5px; line-height: 1.6; color: var(--ink-2); max-width: 72ch; }
.ep-desc p, .ep-desc ul { margin: 0 0 8px; }
.ep-desc ul { padding-left: 18px; }
.ep-desc h6 { margin: 12px 0 4px; font-size: 12.5px; font-weight: 600; color: var(--ink-2); }
.ep-desc code { font: 12px/1.4 var(--mono); padding: 1px 5px; border-radius: 5px; background: var(--panel-2); color: var(--ink); overflow-wrap: anywhere; }
.ep-desc a, .topic a { color: var(--green); text-underline-offset: 2px; }
.ep-desc.clamped { max-height: 7.4em; overflow: hidden; -webkit-mask-image: linear-gradient(#000 60%, transparent); mask-image: linear-gradient(#000 60%, transparent); }
.ep-more { border: 0; background: none; padding: 2px 0; color: var(--green); font-size: 12.5px; font-weight: 500; }
.ep-more:hover { text-decoration: underline; }
.q-table code { color: var(--ink); }
.q-req { color: var(--danger); font-size: 11.5px; white-space: nowrap; }
.ep-code { margin-top: 14px; border-radius: 10px; background: var(--panel-2); border: 1px solid var(--line); overflow: hidden; }
.ep-bar { display: flex; align-items: center; gap: 10px; padding: 6px 8px 6px 12px; border-bottom: 1px solid var(--line); min-height: 40px; }
.ep-example { flex: 0 1 340px; min-width: 0; }
.ep-example .sel-trigger { padding: 5px 10px; min-height: 0; }
.ep-example-name { font-size: 12.5px; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ep-code pre { margin: 0; padding: 14px 16px; font: 12.5px/1.65 var(--mono); overflow-x: auto; white-space: pre; color: var(--ink-2); max-height: 420px; }
.ep-code .mock-line { color: var(--mock); }
.ep-copy { margin-left: auto; flex: none; border: 1px solid var(--line); border-radius: 7px; background: var(--panel); color: var(--ink-3); font-size: 12px; padding: 4px 10px; }
.ep-response { margin-top: 8px; font-size: 12.5px; }
.ep-response summary { cursor: pointer; color: var(--ink-3); padding: 4px 0; width: max-content; }
.ep-response summary:hover { color: var(--ink); }
.ep-response pre { margin: 6px 0 0; padding: 12px 16px; border-radius: 10px; border: 1px solid var(--line); font: 12px/1.6 var(--mono); overflow: auto; max-height: 360px; color: var(--ink-2); }
.topic-count { font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.topic > .ep-desc { color: var(--ink-3); font-size: 13px; }
.api-legend li[data-kind="state"]::before { background: transparent; border: 1.5px solid var(--green); border-radius: 50%; box-shadow: inset 0 0 0 2px var(--panel), inset 0 0 0 6px var(--green); }
.api-filter { display: flex; align-items: center; gap: 10px; margin: 16px 0 0; max-width: 520px; }
.api-filter input { flex: 1; min-width: 0; border: 1px solid var(--line); border-radius: 9px; background: var(--panel-2); padding: 9px 12px; color: var(--ink); font: inherit; font-size: 13.5px; }
.api-filter input:focus { outline: none; border-color: var(--green); box-shadow: 0 0 0 3px rgba(0, 128, 105, 0.15); }
.api-filter small { color: var(--ink-3); font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.ep-copy:hover { color: var(--ink); border-color: var(--ink-3); }
.ep-copy[data-done="true"] { color: var(--green); border-color: var(--green); }

.api-toc { position: sticky; top: 28px; max-height: calc(100vh - 140px); overflow-y: auto; font-size: 13px; padding-left: 14px; border-left: 1px solid var(--line); }
.api-toc > b { display: block; font-size: 12px; font-weight: 600; color: var(--ink-3); margin: 2px 0 10px; }
.toc-topic { display: block; position: relative; padding: 5px 0; color: var(--ink-2); text-decoration: none; font-weight: 500; }
.toc-topic::before { content: ""; position: absolute; left: -15px; top: 4px; bottom: 4px; width: 2px; border-radius: 2px; background: transparent; }
.toc-topic[aria-current="true"] { color: var(--ink); }
.toc-topic[aria-current="true"]::before { background: var(--green); }
.toc-topic[data-kind="mock"][aria-current="true"]::before { background: var(--mock); }
.toc-eps { list-style: none; margin: 0 0 8px; padding: 0; display: none; }
.toc-topic[aria-current="true"] + .toc-eps, .toc-eps.open { display: block; }
.toc-eps[hidden], .toc-topic[hidden], .toc-eps li[hidden] { display: none; }
.toc-ep { display: flex; align-items: baseline; gap: 7px; padding: 3px 0 3px 2px; color: var(--ink-3); text-decoration: none; font-size: 12.5px; }
.toc-ep:hover, .toc-topic:hover { color: var(--ink); }
.toc-ep[aria-current="true"] { color: var(--ink); }
.toc-ep b { font: 700 9.5px/1 var(--mono); width: 34px; flex: none; color: var(--ink-3); }
.toc-ep span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.toc-divider { margin: 14px 0 8px; font-size: 11.5px; color: var(--mock); font-weight: 600; }
@media (max-width: 1180px) {
  .api-layout { grid-template-columns: minmax(0, 1fr); padding: 22px 20px 60px; }
  .api-toc { display: none; }
}
@media (prefers-color-scheme: dark) {
  .ep-method[data-method="POST"] { color: #6fc2f0; }
}

/* What only the mock understands: a knob drawn in amber, so it never passes for Meta. */
.mock-knob { border-left: 3px solid var(--mock); background: var(--mock-soft); border-radius: 0 10px 10px 0; }
.mock-knob small { font: 11px/1.3 var(--mono); color: var(--mock); }
.check { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; margin: 2px 0 16px; cursor: pointer; }
.check input { margin-top: 3px; accent-color: var(--mock); }
.check b { display: block; font-weight: 500; font-size: 13px; }
.tab { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.tab-count { font-size: 11.5px; font-weight: 600; color: var(--ink-3); min-width: 20px; text-align: right; }
.tab-count:empty { display: none; }
.tpl-form-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
.tpl-form-head h3 { margin: 0; font-size: 16px; }
.tpl-id { font: 11.5px/1 var(--mono); color: var(--ink-3); margin-left: auto; }
.tpl-status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; padding: 3px 9px; border-radius: 999px; background: var(--panel-2); color: var(--ink-2); }
.tpl-status::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.tpl-status[data-status="APPROVED"] { color: var(--green); background: rgba(0, 128, 105, 0.12); }
.tpl-status[data-status="PENDING"] { color: var(--mock); background: var(--mock-soft); }
.tpl-status[data-status="PENDING"]::before { animation: pulse 1.2s ease-in-out infinite; }
.tpl-status[data-status="REJECTED"], .tpl-status[data-status="DISABLED"] { color: var(--danger); background: rgba(234, 0, 56, 0.1); }
.tpl-status[data-status="PAUSED"] { color: var(--ink-2); }
@keyframes pulse { 50% { opacity: 0.25; } }
.tpl-item-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; }
.tpl-item .tpl-status { font-size: 10.5px; padding: 2px 7px; }
fieldset.tpl-review { border: 0; border-left: 3px solid var(--mock); margin: 4px 0 14px; padding: 12px 14px; align-items: flex-end; }
fieldset.tpl-review legend { float: left; width: 100%; padding: 0; margin-bottom: 10px; font-size: 12.5px; font-weight: 600; color: var(--ink-2); }
fieldset.tpl-review legend small { font-weight: 400; margin-left: 6px; }
.tpl-wait-input { display: inline-flex; align-items: center; gap: 6px; }
.tpl-review .tpl-wait-input input { width: 64px; text-align: right; }
.dest { list-style: none; margin: 0 0 16px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.dest li { display: grid; grid-template-columns: minmax(0, 160px) minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 8px; background: var(--panel-2); font-size: 12.5px; }
.dest code { font: 12px/1.4 var(--mono); overflow-wrap: anywhere; }
.dest .who { color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dest button { border: 0; background: transparent; color: var(--ink-3); font-size: 12px; padding: 3px 6px; border-radius: 6px; }
.dest button:hover { color: var(--danger); background: rgba(234, 0, 56, 0.08); }
@media (prefers-reduced-motion: reduce) { .tpl-status[data-status="PENDING"]::before { animation: none; } }

/* ---------- dialog / toast ---------- */
dialog { border: 0; border-radius: 12px; padding: 0; width: min(440px, 92vw); background: var(--panel); color: var(--ink); box-shadow: 0 17px 50px rgba(11, 20, 26, 0.19); }
dialog::backdrop { background: rgba(11, 20, 26, 0.45); }
dialog form { padding: 22px 24px 18px; }
dialog h2 { margin: 0 0 4px; font-size: 18px; font-weight: 500; }
dialog p.help { margin: 0 0 16px; color: var(--ink-3); font-size: 13px; }
dialog .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 60;
  background: #3b4a54; color: #fff; padding: 10px 18px; border-radius: 8px; font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.25);
  opacity: 0; pointer-events: none; transition: opacity 0.2s;
}
.toast[data-show="true"] { opacity: 1; }
.toast.err { background: #b3002a; }

@media (max-width: 960px) {
  /* No room for a rail: the sections go back to a row under the title. */
  .tools-body { flex-direction: column; }
  .tabs { width: auto; flex-direction: row; gap: 0; padding: 0; border-right: 0; border-bottom: 1px solid var(--line); overflow-x: auto; }
  .tab { flex: 1; border-radius: 0; border-bottom: 3px solid transparent; text-align: center; padding: 14px 4px; }
  .tab:hover { background: transparent; }
  .tab[aria-selected="true"] { background: transparent; border-bottom-color: var(--green); }
  .pane { padding: 18px 16px; }
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
  <aside class="side" aria-label="Conversas" data-t-aria="Conversas">
    <div class="bar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3a.5.5 0 0 0 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.3c0-.1-.2-.2-.4-.3Z"/></svg>
        </div>
        <div>
          <div class="brand-name">WhatsApp Business</div>
          <div class="brand-sub"><span class="dot" id="live-dot"></span><span id="live-text" data-t="conectando…">conectando…</span></div>
        </div>
      </div>
      <div class="lang" role="group" aria-label="Idioma da página" data-t-aria="Idioma da página">
        <button type="button" data-lang="pt" aria-pressed="true" title="Português (BR)">PT</button>
        <button type="button" data-lang="en" aria-pressed="false" title="English (US)">EN</button>
      </div>
      <button class="icon-btn" id="new-chat" type="button" aria-label="Nova conversa como usuário" data-t-aria="Nova conversa como usuário" title="Nova conversa" data-t-title="Nova conversa">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 20l1.3-3.9A8 8 0 1 1 8.6 19L4 20Z"/><path d="M12 8.5v7M8.5 12h7"/></svg>
      </button>
      <button class="icon-btn" id="toggle-tools" type="button" aria-label="Painel de controle" data-t-aria="Painel de controle" aria-pressed="false" title="Painel de controle" data-t-title="Painel de controle">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>
      </button>
    </div>
    <label class="number"><span data-t="Número da clínica">Número da clínica</span>
      <select id="business"><option value="" data-t="Todos os números">Todos os números</option></select>
    </label>
    <div class="search">
      <div class="search-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg>
        <input id="search" type="search" placeholder="Pesquisar por nome ou número" data-t-placeholder="Pesquisar por nome ou número" aria-label="Pesquisar conversas" data-t-aria="Pesquisar conversas">
      </div>
    </div>
    <div class="filters" role="group" aria-label="Filtro" data-t-aria="Filtro">
      <button class="filter" type="button" data-filter="all" aria-pressed="true" data-t="Tudo">Tudo</button>
      <button class="filter" type="button" data-filter="unread" aria-pressed="false" data-t="Não lidas">Não lidas</button>
      <button class="filter" type="button" data-filter="awaiting" aria-pressed="false" data-t="Sem resposta da clínica">Sem resposta da clínica</button>
    </div>
    <ul class="threads" id="threads"></ul>
  </aside>

  <main class="chat" id="chat">
    <section class="welcome" id="welcome">
      <div>
        <div class="art" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 20l1.3-3.9A8 8 0 1 1 8.6 19L4 20Z"/><path d="M9 10h6M9 13.5h4"/></svg>
        </div>
        <h1 data-t="Conversas do mock">Conversas do mock</h1>
        <p data-t="As mensagens que a aplicação envia pela API do WhatsApp aparecem aqui, com os tiques de entrega e leitura.">As mensagens que a aplicação envia pela API do WhatsApp aparecem aqui, com os tiques de entrega e leitura.</p>
        <p data-t="Para testar a entrada, fale como usuário: a mensagem chega à aplicação pelo webhook.">Para testar a entrada, fale como usuário: a mensagem chega à aplicação pelo webhook.</p>
        <div class="actions">
          <button class="btn" type="button" id="welcome-new" data-t="Nova conversa como usuário">Nova conversa como usuário</button>
          <button class="btn ghost" type="button" id="welcome-tools" data-t="Abrir painel de controle">Abrir painel de controle</button>
        </div>
      </div>
    </section>
    <header class="chat-head" id="chat-head" hidden>
      <button class="icon-btn back" id="back" type="button" aria-label="Voltar para as conversas" data-t-aria="Voltar para as conversas">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg>
      </button>
      <div class="avatar" id="head-avatar" aria-hidden="true"></div>
      <div class="who"><b id="head-name"></b><span id="head-sub"></span></div>
      <button class="icon-btn" id="call-btn" type="button" aria-label="Ligar" data-t-aria="Ligar">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z"/></svg>
      </button>
      <button class="icon-btn" id="read-all" type="button" aria-label="Marcar todas as mensagens da clínica como lidas" data-t-aria="Marcar todas as mensagens da clínica como lidas" title="Marcar tudo como lido" data-t-title="Marcar tudo como lido">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 13l4 4 8-9"/><path d="M10 15l2 2 8-9"/></svg>
      </button>
    </header>
    <div class="stream" id="stream" hidden aria-live="polite"></div>
    <form class="compose" id="compose" hidden>
      <div class="quick" id="quick" aria-label="Respostas rápidas" data-t-aria="Respostas rápidas"></div>
      <div class="compose-line">
        <div class="as" role="group" aria-label="Responder como" data-t-aria="Responder como">
          <button type="button" data-as="user" aria-pressed="true" title="A mensagem entra pelo webhook, como se o usuário tivesse escrito" data-t-title="A mensagem entra pelo webhook, como se o usuário tivesse escrito" data-t="Usuário">Usuário</button>
          <button type="button" data-as="owner" aria-pressed="false" title="A mensagem sai pela API do WhatsApp, como a aplicação enviaria" data-t-title="A mensagem sai pela API do WhatsApp, como a aplicação enviaria" data-t="Dono">Dono</button>
        </div>
        <button class="icon-btn attach" type="button" id="attach" aria-label="Anexar arquivo" data-t-aria="Anexar arquivo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m21 11.5-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.9-8.9a3.7 3.7 0 0 1 5.2 5.2l-8.9 8.9a1.8 1.8 0 0 1-2.6-2.6l8.2-8.2"/></svg>
        </button>
        <input type="file" id="attach-file" hidden accept="image/jpeg,image/png,image/webp,video/mp4,video/3gpp,audio/aac,audio/amr,audio/mpeg,audio/mp4,audio/ogg,text/plain,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation">
        <div class="compose-field">
          <div class="attachment" id="attachment" hidden></div>
          <label class="sr" for="reply" id="reply-label" data-t="Responder como usuário">Responder como usuário</label>
          <textarea id="reply" rows="1" placeholder="Responder como usuário" data-t-placeholder="Responder como usuário"></textarea>
        </div>
        <button class="send" id="send" type="submit" aria-label="Enviar como usuário" data-t-aria="Enviar como usuário" disabled>
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z"/></svg>
        </button>
        <button class="send voice" id="voice" type="button" aria-label="Gravar mensagem de voz" data-t-aria="Gravar mensagem de voz" hidden>
          <svg viewBox="0 0 24 24" fill="currentColor"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="recorder" id="recorder" hidden>
        <button class="icon-btn" type="button" id="voice-cancel" aria-label="Descartar a gravação" data-t-aria="Descartar a gravação">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
        </button>
        <span class="rec-dot" aria-hidden="true"></span>
        <span class="rec-time" id="voice-time">0:00</span>
        <canvas class="rec-wave" id="voice-wave" width="480" height="40" aria-hidden="true"></canvas>
        <button class="send" type="button" id="voice-send" aria-label="Enviar mensagem de voz" data-t-aria="Enviar mensagem de voz">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z"/></svg>
        </button>
      </div>
      <div class="compose-hint" id="compose-hint" data-t="Enter envia · Shift+Enter quebra a linha">Enter envia · Shift+Enter quebra a linha</div>
    </form>
    <section class="call" id="call" role="dialog" aria-modal="false" aria-labelledby="call-name" hidden>
      <div class="call-top">
        <span class="call-lock"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V7a3 3 0 0 0-6 0z" fill="currentColor"/></svg><span data-t="Criptografada de ponta a ponta">Criptografada de ponta a ponta</span></span>
        <span class="call-role" id="call-role"></span>
      </div>
      <div class="call-who">
        <div class="call-avatar" id="call-avatar"></div>
        <h2 class="call-name" id="call-name"></h2>
        <p class="call-state" id="call-state" aria-live="polite"></p>
      </div>
      <p class="call-note" id="call-note" hidden></p>
      <div class="call-actions" id="call-actions"></div>
      <audio id="call-audio" autoplay></audio>
    </section>
  </main>

  <aside class="tools" id="tools" aria-label="Painel de controle" data-t-aria="Painel de controle" aria-hidden="true">
    <div class="bar">
      <h2 data-t="Painel de controle">Painel de controle</h2>
      <div class="lang" role="group" aria-label="Idioma da página" data-t-aria="Idioma da página">
        <button type="button" data-lang="pt" aria-pressed="true" title="Português (BR)">PT</button>
        <button type="button" data-lang="en" aria-pressed="false" title="English (US)">EN</button>
      </div>
      <button class="icon-btn" id="close-tools" type="button" aria-label="Fechar painel" data-t-aria="Fechar painel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
    </div>
    <div class="tools-body">
      <nav class="tabs" role="tablist">
        <button class="tab" role="tab" type="button" id="tab-delivery" aria-controls="pane-delivery" aria-selected="true" data-t="Entrega">Entrega</button>
        <button class="tab" role="tab" type="button" id="tab-webhook" aria-controls="pane-webhook" aria-selected="false" data-t="Webhook">Webhook</button>
        <button class="tab" role="tab" type="button" id="tab-events" aria-controls="pane-events" aria-selected="false"><span data-t="Eventos">Eventos</span><span class="tab-count" id="count-events"></span></button>
        <button class="tab" role="tab" type="button" id="tab-templates" aria-controls="pane-templates" aria-selected="false"><span data-t="Templates">Templates</span><span class="tab-count" id="count-templates"></span></button>
        <button class="tab" role="tab" type="button" id="tab-numbers" aria-controls="pane-numbers" aria-selected="false"><span data-t="Números">Números</span><span class="tab-count" id="count-numbers"></span></button>
        <button class="tab" role="tab" type="button" id="tab-api" aria-controls="pane-api" aria-selected="false" data-t="API">API</button>
      </nav>
      <div class="panes">
        <section class="pane" id="pane-delivery" role="tabpanel" aria-labelledby="tab-delivery">
          <div class="pane-grid">
            <div class="block">
              <h3 data-t="Como as mensagens da clínica avançam">Como as mensagens da clínica avançam</h3>
              <p class="help" data-t="Automática: cada mensagem enviada vira entregue e lida em poucos segundos, como um usuário atento. Manual: ela fica como enviada até você marcar entregue, lida ou falha no menu da mensagem.">Automática: cada mensagem enviada vira entregue e lida em poucos segundos, como um usuário atento. Manual: ela fica como enviada até você marcar entregue, lida ou falha no menu da mensagem.</p>
              <div class="seg" role="group" aria-label="Modo de entrega" data-t-aria="Modo de entrega">
                <button type="button" data-mode="auto" aria-pressed="false" data-t="Automática">Automática</button>
                <button type="button" data-mode="manual" aria-pressed="false" data-t="Manual">Manual</button>
              </div>
              <dl class="kv" id="server-kv"></dl>
            </div>
            <div class="block">
              <h3 data-t="Começar do zero">Começar do zero</h3>
              <p class="help" data-t="Apaga todas as conversas e o histórico de eventos deste mock. A aplicação não é avisada.">Apaga todas as conversas e o histórico de eventos deste mock. A aplicação não é avisada.</p>
              <button class="btn danger" type="button" id="clear-all" data-t="Apagar todas as conversas">Apagar todas as conversas</button>
            </div>
          </div>
        </section>
        <section class="pane" id="pane-webhook" role="tabpanel" aria-labelledby="tab-webhook" hidden>
          <div class="pane-grid">
            <div class="block">
              <h3 data-t="Para onde vão os eventos">Para onde vão os eventos</h3>
              <p class="help" data-t="O mock chama este endereço com cada mensagem do usuário e cada mudança de status, no formato da Cloud API. Endereços em localhost chegam à sua máquina mesmo com o mock em container.">O mock chama este endereço com cada mensagem do usuário e cada mudança de status, no formato da Cloud API. Endereços em localhost chegam à sua máquina mesmo com o mock em container.</p>
              <dl class="kv" id="webhook-kv"></dl>
              <ul class="dest" id="wh-dest"></ul>
            </div>
            <div class="block">
              <h3 data-t="Configurar o destino">Configurar o destino</h3>
              <p class="help" data-t="Igual à Meta: cada número aponta para o próprio endereço, e o mock chama o endereço com um desafio antes de aceitar.">Igual à Meta: cada número aponta para o próprio endereço, e o mock chama o endereço com um desafio antes de aceitar.</p>
              <form id="webhook-form">
                <label class="field"><span data-t="Número da clínica (phone number id)">Número da clínica (phone number id)</span><input id="wh-phone" required autocomplete="off"></label>
                <label class="field"><span data-t="Endereço do webhook">Endereço do webhook</span><input id="wh-url" required placeholder="localhost:8080/hooks/meta" autocomplete="off"></label>
                <label class="field"><span data-t="Token de verificação (opcional)">Token de verificação (opcional)</span><input id="wh-token" autocomplete="off"></label>
                <label class="check mock-knob">
                  <input type="checkbox" id="wh-skip">
                  <span>
                    <b data-t="Pular a verificação">Pular a verificação</b>
                    <small>X-Mock-Skip-Callback-Verification: true</small>
                  </span>
                </label>
                <button class="btn" type="submit" data-t="Salvar webhook">Salvar webhook</button>
              </form>
            </div>
          </div>
        </section>
        <section class="pane" id="pane-events" role="tabpanel" aria-labelledby="tab-events" hidden>
          <div class="block">
            <div class="pane-head">
              <div>
                <h3 data-t="Chamadas ao webhook">Chamadas ao webhook</h3>
                <p class="help" data-t="Cada tentativa de entrega, com a resposta da aplicação. Toque para ver o corpo enviado.">Cada tentativa de entrega, com a resposta da aplicação. Toque para ver o corpo enviado.</p>
              </div>
              <form class="delay" id="delay-form">
                <label class="delay-field">
                  <span data-t="Atraso da resposta">Atraso da resposta</span>
                  <input id="delay-seconds" type="number" min="0" max="600" step="1" value="5" inputmode="numeric">
                  <small data-t="segundos">segundos</small>
                </label>
                <button class="btn ghost" type="submit" data-t="Salvar">Salvar</button>
              </form>
            </div>
            <p class="help" data-t="O mock espera este tempo antes de entregar cada evento ao webhook: é a resposta de uma aplicação que demora para processar.">O mock espera este tempo antes de entregar cada evento ao webhook: é a resposta de uma aplicação que demora para processar.</p>
            <ul class="events" id="events"></ul>
          </div>
        </section>
        <section class="pane" id="pane-templates" role="tabpanel" aria-labelledby="tab-templates" hidden>
          <div class="pane-head">
            <div>
              <h3 data-t="Templates conhecidos">Templates conhecidos</h3>
              <p class="help" data-t="Os templates que a aplicação pode enviar. Um template fora desta lista é recusado como na Cloud API.">Os templates que a aplicação pode enviar. Um template fora desta lista é recusado como na Cloud API.</p>
            </div>
            <button class="btn ghost" type="button" id="tpl-new" data-t="Novo template">Novo template</button>
          </div>
          <div class="split">
            <div class="tpl-list" id="tpl-list"></div>
            <form class="block" id="tpl-form">
              <div class="tpl-form-head">
                <h3 id="tpl-title" data-t="Novo template">Novo template</h3>
                <span class="tpl-status" id="tpl-status" hidden></span>
                <code class="tpl-id" id="tpl-id" hidden></code>
              </div>
              <div class="tpl-meta">
                <label class="tpl-meta-field"><span data-t="Nome">Nome</span><input id="tpl-name" required autocomplete="off" placeholder="nome_do_template"></label>
                <div class="tpl-meta-field"><span data-t="Idioma">Idioma</span><div id="tpl-language"></div></div>
                <div class="tpl-meta-field"><span data-t="Tipo">Tipo</span><div id="tpl-category"></div></div>
              </div>
              <div class="tpl-builder">
                <div class="tpl-compose">
                  <section class="tpl-part">
                    <div class="tpl-part-head"><b data-t="Cabeçalho">Cabeçalho</b><small data-t="opcional">opcional</small></div>
                    <div class="chips" id="tpl-header-format" role="radiogroup" aria-label="Formato do cabeçalho" data-t-aria="Formato do cabeçalho">
                      <button type="button" role="radio" data-format="NONE" data-t="Nenhum">Nenhum</button>
                      <button type="button" role="radio" data-format="TEXT" data-t="Texto">Texto</button>
                      <button type="button" role="radio" data-format="IMAGE" data-t="Imagem">Imagem</button>
                      <button type="button" role="radio" data-format="VIDEO" data-t="Vídeo">Vídeo</button>
                      <button type="button" role="radio" data-format="DOCUMENT" data-t="Documento">Documento</button>
                      <button type="button" role="radio" data-format="LOCATION" data-t="Localização">Localização</button>
                    </div>
                    <div class="tpl-row" id="tpl-header-text-row" hidden>
                      <input id="tpl-header-text" maxlength="60" autocomplete="off" placeholder="Lembrete da sua consulta" data-t-placeholder="Lembrete da sua consulta">
                      <input id="tpl-header-example" autocomplete="off" placeholder="Exemplo de {{1}}" data-t-placeholder="Exemplo de {{1}}" hidden>
                    </div>
                    <div class="tpl-row" id="tpl-header-media-row" hidden>
                      <button class="btn ghost small" type="button" id="tpl-header-pick" data-t="Escolher arquivo de exemplo">Escolher arquivo de exemplo</button>
                      <input type="file" id="tpl-header-file" hidden>
                      <span class="tpl-sample" id="tpl-header-sample"></span>
                    </div>
                    <p class="help" id="tpl-header-hint" hidden></p>
                  </section>
                  <label class="tpl-body"><span data-t="Corpo">Corpo</span><textarea id="tpl-body" rows="6" placeholder="Olá, {{1}}!" data-t-placeholder="Olá, {{1}}!"></textarea></label>
                  <div class="tpl-preview" id="tpl-preview" hidden></div>
                  <div class="vars" id="tpl-vars"></div>
                  <label class="tpl-part tpl-footer"><span class="tpl-part-head"><b data-t="Rodapé">Rodapé</b><small data-t="opcional">opcional</small></span><input id="tpl-footer" maxlength="60" autocomplete="off" placeholder="Responda SAIR para não receber mais" data-t-placeholder="Responda SAIR para não receber mais"></label>
                  <section class="tpl-part">
                    <div class="tpl-part-head"><b data-t="Botões">Botões</b><small data-t="até 10: respostas rápidas, até 2 links, 1 telefone e 1 código">até 10: respostas rápidas, até 2 links, 1 telefone e 1 código</small></div>
                    <div class="tpl-buttons-edit" id="tpl-buttons"></div>
                    <div class="chips add" id="tpl-add-button">
                      <button type="button" data-add="QUICK_REPLY" data-t="+ Resposta rápida">+ Resposta rápida</button>
                      <button type="button" data-add="URL" data-t="+ Link">+ Link</button>
                      <button type="button" data-add="PHONE_NUMBER" data-t="+ Telefone">+ Telefone</button>
                      <button type="button" data-add="COPY_CODE" data-t="+ Copiar código">+ Copiar código</button>
                    </div>
                  </section>
                  <section class="tpl-part">
                    <label class="tpl-switch"><input type="checkbox" id="tpl-carousel"><span><b data-t="Carrossel de cartões">Carrossel de cartões</b><small data-t="2 a 10 cartões com imagem ou vídeo, texto e botões, rolando de lado sob a mensagem">2 a 10 cartões com imagem ou vídeo, texto e botões, rolando de lado sob a mensagem</small></span></label>
                    <div class="tpl-cards-edit" id="tpl-cards" hidden></div>
                    <button class="btn ghost small" type="button" id="tpl-add-card" hidden data-t="+ Cartão">+ Cartão</button>
                  </section>
                </div>
                <aside class="tpl-phone" aria-label="Como chega no WhatsApp" data-t-aria="Como chega no WhatsApp">
                  <div class="tpl-phone-bar">
                    <span data-t="Como chega no WhatsApp">Como chega no WhatsApp</span>
                    <span class="theme-seg" id="tpl-phone-theme" role="group" aria-label="Tema do celular" data-t-aria="Tema do celular">
                      <button type="button" data-theme="light" data-t="Claro">Claro</button>
                      <button type="button" data-theme="dark" data-t="Escuro">Escuro</button>
                    </span>
                  </div>
                  <div class="phone" id="tpl-phone"></div>
                  <p class="tpl-phone-hint" data-t="Os botões respondem ao toque: a resposta rápida volta como a aplicação a recebe.">Os botões respondem ao toque: a resposta rápida volta como a aplicação a recebe.</p>
                </aside>
              </div>
              <fieldset class="tpl-review mock-knob">
                <legend><span data-t="Simulação da revisão">Simulação da revisão</span> <small>X-Mock-Template-Review*</small></legend>
                <div class="tpl-review-field"><span data-t="Veredito">Veredito</span><div id="tpl-review"></div></div>
                <label class="tpl-review-field" id="tpl-reason-field" hidden><span data-t="Motivo">Motivo</span><input id="tpl-reason" autocomplete="off" placeholder="TAG_CONTENT_MISMATCH"></label>
                <label class="tpl-review-field tpl-wait"><span data-t="Em análise por">Em análise por</span><span class="tpl-wait-input"><input id="tpl-review-delay" type="number" min="0" max="600" step="1" value="2" inputmode="numeric"><small data-t="segundos">segundos</small></span></label>
              </fieldset>
              <p class="help" id="tpl-hint"></p>
              <div class="actions">
                <button class="btn danger" type="button" id="tpl-delete" hidden data-t="Apagar">Apagar</button>
                <button class="btn" type="submit" id="tpl-save" data-t="Salvar template">Salvar template</button>
              </div>
            </form>
          </div>
        </section>
        <section class="pane" id="pane-numbers" role="tabpanel" aria-labelledby="tab-numbers" hidden>
          <div class="pane-head">
            <div>
              <h3 data-t="Contas e números">Contas e números</h3>
              <p class="help" data-t="Como a Meta organiza: a empresa tem contas do WhatsApp Business (WABA), cada conta tem números. Um número só manda mensagem depois de registrado na Cloud API, e só faz ou recebe ligação com as ligações ativadas.">Como a Meta organiza: a empresa tem contas do WhatsApp Business (WABA), cada conta tem números. Um número só manda mensagem depois de registrado na Cloud API, e só faz ou recebe ligação com as ligações ativadas.</p>
            </div>
          </div>
          <div class="accounts" id="accounts"></div>
        </section>
        <section class="pane pane-api" id="pane-api" role="tabpanel" aria-labelledby="tab-api" hidden>
          <div class="api-layout">
            <div class="api-main">
              <header class="api-intro">
                <h3 data-t="A Cloud API, aqui">A Cloud API, aqui</h3>
                <p class="help" data-t="Aponte a aplicação para este endereço no lugar de graph.facebook.com. Cada chamada da especificação da Meta existe, valida o corpo e responde como a Meta. O que só um teste precisa vai em headers X-Mock-*, opcionais.">Aponte a aplicação para este endereço no lugar de graph.facebook.com. Cada chamada da especificação da Meta existe, valida o corpo e responde como a Meta. O que só um teste precisa vai em headers X-Mock-*, opcionais.</p>
                <div class="api-base">
                  <span data-t="Base">Base</span>
                  <code id="api-base"></code>
                </div>
                <ul class="api-legend">
                  <li data-kind="meta"><b>Cloud API</b> <span data-t="o caminho, o corpo, a resposta e os erros da Meta">o caminho, o corpo, a resposta e os erros da Meta</span></li>
                  <li data-kind="mock"><b data-t="Só do mock">Só do mock</b> <span data-t="os headers X-Mock-* e os ajustes em /settings">os headers X-Mock-* e os ajustes em /settings</span></li>
                  <li data-kind="state"><b data-t="com estado">com estado</b> <span data-t="o mock guarda o que a chamada muda">o mock guarda o que a chamada muda</span></li>
                </ul>
                <label class="api-filter">
                  <span class="sr-only" data-t="Filtrar chamadas">Filtrar chamadas</span>
                  <input id="api-filter" type="search" autocomplete="off" spellcheck="false">
                  <small id="api-found" aria-live="polite"></small>
                </label>
              </header>
              <div id="docs"></div>
            </div>
            <nav class="api-toc" id="api-toc" aria-label="Nesta página" data-t-aria="Nesta página"></nav>
          </div>
        </section>
      </div>
    </div>
  </aside>
</div>

<div class="menu" id="menu" role="menu" aria-label="Status da mensagem" data-t-aria="Status da mensagem">
  <div class="menu-title" data-t="Simular o lado do usuário">Simular o lado do usuário</div>
  <button type="button" role="menuitem" data-status="delivered" data-t="Marcar como entregue">Marcar como entregue</button>
  <button type="button" role="menuitem" data-status="read" data-t="Marcar como lida">Marcar como lida</button>
  <button type="button" role="menuitem" data-status="failed" class="danger" data-t="Marcar como não entregue">Marcar como não entregue</button>
</div>

<dialog id="new-dialog">
  <form method="dialog" id="new-form">
    <h2 data-t="Nova conversa como usuário">Nova conversa como usuário</h2>
    <p class="help" data-t="A mensagem entra como se o usuário tivesse escrito para a clínica e segue para o webhook.">A mensagem entra como se o usuário tivesse escrito para a clínica e segue para o webhook.</p>
    <label class="field"><span data-t="Número da clínica (phone number id)">Número da clínica (phone number id)</span><input id="nd-business" required autocomplete="off"></label>
    <label class="field"><span data-t="Número do usuário">Número do usuário</span><input id="nd-contact" required inputmode="tel" placeholder="5511999999999" autocomplete="off"></label>
    <label class="field"><span data-t="Nome do usuário (opcional)">Nome do usuário (opcional)</span><input id="nd-name" autocomplete="off" placeholder="Maria Souza"></label>
    <label class="field"><span data-t="Mensagem">Mensagem</span><textarea id="nd-text" rows="2" placeholder="Oi, quero marcar uma consulta" data-t-placeholder="Oi, quero marcar uma consulta"></textarea></label>
    <div class="nd-attach">
      <button class="btn ghost" type="button" id="nd-attach">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21 11.5-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.9-8.9a3.7 3.7 0 0 1 5.2 5.2l-8.9 8.9a1.8 1.8 0 0 1-2.6-2.6l8.2-8.2"/></svg>
        <span data-t="Anexar arquivo">Anexar arquivo</span>
      </button>
      <input type="file" id="nd-file" hidden accept="image/jpeg,image/png,image/webp,video/mp4,video/3gpp,audio/aac,audio/amr,audio/mpeg,audio/mp4,audio/ogg,text/plain,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation">
      <div class="attachment" id="nd-attachment" hidden></div>
      <small class="help" data-t="O texto vira a legenda da imagem, do vídeo ou do documento.">O texto vira a legenda da imagem, do vídeo ou do documento.</small>
    </div>
    <div class="actions">
      <button class="btn ghost" type="button" id="nd-cancel" data-t="Cancelar">Cancelar</button>
      <button class="btn" type="submit" id="nd-send" data-t="Enviar como usuário">Enviar como usuário</button>
    </div>
  </form>
</dialog>

<div class="toast" id="toast" role="status" aria-live="polite"></div>

<!--REFERENCE-->
<script>
(function () {
  'use strict';

  var QUICK = {
    user: ['Sim, confirmo', 'Quero remarcar', 'Qual o valor?', 'Já paguei', 'Obrigado!'],
    owner: ['Olá! Como posso ajudar?', 'Horário confirmado.', 'Segue o link de pagamento.', 'Vou verificar e já retorno.', 'Obrigado pelo contato!']
  };
  var AS_TEXT = {
    user: { label: 'Responder como usuário', send: 'Enviar como usuário' },
    owner: { label: 'Responder como dono do número', send: 'Enviar como dono do número' }
  };
  var AVATAR_COLORS = ['#00a884', '#027eb5', '#a5b337', '#d3396d', '#fa6533', '#7f66ff', '#06cf9c', '#ff9b0f'];
  var SEEN_KEY = 'whatsapp-mock-seen';
  var LANG_KEY = 'whatsapp-mock-lang';

  /*
   * The panel speaks two languages. The key of the dictionary is the pt-BR
   * text, so the two versions never drift apart.
   */
  var EN = {
    /* the shell */
    'conectando…': 'connecting…',
    'ao vivo': 'live',
    'reconectando': 'reconnecting',
    'Conversas': 'Conversations',
    'Idioma da página': 'Page language',
    'Nova conversa como usuário': 'New conversation as user',
    'Nova conversa': 'New conversation',
    'Painel de controle': 'Control panel',
    'Fechar painel': 'Close panel',
    'Número da clínica': 'Clinic number',
    'Todos os números': 'All numbers',
    'Pesquisar por nome ou número': 'Search by name or number',
    'Pesquisar conversas': 'Search conversations',
    'Filtro': 'Filter',
    'Tudo': 'All',
    'Não lidas': 'Unread',
    'Sem resposta da clínica': 'No reply from the clinic',
    'Conversas do mock': 'Mock conversations',
    'As mensagens que a aplicação envia pela API do WhatsApp aparecem aqui, com os tiques de entrega e leitura.': 'The messages the application sends through the WhatsApp API show up here, with the delivery and read ticks.',
    'Para testar a entrada, fale como usuário: a mensagem chega à aplicação pelo webhook.': 'To test the input, talk as the user: the message reaches the application through the webhook.',
    'Abrir painel de controle': 'Open control panel',
    'Voltar para as conversas': 'Back to conversations',
    'Marcar todas as mensagens da clínica como lidas': 'Mark every clinic message as read',
    'Marcar tudo como lido': 'Mark all as read',
    'Respostas rápidas': 'Quick replies',
    'Responder como': 'Reply as',
    'A mensagem entra pelo webhook, como se o usuário tivesse escrito': 'The message enters through the webhook, as if the user had written it',
    'A mensagem sai pela API do WhatsApp, como a aplicação enviaria': 'The message leaves through the WhatsApp API, as the application would send it',
    'Usuário': 'User',
    'Dono': 'Owner',
    'Responder como usuário': 'Reply as user',
    'Responder como dono do número': 'Reply as the number owner',
    'Enviar como usuário': 'Send as user',
    'Enviar como dono do número': 'Send as the number owner',
    'Enter envia · Shift+Enter quebra a linha': 'Enter sends · Shift+Enter breaks the line',
    'Status da mensagem': 'Message status',
    'Simular o lado do usuário': 'Simulate the user side',
    'Marcar como entregue': 'Mark as delivered',
    'Marcar como lida': 'Mark as read',
    'Marcar como não entregue': 'Mark as not delivered',
    'A mensagem entra como se o usuário tivesse escrito para a clínica e segue para o webhook.': 'The message enters as if the user had written to the clinic and goes to the webhook.',
    'Número da clínica (phone number id)': 'Clinic number (phone number id)',
    'Número do usuário': 'User number',
    'Nome do usuário (opcional)': 'User name (optional)',
    'Mensagem': 'Message',
    'Cancelar': 'Cancel',
    /* the console */
    'Entrega': 'Delivery',
    'Eventos': 'Events',
    'Como as mensagens da clínica avançam': 'How the clinic messages move',
    'Automática: cada mensagem enviada vira entregue e lida em poucos segundos, como um usuário atento. Manual: ela fica como enviada até você marcar entregue, lida ou falha no menu da mensagem.': 'Automatic: every message sent becomes delivered and read in a few seconds, like an attentive user. Manual: it stays as sent until you mark it delivered, read or failed in the message menu.',
    'Modo de entrega': 'Delivery mode',
    'Automática': 'Automatic',
    'Manual': 'Manual',
    'Começar do zero': 'Start from zero',
    'Apaga todas as conversas e o histórico de eventos deste mock. A aplicação não é avisada.': 'Deletes every conversation and the event history of this mock. The application is not told.',
    'Apagar todas as conversas': 'Delete all conversations',
    'Toque de novo para apagar': 'Tap again to delete',
    'Para onde vão os eventos': 'Where the events go',
    'O mock chama este endereço com cada mensagem do usuário e cada mudança de status, no formato da Cloud API. Endereços em localhost chegam à sua máquina mesmo com o mock em container.': 'The mock calls this address with every user message and every status change, in the Cloud API format. Addresses on localhost reach your machine even with the mock in a container.',
    'Configurar o destino': 'Set the destination',
    'Igual à Meta: cada número aponta para o próprio endereço, e o mock chama o endereço com um desafio antes de aceitar.': 'Like Meta: each number points to its own address, and the mock calls the address with a challenge before accepting it.',
    'Token de verificação (opcional)': 'Verification token (optional)',
    'Pular a verificação': 'Skip verification',
    'Cada número da clínica pode apontar para um endereço diferente. Salvar grava o destino só para aquele número.': 'Every clinic number can point to a different address. Saving records the destination for that number only.',
    'Endereço do webhook': 'Webhook address',
    'Salvar webhook': 'Save webhook',
    'Chamadas ao webhook': 'Calls to the webhook',
    'Cada tentativa de entrega, com a resposta da aplicação. Toque para ver o corpo enviado.': 'Every delivery attempt, with the answer from the application. Tap to see the body that was sent.',
    'Atraso da resposta': 'Response delay',
    'O mock espera este tempo antes de entregar cada evento ao webhook: é a resposta de uma aplicação que demora para processar.': 'The mock waits this long before delivering each event to the webhook: it is the answer of an application that takes time to process.',
    'segundos': 'seconds',
    'Salvar': 'Save',
    'Atraso de resposta salvo.': 'Response delay saved.',
    'O atraso precisa de um número de segundos.': 'The delay needs a number of seconds.',
    'Templates conhecidos': 'Known templates',
    'Os templates que a aplicação pode enviar. Um template fora desta lista é recusado como na Cloud API.': 'The templates the application may send. A template outside this list is refused, as in the Cloud API.',
    'Novo template': 'New template',
    'Nome': 'Name',
    'Idioma': 'Language',
    'Tipo': 'Type',
    'Revisão': 'Review',
    'Simulação da revisão': 'Review simulation',
    'Em análise por': 'In review for',
    'Motivo': 'Reason',
    'Corpo': 'Body',
    'Variáveis do corpo': 'Body variables',
    'Exemplo: Mariana': 'Example: Mariana',
    'Descrição: primeiro nome': 'Description: first name',
    'Apagar variável': 'Delete variable',
    'Prévia': 'Preview',
    'O exemplo e a descrição vão junto do template: é o que a Cloud API devolve ao ler os templates.': 'The example and the description travel with the template: it is what the Cloud API returns when it reads the templates.',
    'Apagar': 'Delete',
    'Salvar template': 'Save template',
    'Salvar mudanças': 'Save changes',
    'Criar template': 'Create template',
    'Nenhum template carregado.': 'No template loaded.',
    'A categoria não corresponde ao conteúdo': 'The category does not match the content',
    'O nome e o idioma identificam o template: depois de criado, não mudam. O cabeçalho, o rodapé e os botões são preservados.': 'The name and the language identify the template: once created, they do not change. The header, the footer and the buttons are kept.',
    'O nome e o idioma identificam o template. O mock grava o arquivo em templates/ e o watcher o carrega na hora.': 'The name and the language identify the template. The mock writes the file in templates/ and the watcher loads it right away.',
    'Olá, {{1}}!': 'Hi, {{1}}!',
    /* the api docs */
    'Endpoints do mock': 'Mock endpoints',
    'As chamadas que sua aplicação faz para o mock e as que o painel faz por baixo. Os exemplos vão prontos para copiar.': 'The calls your application makes to the mock and the ones the panel makes underneath. The examples are ready to copy.',
    'Base': 'Base',
    'copiar': 'copy',
    'Copiado.': 'Copied.',
    'Não consegui copiar.': 'Could not copy.',
    /* the state of the mock */
    'Servidor': 'Server',
    'Tempo real': 'Real time',
    'Mensagens': 'Messages',
    'no ar': 'up',
    'fora do ar': 'down',
    'conectado': 'connected',
    'da clínica': 'from the clinic',
    'Estado': 'Status',
    'Padrão': 'Default',
    'Assinatura': 'Signature',
    'configurado': 'configured',
    'sem webhook': 'no webhook',
    'HMAC ativo': 'HMAC on',
    'sem segredo': 'no secret',
    'carregando…': 'loading…',
    'Mensagem do usuário': 'User message',
    'Status de mensagem': 'Message status',
    'Status de template': 'Template status',
    'Nenhuma chamada ao webhook ainda.': 'No call to the webhook yet.',
    'enviada': 'sent',
    'entregue': 'delivered',
    'lida': 'read',
    'não entregue': 'not delivered',
    'enviando': 'sending',
    'falhou': 'failed',
    'Mensagem marcada como': 'Message marked as',
    'Registrada aqui. Sem webhook, a aplicação não recebeu.': 'Recorded here. Without a webhook, the application did not receive it.',
    'Nada a marcar: tudo já foi lido.': 'Nothing to mark: everything is already read.',
    'Nenhuma conversa com esse filtro.': 'No conversation with this filter.',
    'Nenhuma conversa ainda. Quando a aplicação enviar uma mensagem, ela aparece aqui.': 'No conversation yet. When the application sends a message, it shows up here.',
    'Começar como usuário': 'Start as the user',
    'não lidas': 'unread',
    'clínica digitando…': 'clinic typing…',
    'conversa com a clínica': 'conversation with the clinic',
    'Sem webhook para este número: o que o usuário escrever fica registrado aqui, mas não chega à aplicação. Configure em Painel de controle, Webhook.': 'No webhook for this number: what the user writes stays here, but never reaches the application. Set it in Control panel, Webhook.',
    'digitando…': 'typing…',
    'Sai pela API do WhatsApp, como a aplicação enviaria. Os tiques seguem o modo de entrega.': 'Leaves through the WhatsApp API, as the application would send it. The ticks follow the delivery mode.',
    'Sem webhook: a resposta fica só aqui.': 'No webhook: the answer stays here.',
    'Mudar o status desta mensagem': 'Change the status of this message',
    'Hoje': 'Today',
    'Ontem': 'Yesterday',
    'Webhook salvo.': 'Webhook saved.',
    'Conversas apagadas.': 'Conversations deleted.',
    'O template precisa de um nome.': 'The template needs a name.',
    'O template precisa de um corpo.': 'The template needs a body.',
    'Template criado.': 'Template created.',
    'Template atualizado.': 'Template updated.',
    'Template apagado.': 'Template deleted.',
    'Entrega automática: as mensagens viram lidas sozinhas.': 'Automatic delivery: the messages become read on their own.',
    'Entrega manual: marque cada mensagem no menu dela.': 'Manual delivery: mark each message in its own menu.',
    'Não consegui ler as mensagens:': 'Could not read the messages:',
    'Revisão "': 'Review "',
    '": o envio deste template falha e o webhook avisa a aplicação com o motivo.': '": the send of this template fails and the webhook tells the application why.',
    /* the quick replies */
    'Sim, confirmo': 'Yes, I confirm',
    'Quero remarcar': 'I want to reschedule',
    'Qual o valor?': 'How much is it?',
    'Já paguei': 'I already paid',
    'Obrigado!': 'Thank you!',
    'Olá! Como posso ajudar?': 'Hello! How can I help?',
    'Horário confirmado.': 'Appointment confirmed.',
    'Segue o link de pagamento.': 'Here is the payment link.',
    'Vou verificar e já retorno.': 'I will check and get back to you.',
    'Obrigado pelo contato!': 'Thanks for reaching out!',
    'Olá': 'Hello',
    'Oi, quero marcar uma consulta': 'Hi, I want to book an appointment',
    /* the languages a template can be written in */
    'Português (BR)': 'Portuguese (BR)',
    'Inglês (EUA)': 'English (US)',
    'Inglês': 'English',
    'Espanhol': 'Spanish',
    'Francês': 'French',
    'Alemão': 'German',
    'Italiano': 'Italian',
    'Japonês': 'Japanese',
    'Coreano': 'Korean',
    'Chinês (simp.)': 'Chinese (simplified)',
    'Chinês (trad.)': 'Chinese (traditional)',
    'Árabe': 'Arabic',
    'Russo': 'Russian',
    'Hindi': 'Hindi',
    'Indonésio': 'Indonesian',
    'Holandês': 'Dutch',
    'Turco': 'Turkish',
    'Polonês': 'Polish',
    'Vietnamita': 'Vietnamese',
    'Tailandês': 'Thai',
    'Ucraniano': 'Ukrainian',
    'Dinamarquês': 'Danish',
    /* the kind of template */
    'Utilidade': 'Utility',
    'confirmação, lembrete, recibo': 'confirmation, reminder, receipt',
    'promoção e divulgação': 'promotion and outreach',
    'Autenticação': 'Authentication',
    'código de verificação': 'verification code',
    /* the review */
    'Aprovado': 'Approved',
    'o envio funciona': 'the send works',
    'Pendente': 'Pending',
    'a revisão não terminou': 'the review did not finish',
    'Rejeitado': 'Rejected',
    'o envio falha': 'the send fails',
    'Pausado': 'Paused',
    'Desativado': 'Disabled',
    'Em análise': 'In review',
    'Template': 'Template',
    'Template criado: em análise.': 'Template created: in review.',
    'Template enviado de novo para a revisão.': 'Template sent back to the review.',
    'Os exemplos vão em example.body_text, como a Meta pede para revisar, e voltam ao ler o template.': 'The examples go in example.body_text, as Meta asks for the review, and come back when the template is read.',
    'mensagem(ns) marcada(s) como lida(s).': 'message(s) marked as read.',
    'Remover': 'Remove',
    'Remover o webhook de': 'Remove the webhook of',
    'O número volta ao endereço padrão.': 'The number goes back to the default address.',
    /* the api tab */
    'A Cloud API, aqui': 'The Cloud API, here',
    'Aponte a aplicação para este endereço no lugar de graph.facebook.com. Cada chamada da especificação da Meta existe, valida o corpo e responde como a Meta. O que só um teste precisa vai em headers X-Mock-*, opcionais.': 'Point the application at this address instead of graph.facebook.com. Every call of Meta\\'s specification exists, checks its body and answers like Meta. What only a test needs goes in optional X-Mock-* headers.',
    'o caminho, o corpo, a resposta e os erros da Meta': 'Meta\\'s path, body, answer and errors',
    'os headers X-Mock-* e os ajustes em /settings': 'the X-Mock-* headers and the settings under /settings',
    'com estado': 'stateful',
    'o mock guarda o que a chamada muda': 'the mock keeps what the call changes',
    'exemplo da Meta': 'Meta\\'s example',
    'O mock guarda e muda o que a chamada mexe: a próxima leitura mostra.': 'The mock stores what the call changes: the next read shows it.',
    'O mock valida a chamada pela especificação e responde com a resposta de exemplo da Meta.': 'The mock checks the call against the specification and answers with Meta\\'s example answer.',
    'Filtrar chamadas': 'Filter calls',
    'Filtrar': 'Filter',
    'chamadas': 'calls',
    'de': 'of',
    'Nesta página': 'On this page',
    'Só do mock': 'Mock only',
    'Ler tudo': 'Read all',
    'Mostrar menos': 'Show less',
    'Resposta 200': 'Response 200',
    'Header do mock': 'Mock header',
    'Valor': 'Value',
    'O que faz': 'What it does',
    'Parâmetro': 'Parameter',
    'Descrição': 'Description',
    'obrigatório': 'required',
    'O lado do usuário': 'The user\\'s side',
    'As mesmas chamadas da Cloud API, feitas do telefone do usuário: o header X-Mock-From diz quem escreve. A mensagem entra na mesma conversa da clínica e segue para o webhook do número, como na Meta.': 'The same Cloud API calls, made from the user\\'s phone: the X-Mock-From header says who writes. The message joins the clinic\\'s conversation and goes to the number\\'s webhook, as on Meta.',
    'O usuário escreve': 'The user writes',
    'Qualquer tipo de mensagem da Cloud API: texto, imagem, localização, resposta de botão. Com context.message_id, ela responde a uma mensagem da clínica.': 'Any Cloud API message type: text, image, location, button reply. With context.message_id it answers a message of the clinic.',
    'Texto': 'Text',
    'Resposta a uma mensagem': 'Reply to a message',
    'Localização': 'Location',
    'Entregue': 'Delivered',
    'O telefone do usuário dá o recibo': 'The user\\'s phone gives the receipt',
    'O corpo de leitura da Cloud API, vindo do lado do usuário: a mensagem da clínica passa a entregue, lida ou falha, e o webhook recebe o status.': 'The Cloud API read body, from the user\\'s side: the clinic\\'s message becomes delivered, read or failed, and the webhook gets the status.',
    'A conversa do número': 'The number\\'s conversation',
    'As mensagens dos dois lados, em ordem; com contact, só a conversa com aquele usuário.': 'The messages of both sides, in order; with contact, only the conversation with that user.',
    'Ajustes do mock': 'Mock settings',
    'O que a Meta não tem: como o mock se comporta e o que ele fez. Fica em /settings, fora do caminho da versão, e não pede token.': 'What Meta has no call for: how the mock behaves and what it did. It lives under /settings, outside the version path, and needs no token.',
    'Modo de entrega': 'Delivery mode',
    'auto: a mensagem da clínica vira entregue e lida sozinha. manual: fica como enviada até o telefone do usuário dar o recibo.': 'auto: the clinic\\'s message becomes delivered and read on its own. manual: it stays sent until the user\\'s phone gives the receipt.',
    'Ler o modo de entrega': 'Read the delivery mode',
    'O modo de agora.': 'The current mode.',
    'Atraso do webhook': 'Webhook delay',
    'Quanto o mock espera antes de entregar cada evento ao webhook, em milissegundos.': 'How long the mock waits before delivering each event to the webhook, in milliseconds.',
    'Para onde vão os eventos': 'Where the events go',
    'O endereço padrão da aplicação, o override de cada número e se há segredo de assinatura. Apontar um número é a chamada da Meta POST /{Phone-Number-ID}.': 'The application\\'s default address, each number\\'s override and whether a signing secret is set. Pointing a number is Meta\\'s call POST /{Phone-Number-ID}.',
    'Chamadas ao webhook': 'Webhook calls',
    'Cada entrega ao webhook, com o corpo e a resposta da aplicação, da mais nova para a mais antiga.': 'Every delivery to the webhook, with the body and the application\\'s answer, newest first.',
    'Limpar as chamadas': 'Clear the calls',
    'Limpa o histórico de chamadas ao webhook.': 'Clears the history of calls to the webhook.',
    'Todas as conversas': 'Every conversation',
    'As mensagens de todos os números, dos dois lados.': 'The messages of every number, both sides.',
    'Apagar as conversas': 'Delete the conversations',
    'Apaga todas as mensagens. A aplicação não é avisada.': 'Deletes every message. The application is not told.',
    'Saúde': 'Health',
    'Se o mock está no ar e quantos templates conhece.': 'Whether the mock is up and how many templates it knows.',
    'Quem escreve: a chamada vem do telefone do usuário, não da clínica. A mensagem entra como recebida e vai para o webhook do número.': 'Who writes: the call comes from the user\\'s phone, not the clinic. The message enters as received and goes to the number\\'s webhook.',
    'O nome do perfil que o webhook mostra em contacts.': 'The profile name the webhook shows in contacts.',
    'delivered, read ou failed': 'delivered, read or failed',
    'Com X-Mock-From e um corpo de status: o recibo que o telefone do usuário dá. Sem ele, read.': 'With X-Mock-From and a status body: the receipt the user\\'s phone gives. Without it, read.',
    'APPROVED, REJECTED, PAUSED, DISABLED ou PENDING': 'APPROVED, REJECTED, PAUSED, DISABLED or PENDING',
    'O veredito da revisão. PENDING deixa o template em análise. Sem ele, aprovado.': 'The verdict of the review. PENDING keeps the template in review. Without it, approved.',
    'O reason do webhook e o rejected_reason da leitura.': 'The reason of the webhook and the rejected_reason of the read.',
    'milissegundos, até 600000': 'milliseconds, up to 600000',
    'Quanto tempo o template fica em análise antes do veredito. Sem ele, 2000.': 'How long the template stays in review before the verdict. Without it, 2000.',
    'Aceita o endereço sem o desafio hub.challenge, para quando a aplicação ainda não subiu.': 'Accepts the address without the hub.challenge check, for when the application is not up yet.',
    /* attachments and media */
    'Anexar arquivo': 'Attach a file',
    'Tirar o anexo': 'Remove the attachment',
    'Imagem': 'Image',
    'Vídeo': 'Video',
    'Áudio': 'Audio',
    'Documento': 'Document',
    'documento': 'document',
    'Figurinha': 'Sticker',
    'A mídia não está neste mock: o id não foi enviado para cá.': 'The media is not in this mock: its id was never uploaded here.',
    'Escreva a mensagem ou anexe um arquivo.': 'Write the message or attach a file.',
    'O texto vira a legenda da imagem, do vídeo ou do documento.': 'The text becomes the caption of the image, the video or the document.',
    /* the template builder */
    'Cabeçalho': 'Header',
    'opcional': 'optional',
    'Nenhum': 'None',
    'Formato do cabeçalho': 'Header format',
    'Lembrete da sua consulta': 'Your appointment reminder',
    'Exemplo de {{1}}': 'Sample of {{1}}',
    'Escolher arquivo de exemplo': 'Choose a sample file',
    'sem exemplo': 'no sample',
    'Rodapé': 'Footer',
    'Responda SAIR para não receber mais': 'Reply STOP to opt out',
    'Botões': 'Buttons',
    'até 10: respostas rápidas, até 2 links, 1 telefone e 1 código': 'up to 10: quick replies, up to 2 links, 1 phone and 1 code',
    '+ Resposta rápida': '+ Quick reply',
    '+ Link': '+ Link',
    '+ Telefone': '+ Phone',
    '+ Copiar código': '+ Copy code',
    'Resposta rápida': 'Quick reply',
    'Link': 'Link',
    'Telefone': 'Phone',
    'Copiar código': 'Copy code',
    'Código de acesso': 'Access code',
    'Código de acesso: texto do botão': 'Access code: button text',
    'Claro': 'Light',
    'Escuro': 'Dark',
    'Tema do celular': 'Phone theme',
    'Os botões respondem ao toque: a resposta rápida volta como a aplicação a recebe.': 'The buttons answer a tap: a quick reply comes back the way the application receives it.',
    'Abre': 'Opens',
    'Liga para': 'Calls',
    'Código copiado:': 'Code copied:',
    'Ver todas as opções': 'See all options',
    'Todas as opções': 'All options',
    'Fechar': 'Close',
    'Gravar mensagem de voz': 'Record a voice message',
    'Mensagem de voz': 'Voice message',
    'Descartar a gravação': 'Discard the recording',
    'Enviar mensagem de voz': 'Send the voice message',
    'Tocar o áudio': 'Play the audio',
    'Pausar o áudio': 'Pause the audio',
    'A mídia não está neste mock': 'The media is not in this mock',
    'Sem acesso ao microfone:': 'No access to the microphone:',
    'A gravação ficou vazia.': 'The recording is empty.',
    'Este navegador não dá acesso ao microfone.': 'This browser gives no access to the microphone.',
    'Ligar': 'Call',
    'Ligar para o usuário, como clínica': 'Call the user, as the clinic',
    'Ligar para a clínica, como usuário': 'Call the clinic, as the user',
    'Ligação de voz em andamento': 'Voice call in progress',
    'Ligação de voz': 'Voice call',
    'Ligação de voz recusada': 'Voice call declined',
    'Ligação de voz perdida': 'Missed voice call',
    'Feita pela clínica': 'Made by the clinic',
    'Feita pelo usuário': 'Made by the user',
    'Permitir ligações?': 'Allow calls?',
    'A empresa pede permissão para ligar para você no WhatsApp.': 'The business asks permission to call you on WhatsApp.',
    'Não permitiu ligações': 'Did not allow calls',
    'Permitiu ligações sempre': 'Allowed calls always',
    'Permitiu ligações por 7 dias': 'Allowed calls for 7 days',
    'Sempre permitir': 'Always allow',
    'Permitir por 7 dias': 'Allow for 7 days',
    'Não permitir': 'Don\\'t allow',
    'Podemos ligar para você por aqui?': 'May we call you here?',
    'O usuário ainda não permite ligações: o pedido de permissão foi enviado.': 'The user does not allow calls yet: the permission request was sent.',
    'Criptografada de ponta a ponta': 'End-to-end encrypted',
    'Você está nas duas pontas': 'You are both ends',
    'Você é a clínica': 'You are the clinic',
    'Você é o usuário': 'You are the user',
    'Chamando…': 'Calling…',
    'Aguardando o microfone…': 'Waiting for the microphone…',
    'Ligação de voz do WhatsApp': 'WhatsApp voice call',
    'Tocando na clínica…': 'Ringing at the clinic…',
    'Tocando no celular do usuário…': 'Ringing on the user\\'s phone…',
    'Conectando…': 'Connecting…',
    'As duas pontas estão neste navegador: você ouve o próprio microfone de volta.': 'Both ends are in this browser: you hear your own microphone back.',
    'Sem webhook neste número: nenhuma aplicação ouve a ligação. Atenda como clínica aqui.': 'No webhook on this number: no application hears the call. Answer as the clinic here.',
    'Recusar': 'Decline',
    'Atender': 'Answer',
    'Sem som': 'Muted',
    'Mudo': 'Mute',
    'Encerrar': 'End',
    'Atender como clínica': 'Answer as the clinic',
    'Atender como usuário': 'Answer as the user',
    'Números': 'Numbers',
    'Contas e números': 'Accounts and numbers',
    'Como a Meta organiza: a empresa tem contas do WhatsApp Business (WABA), cada conta tem números. Um número só manda mensagem depois de registrado na Cloud API, e só faz ou recebe ligação com as ligações ativadas.': 'As Meta arranges them: a business has WhatsApp Business Accounts (WABAs), each account has numbers. A number sends messages only once registered on the Cloud API, and makes or takes calls only with calling enabled.',
    'Nome da nova conta (WABA)': 'Name of the new account (WABA)',
    'Criar conta': 'Create account',
    '+ Número': '+ Number',
    'DDI': 'Country code',
    'Número com DDD': 'Number with area code',
    'Nome exibido': 'Display name',
    'Adicionar': 'Add',
    'Nenhum número nesta conta.': 'No number in this account.',
    'Na Cloud API': 'On the Cloud API',
    'Fora da Cloud API': 'Off the Cloud API',
    'Verificado, falta registrar': 'Verified, not registered',
    'Não verificado': 'Not verified',
    'Ligações ativas': 'Calling on',
    'Sem ligações': 'Calling off',
    'Pedir o código': 'Request the code',
    'que a Meta manda por SMS ou ligação.': 'Meta sends by SMS or a call.',
    'Por SMS': 'By SMS',
    'Por ligação': 'By call',
    'A ligação da Meta diria:': 'Meta\\'s call would say:',
    'O SMS da Meta diria:': 'Meta\\'s SMS would say:',
    'Confirmar o código': 'Confirm the code',
    'Código de 6 dígitos': '6-digit code',
    'Verificar': 'Verify',
    'Registrar na Cloud API': 'Register on the Cloud API',
    'com o PIN de duas etapas já definido.': 'with the two-step PIN already set.',
    'O primeiro registro define o PIN de duas etapas.': 'The first registration sets the two-step PIN.',
    'PIN de 6 dígitos': '6-digit PIN',
    'Registrar': 'Register',
    'Ligações': 'Calling',
    'Quem liga para a clínica permite que ela ligue de volta': 'Calling the clinic lets it call back',
    'Webhook:': 'Webhook:',
    'Sem webhook: as ligações não podem ser ativadas.': 'No webhook: calling cannot be enabled.',
    'Sem webhook: nenhuma aplicação ouve as ligações; atenda como clínica no chat.': 'No webhook: no application hears the calls; answer as the clinic in the chat.',
    'Tirar da Cloud API': 'Take off the Cloud API',
    'Código que a Meta diria na ligação:': 'Code Meta would say on the call:',
    'Código que a Meta mandaria por SMS:': 'Code Meta would send by SMS:',
    'documento.pdf': 'document.pdf',
    'toque para abrir': 'tap to open',
    'O arquivo vem em cada envio': 'The file comes with each send',
    'O vídeo vem em cada envio': 'The video comes with each send',
    'A imagem vem em cada envio': 'The image comes with each send',
    'Tocar o vídeo': 'Play the video',
    'A oferta termina em': 'Offer ends',
    'termina em': 'ends',
    'Conta comercial': 'Business account',
    'Esta empresa usa um serviço seguro da Meta para gerenciar esta conversa.': 'This business uses a secure service from Meta to manage this chat.',
    'Sua empresa': 'Your business',
    'Nenhum template da aplicação ainda.': 'No application template yet.',
    'Exemplos': 'Examples',
    'Um template para cada recurso da Meta: cabeçalhos de mídia e localização, botões, carrossel, oferta, código de acesso. Vêm de templates/examples/.': 'One template for each thing Meta lets a template carry: media and location headers, buttons, carousel, offer, access code. They come from templates/examples/.',
    'Resposta rápida: texto do botão': 'Quick reply: button text',
    'Link: texto do botão': 'Link: button text',
    'Telefone: texto do botão': 'Phone: button text',
    'Código de exemplo: CODIGO10': 'Sample code: CODE10',
    'Tirar o botão': 'Remove the button',
    'Carrossel de cartões': 'Card carousel',
    '2 a 10 cartões com imagem ou vídeo, texto e botões, rolando de lado sob a mensagem': '2 to 10 cards with an image or video, text and buttons, scrolling sideways under the message',
    '+ Cartão': '+ Card',
    'Cartão': 'Card',
    'Tirar o cartão': 'Remove the card',
    'Texto do cartão': 'Card text',
    'Como chega no WhatsApp': 'How it reaches WhatsApp',
    'Escreva o corpo para ver a mensagem.': 'Write the body to see the message.',
    'Clínica': 'Clinic',
    'O endereço vai no envio': 'The address goes with each send',
    'A localização vai em cada envio, no parâmetro location do cabeçalho.': 'The location goes with each send, in the header\\'s location parameter.',
    'O arquivo é só o exemplo da revisão: cada envio manda a sua mídia no parâmetro do cabeçalho, senão a Cloud API recusa com 132012.': 'The file is only the review sample: each send carries its own media in the header parameter, or the Cloud API refuses it with 132012.',
    'O cabeçalho de texto precisa de um texto.': 'A text header needs a text.',
    'Todo botão precisa de um texto.': 'Every button needs a text.',
    'O link do botão precisa começar com http:// ou https://.': 'The button link must start with http:// or https://.',
    'O telefone do botão precisa de DDI e DDD, só números.': 'The button phone needs country and area codes, digits only.',
    'O carrossel precisa de pelo menos 2 cartões.': 'A carousel needs at least 2 cards.',
    'Todo cartão precisa de um texto.': 'Every card needs a text.'
  };

  var NL = String.fromCharCode(10);
  var SQ = String.fromCharCode(39);
  var BS = String.fromCharCode(92);
  /* The business account of the panel: templates belong to an account, and
     the mock keeps one library for every account id. */
  var WABA = '100000000000001';

  /*
   * The Cloud API reference: every operation of Meta's spec for the latest
   * Graph version, inlined by the server (src/graph/reference.ts). Meta's
   * text stays in English, as Meta writes it.
   */
  var REFERENCE = (function () {
    try { return JSON.parse(document.getElementById('reference').textContent); }
    catch (e) { return { version: 'v23.0', topics: [] }; }
  })();
  var PHONE = '1234567890';
  var USER = '5511999999999';

  /* The optional headers of the mock: what each one does and a value. */
  var MOCK_HEADER_DOC = {
    'X-Mock-From': ['5511999999999', 'Quem escreve: a chamada vem do telefone do usuário, não da clínica. A mensagem entra como recebida e vai para o webhook do número.'],
    'X-Mock-Contact-Name': ['Maria Souza', 'O nome do perfil que o webhook mostra em contacts.'],
    'X-Mock-Message-Status': ['delivered, read ou failed', 'Com X-Mock-From e um corpo de status: o recibo que o telefone do usuário dá. Sem ele, read.'],
    'X-Mock-Template-Review': ['APPROVED, REJECTED, PAUSED, DISABLED ou PENDING', 'O veredito da revisão. PENDING deixa o template em análise. Sem ele, aprovado.'],
    'X-Mock-Template-Review-Reason': ['TAG_CONTENT_MISMATCH', 'O reason do webhook e o rejected_reason da leitura.'],
    'X-Mock-Template-Review-Delay': ['milissegundos, até 600000', 'Quanto tempo o template fica em análise antes do veredito. Sem ele, 2000.'],
    'X-Mock-Skip-Callback-Verification': ['true', 'Aceita o endereço sem o desafio hub.challenge, para quando a aplicação ainda não subiu.']
  };

  /* Two topics of our own, in the shape of the reference. The user's side is
     the Cloud API itself, called from the user's phone; the settings are what
     Meta has no call for. Their text is ours, so it follows the language. */
  function userTopic() {
    var v = '/' + REFERENCE.version;
    return {
      name: 'O lado do usuário',
      own: true,
      kind: 'meta',
      description: 'As mesmas chamadas da Cloud API, feitas do telefone do usuário: o header X-Mock-From diz quem escreve. A mensagem entra na mesma conversa da clínica e segue para o webhook do número, como na Meta.',
      operations: [
        {
          id: 'user-writes',
          method: 'POST',
          path: '/{Phone-Number-ID}/messages',
          summary: 'O usuário escreve',
          description: 'Qualquer tipo de mensagem da Cloud API: texto, imagem, localização, resposta de botão. Com context.message_id, ela responde a uma mensagem da clínica.',
          call: v + '/' + PHONE + '/messages',
          headers: { 'X-Mock-From': USER, 'X-Mock-Contact-Name': 'Maria Souza' },
          examples: [
            { name: 'Texto', value: { messaging_product: 'whatsapp', type: 'text', text: { body: 'Oi, quero marcar uma consulta' } } },
            { name: 'Resposta a uma mensagem', value: { messaging_product: 'whatsapp', type: 'text', text: { body: 'Pode ser às 15h' }, context: { message_id: 'wamid.HBgN…' } } },
            { name: 'Localização', value: { messaging_product: 'whatsapp', type: 'location', location: { latitude: -23.5614, longitude: -46.6559, name: 'Av. Paulista' } } }
          ],
          response: { messaging_product: 'whatsapp', contacts: [{ input: USER, wa_id: USER }], messages: [{ id: 'wamid.…' }] },
          simulated: true,
          mockHeaders: ['X-Mock-From', 'X-Mock-Contact-Name']
        },
        {
          id: 'user-receipt',
          method: 'POST',
          path: '/{Phone-Number-ID}/messages',
          summary: 'O telefone do usuário dá o recibo',
          description: 'O corpo de leitura da Cloud API, vindo do lado do usuário: a mensagem da clínica passa a entregue, lida ou falha, e o webhook recebe o status.',
          call: v + '/' + PHONE + '/messages',
          headers: { 'X-Mock-From': USER, 'X-Mock-Message-Status': 'delivered' },
          examples: [{ name: 'Entregue', value: { messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.HBgN…' } }],
          response: { success: true },
          simulated: true,
          mockHeaders: ['X-Mock-From', 'X-Mock-Message-Status']
        },
        {
          id: 'user-conversation',
          method: 'GET',
          path: '/{Phone-Number-ID}/messages',
          summary: 'A conversa do número',
          description: 'As mensagens dos dois lados, em ordem; com contact, só a conversa com aquele usuário.',
          call: v + '/' + PHONE + '/messages?contact=' + USER,
          examples: [],
          response: null,
          simulated: true,
          mockHeaders: []
        }
      ]
    };
  }
  function settingsTopic() {
    function op(id, method, path, summary, description, body) {
      return {
        id: id, method: method, path: path, summary: summary, description: description,
        call: path, examples: body ? [{ name: 'Exemplo', value: body }] : [],
        response: null, simulated: true, mockHeaders: [], noAuth: true
      };
    }
    return {
      name: 'Ajustes do mock',
      own: true,
      kind: 'mock',
      description: 'O que a Meta não tem: como o mock se comporta e o que ele fez. Fica em /settings, fora do caminho da versão, e não pede token.',
      operations: [
        op('settings-delivery-mode', 'PUT', '/settings/delivery-mode', 'Modo de entrega', 'auto: a mensagem da clínica vira entregue e lida sozinha. manual: fica como enviada até o telefone do usuário dar o recibo.', { mode: 'manual' }),
        op('settings-delivery-mode-read', 'GET', '/settings/delivery-mode', 'Ler o modo de entrega', 'O modo de agora.'),
        op('settings-webhook-delay', 'PUT', '/settings/webhook-delay', 'Atraso do webhook', 'Quanto o mock espera antes de entregar cada evento ao webhook, em milissegundos.', { delayMs: 5000 }),
        op('settings-webhooks', 'GET', '/settings/webhooks', 'Para onde vão os eventos', 'O endereço padrão da aplicação, o override de cada número e se há segredo de assinatura. Apontar um número é a chamada da Meta POST /{Phone-Number-ID}.'),
        op('settings-events', 'GET', '/settings/events', 'Chamadas ao webhook', 'Cada entrega ao webhook, com o corpo e a resposta da aplicação, da mais nova para a mais antiga.'),
        op('settings-events-clear', 'DELETE', '/settings/events', 'Limpar as chamadas', 'Limpa o histórico de chamadas ao webhook.'),
        op('settings-conversations', 'GET', '/settings/conversations', 'Todas as conversas', 'As mensagens de todos os números, dos dois lados.'),
        op('settings-conversations-clear', 'DELETE', '/settings/conversations', 'Apagar as conversas', 'Apaga todas as mensagens. A aplicação não é avisada.'),
        op('health', 'GET', '/health', 'Saúde', 'Se o mock está no ar e quantos templates conhece.')
      ]
    };
  }

  var state = {
    lang: readLang(),
    messages: [],
    config: null,
    mode: 'auto',
    events: [],
    templates: [],
    tpl: null,
    tplFormKey: null,
    tplDirty: false,
    parts: defaultParts(),
    selected: null,
    business: '',
    filter: 'all',
    query: '',
    typing: {},
    seen: readSeen(),
    menuFor: null,
    as: 'user',
    healthy: null,
    live: false,
    delayMs: 5000,
    /* The phone of the template builder: the quick replies tapped, the business's name. */
    phoneTaps: [],
    phoneToastTimer: null,
    verifiedName: '',
    examplesOpen: false,
    /* The calls by id (the log of the chats) and the tree of accounts. */
    calls: {},
    accounts: null
  };

  function el(id) { return document.getElementById(id); }
  function readSeen() {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch (e) { return {}; }
  }
  function writeSeen() {
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(state.seen)); } catch (e) { /* private window */ }
  }

  /* ---------- the language of the panel ---------- */
  function readLang() {
    try { return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'pt'; } catch (e) { return 'pt'; }
  }
  function writeLang(lang) {
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* private window */ }
  }
  /* The pt-BR text is the key: a string the dictionary does not know stays. */
  function tr(text) {
    if (!text || state.lang !== 'en') return text;
    var hit = EN[text];
    return hit === undefined ? text : hit;
  }
  function translateDom() {
    document.querySelectorAll('[data-t]').forEach(function (n) {
      n.textContent = tr(n.getAttribute('data-t'));
    });
    document.querySelectorAll('[data-t-aria]').forEach(function (n) {
      n.setAttribute('aria-label', tr(n.getAttribute('data-t-aria')));
    });
    document.querySelectorAll('[data-t-title]').forEach(function (n) {
      n.setAttribute('title', tr(n.getAttribute('data-t-title')));
    });
    document.querySelectorAll('[data-t-placeholder]').forEach(function (n) {
      n.setAttribute('placeholder', tr(n.getAttribute('data-t-placeholder')));
    });
  }
  /* The date of a day divider follows the language of the panel. */
  function locale() { return state.lang === 'en' ? 'en-US' : 'pt-BR'; }
  /* A template born in the panel is born in the language of the panel. */
  function defaultTemplateLanguage() { return state.lang === 'en' ? 'en_US' : 'pt_BR'; }
  /* Switch the language of the whole panel and keep what is being typed. */
  function setLanguage(lang) {
    if (lang !== 'en' && lang !== 'pt') return;
    if (lang === state.lang) return;
    var snapshot = captureForm();
    state.lang = lang;
    writeLang(lang);
    document.documentElement.lang = lang === 'en' ? 'en-US' : 'pt-BR';
    document.querySelectorAll('[data-lang]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-lang') === lang ? 'true' : 'false');
    });
    translateDom();
    rebuildSelects();
    paintAs();
    renderQuick();
    render();
    renderTools();
    renderTemplates(true);
    restoreForm(snapshot);
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
    if (dayKey(d) === dayKey(today)) return tr('Hoje');
    if (dayKey(d) === dayKey(yesterday)) return tr('Ontem');
    return d.toLocaleDateString(locale());
  }
  function listTime(iso) {
    var d = new Date(iso);
    var today = new Date();
    if (dayKey(d) === dayKey(today)) return time(iso);
    var yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    if (dayKey(d) === dayKey(yesterday)) return tr('Ontem');
    return d.toLocaleDateString(locale());
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
    if (opts.headers) {
      Object.keys(opts.headers).forEach(function (name) { init.headers[name] = opts.headers[name]; });
    }
    if (opts.body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch(path, init).then(function (r) {
      return r.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!r.ok) {
          /* Meta's message is generic ((#100) Invalid parameter); the detail
             a person needs is in error_user_msg. */
          var error = (data && data.error) || {};
          var message = error.message || ('HTTP ' + r.status);
          if (error.error_user_msg && error.error_user_msg !== message) message += ': ' + error.error_user_msg;
          throw new Error(message);
        }
        return data;
      });
    });
  }
  /* A Cloud API call, as the application makes it: the version in the path and
     an access token (the mock wants one, like Meta, and takes any). */
  var PANEL_TOKEN = 'Bearer whap-panel';
  function graph(path, options) {
    var opts = options || {};
    var headers = { Authorization: PANEL_TOKEN };
    Object.keys(opts.headers || {}).forEach(function (name) { headers[name] = opts.headers[name]; });
    return api('/' + REFERENCE.version + path, { method: opts.method, headers: headers, body: opts.body });
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
      empty.appendChild(node('div', null, state.messages.length ? tr('Nenhuma conversa com esse filtro.') : tr('Nenhuma conversa ainda. Quando a aplicação enviar uma mensagem, ela aparece aqui.')));
      if (!state.messages.length) {
        var b = node('button', 'btn ghost', tr('Começar como usuário'));
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
      var p = t.last.payload || {};
      var label = t.last.type === 'template' ? 'Template ' + t.last.template.name + ': ' + t.last.text
        : p.type === 'call_permission_reply' ? permissionText(p.call_permission_reply || {})
        : p.type === 'call_permission_request' ? tr('Permitir ligações?')
        : t.last.type === 'audio' ? tr(p.voice ? 'Mensagem de voz' : 'Áudio')
        : t.last.text;
      preview.appendChild(node('span', null, label));
      body.appendChild(preview);
      var meta = node('div', 'meta');
      meta.appendChild(node('span', 'time', listTime(t.last.timestamp)));
      if (t.unread) meta.appendChild(node('span', 'unread-badge', String(t.unread)));
      else meta.appendChild(node('span', null, ''));
      btn.appendChild(av);
      btn.appendChild(body);
      btn.appendChild(meta);
      btn.setAttribute('aria-label', displayName(t) + (t.unread ? ', ' + t.unread + ' ' + tr('não lidas') : ''));
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
      sub.textContent = tr('clínica digitando…');
      sub.className = 'typing';
    } else {
      sub.textContent = (t.name ? formatPhone(t.contact) + ' · ' : '') + tr('conversa com a clínica') + ' ' + t.businessId;
      sub.className = '';
    }

    var stream = el('stream');
    var nearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 80;
    stream.textContent = '';
    if (!webhookFor(t.businessId)) {
      stream.appendChild(node('div', 'notice', tr('Sem webhook para este número: o que o usuário escrever fica registrado aqui, mas não chega à aplicação. Configure em Painel de controle, Webhook.')));
    }
    var lastDay = null;
    var prev = null;
    /* The messages and the calls of the conversation, in the order they happened. */
    var items = t.messages.map(function (m) { return { at: new Date(m.timestamp).getTime(), m: m }; });
    callsOf(t).forEach(function (c) { items.push({ at: c.createdAt, call: c }); });
    items.sort(function (a, b) { return a.at - b.at; });
    items.forEach(function (item) {
      var iso = new Date(item.at).toISOString();
      var dk = dayKey(iso);
      if (dk !== lastDay) { stream.appendChild(node('div', 'day', dayLabel(iso))); lastDay = dk; prev = null; }
      if (item.call) { stream.appendChild(callRow(item.call)); prev = null; return; }
      var m = item.m;
      var first = !prev || prev.direction !== m.direction;
      stream.appendChild(renderMessage(m, first, prev));
      prev = m;
    });
    if (state.typing[t.businessId]) {
      var typingRow = node('div', 'row out typing-row');
      typingRow.appendChild(node('div', 'bubble', tr('digitando…')));
      stream.appendChild(typingRow);
    }
    if (nearBottom || renderChat.lastKey !== t.key || renderChat.lastCount !== t.messages.length) {
      stream.scrollTop = stream.scrollHeight;
    }
    renderChat.lastKey = t.key;
    renderChat.lastCount = t.messages.length;

    var callLabel = tr(state.as === 'owner' ? 'Ligar para o usuário, como clínica' : 'Ligar para a clínica, como usuário');
    el('call-btn').setAttribute('aria-label', callLabel);
    el('call-btn').setAttribute('title', callLabel);
    if (!rec) updateSend();

    var hint = el('compose-hint');
    if (state.as === 'owner') {
      hint.textContent = tr('Sai pela API do WhatsApp, como a aplicação enviaria. Os tiques seguem o modo de entrega.');
      hint.className = 'compose-hint';
    } else if (webhookFor(t.businessId)) {
      hint.textContent = tr('Enter envia · Shift+Enter quebra a linha');
      hint.className = 'compose-hint';
    } else {
      hint.textContent = tr('Sem webhook: a resposta fica só aqui.');
      hint.className = 'compose-hint warn';
    }
  }

  /* ---------- what a bubble carries: media, places, buttons, cards ---------- */
  var BUTTON_ICON = {
    URL: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    PHONE_NUMBER: '<path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z" fill="currentColor"/>',
    COPY_CODE: '<rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    QUICK_REPLY: '<path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" fill="currentColor"/>'
  };
  var DOC_ICON = '<path d="M6 2h8l6 6v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" fill="currentColor" opacity=".9"/><path d="M14 2v6h6" fill="#fff" opacity=".55"/>';
  var MEDIA_ICON = '<path d="M4 5h16v14H4z M4 15l4-4 4 4 3-3 5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>';

  function icon(paths) { return svg('<svg viewBox="0 0 24 24" aria-hidden="true">' + paths + '</svg>'); }
  function buttonsNode(buttons) {
    var box = node('div', 'tpl-buttons');
    buttons.forEach(function (b) {
      var line = node('div');
      if (BUTTON_ICON[b.type]) line.appendChild(icon(BUTTON_ICON[b.type]));
      var col = node('span', 'btn-col');
      col.appendChild(node('span', null, b.text));
      if (b.detail) col.appendChild(node('small', null, b.detail));
      line.appendChild(col);
      if (b.detail) line.setAttribute('title', b.detail);
      box.appendChild(line);
    });
    return box;
  }
  function mediaNode(media) {
    if (media.kind === 'document') {
      var a = node('a', 'doc');
      if (media.src) { a.href = media.src; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      a.appendChild(icon(DOC_ICON));
      var text = node('span', 'doc-text');
      text.appendChild(node('b', null, media.filename || tr('Documento')));
      text.appendChild(node('small', null, media.mimeType || tr('documento')));
      a.appendChild(text);
      return a;
    }
    var box = node('div', 'media' + (media.kind === 'sticker' ? ' sticker' : ''));
    if (!media.src) {
      var missing = node('div', 'media-missing');
      missing.appendChild(icon(MEDIA_ICON));
      missing.appendChild(node('span', null, tr('A mídia não está neste mock: o id não foi enviado para cá.')));
      box.appendChild(missing);
      return box;
    }
    var tag = media.kind === 'video' ? 'video' : media.kind === 'audio' ? 'audio' : 'img';
    var el2 = document.createElement(tag);
    el2.src = media.src;
    if (tag === 'img') { el2.alt = media.filename || media.kind; el2.loading = 'lazy'; }
    else { el2.controls = true; el2.preload = 'metadata'; }
    box.appendChild(el2);
    return box;
  }
  function locationNode(location) {
    var box = node('div', 'loc');
    box.appendChild(node('b', null, location.name || tr('Localização')));
    box.appendChild(node('span', null, location.address || (location.latitude + ', ' + location.longitude)));
    return box;
  }
  function headerNode(header) {
    if (header.format === 'TEXT') return header.text ? node('span', 'tpl-head', header.text) : null;
    if (header.format === 'LOCATION') return header.location ? locationNode(header.location) : null;
    return header.media ? mediaNode(header.media) : null;
  }
  /* A template as the phone shows it: header, body, footer; the buttons and
     the cards are drawn after the stamp. */
  function templateContent(bubble, t, fallback) {
    var head = t.header ? headerNode(t.header) : null;
    if (head) bubble.appendChild(head);
    if (t.offer) {
      var offer = node('span', 'tpl-offer');
      offer.appendChild(icon(PH.gift));
      offer.appendChild(node('b', null, t.offer.text));
      if (t.offer.expiresAt) offer.appendChild(node('small', null, tr('termina em') + ' ' + new Date(t.offer.expiresAt).toLocaleString(state.lang === 'en' ? 'en-US' : 'pt-BR')));
      bubble.appendChild(offer);
    }
    rich(t.body || fallback || '', bubble);
    if (t.footer) bubble.appendChild(node('span', 'tpl-foot', t.footer));
  }
  function cardsNode(cards) {
    var row = node('div', 'cards');
    cards.forEach(function (card) {
      var c = node('div', 'card');
      var head = card.header ? headerNode(card.header) : null;
      if (head) c.appendChild(head);
      c.appendChild(node('div', 'card-body', card.body));
      if (card.buttons && card.buttons.length) c.appendChild(buttonsNode(card.buttons));
      row.appendChild(c);
    });
    return row;
  }

  function renderMessage(m, first, prev) {
    var row = node('div', 'row ' + m.direction + (first ? ' tail' : '') + (first && prev ? ' gap' : ''));
    var bubble = node('div', 'bubble');
    if (m.type === 'template' && m.template) {
      bubble.appendChild(node('span', 'tpl-tag', 'Template ' + m.template.name + ' · ' + m.template.language));
      templateContent(bubble, m.template, m.text);
    } else if (m.media && m.media.kind === 'audio') {
      bubble.appendChild(voiceNode(m.media, !!(m.payload && m.payload.voice), faceOf(m)));
    } else if (m.media) {
      bubble.appendChild(mediaNode(m.media));
      var caption = m.payload && m.payload.caption;
      if (caption) bubble.appendChild(document.createTextNode(caption));
    } else if (m.type === 'interactive' && m.payload && m.payload.type === 'call_permission_request') {
      bubble.appendChild(permissionCard(m));
    } else if (m.type === 'interactive' && m.payload && m.payload.type === 'call_permission_reply') {
      bubble.appendChild(permissionReply(m.payload.call_permission_reply || {}));
    } else if (m.type === 'location' && m.payload) {
      bubble.appendChild(locationNode(m.payload));
    } else {
      rich(m.text, bubble);
    }
    var stamp = node('span', 'stamp');
    stamp.appendChild(node('span', null, time(m.timestamp)));
    if (m.direction === 'out') {
      stamp.appendChild(statusIcon(m.status));
      stamp.setAttribute('title', tr(STATUS_TEXT[m.status] || 'enviando'));
      stamp.setAttribute('aria-label', time(m.timestamp) + ', ' + tr(STATUS_TEXT[m.status] || 'enviando'));
      var menuBtn = node('button', 'msg-menu');
      menuBtn.type = 'button';
      menuBtn.setAttribute('aria-label', tr('Mudar o status desta mensagem'));
      menuBtn.setAttribute('aria-haspopup', 'menu');
      menuBtn.appendChild(svg(CHEVRON));
      menuBtn.addEventListener('click', function (e) { e.stopPropagation(); openMenu(m.id, menuBtn); });
      bubble.appendChild(menuBtn);
    }
    bubble.appendChild(stamp);
    if (m.type === 'interactive' && m.payload && m.payload.type === 'call_permission_request') {
      bubble.appendChild(permissionActions(m));
    }
    if (m.type === 'template' && m.template && m.template.buttons && m.template.buttons.length) {
      bubble.appendChild(buttonsNode(m.template.buttons));
    }
    row.appendChild(bubble);
    if (m.type === 'template' && m.template && m.template.cards && m.template.cards.length) {
      row.classList.add('has-cards');
      row.appendChild(cardsNode(m.template.cards));
    }
    return row;
  }

  /* ---------- voice notes: the player ---------- */
  var PLAY_ICON = '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>';
  var PAUSE_ICON = '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/>';
  var MIC_ICON = '<rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
  var BARS = 36;
  var peaksCache = {};
  /* One player per file: a redraw of the chat finds the audio still playing. */
  var players = {};
  function clockOf(seconds) {
    var s = Math.max(0, Math.round(seconds || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  /* The bars of a recording: the loudness of each slice, read once per file. */
  function peaksOf(src) {
    if (peaksCache[src]) return peaksCache[src];
    var Ctx = window.AudioContext || window.webkitAudioContext;
    peaksCache[src] = fetch(src).then(function (r) { return r.arrayBuffer(); }).then(function (buffer) {
      var ctx = new Ctx();
      return ctx.decodeAudioData(buffer).then(function (audio) {
        ctx.close();
        var data = audio.getChannelData(0);
        var step = Math.max(1, Math.floor(data.length / BARS));
        var peaks = [];
        for (var i = 0; i < BARS; i++) {
          var max = 0;
          for (var j = i * step; j < Math.min(data.length, (i + 1) * step); j += 16) max = Math.max(max, Math.abs(data[j]));
          peaks.push(max);
        }
        var top = Math.max.apply(null, peaks) || 1;
        return { peaks: peaks.map(function (p) { return p / top; }), duration: audio.duration };
      });
    });
    return peaksCache[src];
  }
  /* An audio as WhatsApp draws it: the sender's face (a mic on a voice note), play, the bars, the time. */
  function voiceNode(media, voice, face) {
    var box = node('div', 'voice-note');
    var avatar = node('span', 'vn-avatar', face.initials);
    avatar.style.background = face.color;
    if (voice) avatar.appendChild(icon(MIC_ICON));
    var play = node('button', 'vn-play');
    play.type = 'button';
    play.setAttribute('aria-label', tr('Tocar o áudio'));
    var track = node('div', 'vn-track');
    var bars = node('div', 'vn-bars');
    for (var i = 0; i < BARS; i++) {
      var bar = document.createElement('i');
      bar.style.height = '30%';
      bars.appendChild(bar);
    }
    var meta = node('div', 'vn-meta');
    var left = node('span', null, '0:00');
    meta.appendChild(left);
    track.appendChild(bars);
    track.appendChild(meta);
    box.appendChild(avatar);
    box.appendChild(play);
    box.appendChild(track);
    if (!media.src) {
      play.appendChild(icon(PLAY_ICON));
      play.disabled = true;
      left.textContent = tr('A mídia não está neste mock');
      return box;
    }
    var audio = players[media.src] || (players[media.src] = new Audio(media.src));
    var duration = isFinite(audio.duration) ? audio.duration : 0;
    function paint() {
      var lit = duration ? Math.round((audio.currentTime / duration) * BARS) : 0;
      Array.prototype.forEach.call(bars.children, function (b, k) { b.className = k < lit ? 'on' : ''; });
      left.textContent = clockOf(audio.currentTime || duration);
      play.textContent = '';
      play.appendChild(icon(audio.paused ? PLAY_ICON : PAUSE_ICON));
      play.setAttribute('aria-label', tr(audio.paused ? 'Tocar o áudio' : 'Pausar o áudio'));
    }
    peaksOf(media.src).then(function (r) {
      duration = r.duration;
      r.peaks.forEach(function (p, k) { bars.children[k].style.height = Math.max(14, Math.round(p * 100)) + '%'; });
      paint();
    }).catch(function () { /* a file the browser cannot decode keeps flat bars */ });
    /* Properties, not listeners: the newest drawing of the bubble is the one painted. */
    audio.onplay = paint;
    audio.onpause = paint;
    audio.ontimeupdate = paint;
    audio.onloadedmetadata = function () { if (isFinite(audio.duration)) duration = audio.duration; paint(); };
    audio.onended = function () { audio.currentTime = 0; paint(); };
    play.addEventListener('click', function () {
      if (audio.paused) {
        Object.keys(players).forEach(function (k) { if (players[k] !== audio) players[k].pause(); });
        audio.play().catch(function (e) { toast(e.message, true); });
      } else {
        audio.pause();
      }
    });
    bars.addEventListener('click', function (e) {
      var r = bars.getBoundingClientRect();
      if (duration) { audio.currentTime = duration * Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); paint(); }
    });
    paint();
    return box;
  }
  function faceOf(m) {
    if (m.direction === 'in') return { initials: initials(m.contactName, m.contact), color: colorFor(m.businessId + '|' + m.contact) };
    var name = state.verifiedName || 'Clínica';
    return { initials: initials(name, m.businessId), color: '#00a884' };
  }

  /* ---------- calls in the chat: the log, the permission ---------- */
  function durationText(seconds) {
    var s = Math.round(seconds);
    var m = Math.floor(s / 60);
    return m ? m + ' min ' + (s % 60) + ' s' : s + ' s';
  }
  function callTitle(c) {
    if (c.state !== 'ended') return tr('Ligação de voz em andamento');
    if (c.startTime) return tr('Ligação de voz');
    return tr(c.endReason === 'rejected' ? 'Ligação de voz recusada' : 'Ligação de voz perdida');
  }
  function callRow(c) {
    var out = c.direction === 'BUSINESS_INITIATED';
    var row = node('div', 'row ' + (out ? 'out' : 'in') + ' tail gap');
    var bubble = node('div', 'bubble');
    var missed = c.state === 'ended' && !c.startTime;
    var log = node('div', 'call-log' + (missed ? ' missed' : ''));
    var badge = node('span', 'cl-icon');
    badge.appendChild(icon(BUTTON_ICON.PHONE_NUMBER));
    log.appendChild(badge);
    var text = node('span');
    text.appendChild(node('b', null, callTitle(c)));
    text.appendChild(node('small', null, c.startTime && c.endTime
      ? durationText((c.endTime - c.startTime) / 1000)
      : tr(out ? 'Feita pela clínica' : 'Feita pelo usuário')));
    log.appendChild(text);
    if (c.state === 'ended') {
      var again = node('button', null, tr('Ligar'));
      again.type = 'button';
      again.addEventListener('click', startCall);
      log.appendChild(again);
    }
    bubble.appendChild(log);
    var stamp = node('span', 'stamp');
    stamp.appendChild(node('span', null, time(new Date(c.createdAt).toISOString())));
    bubble.appendChild(stamp);
    row.appendChild(bubble);
    return row;
  }
  function callsOf(t) {
    var contact = digits(t.contact);
    return Object.keys(state.calls).map(function (k) { return state.calls[k]; }).filter(function (c) {
      return c.phoneNumberId === t.businessId && c.contact === contact;
    });
  }
  var PERM_ICON = '<path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z" fill="currentColor"/>';
  var CHECK_ICON = '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';
  var NO_ICON = '<path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>';
  /* The request the clinic sent: the text it chose and Meta's own card. */
  function permissionCard(m) {
    var card = node('span', 'perm-card');
    var title = node('span', 'perm-title');
    title.appendChild(icon(PERM_ICON));
    title.appendChild(node('span', null, tr('Permitir ligações?')));
    card.appendChild(title);
    var body = m.payload.body && m.payload.body.text;
    card.appendChild(node('p', null, body || tr('A empresa pede permissão para ligar para você no WhatsApp.')));
    return card;
  }
  function permissionReplyOf(m) {
    for (var i = 0; i < state.messages.length; i++) {
      var x = state.messages[i];
      if (x.direction === 'in' && x.replyTo === m.id && x.payload && x.payload.type === 'call_permission_reply') return x;
    }
    return null;
  }
  function permissionText(reply) {
    if (reply.response !== 'accept') return tr('Não permitiu ligações');
    return tr(reply.is_permanent ? 'Permitiu ligações sempre' : 'Permitiu ligações por 7 dias');
  }
  /* The user's choices, on the user's phone (the panel); once answered, what was chosen. */
  function permissionActions(m) {
    var box = node('div', 'perm-actions');
    var reply = permissionReplyOf(m);
    if (reply) {
      box.appendChild(node('small', null, permissionText(reply.payload.call_permission_reply || {})));
      return box;
    }
    [['accept', true, 'Sempre permitir'], ['accept', false, 'Permitir por 7 dias'], ['reject', false, 'Não permitir']].forEach(function (choice) {
      var b = node('button', null, tr(choice[2]));
      b.type = 'button';
      b.addEventListener('click', function () { replyPermission(m, choice[0], choice[1]); });
      box.appendChild(b);
    });
    return box;
  }
  function permissionReply(reply) {
    var box = node('span', 'perm-reply' + (reply.response === 'accept' ? '' : ' no'));
    box.appendChild(icon(reply.response === 'accept' ? CHECK_ICON : NO_ICON));
    box.appendChild(node('span', null, permissionText(reply)));
    return box;
  }
  function replyPermission(m, response, permanent) {
    graph('/' + encodeURIComponent(m.businessId) + '/messages', {
      method: 'POST',
      headers: { 'X-Mock-From': digits(m.contact) },
      body: {
        messaging_product: 'whatsapp',
        type: 'interactive',
        context: { message_id: m.id },
        interactive: { type: 'call_permission_reply', call_permission_reply: { response: response, is_permanent: permanent } }
      }
    }).then(load).catch(function (e) { toast(e.message, true); });
  }
  function askPermission(t) {
    return graph('/' + encodeURIComponent(t.businessId) + '/messages', {
      method: 'POST',
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: digits(t.contact),
        type: 'interactive',
        interactive: {
          type: 'call_permission_request',
          action: { name: 'call_permission_request' },
          body: { text: tr('Podemos ligar para você por aqui?') }
        }
      }
    }).then(function () {
      toast(tr('O usuário ainda não permite ligações: o pedido de permissão foi enviado.'));
      return load();
    });
  }

  /*
   * ---------- the call: real WebRTC ----------
   * The panel plays the user's phone, the clinic, or both. The SDP goes
   * through the Cloud API (POST /{phone}/calls, X-Mock-From for the user's
   * side) and the other end's answer comes back in CALL_UPDATE frames. ICE
   * is gathered before the SDP leaves (no trickle), as Meta's examples carry
   * their candidates in the SDP.
   */
  function freshCall() {
    return { id: null, current: null, thread: null, pending: false, incoming: false, asUser: false, asBiz: false, pcUser: null, pcBiz: null, stream: null, muted: false, tick: null };
  }
  var call = freshCall();
  function mic() {
    if (call.stream) return Promise.resolve(call.stream);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error(tr('Este navegador não dá acesso ao microfone.')));
    }
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then(function (s) { call.stream = s; return s; });
  }
  function hear(stream) {
    var a = el('call-audio');
    a.srcObject = stream;
    var p = a.play();
    if (p && p.catch) p.catch(function () { /* autoplay: the call button was the gesture */ });
  }
  function peer(listen) {
    var pc = new RTCPeerConnection({ iceServers: [] });
    call.stream.getAudioTracks().forEach(function (t) { pc.addTrack(t, call.stream); });
    pc.addEventListener('track', function (e) { if (listen) hear(e.streams[0]); });
    pc.addEventListener('connectionstatechange', renderCall);
    return pc;
  }
  /* The SDP is sent once every candidate is in it: the wait ends on the gathering, with a limit. */
  function gathered(pc) {
    return new Promise(function (resolve) {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      var limit = null;
      var done = function () {
        if (pc.iceGatheringState !== 'complete') return;
        pc.removeEventListener('icegatheringstatechange', done);
        clearTimeout(limit);
        resolve();
      };
      pc.addEventListener('icegatheringstatechange', done);
      /* The limit of the wait: host candidates gather in milliseconds. */
      limit = setTimeout(function () { pc.removeEventListener('icegatheringstatechange', done); resolve(); }, 3000);
    });
  }
  function localSdp(pc, kind) {
    var made = kind === 'offer' ? pc.createOffer() : pc.createAnswer();
    return made
      .then(function (d) { return pc.setLocalDescription(d); })
      .then(function () { return gathered(pc); })
      .then(function () { return pc.localDescription.sdp; });
  }
  function callApi(businessId, body, user) {
    var headers = {};
    if (user) {
      headers['X-Mock-From'] = digits(user.contact);
      if (user.name) headers['X-Mock-Contact-Name'] = user.name;
    }
    body.messaging_product = 'whatsapp';
    return graph('/' + encodeURIComponent(businessId) + '/calls', { method: 'POST', headers: headers, body: body });
  }
  /* The name a number shows on WhatsApp, from the accounts the mock keeps. */
  function businessName(id) {
    var found = null;
    ((state.accounts && state.accounts.businesses) || []).forEach(function (b) {
      b.wabas.forEach(function (w) {
        w.phone_numbers.forEach(function (n) { if (n.id === id) found = n.verified_name; });
      });
    });
    return found || state.verifiedName || id;
  }
  function threadFor(c) {
    var key = c.phoneNumberId + '|' + c.contact;
    var list = threads();
    for (var i = 0; i < list.length; i++) {
      if (list[i].businessId === c.phoneNumberId && digits(list[i].contact) === c.contact) return list[i];
    }
    return { key: key, businessId: c.phoneNumberId, contact: c.contact, name: c.contactName, messages: [] };
  }
  /* The call button of the chat: the user calls the clinic, or the clinic calls the user. */
  function startCall() {
    var t = selectedThread();
    if (!t || call.thread) return;
    if (state.as === 'owner') { callAsBusiness(t); return; }
    call.thread = t;
    call.pending = true;
    call.asUser = true;
    renderCall();
    mic().then(function () {
      call.pcUser = peer(true);
      return localSdp(call.pcUser, 'offer');
    }).then(function (sdp) {
      return callApi(t.businessId, { action: 'connect', session: { sdp_type: 'offer', sdp: sdp } }, { contact: t.contact, name: t.name });
    }).then(function (res) {
      adopt(res.calls[0].id);
    }).catch(function (e) { toast(e.message, true); closeCall(); });
  }
  function callAsBusiness(t) {
    graph('/' + encodeURIComponent(t.businessId) + '/call_permissions?user_wa_id=' + digits(t.contact)).then(function (p) {
      if (p.permission.status === 'no_permission') return askPermission(t);
      call.thread = t;
      call.pending = true;
      call.asBiz = true;
      renderCall();
      return mic().then(function () {
        /* The user's phone is this panel too: the clinic's side stays silent, no double audio. */
        call.pcBiz = peer(false);
        return localSdp(call.pcBiz, 'offer');
      }).then(function (sdp) {
        return callApi(t.businessId, { to: digits(t.contact), action: 'connect', session: { sdp_type: 'offer', sdp: sdp } });
      }).then(function (res) { adopt(res.calls[0].id); });
    }).catch(function (e) { toast(e.message, true); closeCall(); });
  }
  /* The id comes in the answer, or first in the frame: whichever lands first names the call. */
  function adopt(id) {
    call.id = id;
    call.pending = false;
    if (state.calls[id]) onCall(state.calls[id]);
    renderCall();
  }
  function acceptAsUser() {
    var c = call.current;
    mic().then(function () {
      call.pcUser = peer(true);
      return call.pcUser.setRemoteDescription({ type: 'offer', sdp: c.offer });
    }).then(function () {
      return localSdp(call.pcUser, 'answer');
    }).then(function (sdp) {
      call.asUser = true;
      return callApi(c.phoneNumberId, { call_id: c.id, action: 'accept', session: { sdp_type: 'answer', sdp: sdp } }, { contact: c.contact });
    }).then(renderCall).catch(function (e) { toast(e.message, true); });
  }
  function acceptAsBusiness() {
    var c = call.current;
    mic().then(function () {
      call.pcBiz = peer(!call.asUser);
      return call.pcBiz.setRemoteDescription({ type: 'offer', sdp: c.offer });
    }).then(function () {
      return localSdp(call.pcBiz, 'answer');
    }).then(function (sdp) {
      call.asBiz = true;
      return callApi(c.phoneNumberId, { call_id: c.id, action: 'accept', session: { sdp_type: 'answer', sdp: sdp } });
    }).then(renderCall).catch(function (e) { toast(e.message, true); });
  }
  /* Hang up from the side the panel plays; a ringing call to the user is declined. */
  function hangUp() {
    var c = call.current;
    if (!c) { closeCall(); return; }
    var userSide = call.asUser || (call.incoming && !call.asBiz);
    var declining = c.state === 'ringing' && call.incoming && !call.asUser;
    callApi(c.phoneNumberId, { call_id: c.id, action: declining ? 'reject' : 'terminate' }, userSide ? { contact: c.contact } : null)
      .catch(function (e) { toast(e.message, true); closeCall(); });
  }
  function toggleMute() {
    call.muted = !call.muted;
    if (call.stream) call.stream.getAudioTracks().forEach(function (t) { t.enabled = !call.muted; });
    renderCall();
  }
  function closeCall() {
    clearInterval(call.tick);
    [call.pcUser, call.pcBiz].forEach(function (pc) { if (pc) pc.close(); });
    if (call.stream) call.stream.getTracks().forEach(function (t) { t.stop(); });
    el('call-audio').srcObject = null;
    call = freshCall();
    el('call').hidden = true;
  }
  /* A call changed on the mock: the log of the chat, and the screen when it is this panel's. */
  function onCall(c) {
    state.calls[c.id] = c;
    var ours = c.id === call.id;
    if (!ours && call.pending && call.thread && !call.id && call.thread.businessId === c.phoneNumberId && digits(call.thread.contact) === c.contact) {
      call.id = c.id;
      ours = true;
    }
    if (!ours && !call.thread && c.direction === 'BUSINESS_INITIATED' && c.state === 'ringing') {
      /* The clinic calls: the user's phone (this panel) rings. */
      call.id = c.id;
      call.thread = threadFor(c);
      call.incoming = true;
      ours = true;
    }
    if (ours) {
      call.current = c;
      if (c.answer && call.asUser && call.pcUser && c.direction === 'USER_INITIATED' && !call.pcUser.currentRemoteDescription) {
        call.pcUser.setRemoteDescription({ type: 'answer', sdp: c.answer }).catch(function (e) { toast(e.message, true); });
      }
      if (c.answer && call.asBiz && call.pcBiz && c.direction === 'BUSINESS_INITIATED' && !call.pcBiz.currentRemoteDescription) {
        call.pcBiz.setRemoteDescription({ type: 'answer', sdp: c.answer }).catch(function (e) { toast(e.message, true); });
      }
      if (c.state === 'ended') {
        closeCall();
        toast(callTitle(c) + (c.startTime && c.endTime ? ': ' + durationText((c.endTime - c.startTime) / 1000) : '.'));
      } else {
        renderCall();
      }
    }
    renderChat();
  }
  function callButton(cls, label, paths, onClick, pressed) {
    var b = node('button', 'call-btn ' + (cls || ''));
    b.type = 'button';
    var circle = node('span', 'circle');
    circle.appendChild(icon(paths));
    b.appendChild(circle);
    b.appendChild(node('span', null, label));
    if (pressed !== undefined) b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    b.addEventListener('click', onClick);
    return b;
  }
  var MUTE_ICON = '<path d="M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M4 4l16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
  function renderCall() {
    var box = el('call');
    if (!call.thread) { box.hidden = true; return; }
    box.hidden = false;
    var t = call.thread;
    var c = call.current;
    /* The screen shows the other end: the clinic on the user's phone, the user on the clinic's side. */
    var userSide = call.asUser || (call.incoming && !call.asBiz);
    var av = el('call-avatar');
    if (userSide) {
      var business = businessName(t.businessId);
      av.textContent = initials(business, t.businessId);
      av.style.background = '#00a884';
      el('call-name').textContent = business;
    } else {
      av.textContent = initials(t.name, t.contact);
      av.style.background = colorFor(t.key || (t.businessId + '|' + t.contact));
      el('call-name').textContent = displayName(t);
    }
    var ringing = !c || c.state === 'ringing' || c.state === 'pre_accepted';
    box.classList.toggle('ringing', ringing);
    el('call-role').textContent = call.asUser && call.asBiz ? tr('Você está nas duas pontas')
      : call.asBiz ? tr('Você é a clínica') : tr('Você é o usuário');
    var stateText = tr(call.stream ? 'Chamando…' : 'Aguardando o microfone…');
    if (c && c.state === 'ringing') {
      stateText = call.incoming && !call.asUser ? tr('Ligação de voz do WhatsApp')
        : c.direction === 'USER_INITIATED' ? tr('Tocando na clínica…') : tr('Tocando no celular do usuário…');
    } else if (c && c.state === 'pre_accepted') {
      stateText = tr('Conectando…');
    } else if (c && c.state === 'active') {
      stateText = clockOf((Date.now() - c.startTime) / 1000);
    }
    el('call-state').textContent = stateText;
    clearInterval(call.tick);
    /* The clock of the call on the screen, while it lasts. */
    if (c && c.state === 'active') call.tick = setInterval(function () { if (call.current) el('call-state').textContent = clockOf((Date.now() - call.current.startTime) / 1000); }, 1000);
    var note = el('call-note');
    note.hidden = true;
    if (call.asUser && call.asBiz) {
      note.hidden = false;
      note.textContent = tr('As duas pontas estão neste navegador: você ouve o próprio microfone de volta.');
    } else if (c && c.direction === 'USER_INITIATED' && ringing && !webhookFor(c.phoneNumberId)) {
      note.hidden = false;
      note.textContent = tr('Sem webhook neste número: nenhuma aplicação ouve a ligação. Atenda como clínica aqui.');
    }
    var actions = el('call-actions');
    actions.textContent = '';
    var END = BUTTON_ICON.PHONE_NUMBER;
    if (c && c.state === 'ringing' && call.incoming && !call.asUser) {
      actions.appendChild(callButton('end', tr('Recusar'), END, hangUp));
      actions.appendChild(callButton('take', tr('Atender'), BUTTON_ICON.PHONE_NUMBER, acceptAsUser));
      return;
    }
    if (c && c.state === 'active') actions.appendChild(callButton('', tr(call.muted ? 'Sem som' : 'Mudo'), MUTE_ICON, toggleMute, call.muted));
    actions.appendChild(callButton('end', tr('Encerrar'), END, hangUp));
    if (c && c.direction === 'USER_INITIATED' && (c.state === 'ringing' || c.state === 'pre_accepted') && !call.asBiz) {
      actions.appendChild(callButton('take', tr('Atender como clínica'), BUTTON_ICON.PHONE_NUMBER, acceptAsBusiness));
    }
    /* The clinic called from this panel: the user's phone is this panel too. */
    if (c && c.direction === 'BUSINESS_INITIATED' && c.state === 'ringing' && call.asBiz && !call.asUser) {
      actions.appendChild(callButton('take', tr('Atender como usuário'), BUTTON_ICON.PHONE_NUMBER, acceptAsUser));
    }
  }
  function loadCalls() {
    return api('/settings/calls').then(function (d) {
      ((d && d.calls) || []).forEach(function (c) { state.calls[c.id] = c; });
      ((d && d.calls) || []).filter(function (c) { return c.direction === 'BUSINESS_INITIATED' && c.state === 'ringing'; }).forEach(onCall);
      renderChat();
    }).catch(function () {});
  }

  /*
   * ---------- voice notes: the recorder ----------
   * WhatsApp's voice note is Ogg Opus, mono. Chrome records no Ogg, so the
   * microphone goes through WebCodecs (AudioEncoder, opus) and the packets
   * are put in an Ogg stream here (RFC 7845). Without WebCodecs, the
   * browser's recorder is used: Ogg when it has it (a voice note), MP4 audio
   * otherwise (an audio file, as Meta takes it).
   */
  var OGG_CRC = (function () {
    var table = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var r = i << 24;
      for (var j = 0; j < 8; j++) r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) : (r << 1);
      table[i] = r >>> 0;
    }
    return table;
  })();
  function oggCrc(bytes) {
    var crc = 0;
    for (var i = 0; i < bytes.length; i++) crc = ((crc << 8) ^ OGG_CRC[((crc >>> 24) ^ bytes[i]) & 0xff]) >>> 0;
    return crc;
  }
  function oggPage(packets, granule, serial, sequence, flags) {
    var lacing = [];
    var size = 0;
    packets.forEach(function (p) {
      var n = p.length;
      while (n >= 255) { lacing.push(255); n -= 255; }
      lacing.push(n);
      size += p.length;
    });
    var page = new Uint8Array(27 + lacing.length + size);
    var view = new DataView(page.buffer);
    page.set([0x4f, 0x67, 0x67, 0x53], 0);
    page[5] = flags;
    view.setUint32(6, granule % 4294967296, true);
    view.setUint32(10, Math.floor(granule / 4294967296), true);
    view.setUint32(14, serial, true);
    view.setUint32(18, sequence, true);
    page[26] = lacing.length;
    page.set(lacing, 27);
    var at = 27 + lacing.length;
    packets.forEach(function (p) { page.set(p, at); at += p.length; });
    view.setUint32(22, oggCrc(page), true);
    return page;
  }
  var OPUS_PRESKIP = 312;
  function oggOpus(packets, channels) {
    var text = new TextEncoder();
    var head = new Uint8Array(19);
    head.set(text.encode('OpusHead'), 0);
    var hv = new DataView(head.buffer);
    head[8] = 1;
    head[9] = channels;
    hv.setUint16(10, OPUS_PRESKIP, true);
    hv.setUint32(12, 48000, true);
    var vendor = text.encode('whap');
    var tags = new Uint8Array(8 + 4 + vendor.length + 4);
    tags.set(text.encode('OpusTags'), 0);
    new DataView(tags.buffer).setUint32(8, vendor.length, true);
    tags.set(vendor, 12);
    var serial = Math.floor(Math.random() * 4294967295);
    var pages = [oggPage([head], 0, serial, 0, 2), oggPage([tags], 0, serial, 1, 0)];
    var granule = OPUS_PRESKIP;
    var group = [];
    var segments = 0;
    var sequence = 2;
    packets.forEach(function (p, i) {
      var needs = Math.floor(p.data.length / 255) + 1;
      if (segments + needs > 255) {
        pages.push(oggPage(group, granule, serial, sequence++, 0));
        group = [];
        segments = 0;
      }
      group.push(p.data);
      segments += needs;
      granule += p.samples;
      if (i === packets.length - 1) pages.push(oggPage(group, granule, serial, sequence++, 4));
    });
    return new Blob(pages, { type: 'audio/ogg' });
  }
  var rec = null;
  function canEncodeOpus() { return typeof AudioEncoder === 'function' && typeof MediaStreamTrackProcessor === 'function'; }
  function startVoice() {
    var t = selectedThread();
    if (!t || rec) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast(tr('Este navegador não dá acesso ao microfone.'), true); return; }
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
      var ctx = new AudioContext({ sampleRate: 48000 });
      var source = ctx.createMediaStreamSource(stream);
      var analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      rec = { stream: stream, ctx: ctx, analyser: analyser, started: Date.now(), packets: [], levels: [], thread: t, as: state.as, encoder: null, recorder: null, chunks: [] };
      if (canEncodeOpus()) recordOpus(rec, ctx, source);
      else recordWithRecorder(rec, stream);
      el('compose').classList.add('recording');
      el('recorder').hidden = false;
      document.querySelector('.compose-line').hidden = true;
      drawRecorder();
    }).catch(function (e) { toast(tr('Sem acesso ao microfone:') + ' ' + e.message, true); });
  }
  function recordOpus(r, ctx, source) {
    var dest = ctx.createMediaStreamDestination();
    dest.channelCount = 1;
    source.connect(dest);
    var reader = new MediaStreamTrackProcessor({ track: dest.stream.getAudioTracks()[0] }).readable.getReader();
    r.reader = reader;
    r.channels = 1;
    var encoder = new AudioEncoder({
      output: function (chunk) {
        var data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        r.packets.push({ data: data, samples: Math.round(((chunk.duration || 20000) * 48) / 1000) });
      },
      error: function (e) { r.failed = e; }
    });
    r.encoder = encoder;
    var pump = function () {
      reader.read().then(function (step) {
        if (step.done) return;
        var frame = step.value;
        if (encoder.state === 'unconfigured') {
          r.channels = frame.numberOfChannels;
          encoder.configure({ codec: 'opus', sampleRate: frame.sampleRate, numberOfChannels: frame.numberOfChannels, bitrate: 32000 });
        }
        if (encoder.state === 'configured') encoder.encode(frame);
        frame.close();
        pump();
      }).catch(function () { /* the reader was cancelled: the recording stopped */ });
    };
    pump();
  }
  function recordWithRecorder(r, stream) {
    var type = ['audio/ogg;codecs=opus', 'audio/mp4'].filter(function (x) { return window.MediaRecorder && MediaRecorder.isTypeSupported(x); })[0] || '';
    r.recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    r.recorder.ondataavailable = function (e) { if (e.data && e.data.size) r.chunks.push(e.data); };
    r.recorder.start();
  }
  function drawRecorder() {
    if (!rec) return;
    var canvas = el('voice-wave');
    var g = canvas.getContext('2d');
    var data = new Uint8Array(rec.analyser.fftSize);
    rec.analyser.getByteTimeDomainData(data);
    var peak = 0;
    for (var i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128));
    rec.levels.push(peak / 128);
    if (rec.levels.length > 120) rec.levels.shift();
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = getComputedStyle(el('voice-time')).color;
    var w = canvas.width / 120;
    rec.levels.forEach(function (level, k) {
      var h = Math.max(3, level * canvas.height * 1.6);
      g.fillRect(k * w + 1, (canvas.height - Math.min(h, canvas.height)) / 2, Math.max(1.5, w - 2), Math.min(h, canvas.height));
    });
    el('voice-time').textContent = clockOf((Date.now() - rec.started) / 1000);
    requestAnimationFrame(drawRecorder);
  }
  function stopVoice(send) {
    var r = rec;
    if (!r) return;
    rec = null;
    el('compose').classList.remove('recording');
    el('recorder').hidden = true;
    document.querySelector('.compose-line').hidden = false;
    var finished;
    if (r.encoder) {
      finished = r.reader.cancel().catch(function () {}).then(function () {
        return r.encoder.state === 'configured' ? r.encoder.flush() : null;
      }).then(function () {
        r.encoder.close();
        if (!r.packets.length) throw new Error(tr('A gravação ficou vazia.'));
        return { file: new File([oggOpus(r.packets, r.channels)], 'voz-' + Date.now() + '.ogg', { type: 'audio/ogg' }), voice: true };
      });
    } else {
      finished = new Promise(function (resolve) {
        r.recorder.onstop = function () {
          var type = (r.recorder.mimeType || 'audio/mp4').split(';')[0];
          resolve({ file: new File(r.chunks, 'voz-' + Date.now() + (type === 'audio/ogg' ? '.ogg' : '.m4a'), { type: type }), voice: type === 'audio/ogg' });
        };
        r.recorder.stop();
      });
    }
    finished.then(function (done) {
      r.stream.getTracks().forEach(function (t) { t.stop(); });
      r.ctx.close();
      if (send) return sendVoice(r.thread, r.as, done.file, done.voice);
    }).catch(function (e) {
      r.stream.getTracks().forEach(function (t) { t.stop(); });
      toast(e.message, true);
    });
  }
  /* The voice note goes like any audio: uploaded to the number's media, sent by id, voice: true. */
  function sendVoice(t, as, file, voice) {
    return uploadMedia(t.businessId, file).then(function (id) {
      var message = { messaging_product: 'whatsapp', type: 'audio', audio: { id: id } };
      if (voice) message.audio.voice = true;
      if (as === 'owner') {
        message.recipient_type = 'individual';
        message.to = digits(t.contact);
        return graph('/' + encodeURIComponent(t.businessId) + '/messages', { method: 'POST', body: message });
      }
      var headers = { 'X-Mock-From': digits(t.contact) };
      if (t.name) headers['X-Mock-Contact-Name'] = t.name;
      return graph('/' + encodeURIComponent(t.businessId) + '/messages', { method: 'POST', headers: headers, body: message });
    }).then(load);
  }

  /* ---------- numbers: businesses, WABAs, numbers ---------- */
  function loadAccounts() {
    return api('/settings/accounts').then(function (d) {
      state.accounts = d;
      renderAccounts();
      renderCounts();
    }).catch(function (e) { toast(e.message, true); });
  }
  function accountCall(path, body) {
    /* A refused call redraws too: the switch goes back to what the number is. */
    return graph(path, { method: 'POST', body: body || {} }).then(loadAccounts).catch(function (e) { toast(e.message, true); loadAccounts(); });
  }
  function inlineForm(fields, submitLabel, onSubmit) {
    var form = node('form', 'inline-form');
    var inputs = fields.map(function (f) {
      var i = node('input', f.cls || null);
      i.placeholder = tr(f.placeholder);
      i.value = f.value || '';
      if (f.inputmode) i.inputMode = f.inputmode;
      if (f.max) i.maxLength = f.max;
      i.setAttribute('aria-label', tr(f.placeholder));
      form.appendChild(i);
      return i;
    });
    var go = node('button', 'btn small', tr(submitLabel));
    go.type = 'submit';
    form.appendChild(go);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      onSubmit(inputs.map(function (i) { return i.value.trim(); }));
    });
    return form;
  }
  function badge(cls, text) { return node('span', 'badge ' + cls, tr(text)); }
  function renderAccounts() {
    var box = el('accounts');
    if (!box || !state.accounts) return;
    box.textContent = '';
    (state.accounts.businesses || []).forEach(function (biz) {
      var sec = node('section', 'biz');
      var head = node('div', 'biz-head');
      var title = node('h4', null, biz.name);
      head.appendChild(title);
      head.appendChild(node('code', null, biz.id));
      sec.appendChild(head);
      var wabaForm = inlineForm([{ placeholder: 'Nome da nova conta (WABA)', cls: 'grow' }], 'Criar conta', function (v) {
        if (!v[0]) return;
        api('/settings/accounts/wabas', { method: 'POST', body: { business_id: biz.id, name: v[0] } }).then(loadAccounts).catch(function (e) { toast(e.message, true); });
      });
      biz.wabas.forEach(function (w) { sec.appendChild(wabaCard(w)); });
      sec.appendChild(wabaForm);
      box.appendChild(sec);
    });
  }
  function wabaCard(w) {
    var card = node('div', 'waba');
    var head = node('div', 'waba-head');
    head.appendChild(node('b', null, w.name));
    head.appendChild(node('code', null, w.id));
    var add = node('button', 'btn ghost small', tr('+ Número'));
    add.type = 'button';
    head.appendChild(add);
    card.appendChild(head);
    var form = inlineForm([
      { placeholder: 'DDI', cls: 'cc', value: '55', inputmode: 'numeric', max: 3 },
      { placeholder: 'Número com DDD', cls: 'grow', inputmode: 'numeric' },
      { placeholder: 'Nome exibido', cls: 'grow' }
    ], 'Adicionar', function (v) {
      accountCall('/' + w.id + '/phone_numbers', { cc: v[0], phone_number: v[1], verified_name: v[2] });
    });
    form.hidden = true;
    add.addEventListener('click', function () { form.hidden = !form.hidden; });
    card.appendChild(form);
    if (!w.phone_numbers.length) card.appendChild(node('p', 'help', tr('Nenhum número nesta conta.')));
    w.phone_numbers.forEach(function (n) { card.appendChild(numberRow(n)); });
    return card;
  }
  function numberRow(n) {
    var row = node('div', 'num');
    var who = node('div', 'num-who');
    who.appendChild(node('b', null, n.display_phone_number));
    who.appendChild(node('span', null, n.verified_name + ' '));
    who.appendChild(node('span', 'num-id', n.id));
    row.appendChild(who);
    var registered = n.status === 'CONNECTED' && n.platform_type === 'CLOUD_API';
    var calling = String(n.calling && n.calling.status).toLowerCase() === 'enabled';
    var badges = node('div', 'num-badges');
    badges.appendChild(registered ? badge('ok', 'Na Cloud API')
      : n.status === 'DISCONNECTED' ? badge('bad', 'Fora da Cloud API')
      : n.code_verification_status === 'VERIFIED' ? badge('warn', 'Verificado, falta registrar') : badge('warn', 'Não verificado'));
    badges.appendChild(calling ? badge('ok', 'Ligações ativas') : badge('', 'Sem ligações'));
    row.appendChild(badges);
    var body = node('div', 'num-body');
    if (!registered) {
      var verified = n.code_verification_status === 'VERIFIED';
      var steps = node('ol', 'steps');
      var s1 = node('li', verified ? 'done' : 'now');
      var t1 = node('div', 'step-text');
      t1.appendChild(node('b', null, tr('Pedir o código')));
      t1.appendChild(document.createTextNode(' ' + tr('que a Meta manda por SMS ou ligação.')));
      if (!verified) {
        var ask = node('div', 'inline-form');
        [['SMS', 'Por SMS'], ['VOICE', 'Por ligação']].forEach(function (m) {
          var b = node('button', 'btn ghost small', tr(m[1]));
          b.type = 'button';
          b.addEventListener('click', function () { accountCall('/' + n.id + '/request_code', { code_method: m[0], language: 'pt_BR' }); });
          ask.appendChild(b);
        });
        t1.appendChild(ask);
      }
      if (n.pending_code && !verified) {
        var sms = node('div', 'sms');
        sms.appendChild(node('span', null, tr(n.pending_code.method === 'VOICE' ? 'A ligação da Meta diria:' : 'O SMS da Meta diria:')));
        sms.appendChild(node('code', null, n.pending_code.code));
        t1.appendChild(sms);
      }
      s1.appendChild(t1);
      steps.appendChild(s1);
      var s2 = node('li', verified ? 'done' : '');
      var t2 = node('div', 'step-text');
      t2.appendChild(node('b', null, tr('Confirmar o código')));
      if (!verified) t2.appendChild(inlineForm([{ placeholder: 'Código de 6 dígitos', inputmode: 'numeric', max: 6, value: n.pending_code ? n.pending_code.code : '' }], 'Verificar', function (v) {
        accountCall('/' + n.id + '/verify_code', { code: v[0] });
      }));
      s2.appendChild(t2);
      steps.appendChild(s2);
      var s3 = node('li', verified ? 'now' : '');
      var t3 = node('div', 'step-text');
      t3.appendChild(node('b', null, tr('Registrar na Cloud API')));
      t3.appendChild(document.createTextNode(' ' + tr(n.has_pin ? 'com o PIN de duas etapas já definido.' : 'O primeiro registro define o PIN de duas etapas.')));
      if (verified) t3.appendChild(inlineForm([{ placeholder: 'PIN de 6 dígitos', inputmode: 'numeric', max: 6 }], 'Registrar', function (v) {
        accountCall('/' + n.id + '/register', { messaging_product: 'whatsapp', pin: v[0] });
      }));
      s3.appendChild(t3);
      steps.appendChild(s3);
      body.appendChild(steps);
    } else {
      var toggles = node('div', 'toggles');
      var toggle = function (label, checked, onChange) {
        var l = node('label', 'toggle');
        var i = document.createElement('input');
        i.type = 'checkbox';
        i.checked = checked;
        i.addEventListener('change', function () { onChange(i.checked); });
        l.appendChild(i);
        l.appendChild(node('span', null, tr(label)));
        return l;
      };
      toggles.appendChild(toggle('Ligações', calling, function (on) {
        accountCall('/' + n.id + '/settings', { calling: { status: on ? 'enabled' : 'disabled' } });
      }));
      toggles.appendChild(toggle('Quem liga para a clínica permite que ela ligue de volta', String(n.calling && n.calling.callback_permission_status).toLowerCase() === 'enabled', function (on) {
        accountCall('/' + n.id + '/settings', { calling: { callback_permission_status: on ? 'enabled' : 'disabled' } });
      }));
      body.appendChild(toggles);
    }
    var foot = node('div', 'num-foot');
    foot.appendChild(node('span', null, n.webhook ? tr('Webhook:') + ' ' + n.webhook
      : calling ? tr('Sem webhook: nenhuma aplicação ouve as ligações; atenda como clínica no chat.')
      : tr('Sem webhook: as ligações não podem ser ativadas.')));
    if (registered) {
      var off = node('button', 'btn ghost small', tr('Tirar da Cloud API'));
      off.type = 'button';
      off.addEventListener('click', function () { accountCall('/' + n.id + '/deregister'); });
      foot.appendChild(off);
    }
    body.appendChild(foot);
    row.appendChild(body);
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
  /* The user's phone gives the receipt: the Cloud API read call, sent from the
     user's side (X-Mock-From), with the receipt it gives (X-Mock-Message-Status). */
  function setStatus(id, status) {
    var message = null;
    state.messages.forEach(function (m) { if (m.id === id) message = m; });
    if (!message) return Promise.resolve();
    return graph('/' + encodeURIComponent(message.businessId) + '/messages', {
      method: 'POST',
      headers: { 'X-Mock-From': message.contact, 'X-Mock-Message-Status': status },
      body: { messaging_product: 'whatsapp', status: 'read', message_id: id }
    })
      .then(function () { applyStatus(id, status); toast(tr('Mensagem marcada como') + ' ' + tr(STATUS_TEXT[status]) + '.'); })
      .catch(function (e) { toast(e.message, true); });
  }
  function applyStatus(id, status) {
    state.messages.forEach(function (m) { if (m.id === id) m.status = status; });
    render();
  }

  /* ---------- sending as the patient ---------- */
  /* ---------- attachments ---------- */
  /* The kind of message a file is sent as, as Meta sorts media types. */
  function mediaKind(type) {
    if (type === 'image/webp') return 'sticker';
    if (type === 'image/jpeg' || type === 'image/png') return 'image';
    if (type.indexOf('video/') === 0) return 'video';
    if (type.indexOf('audio/') === 0) return 'audio';
    return 'document';
  }
  function sizeText(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }
  /* Meta's upload: multipart, the file and its type; the answer is the id. */
  function uploadMedia(businessId, file) {
    var form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', file.type || 'application/octet-stream');
    form.append('file', file, file.name);
    return fetch('/' + REFERENCE.version + '/' + encodeURIComponent(businessId) + '/media', {
      method: 'POST', headers: { Authorization: PANEL_TOKEN }, body: form
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error((data && data.error && data.error.message) || ('HTTP ' + r.status));
        return data.id;
      });
    });
  }
  /* The message of a file and its caption, once uploaded. */
  function mediaMessage(file, id, caption) {
    var kind = mediaKind(file.type);
    var object = { id: id };
    if (caption && kind !== 'audio' && kind !== 'sticker') object.caption = caption;
    if (kind === 'document') object.filename = file.name;
    var message = { type: kind };
    message[kind] = object;
    return message;
  }
  function textMessage(text) { return { type: 'text', text: { body: text } }; }

  /* A clip button, its file input and the chip that shows the chosen file. */
  function attacher(button, input, chip, onChange) {
    var current = null;
    function paint() {
      chip.textContent = '';
      chip.hidden = !current;
      if (current) {
        if (current.preview) {
          var img = document.createElement('img');
          img.src = current.preview;
          img.alt = '';
          chip.appendChild(img);
        } else {
          var box = node('span', 'att-icon');
          box.appendChild(icon(mediaKind(current.file.type) === 'document' ? DOC_ICON : MEDIA_ICON));
          chip.appendChild(box);
        }
        var name = node('span', 'att-name', current.file.name);
        chip.appendChild(name);
        chip.appendChild(node('small', null, tr(KIND_LABEL[mediaKind(current.file.type)]) + ' · ' + sizeText(current.file.size)));
        var remove = node('button', null, '×');
        remove.type = 'button';
        remove.setAttribute('aria-label', tr('Tirar o anexo'));
        remove.addEventListener('click', clear);
        chip.appendChild(remove);
      }
      if (onChange) onChange();
    }
    function clear() {
      if (current && current.preview) URL.revokeObjectURL(current.preview);
      current = null;
      input.value = '';
      paint();
    }
    button.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      if (current && current.preview) URL.revokeObjectURL(current.preview);
      current = { file: file, preview: file.type.indexOf('image/') === 0 ? URL.createObjectURL(file) : null };
      paint();
    });
    return { get: function () { return current ? current.file : null; }, clear: clear };
  }
  var KIND_LABEL = { image: 'Imagem', video: 'Vídeo', audio: 'Áudio', document: 'Documento', sticker: 'Figurinha' };

  /* One conversation, one call: the user and the clinic both write through the
     Cloud API send. The user's side carries X-Mock-From (and the name the
     webhook shows); the message enters as inbound and goes to the webhook.
     A file goes first to the number's media, then by its id. */
  function prepare(businessId, file, text) {
    if (!file) return Promise.resolve(textMessage(text));
    return uploadMedia(businessId, file).then(function (id) { return mediaMessage(file, id, text); });
  }
  function sendAsPatient(businessId, contact, name, text, file) {
    var headers = { 'X-Mock-From': digits(contact) };
    if (name) headers['X-Mock-Contact-Name'] = name;
    return prepare(businessId, file, text).then(function (message) {
      message.messaging_product = 'whatsapp';
      return graph('/' + encodeURIComponent(businessId) + '/messages', { method: 'POST', headers: headers, body: message });
    }).then(function (res) {
      if (!webhookFor(businessId)) toast(tr('Registrada aqui. Sem webhook, a aplicação não recebeu.'));
      return load().then(function () { return res; });
    });
  }
  /* ---------- sending as the number's owner ---------- */
  // The same Cloud API call the application makes, so the message is stored as
  // outbound and its ticks follow the delivery mode.
  function sendAsOwner(businessId, contact, text, file) {
    return prepare(businessId, file, text).then(function (message) {
      message.messaging_product = 'whatsapp';
      message.recipient_type = 'individual';
      message.to = digits(contact);
      return graph('/' + encodeURIComponent(businessId) + '/messages', { method: 'POST', body: message });
    }).then(function (res) { return load().then(function () { return res; }); });
  }
  function setAs(mode) {
    state.as = mode;
    document.querySelectorAll('.as button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-as') === mode ? 'true' : 'false');
    });
    el('compose').classList.toggle('owner', mode === 'owner');
    paintAs();
    renderQuick();
    renderChat();
    el('reply').focus();
  }
  /* The composer says who is speaking, in the language of the panel. */
  function paintAs() {
    var text = AS_TEXT[state.as];
    el('reply').placeholder = tr(text.label);
    el('reply-label').textContent = tr(text.label);
    el('send').setAttribute('aria-label', tr(text.send));
  }
  function renderQuick() {
    var box = el('quick');
    box.textContent = '';
    QUICK[state.as].forEach(function (q) {
      var b = node('button', null, tr(q));
      b.type = 'button';
      b.addEventListener('click', function () { el('reply').value = tr(q); updateSend(); submitReply(); });
      box.appendChild(b);
    });
  }
  function submitReply(e) {
    if (e) e.preventDefault();
    var t = selectedThread();
    var text = el('reply').value.trim();
    var file = composeFile.get();
    /* One send at a time: a second submit of the same text (a password
       manager re-dispatching the form, a double Enter) is not a second message. */
    if (!t || (!text && !file) || state.sending) return;
    state.sending = true;
    el('send').disabled = true;
    var sending = state.as === 'owner'
      ? sendAsOwner(t.businessId, t.contact, text, file)
      : sendAsPatient(t.businessId, t.contact, t.name, text, file);
    sending.then(function () {
      el('reply').value = '';
      composeFile.clear();
      autosize();
    }).catch(function (err) { toast(err.message, true); }).then(function () { state.sending = false; updateSend(); });
  }
  function autosize() {
    var r = el('reply');
    r.style.height = 'auto';
    r.style.height = Math.min(140, r.scrollHeight) + 'px';
  }
  /* As on the phone: with nothing to send, the send button is the microphone. */
  function updateSend() {
    var empty = !el('reply').value.trim() && !composeFile.get();
    el('send').disabled = empty || !!state.sending;
    el('send').hidden = empty;
    el('voice').hidden = !empty;
  }
  var composeFile = attacher(el('attach'), el('attach-file'), el('attachment'), function () { updateSend(); });

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
    el('tools').setAttribute('aria-hidden', open ? 'false' : 'true');
    /* The panel covers the whole screen, so it behaves like a dialog: the focus
       goes in when it opens and comes back to the button that opened it. */
    if (open) el('close-tools').focus();
    else el('toggle-tools').focus();
  }
  function selectTab(name) {
    ['delivery', 'webhook', 'events', 'templates', 'numbers', 'api'].forEach(function (n) {
      el('tab-' + n).setAttribute('aria-selected', n === name ? 'true' : 'false');
      el('pane-' + n).hidden = n !== name;
    });
    if (name === 'api') { renderDocs(); spy(); }
    if (name === 'numbers') loadAccounts();
  }
  /* The tabs say how much is inside: webhook calls and templates. */
  function renderCounts() {
    el('count-events').textContent = state.events.length ? String(state.events.length) : '';
    el('count-templates').textContent = state.templates.length ? String(state.templates.length) : '';
    var numbers = 0;
    ((state.accounts && state.accounts.businesses) || []).forEach(function (b) {
      b.wabas.forEach(function (w) { numbers += w.phone_numbers.length; });
    });
    el('count-numbers').textContent = numbers ? String(numbers) : '';
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
      [tr('Servidor'), pill(state.healthy === false ? tr('fora do ar') : tr('no ar'), state.healthy === false ? 'bad' : 'ok')],
      [tr('Tempo real'), pill(state.live ? tr('conectado') : tr('reconectando'), state.live ? 'ok' : 'bad')],
      [tr('Mensagens'), state.messages.length + ' (' + outCount + ' ' + tr('da clínica') + ')']
    ]);
    var c = state.config;
    var rows = [];
    if (!c) rows.push([tr('Estado'), tr('carregando…')]);
    else {
      rows.push([tr('Estado'), c.configured ? pill(tr('configurado'), 'ok') : pill(tr('sem webhook'), 'bad')]);
      if (c.fallbackUrl) rows.push([tr('Padrão'), c.fallbackUrl]);
      rows.push([tr('Assinatura'), c.secretSet ? pill(tr('HMAC ativo'), 'ok') : pill(tr('sem segredo'))]);
    }
    rows.push([tr('Atraso da resposta'), state.delayMs + ' ms']);
    kv(el('webhook-kv'), rows);
    renderDestinations();
    if (!el('wh-phone').value) {
      var t = selectedThread();
      el('wh-phone').value = state.business || (t ? t.businessId : '');
    }
    renderEvents();
    renderTemplates();
    renderCounts();
    if (!el('pane-api').hidden) renderDocs();
  }
  /* Each number's own address (Meta's override), with a way back to the
     default: the same call with an empty override_callback_uri. */
  function renderDestinations() {
    var ul = el('wh-dest');
    ul.textContent = '';
    var mappings = (state.config && state.config.mappings) || [];
    mappings.forEach(function (m) {
      var li = node('li');
      li.appendChild(node('span', 'who', m.phone));
      li.appendChild(node('code', null, m.url));
      var remove = node('button', null, tr('Remover'));
      remove.type = 'button';
      remove.setAttribute('aria-label', tr('Remover o webhook de') + ' ' + m.phone);
      remove.addEventListener('click', function () {
        graph('/' + encodeURIComponent(m.phone), {
          method: 'POST',
          body: { webhook_configuration: { override_callback_uri: '' } }
        }).then(function () { toast(tr('O número volta ao endereço padrão.')); loadWebhooks(); })
          .catch(function (err) { toast(err.message, true); });
      });
      li.appendChild(remove);
      ul.appendChild(li);
    });
  }
  var KIND = { message: 'Mensagem do usuário', status: 'Status de mensagem', template_status: 'Status de template' };
  function renderEvents() {
    var ul = el('events');
    ul.textContent = '';
    if (!state.events.length) { ul.appendChild(node('li', 'side-empty', tr('Nenhuma chamada ao webhook ainda.'))); return; }
    state.events.slice(0, 200).forEach(function (ev) {
      var li = node('li', 'event');
      var b = node('button');
      b.type = 'button';
      b.setAttribute('aria-expanded', 'false');
      b.appendChild(node('span', 'ev-kind', tr(KIND[ev.kind] || 'Evento')));
      var ok = ev.status === 'delivered';
      b.appendChild(pill(tr(ok ? 'entregue' : 'falhou') + (ev.httpStatus ? ' · ' + ev.httpStatus : ''), ok ? 'ok' : 'bad'));
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
  /* ---------- the api tab ---------- */
  function apiBase() { return location.origin; }
  function slug(text) { return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  /* The call as a terminal runs it. The X-Mock lines are marked: they are
     the mock's, and a real Meta call leaves them out. */
  function curlLines(op, body) {
    var lines = ['curl -X ' + op.method + ' ' + SQ + apiBase() + op.call + SQ];
    if (!op.noAuth) lines.push('  -H ' + SQ + 'Authorization: Bearer $TOKEN' + SQ);
    if (body !== undefined) lines.push('  -H ' + SQ + 'Content-Type: application/json' + SQ);
    Object.keys(op.headers || {}).forEach(function (name) {
      lines.push('  -H ' + SQ + name + ': ' + op.headers[name] + SQ);
    });
    if (body !== undefined) {
      var json = JSON.stringify(body, null, 2).split(SQ).join(SQ + BS + SQ + SQ);
      lines.push('  -d ' + SQ + json + SQ);
    }
    return lines.map(function (line, i) { return i < lines.length - 1 ? line + ' ' + BS : line; });
  }
  function paintCurl(pre, op, body) {
    pre.textContent = '';
    curlLines(op, body).forEach(function (line, i) {
      if (i) pre.appendChild(document.createTextNode(NL));
      var span = node('span', line.indexOf('X-Mock-') >= 0 ? 'mock-line' : null, line);
      pre.appendChild(span);
    });
  }

  /* Meta's markdown, read as text: paragraphs, bullet lists and links. */
  function appendLinked(parent, text) {
    var at = 0;
    while (at < text.length) {
      var open = text.indexOf('[', at);
      var mid = open < 0 ? -1 : text.indexOf('](', open);
      var close = mid < 0 ? -1 : text.indexOf(')', mid);
      if (open < 0 || mid < 0 || close < 0) { parent.appendChild(document.createTextNode(text.slice(at))); return; }
      parent.appendChild(document.createTextNode(text.slice(at, open)));
      var a = node('a', null, text.slice(open + 1, mid));
      a.href = text.slice(mid + 2, close);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      parent.appendChild(a);
      at = close + 1;
    }
  }
  /* Inline markdown: bold marks dropped, code spans drawn as code, links kept. */
  function appendInline(parent, text) {
    text.split('**').join('').split('${'`'}').forEach(function (part, i) {
      if (i % 2) parent.appendChild(node('code', null, part));
      else appendLinked(parent, part);
    });
  }
  function isBullet(line) { return line.indexOf('- ') === 0 || line.indexOf('* ') === 0; }
  function prose(text) {
    var box = node('div', 'ep-desc');
    text.split(NL + NL).forEach(function (block) {
      var lines = block.split(NL).map(function (l) { return l.trim(); }).filter(Boolean);
      while (lines.length && lines[0].charAt(0) === '#') {
        box.appendChild(node('h6', null, lines.shift().replace(/^#+ */, '')));
      }
      if (!lines.length) return;
      if (lines.every(isBullet)) {
        var ul = node('ul');
        lines.forEach(function (l) { var li = node('li'); appendInline(li, l.slice(2)); ul.appendChild(li); });
        box.appendChild(ul);
        return;
      }
      var p = node('p');
      appendInline(p, lines.join(' '));
      box.appendChild(p);
    });
    return box;
  }
  /* The path as Meta writes it, the parameters set apart. */
  function pathNode(path) {
    var code = node('code', 'ep-path');
    path.split('/').forEach(function (part, i) {
      if (i) code.appendChild(document.createTextNode('/'));
      if (part.charAt(0) === '{') code.appendChild(node('i', null, part));
      else if (part) code.appendChild(document.createTextNode(part));
    });
    return code;
  }
  function headerTable(names) {
    var table = node('table', 'hdr-table');
    var head = node('tr');
    ['Header do mock', 'Valor', 'O que faz'].forEach(function (t) { head.appendChild(node('th', null, tr(t))); });
    table.appendChild(head);
    names.forEach(function (raw) {
      /* Headers are case-insensitive; the table writes them as Meta's docs do. */
      var name = raw;
      Object.keys(MOCK_HEADER_DOC).forEach(function (known) {
        if (known.toLowerCase() === raw.toLowerCase()) name = known;
      });
      var doc = MOCK_HEADER_DOC[name] || ['', ''];
      var row = node('tr');
      var cell = node('td');
      cell.appendChild(node('code', null, name));
      row.appendChild(cell);
      row.appendChild(node('td', 'hdr-value', tr(doc[0])));
      row.appendChild(node('td', null, tr(doc[1])));
      table.appendChild(row);
    });
    return table;
  }
  function queryTable(params) {
    var table = node('table', 'hdr-table q-table');
    var head = node('tr');
    ['Parâmetro', '', 'Descrição'].forEach(function (t) { head.appendChild(node('th', null, t ? tr(t) : '')); });
    table.appendChild(head);
    params.forEach(function (p) {
      var row = node('tr');
      var cell = node('td');
      cell.appendChild(node('code', null, p.name));
      row.appendChild(cell);
      row.appendChild(node('td', 'q-req', p.required ? tr('obrigatório') : ''));
      var desc = node('td');
      appendLinked(desc, (p.description || '').split(NL).join(' '));
      row.appendChild(desc);
      table.appendChild(row);
    });
    return table;
  }

  function renderOperation(op, topic) {
    var item = node('article', 'ep');
    item.id = 'ep-' + op.id;
    item.setAttribute('data-search', (op.method + ' ' + op.path + ' ' + op.summary + ' ' + op.id).toLowerCase());
    var line = node('div', 'ep-line');
    var method = node('span', 'ep-method', op.method);
    method.setAttribute('data-method', op.method);
    line.appendChild(method);
    line.appendChild(pathNode(op.path));
    var state = node('span', 'ep-state', tr(op.simulated ? 'com estado' : 'exemplo da Meta'));
    state.setAttribute('data-simulated', op.simulated ? 'true' : 'false');
    state.setAttribute('title', tr(op.simulated
      ? 'O mock guarda e muda o que a chamada mexe: a próxima leitura mostra.'
      : 'O mock valida a chamada pela especificação e responde com a resposta de exemplo da Meta.'));
    line.appendChild(state);
    item.appendChild(line);
    item.appendChild(node('h5', 'ep-summary', topic.own ? tr(op.summary) : op.summary));
    if (op.description) {
      var desc = prose(topic.own ? tr(op.description) : op.description);
      item.appendChild(desc);
      if (op.description.length > 360) {
        desc.classList.add('clamped');
        var more = node('button', 'ep-more', tr('Ler tudo'));
        more.type = 'button';
        more.addEventListener('click', function () {
          var open = desc.classList.toggle('clamped');
          more.textContent = tr(open ? 'Ler tudo' : 'Mostrar menos');
        });
        item.appendChild(more);
      }
    }
    if (op.query && op.query.length) item.appendChild(queryTable(op.query));
    if (op.mockHeaders && op.mockHeaders.length) item.appendChild(headerTable(op.mockHeaders));

    var code = node('div', 'ep-code');
    var bar = node('div', 'ep-bar');
    var pre = node('pre');
    var examples = op.examples || [];
    if (examples.length > 1) {
      var mount = node('div', 'ep-example');
      bar.appendChild(mount);
      var options = examples.map(function (e, i) { return { value: String(i), code: '', label: topic.own ? tr(e.name) : e.name }; });
      createSelect(mount, options, function (option) { paintCurl(pre, op, examples[Number(option.value)].value); }).set('0');
    } else if (examples.length === 1 && examples[0].name !== 'Example' && examples[0].name !== 'Exemplo') {
      bar.appendChild(node('span', 'ep-example-name', topic.own ? tr(examples[0].name) : examples[0].name));
    }
    var copy = node('button', 'ep-copy', tr('copiar'));
    copy.type = 'button';
    copy.addEventListener('click', function () { copyText(pre.textContent, copy); });
    bar.appendChild(copy);
    code.appendChild(bar);
    paintCurl(pre, op, examples.length ? examples[0].value : undefined);
    code.appendChild(pre);
    item.appendChild(code);

    if (op.response !== null && op.response !== undefined) {
      var answer = node('details', 'ep-response');
      answer.appendChild(node('summary', null, tr('Resposta 200')));
      answer.addEventListener('toggle', function () {
        if (answer.open && !answer.querySelector('pre')) {
          answer.appendChild(node('pre', null, JSON.stringify(op.response, null, 2)));
        }
      });
      item.appendChild(answer);
    }
    return item;
  }

  var docs = { drawn: false, lang: null, topics: [], links: [], frame: 0 };
  function docTopics() {
    var topics = REFERENCE.topics.slice();
    topics.splice(1, 0, userTopic());
    topics.push(settingsTopic());
    return topics;
  }
  /* Drawn once per language: a redraw of the tools never resets the reading. */
  function renderDocs() {
    var box = el('docs');
    if (!box || (docs.drawn && docs.lang === state.lang)) return;
    docs.drawn = true;
    docs.lang = state.lang;
    el('api-base').textContent = apiBase() + '/' + REFERENCE.version;
    box.textContent = '';
    var toc = el('api-toc');
    toc.textContent = '';
    toc.appendChild(node('b', null, tr('Nesta página')));
    docs.topics = docTopics();
    docs.links = [];
    var total = 0;
    docs.topics.forEach(function (topic) {
      var id = 'topic-' + slug(topic.name);
      var kind = topic.kind || 'meta';
      var section = node('section', 'topic');
      section.id = id;
      section.setAttribute('data-kind', kind);
      var head = node('div', 'topic-head');
      head.appendChild(node('h4', null, topic.own ? tr(topic.name) : topic.name));
      head.appendChild(node('span', 'topic-kind', kind === 'mock' ? tr('Só do mock') : 'Cloud API'));
      head.appendChild(node('span', 'topic-count', String(topic.operations.length)));
      section.appendChild(head);
      if (topic.description) section.appendChild(prose(topic.own ? tr(topic.description) : topic.description));
      if (kind === 'mock') toc.appendChild(node('div', 'toc-divider', tr('Só do mock')));
      var link = node('a', 'toc-topic', topic.own ? tr(topic.name) : topic.name);
      link.href = '#' + id;
      link.setAttribute('data-kind', kind);
      link.setAttribute('data-target', id);
      toc.appendChild(link);
      var list = node('ul', 'toc-eps');
      topic.operations.forEach(function (op) {
        total += 1;
        section.appendChild(renderOperation(op, topic));
        var li = node('li');
        var a = node('a', 'toc-ep');
        a.href = '#ep-' + op.id;
        a.setAttribute('data-target', 'ep-' + op.id);
        a.appendChild(node('b', null, op.method));
        a.appendChild(node('span', null, topic.own ? tr(op.summary) : op.summary));
        li.appendChild(a);
        list.appendChild(li);
      });
      toc.appendChild(list);
      docs.links.push({ topic: section, link: link, list: list });
      box.appendChild(section);
    });
    docs.total = total;
    el('api-filter').placeholder = tr('Filtrar') + ' ' + total + ' ' + tr('chamadas');
    filterDocs();
    spy();
  }

  /* The table of contents follows the reading: the topic in view is marked
     and opens its calls; the call in view is marked inside it. */
  function spy() {
    var pane = el('pane-api');
    if (pane.hidden || !docs.links.length) return;
    var top = pane.getBoundingClientRect().top + 96;
    var current = docs.links[0];
    docs.links.forEach(function (entry) {
      if (entry.topic.hidden) return;
      if (entry.topic.getBoundingClientRect().top <= top) current = entry;
    });
    var currentEp = null;
    current.topic.querySelectorAll('.ep').forEach(function (ep) {
      if (!ep.hidden && ep.getBoundingClientRect().top <= top) currentEp = ep.id;
    });
    docs.links.forEach(function (entry) {
      entry.link.setAttribute('aria-current', entry === current ? 'true' : 'false');
    });
    el('api-toc').querySelectorAll('.toc-ep').forEach(function (a) {
      a.setAttribute('aria-current', a.getAttribute('data-target') === currentEp ? 'true' : 'false');
    });
    var toc = el('api-toc');
    var mark = current.link.offsetTop;
    if (mark < toc.scrollTop + 24 || mark > toc.scrollTop + toc.clientHeight - 80) {
      toc.scrollTop = Math.max(0, mark - toc.clientHeight / 4);
    }
  }
  el('pane-api').addEventListener('scroll', function () {
    if (docs.frame) return;
    docs.frame = requestAnimationFrame(function () { docs.frame = 0; spy(); });
  }, { passive: true });
  el('api-toc').addEventListener('click', function (e) {
    var a = e.target.closest('a[data-target]');
    if (!a) return;
    e.preventDefault();
    var target = el(a.getAttribute('data-target'));
    if (!target) return;
    var pane = el('pane-api');
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    pane.scrollTo({
      top: pane.scrollTop + target.getBoundingClientRect().top - pane.getBoundingClientRect().top - 16,
      behavior: reduce ? 'auto' : 'smooth'
    });
  });

  /* The filter narrows the page and the table of contents together. */
  function filterDocs() {
    var query = (el('api-filter').value || '').trim().toLowerCase();
    var shown = 0;
    docs.links.forEach(function (entry) {
      var visible = 0;
      entry.topic.querySelectorAll('.ep').forEach(function (ep) {
        var hit = !query || ep.getAttribute('data-search').indexOf(query) >= 0;
        ep.hidden = !hit;
        var a = entry.list.querySelector('a[data-target="' + ep.id + '"]');
        if (a) a.parentNode.hidden = !hit;
        if (hit) visible += 1;
      });
      var topicHit = !query || visible > 0;
      entry.topic.hidden = !topicHit;
      entry.link.hidden = !topicHit;
      entry.list.hidden = !topicHit;
      entry.list.classList.toggle('open', !!query && visible > 0);
      shown += visible;
    });
    el('api-found').textContent = query ? shown + ' ' + tr('de') + ' ' + docs.total : '';
    spy();
  }
  el('api-filter').addEventListener('input', filterDocs);

  function copyText(text, button) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      toast(tr('Não consegui copiar.'), true);
      return;
    }
    navigator.clipboard.writeText(text).then(function () {
      button.textContent = tr('Copiado.');
      setTimeout(function () { button.textContent = tr('copiar'); }, 1600);
    }).catch(function () { toast(tr('Não consegui copiar.'), true); });
  }

  /* The body of a template, as plain text. */
  function templateBody(tpl) {
    var body = '';
    (tpl.components || []).forEach(function (c) { if (c.type === 'BODY' && c.text) body = c.text; });
    return body;
  }
  function templateKey(tpl) { return tpl.name + '_' + (tpl.language || 'en'); }

  /* The languages a template can be created in. */
  function languageOptions() {
    return [
      { value: 'pt_BR', label: tr('Português (BR)') },
      { value: 'en_US', label: tr('Inglês (EUA)') },
      { value: 'en', label: tr('Inglês') },
      { value: 'es', label: tr('Espanhol') },
      { value: 'fr', label: tr('Francês') },
      { value: 'de', label: tr('Alemão') },
      { value: 'it', label: tr('Italiano') },
      { value: 'ja', label: tr('Japonês') },
      { value: 'ko', label: tr('Coreano') },
      { value: 'zh_CN', label: tr('Chinês (simp.)') },
      { value: 'zh_TW', label: tr('Chinês (trad.)') },
      { value: 'ar', label: tr('Árabe') },
      { value: 'ru', label: tr('Russo') },
      { value: 'hi', label: tr('Hindi') },
      { value: 'id', label: tr('Indonésio') },
      { value: 'nl', label: tr('Holandês') },
      { value: 'tr', label: tr('Turco') },
      { value: 'pl', label: tr('Polonês') },
      { value: 'vi', label: tr('Vietnamita') },
      { value: 'th', label: tr('Tailandês') },
      { value: 'uk', label: tr('Ucraniano') },
      { value: 'da', label: tr('Dinamarquês') }
    ];
  }
  /* The kind of message the template is for. */
  function categoryOptions() {
    return [
      { value: 'UTILITY', label: tr('Utilidade'), hint: tr('confirmação, lembrete, recibo') },
      { value: 'MARKETING', label: tr('Marketing'), hint: tr('promoção e divulgação') },
      { value: 'AUTHENTICATION', label: tr('Autenticação'), hint: tr('código de verificação') }
    ];
  }
  /* What the mock tells the application when the template is used. */
  function reviewOptions() {
    return [
      { value: 'APPROVED', label: tr('Aprovado'), hint: tr('o envio funciona') },
      { value: 'PENDING', label: tr('Pendente'), hint: tr('a revisão não terminou') },
      { value: 'REJECTED', label: tr('Rejeitado'), hint: tr('o envio falha') },
      { value: 'PAUSED', label: tr('Pausado'), hint: tr('o envio falha') },
      { value: 'DISABLED', label: tr('Desativado'), hint: tr('o envio falha') }
    ];
  }
  var selects = {};

  /* A select of our own: the native dropdown cannot be styled. */
  /* The code beside an option's label (pt_BR, UTILITY); an option whose
     value is only an index says code: '' and shows none. */
  function codeOf(option) { return option.code !== undefined ? option.code : option.value; }
  function createSelect(mount, options, onChange) {
    var wrap = node('div', 'sel');
    var trigger = node('button', 'sel-trigger');
    trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    var valueBox = node('span', 'sel-value');
    var label = node('b');
    var hint = node('small');
    valueBox.appendChild(label);
    valueBox.appendChild(hint);
    trigger.appendChild(valueBox);
    trigger.appendChild(node('span', 'sel-caret', '▾'));
    var menu = node('div', 'sel-menu');
    menu.setAttribute('role', 'listbox');

    var current = null;
    function close() {
      menu.setAttribute('data-open', 'false');
      trigger.setAttribute('aria-expanded', 'false');
    }
    function paint(option) {
      current = option;
      label.textContent = option.label;
      hint.textContent = codeOf(option);
      options.forEach(function (o) {
        o.button.setAttribute('aria-selected', o.value === option.value ? 'true' : 'false');
      });
    }
    options.forEach(function (option) {
      var b = node('button', 'sel-option');
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.appendChild(node('b', null, option.label));
      b.appendChild(node('small', null, [codeOf(option), option.hint].filter(Boolean).join(' · ')));
      b.addEventListener('click', function () {
        paint(option);
        close();
        if (onChange) onChange(option);
      });
      menu.appendChild(b);
      option.button = b;
    });
    trigger.addEventListener('click', function () {
      if (menu.getAttribute('data-open') === 'true') { close(); return; }
      menu.setAttribute('data-open', 'true');
      trigger.setAttribute('aria-expanded', 'true');
    });
    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (menu.getAttribute('data-open') !== 'true') return;
      close();
      trigger.focus();
    });
    wrap.appendChild(trigger);
    wrap.appendChild(menu);
    mount.textContent = '';
    mount.appendChild(wrap);

    return {
      /* Set without firing the change: the form is being filled, not used. */
      set: function (value) {
        var found = null;
        options.forEach(function (o) { if (o.value === value) found = o; });
        paint(found || options[0]);
      },
      get: function () { return current ? current.value : null; },
      setDisabled: function (off) { trigger.disabled = !!off; },
      /* The tone of the select: the quiet one, or the one that warns. */
      setTone: function (tone) {
        if (tone) wrap.setAttribute('data-tone', tone);
        else wrap.removeAttribute('data-tone');
      }
    };
  }

  function isPositional(names) {
    return names.every(function (n) { return /^[0-9]+$/.test(n); });
  }
  /* The placeholders the body asks for, in order. */
  function templatePlaceholders(body) {
    var found = [];
    var text = body || '';
    var at = 0;
    while (at < text.length) {
      var open = text.indexOf('{{', at);
      if (open < 0) break;
      var close = text.indexOf('}}', open + 2);
      if (close < 0) break;
      /* Positional ({{1}}) or named ({{patient_name}}), as Meta takes them. */
      var number = text.slice(open + 2, close).trim();
      if (/^([0-9]+|[a-z_][a-z0-9_]*)$/.test(number) && found.indexOf(number) < 0) found.push(number);
      at = close + 2;
    }
    if (!isPositional(found)) return found;
    return found.sort(function (a, b) { return Number(a) - Number(b); });
  }

  /*
   * The application's templates first; the examples of templates/examples/
   * after them, folded, so they never crowd the list the application uses.
   */
  function renderTemplates(force) {
    var list = el('tpl-list');
    list.textContent = '';
    var own = state.templates.filter(function (t) { return !t.example; });
    var examples = state.templates.filter(function (t) { return t.example; });
    if (!own.length) {
      list.appendChild(node('div', 'side-empty', tr('Nenhum template da aplicação ainda.')));
    }
    own.forEach(function (tpl) { list.appendChild(templateItem(tpl)); });
    if (examples.length) {
      var group = node('details', 'tpl-examples');
      var selectedExample = examples.some(function (t) { return templateKey(t) === state.tpl; });
      group.open = state.examplesOpen || selectedExample;
      var summary = node('summary');
      summary.appendChild(node('b', null, tr('Exemplos')));
      summary.appendChild(node('span', 'tpl-examples-count', String(examples.length)));
      group.appendChild(summary);
      group.appendChild(node('p', 'help', tr('Um template para cada recurso da Meta: cabeçalhos de mídia e localização, botões, carrossel, oferta, código de acesso. Vêm de templates/examples/.')));
      examples.forEach(function (tpl) { group.appendChild(templateItem(tpl)); });
      group.addEventListener('toggle', function () { state.examplesOpen = group.open; });
      list.appendChild(group);
    }
    renderTemplateForm(force);
  }

  function templateItem(tpl) {
    var key = templateKey(tpl);
    var item = node('button', 'tpl-item' + (key === state.tpl ? ' on' : ''));
    item.type = 'button';
    var title = node('span', 'tpl-item-top');
    title.appendChild(node('b', null, tpl.name));
    if (tpl.status) {
      var status = node('span', 'tpl-status', tr(STATUS_LABEL[tpl.status] || tpl.status));
      status.setAttribute('data-status', tpl.status);
      title.appendChild(status);
    }
    item.appendChild(title);
    item.appendChild(node('small', null, (tpl.language || 'en') + (tpl.category ? ' · ' + tpl.category.toLowerCase() : '')));
    var body = templateBody(tpl);
    if (body) item.appendChild(node('span', 'tpl-preview', body));
    item.addEventListener('click', function () {
      state.tpl = key;
      renderTemplates(true);
    });
    return item;
  }

  function selectedTemplate() {
    if (!state.tpl) return null;
    for (var i = 0; i < state.templates.length; i++) {
      if (templateKey(state.templates[i]) === state.tpl) return state.templates[i];
    }
    return null;
  }

  function renderTemplateVars() {
    var box = el('tpl-vars');
    var placeholders = templatePlaceholders(el('tpl-body').value);
    var known = state.tplVars || {};
    var next = {};
    placeholders.forEach(function (n) {
      next[n] = known[n] ? known[n] : { example: '' };
    });
    state.tplVars = next;

    box.textContent = '';
    if (!placeholders.length) { renderTemplatePreview(); return; }
    box.appendChild(node('div', 'vars-head', tr('Variáveis do corpo')));
    placeholders.forEach(function (n) {
      var row = node('div', 'var-row');
      var chip = node('span', 'var-chip');
      chip.setAttribute('data-var', n);
      paintChip(chip, n, next[n].example);
      row.appendChild(chip);
      var example = node('input', 'var-input');
      example.type = 'text';
      example.placeholder = tr('Exemplo: Mariana');
      example.value = next[n].example;
      example.addEventListener('input', function () {
        next[n].example = example.value;
        state.tplDirty = true;
        /* Only the chip is redrawn: the input that is being typed keeps its focus. */
        paintChip(chip, n, next[n].example);
        renderTemplatePreview();
      });
      row.appendChild(example);
      box.appendChild(row);
    });
    box.appendChild(node('p', 'help', tr('Os exemplos vão em example.body_text, como a Meta pede para revisar, e voltam ao ler o template.')));
    renderTemplatePreview();
  }

  /* The chip of a variable: the value when it is filled, the placeholder when it is not. */
  function paintChip(chip, name, example) {
    chip.textContent = '';
    if (example) {
      /* The variable is filled: the chip shows the value, in green and white. */
      chip.classList.add('filled');
      chip.appendChild(document.createTextNode(example));
    } else {
      chip.classList.remove('filled');
      chip.appendChild(document.createTextNode('{{' + name + '}}'));
    }
    var remove = node('button', 'var-x', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', tr('Apagar variável') + ' ' + name);
    remove.setAttribute('title', tr('Apagar variável'));
    remove.addEventListener('click', function () { removeVariable(name); });
    chip.appendChild(remove);
  }

  /* The body with the variables filled: what the patient will read. */
  function renderTemplatePreview() {
    var box = el('tpl-preview');
    if (!box) return;
    renderPhone();
    var body = el('tpl-body').value || '';
    box.textContent = '';
    var names = templatePlaceholders(body);
    if (!names.length) { box.hidden = true; return; }
    box.hidden = false;
    box.appendChild(node('span', 'tpl-preview-head', tr('Prévia')));
    var at = 0;
    while (at < body.length) {
      var open = body.indexOf('{{', at);
      if (open < 0) { box.appendChild(document.createTextNode(body.slice(at))); break; }
      var close = body.indexOf('}}', open + 2);
      if (close < 0) { box.appendChild(document.createTextNode(body.slice(at))); break; }
      box.appendChild(document.createTextNode(body.slice(at, open)));
      var name = body.slice(open + 2, close).trim();
      box.appendChild(previewChip(name, state.tplVars[name]));
      at = close + 2;
    }
  }

  /* The chip of a variable in the body: the value when it is filled. */
  function previewChip(name, variable) {
    var chip = node('span', 'var-fill');
    if (variable && variable.example) {
      chip.appendChild(document.createTextNode(variable.example));
      var remove = node('button', 'var-x', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', tr('Apagar variável') + ' ' + name);
      remove.setAttribute('title', tr('Apagar variável'));
      remove.addEventListener('click', function () { removeVariable(name); });
      chip.appendChild(remove);
    } else {
      chip.classList.add('empty');
      chip.appendChild(document.createTextNode('{{' + name + '}}'));
    }
    return chip;
  }

  /* Delete a variable: it leaves the body and it leaves the row. */
  function removeVariable(name) {
    var body = el('tpl-body').value || '';
    el('tpl-body').value = body.split('{{' + name + '}}').join('');
    delete state.tplVars[name];
    state.tplDirty = true;
    renderTemplateVars();
  }

  function cloneVars(variables) {
    var out = {};
    Object.keys(variables || {}).forEach(function (n) {
      out[n] = { example: variables[n].example || '' };
    });
    return out;
  }

  /* A template as the Cloud API lists it, with the examples of its body read
     back into variables ({{1}}: Mariana) for the form. */
  function fromGraph(t) {
    var variables = {};
    (t.components || []).forEach(function (c) {
      if (c.type !== 'BODY' || !c.example) return;
      ((c.example.body_text || [])[0] || []).forEach(function (value, i) {
        variables[String(i + 1)] = { example: String(value) };
      });
      (c.example.body_text_named_params || []).forEach(function (p) {
        variables[p.param_name] = { example: String(p.example) };
      });
    });
    return {
      id: t.id,
      name: t.name,
      language: t.language,
      category: t.category,
      status: t.status,
      reason: t.rejected_reason || '',
      components: t.components || [],
      variables: variables
    };
  }
  var STATUS_LABEL = {
    APPROVED: 'Aprovado', PENDING: 'Em análise', REJECTED: 'Rejeitado', PAUSED: 'Pausado', DISABLED: 'Desativado'
  };

  function reviewLabel(event) {
    var options = reviewOptions();
    for (var i = 0; i < options.length; i++) if (options[i].value === event) return options[i].label;
    return event;
  }

  function templateHint(editing, review) {
    if (review !== 'APPROVED') {
      return tr('Revisão "') + reviewLabel(review) + tr('": o envio deste template falha e o webhook avisa a aplicação com o motivo.');
    }
    return editing
      ? tr('O nome e o idioma identificam o template: depois de criado, não mudam. O cabeçalho, o rodapé e os botões são preservados.')
      : tr('O nome e o idioma identificam o template. O mock grava o arquivo em templates/ e o watcher o carrega na hora.');
  }

  /* ---------- the template builder: header, footer, buttons, carousel ---------- */
  var BUTTON_LIMITS = { QUICK_REPLY: 10, URL: 2, PHONE_NUMBER: 1, COPY_CODE: 1, OTP: 1 };
  var BUTTON_TEXT = { QUICK_REPLY: 'Resposta rápida', URL: 'Link', PHONE_NUMBER: 'Telefone', COPY_CODE: 'Copiar código', OTP: 'Código de acesso' };
  /*
   * extra: the components the builder has no editor for (a limited-time
   * offer), kept as they came; bodyKeep and footerKeep: the fields Meta adds
   * to an authentication body and footer. A save sends them back unchanged.
   */
  function defaultParts() {
    return { header: 'NONE', headerText: '', headerExample: '', headerSample: null, footer: '', buttons: [], carousel: false, cards: [], extra: [], bodyKeep: {}, footerKeep: {} };
  }
  function keepOf(component, known) {
    var kept = {};
    Object.keys(component).forEach(function (k) { if (known.indexOf(k) < 0) kept[k] = component[k]; });
    return kept;
  }
  function newCard() { return { format: 'IMAGE', sample: null, body: '', buttons: [{ type: 'QUICK_REPLY', text: '' }] }; }
  function sampleOf(component) {
    var handle = component && component.example && component.example.header_handle && component.example.header_handle[0];
    return handle ? { src: String(handle), name: String(handle).split('/').pop() } : null;
  }
  function buttonOf(b) {
    var example = Array.isArray(b.example) ? b.example[0] : b.example;
    return { type: String(b.type || '').toUpperCase(), text: b.text || '', url: b.url || '', phone_number: b.phone_number || '', example: example || '', otp_type: b.otp_type || '' };
  }
  /* What a template of the library says, as the builder edits it. */
  function partsOf(tpl) {
    var parts = defaultParts();
    (tpl.components || []).forEach(function (c) {
      var type = String(c.type).toUpperCase();
      if (type === 'HEADER') {
        parts.header = String(c.format || 'TEXT').toUpperCase();
        parts.headerText = c.text || '';
        parts.headerExample = (c.example && c.example.header_text && c.example.header_text[0]) || '';
        parts.headerSample = sampleOf(c);
      } else if (type === 'BODY') {
        parts.bodyKeep = keepOf(c, ['type', 'text', 'example']);
      } else if (type === 'FOOTER') {
        parts.footer = c.text || '';
        parts.footerKeep = keepOf(c, ['type', 'text']);
      } else if (type === 'BUTTONS') {
        parts.buttons = (c.buttons || []).map(buttonOf);
      } else if (type === 'CAROUSEL') {
        parts.carousel = true;
        parts.cards = (c.cards || []).map(function (card) {
          var out = newCard();
          out.buttons = [];
          (card.components || []).forEach(function (cc) {
            var t = String(cc.type).toUpperCase();
            if (t === 'HEADER') { out.format = String(cc.format || 'IMAGE').toUpperCase(); out.sample = sampleOf(cc); }
            if (t === 'BODY') out.body = cc.text || '';
            if (t === 'BUTTONS') out.buttons = (cc.buttons || []).map(buttonOf);
          });
          return out;
        });
      } else {
        parts.extra.push(c);
      }
    });
    return parts;
  }
  /* A button as Meta asks for it at creation. */
  function buttonComponent(b) {
    var out = { type: b.type, text: b.type === 'COPY_CODE' ? undefined : b.text };
    if (b.type === 'URL') {
      out.url = b.url;
      if (b.url.indexOf('{{1}}') >= 0) out.example = [b.example || b.url.split('{{1}}').join('exemplo')];
    }
    if (b.type === 'PHONE_NUMBER') out.phone_number = b.phone_number;
    if (b.type === 'COPY_CODE') out.example = b.example || 'CODIGO10';
    if (b.type === 'OTP') out.otp_type = b.otp_type || 'COPY_CODE';
    if (out.text === undefined) delete out.text;
    return out;
  }
  function mediaHeader(format, sample) {
    var header = { type: 'HEADER', format: format };
    if (sample) header.example = { header_handle: [sample.src] };
    return header;
  }
  /* The components the create or edit call carries, in Meta's order. */
  function partsComponents(parts, body, variables) {
    var components = [];
    if (parts.header === 'TEXT') {
      var header = { type: 'HEADER', format: 'TEXT', text: parts.headerText };
      if (parts.headerText.indexOf('{{') >= 0) header.example = { header_text: [parts.headerExample || 'exemplo'] };
      components.push(header);
    } else if (parts.header !== 'NONE') {
      components.push(mediaHeader(parts.header, parts.header === 'LOCATION' ? null : parts.headerSample));
    }
    parts.extra.forEach(function (c) { components.push(c); });
    var names = templatePlaceholders(body);
    var bodyComponent = Object.assign({ type: 'BODY', text: body }, parts.bodyKeep);
    var exampleOf = function (n) { return (variables[n] && variables[n].example) || ''; };
    if (names.length && isPositional(names)) {
      bodyComponent.example = { body_text: [names.map(exampleOf)] };
    } else if (names.length) {
      bodyComponent.example = { body_text_named_params: names.map(function (n) { return { param_name: n, example: exampleOf(n) }; }) };
    }
    components.push(bodyComponent);
    if (parts.footer.trim()) components.push(Object.assign({ type: 'FOOTER', text: parts.footer.trim() }, parts.footerKeep));
    if (parts.buttons.length) components.push({ type: 'BUTTONS', buttons: parts.buttons.map(buttonComponent) });
    if (parts.carousel && parts.cards.length) {
      components.push({
        type: 'CAROUSEL',
        cards: parts.cards.map(function (card) {
          var cc = [mediaHeader(card.format, card.sample), { type: 'BODY', text: card.body }];
          if (card.buttons.length) cc.push({ type: 'BUTTONS', buttons: card.buttons.map(buttonComponent) });
          return { components: cc };
        })
      });
    }
    return components;
  }
  /* What is wrong with the parts before Meta would say it. */
  function partsProblem(parts) {
    if (parts.header === 'TEXT' && !parts.headerText.trim()) return tr('O cabeçalho de texto precisa de um texto.');
    var counts = {};
    var problem = null;
    parts.buttons.forEach(function (b) {
      counts[b.type] = (counts[b.type] || 0) + 1;
      if (b.type !== 'COPY_CODE' && !b.text.trim()) problem = tr('Todo botão precisa de um texto.');
      if (b.type === 'URL' && !/^https?:[/][/]/.test(b.url)) problem = tr('O link do botão precisa começar com http:// ou https://.');
      if (b.type === 'PHONE_NUMBER' && !/^[+]?[0-9]{8,15}$/.test(b.phone_number.split(' ').join(''))) problem = tr('O telefone do botão precisa de DDI e DDD, só números.');
    });
    if (problem) return problem;
    if (parts.carousel) {
      if (parts.cards.length < 2) return tr('O carrossel precisa de pelo menos 2 cartões.');
      for (var i = 0; i < parts.cards.length; i++) {
        if (!parts.cards[i].body.trim()) return tr('Todo cartão precisa de um texto.');
      }
    }
    return null;
  }

  function paintChips(box, attr, value) {
    box.querySelectorAll('button[data-' + attr + ']').forEach(function (b) {
      b.setAttribute('aria-checked', b.getAttribute('data-' + attr) === value ? 'true' : 'false');
    });
  }
  /* One button of the builder: its kind, its text, what is behind it. */
  function buttonRow(b, list, index, redraw) {
    var row = node('div', 'tpl-btn-row');
    row.appendChild(icon(BUTTON_ICON[b.type] || ''));
    function input(value, placeholder, onInput, cls) {
      var i = node('input', cls || null);
      i.value = value;
      i.placeholder = tr(placeholder);
      i.addEventListener('input', function () { onInput(i.value); state.tplDirty = true; renderPhone(); });
      return i;
    }
    if (b.type === 'COPY_CODE') {
      row.appendChild(input(b.example, 'Código de exemplo: CODIGO10', function (v) { b.example = v; }, 'solo'));
    } else {
      row.appendChild(input(b.text, BUTTON_TEXT[b.type] + ': texto do botão', function (v) { b.text = v; }));
      if (b.type === 'URL') row.appendChild(input(b.url, 'https://clinica.com/{{1}}', function (v) { b.url = v; }));
      else if (b.type === 'PHONE_NUMBER') row.appendChild(input(b.phone_number, '+5511999999999', function (v) { b.phone_number = v; }));
      else row.appendChild(node('span'));
    }
    var x = node('button', 'icon-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', tr('Tirar o botão'));
    x.addEventListener('click', function () { list.splice(index, 1); state.tplDirty = true; redraw(); });
    row.appendChild(x);
    return row;
  }
  function renderButtonsEditor() {
    var box = el('tpl-buttons');
    box.textContent = '';
    var buttons = state.parts.buttons;
    buttons.forEach(function (b, i) { box.appendChild(buttonRow(b, buttons, i, renderParts)); });
    var counts = {};
    buttons.forEach(function (b) { counts[b.type] = (counts[b.type] || 0) + 1; });
    el('tpl-add-button').querySelectorAll('button[data-add]').forEach(function (add) {
      var type = add.getAttribute('data-add');
      add.disabled = buttons.length >= 10 || (counts[type] || 0) >= BUTTON_LIMITS[type] || state.parts.carousel;
    });
  }
  /* The sample of a media header: uploaded to the mock, its address is the handle. */
  function uploadSample(file) {
    var business = state.business || (state.messages[0] && state.messages[0].businessId) || PHONE;
    return uploadMedia(business, file).then(function (id) { return { src: '/settings/media/' + id, name: file.name }; });
  }
  function renderCardsEditor() {
    var box = el('tpl-cards');
    box.textContent = '';
    state.parts.cards.forEach(function (card, index) {
      var c = node('div', 'tpl-card');
      var head = node('div', 'tpl-card-head');
      head.appendChild(node('span', null, tr('Cartão') + ' ' + (index + 1)));
      var x = node('button', 'icon-x', '×');
      x.type = 'button';
      x.setAttribute('aria-label', tr('Tirar o cartão'));
      x.addEventListener('click', function () { state.parts.cards.splice(index, 1); state.tplDirty = true; renderParts(); });
      head.appendChild(x);
      c.appendChild(head);
      var formats = node('div', 'chips');
      ['IMAGE', 'VIDEO'].forEach(function (f) {
        var b = node('button', null, tr(f === 'IMAGE' ? 'Imagem' : 'Vídeo'));
        b.type = 'button';
        b.setAttribute('data-card-format', f);
        b.addEventListener('click', function () { card.format = f; card.sample = null; state.tplDirty = true; renderParts(); });
        formats.appendChild(b);
      });
      paintChips(formats, 'card-format', card.format);
      c.appendChild(formats);
      var pick = node('button', 'btn ghost small', card.sample ? card.sample.name : tr('Escolher arquivo de exemplo'));
      pick.type = 'button';
      var file = document.createElement('input');
      file.type = 'file';
      file.hidden = true;
      file.accept = card.format === 'IMAGE' ? 'image/jpeg,image/png' : 'video/mp4,video/3gpp';
      pick.addEventListener('click', function () { file.click(); });
      file.addEventListener('change', function () {
        if (!file.files || !file.files[0]) return;
        uploadSample(file.files[0]).then(function (sample) { card.sample = sample; state.tplDirty = true; renderParts(); })
          .catch(function (e) { toast(e.message, true); });
      });
      c.appendChild(pick);
      c.appendChild(file);
      var body = document.createElement('textarea');
      body.rows = 2;
      body.value = card.body;
      body.placeholder = tr('Texto do cartão');
      body.addEventListener('input', function () { card.body = body.value; state.tplDirty = true; renderPhone(); });
      c.appendChild(body);
      card.buttons.forEach(function (b, i) {
        c.appendChild(buttonRow(b, card.buttons, i, renderParts));
      });
      if (card.buttons.length < 2) {
        var adds = node('div', 'chips add');
        ['QUICK_REPLY', 'URL'].forEach(function (type) {
          var a = node('button', null, tr('+ ' + BUTTON_TEXT[type]));
          a.type = 'button';
          a.addEventListener('click', function () { card.buttons.push({ type: type, text: '', url: '', phone_number: '', example: '' }); state.tplDirty = true; renderParts(); });
          adds.appendChild(a);
        });
        c.appendChild(adds);
      }
      box.appendChild(c);
    });
  }
  function renderParts() {
    var p = state.parts;
    paintChips(el('tpl-header-format'), 'format', p.header);
    el('tpl-header-text-row').hidden = p.header !== 'TEXT';
    el('tpl-header-text').value = p.headerText;
    el('tpl-header-example').hidden = p.headerText.indexOf('{{') < 0;
    el('tpl-header-example').value = p.headerExample;
    var media = p.header === 'IMAGE' || p.header === 'VIDEO' || p.header === 'DOCUMENT';
    el('tpl-header-media-row').hidden = !media;
    el('tpl-header-sample').textContent = p.headerSample ? p.headerSample.name : tr('sem exemplo');
    el('tpl-header-file').accept = p.header === 'IMAGE' ? 'image/jpeg,image/png' : p.header === 'VIDEO' ? 'video/mp4,video/3gpp' : 'application/pdf,text/plain';
    var hint = el('tpl-header-hint');
    hint.hidden = !(media || p.header === 'LOCATION');
    hint.textContent = p.header === 'LOCATION'
      ? tr('A localização vai em cada envio, no parâmetro location do cabeçalho.')
      : tr('O arquivo é só o exemplo da revisão: cada envio manda a sua mídia no parâmetro do cabeçalho, senão a Cloud API recusa com 132012.');
    el('tpl-footer').value = p.footer;
    el('tpl-carousel').checked = p.carousel;
    el('tpl-cards').hidden = !p.carousel;
    el('tpl-add-card').hidden = !p.carousel || p.cards.length >= 10;
    renderButtonsEditor();
    renderCardsEditor();
    renderPhone();
  }

  /* The template as the phone will show it, with the examples filled in. */
  function fillExamples(text, variables) {
    return (text || '').replace(/[{][{]([^}]+)[}][}]/g, function (all, name) {
      var v = variables[name.trim()];
      return v && v.example ? v.example : all;
    });
  }
  function previewButtons(buttons) {
    return buttons.map(function (b) {
      var detail = b.type === 'URL' ? (b.url.indexOf('{{1}}') >= 0 ? b.example || b.url.split('{{1}}').join('exemplo') : b.url)
        : b.type === 'PHONE_NUMBER' ? b.phone_number
        : b.type === 'COPY_CODE' ? (b.example || 'CODIGO10')
        : b.type === 'OTP' ? fillExamples('{{1}}', state.tplVars || {})
        : null;
      return { type: b.type, text: b.type === 'COPY_CODE' ? tr('Copiar código') : (b.text || tr(BUTTON_TEXT[b.type] || b.type)), detail: detail };
    });
  }
  function previewHeader(format, text, sample) {
    if (format === 'NONE') return null;
    if (format === 'TEXT') return { format: 'TEXT', text: text, media: null, location: null };
    if (format === 'LOCATION') return { format: 'LOCATION', text: null, media: null, location: null };
    return { format: format, text: null, location: null, media: { kind: format.toLowerCase(), src: sample ? sample.src : null, filename: sample ? sample.name : null, mimeType: null } };
  }
  /* The offer line of a LIMITED_TIME_OFFER the template carries; it ends three days out in the preview. */
  function previewOffer(parts) {
    for (var i = 0; i < parts.extra.length; i++) {
      var offer = parts.extra[i].limited_time_offer;
      if (String(parts.extra[i].type).toUpperCase() === 'LIMITED_TIME_OFFER' && offer && offer.text) {
        return { text: offer.text, expiresAt: offer.has_expiration ? Date.now() + 3 * 86400000 : null };
      }
    }
    return null;
  }

  /* ---------- the phone: the template as the patient's WhatsApp draws it ---------- */
  var PHONE_THEME_KEY = 'whap.phoneTheme';
  var PH = {
    back: '<path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z" fill="currentColor"/>',
    video: '<path d="M16 10.2V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-3.2l5 4V6.2z" fill="currentColor"/>',
    more: '<circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/>',
    verified: '<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7.6 12.3l2.9 2.9 5.9-6.1" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    lock: '<path d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V7a3 3 0 0 0-6 0z" fill="currentColor"/>',
    emoji: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="10" r="1.2" fill="currentColor"/><circle cx="15" cy="10" r="1.2" fill="currentColor"/><path d="M8 14.5c1 1.6 2.4 2.4 4 2.4s3-.8 4-2.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    clip: '<path d="M16.5 6.5l-8 8a2 2 0 0 0 2.8 2.8l8.2-8.2a4 4 0 0 0-5.7-5.7L5.6 11.6a6 6 0 0 0 8.5 8.5l6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    camera: '<path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13.5" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
    gift: '<path d="M4 11h16v10H4zM3 7h18v4H3zM12 7v14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 7C10.5 4 7 3.5 7 5.8 7 7 9 7 12 7zm0 0c1.5-3 5-3.5 5-1.2C17 7 15 7 12 7z" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    list: '<path d="M4 6h2M4 12h2M4 18h2M9 6h11M9 12h11M9 18h11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
  };
  function svgBox(viewBox, paths, cls) { return svg('<svg viewBox="' + viewBox + '" aria-hidden="true">' + paths + '</svg>', cls); }
  var PH_PIN = '<path d="M12 1C6.5 1 2.5 5 2.5 10.2 2.5 17 12 29 12 29s9.5-12 9.5-18.8C21.5 5 17.5 1 12 1z" fill="currentColor"/><circle cx="12" cy="10.5" r="3.6" fill="#fff"/>';
  var PH_PDF = '<path d="M3 1h13l7 7v21a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" fill="#e1554a"/><path d="M16 1v7h7" fill="#f3a29b"/><text x="12.5" y="24" font-size="7.5" font-weight="700" fill="#fff" text-anchor="middle" font-family="Arial, sans-serif">PDF</text>';
  var PH_TICKS = '<path d="M1 6l3 3L10 2M6.5 8.5l.8.8L14 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
  var PH_SIGNAL = '<g fill="currentColor"><rect x="0" y="7" width="3" height="4" rx="1"/><rect x="4.5" y="5" width="3" height="6" rx="1"/><rect x="9" y="2.5" width="3" height="8.5" rx="1"/><rect x="13.5" y="0" width="3" height="11" rx="1"/></g>';
  var PH_BATTERY = '<rect x="0.5" y="0.5" width="21" height="10" rx="3" fill="none" stroke="currentColor" opacity=".45"/><rect x="2" y="2" width="15" height="7" rx="1.6" fill="currentColor"/><rect x="22.5" y="3.5" width="1.6" height="4" rx=".8" fill="currentColor" opacity=".45"/>';

  /*
   * WhatsApp's formatting: *bold*, _italic_, ~strike~, three backticks for
   * monospace, and links. The earliest mark wins; what is inside a mark is
   * read again, so *_both_* works as on the phone.
   */
  var NL = String.fromCharCode(10);
  var TICK = String.fromCharCode(96);
  var RICH = [
    { tag: 'code', re: new RegExp(TICK + TICK + TICK + '([^' + TICK + ']+)' + TICK + TICK + TICK) },
    { tag: 'a', re: new RegExp('https?://[^ ' + NL + ']+') },
    { tag: 'b', re: new RegExp('[*]([^*' + NL + ']+)[*]') },
    { tag: 'i', re: new RegExp('_([^_' + NL + ']+)_') },
    { tag: 's', re: new RegExp('~([^~' + NL + ']+)~') }
  ];
  function rich(text, into) {
    var rest = text || '';
    while (rest) {
      var best = null;
      for (var i = 0; i < RICH.length; i++) {
        var m = RICH[i].re.exec(rest);
        if (m && (!best || m.index < best.m.index)) best = { tag: RICH[i].tag, m: m };
      }
      if (!best) { into.appendChild(document.createTextNode(rest)); break; }
      if (best.m.index) into.appendChild(document.createTextNode(rest.slice(0, best.m.index)));
      if (best.tag === 'a') {
        var a = node('a', null, best.m[0]);
        a.href = best.m[0];
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        into.appendChild(a);
      } else if (best.tag === 'code') {
        into.appendChild(node('code', null, best.m[1]));
      } else {
        rich(best.m[1], into.appendChild(document.createElement(best.tag)));
      }
      rest = rest.slice(best.m.index + best.m[0].length);
    }
    return into;
  }

  function phoneTheme() {
    try {
      var saved = localStorage.getItem(PHONE_THEME_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (e) { /* private window */ }
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function setPhoneTheme(theme) {
    try { localStorage.setItem(PHONE_THEME_KEY, theme); } catch (e) { /* private window */ }
    renderPhone();
  }
  function phoneToast(phone, text) {
    var t = phone.querySelector('.ph-toast');
    if (!t) return;
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(state.phoneToastTimer);
    /* A toast the person reads, then it goes: the delay is the reading time. */
    state.phoneToastTimer = setTimeout(function () { t.classList.remove('on'); }, 2400);
  }
  /* A tap on a button, as the phone answers it: a quick reply goes back to the business. */
  function tapButton(phone, b, quote) {
    if (b.type === 'QUICK_REPLY') {
      state.phoneTaps.push({ text: b.text, quote: quote });
      renderPhone(true);
      return;
    }
    if (b.type === 'URL') { phoneToast(phone, tr('Abre') + ' ' + (b.detail || '')); return; }
    if (b.type === 'PHONE_NUMBER') { phoneToast(phone, tr('Liga para') + ' ' + (b.detail || '')); return; }
    if (b.type === 'COPY_CODE' || b.type === 'OTP') {
      try {
        var copied = navigator.clipboard && navigator.clipboard.writeText(b.detail || '');
        if (copied && copied.catch) copied.catch(function () { /* no permission: the toast still shows the code */ });
      } catch (e) { /* no clipboard */ }
      phoneToast(phone, tr('Código copiado:') + ' ' + (b.detail || ''));
      return;
    }
    phoneToast(phone, b.text);
  }
  function phoneButton(phone, b, quote) {
    var btn = node('button', 'ph-btn');
    btn.type = 'button';
    btn.appendChild(icon(BUTTON_ICON[b.type === 'OTP' ? 'COPY_CODE' : b.type] || BUTTON_ICON.QUICK_REPLY));
    btn.appendChild(node('span', null, b.text));
    if (b.detail) btn.setAttribute('title', b.detail);
    btn.addEventListener('click', function () { phone.classList.remove('sheet-open'); tapButton(phone, b, quote); });
    return btn;
  }
  /* Up to three buttons hang under the bubble; with more, two and "see all options". */
  function phoneButtons(phone, buttons, quote) {
    var box = node('div', 'ph-btns');
    var shown = buttons.length > 3 ? buttons.slice(0, 2) : buttons;
    shown.forEach(function (b) { box.appendChild(phoneButton(phone, b, quote)); });
    if (buttons.length > 3) {
      var all = node('button', 'ph-btn');
      all.type = 'button';
      all.appendChild(icon(PH.list));
      all.appendChild(node('span', null, tr('Ver todas as opções')));
      all.addEventListener('click', function () {
        var list = phone.querySelector('.ph-sheet-list');
        list.textContent = '';
        buttons.forEach(function (b) { list.appendChild(phoneButton(phone, b, quote)); });
        phone.classList.add('sheet-open');
        var first = list.querySelector('button');
        if (first) first.focus({ preventScroll: true });
      });
      box.appendChild(all);
    }
    return box;
  }
  function phoneDocument(media) {
    var doc = node(media.src ? 'a' : 'div', 'ph-doc');
    if (media.src) { doc.href = media.src; doc.target = '_blank'; doc.rel = 'noopener noreferrer'; }
    var page = node('div', 'ph-doc-page');
    var sheet = node('div', 'ph-doc-sheet');
    for (var i = 0; i < 7; i++) sheet.appendChild(document.createElement('i'));
    page.appendChild(sheet);
    doc.appendChild(page);
    var strip = node('div', 'ph-doc-strip');
    strip.appendChild(svgBox('0 0 26 30', PH_PDF));
    var text = node('span', 'ph-doc-text');
    var name = media.filename || tr('documento.pdf');
    text.appendChild(node('b', null, name));
    text.appendChild(node('small', null, media.src ? (name.split('.').pop() || 'pdf').toUpperCase() + ', ' + tr('toque para abrir') : tr('O arquivo vem em cada envio')));
    strip.appendChild(text);
    doc.appendChild(strip);
    return doc;
  }
  function phoneMedia(media) {
    if (media.kind === 'document') return phoneDocument(media);
    var box = node('div', 'ph-media');
    if (!media.src) {
      var empty = node('div', 'ph-media-empty');
      empty.appendChild(icon(media.kind === 'video' ? PH.video : MEDIA_ICON));
      empty.appendChild(node('span', null, tr(media.kind === 'video' ? 'O vídeo vem em cada envio' : 'A imagem vem em cada envio')));
      box.appendChild(empty);
      return box;
    }
    if (media.kind !== 'video') {
      var img = document.createElement('img');
      img.src = media.src;
      img.alt = media.filename || '';
      box.appendChild(img);
      return box;
    }
    var video = document.createElement('video');
    video.src = media.src;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'metadata';
    box.appendChild(video);
    var play = node('button', 'ph-play');
    play.type = 'button';
    play.setAttribute('aria-label', tr('Tocar o vídeo'));
    play.appendChild(icon(PH.play));
    var duration = node('span', 'ph-duration');
    duration.appendChild(icon(PH.video));
    var length = node('span', null, '0:00');
    duration.appendChild(length);
    video.addEventListener('loadedmetadata', function () {
      var s = Math.round(video.duration || 0);
      length.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    });
    var toggle = function () {
      if (video.paused) {
        var playing = video.play();
        if (playing && playing.catch) playing.catch(function () { box.classList.remove('playing'); });
        box.classList.add('playing');
      } else {
        video.pause();
        box.classList.remove('playing');
      }
    };
    play.addEventListener('click', toggle);
    video.addEventListener('click', toggle);
    box.appendChild(play);
    box.appendChild(duration);
    return box;
  }
  function phoneOffer(offer) {
    var box = node('div', 'ph-offer');
    box.appendChild(icon(PH.gift));
    var text = node('span');
    text.appendChild(node('b', null, offer.text));
    if (offer.expiresAt) {
      var end = new Date(offer.expiresAt).toLocaleString(state.lang === 'en' ? 'en-US' : 'pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      text.appendChild(node('small', null, tr('A oferta termina em') + ' ' + end));
    }
    box.appendChild(text);
    return box;
  }
  /* The bubble of the template: header, offer, body, footer and the buttons under them. */
  function phoneBubble(phone, view, clock) {
    var row = node('div', 'ph-row in');
    var bubble = node('div', 'ph-bubble');
    var h = view.header;
    if (h && h.format === 'LOCATION') {
      var map = node('div', 'ph-map');
      map.appendChild(svgBox('0 0 24 30', PH_PIN, 'ph-pin'));
      bubble.appendChild(map);
    } else if (h && h.media) {
      bubble.appendChild(phoneMedia(h.media));
    }
    if (view.offer) bubble.appendChild(phoneOffer(view.offer));
    var content = node('div', 'ph-content');
    if (h && h.format === 'LOCATION' && h.location && (h.location.name || h.location.address)) {
      var place = node('span', 'ph-place');
      place.appendChild(node('b', null, h.location.name || ''));
      place.appendChild(document.createTextNode(h.location.address || ''));
      content.appendChild(place);
    }
    if (h && h.format === 'TEXT' && h.text) content.appendChild(rich(h.text, node('span', 'ph-title')));
    rich(view.body, content);
    /* The time sits on the last line, the footer's when there is one. */
    var last = view.footer ? content.appendChild(node('span', 'ph-foot', view.footer)) : content;
    last.appendChild(node('span', 'ph-time', clock));
    bubble.appendChild(content);
    var quote = (view.body || '').split(NL)[0].slice(0, 90);
    if (view.buttons.length) bubble.appendChild(phoneButtons(phone, view.buttons, quote));
    row.appendChild(bubble);
    if (view.cards.length) {
      var strip = node('div', 'ph-cards');
      var dots = node('div', 'ph-dots');
      view.cards.forEach(function (card, index) {
        var c = node('div', 'ph-card');
        if (card.header && card.header.media) c.appendChild(phoneMedia(card.header.media));
        c.appendChild(rich(card.body, node('div', 'ph-content')));
        if (card.buttons.length) c.appendChild(phoneButtons(phone, card.buttons, card.body.split(NL)[0].slice(0, 90)));
        strip.appendChild(c);
        dots.appendChild(node('i', index === 0 ? 'on' : null));
      });
      strip.addEventListener('scroll', function () {
        var at = Math.round(strip.scrollLeft / 240);
        Array.prototype.forEach.call(dots.children, function (d, k) { d.className = k === at ? 'on' : ''; });
      }, { passive: true });
      row.appendChild(strip);
      row.appendChild(dots);
    }
    return row;
  }
  /* What the patient sent back by tapping a quick reply: it quotes the template. */
  function phoneReply(tap, business, clock) {
    var row = node('div', 'ph-row out');
    var bubble = node('div', 'ph-bubble');
    var quote = node('span', 'ph-quote');
    quote.appendChild(node('b', null, business));
    quote.appendChild(document.createTextNode(tap.quote));
    bubble.appendChild(quote);
    var content = node('div', 'ph-content', tap.text);
    var stamp = node('span', 'ph-time', clock);
    stamp.appendChild(svgBox('0 0 16 11', PH_TICKS));
    content.appendChild(stamp);
    bubble.appendChild(content);
    row.appendChild(bubble);
    return row;
  }
  /* The phone around the chat: status bar, the business at the top, the box to type at the bottom. */
  function phoneFrame(phone, business, clock) {
    phone.textContent = '';
    var screen = node('div', 'ph-screen');
    var status = node('div', 'ph-status');
    status.appendChild(node('span', null, clock));
    status.appendChild(node('span', 'ph-island'));
    var bars = node('span', 'ph-status-icons');
    bars.appendChild(svgBox('0 0 17 11', PH_SIGNAL));
    bars.appendChild(svgBox('0 0 25 11', PH_BATTERY));
    status.appendChild(bars);
    screen.appendChild(status);
    var head = node('div', 'ph-head');
    head.appendChild(svg('<svg viewBox="0 0 24 24" aria-hidden="true">' + PH.back + '</svg>', 'ph-back'));
    var words = business.split(' ').filter(Boolean);
    head.appendChild(node('span', 'ph-avatar', ((words[0] || '?').charAt(0) + (words[1] ? words[1].charAt(0) : '')).toUpperCase()));
    var who = node('span', 'ph-who');
    var name = node('b');
    name.appendChild(node('span', null, business));
    name.appendChild(icon(PH.verified));
    who.appendChild(name);
    who.appendChild(node('small', null, tr('Conta comercial')));
    head.appendChild(who);
    var actions = node('span', 'ph-head-actions');
    actions.appendChild(icon(PH.video));
    actions.appendChild(icon(BUTTON_ICON.PHONE_NUMBER));
    actions.appendChild(icon(PH.more));
    head.appendChild(actions);
    screen.appendChild(head);
    var chat = node('div', 'ph-chat');
    chat.appendChild(node('span', 'ph-day', tr('Hoje')));
    var notice = node('div', 'ph-notice');
    notice.appendChild(icon(PH.lock));
    notice.appendChild(node('span', null, tr('Esta empresa usa um serviço seguro da Meta para gerenciar esta conversa.')));
    chat.appendChild(notice);
    screen.appendChild(chat);
    var compose = node('div', 'ph-compose');
    var input = node('span', 'ph-input');
    input.appendChild(icon(PH.emoji));
    input.appendChild(node('span', null, tr('Mensagem')));
    input.appendChild(icon(PH.clip));
    input.appendChild(icon(PH.camera));
    compose.appendChild(input);
    var mic = node('span', 'ph-mic');
    mic.appendChild(icon(PH.mic));
    compose.appendChild(mic);
    screen.appendChild(compose);
    var scrim = node('div', 'ph-scrim');
    scrim.addEventListener('click', function () { phone.classList.remove('sheet-open'); });
    screen.appendChild(scrim);
    var sheet = node('div', 'ph-sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', tr('Todas as opções'));
    sheet.appendChild(node('div', 'ph-grip'));
    var title = node('div', 'ph-sheet-title');
    title.appendChild(node('span', null, tr('Todas as opções')));
    var close = node('button', null, '×');
    close.type = 'button';
    close.setAttribute('aria-label', tr('Fechar'));
    close.addEventListener('click', function () { phone.classList.remove('sheet-open'); });
    title.appendChild(close);
    sheet.appendChild(title);
    sheet.appendChild(node('div', 'ph-sheet-list'));
    screen.appendChild(sheet);
    screen.appendChild(node('div', 'ph-toast'));
    phone.appendChild(screen);
    return chat;
  }
  /*
   * Draw the phone again. Typing redraws it on every key, so the chat keeps
   * its scroll and the carousel its card; a new reply scrolls to the end.
   */
  function renderPhone(toEnd) {
    var phone = el('tpl-phone');
    if (!phone || !state.parts) return;
    var theme = phoneTheme();
    phone.setAttribute('data-theme', theme);
    phone.classList.remove('sheet-open');
    el('tpl-phone-theme').querySelectorAll('button[data-theme]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-theme') === theme ? 'true' : 'false');
    });
    var before = phone.querySelector('.ph-chat');
    var scroll = before ? before.scrollTop : 0;
    var cardsBefore = phone.querySelector('.ph-cards');
    var cardScroll = cardsBefore ? cardsBefore.scrollLeft : 0;
    var clock = time(new Date().toISOString());
    var business = state.verifiedName || tr('Sua empresa');
    var chat = phoneFrame(phone, business, clock);
    var p = state.parts;
    var body = fillExamples(el('tpl-body').value, state.tplVars || {});
    if (!body.trim() && p.header === 'NONE' && !p.buttons.length) {
      chat.appendChild(node('div', 'ph-empty', tr('Escreva o corpo para ver a mensagem.')));
      return;
    }
    var view = {
      header: previewHeader(p.header, (p.headerText || '').split('{{1}}').join(p.headerExample || '{{1}}'), p.headerSample),
      offer: previewOffer(p),
      body: body,
      footer: p.footer.trim() || null,
      buttons: previewButtons(p.buttons),
      cards: p.carousel ? p.cards.map(function (card) {
        return { header: previewHeader(card.format, null, card.sample), body: card.body, buttons: previewButtons(card.buttons) };
      }) : []
    };
    chat.appendChild(phoneBubble(phone, view, clock));
    state.phoneTaps.forEach(function (tap) { chat.appendChild(phoneReply(tap, business, clock)); });
    var cards = phone.querySelector('.ph-cards');
    if (cards) cards.scrollLeft = cardScroll;
    chat.scrollTop = toEnd ? chat.scrollHeight : scroll;
  }

  function renderTemplateForm(force) {
    var tpl = selectedTemplate();
    var editing = !!tpl;
    var key = editing ? templateKey(tpl) : 'new';
    /* A message arriving redraws the panel: never wipe what is being typed. */
    if (!force && state.tplFormKey === key && state.tplDirty) return;
    /* The verdict is what the next review gives: a saved template goes back
       to the review, and the simulation starts from approved. */
    var review = 'APPROVED';
    el('tpl-title').textContent = editing ? tpl.name : tr('Novo template');
    var badge = el('tpl-status');
    badge.hidden = !editing;
    if (editing) {
      badge.setAttribute('data-status', tpl.status);
      badge.textContent = tr(STATUS_LABEL[tpl.status] || tpl.status) + (tpl.reason && tpl.reason !== 'NONE' ? ' · ' + tpl.reason : '');
    }
    el('tpl-id').hidden = !editing;
    el('tpl-id').textContent = editing ? 'id ' + tpl.id : '';
    el('tpl-name').value = editing ? tpl.name : '';
    el('tpl-name').readOnly = editing;
    selects.language.set(editing ? (tpl.language || 'en') : defaultTemplateLanguage());
    selects.language.setDisabled(editing);
    selects.category.set(editing ? (tpl.category || 'UTILITY') : 'UTILITY');
    el('tpl-body').value = editing ? templateBody(tpl) : '';
    selects.review.set(review);
    selects.review.setTone(review === 'APPROVED' ? '' : 'warn');
    el('tpl-reason').value = '';
    el('tpl-reason-field').hidden = review === 'APPROVED';
    el('tpl-delete').hidden = !editing;
    el('tpl-delete').textContent = tr('Apagar');
    el('tpl-delete').removeAttribute('data-confirm');
    el('tpl-save').textContent = editing ? tr('Salvar mudanças') : tr('Criar template');
    el('tpl-hint').textContent = templateHint(editing, review);
    if (state.tplFormKey !== key) state.phoneTaps = [];
    state.tplFormKey = key;
    state.tplDirty = false;
    state.tplVars = editing ? cloneVars(tpl.variables) : {};
    state.parts = editing ? partsOf(tpl) : defaultParts();
    renderTemplateVars();
    renderParts();
  }

  /* What the form holds, so a change of language does not wipe it. */
  function captureForm() {
    return {
      dirty: state.tplDirty,
      name: el('tpl-name').value,
      body: el('tpl-body').value,
      reason: el('tpl-reason').value,
      vars: cloneVars(state.tplVars),
      parts: JSON.parse(JSON.stringify(state.parts || defaultParts()))
    };
  }
  function restoreForm(snapshot) {
    if (!snapshot) return;
    el('tpl-name').value = snapshot.name;
    el('tpl-body').value = snapshot.body;
    el('tpl-reason').value = snapshot.reason;
    state.tplVars = snapshot.vars;
    state.parts = snapshot.parts;
    state.tplDirty = snapshot.dirty;
    renderTemplateVars();
    renderParts();
  }

  /* The library of the account, as the application reads it. */
  function fetchTemplates() {
    var examples = api('/settings/examples').catch(function () { return { data: [] }; });
    return Promise.all([graph('/' + WABA + '/message_templates?limit=100'), examples]).then(function (both) {
      var marked = {};
      ((both[1] && both[1].data) || []).forEach(function (e) { marked[templateKey(e)] = true; });
      return ((both[0] && both[0].data) || []).map(function (t) {
        var tpl = fromGraph(t);
        tpl.example = !!marked[templateKey(tpl)];
        return tpl;
      });
    });
  }
  function loadTemplates(force) {
    return fetchTemplates().then(function (list) {
      state.templates = list;
      renderTemplates(force);
      renderCounts();
    });
  }

  /* ---------- data ---------- */
  function load() {
    return api('/settings/conversations').then(function (data) {
      state.messages = (data && data.messages) || [];
      render();
    }).catch(function (e) { toast(tr('Não consegui ler as mensagens:') + ' ' + e.message, true); });
  }
  function loadWebhooks() {
    return api('/settings/webhooks').then(function (c) { state.config = c; render(); }).catch(function () {});
  }
  function loadSide() {
    loadWebhooks();
    api('/settings/delivery-mode').then(function (d) { state.mode = d.mode; renderTools(); }).catch(function () {});
    api('/settings/events').then(function (d) { state.events = (d && d.events) || []; renderTools(); }).catch(function () {});
    fetchTemplates().then(function (list) { state.templates = list; renderTools(); }).catch(function () {});
    /* The name the patient's phone shows at the top of the chat. */
    graph('/' + PHONE).then(function (d) { state.verifiedName = (d && d.verified_name) || ''; renderPhone(); }).catch(function () {});
    loadCalls();
    loadAccounts();
    api('/settings/webhook-delay').then(function (d) {
      state.delayMs = d.delayMs;
      el('delay-seconds').value = String(Math.round(d.delayMs / 1000));
      renderTools();
    }).catch(function () {});
    api('/health').then(function () { state.healthy = true; renderTools(); }).catch(function () { state.healthy = false; renderTools(); });
  }
  function render() {
    renderBusinessOptions();
    renderThreads();
    renderChat();
    renderTools();
    el('live-dot').className = 'dot ' + (state.live ? 'on' : 'off');
    el('live-text').textContent = state.live ? tr('ao vivo') : tr('reconectando…');
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
        loadWebhooks();
        renderTools();
      } else if (data.type === 'TEMPLATE_STATUS' && data.payload) {
        // The review gave its verdict: the library changes under the form.
        loadTemplates(false).catch(function () {});
        var p = data.payload;
        if (p.name && p.status && p.status !== 'PENDING') {
          toast(tr('Template') + ' ' + p.name + ': ' + tr(STATUS_LABEL[p.status] || p.status).toLowerCase() + '.');
        }
      } else if (data.type === 'CALL_UPDATE' && data.payload) {
        if (data.payload.kind === 'call' && data.payload.call) onCall(data.payload.call);
      } else if (data.type === 'ACCOUNT_UPDATE' && data.payload) {
        if (data.payload.kind === 'code') {
          toast(tr(data.payload.method === 'VOICE' ? 'Código que a Meta diria na ligação:' : 'Código que a Meta mandaria por SMS:') + ' ' + data.payload.code);
        }
        loadAccounts();
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
  /* The language of the panel, chosen in the header of the chat or of the console. */
  document.querySelectorAll('[data-lang]').forEach(function (b) {
    b.addEventListener('click', function () { setLanguage(b.getAttribute('data-lang')); });
  });
  /* Escape closes the panel and Tab stays inside it: a full-screen overlay that
     lets the focus wander behind it is a trap, in the bad sense of the word. */
  document.addEventListener('keydown', function (e) {
    if (!el('app').classList.contains('with-tools')) return;
    if (e.key === 'Escape') {
      if (el('new-dialog').open) return;
      setTools(false);
      return;
    }
    if (e.key !== 'Tab') return;
    var focusable = Array.prototype.slice.call(
      el('tools').querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter(function (n) { return n.offsetParent !== null; });
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  el('back').addEventListener('click', function () { state.selected = null; el('app').classList.remove('in-chat'); render(); });
  ['delivery', 'webhook', 'events', 'templates', 'numbers', 'api'].forEach(function (n) {
    el('tab-' + n).addEventListener('click', function () { selectTab(n); });
  });
  document.querySelectorAll('.seg button[data-mode]').forEach(function (b) {
    b.addEventListener('click', function () {
      var mode = b.getAttribute('data-mode');
      api('/settings/delivery-mode', { method: 'PUT', body: { mode: mode } }).then(function (d) {
        state.mode = d.mode;
        renderTools();
        toast(tr(mode === 'auto' ? 'Entrega automática: as mensagens viram lidas sozinhas.' : 'Entrega manual: marque cada mensagem no menu dela.'));
      }).catch(function (e) { toast(e.message, true); });
    });
  });
  el('webhook-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var url = el('wh-url').value.trim();
    if (url.indexOf('://') < 0) url = 'http' + '://' + url;
    /* Meta's call: the number's webhook override. The mock checks the address
       with hub.challenge first, unless the knob says to skip it. */
    var configuration = { override_callback_uri: url };
    var token = el('wh-token').value.trim();
    if (token) configuration.verify_token = token;
    var headers = {};
    if (el('wh-skip').checked) headers['X-Mock-Skip-Callback-Verification'] = 'true';
    graph('/' + encodeURIComponent(el('wh-phone').value.trim()), {
      method: 'POST',
      headers: headers,
      body: { webhook_configuration: configuration }
    })
      .then(function () { toast(tr('Webhook salvo.')); el('wh-url').value = ''; loadSide(); })
      .catch(function (err) { toast(err.message, true); });
  });
  /* The response timer: how long the mock waits before delivering an event. */
  el('delay-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var seconds = Number(el('delay-seconds').value);
    if (!isFinite(seconds) || seconds < 0) { toast(tr('O atraso precisa de um número de segundos.'), true); return; }
    api('/settings/webhook-delay', { method: 'PUT', body: { delayMs: Math.round(seconds * 1000) } })
      .then(function (d) {
        state.delayMs = d.delayMs;
        el('delay-seconds').value = String(Math.round(d.delayMs / 1000));
        renderTools();
        toast(tr('Atraso de resposta salvo.'));
      })
      .catch(function (err) { toast(err.message, true); });
  });
  el('tpl-new').addEventListener('click', function () {
    state.tpl = null;
    renderTemplates(true);
    el('tpl-name').focus();
  });
  /* The selects of the template form, rebuilt when the language changes. */
  function rebuildSelects() {
    selects.language = createSelect(el('tpl-language'), languageOptions());
    selects.category = createSelect(el('tpl-category'), categoryOptions());
    selects.review = createSelect(el('tpl-review'), reviewOptions(), function (option) {
      el('tpl-reason-field').hidden = option.value === 'APPROVED';
      selects.review.setTone(option.value === 'APPROVED' ? '' : 'warn');
      el('tpl-hint').textContent = templateHint(false, option.value);
      state.tplDirty = true;
    });
  }
  rebuildSelects();
  el('tpl-body').addEventListener('input', function () {
    state.tplDirty = true;
    renderTemplateVars();
    renderPhone();
  });
  /* The builder's own controls: each change marks the form and redraws the phone. */
  el('tpl-header-format').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-format]');
    if (!b) return;
    var format = b.getAttribute('data-format');
    if (format !== state.parts.header) state.parts.headerSample = null;
    state.parts.header = format;
    state.tplDirty = true;
    renderParts();
  });
  el('tpl-header-text').addEventListener('input', function () {
    state.parts.headerText = el('tpl-header-text').value;
    el('tpl-header-example').hidden = state.parts.headerText.indexOf('{{') < 0;
    state.tplDirty = true;
    renderPhone();
  });
  el('tpl-header-example').addEventListener('input', function () {
    state.parts.headerExample = el('tpl-header-example').value;
    state.tplDirty = true;
    renderPhone();
  });
  el('tpl-header-pick').addEventListener('click', function () { el('tpl-header-file').click(); });
  el('tpl-header-file').addEventListener('change', function () {
    var file = el('tpl-header-file').files && el('tpl-header-file').files[0];
    if (!file) return;
    uploadSample(file).then(function (sample) {
      state.parts.headerSample = sample;
      state.tplDirty = true;
      el('tpl-header-file').value = '';
      renderParts();
    }).catch(function (err) { toast(err.message, true); });
  });
  el('tpl-footer').addEventListener('input', function () {
    state.parts.footer = el('tpl-footer').value;
    state.tplDirty = true;
    renderPhone();
  });
  el('tpl-add-button').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-add]');
    if (!b || b.disabled) return;
    state.parts.buttons.push({ type: b.getAttribute('data-add'), text: '', url: '', phone_number: '', example: '' });
    state.tplDirty = true;
    renderParts();
  });
  /* A carousel is a marketing message of cards: the bubble keeps its text,
     the buttons move into the cards. */
  el('tpl-phone-theme').querySelectorAll('button[data-theme]').forEach(function (b) {
    b.addEventListener('click', function () { setPhoneTheme(b.getAttribute('data-theme')); });
  });
  el('call-btn').addEventListener('click', startCall);
  el('voice').addEventListener('click', startVoice);
  el('voice-cancel').addEventListener('click', function () { stopVoice(false); });
  el('voice-send').addEventListener('click', function () { stopVoice(true); });
  el('tpl-phone').addEventListener('keydown', function (e) {
    if (e.key === 'Escape') el('tpl-phone').classList.remove('sheet-open');
  });
  el('tpl-carousel').addEventListener('change', function () {
    state.parts.carousel = el('tpl-carousel').checked;
    if (state.parts.carousel) {
      if (state.parts.cards.length < 2) state.parts.cards = [newCard(), newCard()];
      state.parts.buttons = [];
      if (state.parts.header !== 'NONE') state.parts.header = 'NONE';
      selects.category.set('MARKETING');
    }
    state.tplDirty = true;
    renderParts();
  });
  el('tpl-add-card').addEventListener('click', function () {
    state.parts.cards.push(newCard());
    state.tplDirty = true;
    renderParts();
  });
  ['tpl-name', 'tpl-reason'].forEach(function (id) {
    el(id).addEventListener('input', function () { state.tplDirty = true; });
  });
  el('tpl-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = el('tpl-name').value.trim();
    var body = el('tpl-body').value;
    if (!name) { toast(tr('O template precisa de um nome.'), true); return; }
    if (!body.trim()) { toast(tr('O template precisa de um corpo.'), true); return; }
    var tpl = selectedTemplate();
    var editing = !!tpl;
    var review = selects.review.get() || 'APPROVED';
    var reason = el('tpl-reason').value.trim();
    var wait = Number(el('tpl-review-delay').value);
    var language = editing ? tpl.language : (selects.language.get() || defaultTemplateLanguage());
    var category = selects.category.get() || 'UTILITY';
    var problem = partsProblem(state.parts);
    if (problem) { toast(problem, true); return; }
    var components = partsComponents(state.parts, body, state.tplVars || {});
    var format = isPositional(templatePlaceholders(body)) ? 'POSITIONAL' : 'NAMED';
    /* The review travels in X-Mock-* headers: they say how the mock behaves,
       not what the template is. Without them the template is approved. */
    var headers = { 'X-Mock-Template-Review': review };
    if (review !== 'APPROVED' && reason) headers['X-Mock-Template-Review-Reason'] = reason;
    if (isFinite(wait) && wait >= 0) headers['X-Mock-Template-Review-Delay'] = String(Math.round(wait * 1000));
    /* Meta's calls: create on the account's library, edit on the template's id. */
    var saving = editing
      ? graph('/' + encodeURIComponent(tpl.id), { method: 'POST', headers: headers, body: { category: category, components: components } })
      : graph('/' + WABA + '/message_templates', {
          method: 'POST',
          headers: headers,
          body: { name: name, language: language, category: category, parameter_format: format, components: components }
        });
    saving
      .then(function () {
        state.tpl = templateKey({ name: name, language: language });
        state.tplDirty = false;
        toast(tr(editing ? 'Template enviado de novo para a revisão.' : 'Template criado: em análise.'));
        return loadTemplates(true);
      })
      .catch(function (err) { toast(err.message, true); });
  });
  el('tpl-delete').addEventListener('click', function () {
    var b = el('tpl-delete');
    var tpl = selectedTemplate();
    if (!tpl) return;
    if (b.getAttribute('data-confirm') !== 'true') {
      b.setAttribute('data-confirm', 'true');
      b.textContent = tr('Toque de novo para apagar');
      setTimeout(function () { b.removeAttribute('data-confirm'); b.textContent = tr('Apagar'); }, 4000);
      return;
    }
    b.removeAttribute('data-confirm');
    b.textContent = tr('Apagar');
    /* Meta's delete: by name, narrowed to this language by its id (hsm_id). */
    graph('/' + WABA + '/message_templates?name=' + encodeURIComponent(tpl.name) + '&hsm_id=' + encodeURIComponent(tpl.id), { method: 'DELETE' })
      .then(function () {
        state.tpl = null;
        state.tplDirty = false;
        toast(tr('Template apagado.'));
        return loadTemplates(true);
      })
      .catch(function (err) { toast(err.message, true); });
  });
  el('clear-all').addEventListener('click', function () {
    var b = el('clear-all');
    if (b.getAttribute('data-confirm') !== 'true') {
      b.setAttribute('data-confirm', 'true');
      b.textContent = tr('Toque de novo para apagar');
      setTimeout(function () { b.removeAttribute('data-confirm'); b.textContent = tr('Apagar todas as conversas'); }, 4000);
      return;
    }
    b.removeAttribute('data-confirm');
    b.textContent = tr('Apagar todas as conversas');
    Promise.all([
      api('/settings/conversations', { method: 'DELETE' }),
      api('/settings/events', { method: 'DELETE' })
    ]).then(function () {
      state.messages = [];
      state.events = [];
      state.selected = null;
      state.seen = {};
      writeSeen();
      el('app').classList.remove('in-chat');
      render();
      toast(tr('Conversas apagadas.'));
    }).catch(function (e) { toast(e.message, true); });
  });

  el('read-all').addEventListener('click', function () {
    var t = selectedThread();
    if (!t) return;
    var pending = t.messages.filter(function (m) { return m.direction === 'out' && m.status !== 'read' && m.status !== 'failed'; });
    if (!pending.length) { toast(tr('Nada a marcar: tudo já foi lido.')); return; }
    Promise.all(pending.map(function (m) {
      return graph('/' + encodeURIComponent(m.businessId) + '/messages', {
        method: 'POST',
        headers: { 'X-Mock-From': m.contact, 'X-Mock-Message-Status': 'read' },
        body: { messaging_product: 'whatsapp', status: 'read', message_id: m.id }
      }).then(function () { m.status = 'read'; });
    })).then(function () { render(); toast(pending.length + ' ' + tr('mensagem(ns) marcada(s) como lida(s).')); })
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
  document.querySelectorAll('.as button').forEach(function (b) {
    b.addEventListener('click', function () { setAs(b.getAttribute('data-as')); });
  });
  renderQuick();

  var newFile = attacher(el('nd-attach'), el('nd-file'), el('nd-attachment'));
  el('nd-cancel').addEventListener('click', function () { newFile.clear(); el('new-dialog').close(); });
  el('new-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var business = el('nd-business').value.trim();
    var contact = digits(el('nd-contact').value);
    var name = el('nd-name').value.trim();
    var text = el('nd-text').value.trim();
    var file = newFile.get();
    if (!business || !contact) return;
    if (!text && !file) { toast(tr('Escreva a mensagem ou anexe um arquivo.'), true); return; }
    el('nd-send').disabled = true;
    sendAsPatient(business, contact, name, text, file).then(function () {
      newFile.clear();
      el('new-dialog').close();
      openThread(business + '|' + contact);
    }).catch(function (err) { toast(err.message, true); }).then(function () { el('nd-send').disabled = false; });
  });

  /* The panel opens in the language it was left in. */
  document.documentElement.lang = state.lang === 'en' ? 'en-US' : 'pt-BR';
  document.querySelectorAll('[data-lang]').forEach(function (b) {
    b.setAttribute('aria-pressed', b.getAttribute('data-lang') === state.lang ? 'true' : 'false');
  });
  translateDom();
  paintAs();

  render();
  load();
  loadSide();
  connect();
})();
</script>
</body>
</html>
`
