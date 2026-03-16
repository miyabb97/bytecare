"""Base agent interface for ByteCare agentic layer."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict


class BaseAgent(ABC):
    name: str = "base"

    @abstractmethod
    def run(self, user_id: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Execute the agent and return a result dict."""
        ...
