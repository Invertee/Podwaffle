"use strict";
(() => {
  const { buildInspection, filterRows, formatTime, overlaps } =
    window.PodcastInspection;
  const $ = (id) => document.getElementById(id);
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const labels = {
    advertisement: "Advert",
    promotion: "Promotion",
    not_ad: "Not an ad",
    uncertain: "Uncertain",
    failed: "Request failed",
    unclassified: "Unclassified",
  };
  const rangeText = (range) =>
    `${formatTime(range.startMs)} – ${formatTime(range.endMs)}`;
  const percent = (value) => `${Math.round(value * 100)}%`;
  let data,
    model,
    selectedRow = null,
    selectedMarker = null,
    position = 0,
    snapshot;
  let visibleRows = [];

  function selectRow(row) {
    selectedRow = row;
    selectedMarker = null;
    position = row.startMs;
    renderSelection();
  }
  function selectMarker(marker) {
    selectedRow = model.rows.find((row) => overlaps(row, marker)) || null;
    selectedMarker = marker;
    position = marker.startMs;
    renderSelection();
  }
  function selectTime(ms) {
    position = ms;
    selectedRow =
      model.rows.find((row) => row.startMs <= ms && row.endMs > ms) || null;
    selectedMarker = null;
    renderSelection();
  }
  function renderTimeline() {
    const focusedLabel = $("timeline").contains(document.activeElement)
      ? document.activeElement.getAttribute("aria-label")
      : null;
    const zoom = Number($("timelineZoom").value) || model.durationMs;
    const span = Math.min(zoom, model.durationMs) || 1;
    const startMs = Math.max(
      0,
      Math.min(position - span / 2, model.durationMs - span),
    );
    const endMs = startMs + span;
    const timeline = $("timeline");
    timeline.replaceChildren();
    function lane(label, ranges, kind, onSelect) {
      const container = element("div", undefined, "timeline-lane");
      container.append(element("span", label, "lane-label"));
      const track = element("div", undefined, "timeline-track");
      track.onclick = (event) => {
        const rect = track.getBoundingClientRect();
        selectTime(
          Math.round(
            startMs +
              Math.max(
                0,
                Math.min(1, (event.clientX - rect.left) / rect.width),
              ) *
                span,
          ),
        );
      };
      for (const range of ranges) {
        if (range.endMs <= startMs || range.startMs >= endMs) continue;
        const state = typeof kind === "function" ? kind(range) : kind;
        const bar = element(
          onSelect ? "button" : "span",
          undefined,
          `timeline-range range-${state}`,
        );
        bar.style.left = `${(100 * (Math.max(startMs, range.startMs) - startMs)) / span}%`;
        bar.style.width = `${(100 * (Math.min(endMs, range.endMs) - Math.max(startMs, range.startMs))) / span}%`;
        bar.title = `${rangeText(range)} · ${labels[state] || label}${range.belowThreshold ? " · Below threshold" : ""}`;
        if (range.belowThreshold) bar.classList.add("below-threshold");
        if (onSelect) {
          bar.type = "button";
          bar.setAttribute("aria-label", bar.title);
          const active = range === selectedRow || range === selectedMarker;
          bar.setAttribute("aria-pressed", String(active));
          bar.onclick = (event) => {
            event.stopPropagation();
            onSelect(range);
          };
        }
        track.append(bar);
      }
      if (position >= startMs && position <= endMs) {
        const cursor = element("span", undefined, "timeline-cursor");
        cursor.style.left = `${(100 * (position - startMs)) / span}%`;
        track.append(cursor);
      }
      container.append(track);
      timeline.append(container);
    }
    lane("Sampled audio", model.coverage, "sample");
    lane("Excerpt decisions", model.rows, (row) => row.state, selectRow);
    lane(
      "Saved ad markers",
      model.markers,
      (marker) => marker.kind,
      selectMarker,
    );
    if (focusedLabel) {
      const button = [...timeline.querySelectorAll("button")].find(
        (node) => node.getAttribute("aria-label") === focusedLabel,
      );
      button?.focus({ preventScroll: true });
    }
    $("timelineTicks").replaceChildren(
      ...Array.from({ length: 5 }, (_, index) =>
        element("span", formatTime(startMs + (span * index) / 4)),
      ),
    );
    $("timeCursor").max = String(model.durationMs);
    $("timeCursor").value = String(position);
    $("timeCursor").setAttribute("aria-valuetext", formatTime(position));
    $("positionLabel").textContent =
      `${formatTime(position)} / ${formatTime(model.durationMs)}`;
  }
  function renderList() {
    visibleRows = filterRows(
      model.rows,
      $("excerptSearch").value,
      $("excerptFilter").value,
    );
    $("excerptCount").textContent =
      `${visibleRows.length} of ${model.rows.length} excerpts · Dashed ranges are Jev candidates below the saved-marker threshold.`;
    const scrollTop = $("excerptList").scrollTop;
    $("excerptList").replaceChildren(
      ...visibleRows.map((row) => {
        const button = element(
          "button",
          undefined,
          `excerpt-item state-${row.state}`,
        );
        button.type = "button";
        button.dataset.rowId = String(row.id);
        button.setAttribute("aria-pressed", String(row === selectedRow));
        button.append(
          element("span", rangeText(row), "excerpt-time"),
          element("strong", labels[row.state] || row.verdict),
          element("span", row.text, "excerpt-preview"),
        );
        button.onclick = () => selectRow(row);
        return button;
      }),
    );
    if (!visibleRows.length)
      $("excerptList").append(
        element(
          "p",
          model.rows.length
            ? "No excerpts match these filters."
            : "No transcript excerpts available.",
          "muted",
        ),
      );
    $("excerptList").scrollTop = scrollTop;
    updateNavigation();
  }
  function updateNavigation() {
    const index = visibleRows.indexOf(selectedRow);
    $("previousExcerpt").disabled = index <= 0;
    $("nextExcerpt").disabled =
      !visibleRows.length || index >= visibleRows.length - 1;
  }
  function renderSelection() {
    renderTimeline();
    for (const button of $("excerptList").querySelectorAll("[data-row-id]"))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.rowId === String(selectedRow?.id)),
      );
    updateNavigation();
    const row = selectedRow,
      assessment = row?.assessment;
    $("excerptTitle").textContent = row
      ? rangeText(row)
      : `Position ${formatTime(position)}`;
    $("excerptVerdict").className =
      `verdict state-${row?.state || selectedMarker?.kind || "unclassified"}`;
    $("excerptVerdict").textContent = row
      ? `${labels[row.state] || row.verdict}${assessment && row.state !== "failed" ? ` · ${percent(assessment.confidence)} classification confidence` : ""}${row.belowThreshold ? " · Below threshold" : ""}`
      : selectedMarker
        ? `${labels[selectedMarker.kind]} · ${rangeText(selectedMarker)}`
        : "No transcript at this position";
    $("excerptText").textContent =
      row?.text ||
      (data.job.result.transcriptExpired
        ? "This episode’s transcript has expired after seven days."
        : "This position has no retained speech excerpt. Unsampled audio has not been classified.");
    const markerNotes = (selectedMarker ? [selectedMarker] : row?.markers || [])
      .map((m) =>
        m.source === "jev" && m.evidence === assessment?.reason
          ? `Saved Jev marker: ${rangeText(m)}.`
          : `${m.source}: ${m.evidence || m.title}`,
      )
      .join("\n");
    $("excerptReason").textContent =
      [
        assessment?.reason,
        row?.belowThreshold
          ? `Jev selected a candidate below this job’s ${percent(model.threshold)} threshold; no Jev marker was saved for it.`
          : "",
        markerNotes,
      ]
        .filter(Boolean)
        .join("\n") || "No classifier decision is available for this position.";
    $("excerptProbabilities").replaceChildren();
    for (const [label, probability] of Object.entries(
      assessment?.probabilities || {},
    )) {
      const line = element("div", undefined, "probability");
      const meter = element("meter");
      meter.min = 0;
      meter.max = 1;
      meter.value = probability;
      meter.setAttribute("aria-label", `${labels[label] || label} probability`);
      line.append(
        element("span", labels[label] || label),
        meter,
        element("span", percent(probability)),
      );
      $("excerptProbabilities").append(line);
    }
    const responseMeta = [];
    if (assessment?.response?.model)
      responseMeta.push(assessment.response.model);
    if (assessment?.elapsedMs !== undefined)
      responseMeta.push(`${assessment.elapsedMs} ms`);
    if (assessment?.requestCount !== undefined)
      responseMeta.push(
        `${assessment.requestCount} API request${assessment.requestCount === 1 ? "" : "s"}`,
      );
    if (assessment?.status === "skipped")
      responseMeta.push("Skipped after an earlier provider failure");
    $("excerptResponseMeta").textContent = responseMeta.join(" · ");
    $("excerptResponse").textContent = assessment?.response
      ? JSON.stringify(assessment.response, null, 2)
      : assessment?.error
        ? JSON.stringify(assessment.error, null, 2)
        : row?.state === "failed"
          ? `No valid classification response.\n${assessment.reason}`
          : assessment
            ? `This older result retained a decision and probabilities but no response fields.\n${JSON.stringify(assessment, null, 2)}`
            : "No Jev response was recorded for this excerpt.";
  }
  window.PodcastInspector = {
    render(next) {
      const serialized = JSON.stringify(next);
      if (serialized === snapshot) return;
      const changedJob = data?.job.id !== next.job.id;
      const previousRowId = selectedRow?.id;
      data = next;
      snapshot = serialized;
      if (changedJob) {
        $("excerptSearch").value = "";
        $("excerptFilter").value = "all";
        $("timelineZoom").value = "0";
        selectedRow = null;
        selectedMarker = null;
        position = 0;
      }
      $("detailTitle").textContent = next.job.request.title;
      $("jobMeta").textContent = [
        next.job.request.podcastTitle,
        next.job.status,
        next.job.stage !== next.job.status ? next.job.stage : null,
        `${next.job.progress}%`,
        new Date(next.job.createdAt).toLocaleString(),
      ]
        .filter(Boolean)
        .join(" · ");
      $("details").textContent = JSON.stringify(next, null, 2);
      const result = next.job.result;
      $("inspectionContent").hidden = !result;
      $("inspectionNotice").textContent = result?.transcriptExpired
        ? "Transcript and Jev responses have expired. Saved ad markers and sampled coverage are still available."
        : result
          ? ""
          : next.job.error ||
            "The timeline and excerpts will appear here when analysis completes. Progress updates automatically.";
      if (!result) return;
      model = buildInspection(result);
      if (changedJob) {
        selectedRow =
          model.rows.find((row) => row.suspected) || model.rows[0] || null;
        position = selectedRow?.startMs || 0;
        selectedMarker = null;
      } else {
        selectedRow =
          model.rows.find((row) => row.id === previousRowId) ||
          (!model.rows.length ? null : selectedRow ? model.rows[0] : null);
        if (previousRowId === undefined && position === 0 && !selectedRow) {
          selectedRow =
            model.rows.find((row) => row.suspected) || model.rows[0] || null;
          position = selectedRow?.startMs || 0;
        }
      }
      const stats = [
        ["Episode length", formatTime(model.durationMs)],
        [
          "Sampled audio",
          `${formatTime(model.sampledMs)} · ${percent(model.sampledMs / (model.durationMs || 1))}`,
        ],
        [
          "Suspected ad markers",
          `${model.markers.length} · ${formatTime(model.advertMs)}`,
        ],
        ["Jev marker threshold", percent(model.threshold)],
      ];
      $("inspectionStats").replaceChildren(
        ...stats.map(([label, value]) => {
          const card = element("div");
          card.append(element("span", label), element("strong", value));
          return card;
        }),
      );
      $("inspectionWarnings").replaceChildren(
        ...(result.diagnostics?.warnings || []).map((warning) =>
          element("li", warning),
        ),
      );
      $("markerSummary").textContent = model.markers.length
        ? "Saved advert and promotion ranges · Boundaries are approximate"
        : "No advert or promotion markers saved. Review uncertain decisions and unsampled gaps below.";
      $("markerList").replaceChildren(
        ...model.markers.map((marker) => {
          const button = element(
            "button",
            `${rangeText(marker)} · ${labels[marker.kind]} · ${percent(marker.confidence)} · ${marker.source}`,
            `marker-chip state-${marker.kind}`,
          );
          button.type = "button";
          button.onclick = () => selectMarker(marker);
          return button;
        }),
      );
      renderList();
      renderSelection();
    },
  };
  $("excerptSearch").oninput = renderList;
  $("excerptFilter").onchange = renderList;
  $("timelineZoom").onchange = renderTimeline;
  $("timeCursor").oninput = (event) => selectTime(Number(event.target.value));
  $("previousExcerpt").onclick = () => {
    const index = visibleRows.indexOf(selectedRow);
    if (index > 0) selectRow(visibleRows[index - 1]);
  };
  $("nextExcerpt").onclick = () => {
    const index = visibleRows.indexOf(selectedRow);
    if (index < visibleRows.length - 1) selectRow(visibleRows[index + 1]);
  };
})();
