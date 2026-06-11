"""
explain-labs_claude — standalone bot server for the Explain Labs chat.

Implements the opaque-HTTP contract the Explain web app already speaks:

    POST /v1/ask           header: X-API-Key
                           body:   { "prompt": str,
                                     "conversation_id": str | null,   # optional, for multi-turn
                                     "images": [...] | null }         # optional, see _image_block
                           ->      { "answer": str, "conversation_id": str }

    DELETE /v1/conversations/{id}    forget a conversation (used by "new conversation")
    GET  /health                     liveness + which model / pack is loaded

It answers using the Explain Knowledge Pack (knowledge-pack/system-prompt.md +
explain-knowledge-pack.md) sent as a prompt-cached system prompt, so the bot is an
expert on the Explain engine. The pack is a snapshot — re-run the build script in the
Explain repo and redeploy the two .md files when the engine changes.

Run:
    pip install -r requirements.txt
    export ANTHROPIC_API_KEY=sk-ant-...        # the bot's own key, to call Claude
    export EXPLAIN_BOT_API_KEY=<same key the app sends>   # optional; enforced only if set
    python bot.py                              # serves on EXPLAIN_BOT_PORT (default 8091)

Config via environment variables (all optional except ANTHROPIC_API_KEY):
    ANTHROPIC_API_KEY      required — used by the Anthropic SDK to call Claude
    EXPLAIN_BOT_API_KEY    if set, requests must send a matching X-API-Key header
    EXPLAIN_BOT_PORT       default 8091
    EXPLAIN_BOT_MODEL      default claude-opus-4-8  (1M context; or claude-sonnet-4-6)
    EXPLAIN_BOT_MAX_TOKENS default 4096  (max length of each answer)
    EXPLAIN_BOT_CACHE_TTL  "5m" (default) or "1h" — 1h is cheaper for bursty lab use
    KNOWLEDGE_PACK_DIR     where to find the two .md files (default: ./knowledge-pack
                           next to this file, then ../knowledge-pack, then this folder)
"""

import os
import re
import uuid
from pathlib import Path
from typing import Any, Optional

import anthropic
import uvicorn
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
MODEL = os.environ.get("EXPLAIN_BOT_MODEL", "claude-opus-4-8")
MAX_TOKENS = int(os.environ.get("EXPLAIN_BOT_MAX_TOKENS", "4096"))
PORT = int(os.environ.get("EXPLAIN_BOT_PORT", "8091"))
CACHE_TTL = os.environ.get("EXPLAIN_BOT_CACHE_TTL", "5m")  # "5m" | "1h"
EXPECTED_KEY = os.environ.get("EXPLAIN_BOT_API_KEY")  # enforced only if set

# ---------------------------------------------------------------------------
# Locate and load the knowledge pack
# ---------------------------------------------------------------------------
def _find_pack_dir() -> Path:
    env = os.environ.get("KNOWLEDGE_PACK_DIR")
    here = Path(__file__).resolve().parent
    candidates = [Path(env)] if env else []
    candidates += [here / "knowledge-pack", here.parent / "knowledge-pack", here]
    for c in candidates:
        if (c / "explain-knowledge-pack.md").exists():
            return c
    raise SystemExit(
        "Could not find explain-knowledge-pack.md. Copy the knowledge-pack/ folder "
        "next to bot.py, or set KNOWLEDGE_PACK_DIR. Looked in: "
        + ", ".join(str(c) for c in candidates)
    )


PACK_DIR = _find_pack_dir()
SYSTEM_PROMPT = (PACK_DIR / "system-prompt.md").read_text(encoding="utf-8")
PACK = (PACK_DIR / "explain-knowledge-pack.md").read_text(encoding="utf-8")

# Two system blocks: a small stable preamble, then the big pack with a cache breakpoint.
# Everything before the breakpoint is cached; the per-request question rides in `messages`.
_pack_cache_control: dict[str, Any] = {"type": "ephemeral"}
if CACHE_TTL == "1h":
    _pack_cache_control["ttl"] = "1h"
SYSTEM_BLOCKS = [
    {"type": "text", "text": SYSTEM_PROMPT},
    {"type": "text", "text": PACK, "cache_control": _pack_cache_control},
]

client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from the environment

# In-memory conversation store: { conversation_id: [ {role, content}, ... ] }.
# Fine for a single-process lab bot; restart clears it. DELETE /v1/conversations/{id} clears one.
conversations: dict[str, list[dict[str, Any]]] = {}

app = FastAPI(title="explain-labs_claude")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
_DATA_URL = re.compile(r"^data:(?P<mt>[^;]+);base64,(?P<d>.+)$", re.S)


def _image_block(img: Any) -> dict[str, Any]:
    """Normalize an inbound image into an Anthropic image content block.

    Accepts: a data URL string ("data:image/png;base64,..."), a bare base64 string,
    an already-shaped {"source": {...}} block, or {"media_type"/"mediaType", "data"/"base64"}.
    """
    if isinstance(img, str):
        m = _DATA_URL.match(img)
        if m:
            return {"type": "image", "source": {"type": "base64", "media_type": m.group("mt"), "data": m.group("d")}}
        return {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": img}}
    if isinstance(img, dict):
        if "source" in img:  # already an Anthropic-shaped block
            return {"type": "image", "source": img["source"]}
        media_type = img.get("media_type") or img.get("mediaType") or "image/png"
        data = img.get("data") or img.get("base64") or ""
        m = _DATA_URL.match(data) if isinstance(data, str) else None
        if m:
            media_type, data = m.group("mt"), m.group("d")
        if not data:
            raise HTTPException(400, "image object missing base64 `data`")
        return {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}}
    raise HTTPException(400, "unsupported image format")


def _check_key(x_api_key: Optional[str]) -> None:
    if EXPECTED_KEY and x_api_key != EXPECTED_KEY:
        raise HTTPException(401, "invalid or missing X-API-Key")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
class AskBody(BaseModel):
    prompt: str = ""
    conversation_id: Optional[str] = None
    images: Optional[list[Any]] = None


@app.post("/v1/ask")
def ask(body: AskBody, x_api_key: Optional[str] = Header(default=None, alias="X-API-Key")):
    _check_key(x_api_key)
    has_images = bool(body.images)
    if not body.prompt and not has_images:
        raise HTTPException(400, "`prompt` or `images` is required")

    cid = body.conversation_id or uuid.uuid4().hex
    history = list(conversations.get(cid, []))

    user_content: list[dict[str, Any]] = []
    if has_images:
        user_content.extend(_image_block(i) for i in body.images)
    if body.prompt:
        user_content.append({"type": "text", "text": body.prompt})
    history.append({"role": "user", "content": user_content})

    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_BLOCKS,  # cached engine knowledge — same on every request
            messages=history,      # the conversation (incl. the app's patient-state block)
        )
    except anthropic.APIStatusError as e:
        raise HTTPException(502, f"Anthropic API error {e.status_code}: {e.message}")
    except anthropic.APIError as e:
        raise HTTPException(502, f"Anthropic error: {e}")

    answer = "".join(b.text for b in resp.content if b.type == "text").strip()
    history.append({"role": "assistant", "content": answer})
    conversations[cid] = history

    u = resp.usage
    print(
        f"[ask] cid={cid[:8]} model={MODEL} in={u.input_tokens} "
        f"cache_write={u.cache_creation_input_tokens} cache_read={u.cache_read_input_tokens} "
        f"out={u.output_tokens}"
    )
    return {"answer": answer, "conversation_id": cid}


@app.delete("/v1/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: str, x_api_key: Optional[str] = Header(default=None, alias="X-API-Key")
):
    _check_key(x_api_key)
    conversations.pop(conversation_id, None)
    return {"deleted": conversation_id}


@app.get("/health")
def health():
    return {
        "ok": True,
        "model": MODEL,
        "pack_dir": str(PACK_DIR),
        "pack_tokens_est": round(len(PACK) * 0.27 / 1000),
        "cache_ttl": CACHE_TTL,
        "auth_enforced": EXPECTED_KEY is not None,
        "active_conversations": len(conversations),
    }


if __name__ == "__main__":
    print(f"explain-labs_claude — model={MODEL}, pack={PACK_DIR}, port={PORT}, "
          f"auth={'on' if EXPECTED_KEY else 'OFF'}, cache_ttl={CACHE_TTL}")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
