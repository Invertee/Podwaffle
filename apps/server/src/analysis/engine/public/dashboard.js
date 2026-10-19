"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const tabs = [...document.querySelectorAll("[data-tab]")];
  const form = $("detectionForm");
  const field = (name) => form.elements.namedItem(name);
  const percentageFields = [
    "advertConfidence",
    "promotionConfidence",
    "minimumLabelProbability",
  ];
  let saved,
    defaults,
    activeTab,
    loading = false,
    saving = false;
  const audioPresets = {
    low: [-40, 0.8],
    balanced: [-35, 0.6],
    high: [-30, 0.35],
  };
  function setHash(key, value) {
    const params = new URLSearchParams(location.hash.slice(1));
    params.set(key, value);
    history.replaceState(null, "", `#${params}`);
  }
  function showTab(name, focus = false) {
    if (!tabs.some((tab) => tab.dataset.tab === name)) name = "episodes";
    const changedTab = activeTab !== undefined && activeTab !== name;
    for (const tab of tabs) {
      const active = tab.dataset.tab === name;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      $(tab.getAttribute("aria-controls")).hidden = !active;
      if (active && focus) tab.focus();
    }
    activeTab = name;
    if (changedTab) tabs[0].parentElement.scrollIntoView({ block: "start" });
    setHash("tab", name);
  }
  for (const [index, tab] of tabs.entries()) {
    tab.onclick = () => showTab(tab.dataset.tab);
    tab.onkeydown = (event) => {
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft")
        next = (index + tabs.length - 1) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next !== undefined) {
        event.preventDefault();
        showTab(tabs[next].dataset.tab, true);
      }
    };
  }
  showTab(new URLSearchParams(location.hash.slice(1)).get("tab") || "episodes");

  function updatePreview() {
    const audioMode = field("audioSensitivity").value;
    for (const output of form.querySelectorAll("output[data-value]")) {
      const name = output.dataset.value;
      const unit = percentageFields.includes(name)
        ? "%"
        : name === "silenceThresholdDb"
          ? " dB"
          : "s";
      output.value = `${field(name).value}${unit}`;
      field(name).setAttribute("aria-valuetext", output.value);
    }
    const audio = `${field("silenceThresholdDb").value} dB, pauses ≥ ${field("minimumSilenceSeconds").value}s (${audioMode})`;
    const jev = `adverts ≥ ${field("advertConfidence").value}%, promotions ≥ ${field("promotionConfidence").value}% confidence`;
    $("settingsPreview").textContent =
      `Preview · Audio: ${audio}. Excerpts: ${field("minimumExcerptSeconds").value}–${field("maximumExcerptSeconds").value}s. Jev: ${jev}. Label probability ≥ ${field("minimumLabelProbability").value}%. Promotions ${field("includePromotions").checked ? "enabled" : "disabled"}.`;
  }
  function fill(settings) {
    for (const [name, value] of Object.entries(settings)) {
      if (name === "includePromotions") field(name).checked = value;
      else if (name === "phrases") field(name).value = value.join("\n");
      else
        field(name).value = percentageFields.includes(name)
          ? Math.round(value * 10000) / 100
          : value;
    }
    const audio = audioPresets[settings.audioSensitivity];
    if (audio) {
      field("silenceThresholdDb").value = audio[0];
      field("minimumSilenceSeconds").value = audio[1];
    }
    const confidence = { low: 75, balanced: 55, high: 35 }[
      settings.jevSensitivity
    ];
    if (confidence !== undefined) {
      field("advertConfidence").value = confidence;
      field("promotionConfidence").value = confidence;
    }
    field("jevSensitivity").value = "custom";
    updatePreview();
  }
  function readSettings() {
    return Object.fromEntries(
      Object.keys(defaults).map((name) => [
        name,
        name === "includePromotions"
          ? field(name).checked
          : name === "phrases"
            ? field(name)
                .value.split("\n")
                .map((phrase) => phrase.trim())
                .filter(Boolean)
            : ["audioSensitivity", "jevSensitivity", "llmPrompt"].includes(name)
              ? field(name).value
              : Number(field(name).value) /
                (percentageFields.includes(name) ? 100 : 1),
      ]),
    );
  }
  function changed(event) {
    const name = event?.target?.name;
    if (name === "audioSensitivity" && audioPresets[field(name).value]) {
      const [threshold, pause] = audioPresets[field(name).value];
      field("silenceThresholdDb").value = threshold;
      field("minimumSilenceSeconds").value = pause;
    }
    if (["silenceThresholdDb", "minimumSilenceSeconds"].includes(name))
      field("audioSensitivity").value = "custom";
    if (
      Number(field("minimumExcerptSeconds").value) >
      Number(field("maximumExcerptSeconds").value)
    ) {
      const other =
        name === "maximumExcerptSeconds"
          ? "minimumExcerptSeconds"
          : "maximumExcerptSeconds";
      field(other).value = field(name).value;
    }
    updatePreview();
    $("settingsMessage").textContent =
      "Unsaved changes. Save to apply them to new jobs and transcript tests.";
  }
  form.oninput = changed;
  form.onchange = changed;
  form.onsubmit = (event) => event.preventDefault();
  $("revertDetection").onclick = () => {
    fill(saved);
    $("settingsMessage").textContent = "Showing the last saved settings.";
  };
  $("defaultDetection").onclick = () => {
    fill(defaults);
    changed();
  };
  window.PodcastDashboard = {
    showTab,
    setJob: (id) => setHash("job", id),
    async loadSettings(api) {
      if (saved || loading) return;
      loading = true;
      try {
        const result = await api("settings");
        saved = result.settings;
        defaults = result.defaults;
        fill(saved);
        for (const id of [
          "saveDetection",
          "revertDetection",
          "defaultDetection",
        ])
          $(id).disabled = false;
        $("settingsMessage").textContent =
          "Saved on this Podwaffle server. Settings survive restarts.";
        form.onsubmit = async (event) => {
          event.preventDefault();
          if (saving) return;
          const settings = readSettings();
          saving = true;
          for (const group of form.querySelectorAll("fieldset"))
            group.disabled = true;
          for (const id of [
            "saveDetection",
            "revertDetection",
            "defaultDetection",
          ])
            $(id).disabled = true;
          $("settingsMessage").textContent = "Saving…";
          try {
            const result = await api("settings", {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ settings }),
            });
            saved = result.settings;
            defaults = result.defaults;
            fill(saved);
            $("settingsMessage").textContent =
              "Saved. New jobs and transcript tests will use these settings; existing jobs keep theirs.";
          } catch (error) {
            $("settingsMessage").textContent =
              `Could not save: ${error.message}. Your edits are still here.`;
          } finally {
            saving = false;
            for (const group of form.querySelectorAll("fieldset"))
              group.disabled = false;
            for (const id of [
              "saveDetection",
              "revertDetection",
              "defaultDetection",
            ])
              $(id).disabled = false;
            updatePreview();
          }
        };
      } catch (error) {
        $("settingsMessage").textContent =
          `Could not load detection settings: ${error.message}. Refresh to retry.`;
      } finally {
        loading = false;
      }
    },
  };
})();
