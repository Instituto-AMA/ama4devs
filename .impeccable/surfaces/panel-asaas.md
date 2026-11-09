---
version: 1
slug: "panel-asaas"
primary_target: "mocks/asaas/panel/index.html"
related_targets: ["mocks/asaas/panel/src/tokens.css", "mocks/asaas/panel/src/app.css", "mocks/asaas/panel/src/components/ui.css"]
---

## Scope

The Asaas mock's operator panel: the screen the developer drives the mock from — the
home sheet, the charges ledger, the customers, the statement, the integrations (API
keys, webhooks, request logs) and the simulator (profiles, virtual clock, test cards,
fees). It is a working screen, not a landing: every surface exists to change a state
of the mock. Mode: **Operate**. Audience: a developer integrating against Asaas, in
front of the mock, usually while an issue is open. Primary action: read what the
mock did and make it do the next thing (simulate a sale, rotate a key, replay a
webhook, advance the clock).

The panel is not a second world: it is the site's world (The Running Receipt) at the
size of a workbench. The site sells the mock; the panel is where the mock is used.

## Direction contract

THESIS: the panel is the printer itself — the machine's body on the left and top, the
sheet it prints in the middle, and the reason everything is a receipt is that the
person using it is reading a ledger of what the API did. Refuses the generic SaaS
admin (rounded white cards on gray, a blue primary, an icon per row).

OWN-WORLD: one deep printer-body ground (ultramarine `#0f2160`) carries the rail and
the strip; the work sits on cool thermal paper (`#f3f5f1`) whose top edge is torn by
a row of teeth; dot-matrix display type (Doto) only for the small print heads
(section labels, stamps, group names), Archivo for the prose and the page headline,
Martian Mono for every number and id; the controls are card-machine keypad keys with
four pixels of depth that drop to one when pressed; the states are stamps; the ledger
is monospaced with dashed perforations between the lines.

STORY: the developer opens the panel to answer one question about the mock ("did the
refund land?", "why is this queue frozen?", "which key do I sign with?") and leaves
having pushed the mock into the next state — and the panel never makes them read a
manual to find out.

FIRST VIEWPORT: the rail on the left with the open section pressed in as a white key,
the strip with the account balance in mono, and the sheet itself: the page headline in
Archivo 800 narrow, the tabs of the section under a rule, and the ledger's column
heads in small caps.

FORM: thermal receipt on a printer body; my list position 5 of 7, seed 56c827ffe894bd9b.

FINISH: the dark receipt holds — every slot, key, stamp and rule readable in both
themes; the detector finds no raw primitive in a screen; the panel is registered as a
surface of this world in DESIGN.md.
