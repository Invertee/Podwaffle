# Podwaffle chapter worker

This optional worker generates chapters locally for podcasts that have **Auto chapters** enabled in Podwaffle. Podwaffle queues the newest episodes before playback; the player only reads completed chapter data.

The worker uses:

- `faster-whisper` for timestamped transcription;
- an Ollama model (default `qwen3:4b`) for topic boundaries, chapter titles, and probable advert classification.

No cloud API key is required. Episode audio and transcripts are temporary and are deleted after each job. Generated chapter JSON is retained by the Podwaffle server, not by this worker.

## Docker Compose

```bash
cd chapter-worker
docker compose up -d ollama
docker compose exec ollama ollama pull qwen3:4b
docker compose up -d --build chapter-worker
```

Confirm the worker is available:

```bash
curl http://localhost:8765/health
```

Set Podwaffle's `CHAPTER_WORKER_URL` to `http://<worker-host>:8765`. For the Home Assistant add-on, enter that address in the `chapter_worker_url` option and restart the add-on.

The default configuration is CPU-oriented:

```text
WHISPER_MODEL=small.en
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
OLLAMA_MODEL=qwen3:4b
```

A GPU host can override the Whisper device and compute type. The first generated episode downloads the configured Whisper model; the Ollama model is downloaded by the explicit `ollama pull` command above.
