"use client";

/**
 * The assistant's notification sounds, synthesized with Web Audio (no audio
 * files): a soft two-note chime for a new notification, a single lighter note
 * when a chat reply lands while the panel is closed. Browsers only allow audio
 * after the person has interacted with the page, so the context is created —
 * and resumed — on the first pointer or key press. Muted per device from
 * the Updates panel ("Sound on this device").
 */

const SOUND_KEY = "clandar.notification-sound";
let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!context) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  }
  return context;
}

/** Call once on mount: readies audio on the first interaction (what browsers require). */
export function unlockSoundOnInteraction(): () => void {
  const unlock = () => {
    const ctx = audio();
    if (ctx && ctx.state === "suspended") void ctx.resume();
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
  return () => {
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
}

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // Storage blocked — the choice just isn't remembered.
  }
}

/** One soft bell-like note: a sine with a quick attack and an exponential fade. */
function note(ctx: AudioContext, frequency: number, start: number, duration: number, volume: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

/** "notification": two rising notes (E6 → A6). "reply": one lighter note (A5). */
export function playSound(kind: "notification" | "reply"): void {
  if (!soundEnabled()) return;
  const ctx = audio();
  if (!ctx || ctx.state !== "running") return;
  const t = ctx.currentTime + 0.02;
  if (kind === "notification") {
    note(ctx, 1318.5, t, 0.5, 0.18);
    note(ctx, 1760, t + 0.13, 0.7, 0.16);
  } else {
    note(ctx, 880, t, 0.45, 0.14);
  }
}
