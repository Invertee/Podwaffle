# Integrated advert analysis

Podwaffle 6 runs the English audio-analysis engine inside the main web server. The separate Ad Detection add-on is retired. Open **Ad detection** in the web sidebar to manage model downloads, audio sampling, sensitivity presets, classification thresholds, diagnostics and retained audio storage. Inspect a completed job to edit advert regions in seconds.

## Upgrade from the sidecar

1. Before removing the old add-on, copy its Whisper model choice, thread count, sampling budget, schedule, classifier and Jev options into the main Podwaffle add-on configuration. The engine defaults to local phrase rules; remote classification still requires an explicit Jev selection and API key.
2. Update Podwaffle and open **Ad detection**. Prepare Whisper or allow the first queued job to prepare it during the configured schedule. Model weights are downloaded and checksum-verified. Existing subscription choices and results already stored in the main Podwaffle database remain available.
3. Stop and uninstall the former Ad Detection add-on after checking the integrated engine. Old `analysis_server_url` values are ignored; no connection to the old service is made. Pending jobs are resubmitted to the integrated queue with their original request settings. Sidecar-only diagnostics and its global sensitivity presets are not automatically imported; copy those controls before uninstalling if needed.
4. Install Android 0.5.0 or newer for retained audio, advert highlights and automatic skipping.

Analysis runs in the configured schedule (23:00–07:00 Europe/London by default). Configure the schedule in the main add-on options; an already running job is allowed to finish.

## Per-series opt-in

Enable **Analyse and download new episodes** on a series in the web or Android client. This applies to newly discovered episodes for the current profile, preserving the existing opt-in behaviour. Existing episodes can be analysed manually through their web details. Disabling the series stops future automatic work and stops advertising retained recordings to that profile. Already downloaded files remain subject to the client's existing retention policy.

Other series continue to use their publisher enclosure URLs. The original enclosure URL remains in every episode response. A new optional `analysedMedia` field contains the local media path, SHA-256, byte size, duration and advertisement ranges for the exact checked recording. Markers are only supplied for a matching retained recording and an opted-in subscription.

## Speech excerpts and advert boundaries

New analysis jobs scan the recording for pauses, sustained changes in loudness and changes in its frequency balance (tone). Brief clicks and quiet background noise are filtered out. These cues suggest places to sample or split speech; a sound change alone never labels an advert. The existing audio sensitivity presets also control how large a volume or tone change must be.

The first transcription pass keeps the configured audio sampling budget. Samples are generally 30 seconds, with shared sample edges moved to nearby acoustic breaks when possible without increasing the budget. Whisper now supplies speech and token timestamps. Classification uses variable-length excerpts assembled around pauses, sound changes and sentence endings, normally capped at 25 seconds. If complete token timing is unavailable, the full timed speech fragment is kept to avoid losing words. Jev receives nearby transcript text separately as context and is instructed to classify only the current excerpt.

Detected adverts and promotions receive a bounded refinement pass: overlapping 30-second samples around the outer edges of consecutive positive decisions are transcribed and classified again. The extra transcription budget is one third of the initial sampling budget, with a minimum of 60 seconds and maximum of 240 seconds, at most eight samples and three rounds. This can follow an advert beyond the original sample and find the return to editorial speech. Consecutive positive excerpts are merged only across short gaps containing no known editorial speech. Marker edges may move outward by up to 800 milliseconds to a nearby acoustic break when no transcribed speech is crossed.

The job diagnostics record the acoustic cues, whether volume/tone statistics were available, and refinement work used. The inspection timeline shows the resulting variable excerpts and merged markers. Unsupported acoustic filters fall back to pause detection; failed refinement retains earlier detection evidence. A classifier failure during refinement cannot extend an earlier advert into newly sampled speech. All boundaries remain approximate, and capped or unsampled regions can still contain adverts. Existing saved results keep their original timings; rerun analysis to use the new detector.

## Storage and backups

In the Home Assistant add-on, retained audio is under `/data/episode-cache`. Temporary analysis files and downloaded Whisper weights live below that directory too. The add-on's `backup_exclude` excludes the directory and all its contents. Settings, fingerprints, markers and jobs remain in the main database under `/config/podwaffle`, included with the add-on's configuration backup. The add-on uses a cold backup so the database is consistent. Podwaffle's managed database backups also contain metadata rather than episode audio.

The default retained-audio cap is 5000 MiB. Change it in **Ad detection → Retained episodes** or set the initial `episode_cache_mb` add-on option. The dashboard override is persisted in the database and takes precedence. Oldest accessed recordings are removed first. Zero disables retention; a single recording larger than the cap is analysed without being retained. The cap covers retained episode bytes; one in-flight download/PCM workspace and model weights require additional space. `max_audio_mb` bounds each input download. Startup removes abandoned analysis work and unreferenced retained files.

Standalone analysis requires FFmpeg/ffprobe and `whisper-cli` on PATH (the add-on image includes them). Browsing and publisher playback remain usable without those optional tools. Standalone deployments can set `PODWAFFLE_EPISODE_CACHE_DIR`; the default is `episode-cache` below the server data directory. Apply an equivalent exclusion in your own backup tool. Home Assistant's exclusion does not control third-party whole-disk backups.

## Playback, offline copies and fallback

Web and Android clients prefer retained audio for opted-in analysed episodes. The media endpoint supports byte ranges and HEAD for seeking. Media URLs use unguessable 256-bit capability identifiers, allowing native media players to fetch audio without exposing device credentials to publishers. Treat a shared media URL as access to that one cached recording; eviction invalidates it.

When analysis completes, configured Firebase installations send a silent `analysis-ready` data message to the profile's registered Android devices. Android fetches an authenticated catch-up list and enqueues downloads through its existing native DownloadManager, waiting for an unmetered connection. Websocket events, reconnects and later pushes repeat this catch-up, so Firebase is optional and a missed message does not permanently lose a download. Existing download deduplication and retention still apply. Firebase and Android background delivery remain subject to network access, battery restrictions and force-stop behaviour.

Analysis-ready messages queue downloads before playback sync or a full profile refresh. A failure in either sync request does not block downloading, and a completion arriving during an earlier download check triggers a further check. One failed download entry does not block other ready episodes. Completed episodes with no advert markers are still eligible. Only unplayed episodes from opted-in series with a retained checked recording appear in automatic catch-up. The server log records whether Firebase accepted each offline-download request and how many Android registrations were targeted; Firebase acceptance does not confirm that a device has received or downloaded it.

Android checks downloaded audio against the analysis SHA-256 before exposing it for playback. Analysis metadata is persisted with the offline file. Failed retained streams and failed retained downloads retry the original publisher URL with analysis metadata cleared. The web player also falls back to the original feed recording. A restored backup has metadata but no cached audio; missing-media responses trigger that same fallback. Android Auto uses the same native queue and stored media metadata. Cast keeps its existing publisher playback path.

## Android advert skipping

In **Profile → Playback**, turn on **Automatically skip adverts**. This per-profile setting is stored on the device and defaults off. The native service skips advertisement ranges on checked local streams and verified offline copies, including with the screen off and through Android Auto. Promotions and other chapter types are not automatically skipped. Overlapping or adjacent advert regions are skipped in one seek, bounded by the recording duration. Cast and feed fallback do not use automatic skipping. Amber bands on the now-playing progress bar show the current recording's advert ranges.

Detection is approximate and sampling can miss adverts. Adjust sensitivity and inspect results before relying on skipping; editing advert regions updates the server result and clients' catch-up metadata for subsequent playback.

## Validation

Run the normal workspace type checks, lint and tests, plus `pnpm --filter @podwaffle/server test:engine` for the transferred engine. Android builds must use the release variant: `.\gradlew.bat :app:assembleRelease`. Native unit tests use `:podwaffle-media:testReleaseUnitTest`; never invoke a debug variant. Release APKs are under `apps/android/android/app/build/outputs/apk/release/`.
