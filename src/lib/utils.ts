/**
 * Syncology — Utility helpers
 */

// ── Date formatting ────────────────────────────────────────────
export function formatDate(iso: string | undefined | null, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("id-ID", opts ?? { year: "numeric", month: "short", day: "numeric" });
}

export function formatTime(iso: string | undefined | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

export function formatRelative(iso: string | undefined | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hr  = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (sec < 60)   return "baru saja";
  if (min < 60)   return `${min} mnt lalu`;
  if (hr  < 24)   return `${hr} jam lalu`;
  if (day < 7)    return `${day} hari lalu`;
  return formatDate(iso);
}

export function daysUntil(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

// ── Strings ────────────────────────────────────────────────────
export function truncate(s: string, n: number): string {
  return s.length > n ? s.substring(0, n) + "…" : s;
}

export function initials(name: string): string {
  return name.charAt(0).toUpperCase();
}

// ── Class names ────────────────────────────────────────────────
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ── Audio (notification chime) ─────────────────────────────────
let audioCtx: AudioContext | null = null;

export function playChime(variant: "nudge" | "backup" | "success" | "error" = "nudge") {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const tones: Record<typeof variant, number[]> = {
      nudge:   [587.33, 880.00],     // D5 → A5 (bright)
      backup:  [440.00, 349.23, 440.00], // A4 → F4 → A4 (urgent)
      success: [523.25, 659.25, 783.99], // C5 → E5 → G5 (major triad)
      error:   [220.00, 207.65],     // A3 → G#3 (descending dissonant)
    };
    const freqs = tones[variant];
    const dur = 0.4;

    osc.type = variant === "error" ? "sawtooth" : "sine";
    freqs.forEach((f, i) => {
      osc.frequency.setValueAtTime(f, ctx.currentTime + i * 0.12);
    });
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  } catch (e) {
    console.error("playChime failed", e);
  }
}

// ── ID generation (for client-side temp IDs) ───────────────────
export function tempId(prefix = "tmp"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Local storage helpers (theme, onboarding, etc.) ────────────
export function loadPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function savePref<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

// ── External links ───────────────────────────────────────────────
export function normalizeExternalUrl(raw: string | undefined | null): string {
  const input = (raw ?? "").trim();
  if (!input) return "";
  if (/^(https?:\/\/|mailto:|tel:)/i.test(input)) return input;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(input)) return `https://${input}`;
  return input;
}

export async function openExternalUrl(raw: string | undefined | null): Promise<void> {
  const url = normalizeExternalUrl(raw);
  if (!url) return;

  try {
    const opener = await import("@tauri-apps/plugin-opener");
    if (typeof opener.openUrl === "function") {
      await opener.openUrl(url);
      return;
    }
  } catch {
    // fallback below
  }

  window.open(url, "_blank", "noopener,noreferrer");
}
