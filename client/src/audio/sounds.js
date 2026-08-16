// All sounds are synthesized in the browser with the Web Audio API — zero
// external audio assets, so nothing copyrighted is ever shipped or downloaded.

let ctx = null;
let enabled = true;

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function setSoundEnabled(v) { enabled = v; }
export function isSoundEnabled() { return enabled; }

function tone({ freq = 440, duration = 0.15, type = "sine", gain = 0.2, delay = 0 }) {
  if (!enabled) return;
  try {
    const c = getCtx();
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime + delay);
    g.gain.setValueAtTime(0, c.currentTime + delay);
    g.gain.linearRampToValueAtTime(gain, c.currentTime + delay + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + delay + duration);
    osc.connect(g).connect(c.destination);
    osc.start(c.currentTime + delay);
    osc.stop(c.currentTime + delay + duration + 0.02);
  } catch { /* audio unsupported/blocked — fail silently */ }
}

export const sounds = {
  countdownTick: () => tone({ freq: 660, duration: 0.08, type: "square", gain: 0.12 }),
  roundStart: () => {
    tone({ freq: 440, duration: 0.12, type: "triangle" });
    tone({ freq: 660, duration: 0.15, type: "triangle", delay: 0.1 });
  },
  correctGuess: () => {
    tone({ freq: 523, duration: 0.1, type: "sine" });
    tone({ freq: 659, duration: 0.1, type: "sine", delay: 0.08 });
    tone({ freq: 784, duration: 0.18, type: "sine", delay: 0.16 });
  },
  closeGuess: () => tone({ freq: 350, duration: 0.12, type: "sine", gain: 0.15 }),
  timerWarning: () => tone({ freq: 300, duration: 0.1, type: "square", gain: 0.15 }),
  roundEnd: () => tone({ freq: 220, duration: 0.3, type: "sawtooth", gain: 0.12 }),
  victory: () => {
    [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, duration: 0.25, type: "triangle", delay: i * 0.12 }));
  },
  reaction: () => tone({ freq: 900, duration: 0.06, type: "sine", gain: 0.1 }),
};
