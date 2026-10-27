/**
 * Sound, synthesised rather than shipped: a two-note chime when a session
 * ends. Off by default, and every call is defensive — an AudioContext that
 * Windows refuses to start must never break the timer.
 */

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Two-note chime (a fourth apart) marking the end of a session. */
export function playChime(): void {
  const audio = context();
  if (!audio) return;
  const t = audio.currentTime;
  [587.33, 783.99].forEach((freq, i) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t + i * 0.16);
    gain.gain.setValueAtTime(0.0001, t + i * 0.16);
    gain.gain.exponentialRampToValueAtTime(0.09, t + i * 0.16 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.6);
    osc.connect(gain).connect(audio.destination);
    osc.start(t + i * 0.16);
    osc.stop(t + i * 0.16 + 0.65);
  });
}
