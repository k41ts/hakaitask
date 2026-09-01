/**
 * Rentang tanggal buat query chat — PLAN-CHAT.md §6
 *
 * Beda mendasar dari `applyDate()` di parser: yang di sana balikin **satu
 * titik** waktu buat dipasang ke sebuah task ("besok jam 3" → satu timestamp),
 * yang di sini balikin **interval** buat menyaring ("besok" → seharian besok).
 *
 * Semua interval **setengah terbuka**: `[from, to)`. Bentuk ini bikin
 * perbandingan batas gak pernah salah hitung — sebuah agenda tepat jam 00:00
 * masuk ke hari itu, bukan ke dua-duanya.
 *
 * Minggu dimulai **Senin** (keputusan P2).
 */
import lex from "../parser/lexicon.id.json";
import chatLex from "./lexicon.chat.id.json";
import {
  addDays,
  nextDateOfYear,
  parseClockString,
  resolveHour,
  startOfDay,
  type Meridiem,
} from "../parser/datetime.js";
import { findLongest, words } from "./match.js";

export interface DateRange {
  from: Date;
  /** Eksklusif. */
  to: Date;
  /** Label manusiawi buat balasan: "besok", "minggu ini", "Senin". */
  label: string;
}

const WEEKDAYS = lex.weekdays as Record<string, number>;
const MONTHS = lex.months as Record<string, number>;
// Impor JSON menyimpulkan `number[]`, bukan tuple — jadi panjangnya dicek
// saat dipakai, bukan dipaksa lewat cast yang bohong.
const DAYPART = chatLex.daypartRange as Record<string, number[]>;

const WEEKDAY_LABEL = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

// ── helper ───────────────────────────────────────────────────────────────────

/** Senin pada minggu yang memuat `d` (keputusan P2). */
export function startOfWeek(d: Date): Date {
  const base = startOfDay(d);
  return addDays(base, -((base.getDay() + 6) % 7));
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonthsRaw(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function dayRange(d: Date, label: string): DateRange {
  const from = startOfDay(d);
  return { from, to: addDays(from, 1), label };
}

function spanRange(from: Date, days: number, label: string): DateRange {
  return { from, to: addDays(from, days), label };
}

/** Hari `weekday` terdekat ke belakang. Hari ini gak dihitung. */
function prevWeekday(now: Date, weekday: number): Date {
  const base = startOfDay(now);
  const delta = (base.getDay() - weekday + 7) % 7;
  return addDays(base, -(delta === 0 ? 7 : delta));
}

/**
 * Hari `weekday` terdekat ke depan. Sengaja mengulang aturan `nextWeekday()`
 * di parser — termasuk "hari ini Senin & user bilang 'senin' berarti Senin
 * depan" — biar chat dan quick-add gak pernah beda tafsir.
 */
function comingWeekday(now: Date, weekday: number, mode: "nearest" | "this" | "next"): Date {
  const base = startOfDay(now);
  let delta = (weekday - base.getDay() + 7) % 7;
  if (mode === "nearest") {
    if (delta === 0) delta = 7;
  } else if (mode === "next") {
    delta = delta === 0 ? 7 : delta + 7;
  }
  return addDays(base, delta);
}

function isSingleDay(r: DateRange): boolean {
  return r.to.getTime() - r.from.getTime() <= 86_400_000;
}

// ── daypart ──────────────────────────────────────────────────────────────────

const DAYPART_KEYS = Object.keys(DAYPART).sort(
  (a, b) => b.split(" ").length - a.split(" ").length,
);

/**
 * Persempit rentang satu hari ke bagian harinya: "besok pagi".
 * Sengaja cuma berlaku buat rentang satu hari — "minggu ini pagi" itu bukan
 * kalimat yang berarti apa-apa, dan mempersempitnya diam-diam malah nyesatin.
 */
function narrowByDaypart(range: DateRange, part: string): DateRange {
  const span = DAYPART[part];
  if (!span || span.length < 2 || !isSingleDay(range)) return range;
  const h1 = span[0]!;
  const h2 = span[1]!;
  const from = new Date(range.from);
  from.setHours(h1, 0, 0, 0);
  const to = new Date(range.from);
  if (h2 >= 24) to.setHours(24, 0, 0, 0);
  else to.setHours(h2, 0, 0, 0);
  return { from, to, label: `${range.label} ${part}` };
}

// ── pembacaan ────────────────────────────────────────────────────────────────

export interface RangeHit {
  range: DateRange;
  len: number;
  /**
   * true kalau yang cocok CUMA kata bagian hari, tanpa acuan hari sama sekali
   * ("malam"), bukan "besok malam".
   *
   * Penting karena kata begini sering jadi bagian JUDUL, bukan penyaring:
   * "makan malam", "shift malam", "lari pagi". Pemanggil yang punya konteks
   * kalimatnya yang mutusin mau dipakai atau enggak.
   */
  bareDaypart?: boolean;
}

/** Coba baca rentang mulai dari kata ke-`i`. */
export function readRange(ws: readonly string[], i: number, now: Date): RangeHit | null {
  const base = readDayAnchor(ws, i, now);
  if (!base) return null;

  // Daypart yang nempel di belakang: "besok pagi", "senin sore"
  const after = i + base.len;
  const part = findLongest(ws, after, DAYPART_KEYS);
  if (part && isSingleDay(base.range)) {
    return {
      range: narrowByDaypart(base.range, part.phrase),
      len: base.len + part.len,
    };
  }
  return base;
}

function readDayAnchor(ws: readonly string[], i: number, now: Date): RangeHit | null {
  const w = ws[i];
  if (w === undefined) return null;
  const n1 = ws[i + 1];
  const n2 = ws[i + 2];

  // ── "hari ini" ─────────────────────────────────────────────────────────────
  if (w === "hari" && n1 === "ini") return { range: dayRange(now, "hari ini"), len: 2 };

  // ── "hari senin" — bentuk eksplisit, nyingkirin ambiguitas "minggu" ────────
  if (w === "hari" && n1 !== undefined && WEEKDAYS[n1] !== undefined) {
    const wd = WEEKDAYS[n1]!;
    const mod = readWeekModifier(n2);
    const d = mod === "lalu" ? prevWeekday(now, wd) : comingWeekday(now, wd, weekdayMode(mod));
    return { range: dayRange(d, WEEKDAY_LABEL[wd]!), len: mod ? 3 : 2 };
  }

  // ── "minggu ini" / "minggu depan" / "minggu lalu" ─────────────────────────
  // WAJIB dicek sebelum nama hari: `minggu` juga berarti hari Minggu (nilai 0
  // di lexicon). Aturannya sama persis kayak parser lama — `minggu` diikuti
  // pengubah berarti pekan, `minggu` sendirian berarti hari Minggu.
  if (w === "minggu") {
    const mod = readWeekModifier(n1);
    if (mod === "ini") return { range: spanRange(startOfWeek(now), 7, "minggu ini"), len: 2 };
    if (mod === "depan") {
      return { range: spanRange(addDays(startOfWeek(now), 7), 7, "minggu depan"), len: 2 };
    }
    if (mod === "lalu") {
      return { range: spanRange(addDays(startOfWeek(now), -7), 7, "minggu lalu"), len: 2 };
    }
  }

  // ── "bulan ini" / "bulan depan" / "bulan lalu" ────────────────────────────
  if (w === "bulan") {
    const mod = readWeekModifier(n1);
    if (mod === "ini") {
      const from = startOfMonth(now);
      return { range: { from, to: addMonthsRaw(now, 1), label: "bulan ini" }, len: 2 };
    }
    if (mod === "depan") {
      return {
        range: { from: addMonthsRaw(now, 1), to: addMonthsRaw(now, 2), label: "bulan depan" },
        len: 2,
      };
    }
    if (mod === "lalu") {
      return {
        range: { from: addMonthsRaw(now, -1), to: startOfMonth(now), label: "bulan lalu" },
        len: 2,
      };
    }
  }

  // ── relatif satu kata ─────────────────────────────────────────────────────
  if (w === "besok") return { range: dayRange(addDays(now, 1), "besok"), len: 1 };
  if (w === "lusa") return { range: dayRange(addDays(now, 2), "lusa"), len: 1 };
  if (w === "kemarin" || w === "semalam" || w === "semalem") {
    return { range: dayRange(addDays(now, -1), "kemarin"), len: 1 };
  }
  if (w === "sekarang") return { range: dayRange(now, "hari ini"), len: 1 };

  // ── nama hari ─────────────────────────────────────────────────────────────
  const wd = WEEKDAYS[w];
  if (wd !== undefined) {
    const mod = readWeekModifier(n1);
    const d = mod === "lalu" ? prevWeekday(now, wd) : comingWeekday(now, wd, weekdayMode(mod));
    return { range: dayRange(d, WEEKDAY_LABEL[wd]!), len: mod ? 2 : 1 };
  }

  // ── "tanggal 25" / "tanggal 25 desember" ──────────────────────────────────
  if (w === "tanggal" || w === "tgl") {
    const day = Number(n1);
    if (Number.isInteger(day) && day >= 1 && day <= 31) {
      const month = n2 !== undefined ? MONTHS[n2] : undefined;
      if (month) {
        return { range: dayRange(nextDateOfYear(now, day, month), `${day} ${n2}`), len: 3 };
      }
      return { range: dayRange(nextMonthDayLocal(now, day), `tanggal ${day}`), len: 2 };
    }
  }

  // ── "25 des" / "25 desember" ──────────────────────────────────────────────
  const dayNum = Number(w);
  if (Number.isInteger(dayNum) && dayNum >= 1 && dayNum <= 31 && n1 !== undefined) {
    const month = MONTHS[n1];
    if (month) {
      return { range: dayRange(nextDateOfYear(now, dayNum, month), `${dayNum} ${n1}`), len: 2 };
    }
  }

  // ── daypart berdiri sendiri: "pagi" = pagi ini ────────────────────────────
  const part = findLongest(ws, i, DAYPART_KEYS);
  if (part) {
    return {
      range: narrowByDaypart(dayRange(now, "hari ini"), part.phrase),
      len: part.len,
      bareDaypart: true,
    };
  }

  return null;
}

/**
 * `tekanan` = kata penegas yang dikonsumsi tapi TIDAK menggeser minggu.
 *
 * "rabu besok" itu penekanan ("Rabu, yang besok itu lho"), bukan "Rabu minggu
 * depan" — persis aturan yang udah dipegang `applyDate()` di parser dan pernah
 * dibenerin khusus di commit "Benerin bug tanggal 'senin besok'". Sempat
 * kebalik di sini dan bikin "jadwal hari rabu besok" ngelompat sepekan.
 */
function readWeekModifier(w: string | undefined): "ini" | "depan" | "lalu" | "tekanan" | null {
  if (w === "ini") return "ini";
  if (w === "depan") return "depan";
  if (w === "besok" || w === "nanti") return "tekanan";
  if (w === "lalu" || w === "kemarin" || w === "kemaren") return "lalu";
  return null;
}

/**
 * Pengubah dari bahasa user → mode `comingWeekday`. Sengaja jadi fungsi
 * sendiri: sebelumnya "depan" dioper mentah sebagai mode, dan karena bukan
 * nilai yang dikenal, dua-duanya luput lalu jatuh diam-diam ke `nearest` —
 * "senin depan" jadi sama persis dengan "senin".
 */
function weekdayMode(
  mod: "ini" | "depan" | "lalu" | "tekanan" | null,
): "nearest" | "this" | "next" {
  if (mod === "ini") return "this";
  if (mod === "depan") return "next";
  return "nearest";
}

/** Tanggal N bulan berjalan; kalau udah lewat, lompat ke bulan depan. */
function nextMonthDayLocal(now: Date, day: number): Date {
  const base = startOfDay(now);
  const candidate = new Date(base.getFullYear(), base.getMonth(), day);
  if (candidate.getTime() < base.getTime()) {
    return new Date(base.getFullYear(), base.getMonth() + 1, day);
  }
  return candidate;
}

// ── API tingkat kalimat ──────────────────────────────────────────────────────

/** Rentang pertama yang ketemu di kalimat, beserta posisi & panjangnya. */
/**
 * Rentang pertama yang ketemu di kalimat.
 *
 * `accept` dipakai pemanggil buat menolak kecocokan yang secara konteks bukan
 * penyaring waktu — dan pencarian LANJUT ke posisi berikutnya, bukan berhenti.
 * Tanpa itu, "selesaikan makan malam besok" bakal kehilangan "besok" gara-gara
 * "malam" ditolak duluan.
 */
export function findRange(
  ws: readonly string[],
  now: Date,
  accept?: (hit: RangeHit & { at: number }) => boolean,
): (RangeHit & { at: number }) | null {
  for (let i = 0; i < ws.length; i++) {
    const hit = readRange(ws, i, now);
    if (!hit) continue;
    const withPos = { ...hit, at: i };
    if (accept && !accept(withPos)) continue;
    return withPos;
  }
  return null;
}

/** Bentuk praktis buat tes & pemakaian cepat. */
export function resolveDateRange(input: string, now: Date): DateRange | null {
  return findRange(words(input), now)?.range ?? null;
}

/**
 * SEMUA rentang yang kesebut di kalimat, bukan cuma yang pertama.
 *
 * Dipakai waktu user jawab "yang mana?" pakai tanggal: "senin 10 agustus"
 * nyebut dua acuan sekaligus, dan yang cocok sama kandidatnya bisa yang mana
 * aja — jadi dua-duanya harus dicoba.
 */
export function findAllRanges(ws: readonly string[], now: Date): (RangeHit & { at: number })[] {
  const out: (RangeHit & { at: number })[] = [];
  for (let i = 0; i < ws.length; ) {
    const hit = readRange(ws, i, now);
    if (hit) {
      out.push({ ...hit, at: i });
      i += hit.len;
      continue;
    }
    i += 1;
  }
  return out;
}

/**
 * Jam eksplisit di kalimat: "jam 3", "jam 14:30", "09:00".
 *
 * Dipisah dari `readRange` karena perannya beda: rentang menjawab "hari
 * mana", jam menjawab "titik mana di hari itu". Pertanyaan ketersediaan
 * ("besok jam 3 kosong ga?") butuh dua-duanya — tanpa ini, yang kecek malah
 * seharian penuh dan jawabannya jadi salah.
 *
 * Aturan jam ambigunya sengaja ikut `resolveHour()` yang sama dengan
 * quick-add: `jam 3` = 15:00, `jam 9` = 09:00.
 */
export function findClock(ws: readonly string[]): { h: number; m: number } | null {
  const meridiem = lex.meridiem as Record<string, Meridiem>;

  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]!;
    let clock: { h: number; m: number } | null = null;
    let after = i + 1;

    if (w === "jam" || w === "pukul") {
      const v = ws[i + 1];
      if (v === undefined) continue;
      const hm = parseClockString(v);
      if (hm) {
        clock = hm;
        after = i + 2;
      } else if (/^\d{1,2}$/.test(v) && Number(v) <= 23) {
        clock = { h: Number(v), m: 0 };
        after = i + 2;
      }
    } else {
      const hm = parseClockString(w);
      if (hm) clock = hm;
    }

    if (!clock) continue;
    const mer = meridiem[ws[after] ?? ""];
    return { h: resolveHour(clock.h, mer), m: clock.m };
  }
  return null;
}

/** Persempit rentang jadi satu titik waktu — buat cek ketersediaan. */
export function atClock(range: DateRange, clock: { h: number; m: number }): DateRange {
  const from = new Date(range.from);
  from.setHours(clock.h, clock.m, 0, 0);
  const hh = String(clock.h).padStart(2, "0");
  const mm = String(clock.m).padStart(2, "0");
  return {
    from,
    // Selebar satu milidetik: agenda yang berakhir TEPAT di jam ini gak
    // dihitung nabrak, tapi yang lagi berlangsung tetap kena.
    to: new Date(from.getTime() + 1),
    label: `${range.label} jam ${hh}.${mm}`,
  };
}

/** Rentang default kalau user gak nyebut waktu sama sekali: "yang akan datang". */
export function upcomingRange(now: Date): DateRange {
  return { from: now, to: new Date(8.64e15), label: "ke depan" };
}

export function inRange(iso: string | undefined, r: DateRange): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= r.from.getTime() && t < r.to.getTime();
}

/**
 * Tumpang-tindih dua interval — buat agenda yang punya durasi.
 *
 * Ini yang harus dipakai buat `busy_blocks`, BUKAN `sameDay(startAt)` seperti
 * `blocksOnDate()` sekarang: agenda 23:00–01:00 kepotong tengah malam, dan
 * agenda berulang gak pernah muncul di hari berikutnya (PLAN-CHAT T8/E19).
 */
export function overlapsRange(startIso: string, endIso: string, r: DateRange): boolean {
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  return s < r.to.getTime() && e > r.from.getTime();
}
