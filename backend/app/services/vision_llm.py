"""Vision LLM service for herb image analysis using OpenAI GPT-4o-mini."""

from __future__ import annotations

import base64
import json
import logging
import os
from typing import Any, Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)


class VisionLLMError(RuntimeError):
    """Raised when a Vision LLM API call fails."""


def _get_api_key() -> str:
    return os.getenv("OPENAI_API_KEY", "").strip()


def is_vision_available() -> bool:
    """Return True if an OpenAI API key is configured."""
    return bool(_get_api_key())


def analyze_herb_image(image_bytes: bytes, timeout: float = 30.0) -> Optional[Dict[str, Any]]:
    """Send an image to GPT-4o-mini vision and ask it to identify the herb.

    Returns a dict with:
        herb_name: str | None
        confidence: str   ("high", "medium", "low")
        extracted_text: str | None   (visible text on packaging)
        reasoning: str               (why the model thinks this)
    Or None if the API is unavailable / fails.
    """
    api_key = _get_api_key()
    if not api_key:
        return None

    b64 = base64.b64encode(image_bytes).decode("utf-8")

    prompt = (
        "You are a Traditional Chinese Medicine (TCM) and herbal supplement expert.\n"
        "Analyze this image and identify the herb or herbal supplement shown.\n\n"
        "Instructions:\n"
        "1. First look for any visible TEXT on packaging, labels, or bottles. "
        "If text is found, use it as the PRIMARY signal for identification.\n"
        "2. If no text is visible, identify the herb based on its visual appearance "
        "(leaf shape, root appearance, color, form — dried, powder, whole, etc.).\n"
        "3. Include both the common English name AND Chinese name if known.\n\n"
        "Return ONLY valid JSON (no markdown, no code fences) in this exact format:\n"
        "{\n"
        '  "herb_name": "English common name (e.g. ginseng, ginkgo, danshen)",\n'
        '  "chinese_name": "Chinese name if known, or null",\n'
        '  "confidence": "high" or "medium" or "low",\n'
        '  "extracted_text": "any text visible on packaging/labels, or null",\n'
        '  "reasoning": "brief explanation of how you identified it"\n'
        "}\n\n"
        "If you truly cannot identify any herb, set herb_name to null."
    )

    payload = {
        "model": "gpt-4o-mini",
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{b64}",
                            "detail": "low",
                        },
                    },
                ],
            }
        ],
        "max_tokens": 300,
        "temperature": 0.1,
    }

    body = json.dumps(payload).encode("utf-8")
    req = Request(
        "https://api.openai.com/v1/chat/completions",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    import time as _time

    data = None
    for _attempt in range(3):
        try:
            with urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            break
        except HTTPError as exc:
            if exc.code == 429 and _attempt < 2:
                wait = 2 ** (_attempt + 1)
                logger.info("Vision LLM 429 rate-limited, retrying in %ds…", wait)
                _time.sleep(wait)
                continue
            logger.warning("Vision LLM request failed: HTTP %s", exc.code)
            return None
        except (URLError, TimeoutError, OSError) as exc:
            logger.warning("Vision LLM request failed: %s", exc)
            return None

    if data is None:
        return None

    try:
        content = data["choices"][0]["message"]["content"].strip()
        # Strip markdown code fences if present
        if content.startswith("```"):
            content = content.split("\n", 1)[1] if "\n" in content else content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()
        result = json.loads(content)
        return {
            "herb_name": result.get("herb_name"),
            "chinese_name": result.get("chinese_name"),
            "confidence": result.get("confidence", "low"),
            "extracted_text": result.get("extracted_text"),
            "reasoning": result.get("reasoning", ""),
        }
    except (json.JSONDecodeError, KeyError, IndexError) as exc:
        logger.warning("Failed to parse Vision LLM response: %s — raw: %s", exc, data)
        return None
