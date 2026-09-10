# Mail + Contacts — design canvas

Five clickable screens for the mail manager, drawn in DevDeck's own vocabulary
(tokens from `src/index.css`, shell from `App.tsx`, list/detail shape from
Stash). Published as a Claude Design canvas:
<https://claude.ai/code/artifact/13bd22f6-f1be-452b-83c4-8bb15682f76b>

| Artboard | What it covers |
|---|---|
| `Main.dc.html` | Inbox — accounts, groups, filters, thread list, reader with rendered HTML body, attachments and raw source |
| `Assistant.dc.html` | One thread with the assistant inline — summary, suggested reply, actions it took and one it is asking about |
| `Contacts.dc.html` | Contacts, linked to clients and projects |
| `Accounts.dc.html` | Settings → mail accounts, with the add-account sheet (Gmail OAuth / IMAP + SMTP) |
| `Compose.dc.html` | Compose over the mail surface — from-account picker, recipients from contacts, attachments |

`canvas.json` lays them out. Every `.dc.html` is a self-contained Design
Component: markup plus a `renderVals()` logic block that drives the working
controls. Sample people, companies and numbers are fictional.

To republish after editing an artboard:

```bash
node "<design skill>/seed-canvas.mjs" \
  --template "<design skill>/payload.template.html" \
  --out devdeck-mail.html --title "DevDeck Mail" \
  --artboard Main.dc.html --artboard Assistant.dc.html --artboard Contacts.dc.html \
  --artboard Accounts.dc.html --artboard Compose.dc.html --canvas canvas.json
```

Then publish `devdeck-mail.html` to the URL above. The seeded file is ~2.7 MB
and is deliberately not committed.
