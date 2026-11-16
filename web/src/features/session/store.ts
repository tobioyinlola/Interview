import { create } from "zustand";

import type { StreamError } from "../../audio/suggestStream";

export type Status =
  | "idle"
  | "starting"
  | "listening"
  | "reconnecting"
  | "stopped"
  | "error"
  | "ended";

export interface Line {
  key: string;
  id?: string;
  seq?: number;
  speaker: "partner" | "you" | "typed" | "gap";
  text: string;
}

export interface Outline {
  question: string;
  text: string;
  state: "streaming" | "done" | "error";
  error?: StreamError;
  /** "First words in X s": from the end of the question to the first streamed token. */
  firstWordsMs?: number;
  suggestionId?: string;
  flags: string[];
  revealed: boolean;
}

const BLUR_KEY = "meet-practice-blur";
const readBlur = (): boolean => {
  try {
    return localStorage.getItem(BLUR_KEY) === "1";
  } catch {
    return false; // storage can be unavailable (private window): the setting just doesn't persist
  }
};

export interface LiveState {
  status: Status;
  /** A plain message about why capture is not running, with the next step. */
  problem: string | null;
  /** A passing warning (silent tab, hidden tab...). */
  notice: string | null;
  level: number;
  lines: Line[];
  partial: string;
  outline: Outline | null;
  blur: boolean;
  set: (p: Partial<LiveState>) => void;
  addLine: (l: Line) => void;
  setOutline: (o: Outline | null) => void;
  patchOutline: (p: Partial<Outline>) => void;
  setBlur: (on: boolean) => void;
  reset: () => void;
}

const initial = {
  status: "idle" as Status,
  problem: null,
  notice: null,
  level: 0,
  lines: [] as Line[],
  partial: "",
  outline: null as Outline | null,
};

/** Live-session state only. Server data stays in TanStack Query, so streaming text never triggers
 *  a refetch. */
export const useLiveStore = create<LiveState>((set) => ({
  ...initial,
  blur: readBlur(),
  set: (p) => set(p),
  addLine: (l) => set((s) => ({ lines: [...s.lines, l] })),
  setOutline: (o) => set({ outline: o }),
  patchOutline: (p) =>
    set((s) => (s.outline ? { outline: { ...s.outline, ...p } } : {})),
  setBlur: (on) => {
    try {
      localStorage.setItem(BLUR_KEY, on ? "1" : "0");
    } catch {
      /* not persisted */
    }
    set({ blur: on });
  },
  reset: () => set({ ...initial }),
}));

/** The question to answer: the partner's last (up to 3) finished utterances since the user last
 *  spoke, joined. A long question spoken in pieces becomes one question. */
export function assembleTurn(lines: Line[]): { text: string; ids: string[] } {
  const turn: Line[] = [];
  for (let i = lines.length - 1; i >= 0 && turn.length < 3; i--) {
    const l = lines[i];
    if (l.speaker === "you") break;
    if (l.speaker === "partner") turn.unshift(l);
  }
  return {
    text: turn.map((l) => l.text).join(" "),
    ids: turn.flatMap((l) => (l.id ? [l.id] : [])),
  };
}
