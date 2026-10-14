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
    const response = await fetch(`api/podcasts/${route}`, options);
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
    history.replaceState(null, "", `#${new URLSearchParams({ job: id })}`);
    for (const row of $("jobs").children)
      row.classList.toggle("selected-job", row.dataset.jobId === id);
    const data = await api(`jobs/${encodeURIComponent(id)}`);
    if (selected === id && request === inspectionRequest)
      window.PodcastInspector.render(data);
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
  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      const [status, models, logs] = await Promise.all([
        api("status"),
        api("models"),
        api("logs"),
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
  $("refresh").onclick = refresh;
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
  const settings = (form) => ({
    llmPrompt: field(form, "llmPrompt"),
    sensitivity: field(form, "sensitivity"),
  });
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
          phrases: field(form, "phrases")
            .split("\n")
            .map((p) => p.trim())
            .filter(Boolean),
          edgeFocusMinutes: Number(field(form, "edgeFocusMinutes")),
          ...settings(form),
        }),
      });
      selected = result.job.id;
      $("episodeMessage").textContent =
        "Episode queued. Progress, timeline and transcripts appear in the episode explorer above.";
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
          ...settings(form),
        }),
      });
      showTest(result);
      $("transcriptMessage").textContent =
        `${result.elapsedMs}ms · ${result.usage.requests} API requests · ${result.usage.inputTokens ?? "unknown"} input tokens · ${result.segments.length} markers above the ${Math.round(result.minimumAdvertConfidence * 100)}% threshold · ${result.failedCount} failed excerpts`;
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
