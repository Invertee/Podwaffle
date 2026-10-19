"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  let selected = new URLSearchParams(location.hash.slice(1)).get("job"),
    busy = false,
    jevConfigured = false,
    transcriptPending = false,
    inspectionRequest = 0;
  let jobs = [];
  // Relative paths keep the management UI working behind Home Assistant ingress.
  async function api(route, options) {
    const response = await fetch(`/api/v1/analysis/${route}`, options);
    const body = await response.json();
    if (!response.ok) {
      const error = new Error(body.error || `HTTP ${response.status}`);
      error.body = body;
      throw error;
    }
    return body;
  }
  async function inspect(id) {
    selected = id;
    const request = ++inspectionRequest;
    window.PodcastDashboard.setJob(id);
    for (const row of $("jobs").children)
      row.classList.toggle("selected-job", row.dataset.jobId === id);
    const data = await api(`jobs/${encodeURIComponent(id)}`);
    if (selected === id && request === inspectionRequest) {
      window.PodcastInspector.render(data);
      renderMarkerEditor(data);
    }
  }
  function renderMarkerEditor(data) {
    let editor = $("markerEditor");
    if (!editor) {
      editor = document.createElement("section");
      editor.id = "markerEditor";
      editor.className = "card";
      $("inspector").append(editor);
    }
    if (editor.dataset.job === data.job.id && editor.dataset.dirty === "true")
      return;
    editor.dataset.job = data.job.id;
    editor.dataset.dirty = "false";
    editor.oninput = () => {
      editor.dataset.dirty = "true";
    };
    editor.replaceChildren();
    if (!data.job.result || data.job.status !== "completed") return;
    const heading = document.createElement("h3");
    heading.textContent = "Edit advert regions";
    editor.append(heading);
    const note = document.createElement("p");
    note.textContent =
      "Adjust start and end times in seconds. Changes apply to this checked recording.";
    editor.append(note);
    const original = data.job.result.segments;
    const rows = [];
    function addRow(segment) {
      const row = document.createElement("div");
      row.className = "marker-edit-row";
      const start = document.createElement("input"),
        end = document.createElement("input");
      for (const input of [start, end]) {
        input.type = "number";
        input.min = "0";
        input.step = "0.1";
        input.max = String(data.job.result.durationMs / 1000);
      }
      start.value = String(segment.startMs / 1000);
      end.value = String(segment.endMs / 1000);
      const startLabel = document.createElement("label");
      startLabel.textContent = "Start (seconds) ";
      startLabel.append(start);
      const endLabel = document.createElement("label");
      endLabel.textContent = "End (seconds) ";
      endLabel.append(end);
      const remove = document.createElement("button");
      remove.textContent = "Remove";
      const item = { segment, start, end, removed: false };
      rows.push(item);
      remove.onclick = () => {
        editor.dataset.dirty = "true";
        item.removed = true;
        row.remove();
      };
      row.append(startLabel, endLabel, remove);
      editor.append(row);
    }
    original
      .filter((segment) => segment.kind === "advertisement")
      .forEach(addRow);
    const add = document.createElement("button");
    add.textContent = "Add advert region";
    add.onclick = () => {
      editor.dataset.dirty = "true";
      addRow({
        startMs: 0,
        endMs: Math.min(30000, data.job.result.durationMs),
        kind: "advertisement",
        title: "Advert",
        confidence: 1,
        source: "rules",
        evidence: "Edited by listener",
        boundaryStatus: "approximate",
      });
    };
    const save = document.createElement("button");
    save.textContent = "Save advert regions";
    save.onclick = action(async () => {
      const segments = [
        ...original.filter((segment) => segment.kind !== "advertisement"),
        ...rows
          .filter((row) => !row.removed)
          .map((row) => ({
            ...row.segment,
            startMs: Math.round(Number(row.start.value) * 1000),
            endMs: Math.round(Number(row.end.value) * 1000),
          })),
      ].sort((a, b) => a.startMs - b.startMs);
      await api(`jobs/${encodeURIComponent(data.job.id)}/segments`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: crypto.randomUUID(), segments }),
      });
      editor.dataset.dirty = "false";
      await inspect(data.job.id);
    });
    editor.append(add, save);
  }
  const action = (task) => async () => {
    try {
      await task();
    } catch (e) {
      $("error").textContent = e.message;
    }
  };
  function renderJobs() {
    const query = $("jobSearch").value.trim().toLowerCase();
    const matching = jobs.filter((job) =>
      `${job.request.title} ${job.request.podcastTitle || ""} ${job.status}`
        .toLowerCase()
        .includes(query),
    );
    $("jobs").replaceChildren();
    for (const job of matching) {
      const row = document.createElement("tr");
      row.dataset.jobId = job.id;
      row.classList.toggle("selected-job", job.id === selected);
      for (const value of [
        new Date(job.createdAt).toLocaleString(),
        job.request.title,
        job.status,
        job.stage,
        `${job.progress}%`,
        job.segmentCount,
      ]) {
        const cell = document.createElement("td");
        cell.textContent = String(value);
        row.append(cell);
      }
      const cell = document.createElement("td"),
        button = document.createElement("button");
      button.textContent = "Inspect";
      button.setAttribute("aria-label", `Inspect ${job.request.title}`);
      button.onclick = action(async () => {
        await inspect(job.id);
        $("inspector").scrollIntoView({ block: "start", behavior: "smooth" });
      });
      cell.append(button);
      if (job.status === "failed") {
        const retry = document.createElement("button");
        retry.textContent = "Retry";
        retry.onclick = action(async () => {
          await api(`jobs/${encodeURIComponent(job.id)}/retry`, {
            method: "POST",
          });
          await refresh();
          await inspect(job.id);
          $("error").textContent =
            "Retried here. If Podwaffle already marked this job failed, use Reanalyse in its episode modal to refresh its result.";
        });
        cell.append(retry);
      }
      row.append(cell);
      $("jobs").append(row);
    }
    if (!matching.length) {
      const row = document.createElement("tr"),
        cell = document.createElement("td");
      cell.colSpan = 7;
      cell.textContent = jobs.length
        ? "No episodes match your search."
        : "No analysis jobs yet. Enable analysis or test an episode in Podwaffle.";
      row.append(cell);
      $("jobs").append(row);
    }
  }
  async function refreshStorage() {
    const storage = await api("storage");
    $("cacheLimit").value = storage.limitMb;
    $("cacheUsage").textContent =
      `${storage.count} ${storage.count === 1 ? "episode" : "episodes"} · ${(storage.bytes / 1024 ** 2).toFixed(0)} MB. Audio and model files are excluded from Home Assistant backups.`;
  }
  $("saveCache").onclick = action(async () => {
    await api("storage", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limitMb: Number($("cacheLimit").value) }),
    });
    await refreshStorage();
  });
  void refreshStorage().catch((e) => {
    $("error").textContent = e.message;
  });
  let subscriptionsLoaded = false;
  async function loadSubscriptions() {
    if (subscriptionsLoaded) return;
    const container = $("analysisSubscriptions");
    try {
      const { subscriptions } = await api("subscriptions");
      container.replaceChildren();
      for (const subscription of subscriptions) {
        const label = document.createElement("label");
        label.className = "checkbox-label subscription-option";
        const toggle = document.createElement("input");
        toggle.type = "checkbox";
        toggle.checked = subscription.settings.enabled;
        toggle.onchange = async () => {
          toggle.disabled = true;
          const enabled = toggle.checked;
          $("subscriptionsMessage").textContent = "Saving…";
          try {
            const response = await fetch(
              `/api/v1/subscriptions/${encodeURIComponent(subscription.id)}/analysis`,
              {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  commandId: crypto.randomUUID(),
                  settings: { ...subscription.settings, enabled },
                }),
              },
            );
            if (!response.ok)
              throw new Error(`Could not save (HTTP ${response.status})`);
            subscription.settings = (await response.json()).settings;
            $("subscriptionsMessage").textContent =
              `Saved ${subscription.title}.`;
          } catch (error) {
            toggle.checked = !enabled;
            $("subscriptionsMessage").textContent = error.message;
          } finally {
            toggle.disabled = false;
          }
        };
        label.append(toggle, document.createTextNode(subscription.title));
        container.append(label);
      }
      subscriptionsLoaded = true;
      $("subscriptionsMessage").textContent = subscriptions.length
        ? "Choices are saved immediately for this profile."
        : "Subscribe to podcasts in your library to enable automatic analysis.";
    } catch (error) {
      $("subscriptionsMessage").textContent = error.message;
    }
  }
  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      const [status, models, logs] = await Promise.all([
        api("status"),
        api("models"),
        api("logs"),
        window.PodcastDashboard.loadSettings(api),
        loadSubscriptions(),
      ]);
      $("error").textContent = "";
      $("health").textContent =
        `Classifier: ${status.provider} · Sample budget: ${status.sampleBudgetSeconds}s · ${models.ready ? "Whisper ready" : "Waiting for Whisper"}`;
      $("modelStatus").textContent =
        models.error || models.legacyCleanupWarning || models.stage;
      $("whisperStatus").textContent = models.ready
        ? `Whisper: verified — ${models.whisper?.filename || "configured model"}`
        : "Whisper: not ready";
      jevConfigured = status.jevConfigured;
      $("jevStatus").textContent = jevConfigured
        ? `Jev: configured through DigitalOcean · ${status.classifierModel} · run a transcript test to verify access`
        : "Jev: select jev and add your DigitalOcean model access key in Configuration to enable classification";
      $("classifierWarning").textContent = status.classifierWarning || "";
      $("submitTranscript").disabled = !jevConfigured || transcriptPending;
      $("models").textContent = JSON.stringify(models, null, 2);
      $("download").hidden = !models.busy;
      $("download").value = models.total
        ? (100 * models.received) / models.total
        : 0;
      $("prepare").disabled = models.busy;
      $("downloadWhisper").disabled = models.busy;
      jobs = status.jobs;
      if (!selected && jobs.length) selected = jobs[0].id;
      renderJobs();
      $("logs").textContent = logs.lines.join("\n") || "No log entries.";
      if (selected) await inspect(selected);
    } catch (e) {
      $("error").textContent = e.message;
    } finally {
      busy = false;
    }
  }
  $("refresh").onclick = () => {
    subscriptionsLoaded = false;
    void refresh();
  };
  $("jobSearch").oninput = renderJobs;
  $("prepare").onclick = action(async () => {
    await api("models/prepare", { method: "POST" });
    await refresh();
  });
  $("downloadWhisper").onclick = action(async () => {
    await api("models/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "whisper" }),
    });
    await refresh();
  });
  const field = (form, name) => form.elements.namedItem(name).value;
  $("episodeForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    $("submitEpisode").disabled = true;
    $("episodeMessage").textContent = "Submitting…";
    try {
      const key = `dashboard-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await api("jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestKey: key,
          episodeId: key,
          title: field(form, "title"),
          enclosureUrl: field(form, "enclosureUrl"),
        }),
      });
      selected = result.job.id;
      window.PodcastDashboard.showTab("episodes");
      $("episodeMessage").textContent =
        "Episode queued. Progress, timeline and transcripts appear in the Episodes tab.";
      await refresh();
    } catch (error) {
      $("episodeMessage").textContent = error.message;
    } finally {
      $("submitEpisode").disabled = false;
    }
  };
  function showTest(result) {
    $("testResponse").textContent = JSON.stringify(result, null, 2);
    $("testDecisions").replaceChildren();
    for (const assessment of result.assessments || []) {
      const card = document.createElement("article");
      card.className = "decision";
      const verdict = document.createElement("strong");
      verdict.textContent = `${assessment.verdict.replace("_", " ")} · ${Math.round(assessment.confidence * 100)}% classification confidence`;
      const explanation = document.createElement("p");
      explanation.textContent = assessment.reason;
      if (assessment.markerDecision)
        explanation.textContent += ` ${assessment.markerDecision.reason}`;
      card.append(verdict, explanation);
      if (assessment.probabilities) {
        const probabilities = document.createElement("p");
        probabilities.textContent = Object.entries(assessment.probabilities)
          .map(
            ([label, probability]) =>
              `${label.replace("_", " ")}: ${Math.round(probability * 100)}%`,
          )
          .join(" · ");
        card.append(probabilities);
      }
      $("testDecisions").append(card);
    }
  }
  $("transcriptForm").onsubmit = async (event) => {
    event.preventDefault();
    if (transcriptPending) return;
    const form = event.currentTarget;
    transcriptPending = true;
    $("submitTranscript").disabled = true;
    $("transcriptMessage").textContent = "Classifying with Jev…";
    $("testDecisions").replaceChildren();
    $("testResponse").textContent = "Waiting for Jev…";
    try {
      const result = await api("classify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fragments: [
            {
              startMs: Math.round(Number(field(form, "startSeconds")) * 1000),
              endMs: Math.round(Number(field(form, "endSeconds")) * 1000),
              text: field(form, "text"),
            },
          ],
          episodeDescription: field(form, "episodeDescription"),
        }),
      });
      showTest(result);
      $("transcriptMessage").textContent =
        `${result.elapsedMs}ms · ${result.usage.requests} API requests · ${result.usage.inputTokens ?? "unknown"} input tokens · ${result.segments.length} markers saved · Advert threshold ${Math.round(result.minimumAdvertConfidence * 100)}% · Promotion threshold ${Math.round(result.minimumPromotionConfidence * 100)}% · ${result.failedCount} failed excerpts`;
    } catch (error) {
      $("transcriptMessage").textContent = error.message;
      showTest(error.body || { error: error.message });
    } finally {
      transcriptPending = false;
      $("submitTranscript").disabled = !jevConfigured;
    }
  };
  void refresh();
  setInterval(() => {
    if (!document.hidden) void refresh();
  }, 5000);
})();
