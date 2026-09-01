/**
 * Quick-add bahasa alami — PLAN.md §6.1
 *
 * 100% lokal, tanpa AI. Semua kecerdasan berasal dari `lexicon.id.json`.
 * Pipeline 9 langkah (§6.1.1); urutan pengulangan SEBELUM tanggal itu wajib,
 * kalau dibalik `tiap senin` kebaca sebagai tanggal "senin".
 */
import type { Energy, Priority } from "../types.js";
import lex from "./lexicon.id.json";
import {
  addDays,
  addMonths,
  endOfMonth,
  type Meridiem,
  nextDateOfYear,
  nextMonthDay,
  nextWeek,
  nextWeekday,
  nextWeekend,
  parseClockString,
  resolveHour,
  setTime,
  startOfDay,
  startOfNextMonth,
} from "./datetime.js";

// ── tipe ─────────────────────────────────────────────────────────────────────

export type ParsedKind = "task" | "busy";
export type TokenRole =
  | "intent"
  | "date"
  | "time"
  | "duration"
  | "recurrence"
  | "priority"
  | "tag"
  | "project"
  | "energy"
  | "subtask"
  | "reminder"
  | "drop";

export interface MatchedRange {
  start: number;
  end: number;
  role: TokenRole;
  label: string;
}

export interface ParseResult {
  kind: ParsedKind;
  title: string;
  dueAt?: Date;
  startAt?: Date;
  endAt?: Date;
  allDay: boolean;
  estimateMin?: number;
  priority?: Priority;
  tags: string[];
  project?: string;
  energy?: Energy;
  subtasks: string[];
  notes?: string;
  reminderMin?: number;
  recurrence?: string;
  /** true kalau user nulis "jam 3an" / "sekitar jam 3" */
  approxTime: boolean;
  wantsReminder: boolean;
  /** Rentang di input asli yang keparsing — buat nyorot di UI. */
  matched: MatchedRange[];
  /** Kata mirip entri kamus tapi gak persis — bahan fitur "Ajarin" (§6.1.7). */
  unmatched: string[];
}

export interface ParseOptions {
  now?: Date;
  /** Kamus pribadi user, ditumpuk di atas lexicon bawaan. */
  userLexicon?: Record<string, string>;
}

// ── token ────────────────────────────────────────────────────────────────────

interface Token {
  raw: string;
  display: string;
  norm: string;
  start: number;
  end: number;
  consumed: boolean;
  role?: TokenRole;
  locked: boolean;
}

const LEAD_PUNCT = /^[,;:.?"'`(]+/;
const TAIL_PUNCT = /[,;:?"'`)]+$/;

function normalize(raw: string): string {
  let n = raw.toLowerCase().replace(LEAD_PUNCT, "").replace(TAIL_PUNCT, "");
  if (!/\d[.,]\d/.test(n)) n = n.replace(/[.]+$/, "");
  return n;
}

function tokenize(input: string, lockedRanges: Array<[number, number]>): Token[] {
  const tokens: Token[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    const locked = lockedRanges.some(([a, b]) => start >= a && end <= b);
    const display = m[0].replace(LEAD_PUNCT, "").replace(TAIL_PUNCT, "");
    if (display === "") continue;
    tokens.push({
      raw: m[0],
      display,
      norm: normalize(m[0]),
      start,
      end,
      consumed: false,
      locked,
    });
  }
  return tokens;
}

function consume(tokens: Token[], from: number, count: number, role: TokenRole): void {
  for (let i = from; i < from + count && i < tokens.length; i++) {
    const t = tokens[i]!;
    t.consumed = true;
    t.role = role;
  }
}

/** Cocokkan frasa multi-kata mulai dari indeks i. Balikin jumlah token yang cocok. */
function matchPhrase(tokens: Token[], i: number, phrase: string): number {
  const words = phrase.split(" ");
  for (let k = 0; k < words.length; k++) {
    const t = tokens[i + k];
    if (!t || t.consumed || t.locked || t.norm !== words[k]) return 0;
  }
  return words.length;
}

/** Cari frasa terpanjang dari daftar. */
function findPhrase(tokens: Token[], i: number, phrases: readonly string[]): { phrase: string; len: number } | null {
  let best: { phrase: string; len: number } | null = null;
  for (const p of phrases) {
    const len = matchPhrase(tokens, i, p);
    if (len > 0 && (!best || len > best.len)) best = { phrase: p, len };
  }
  return best;
}

function firstFree(tokens: Token[]): Token[] {
  return tokens.filter((t) => !t.consumed);
}

// ── pipeline ─────────────────────────────────────────────────────────────────

export function parseQuickAdd(input: string, opts: ParseOptions = {}): ParseResult {
  const now = opts.now ?? new Date();

  // ── pra: pisahin catatan (`//`) dan kunci isi tanda kutip
  let working = input;
  let notes: string | undefined;
  const noteIdx = working.indexOf("//");
  if (noteIdx >= 0) {
    notes = working.slice(noteIdx + 2).trim() || undefined;
    working = working.slice(0, noteIdx);
  }

  const lockedRanges: Array<[number, number]> = [];
  const quoteRe = /"([^"]+)"/g;
  let qm: RegExpExecArray | null;
  while ((qm = quoteRe.exec(working)) !== null) {
    // rentang termasuk tanda kutipnya, biar token `"rapat` ikut terkunci
    lockedRanges.push([qm.index, qm.index + qm[0].length]);
  }

  const tokens = tokenize(working, lockedRanges);

  const result: ParseResult = {
    kind: "task",
    title: "",
    allDay: false,
    tags: [],
    subtasks: [],
    approxTime: false,
    wantsReminder: false,
    matched: [],
    unmatched: [],
    ...(notes !== undefined ? { notes } : {}),
  };

  // ① normalisasi slang
  applySlang(tokens, opts.userLexicon);

  // ② niat
  const kindHint = applyIntent(tokens, result);

  // ③ sampah (partikel & kata pengisi)
  applyDrop(tokens);

  // ④ token bertanda
  applySigils(tokens, result);

  // ⑤ durasi
  applyDuration(tokens, result);

  // ⑥ pengulangan — WAJIB sebelum tanggal
  applyRecurrence(tokens, result);

  // ⑦ tanggal
  const dateAnchor = applyDate(tokens, now);

  // ⑧ jam
  applyTime(tokens, result, now, dateAnchor);

  // ⑨ judul
  applyPriorityWords(tokens, result);
  applyTrailingDrop(tokens);
  result.title = buildTitle(tokens);

  // jenis: kata perintah menang, lalu kata benda, default Task
  if (result.kind !== "busy") {
    result.kind = kindHint ?? guessKindFromNouns(result.title) ?? "task";
  }

  result.matched = tokens
    .filter((t) => t.consumed && t.role && t.role !== "drop")
    .map((t) => ({ start: t.start, end: t.end, role: t.role!, label: t.display }));

  result.unmatched = findNearMisses(tokens);

  return result;
}

// ── ① slang ──────────────────────────────────────────────────────────────────

function applySlang(tokens: Token[], userLexicon?: Record<string, string>): void {
  const slang = lex.slang as Record<string, string>;
  for (const t of tokens) {
    if (t.locked) continue;
    const mapped = userLexicon?.[t.norm] ?? slang[t.norm];
    if (mapped !== undefined) t.norm = mapped;
  }
}

// ── ② niat ───────────────────────────────────────────────────────────────────

function applyIntent(tokens: Token[], result: ParseResult): ParsedKind | null {
  const groups: Array<[ParsedKind | null, readonly string[]]> = [
    ["busy", lex.intent.schedule],
    ["task", lex.intent.remind],
    [null, lex.intent.neutral],
  ];

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.consumed || tokens[i]!.locked) continue;
    for (const [kind, phrases] of groups) {
      const hit = findPhrase(tokens, i, phrases);
      if (!hit) continue;
      consume(tokens, i, hit.len, "intent");
      if (phrases === lex.intent.remind) result.wantsReminder = true;
      if (kind === "busy") result.kind = "busy";
      return kind;
    }
  }
  return null;
}

function guessKindFromNouns(title: string): ParsedKind | null {
  const t = title.toLowerCase();
  const hasWord = (w: string) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t);
  if ((lex.nounSchedule as string[]).some(hasWord)) return "busy";
  if ((lex.nounTask as string[]).some(hasWord)) return "task";
  return null;
}

// ── ③ sampah ─────────────────────────────────────────────────────────────────

function applyDrop(tokens: Token[]): void {
  const dropSet = new Set([...(lex.drop as string[]), ...(lex.filler as string[]), ...(lex.pastRef as string[])]);
  for (const t of tokens) {
    if (t.consumed || t.locked) continue;
    if (dropSet.has(t.norm)) {
      t.consumed = true;
      t.role = "drop";
    }
  }
}

/** `yg`, `ke`, `sama` dst. cuma dibuang kalau menggantung di ujung. */
function applyTrailingDrop(tokens: Token[]): void {
  const list = new Set(lex.dropIfTrailing as string[]);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i]!;
    if (t.consumed || t.locked) continue;
    if (!list.has(t.norm)) continue;
    const next = tokens.slice(i + 1).find((x) => !x.consumed && !x.locked);
    if (!next) {
      t.consumed = true;
      t.role = "drop";
    }
  }
}

// ── ④ token bertanda ─────────────────────────────────────────────────────────

function applySigils(tokens: Token[], result: ParseResult): void {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.consumed || t.locked) continue;
    const n = t.norm;

    if (n === "%sibuk") {
      result.kind = "busy";
      consume(tokens, i, 1, "intent");
      continue;
    }

    if (n.startsWith("!")) {
      const p = /^!p([1-4])$/.exec(n);
      if (p) result.priority = Number(p[1]) as Priority;
      else if (n === "!!") result.priority = 1;
      else if (n === "!") result.priority = 2;
      else continue;
      consume(tokens, i, 1, "priority");
      continue;
    }

    if (n.startsWith("#") && n.length > 1) {
      result.tags.push(n.slice(1));
      consume(tokens, i, 1, "tag");
      continue;
    }

    if (n.startsWith("@") && n.length > 1) {
      result.project = n.slice(1);
      consume(tokens, i, 1, "project");
      continue;
    }

    if (n.startsWith("~") && n.length > 1) {
      const e = (lex.energyWords as Record<string, string>)[n.slice(1)];
      if (e) {
        result.energy = e as Energy;
        consume(tokens, i, 1, "energy");
      }
      continue;
    }

    if (n.startsWith("*") && n.length > 1) {
      const mins = parseDurationToken(n.slice(1));
      if (mins !== null) {
        result.reminderMin = mins;
        result.wantsReminder = true;
        consume(tokens, i, 1, "reminder");
      }
      continue;
    }

    if (n.startsWith("+") && n.length > 1) {
      const words: string[] = [tokens[i]!.display.slice(1)];
      consume(tokens, i, 1, "subtask");
      let j = i + 1;
      while (j < tokens.length) {
        const nx = tokens[j]!;
        if (nx.consumed || nx.locked || /^[+!#@~*%]/.test(nx.norm)) break;
        words.push(nx.display);
        consume(tokens, j, 1, "subtask");
        j++;
      }
      result.subtasks.push(words.join(" "));
      i = j - 1;
    }
  }
}

// ── ⑤ durasi ─────────────────────────────────────────────────────────────────

function parseDurationToken(n: string): number | null {
  const minute = /^(\d+(?:[.,]\d+)?)(m|mnt|menit)$/.exec(n);
  if (minute) return Math.round(Number(minute[1]!.replace(",", ".")));
  const hour = /^(\d+(?:[.,]\d+)?)(j|jam)$/.exec(n);
  if (hour) return Math.round(Number(hour[1]!.replace(",", ".")) * 60);
  return null;
}

function applyDuration(tokens: Token[], result: ParseResult): void {
  const phrases = Object.keys(lex.durationPhrase as Record<string, number>).sort(
    (a, b) => b.split(" ").length - a.split(" ").length,
  );

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.consumed || t.locked) continue;

    const hit = findPhrase(tokens, i, phrases);
    if (hit) {
      result.estimateMin = (lex.durationPhrase as Record<string, number>)[hit.phrase];
      consume(tokens, i, hit.len, "duration");
      continue;
    }

    // "90m" / "1.5j"
    const inline = parseDurationToken(t.norm);
    if (inline !== null) {
      result.estimateMin = inline;
      consume(tokens, i, 1, "duration");
      continue;
    }

    // "90 menit" / "2 jam"
    const num = /^(\d+(?:[.,]\d+)?)$/.exec(t.norm);
    const next = tokens[i + 1];
    if (num && next && !next.consumed && !next.locked) {
      const value = Number(num[1]!.replace(",", "."));
      if (next.norm === "menit" || next.norm === "mnt") {
        result.estimateMin = Math.round(value);
        consume(tokens, i, 2, "duration");
        continue;
      }
      if (next.norm === "jam") {
        // "2 jam" = durasi, tapi "jam 2" sudah beda urutan jadi aman
        result.estimateMin = Math.round(value * 60);
        consume(tokens, i, 2, "duration");
      }
    }
  }
}

// ── ⑥ pengulangan ────────────────────────────────────────────────────────────

const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

function applyRecurrence(tokens: Token[], result: ParseResult): void {
  const weekdays = lex.weekdays as Record<string, number>;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.consumed || t.locked) continue;
    if (t.norm !== "tiap" && t.norm !== "setiap") continue;

    let j = i + 1;
    const days: number[] = [];
    let rule: string | null = null;

    const peek = () => tokens[j];

    // "tiap hari kerja"
    if (peek()?.norm === "hari" && tokens[j + 1]?.norm === "kerja") {
      rule = "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
      j += 2;
    } else if (peek()?.norm === "hari") {
      rule = "FREQ=DAILY";
      j += 1;
    } else if (peek()?.norm === "tanggal") {
      const day = Number(tokens[j + 1]?.norm);
      if (Number.isInteger(day) && day >= 1 && day <= 31) {
        rule = `FREQ=MONTHLY;BYMONTHDAY=${day}`;
        j += 2;
      }
    } else if (peek()?.norm === "bulan") {
      rule = "FREQ=MONTHLY";
      j += 1;
    } else {
      // "tiap 2 minggu"
      const interval = Number(peek()?.norm);
      if (Number.isInteger(interval) && interval > 1) {
        const unit = tokens[j + 1]?.norm;
        if (unit === "minggu") {
          rule = `FREQ=WEEKLY;INTERVAL=${interval}`;
          j += 2;
        } else if (unit === "hari") {
          rule = `FREQ=DAILY;INTERVAL=${interval}`;
          j += 2;
        } else if (unit === "bulan") {
          rule = `FREQ=MONTHLY;INTERVAL=${interval}`;
          j += 2;
        }
      } else {
        // "tiap senin rabu jumat" / "tiap senin & kamis"
        while (j < tokens.length) {
          const cur = tokens[j]!;
          if (cur.norm === "dan" || cur.norm === "&") {
            j++;
            continue;
          }
          const wd = weekdays[cur.norm];
          if (wd === undefined) break;
          days.push(wd);
          j++;
        }
        if (days.length > 0) {
          rule = `FREQ=WEEKLY;BYDAY=${days.map((d) => BYDAY[d]).join(",")}`;
        } else if (peek()?.norm === "minggu") {
          rule = "FREQ=WEEKLY";
          j += 1;
        }
      }
    }

    if (rule) {
      result.recurrence = rule;
      consume(tokens, i, j - i, "recurrence");
    }
    return;
  }
}

// ── ⑦ tanggal ────────────────────────────────────────────────────────────────

function applyDate(tokens: Token[], now: Date): Date | null {
  const weekdays = lex.weekdays as Record<string, number>;
  const months = lex.months as Record<string, number>;
  let soft: Date | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.consumed || t.locked) continue;
    const n = t.norm;
    const next = tokens[i + 1];

    // relatif sederhana
    if (n === "hari" && next?.norm === "ini") {
      consume(tokens, i, 2, "date");
      return startOfDay(now);
    }
    if (n === "besok") {
      consume(tokens, i, 1, "date");
      return addDays(startOfDay(now), 1);
    }
    if (n === "lusa") {
      consume(tokens, i, 1, "date");
      return addDays(startOfDay(now), 2);
    }
    if (n === "akhirpekan") {
      consume(tokens, i, 1, "date");
      return nextWeekend(now);
    }
    if (n === "akhir" && next?.norm === "pekan") {
      consume(tokens, i, 2, "date");
      return nextWeekend(now);
    }
    if (n === "akhir" && next?.norm === "bulan") {
      consume(tokens, i, 2, "date");
      return endOfMonth(now);
    }
    if (n === "awal" && next?.norm === "bulan") {
      consume(tokens, i, 2, "date");
      return startOfNextMonth(now);
    }
    if (n === "minggu" && next?.norm === "depan") {
      consume(tokens, i, 2, "date");
      return nextWeek(now);
    }
    if (n === "bulan" && next?.norm === "depan") {
      consume(tokens, i, 2, "date");
      return addMonths(startOfDay(now), 1);
    }
    if (n === "nanti") {
      soft = startOfDay(now);
      consume(tokens, i, 1, "drop");
      continue;
    }

    // "3 hari lagi" / "dalam 2 minggu"
    const num = Number(n);
    if (Number.isInteger(num) && next && tokens[i + 2]?.norm === "lagi") {
      const unit = next.norm;
      const mult = unit === "hari" ? 1 : unit === "minggu" ? 7 : 0;
      if (mult) {
        consume(tokens, i, 3, "date");
        return addDays(startOfDay(now), num * mult);
      }
    }
    if (n === "dalam" && next) {
      const v = Number(next.norm);
      const unit = tokens[i + 2]?.norm;
      const mult = unit === "hari" ? 1 : unit === "minggu" ? 7 : 0;
      if (Number.isInteger(v) && mult) {
        consume(tokens, i, 3, "date");
        return addDays(startOfDay(now), v * mult);
      }
    }

    // "tanggal 25"
    if (n === "tanggal" && next) {
      const day = Number(next.norm);
      if (Number.isInteger(day) && day >= 1 && day <= 31) {
        // "tanggal 25 desember"
        const monthTok = tokens[i + 2];
        const month = monthTok ? months[monthTok.norm] : undefined;
        if (month) {
          consume(tokens, i, 3, "date");
          return nextDateOfYear(now, day, month);
        }
        consume(tokens, i, 2, "date");
        return nextMonthDay(now, day);
      }
    }

    // "25/12" atau "25/12/2027"
    const slash = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(n);
    if (slash) {
      const day = Number(slash[1]);
      const month = Number(slash[2]);
      if (day <= 31 && month <= 12) {
        consume(tokens, i, 1, "date");
        return nextDateOfYear(now, day, month, slash[3] ? Number(slash[3]) : undefined);
      }
    }

    // "25 des" / "25 desember 2027"
    if (Number.isInteger(num) && num >= 1 && num <= 31 && next) {
      const month = months[next.norm];
      if (month) {
        const yearTok = tokens[i + 2];
        const year = yearTok && /^\d{4}$/.test(yearTok.norm) ? Number(yearTok.norm) : undefined;
        consume(tokens, i, year ? 3 : 2, "date");
        return nextDateOfYear(now, num, month, year);
      }
    }

    // nama hari
    const wdIndex = n === "hari" && next ? weekdays[next.norm] : weekdays[n];
    if (wdIndex !== undefined) {
      const offset = n === "hari" ? 1 : 0;
      const modTok = tokens[i + offset + 1];
      let mode: "nearest" | "this" | "next" = "nearest";
      let len = offset + 1;
      if (modTok?.norm === "depan") {
        // "senin depan" = lompat ke minggu berikutnya, sengaja beda dari nearest
        mode = "next";
        len += 1;
      } else if (modTok?.norm === "ini") {
        mode = "this";
        len += 1;
      } else if (modTok?.norm === "besok" || modTok?.norm === "nanti") {
        // "senin besok" / "senin nanti" = penekanan doang, BUKAN "seminggu lagi".
        // Tetap nearest — Senin yang paling deket ke depan. (bug: dulu disamain
        // sama "depan" dan malah lompat 2 minggu)
        len += 1;
      }
      consume(tokens, i, len, "date");
      return nextWeekday(now, wdIndex, mode);
    }
  }

  return soft;
}

// ── ⑧ jam ────────────────────────────────────────────────────────────────────

function findMeridiem(tokens: Token[], from: number): { m: Meridiem; at: number } | null {
  const table = lex.meridiem as Record<string, Meridiem>;
  for (let k = from; k < Math.min(from + 2, tokens.length); k++) {
    const t = tokens[k];
    if (!t || t.consumed || t.locked) continue;
    const m = table[t.norm];
    if (m) return { m, at: k };
  }
  return null;
}

interface Clock {
  h: number;
  m: number;
}

interface ClockRead {
  clock: Clock;
  /** terisi kalau tokennya berbentuk rentang, mis. "10-11" atau "9-9.15" */
  end?: Clock;
  len: number;
  approx: boolean;
}

const RANGE_RE = /^(\d{1,2})(?:[:.](\d{2}))?-(\d{1,2})(?:[:.](\d{2}))?$/;

function readClock(tokens: Token[], i: number): ClockRead | null {
  const t = tokens[i];
  if (!t || t.consumed || t.locked) return null;
  const n = t.norm;

  // rentang dalam satu token: "2-4", "10-11", "9-9.15"
  const range = RANGE_RE.exec(n);
  if (range) {
    const sh = Number(range[1]);
    const eh = Number(range[3]);
    if (sh <= 23 && eh <= 23) {
      return {
        clock: { h: sh, m: range[2] ? Number(range[2]) : 0 },
        end: { h: eh, m: range[4] ? Number(range[4]) : 0 },
        len: 1,
        approx: false,
      };
    }
  }

  // "14:00" / "1.20"
  const hm = parseClockString(n);
  if (hm) return { clock: hm, len: 1, approx: false };

  // "3an"
  const approxNum = /^(\d{1,2})an$/.exec(n);
  if (approxNum) return { clock: { h: Number(approxNum[1]), m: 0 }, len: 1, approx: true };

  // "3" (+ "an")
  if (/^\d{1,2}$/.test(n)) {
    const h = Number(n);
    if (h > 23) return null;
    const nx = tokens[i + 1];
    if (nx && !nx.consumed && nx.norm === "an") {
      return { clock: { h, m: 0 }, len: 2, approx: true };
    }
    return { clock: { h, m: 0 }, len: 1, approx: false };
  }
  return null;
}

function applyTime(tokens: Token[], result: ParseResult, now: Date, dateAnchor: Date | null): void {
  const base = dateAnchor ?? startOfDay(now);
  const dayparts = lex.daypart as Record<string, string>;
  const daypartKeys = Object.keys(dayparts).sort((a, b) => b.split(" ").length - a.split(" ").length);

  const approxWords = new Set(lex.approx as string[]);
  let approxFlag = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.consumed || t.locked) continue;

    if (approxWords.has(t.norm)) {
      approxFlag = true;
      result.approxTime = true;
      consume(tokens, i, 1, "drop");
      continue;
    }

    // "setengah 3" → 02:30
    if (t.norm === "setengah") {
      const c = readClock(tokens, i + 1);
      if (c) {
        const rawHour = (c.clock.h + 23) % 24; // jam sebelumnya
        const mer = findMeridiem(tokens, i + 1 + c.len);
        const h = resolveHour(rawHour, mer?.m);
        applyClock(result, base, { h, m: 30 }, approxFlag || c.approx);
        consume(tokens, i, 1 + c.len, "time");
        if (mer) consume(tokens, mer.at, 1, "time");
        return;
      }
    }

    if (t.norm === "jam" || t.norm === "pukul") {
      const c = readClock(tokens, i + 1);
      if (!c) continue;
      let len = 1 + c.len;
      let clock = c.clock;
      let endClock = c.end;

      // "jam 3 lewat 15" / "jam 3 kurang 10"
      const opTok = tokens[i + len];
      const opVal = Number(tokens[i + len + 1]?.norm);
      if (opTok?.norm === "lewat" && Number.isInteger(opVal)) {
        clock = { h: clock.h, m: opVal };
        len += 2;
      } else if (opTok?.norm === "kurang" && Number.isInteger(opVal)) {
        const total = clock.h * 60 - opVal;
        clock = {
          h: Math.floor(((total % 1440) + 1440) / 60) % 24,
          m: ((total % 60) + 60) % 60,
        };
        len += 2;
      }

      // rentang terpisah: "jam 2 sampai 4"
      if (!endClock) {
        const tail = readRangeEnd(tokens, i + len);
        if (tail) {
          endClock = tail.clock;
          len += tail.len;
        }
      }

      const mer = findMeridiem(tokens, i + len);
      const h = resolveHour(clock.h, mer?.m);
      applyClock(result, base, { h, m: clock.m }, c.approx || approxFlag);
      consume(tokens, i, len, "time");
      if (mer) consume(tokens, mer.at, 1, "time");

      if (endClock) {
        const endH = resolveHour(endClock.h, mer?.m);
        const startMs = setTime(base, h, clock.m).getTime();
        const endMs = setTime(base, endH, endClock.m).getTime();
        if (endMs > startMs) {
          result.startAt = new Date(startMs);
          result.endAt = new Date(endMs);
          result.estimateMin ??= Math.round((endMs - startMs) / 60000);
        }
      }
      return;
    }

    // "14:00" tanpa kata "jam"
    const bare = parseClockString(t.norm);
    if (bare) {
      const mer = findMeridiem(tokens, i + 1);
      const h = resolveHour(bare.h, mer?.m);
      applyClock(result, base, { h, m: bare.m }, approxFlag);
      consume(tokens, i, 1, "time");
      if (mer) consume(tokens, mer.at, 1, "time");
      return;
    }

    // "8 malam" → angka + meridiem langsung
    if (/^\d{1,2}$/.test(t.norm)) {
      const merTable = lex.meridiem as Record<string, Meridiem>;
      const nx = tokens[i + 1];
      if (nx && !nx.consumed && !nx.locked && merTable[nx.norm]) {
        const h = resolveHour(Number(t.norm), merTable[nx.norm]);
        applyClock(result, base, { h, m: 0 }, approxFlag);
        consume(tokens, i, 2, "time");
        return;
      }
    }

    // daypart berdiri sendiri: "besok pagi"
    const dp = findPhrase(tokens, i, daypartKeys);
    if (dp) {
      const hm = parseClockString(dayparts[dp.phrase]!);
      if (hm) {
        applyClock(result, base, hm, approxFlag);
        consume(tokens, i, dp.len, "time");
        return;
      }
    }
  }

  // gak ada jam sama sekali → tanggal saja (all-day)
  if (dateAnchor) {
    result.dueAt = dateAnchor;
    result.allDay = true;
  }
}

/** Bentuk terpisah: "sampai 4" / "- 4". Bentuk gabungan "2-4" ada di readClock. */
function readRangeEnd(tokens: Token[], i: number): { clock: Clock; len: number } | null {
  const t = tokens[i];
  if (!t || t.consumed || t.locked) return null;
  if (t.norm !== "sampai" && t.norm !== "-") return null;

  let offset = 1;
  if (tokens[i + 1]?.norm === "jam") offset = 2; // "sampai jam 4"
  const c = readClock(tokens, i + offset);
  return c ? { clock: c.clock, len: offset + c.len } : null;
}

function applyClock(result: ParseResult, base: Date, clock: Clock, approx: boolean): void {
  result.dueAt = setTime(base, clock.h, clock.m);
  result.allDay = false;
  if (approx) result.approxTime = true;
}

// ── prioritas dari kata ──────────────────────────────────────────────────────

/**
 * Mendukung frasa multi-kata ("prioritas utama", "nanti aja"), bukan cuma
 * token tunggal — sebelumnya kunci berspasi di priorityWords gak pernah kena
 * karena dicocokkan ke satu token utuh yang gak mungkin punya spasi.
 */
function applyPriorityWords(tokens: Token[], result: ParseResult): void {
  const table = lex.priorityWords as Record<string, number>;
  const phrases = Object.keys(table);

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.consumed || t.locked) continue;
    const hit = findPhrase(tokens, i, phrases);
    if (!hit) continue;
    result.priority ??= table[hit.phrase] as Priority;
    consume(tokens, i, hit.len, "priority");
  }
}

// ── ⑨ judul ──────────────────────────────────────────────────────────────────

function buildTitle(tokens: Token[]): string {
  const words = firstFree(tokens).map((t) => t.display);
  const title = words.join(" ").replace(/\s+/g, " ").trim();
  if (title === "") return "";
  return title.charAt(0).toUpperCase() + title.slice(1);
}

// ── kandidat "Ajarin" (§6.1.7) ───────────────────────────────────────────────

let knownWordsCache: string[] | null = null;

function knownWords(): string[] {
  if (knownWordsCache) return knownWordsCache;
  knownWordsCache = [
    ...Object.keys(lex.slang),
    ...(lex.drop as string[]),
    ...(lex.filler as string[]),
    ...Object.keys(lex.weekdays),
    ...Object.keys(lex.daypart),
    ...Object.keys(lex.months),
  ].filter((w) => w.length >= 3 && !w.includes(" "));
  return knownWordsCache;
}

function editDistanceAtMost1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++diff > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else {
      i++;
      j++;
    }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Kata yang mirip entri kamus tapi gak persis — kemungkinan varian atau typo
 * yang belum kekenal. Ini yang muncul di layar "Kata yang belum dikenali".
 */
function findNearMisses(tokens: Token[]): string[] {
  const out: string[] = [];
  for (const t of firstFree(tokens)) {
    if (t.locked || t.norm.length < 3) continue;
    if (knownWords().some((w) => w !== t.norm && editDistanceAtMost1(w, t.norm))) {
      out.push(t.norm);
    }
  }
  return out;
}
