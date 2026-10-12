# Changelog

## 0.2.0

- Replace local Qwen/llama.cpp and Gemini inference with DigitalOcean Jev's System One API.
- Keep local Whisper, silence sampling, publisher chapters, phrase fallback and manual marker review.
- Add dashboard forms for audio URL jobs and direct transcript classification tests.
- Display Jev confidence, label probabilities, request counts, returned models and token usage.
- Accept Jev results in Podwaffle and reuse saved detection guidance.
- Migrate old classifier selections to rules with a warning; remove known obsolete Qwen cache files during model preparation.

## 0.1.5

- Load the local Qwen classifier only while an analysis job is running and stop
  its llama.cpp process afterwards so model RAM is released while idle.

## 0.1.4

- Classify transcript excerpts independently so one slow or invalid local response does not discard the remaining analysis.
- Add a configurable per-excerpt local-LLM timeout and report individual failures in diagnostics.

## 0.1.3

- Retain concise per-excerpt local-classifier decisions for no-hit diagnostics.

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
