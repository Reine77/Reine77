import logging

import httpx

logger = logging.getLogger(__name__)

DEFAULT_MODELS = {
    "openai": "gpt-5",
    "anthropic": "claude-sonnet-5",
    "gemini": "gemini-2.5-pro",
    "grok": "grok-4",
    "mistral": "mistral-large-latest",
}

# OpenAI, xAI (Grok), and Mistral all speak the same chat-completions shape.
_OPENAI_COMPATIBLE_URLS = {
    "openai": "https://api.openai.com/v1/chat/completions",
    "grok": "https://api.x.ai/v1/chat/completions",
    "mistral": "https://api.mistral.ai/v1/chat/completions",
}


class LLMAdvisor:
    """Optional second opinion attached to a trade signal before you confirm
    it in Telegram. Any failure (bad key, timeout, provider outage) is
    swallowed and logged — the Confirm/Skip flow works with or without it."""

    def __init__(self, provider, api_key, model=None):
        self.provider = provider
        self.api_key = api_key
        self.model = model or DEFAULT_MODELS.get(provider)

    @property
    def enabled(self):
        return bool(self.provider and self.api_key)

    async def opinion(self, prompt):
        if not self.enabled:
            return None
        try:
            return await self._call(prompt)
        except Exception:
            logger.exception("LLM advisor call failed (provider=%s)", self.provider)
            return None

    async def _call(self, prompt):
        async with httpx.AsyncClient(timeout=20) as client:
            if self.provider in _OPENAI_COMPATIBLE_URLS:
                resp = await client.post(
                    _OPENAI_COMPATIBLE_URLS[self.provider],
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    json={
                        "model": self.model,
                        "messages": [{"role": "user", "content": prompt}],
                        "max_tokens": 200,
                    },
                )
                resp.raise_for_status()
                return resp.json()["choices"][0]["message"]["content"].strip()

            if self.provider == "anthropic":
                resp = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": self.api_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": self.model,
                        "max_tokens": 200,
                        "messages": [{"role": "user", "content": prompt}],
                    },
                )
                resp.raise_for_status()
                return resp.json()["content"][0]["text"].strip()

            if self.provider == "gemini":
                resp = await client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent",
                    params={"key": self.api_key},
                    json={"contents": [{"parts": [{"text": prompt}]}]},
                )
                resp.raise_for_status()
                return resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()

            logger.warning("Unknown LLM provider: %s", self.provider)
            return None
