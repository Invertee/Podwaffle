# Changelog

## 0.1.2

- Accept per-podcast local-LLM detection guidance and Low/Balanced/High sensitivity.
- Prioritise configurable opening and closing minutes within the existing sample budget.

## 0.1.1

- Fix misplaced llama.cpp alias arguments that caused Qwen download setup to fail with an AbortSignal error.
- Add independent Whisper and Qwen download/verification controls and local runtime readiness.
- Map LAN port 5000 by default while retaining Home Assistant ingress. Existing installations should check their saved Network mapping.
- Keep verified models in persistent storage across application updates.

## 0.1.0

- Extract the podcast analyser from Radarr-Sonarr-Transcoder into an independent add-on.
- Preserve local API routes, persistent SQLite jobs and seven-day snippet expiry.
- Add standalone job/model/log UI and verified first-start Whisper downloads.
- Add optional local Qwen2.5 classification with bounded episode/podcast context.
- Keep Gemini explicit, local phrase fallback and manual-only chapter/advert review.
