"""MERaLiON API client wrapper."""

from __future__ import annotations

import json
import os
import socket
from typing import Any, Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class MeralionClientError(RuntimeError):
    """Raised when a MERaLiON API call fails."""


class MeralionClient:
    """Lightweight wrapper for MERaLiON HTTP API calls."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
    ) -> None:
        self.api_key = (api_key if api_key is not None else os.getenv("MERALION_API_KEY", "")).strip()
        self.base_url = (base_url if base_url is not None else os.getenv("MERALION_BASE_URL", "https://api.cr8lab.com")).rstrip("/")

        timeout_raw = timeout_seconds if timeout_seconds is not None else os.getenv("MERALION_TIMEOUT_SECONDS", "20")
        try:
            self.timeout_seconds = float(timeout_raw)
        except (TypeError, ValueError):
            self.timeout_seconds = 20.0

    @property
    def enabled(self) -> bool:
        """Return True when API key is present and client can call MERaLiON."""
        return bool(self.api_key)

    def chat(self, instruction: str, hyperparameters: Optional[Dict[str, Any]] = None) -> str:
        """Call the MERaLiON chat endpoint and return response text."""
        payload: Dict[str, Any] = {"instruction": instruction}
        if hyperparameters:
            payload["hyperParameters"] = hyperparameters
        data = self._post_json("/chat", payload)
        return self._extract_text(data)

    def _post_json(self, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """POST JSON payload to MERaLiON and return decoded JSON response."""
        if not self.enabled:
            raise MeralionClientError("MERALION_API_KEY is not set.")

        url = f"{self.base_url}{path}"
        body = json.dumps(payload).encode("utf-8")
        request = Request(
            url=url,
            data=body,
            headers={
                "Content-Type": "application/json",
                "x-api-key": self.api_key,
            },
            method="POST",
        )

        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                raw = response.read().decode("utf-8")
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            raise MeralionClientError(f"MERaLiON request failed with status {exc.code}: {detail}") from exc
        except (URLError, TimeoutError, socket.timeout) as exc:
            raise MeralionClientError(f"MERaLiON request failed: {exc}") from exc

        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise MeralionClientError("MERaLiON returned non-JSON response.") from exc

        if not isinstance(parsed, dict):
            raise MeralionClientError("MERaLiON returned invalid response format.")

        return parsed

    @staticmethod
    def _extract_text(payload: Dict[str, Any]) -> str:
        """Extract model text from standard MERaLiON response payload."""
        response = payload.get("response", {})
        if isinstance(response, dict):
            text = response.get("text")
            if isinstance(text, str) and text.strip():
                return text.strip()
        raise MeralionClientError("MERaLiON response missing response.text.")
