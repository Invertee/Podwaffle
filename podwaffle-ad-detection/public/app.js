"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  let selected = null,
    busy = false;
  // Relative paths keep the management UI working behind Home Assistant ingress.
  async function api(route, options) {
    const response = await fetch(`api/podcasts/${route}`, options);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }
  async function inspect(id) {
    selected = id;
    const data = await api(`jobs/${encodeURIComponent(id)}`);
    $("detailTitle").textContent = `Job inspector — ${data.job.request.title}`;
    $("details").textContent = JSON.stringify(data, null, 2);
  }
  const action = (task) => async () => {
    try {
      await task();
    } catch (e) {
      $("error").textContent = e.message;
    }
  };
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
      $("modelStatus").textContent = models.error || models.stage;
      $("models").textContent = JSON.stringify(models, null, 2);
      $("download").hidden = !models.busy;
      $("download").value = models.total
        ? (100 * models.received) / models.total
        : 0;
      $("prepare").disabled = models.busy;
      $("jobs").replaceChildren();
      for (const job of status.jobs) {
        const row = document.createElement("tr");
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
        button.onclick = action(() => inspect(job.id));
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
      if (!status.jobs.length) {
        const row = document.createElement("tr"),
          cell = document.createElement("td");
        cell.colSpan = 7;
        cell.textContent =
          "No analysis jobs yet. Enable analysis or test an episode in Podwaffle.";
        row.append(cell);
        $("jobs").append(row);
      }
      $("logs").textContent = logs.lines.join("\n") || "No log entries.";
      if (selected) await inspect(selected);
    } catch (e) {
      $("error").textContent = e.message;
    } finally {
      busy = false;
    }
  }
  $("refresh").onclick = refresh;
  $("prepare").onclick = action(async () => {
    await api("models/prepare", { method: "POST" });
    await refresh();
  });
  void refresh();
  setInterval(() => {
    if (!document.hidden) void refresh();
  }, 5000);
})();
