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
    const jevMode = field("jevSensitivity").value;
    $("customAudio").hidden = audioMode !== "custom";
    $("customJev").hidden = jevMode !== "custom";
    for (const name of ["silenceThresholdDb", "minimumSilenceSeconds"])
      field(name).disabled = saving || audioMode !== "custom";
    for (const name of ["advertConfidence", "promotionConfidence"])
      field(name).disabled = saving || jevMode !== "custom";
    const audio =
      audioMode === "episode"
        ? "follows episode sensitivity"
        : audioMode === "custom"
          ? `${field("silenceThresholdDb").value} dB, pauses of ${field("minimumSilenceSeconds").value}s or longer`
          : `${audioMode} pause detection`;
    const confidence = { low: 75, balanced: 55, high: 35 }[jevMode];
    const jev =
      jevMode === "episode"
        ? "follows episode sensitivity (75% / 55% / 35%)"
        : jevMode === "custom"
          ? `adverts ≥ ${field("advertConfidence").value}%, promotions ≥ ${field("promotionConfidence").value}% confidence`
          : `≥ ${confidence}% confidence`;
    $("settingsPreview").textContent =
      `Preview · Audio: ${audio}. Jev: ${jev}. Label probability ≥ ${field("minimumLabelProbability").value}%. Promotions ${field("includePromotions").checked ? "enabled" : "disabled"}.`;
  }
  function fill(settings) {
    for (const [name, value] of Object.entries(settings)) {
      if (name === "includePromotions") field(name).checked = value;
      else
        field(name).value = percentageFields.includes(name)
          ? Math.round(value * 10000) / 100
          : value;
    }
    updatePreview();
  }
  function readSettings() {
    return Object.fromEntries(
      Object.keys(defaults).map((name) => [
        name,
        name === "includePromotions"
          ? field(name).checked
          : ["audioSensitivity", "jevSensitivity"].includes(name)
            ? field(name).value
            : Number(field(name).value) /
              (percentageFields.includes(name) ? 100 : 1),
      ]),
    );
  }
  function changed() {
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
