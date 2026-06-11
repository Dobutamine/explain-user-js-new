# explain-labs_claude — bot server (FALLBACK only)

> **You probably don't need this.** Your live `explain` bot is a **Claude Agent SDK** bot
> (it loads its working dir's `CLAUDE.md` and has Read/Glob/Grep). For that bot, transferring
> Explain knowledge is just copying `explain-knowledge-pack.md` into its `workdir/` and adding
> the `CLAUDE.md` pointer — see `knowledge-pack/README.md` → "Primary method". This directory
> is the **fallback** for a host that is *not* an Agent-SDK bot and instead relays straight to
> the Anthropic API.

A complete, self-contained server for the Explain Labs chat. It speaks the exact
contract your app already uses (`POST /v1/ask`, `DELETE /v1/conversations/{id}`,
`X-API-Key` auth) and answers using the **Explain Knowledge Pack** as a prompt-cached
system prompt — so the bot knows the Explain engine the way Claude Code does.

Use this only if you do *not* already have an Agent-SDK bot; it would replace such a bot.

## What you'll copy to the Mac mini

Two things, side by side:

```
explain-bot/
├── bot.py               # from this repo: bot-server/bot.py
├── requirements.txt     # from this repo: bot-server/requirements.txt
└── knowledge-pack/      # the whole folder from this repo: knowledge-pack/
    ├── system-prompt.md
    └── explain-knowledge-pack.md
```

`bot.py` automatically finds `knowledge-pack/` when it sits right next to it.

## Step-by-step (first time)

These commands run **on the Mac mini** (`lucys-mac-mini`). If you normally reach it via
Screen Sharing, open a Terminal there. If you use SSH from your laptop:
`ssh lucys-mac-mini.tail990503.ts.net`.

1. **Get the files onto the mini.** From your laptop, in the Explain repo:
   ```sh
   # creates explain-bot/ on the mini with bot.py, requirements.txt, and the pack
   ssh lucys-mac-mini.tail990503.ts.net 'mkdir -p ~/explain-bot'
   scp bot-server/bot.py bot-server/requirements.txt lucys-mac-mini.tail990503.ts.net:~/explain-bot/
   scp -r knowledge-pack lucys-mac-mini.tail990503.ts.net:~/explain-bot/
   ```
   (No SSH? Copy the same three items over Screen Sharing / AirDrop / a synced folder — the
   layout in the box above is all that matters.)

2. **On the mini, install dependencies** (one-time):
   ```sh
   cd ~/explain-bot
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   ```

3. **Set the two keys** (in the same terminal):
   ```sh
   export ANTHROPIC_API_KEY=sk-ant-...           # your Anthropic key — the bot uses this to call Claude
   export EXPLAIN_BOT_API_KEY=<the same value as EXPLAIN_BOT_API_KEY in the app's .env.local>
   ```
   The second one must match what the app sends, or every request gets a 401. (Leave it
   unset only if you want no auth at all.)

4. **Free up port 8091.** Your *current* bot is already on 8091 — stop it first (however you
   start it: Ctrl-C its terminal, `kill` its process, or stop its launchd/pm2 service).
   Or run this one on a different port and point the app at it (see "Switching ports" below).

5. **Run it:**
   ```sh
   python bot.py
   ```
   You should see a startup line and, on `http://localhost:8091/health`, JSON showing
   `"model": "claude-opus-4-8"` and a `pack_tokens_est` around 200.

6. **Test from your laptop** (over Tailnet):
   ```sh
   curl -s http://lucys-mac-mini.tail990503.ts.net:8091/health
   curl -s http://lucys-mac-mini.tail990503.ts.net:8091/v1/ask \
     -H "Content-Type: application/json" -H "X-API-Key: <your key>" \
     -d '{"prompt":"What is the exact formula for an effective elastance value in Explain?"}'
   ```
   A correct answer cites the factor/effective-value pattern from the pack. Then open the
   **Explain Labs** tab in the app and ask the same thing.

## Keeping it running

`python bot.py` stops when you close the terminal. To keep it up after you log out, the
simplest options on macOS:

- **Quick & dirty:** `nohup python bot.py > bot.log 2>&1 &` (survives the terminal; not a reboot).
- **Proper:** a `launchd` plist or a process manager (`pm2 start bot.py --interpreter python3`).
  Ask me and I'll generate a launchd plist for you.

## Config knobs (environment variables)

| Var | Default | Notes |
|-----|---------|-------|
| `ANTHROPIC_API_KEY` | — (required) | The bot's key to call Claude. |
| `EXPLAIN_BOT_API_KEY` | unset | If set, `X-API-Key` must match. Match the app's `.env.local`. |
| `EXPLAIN_BOT_PORT` | `8091` | Port to serve on. |
| `EXPLAIN_BOT_MODEL` | `claude-opus-4-8` | 1M context. Use `claude-sonnet-4-6` to cut cost ~40%. |
| `EXPLAIN_BOT_MAX_TOKENS` | `4096` | Max length of each answer. |
| `EXPLAIN_BOT_CACHE_TTL` | `5m` | Set to `1h` for cheaper bursty use (a session's follow-ups all hit cache). |
| `KNOWLEDGE_PACK_DIR` | auto | Override where the two `.md` files live. |

## Switching ports (instead of stopping the old bot)

Run the new bot on, say, 8092 (`EXPLAIN_BOT_PORT=8092 python bot.py`), then change
`EXPLAIN_BOT_URL` in the app's `.env.local` to `...:8092` and restart the dev server. Once
you're happy, retire the old bot and move back to 8091 if you like.

## Updating the pack later

When the Explain engine changes, in the Explain repo run `node scripts/build_knowledge_pack.mjs`,
then re-copy `knowledge-pack/` to `~/explain-bot/` on the mini and restart `bot.py`. That's the
only ongoing maintenance.

## Cost (rough)

Each request resends the ~200K-token pack as the system prompt. With caching: a *cold* request
(cache expired) costs ~$1.35 on Opus / ~$0.80 on Sonnet; a *warm* follow-up within the TTL costs
~$0.11 / ~$0.07. Set `EXPLAIN_BOT_CACHE_TTL=1h` so a back-and-forth session mostly hits the warm
price. The `[ask]` log line prints `cache_read` per request — non-zero means caching is working.
