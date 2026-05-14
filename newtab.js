const DEFAULT_LINKS = [];
const DEFAULT_DASHBOARD_LINKS = [
  {
    name: "Cloudflare Dashboard",
    url: "https://dash.cloudflare.com/"
  },
  {
    name: "Namecheap Dashboard",
    url: "https://ap.www.namecheap.com/"
  }
];

const DEFAULT_TIMER_SETTINGS = {
  workMinutes: 25,
  breakMinutes: 5
};

const DEFAULT_BACKGROUND_SETTINGS = {
  intervalMinutes: 5
};

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60_000;
const MAX_TIMER_ELAPSED_SECONDS = 24 * 60 * 60;

const BACKGROUND_SOURCES = [
  (seed) => `https://picsum.photos/seed/${seed}/1920/1080`,
  (seed) => `https://loremflickr.com/1920/1080/abstract?lock=${seed}`
];

const state = {
  links: [],
  dashboardLinks: [],
  notes: "",
  timerSettings: { ...DEFAULT_TIMER_SETTINGS },
  timerMode: "work",
  remainingSeconds: DEFAULT_TIMER_SETTINGS.workMinutes * 60,
  timerRunning: false,
  timerIntervalId: null,
  timerLastUpdated: null,
  backgroundSettings: { ...DEFAULT_BACKGROUND_SETTINGS },
  backgroundIntervalId: null
};

const elements = {
  backdrop: document.querySelector(".backdrop"),
  linkForm: document.getElementById("link-form"),
  linkName: document.getElementById("link-name"),
  linkUrl: document.getElementById("link-url"),
  linksList: document.getElementById("links-list"),
  dashboardForm: document.getElementById("dashboard-form"),
  dashboardName: document.getElementById("dashboard-name"),
  dashboardUrl: document.getElementById("dashboard-url"),
  dashboardList: document.getElementById("dashboard-list"),
  dashboardGrid: document.getElementById("dashboard-grid"),
  workMinutes: document.getElementById("work-minutes"),
  breakMinutes: document.getElementById("break-minutes"),
  saveTimerSettings: document.getElementById("save-timer-settings"),
  timerMode: document.getElementById("timer-mode"),
  timerDisplay: document.getElementById("timer-display"),
  timerStart: document.getElementById("timer-start"),
  timerPause: document.getElementById("timer-pause"),
  timerReset: document.getElementById("timer-reset"),
  backgroundInterval: document.getElementById("background-interval"),
  saveBackgroundSettings: document.getElementById("save-background-settings"),
  notes: document.getElementById("notes")
};

const extensionChrome = globalThis.chrome;
const storage = extensionChrome?.storage?.sync ?? extensionChrome?.storage?.local ?? null;

init().catch((error) => {
  console.error("Failed to initialize dashboard", error);
});

async function init() {
  const stored = await storageGet([
    "links",
    "dashboardLinks",
    "notes",
    "timerSettings",
    "timerState",
    "backgroundSettings"
  ]);

  state.links = Array.isArray(stored.links) && stored.links.length ? stored.links : DEFAULT_LINKS;
  state.dashboardLinks =
    Array.isArray(stored.dashboardLinks) && stored.dashboardLinks.length
      ? stored.dashboardLinks
      : DEFAULT_DASHBOARD_LINKS;
  state.notes = typeof stored.notes === "string" ? stored.notes : "";
  state.timerSettings = {
    ...DEFAULT_TIMER_SETTINGS,
    ...(stored.timerSettings || {})
  };
  state.backgroundSettings = {
    ...DEFAULT_BACKGROUND_SETTINGS,
    ...(stored.backgroundSettings || {})
  };
  state.backgroundSettings.intervalMinutes = normalizeBackgroundInterval(
    state.backgroundSettings.intervalMinutes
  );

  const timerSnapshot = resolveTimerState(stored.timerState);
  state.timerMode = timerSnapshot.timerMode;
  state.remainingSeconds = timerSnapshot.remainingSeconds;
  state.timerRunning = false;
  state.timerLastUpdated = null;

  await Promise.all([
    storageSet({ links: state.links }),
    storageSet({ dashboardLinks: state.dashboardLinks }),
    storageSet({ notes: state.notes }),
    storageSet({ timerSettings: state.timerSettings }),
    storageSet({ backgroundSettings: state.backgroundSettings }),
    storageSet({ timerState: getTimerStatePayload() })
  ]);

  bindEvents();
  renderLinks();
  renderDashboard();
  renderTimer();
  renderBackgroundSettings();
  elements.notes.value = state.notes;

  startBackgroundRotation();

  if (timerSnapshot.timerRunning) {
    startTimer({ force: true });
  }
}

function bindEvents() {
  elements.linkForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = elements.linkName.value.trim();
    const url = normalizeUrl(elements.linkUrl.value.trim());

    if (!name || !url) {
      return;
    }

    state.links.push({ name, url });
    await storageSet({ links: state.links });

    elements.linkForm.reset();
    renderLinks();
  });

  elements.linksList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-index]");
    if (!button) {
      return;
    }

    const index = Number(button.dataset.index);
    if (!Number.isInteger(index)) {
      return;
    }

    state.links.splice(index, 1);
    await storageSet({ links: state.links });
    renderLinks();
  });

  elements.dashboardForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = elements.dashboardName.value.trim();
    const url = normalizeUrl(elements.dashboardUrl.value.trim());

    if (!name || !url) {
      return;
    }

    state.dashboardLinks.push({ name, url });
    await storageSet({ dashboardLinks: state.dashboardLinks });

    elements.dashboardForm.reset();
    renderDashboard();
  });

  elements.dashboardList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-index]");
    if (!button) {
      return;
    }

    const index = Number(button.dataset.index);
    if (!Number.isInteger(index)) {
      return;
    }

    state.dashboardLinks.splice(index, 1);
    await storageSet({ dashboardLinks: state.dashboardLinks });
    renderDashboard();
  });

  elements.saveTimerSettings.addEventListener("click", async () => {
    const workMinutes = clampNumber(elements.workMinutes.value, 1, 180, DEFAULT_TIMER_SETTINGS.workMinutes);
    const breakMinutes = clampNumber(elements.breakMinutes.value, 1, 60, DEFAULT_TIMER_SETTINGS.breakMinutes);
    state.timerSettings = { workMinutes, breakMinutes };
    state.timerMode = "work";
    state.remainingSeconds = workMinutes * 60;
    stopTimer();
    await storageSet({ timerSettings: state.timerSettings });
    persistTimerState();
    renderTimer();
  });

  elements.timerStart.addEventListener("click", startTimer);
  elements.timerPause.addEventListener("click", stopTimer);
  elements.timerReset.addEventListener("click", () => {
    stopTimer();
    state.timerMode = "work";
    state.remainingSeconds = state.timerSettings.workMinutes * 60;
    renderTimer();
    persistTimerState();
  });

  elements.saveBackgroundSettings.addEventListener("click", async () => {
    const intervalMinutes = normalizeBackgroundInterval(elements.backgroundInterval.value);
    state.backgroundSettings = { intervalMinutes };
    await storageSet({ backgroundSettings: state.backgroundSettings });
    renderBackgroundSettings();
    startBackgroundRotation();
  });

  let notesSaveTimeoutId;
  elements.notes.addEventListener("input", () => {
    clearTimeout(notesSaveTimeoutId);
    notesSaveTimeoutId = setTimeout(async () => {
      state.notes = elements.notes.value;
      await storageSet({ notes: state.notes });
    }, 300);
  });
}

function renderLinks() {
  elements.linksList.innerHTML = "";

  state.links.forEach((link, index) => {
    const item = document.createElement("li");
    const anchor = document.createElement("a");
    anchor.href = link.url;
    anchor.textContent = link.name;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.dataset.index = String(index);
    removeButton.textContent = "Remove";

    item.append(anchor, removeButton);
    elements.linksList.appendChild(item);
  });
}

function renderDashboard() {
  elements.dashboardList.innerHTML = "";
  elements.dashboardGrid.innerHTML = "";

  state.dashboardLinks.forEach((link, index) => {
    const item = document.createElement("li");
    const anchor = document.createElement("a");
    anchor.href = link.url;
    anchor.textContent = link.name;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.dataset.index = String(index);
    removeButton.textContent = "Remove";

    item.append(anchor, removeButton);
    elements.dashboardList.appendChild(item);

    const card = document.createElement("a");
    card.href = link.url;
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    card.textContent = link.name;
    elements.dashboardGrid.appendChild(card);
  });
}

function renderTimer() {
  elements.workMinutes.value = state.timerSettings.workMinutes;
  elements.breakMinutes.value = state.timerSettings.breakMinutes;
  elements.timerMode.textContent = state.timerMode === "work" ? "Work" : "Break";
  elements.timerDisplay.textContent = formatTime(state.remainingSeconds);
}

function renderBackgroundSettings() {
  elements.backgroundInterval.value = state.backgroundSettings.intervalMinutes;
}

function startTimer({ force = false } = {}) {
  if (state.timerRunning && !force) {
    return;
  }

  if (state.timerIntervalId) {
    window.clearInterval(state.timerIntervalId);
  }

  state.timerRunning = true;
  state.timerLastUpdated = Date.now();
  persistTimerState();

  state.timerIntervalId = window.setInterval(() => {
    state.remainingSeconds -= 1;
    if (state.remainingSeconds <= 0) {
      state.timerMode = state.timerMode === "work" ? "break" : "work";
      state.remainingSeconds =
        state.timerMode === "work"
          ? state.timerSettings.workMinutes * 60
          : state.timerSettings.breakMinutes * 60;
    }

    renderTimer();
  }, MS_PER_SECOND);
}

function stopTimer() {
  if (state.timerIntervalId) {
    window.clearInterval(state.timerIntervalId);
  }
  state.timerRunning = false;
  state.timerIntervalId = null;
  state.timerLastUpdated = null;
  persistTimerState();
}

function startBackgroundRotation() {
  if (state.backgroundIntervalId) {
    window.clearInterval(state.backgroundIntervalId);
  }

  const loadBackground = async () => {
    const seed = Date.now();
    for (const source of BACKGROUND_SOURCES) {
      const imageUrl = source(seed);
      try {
        await preloadImage(imageUrl);
        setBackdropImage(imageUrl);
        return;
      } catch (error) {
        console.warn("Could not load background image", error);
      }
    }

    setBackdropImage();
  };

  loadBackground();
  state.backgroundIntervalId = window.setInterval(
    loadBackground,
    state.backgroundSettings.intervalMinutes * MS_PER_MINUTE
  );
}

function setBackdropImage(imageUrl) {
  const gradient = "linear-gradient(140deg, rgba(8, 8, 8, 0.9), rgba(16, 16, 18, 0.76))";
  elements.backdrop.style.backgroundImage = imageUrl ? `${gradient}, url('${imageUrl}')` : gradient;
}

function preloadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = reject;
    image.src = url;
  });
}

function normalizeUrl(url) {
  if (!url) {
    return "";
  }

  try {
    return new URL(url).toString();
  } catch (_error) {
    return "";
  }
}

function clampNumber(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (Number.isNaN(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, number));
}

function normalizeBackgroundInterval(value) {
  return clampNumber(value, 1, 120, DEFAULT_BACKGROUND_SETTINGS.intervalMinutes);
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function resolveTimerState(storedTimerState) {
  const fallback = {
    timerMode: "work",
    remainingSeconds: state.timerSettings.workMinutes * 60,
    timerRunning: false
  };

  if (!storedTimerState || typeof storedTimerState !== "object") {
    return fallback;
  }

  const timerMode = storedTimerState.timerMode === "break" ? "break" : "work";
  const remainingSeconds = Number.isFinite(storedTimerState.remainingSeconds)
    ? storedTimerState.remainingSeconds
    : fallback.remainingSeconds;
  const timerRunning = Boolean(storedTimerState.timerRunning);
  const lastUpdated = Number.isFinite(storedTimerState.lastUpdated)
    ? storedTimerState.lastUpdated
    : null;

  if (!timerRunning || !lastUpdated) {
    return {
      timerMode,
      remainingSeconds,
      timerRunning: false
    };
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - lastUpdated) / MS_PER_SECOND));
  if (elapsedSeconds > MAX_TIMER_ELAPSED_SECONDS) {
    return {
      timerMode: "work",
      remainingSeconds: state.timerSettings.workMinutes * 60,
      timerRunning: false
    };
  }

  const adjusted = applyElapsedTimer(timerMode, remainingSeconds, elapsedSeconds);
  return {
    ...adjusted,
    timerRunning: true
  };
}

function applyElapsedTimer(timerMode, remainingSeconds, elapsedSeconds) {
  // Convert remainingSeconds into elapsedFromSegmentStart (segmentSeconds - remaining),
  // add elapsedSeconds, and wrap within the work+break cycle to determine mode/remaining.
  // If cycleSeconds is invalid, fall back to a work segment.
  const workSeconds = state.timerSettings.workMinutes * 60;
  const breakSeconds = state.timerSettings.breakMinutes * 60;
  const cycleSeconds = workSeconds + breakSeconds;

  if (cycleSeconds <= 0) {
    return {
      timerMode: "work",
      remainingSeconds: workSeconds
    };
  }

  const segmentSeconds = timerMode === "work" ? workSeconds : breakSeconds;
  const safeRemaining = Math.min(Math.max(remainingSeconds, 0), segmentSeconds);
  const elapsedFromSegmentStart = segmentSeconds - safeRemaining;
  const cycleElapsed =
    (timerMode === "work" ? elapsedFromSegmentStart : workSeconds + elapsedFromSegmentStart) + elapsedSeconds;
  const normalizedElapsed = cycleElapsed % cycleSeconds;

  if (normalizedElapsed < workSeconds) {
    return {
      timerMode: "work",
      remainingSeconds: workSeconds - normalizedElapsed
    };
  }

  return {
    timerMode: "break",
    remainingSeconds: cycleSeconds - normalizedElapsed
  };
}

function getTimerStatePayload() {
  return {
    timerMode: state.timerMode,
    remainingSeconds: state.remainingSeconds,
    timerRunning: state.timerRunning,
    lastUpdated: state.timerLastUpdated
  };
}

async function saveTimerState() {
  await storageSet({ timerState: getTimerStatePayload() });
}

function persistTimerState() {
  saveTimerState().catch((error) => {
    console.warn("Failed to save timer state", error);
  });
}

function storageGet(keys) {
  if (!storage) {
    return Promise.resolve({});
  }

  return new Promise((resolve, reject) => {
    storage.get(keys, (result) => {
      if (extensionChrome?.runtime?.lastError) {
        reject(extensionChrome.runtime.lastError);
        return;
      }
      resolve(result);
    });
  });
}

function storageSet(payload) {
  if (!storage) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    storage.set(payload, () => {
      if (extensionChrome?.runtime?.lastError) {
        reject(extensionChrome.runtime.lastError);
        return;
      }
      resolve();
    });
  });
}
