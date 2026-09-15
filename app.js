// UI shell only — no real audio wiring yet. Fakes the level meter so the
// interaction can be reviewed before the AudioWorklet pipeline exists.

const EFFECTS = [
  { id: "reversed-fricatives", label: "Reversed Fricatives" },
];

const micButton = document.querySelector(".mic-button");
const effectSelect = document.querySelector(".effect-select");
const levelFill = document.querySelector(".level-meter-fill");
const statusEl = document.querySelector(".status");

for (const effect of EFFECTS) {
  const option = document.createElement("option");
  option.value = effect.id;
  option.textContent = effect.label;
  effectSelect.appendChild(option);
}

let listening = false;
let fakeLevelTimer = null;

function setListening(next) {
  listening = next;
  micButton.classList.toggle("listening", listening);
  micButton.textContent = listening ? "Stop" : "Start";
  effectSelect.disabled = listening;
  statusEl.textContent = listening ? "Listening…" : "Tap to start";
  statusEl.classList.remove("error");

  if (listening) {
    fakeLevelTimer = setInterval(() => {
      levelFill.style.width = `${Math.random() * 70 + 10}%`;
    }, 120);
  } else {
    clearInterval(fakeLevelTimer);
    levelFill.style.width = "0%";
  }
}

micButton.addEventListener("click", () => setListening(!listening));

setListening(false);
