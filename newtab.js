const DEFAULT_LINKS = [
  {
    name: "Cloudflare Dashboard",
    url: "https://dash.cloudflare.com/a2f0d6a9abee5b24237fba38245477cb/home/overview"
  },
  {
    name: "Admin Login",
    url: "http://192.168.0.196/admin/login"
  },
  {
    name: "Xenonowledge",
    url: "https://xenonowledge.lovable.app/"
  }
];

const DEFAULT_TIMER_SETTINGS = {
  workMinutes: 25,
  breakMinutes: 5
};

const BACKGROUND_INTERVAL_MS = 60_000;

const state = {
  links: [],
  notes: "",
  timerSettings: { ...DEFAULT_TIMER_SETTINGS },
  timerMode: "work",
  remainingSeconds: DEFAULT_TIMER_SETTINGS.workMinutes * 60,
  timerRunning: false,
  timerIntervalId: null
};

const elements = {
  backdrop: document.querySelector(".backdrop"),
  linkForm: document.getElementById("link-form"),
  linkName: document.getElementById("link-name"),
  linkUrl: document.getElementById("link-url"),
  linksList: document.getElementById("links-list"),
  dashboardGrid: document.getElementById("dashboard-grid"),
  workMinutes: document.getElementById("work-minutes"),
  breakMinutes: document.getElementById("break-minutes"),
  saveTimerSettings: document.getElementById("save-timer-settings"),
  timerMode: document.getElementById("timer-mode"),
  timerDisplay: document.getElementById("timer-display"),
  timerStart: document.getElementById("timer-start"),
  timerPause: document.getElementById("timer-pause"),
  timerReset: document.getElementById("timer-reset"),
  notes: document.getElementById("notes")
};

const extensionChrome = globalThis.chrome;
const storage = extensionChrome?.storage?.sync ?? extensionChrome?.storage?.local ?? null;

init().catch((error) => {
  console.error("Failed to initialize dashboard", error);
});

async function init() {
  const stored = await storageGet(["links", "notes", "timerSettings"]);

  state.links = Array.isArray(stored.links) && stored.links.length ? stored.links : DEFAULT_LINKS;
  state.notes = typeof stored.notes === "string" ? stored.notes : "";
  state.timerSettings = {
    ...DEFAULT_TIMER_SETTINGS,
    ...(stored.timerSettings || {})
  };
  state.remainingSeconds = state.timerSettings.workMinutes * 60;

  await Promise.all([
    storageSet({ links: state.links }),
    storageSet({ notes: state.notes }),
    storageSet({ timerSettings: state.timerSettings })
  ]);

  bindEvents();
  renderLinks();
  renderDashboard();
  renderTimer();
  elements.notes.value = state.notes;

  startBackgroundRotation();
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
    renderDashboard();
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
    renderTimer();
  });

  elements.timerStart.addEventListener("click", startTimer);
  elements.timerPause.addEventListener("click", stopTimer);
  elements.timerReset.addEventListener("click", () => {
    stopTimer();
    state.timerMode = "work";
    state.remainingSeconds = state.timerSettings.workMinutes * 60;
    renderTimer();
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
  elements.dashboardGrid.innerHTML = "";

  state.links.forEach((link) => {
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

function startTimer() {
  if (state.timerRunning) {
    return;
  }

  state.timerRunning = true;
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
  }, 1000);
}

function stopTimer() {
  if (state.timerIntervalId) {
    window.clearInterval(state.timerIntervalId);
  }
  state.timerRunning = false;
  state.timerIntervalId = null;
}

function startBackgroundRotation() {
  const loadBackground = async () => {
    const imageUrl = `https://source.unsplash.com/1920x1080/?dark,night,abstract&sig=${Date.now()}`;
    try {
      await preloadImage(imageUrl);
      elements.backdrop.style.backgroundImage =
        `linear-gradient(140deg, rgba(8, 8, 8, 0.9), rgba(16, 16, 18, 0.76)), url('${imageUrl}')`;
    } catch (error) {
      console.warn("Could not load background image", error);
      elements.backdrop.style.backgroundImage =
        "linear-gradient(140deg, rgba(8, 8, 8, 0.9), rgba(16, 16, 18, 0.76))";
    }
  };

  loadBackground();
  window.setInterval(loadBackground, BACKGROUND_INTERVAL_MS);
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

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
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
