const root = document.documentElement;
const canvas = document.querySelector("#canvas");
const themeSelector = document.querySelector("#theme");
const modeSelector = document.querySelector("#game-mode");
const lengthSelector = document.querySelector("#game-length");
const lengthLabel = document.querySelector("#game-length-label");
const customField = document.querySelector("#custom-value-field");
const customLabel = document.querySelector("#custom-value-label");
const customInput = document.querySelector("#custom-value");
const playButton = document.querySelector("#play");
const sessionStatus = document.querySelector("#session-status");
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

const modeSettings = {
  time: {
    label: "Duration",
    customLabel: "Seconds",
    customPlaceholder: "Seconds",
    options: [
      ["15", "15 sec"],
      ["30", "30 sec"],
      ["60", "1 min"],
      ["120", "2 min"],
      ["custom", "Custom"],
    ],
  },
  questions: {
    label: "Questions",
    customLabel: "Count",
    customPlaceholder: "Questions",
    options: [
      ["10", "10"],
      ["20", "20"],
      ["custom", "Custom"],
    ],
  },
};

let session = null;
let timerId = null;

function resizeCanvas() {
  const { width, height } = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
}

function applyTheme(theme) {
  const resolvedTheme = theme === "system"
    ? (systemTheme.matches ? "dark" : "light")
    : theme;

  root.dataset.theme = resolvedTheme;
  themeSelector.value = theme;
}

function saveTheme(theme) {
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // The selected theme still applies when storage is unavailable.
  }
}

function loadTheme() {
  try {
    return localStorage.getItem("theme") || "system";
  } catch {
    return "system";
  }
}

function populateLengthOptions() {
  const settings = modeSettings[modeSelector.value];
  lengthSelector.replaceChildren();

  for (const [value, text] of settings.options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    lengthSelector.append(option);
  }

  lengthLabel.textContent = settings.label;
  customLabel.textContent = settings.customLabel;
  customInput.placeholder = settings.customPlaceholder;
  customInput.value = "";
  updateCustomField();
}

function updateCustomField() {
  const isCustom = lengthSelector.value === "custom";
  customField.hidden = !isCustom;
  customInput.required = isCustom;
  validateSettings();

  if (isCustom) customInput.focus();
}

function validateSettings() {
  const isCustom = lengthSelector.value === "custom";
  const value = Number(customInput.value);
  const isValid = !isCustom || (Number.isInteger(value) && value > 0);

  customInput.setCustomValidity(isValid ? "" : "Enter a whole number greater than zero.");
  playButton.disabled = !session && !isValid;
  return isValid;
}

function selectedValue() {
  return Number(lengthSelector.value === "custom" ? customInput.value : lengthSelector.value);
}

function setSessionControlsDisabled(disabled) {
  modeSelector.disabled = disabled;
  lengthSelector.disabled = disabled;
  customInput.disabled = disabled;
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function updateTimer() {
  if (!session || session.mode !== "time") return;

  const secondsLeft = Math.max(0, Math.ceil((session.endsAt - Date.now()) / 1000));
  sessionStatus.textContent = `Time left: ${formatTime(secondsLeft)}`;

  if (secondsLeft === 0) stopSession("Time’s up");
}

function startSession() {
  if (!validateSettings()) {
    customInput.reportValidity();
    return;
  }

  const mode = modeSelector.value;
  const value = selectedValue();
  session = { mode, value };
  setSessionControlsDisabled(true);
  playButton.textContent = "Stop";
  playButton.disabled = false;

  if (mode === "time") {
    session.endsAt = Date.now() + value * 1000;
    updateTimer();
    timerId = window.setInterval(updateTimer, 250);
  } else {
    sessionStatus.textContent = `Questions: 0 / ${value}`;
  }

  window.dispatchEvent(new CustomEvent("alpha-check:start", {
    detail: { mode, value },
  }));
}

function stopSession(message = "Ready") {
  if (timerId !== null) {
    window.clearInterval(timerId);
    timerId = null;
  }

  const endedSession = session;
  session = null;
  setSessionControlsDisabled(false);
  playButton.textContent = "Play";
  sessionStatus.textContent = message;
  validateSettings();

  if (endedSession) {
    window.dispatchEvent(new CustomEvent("alpha-check:stop", {
      detail: { mode: endedSession.mode, value: endedSession.value, message },
    }));
  }
}

modeSelector.addEventListener("change", populateLengthOptions);
lengthSelector.addEventListener("change", updateCustomField);
customInput.addEventListener("input", validateSettings);

playButton.addEventListener("click", () => {
  if (session) stopSession("Stopped");
  else startSession();
});

themeSelector.addEventListener("change", (event) => {
  const theme = event.target.value;
  saveTheme(theme);
  applyTheme(theme);
});

systemTheme.addEventListener("change", () => {
  if (themeSelector.value === "system") applyTheme("system");
});

new ResizeObserver(resizeCanvas).observe(canvas);
populateLengthOptions();
applyTheme(loadTheme());
resizeCanvas();
