"""Groq vision client for food extraction using OpenAI-compatible chat/completions."""

from __future__ import annotations

import base64
import json
import os
import re
import socket
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class GroqVisionClientError(RuntimeError):
    """Raised when a Groq vision API call fails."""


class GroqVisionClient:
    """Lightweight Groq OpenAI-compatible client for image + prompt extraction."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
    ) -> None:
        self.api_key = (api_key if api_key is not None else os.getenv("GROQ_API_KEY", "")).strip()
        env_base = os.getenv("GROQ_BASE_URL", "").strip()
        default_base = env_base or "https://api.groq.com/openai/v1"
        self.base_url = (base_url if base_url is not None else default_base).rstrip("/")

        env_model = os.getenv("GROQ_VISION_MODEL", "").strip()
        default_model = env_model or "meta-llama/llama-4-scout-17b-16e-instruct"
        self.model = (model if model is not None else default_model).strip()
        self.user_agent = os.getenv(
            "GROQ_USER_AGENT",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            " (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        ).strip()

        timeout_raw = timeout_seconds if timeout_seconds is not None else os.getenv("GROQ_TIMEOUT_SECONDS", "20")
        try:
            self.timeout_seconds = float(timeout_raw)
        except (TypeError, ValueError):
            self.timeout_seconds = 20.0

    @property
    def enabled(self) -> bool:
        return bool(self.api_key and self.model)

    def extract_food_from_image(self, image_bytes: bytes, prompt: Optional[str] = None) -> Dict[str, Any]:
        """Extract food name, OCR text, and ingredient list from an image."""
        if not self.enabled:
            raise GroqVisionClientError("Groq vision is not configured.")
        if not image_bytes:
            raise GroqVisionClientError("Empty image input.")

        instruction = prompt or self._default_prompt()
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": instruction},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": self._to_data_url(image_bytes),
                            },
                        },
                    ],
                }
            ],
            "temperature": 0.1,
            "max_completion_tokens": 260,
            "response_format": {"type": "json_object"},
        }

        response = self._post_chat_completions(payload)
        text = self._extract_message_text(response)
        parsed = self._parse_json_text(text)

        detected_food = str(parsed.get("detected_food") or "").strip()
        ocr_text = str(parsed.get("ocr_text") or "").strip()

        ingredients: List[str] = []
        raw_ingredients = parsed.get("ingredients")
        if isinstance(raw_ingredients, list):
            for item in raw_ingredients:
                value = str(item).strip()
                if value and value.lower() not in {x.lower() for x in ingredients}:
                    ingredients.append(value)

        return {
            "detected_food": detected_food,
            "ocr_text": ocr_text,
            "ingredients": ingredients,
            "raw_text": text,
        }

    def _post_chat_completions(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        url = f"{self.base_url}/chat/completions"
        req = Request(
            url=url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
                "Accept": "application/json",
                "User-Agent": self.user_agent,
            },
            method="POST",
        )

        try:
            with urlopen(req, timeout=self.timeout_seconds) as response:
                raw = response.read().decode("utf-8")
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            if exc.code == 403 and "1010" in detail:
                raise GroqVisionClientError(
                    "Groq request blocked (403/1010). Check API key permissions and set a valid "
                    "User-Agent via GROQ_USER_AGENT if needed."
                ) from exc
            raise GroqVisionClientError(f"Groq request failed ({exc.code}): {detail}") from exc
        except (URLError, TimeoutError, socket.timeout, OSError) as exc:
            raise GroqVisionClientError(f"Groq request failed: {exc}") from exc

        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise GroqVisionClientError("Groq returned non-JSON response.") from exc

        if not isinstance(parsed, dict):
            raise GroqVisionClientError("Groq returned invalid payload.")
        return parsed

    @staticmethod
    def _extract_message_text(payload: Dict[str, Any]) -> str:
        choices = payload.get("choices")
        if not isinstance(choices, list) or not choices:
            raise GroqVisionClientError("Groq response missing choices.")

        message = choices[0].get("message", {}) if isinstance(choices[0], dict) else {}
        content = message.get("content") if isinstance(message, dict) else None

        if isinstance(content, str) and content.strip():
            return content.strip()

        if isinstance(content, list):
            collected: List[str] = []
            for part in content:
                if not isinstance(part, dict):
                    continue
                text = part.get("text")
                if isinstance(text, str) and text.strip():
                    collected.append(text.strip())
            if collected:
                return "\n".join(collected)

        raise GroqVisionClientError("Groq response missing message content.")

    @staticmethod
    def _parse_json_text(raw_text: str) -> Dict[str, Any]:
        text = raw_text.strip()
        if text.startswith("```"):
            text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
            text = re.sub(r"\s*```$", "", text).strip()

        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass

        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            candidate = text[start : end + 1]
            try:
                parsed = json.loads(candidate)
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                pass

        raise GroqVisionClientError("Groq response is not valid JSON object text.")

    @staticmethod
    def _to_data_url(image_bytes: bytes) -> str:
        b64 = base64.b64encode(image_bytes).decode("utf-8")
        return f"data:image/jpeg;base64,{b64}"

    @staticmethod
    def _default_prompt() -> str:
        return (
            "You are extracting food information from a meal photo for a healthcare app.\n"
            "Return strict JSON only.\n"
            "Schema:\n"
            '{"detected_food": "string", "ocr_text": "string", "ingredients": ["string", "..."]}\n'
            "Rules:\n"
            "- detected_food: best short food name (or empty string if unknown).\n"
            "- ocr_text: visible words from packaging/menu, if any.\n"
            "- ingredients: likely main ingredients, max 6, short lowercase phrases.\n"
            "- No markdown, no explanation, JSON only.\n"
        )
