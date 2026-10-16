const root = document.documentElement;
const canvas = document.querySelector("#canvas");
const themeToggle = document.querySelector("#theme-toggle");
const themeIcon = themeToggle.querySelector("span");
const modeSelector = document.querySelector("#game-mode");
const lengthSelector = document.querySelector("#game-length");
const difficultySelector = document.querySelector("#difficulty");
const lengthLabel = document.querySelector("#game-length-label");
const customField = document.querySelector("#custom-value-field");
const customLabel = document.querySelector("#custom-value-label");
const customInput = document.querySelector("#custom-value");
const playButton = document.querySelector("#play");
const sessionStatus = document.querySelector("#session-status");
const questionPrompt = document.querySelector("#question-prompt");
const gameMessage = document.querySelector("#game-message");
const nextButton = document.querySelector("#next-question");
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

// CSS defines one inch as 96 pixels. Change this value to tune the game scale.
const NM_PER_CSS_INCH = 10;
const CSS_PIXELS_PER_INCH = 96;
const PIXELS_PER_NM = CSS_PIXELS_PER_INCH / NM_PER_CSS_INCH;
const MIN_RANGE_NM = 10;
const DRAWING_MARGIN = 24;
const COUNTDOWN_STEP_MS = 700;

const themes = ["system", "light", "dark"];
const themeIcons = {
  system: "◐",
  light: "☀",
  dark: "☾",
};

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
let countdownId = null;
let canvasSize = { width: 0, height: 0 };

function resizeCanvas() {
  const { width, height } = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvasSize = { width, height };

  const context = canvas.getContext("2d");
  context.setTransform(scale, 0, 0, scale, 0, 0);

  if (session?.question) reprojectQuestion();
  drawGame();
}

function applyTheme(theme) {
  const resolvedTheme = theme === "system"
    ? (systemTheme.matches ? "dark" : "light")
    : theme;

  root.dataset.theme = resolvedTheme;
  root.dataset.themePreference = theme;
  themeIcon.textContent = themeIcons[theme];
  const themeName = theme[0].toUpperCase() + theme.slice(1);
  themeToggle.setAttribute("aria-label", `Theme: ${themeName}`);
  themeToggle.title = `Theme: ${themeName}`;
  drawGame();
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
  difficultySelector.disabled = disabled;
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

  if (secondsLeft === 0) finishSession("Time’s up");
}

function randomInteger(minimum, maximum) {
  return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
}

function vectorFor(bearing, range) {
  const radians = bearing * Math.PI / 180;
  return {
    x: Math.sin(radians) * range * PIXELS_PER_NM,
    y: -Math.cos(radians) * range * PIXELS_PER_NM,
  };
}

function bullseyeBounds(vector) {
  const minX = Math.max(DRAWING_MARGIN, DRAWING_MARGIN - vector.x);
  const maxX = Math.min(canvasSize.width - DRAWING_MARGIN, canvasSize.width - DRAWING_MARGIN - vector.x);
  const minY = Math.max(DRAWING_MARGIN, DRAWING_MARGIN - vector.y);
  const maxY = Math.min(canvasSize.height - DRAWING_MARGIN, canvasSize.height - DRAWING_MARGIN - vector.y);
  return { minX, maxX, minY, maxY, valid: minX <= maxX && minY <= maxY };
}

function questionFitsAtCenter(vector) {
  const x = canvasSize.width / 2 + vector.x;
  const y = canvasSize.height / 2 + vector.y;
  return x >= DRAWING_MARGIN && x <= canvasSize.width - DRAWING_MARGIN
    && y >= DRAWING_MARGIN && y <= canvasSize.height - DRAWING_MARGIN;
}

function createQuestion() {
  const difficulty = session.difficulty;

  for (let attempt = 0; attempt < 500; attempt += 1) {
    const bearing = randomInteger(0, 359);
    const theoreticalMaximum = Math.floor(Math.hypot(canvasSize.width, canvasSize.height) / PIXELS_PER_NM);

    if (theoreticalMaximum < MIN_RANGE_NM) break;

    const range = randomInteger(MIN_RANGE_NM, theoreticalMaximum);
    const vector = vectorFor(bearing, range);

    if (difficulty === "easy") {
      if (!questionFitsAtCenter(vector)) continue;

      return {
        bearing,
        range,
        bullseye: { x: canvasSize.width / 2, y: canvasSize.height / 2 },
        bullseyeRatio: { x: 0.5, y: 0.5 },
      };
    }

    const bounds = bullseyeBounds(vector);
    if (!bounds.valid) continue;

    const x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
    const y = bounds.minY + Math.random() * (bounds.maxY - bounds.minY);
    return {
      bearing,
      range,
      bullseye: { x, y },
      bullseyeRatio: { x: x / canvasSize.width, y: y / canvasSize.height },
    };
  }

  return null;
}

function targetFor(question) {
  const vector = vectorFor(question.bearing, question.range);
  return {
    x: question.bullseye.x + vector.x,
    y: question.bullseye.y + vector.y,
  };
}

function reprojectQuestion() {
  const question = session.question;
  const vector = vectorFor(question.bearing, question.range);

  if (session.difficulty === "easy") {
    question.bullseye = { x: canvasSize.width / 2, y: canvasSize.height / 2 };
    session.resizeBlocked = !questionFitsAtCenter(vector);
  } else {
    const bounds = bullseyeBounds(vector);
    session.resizeBlocked = !bounds.valid;

    if (bounds.valid) {
      const preferredX = question.bullseyeRatio.x * canvasSize.width;
      const preferredY = question.bullseyeRatio.y * canvasSize.height;
      question.bullseye = {
        x: Math.min(bounds.maxX, Math.max(bounds.minX, preferredX)),
        y: Math.min(bounds.maxY, Math.max(bounds.minY, preferredY)),
      };
    }
  }

  if (question.guessOffset) {
    question.guess = {
      x: question.bullseye.x + question.guessOffset.x * PIXELS_PER_NM,
      y: question.bullseye.y + question.guessOffset.y * PIXELS_PER_NM,
    };
  }

  updateOverlay();
}

function canvasColors() {
  const styles = getComputedStyle(root);
  return {
    guide: styles.getPropertyValue("--guide").trim(),
    bullseye: styles.getPropertyValue("--bullseye").trim(),
    target: styles.getPropertyValue("--target").trim(),
    guess: styles.getPropertyValue("--guess").trim(),
  };
}

function drawMarker(context, point, color, kind) {
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 2.5;

  if (kind === "bullseye") {
    context.beginPath();
    context.arc(point.x, point.y, 9, 0, Math.PI * 2);
    context.moveTo(point.x - 14, point.y);
    context.lineTo(point.x + 14, point.y);
    context.moveTo(point.x, point.y - 14);
    context.lineTo(point.x, point.y + 14);
    context.stroke();
  } else if (kind === "target") {
    context.beginPath();
    context.arc(point.x, point.y, 7, 0, Math.PI * 2);
    context.fill();
  } else {
    context.beginPath();
    context.moveTo(point.x - 7, point.y - 7);
    context.lineTo(point.x + 7, point.y + 7);
    context.moveTo(point.x + 7, point.y - 7);
    context.lineTo(point.x - 7, point.y + 7);
    context.stroke();
  }

  context.restore();
}

function drawGuides(context, question, colors) {
  if (session.difficulty === "super-hard") return;

  const { x, y } = question.bullseye;
  context.save();
  context.strokeStyle = colors.guide;
  context.fillStyle = colors.guide;
  context.lineWidth = 1;
  context.globalAlpha = 0.65;

  const maximumRadius = Math.max(
    Math.hypot(x, y),
    Math.hypot(canvasSize.width - x, y),
    Math.hypot(x, canvasSize.height - y),
    Math.hypot(canvasSize.width - x, canvasSize.height - y),
  );

  for (let range = 10; range * PIXELS_PER_NM <= maximumRadius; range += 10) {
    context.beginPath();
    context.arc(x, y, range * PIXELS_PER_NM, 0, Math.PI * 2);
    context.stroke();
  }

  if (session.difficulty === "easy") {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, canvasSize.height);
    context.moveTo(0, y);
    context.lineTo(canvasSize.width, y);
    context.stroke();

    context.globalAlpha = 0.9;
    context.font = "12px system-ui, sans-serif";
    context.fillText("0°", x + 6, 16);
    context.fillText("90°", canvasSize.width - 30, y - 7);
    context.fillText("180°", x + 6, canvasSize.height - 8);
    context.fillText("270°", 6, y - 7);
  }

  context.restore();
}

function drawGame() {
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvasSize.width, canvasSize.height);

  if (!session?.question || session.resizeBlocked) return;

  const question = session.question;
  const colors = canvasColors();
  drawGuides(context, question, colors);
  drawMarker(context, question.bullseye, colors.bullseye, "bullseye");

  if (session.phase === "reveal") {
    drawMarker(context, targetFor(question), colors.target, "target");
    drawMarker(context, question.guess, colors.guess, "guess");
  }
}

function updateOverlay() {
  if (!session) return;

  const question = session.question;
  questionPrompt.hidden = !question;
  if (question) questionPrompt.textContent = `Bearing ${question.bearing}° / Range ${question.range} nm`;

  if (session.resizeBlocked) {
    gameMessage.classList.remove("countdown");
    gameMessage.textContent = "The play area is too small for this question.\nEnlarge the window to continue.";
    gameMessage.hidden = false;
    nextButton.hidden = true;
    return;
  }

  if (session.phase === "question") {
    gameMessage.hidden = true;
    nextButton.hidden = true;
  } else if (session.phase === "reveal") {
    gameMessage.classList.remove("countdown");
    gameMessage.textContent = `Error: ${question.error.toFixed(2)} nm\nQuestion score: ${question.penalty.toFixed(2)}`;
    gameMessage.hidden = false;
    nextButton.textContent = session.mode === "questions" && session.completed >= session.value
      ? "View total"
      : "Next";
    nextButton.hidden = false;
  }
}

function beginQuestion() {
  const question = createQuestion();
  if (!question) {
    finishSession("Play area too small");
    return;
  }

  session.question = question;
  session.phase = "question";
  session.resizeBlocked = false;
  updateOverlay();
  drawGame();
}

function beginActiveSession() {
  if (!session) return;

  gameMessage.classList.remove("countdown");
  gameMessage.hidden = true;
  session.phase = "question";

  if (session.mode === "time") {
    session.endsAt = Date.now() + session.value * 1000;
    updateTimer();
    timerId = window.setInterval(updateTimer, 250);
  } else {
    sessionStatus.textContent = `Questions: 0 / ${session.value}`;
  }

  beginQuestion();
}

function runCountdown() {
  let count = 3;
  gameMessage.classList.add("countdown");
  gameMessage.textContent = String(count);
  gameMessage.hidden = false;

  const advance = () => {
    count -= 1;
    if (count > 0) {
      gameMessage.textContent = String(count);
      countdownId = window.setTimeout(advance, COUNTDOWN_STEP_MS);
    } else {
      countdownId = null;
      beginActiveSession();
    }
  };

  countdownId = window.setTimeout(advance, COUNTDOWN_STEP_MS);
}

function startSession() {
  if (!validateSettings()) {
    customInput.reportValidity();
    return;
  }

  const mode = modeSelector.value;
  const value = selectedValue();
  session = {
    mode,
    value,
    difficulty: difficultySelector.value,
    phase: "countdown",
    completed: 0,
    score: 0,
    question: null,
  };
  setSessionControlsDisabled(true);
  playButton.textContent = "Stop";
  playButton.disabled = false;
  sessionStatus.hidden = false;

  sessionStatus.textContent = "Get ready";
  questionPrompt.hidden = true;
  nextButton.hidden = true;
  runCountdown();

  window.dispatchEvent(new CustomEvent("alpha-check:start", {
    detail: { mode, value, difficulty: session.difficulty },
  }));
}

function clearSessionTimers() {
  if (timerId !== null) {
    window.clearInterval(timerId);
    timerId = null;
  }

  if (countdownId !== null) {
    window.clearTimeout(countdownId);
    countdownId = null;
  }
}

function finishSession(reason) {
  if (!session) return;

  clearSessionTimers();
  const endedSession = session;
  session = null;
  setSessionControlsDisabled(false);
  playButton.textContent = "Play";
  sessionStatus.hidden = true;
  questionPrompt.hidden = true;
  nextButton.hidden = true;
  gameMessage.classList.remove("countdown");
  gameMessage.textContent = `${reason}\nFinal score: ${endedSession.score.toFixed(2)}\nQuestions answered: ${endedSession.completed}`;
  gameMessage.hidden = false;
  validateSettings();
  drawGame();

  window.dispatchEvent(new CustomEvent("alpha-check:stop", {
    detail: {
      mode: endedSession.mode,
      value: endedSession.value,
      difficulty: endedSession.difficulty,
      score: endedSession.score,
      completed: endedSession.completed,
      message: reason,
    },
  }));
}

function stopSession() {
  if (!session) return;

  finishSession("Session stopped");
}

function recordGuess(point) {
  if (!session || session.phase !== "question" || session.resizeBlocked) return;

  const question = session.question;
  const target = targetFor(question);
  const error = Math.hypot(point.x - target.x, point.y - target.y) / PIXELS_PER_NM;
  const penalty = error ** 2;

  question.guess = point;
  question.guessOffset = {
    x: (point.x - question.bullseye.x) / PIXELS_PER_NM,
    y: (point.y - question.bullseye.y) / PIXELS_PER_NM,
  };
  question.error = error;
  question.penalty = penalty;
  session.score += penalty;
  session.completed += 1;
  session.phase = "reveal";

  if (session.mode === "questions") {
    sessionStatus.textContent = `Questions: ${session.completed} / ${session.value}`;
  }

  updateOverlay();
  drawGame();
}

function nextQuestion() {
  if (!session || session.phase !== "reveal") return;

  if (session.mode === "questions" && session.completed >= session.value) {
    finishSession("Session complete");
    return;
  }

  beginQuestion();
}

modeSelector.addEventListener("change", populateLengthOptions);
lengthSelector.addEventListener("change", updateCustomField);
customInput.addEventListener("input", validateSettings);

playButton.addEventListener("click", () => {
  if (session) stopSession();
  else startSession();
});

canvas.addEventListener("pointerdown", (event) => {
  const bounds = canvas.getBoundingClientRect();
  recordGuess({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
});

nextButton.addEventListener("click", nextQuestion);

themeToggle.addEventListener("click", () => {
  const currentTheme = root.dataset.themePreference;
  const theme = themes[(themes.indexOf(currentTheme) + 1) % themes.length];
  saveTheme(theme);
  applyTheme(theme);
});

systemTheme.addEventListener("change", () => {
  if (root.dataset.themePreference === "system") applyTheme("system");
});

new ResizeObserver(resizeCanvas).observe(canvas);
populateLengthOptions();
applyTheme(loadTheme());
resizeCanvas();
