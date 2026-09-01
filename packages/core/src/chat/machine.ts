/**
 * Mesin satu giliran percakapan — PLAN-CHAT.md §18
 *
 * `chatTurn()` MURNI: dia gak nyentuh store, gak manggil jaringan, gak bikin
 * id. Dia baca keadaan, lalu balikin **deskripsi** perubahan (`effects`) yang
 * dijalankan lapisan app. Dua akibat yang bikin ini sepadan:
 *
 *   1. Seluruh perilaku chat bisa dites tanpa React, tanpa DOM, tanpa jaringan.
 *   2. Semua tulisan tetap lewat satu pintu (store → outbox → sync), jadi chat
 *      gak bikin jalur tulis kedua yang bisa lolos dari offline-first.
 */
import type { BusyBlock, Task } from "../types.js";
import { parseQuickAdd, type ParseResult } from "../parser/index.js";
import { greetingSlot } from "../scoring.js";
import {
  analyzeWords,
  isKnownWord,
  isThanks,
  readVerb,
  type ChatAnalysis,
  type ObjectKind,
  type Verb,
} from "./intent.js";
import { findLongest, words } from "./match.js";
import { queryItems, taskTime, type QueryContext, type QueryFilter } from "./query.js";
import { expandBlocks } from "./recur.js";
import {
  atClock,
  findAllRanges,
  findClock,
  inRange,
  readRange,
  upcomingRange,
  type DateRange,
} from "./range.js";
import { resolveTarget, stillExists, type Ref } from "./resolve.js";
import * as R from "./respond.js";
import {
  expandVocab,
  guessType,
  normalizePhrase,
  validateTeach,
  type AppliedExpansion,
  type VocabEntry,
} from "./vocab.js";
import chatLex from "./lexicon.chat.id.json";

const ORDINALS = chatLex.ordinals as Record<string, number>;
const ORDINAL_PREFIX = chatLex.ordinalPrefix as string[];
const AFFIRM = chatLex.affirm as string[];
const DENY = chatLex.deny as string[];
const TEACH_SEP = chatLex.teachSeparators as string[];
const TEACH_TRIGGER = chatLex.teachTriggers as string[];

/** Pending kedaluwarsa 5 menit — nanya "yang mana?" atas daftar sejam lalu itu ngeselin. */
export const PENDING_TTL_MS = 5 * 60_000;

// ── tipe ─────────────────────────────────────────────────────────────────────

export type Effect =
  | { type: "CREATE_FROM_PARSE"; parsed: ParseResult }
  | { type: "PATCH_TASK"; id: string; patch: Partial<Task> }
  | { type: "PATCH_BUSY"; id: string; patch: Partial<BusyBlock> }
  | { type: "DELETE_TASK"; id: string }
  | { type: "DELETE_BUSY"; id: string }
  | { type: "RESTORE_TASK"; id: string }
  | { type: "SAVE_VOCAB"; phrase: string; meaning: string; vocabType: string }
  | { type: "DELETE_VOCAB"; id: string };

export interface ChatMessage {
  role: "user" | "system";
  text: string;
  /** Item yang bisa diketuk buat buka detail (§11). */
  refs?: Ref[];
  /** Tombol balas cepat. */
  choices?: string[];
}

interface PendingAction {
  verb: Verb;
  target?: Ref;
  /** Tujuan RESCHEDULE kalau harinya disebut. */
  to?: DateRange;
  /**
   * Tujuan RESCHEDULE kalau user cuma nyebut JAM ("jadi jam 9").
   *
   * Sengaja belum dijadikan tanggal di sini: harinya baru ketahuan setelah
   * targetnya kepilih. "jam 4" artinya jam 4 di hari agenda itu sendiri,
   * bukan jam 4 hari ini.
   */
  toClock?: { h: number; m: number };
}

export type Pending =
  | { kind: "choose"; action: PendingAction; refs: Ref[]; at: number }
  | { kind: "confirm"; action: PendingAction; refs: Ref[]; at: number }
  | { kind: "fillTime"; action: PendingAction; at: number }
  | { kind: "undo"; refs: Ref[]; at: number }
  | { kind: "teach"; step: "phrase" | "meaning" | "confirm"; phrase?: string; meaning?: string; at: number }
  | { kind: "offerTeach"; term: string; at: number }
  /** Kalimat yang kelihatan kayak judul tapi tanpa aba-aba bikin. */
  | { kind: "confirmCreate"; input: string; at: number }
  | null;

export interface ChatContext extends QueryContext {
  vocab: readonly VocabEntry[];
  pending: Pending;
  userName: string;
  /**
   * Rentang tanggal yang lagi dibahas, dibawa dari giliran sebelumnya.
   *
   * Bikin "hapus semua task di hari itu" bisa nyambung ke "jadwal gw hari
   * Senin" yang baru ditanya. Ini SATU-SATUNYA konteks yang dibawa antar
   * giliran selain pending — sengaja dibatasi, karena tiap potongan konteks
   * tersembunyi bikin sistem makin susah ditebak.
   */
  lastRange?: DateRange;
}

export interface TurnResult {
  messages: ChatMessage[];
  effects: Effect[];
  pending: Pending;
  /** Diteruskan app ke giliran berikutnya sebagai `ctx.lastRange`. */
  lastRange?: DateRange;
}

// ── bantu ────────────────────────────────────────────────────────────────────

function say(text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { role: "system", text, ...extra };
}

function result(
  messages: ChatMessage[],
  effects: Effect[] = [],
  pending: Pending = null,
): TurnResult {
  return { messages, effects, pending };
}

function alive(p: Pending, now: Date): Pending {
  if (!p) return null;
  return now.getTime() - p.at <= PENDING_TTL_MS ? p : null;
}

/**
 * Sebutan buat isi hari. Task & jadwal udah disatuin, jadi defaultnya
 * "agenda" — kata yang di bahasa sehari-hari nyakup dua-duanya.
 */
function whatOf(kind: ObjectKind): string {
  return kind === "task" ? "task" : kind === "schedule" ? "jadwal" : "agenda";
}

const TOPIC_GENERIC = chatLex.topicGeneric as Record<string, string[]>;

/**
 * Kata kunci dibuang kalau isinya cuma kata GENERIK dari topiknya.
 *
 * "hapus semua meeting minggu ini" → topik `rapat`, kata kunci `meeting`.
 * Kalau dua-duanya dipakai, "Sync tim" lolos topik tapi gugur di kata kunci,
 * jadi cuma separuh hasil yang kena.
 *
 * Tapi cuma yang GENERIK yang boleh dibuang. Dulu dicek ke seluruh daftar
 * sinonim, dan itu bikin "tampilin agenda zoom gw" ikut ngebuang "zoom" lalu
 * nampilin SEMUA rapat — padahal user minta yang Zoom doang.
 */
function keywordAddsNothing(keyword: string, topic: string | undefined): boolean {
  if (!topic || !keyword) return false;
  const generic = TOPIC_GENERIC[topic];
  if (!generic) return false;
  return words(keyword).every((w) => generic.includes(w));
}

function filterOf(a: ChatAnalysis): QueryFilter {
  const dropKeyword = keywordAddsNothing(a.keyword, a.topic);
  return {
    ...(a.kind !== "any" ? { kind: a.kind } : {}),
    ...(a.range ? { range: a.range } : {}),
    ...(a.status ? { status: a.status } : {}),
    ...(a.topic ? { topic: a.topic } : {}),
    ...(a.keyword && !dropKeyword ? { keyword: a.keyword } : {}),
    // "semua" bikin jendela default jadwal ikut narik yang udah lewat.
    ...(a.bulk ? { includePast: true } : {}),
  };
}

function readOrdinal(ws: readonly string[]): number | null {
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]!;
    if (ORDINAL_PREFIX.includes(w)) {
      const next = ws[i + 1];
      if (next === undefined) continue;
      const n = Number(next);
      if (Number.isInteger(n) && n > 0) return n;
      const named = ORDINALS[next];
      if (named) return named;
      continue;
    }
    const n = Number(w);
    if (ws.length === 1 && Number.isInteger(n) && n > 0) return n;
    const named = ORDINALS[w];
    if (named && ws.length <= 2) return named;
  }
  return null;
}

function isAffirm(ws: readonly string[]): boolean {
  return ws.some((_, i) => findLongest(ws, i, AFFIRM) !== null);
}

function isDeny(ws: readonly string[]): boolean {
  return ws.some((_, i) => findLongest(ws, i, DENY) !== null);
}

// ── titik masuk ──────────────────────────────────────────────────────────────

/** "hari itu", "tanggal tsb" — nunjuk balik ke hari yang barusan dibahas. */
function mentionsPreviousDay(ws: readonly string[]): boolean {
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]!;
    if (w === "tsb" || w === "tersebut") return true;
    if (w === "hari" || w === "tanggal") {
      const next = ws[i + 1];
      if (next === "itu" || next === "tsb" || next === "tersebut") return true;
    }
  }
  return false;
}

export function chatTurn(input: string, ctx: ChatContext): TurnResult {
  const turn = runTurn(input, ctx);
  // Rentang yang dipakai giliran ini jadi acuan "hari itu" berikutnya.
  return turn.lastRange === undefined && ctx.lastRange
    ? { ...turn, lastRange: ctx.lastRange }
    : turn;
}

function runTurn(input: string, ctx: ChatContext): TurnResult {
  const raw = words(input);
  if (raw.length === 0) return result([]);

  const pending = alive(ctx.pending, ctx.now);

  // ⓪ Pending selalu diperiksa DULUAN. "1" harus kebaca sebagai pilihan,
  //    bukan sebagai jam satu (§8.1, E5).
  if (pending) {
    const handled = handlePending(raw, pending, ctx);
    if (handled) return handled;
  }

  // ③ Kamus pribadi, sekali jalan, sebelum deteksi intent (PLAN-VOCAB §5.2).
  //
  // Kecuali kalau perintahnya TENTANG kamus itu sendiri: "hapus vocabulary
  // clientan" bakal jadi "hapus vocabulary meeting client" kalau diekspansi,
  // dan entri yang mau dihapus jadi gak ketemu selamanya. Kamus gak boleh
  // ngutak-atik perintah yang ngurus kamus.
  const rawAnalysis = analyzeWords(raw, ctx.now);
  const aboutVocab = rawAnalysis.kind === "vocab";

  const { words: expanded, applied } = aboutVocab
    ? { words: [...raw], applied: [] as AppliedExpansion[] }
    : expandVocab(raw, ctx.vocab);
  const parsed = aboutVocab ? rawAnalysis : analyzeWords(expanded, ctx.now);

  // Anafora: "di hari itu" ngambil rentang dari giliran sebelumnya.
  const a: ChatAnalysis =
    parsed.range === undefined && ctx.lastRange && mentionsPreviousDay(raw)
      ? { ...parsed, range: ctx.lastRange }
      : parsed;

  // Mengajarkan kamus diperiksa sebelum rute biasa: kalimatnya ngandung kata
  // kerja lain ("kalau gw bilang hapus…") yang bisa nyulik rutenya.
  const teach = readTeachSentence(raw);
  if (teach || a.verb === "teach") {
    return startTeach(teach, ctx);
  }

  const out = route(a, input, expanded, applied, ctx);
  return a.range ? { ...out, lastRange: a.range } : out;
}

function route(
  a: ChatAnalysis,
  input: string,
  expanded: readonly string[],
  applied: AppliedExpansion[],
  ctx: ChatContext,
): TurnResult {
  switch (a.verb) {
    case "list":
      return doList(a, ctx, applied);
    case "create":
      return doCreate(input, ctx);
    case "complete":
    case "uncomplete":
      return doComplete(a, ctx);
    case "delete":
      return doDelete(a, ctx);
    case "reschedule":
      return doReschedule(a, expanded, ctx);
    case "availability":
      return doAvailability(a, expanded, ctx);
    case "help":
      return result([say(R.help())]);
    case "chitchat":
      return result([say(R.chitchat(isThanks(expanded)))]);
    case "maybeCreate":
      return doMaybeCreate(input, ctx);
    default:
      return result([say(R.unknown())]);
  }
}

/**
 * Bikin task, tapi minta izin dulu.
 *
 * Dipakai buat kalimat yang gak punya aba-aba apa pun — bukan pertanyaan,
 * bukan basa-basi, dan gak nyebut waktu. "beli kopi" kemungkinan besar emang
 * mau disimpen, tapi "yg bener aje" jelas enggak, dan sistem gak punya cara
 * mbedain keduanya tanpa nebak. Jadi jangan nebak: tanya.
 */
function doMaybeCreate(input: string, ctx: ChatContext): TurnResult {
  const preview = parseQuickAdd(input, { now: ctx.now });
  const punyaWaktu = (preview.startAt ?? preview.dueAt) !== undefined;
  const title = cleanTitle(preview.title, {
    hasTime: punyaWaktu,
    hasDate: punyaWaktu,
    now: ctx.now,
  });
  if (!/\p{L}/u.test(title)) return result([say(R.unknown())]);

  return result([say(R.askConfirmCreate(title), { choices: ["ya", "batal"] })], [], {
    kind: "confirmCreate",
    input,
    at: ctx.now.getTime(),
  });
}

// ── pending ──────────────────────────────────────────────────────────────────

function handlePending(ws: readonly string[], p: Pending, ctx: ChatContext): TurnResult | null {
  if (!p) return null;

  if (p.kind === "teach") return handleTeachStep(ws, p, ctx);

  if (p.kind === "offerTeach") {
    if (isDeny(ws)) return result([say("Oke, gak jadi.")]);
    // Tombolnya berbunyi `ajarin "clientan"` — bukan kata "ya". Kalau cuma
    // ngecek affirm, ketukan itu bakal nyasar ke mode dipandu dan nanyain
    // ulang istilah yang JUSTRU baru aja disebut user.
    const accepted = isAffirm(ws) || ws.includes("ajarin") || ws.includes(p.term);
    if (accepted) {
      return result(
        [say(R.askTeachMeaning(p.term))],
        [],
        { kind: "teach", step: "meaning", phrase: p.term, at: ctx.now.getTime() },
      );
    }
    return null;
  }

  if (p.kind === "undo") {
    if (isDeny(ws)) {
      const effects: Effect[] = p.refs
        .filter((r) => r.kind === "task")
        .map((r) => ({ type: "RESTORE_TASK", id: r.id }));
      // Blok sibuk dihapus permanen dari store lokal, jadi gak bisa dibalikin
      // lewat tombstone seperti task (§9).
      if (effects.length === 0) {
        return result([say("Jadwal yang udah kehapus belum bisa dibalikin, maaf.")]);
      }
      return result([say(R.restored(p.refs))], effects);
    }
    return null;
  }

  if (p.kind === "confirmCreate") {
    if (isDeny(ws)) return result([say("Oke, gak jadi.")]);
    if (isAffirm(ws)) return doCreate(p.input, ctx);
    return null;
  }

  if (p.kind === "choose") {
    // "yang terakhir" itu posisi relatif, bukan nomor urut — makanya gak bisa
    // ditaruh di daftar ordinal (di sana dia harus punya angka tetap).
    if (ws.includes("terakhir") || ws.includes("paling bawah")) {
      return runAction({ ...p.action, target: p.refs[p.refs.length - 1]! }, ctx);
    }

    const n = readOrdinal(ws);
    if (n !== null) {
      const ref = p.refs[n - 1];
      if (!ref) {
        return result([say(`Cuma ada ${p.refs.length} pilihan. Sebutin nomornya ya.`)], [], p);
      }
      return runAction({ ...p.action, target: ref }, ctx);
    }

    // Bukan nomor — coba cocokin lewat judul atau tanggal.
    const cocok = pickByText(ws, p.refs, ctx.now);
    if (cocok.length === 1) return runAction({ ...p.action, target: cocok[0]! }, ctx);

    // Balasannya jelas perintah baru → biarkan lewat, user ganti pikiran.
    if (readVerbAnywhere(ws) !== null) return null;

    // Selain itu: TANYA LAGI. Jangan pernah jatuh ke jalur bikin dari sini —
    // "senin 10 agustus" pernah nyasar jadi task baru berjudul "10 agustus"
    // padahal user lagi nunjuk salah satu pilihan.
    const pesan =
      cocok.length > 1
        ? `Masih ada ${cocok.length} yang cocok. Sebutin nomornya ya.`
        : "Gue belum nangkep yang mana. Sebutin nomornya ya.";
    return result([say(`${pesan}\n${R.numbered(p.refs)}`, { refs: p.refs })], [], p);
  }

  if (p.kind === "confirm") {
    if (isDeny(ws)) return result([say("Oke, gak jadi.")]);
    if (!isAffirm(ws)) return null;
    return commit(p.action, p.refs, ctx);
  }

  if (p.kind === "fillTime") {
    const when = readWhen(ws, ctx.now);
    if (!when) return null;
    return runAction({ ...p.action, ...when }, ctx);
  }

  return null;
}

/** Ada kata perintah di kalimat ini? Dipakai buat tau user ganti topik. */
function readVerbAnywhere(ws: readonly string[]): Verb | null {
  for (let i = 0; i < ws.length; i++) {
    const hit = readVerb(ws, i);
    if (hit) return hit.verb;
  }
  return null;
}

/**
 * Cocokkan jawaban "yang mana?" ke kandidat lewat judul atau tanggal.
 *
 * Orang gak selalu jawab pakai nomor. Dua cara alami lain: nyebut sebagian
 * judulnya ("makan malam") atau nyebut tanggalnya ("senin 10 agustus").
 * Tanggalnya dicoba dari SEMUA acuan yang kesebut — "senin 10 agustus" nyebut
 * dua, dan yang nyambung ke kandidat bisa yang mana aja.
 */
function pickByText(ws: readonly string[], refs: readonly Ref[], now: Date): Ref[] {
  const teks = ws.filter((w) => !NOISE_JAWABAN.has(w)).join(" ").trim();

  if (teks) {
    const perJudul = refs.filter((r) => r.title.toLowerCase().includes(teks));
    if (perJudul.length > 0) return perJudul;
  }

  const rentang = findAllRanges(ws, now);
  if (rentang.length > 0) {
    // Tanggal telanjang ("10 agustus") diartikan ke DEPAN — benar buat bikin
    // sesuatu, tapi di sini user lagi nunjuk yang SUDAH ADA, dan itu bisa
    // barusan lewat. Jadi tahun sebelumnya ikut dicoba.
    const perTanggal = refs.filter((r) =>
      rentang.some((x) => inRange(r.at, x.range) || inRange(r.at, mundurSetahun(x.range))),
    );
    if (perTanggal.length > 0) return perTanggal;
  }

  return [];
}

function mundurSetahun(r: DateRange): DateRange {
  const geser = (d: Date) => new Date(new Date(d).setFullYear(d.getFullYear() - 1));
  return { from: geser(r.from), to: geser(r.to), label: r.label };
}

/** Kata sambung yang gak boleh ikut jadi bahan pencocokan judul. */
const NOISE_JAWABAN = new Set(["yang", "itu", "yg", "tuh", "dong", "aja", "gw", "gue", "saya"]);

/**
 * Baca "kapan" dari sepotong kalimat. Hari dan jam ditangani terpisah karena
 * jawabannya sering cuma salah satu: "selasa" (hari saja) atau "jam 4" (jam
 * saja, harinya ngikut agenda yang lagi dibahas).
 */
function readWhen(
  ws: readonly string[],
  now: Date,
): { to?: DateRange; toClock?: { h: number; m: number } } | null {
  const range = findFirstRange(ws, now)?.range;
  const clock = findClock(ws);
  if (range) return { to: clock ? atClock(range, clock) : range };
  if (clock) return { toClock: clock };
  return null;
}

function findFirstRange(ws: readonly string[], now: Date): { range: DateRange; len: number } | null {
  for (let i = 0; i < ws.length; i++) {
    const hit = readRange(ws, i, now);
    if (hit) return hit;
  }
  return null;
}

// ── LIST ─────────────────────────────────────────────────────────────────────

function doList(a: ChatAnalysis, ctx: ChatContext, applied: AppliedExpansion[]): TurnResult {
  if (a.kind === "vocab") {
    return result([say(R.vocabList(ctx.vocab))]);
  }

  const res = queryItems(ctx, filterOf(a));
  const label = a.range?.label ?? "";

  // §11.1 — tawaran ngajarin cuma pas hasil NOL dan ada kata yang gak dikenal
  // siapa pun. Di perintah bikin, kata asing itu judul yang sah, jadi jalur
  // ini emang gak pernah kesampaian dari sana.
  if (res.total === 0) {
    const unknownTerm = a.leftover.find((w) => w.length >= 4 && !isKnownWord(w));
    if (unknownTerm && applied.length === 0) {
      return result(
        [say(R.offerTeach(unknownTerm, label), { choices: [`ajarin "${unknownTerm}"`, "gak usah"] })],
        [],
        { kind: "offerTeach", term: unknownTerm, at: ctx.now.getTime() },
      );
    }
  }

  const refs: Ref[] = [
    ...res.tasks.map((t): Ref => ({ kind: "task", id: t.id, title: t.title, ...(taskTime(t) ? { at: taskTime(t)! } : {}) })),
    ...res.occurrences.map((o): Ref => ({ kind: "busy", id: o.block.id, title: o.block.title, at: o.startAt })),
  ];

  const prov = R.provenance(applied);
  let text = R.listResult(res, label, whatOf(a.kind));

  // Kosong di jenis yang diminta, tapi jenis satunya ada isinya — sebutin.
  if (res.total === 0) {
    const hint = otherKindHint(ctx, filterOf(a), label);
    if (hint) text = `${text} ${hint}`;
  }

  return result([say(prov ? `${text}\n${prov}` : text, { refs })]);
}

/**
 * Berapa banyak yang ketemu kalau jenisnya dibalik. `null` kalau pencarian
 * memang gak dibatasi jenis, atau jenis satunya juga kosong.
 */
function otherKindHint(ctx: ChatContext, filter: QueryFilter, label: string): string | null {
  if (filter.kind !== "task" && filter.kind !== "schedule") return null;
  const otherKind = filter.kind === "task" ? "schedule" : "task";
  const other = queryItems(ctx, { ...filter, kind: otherKind, includeDone: true });
  if (other.total === 0) return null;
  return R.otherKindHint(otherKind === "task" ? "task" : "jadwal", other.total, label);
}

// ── CREATE ───────────────────────────────────────────────────────────────────

/**
 * Jalur bikin diserahkan bulat-bulat ke `parseQuickAdd` (§5.3) — semua
 * kepintaran yang udah ada di sana (durasi, pengulangan, sigil `!p1`/`#tag`)
 * langsung kepake gratis di chat.
 *
 * Yang dioper input ASLI, bukan hasil ekspansi kamus, supaya judulnya tetap
 * kata-kata user sendiri (keputusan V2). Kamus satu-kata tetap ikut lewat
 * `userLexicon`, dan itu cuma nyentuh pencocokan — `buildTitle()` di parser
 * baca `display`, bukan `norm`.
 */
function doCreate(input: string, ctx: ChatContext): TurnResult {
  const userLexicon: Record<string, string> = {};
  for (const v of ctx.vocab) {
    if (!v.phrase.includes(" ") && !v.meaning.includes(" ")) userLexicon[v.phrase] = v.meaning;
  }

  const items: ParseResult[] = [];

  for (const potongan of splitCompound(input)) {
    const raw = parseQuickAdd(potongan, { now: ctx.now, userLexicon });
    const when = raw.startAt ?? raw.dueAt;
    const title = cleanTitle(raw.title, {
      hasTime: when !== undefined,
      hasDate: when !== undefined,
      now: ctx.now,
    });

    // Judul tanpa satu huruf pun ("1", "42", "-") bukan judul — itu ketikan
    // nyasar, atau jawaban ordinal yang nyampe pas pending-nya udah lewat.
    if (!/\p{L}/u.test(title)) {
      // Potongan tanpa judul TAPI bawa waktu itu keterangan buat yang
      // sebelumnya: "rapat tim, besok jam 3". Ditempelin, bukan dibuang —
      // kalau dibuang, tanggalnya ikut hilang tanpa user sadar.
      const sebelumnya = items[items.length - 1];
      if (when && sebelumnya) {
        items[items.length - 1] = {
          ...sebelumnya,
          allDay: raw.allDay,
          ...(raw.dueAt ? { dueAt: raw.dueAt } : {}),
          ...(raw.startAt ? { startAt: raw.startAt } : {}),
          ...(raw.endAt ? { endAt: raw.endAt } : {}),
        };
      }
      // Selain itu cuma kata perintah ("tambahkan jadwal") — lewat.
      continue;
    }

    // `kind` dipaksa "task". Parser masih bisa nyimpulin "busy" dari kata kayak
    // "rapat"/"jadwalin", tapi pemisahan itu udah dibuang dari model.
    items.push({ ...raw, title, kind: "task" });
  }

  if (items.length === 0) return result([say(R.askTitle())]);

  const effects: Effect[] = items.map((parsed) => ({ type: "CREATE_FROM_PARSE", parsed }));

  if (items.length === 1) {
    const satu = items[0]!;
    const when = satu.startAt ?? satu.dueAt;
    return result([say(R.created(satu.title, when?.toISOString(), satu.allDay))], effects);
  }

  return result(
    [
      say(
        R.createdMany(
          items.map((p) => ({
            title: p.title,
            allDay: p.allDay,
            ...((p.startAt ?? p.dueAt) ? { at: (p.startAt ?? p.dueAt)!.toISOString() } : {}),
          })),
        ),
      ),
    ],
    effects,
  );
}

/**
 * Pecah satu kalimat jadi beberapa item: "zoom dismath rabu, zoom calculus
 * kamis jam 1" → dua task.
 *
 * Cuma koma dan titik koma yang dipakai sebagai pemisah. Kata "dan" sengaja
 * TIDAK — di bahasa Indonesia dia sering bagian dari satu nama utuh ("rapat
 * evaluasi dan perencanaan"), dan salah pecah di situ bikin dua task rusak
 * dari satu niat yang benar.
 *
 * Pemecahan ini cuma buat jalur BIKIN. Perintah merusak tetap satu per satu
 * (PLAN-CHAT §14) — eksekusi separuh jalan waktu menghapus jauh lebih mahal
 * daripada waktu menambah.
 */
function splitCompound(input: string): string[] {
  // Koma desimal ("1,5 jam") dilindungi dulu biar gak ikut kepecah.
  const AMAN = " ";
  return input
    .replace(/(\d),(\d)/g, `$1${AMAN}$2`)
    .split(/\s*[;,]\s*/)
    .map((s) => s.split(AMAN).join(",").trim())
    .filter((s) => s !== "");
}

/**
 * Kata struktural yang boleh dikupas dari AWAL judul.
 *
 * Isinya nama objek ("task", "jadwal") plus segelintir kata yang **berperan
 * ganda**: `buat` dan `untuk` ada di kamus sebagai kata perintah ("buat task
 * baru"), padahal di "jadwalin buat bangun subuh" artinya *untuk* — preposisi,
 * bukan perintah. `applyIntent()` cuma mengonsumsi satu frasa niat lalu
 * berhenti, jadi yang kedua nyangkut di judul.
 *
 * Sengaja TIDAK memuat verba bikin lainnya: "tambahin task bikin laporan"
 * judulnya harus tetap "Bikin laporan" — di situ "bikin" itu isi, bukan
 * perintah.
 */
const LEADING_NOISE = new Set([
  ...(chatLex.objects.any as string[]),
  "buat",
  "untuk",
  "utk",
]);

/** "jam 5", "pukul 14:00" — sisa waktu yang gak kekonsumsi parser. */
const TIME_LEFTOVER_RE = /\b(jam|pukul)\s+\d{1,2}([:.]\d{2})?\b/gi;

/**
 * Rapikan judul dari sisa-sisa yang gak sempat dikonsumsi parser.
 *
 * Dua kebocoran yang beneran kejadian:
 *   • kata perintah kedua ("jadwalin **buat** bangun subuh")
 *   • ekspresi jam kedua ("bangun subuh **jam 5**") — `applyTime()` berhenti
 *     di kecocokan pertama, jadi kalau user nyebut waktu dua kali, yang kedua
 *     mendarat di judul. Judul yang bilang "jam 5" padahal agendanya 05:00
 *     dari kata "subuh" itu bikin user gak percaya sama hasil parsingnya.
 */
function cleanTitle(title: string, opts: { hasTime: boolean; hasDate: boolean; now: Date }): string {
  let out = title;

  if (opts.hasTime) out = out.replace(TIME_LEFTOVER_RE, " ");

  let parts = out.split(/\s+/).filter((w) => w !== "");

  // Sisa ekspresi TANGGAL juga dibuang kalau tanggalnya udah kebaca.
  // `applyDate()` berhenti di kecocokan pertama, jadi kalau user nyebut dua
  // acuan ("rabu 12 agustus") yang kedua mendarat di judul — hasilnya judul
  // "Zoom dismath di 12 agustus" padahal tanggalnya udah kesimpen terpisah.
  if (opts.hasDate && parts.length > 0) {
    const lower = parts.map((w) => w.toLowerCase().replace(/[.,;:]+$/, ""));
    const buang = new Set<number>();
    for (const span of findAllRanges(lower, opts.now)) {
      for (let k = span.at; k < span.at + span.len; k++) buang.add(k);
      // Preposisi di depannya ikut, biar gak nyisa "di" menggantung.
      const sebelum = lower[span.at - 1];
      if (sebelum === "di" || sebelum === "pada" || sebelum === "tanggal" || sebelum === "tgl") {
        buang.add(span.at - 1);
      }
    }
    // Jangan sampai judulnya habis total — kalau isinya memang cuma tanggal,
    // biarkan apa adanya dan penjagaan "harus ada huruf" yang menangani.
    if (buang.size < parts.length) parts = parts.filter((_, i) => !buang.has(i));
  }

  while (parts.length > 0 && LEADING_NOISE.has(parts[0]!.toLowerCase())) {
    parts = parts.slice(1);
  }

  // Boleh jadi kosong — "tambahin task" doang emang belum nyebut judul apa pun,
  // dan doCreate bakal nanyain (E8). Lebih baik ditanya daripada lahir task
  // berjudul "Task".
  const rest = parts.join(" ").trim();
  if (rest === "") return "";
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

// ── COMPLETE / UNCOMPLETE ────────────────────────────────────────────────────

function doComplete(a: ChatAnalysis, ctx: ChatContext): TurnResult {
  // Nyentang cuma berlaku buat task, apa pun tebakan jenis dari kata bendanya.
  // `includeDone` biar yang udah selesai tetap KETEMU — jawabannya "udah
  // selesai kok", bukan "gak nemu" (E12).
  const filter: QueryFilter = { ...filterOf(a), kind: "task", includeDone: true };
  const res = resolveTarget(ctx, filter);
  return branchOnResolution(res, { verb: a.verb }, ctx, "task", filter);
}

// ── DELETE ───────────────────────────────────────────────────────────────────

function doDelete(a: ChatAnalysis, ctx: ChatContext): TurnResult {
  if (a.kind === "vocab") return deleteVocab(a, ctx);

  const filter = filterOf(a);
  const res = resolveTarget(ctx, filter);

  // Massal: langsung ke konfirmasi dengan daftar lengkap, jangan minta milih
  // satu-satu (§9).
  if (a.bulk && res.kind === "many") {
    return result(
      [say(R.confirmDelete(res.refs), { choices: ["ya", "batal"], refs: res.refs })],
      [],
      { kind: "confirm", action: { verb: "delete" }, refs: res.refs, at: ctx.now.getTime() },
    );
  }
  return branchOnResolution(res, { verb: "delete" }, ctx, whatOf(a.kind), filter);
}

function deleteVocab(a: ChatAnalysis, ctx: ChatContext): TurnResult {
  const phrase = normalizePhrase(a.keyword);
  const entry = ctx.vocab.find((v) => v.phrase === phrase);
  if (!entry) return result([say(`Gak nemu "${phrase}" di kamus kamu.`)]);
  return result([say(R.vocabDeleted(entry.phrase))], [{ type: "DELETE_VOCAB", id: entry.id }]);
}

// ── RESCHEDULE ───────────────────────────────────────────────────────────────

/**
 * Butuh DUA acuan waktu: penyaring dan tujuan. "pindahin rapat Senin ke
 * Selasa" — Senin nyaring, Selasa tujuan. Pemisahnya `ke` / `jadi` (§4c).
 * Kalau cuma ketemu satu, itu dianggap TUJUAN — "ubah task laporan jadi
 * jam 9" gak punya penyaring waktu sama sekali.
 */
function doReschedule(a: ChatAnalysis, ws: readonly string[], ctx: ChatContext): TurnResult {
  const split = ws.findIndex((w) => w === "ke" || w === "jadi" || w === "jadinya");
  let when: { to?: DateRange; toClock?: { h: number; m: number } } = {};
  let filterRange: DateRange | undefined;

  let filter: QueryFilter;

  if (split >= 0) {
    // "pindahin rapat senin ke selasa" — sebelum `ke` nyaring, sesudahnya tujuan
    when = readWhen(ws.slice(split + 1), ctx.now) ?? {};

    // Penyaringnya dianalisis ULANG dari potongan SEBELUM `ke`/`jadi` doang.
    // Kalau pakai analisis kalimat utuh, kata tujuannya ikut jadi kata kunci:
    // "ubah task laporan jadi jam 9" nyarinya "laporan jadi jam 9", dan
    // "Bikin laporan" gak akan pernah ketemu.
    filter = { ...filterOf(analyzeWords(ws.slice(0, split), ctx.now)), includeDone: true };
  } else {
    // Tanpa `ke`/`jadi`, waktu yang disebut itu PENYARING, bukan tujuan:
    // "ubah meeting gw besok" artinya "meeting yang besok", dan tujuannya
    // belum disebut sama sekali — jadi harus ditanya (§8.3).
    filterRange = a.range;
    filter = { ...filterOf(a), includeDone: true };
    delete filter.range;
    if (filterRange) filter.range = filterRange;
  }

  const res = resolveTarget(ctx, filter);
  return branchOnResolution(res, { verb: "reschedule", ...when }, ctx, whatOf(a.kind), filter);
}

// ── AVAILABILITY ─────────────────────────────────────────────────────────────

function doAvailability(a: ChatAnalysis, ws: readonly string[], ctx: ChatContext): TurnResult {
  const day = a.range ?? findFirstRange(ws, ctx.now)?.range;
  if (!day) return result([say('Mau dicek kapan? Sebutin waktunya, misal "besok jam 3".')]);

  // Jam eksplisit mempersempit ke satu titik. Tanpa ini, "besok jam 8 kosong
  // ga?" bakal ngecek SEHARIAN besok dan jawab "sibuk" gara-gara ada rapat
  // sore — padahal jam 8 kosong.
  const clock = findClock(ws);
  const range = clock ? atClock(day, clock) : day;

  const occ = expandBlocks(ctx.blocks, range);
  return result([
    say(occ.length === 0 ? R.freeAt(range.label) : R.busyWith(range.label, occ), {
      refs: occ.map((o) => ({ kind: "busy" as const, id: o.block.id, title: o.block.title, at: o.startAt })),
    }),
  ]);
}

// ── percabangan resolusi ─────────────────────────────────────────────────────

function branchOnResolution(
  res: ReturnType<typeof resolveTarget>,
  action: PendingAction,
  ctx: ChatContext,
  what: string,
  filter?: QueryFilter,
): TurnResult {
  switch (res.kind) {
    case "none":
      return notFoundMessage(ctx, what, filter);
    case "too_many":
      return result([say(R.tooMany(res.count, what))]);
    case "many":
      return result(
        [say(R.askWhich(res.refs, what), { refs: res.refs })],
        [],
        { kind: "choose", action, refs: res.refs, at: ctx.now.getTime() },
      );
    case "one":
      return runAction({ ...action, target: res.ref }, ctx);
  }
}

/**
 * Kalau nyari di satu jenis dan hasilnya nol, cek jenis satunya sebelum
 * bilang "gak nemu". Kalau di sana ada, sebutin — bukan diem.
 */
function notFoundMessage(ctx: ChatContext, what: string, filter?: QueryFilter): TurnResult {
  if (filter) {
    const label = filter.range?.label ?? "";
    const hint = otherKindHint(ctx, filter, label);
    if (hint) return result([say(`Gak ada ${what}${label ? ` ${label}` : ""}. ${hint}`)]);
  }
  return result([say(R.notFound(what))]);
}

/** Satu target udah pasti — sekarang tentuin: langsung jalan, konfirmasi, atau minta lengkapi. */
function runAction(action: PendingAction, ctx: ChatContext): TurnResult {
  const ref = action.target;
  if (!ref) return result([say(R.unknown())]);
  if (!stillExists(ctx, ref)) return result([say(R.gone())]);

  if (action.verb === "delete") {
    return result(
      [say(R.confirmDelete([ref]), { choices: ["ya", "batal"] })],
      [],
      { kind: "confirm", action, refs: [ref], at: ctx.now.getTime() },
    );
  }

  if (action.verb === "reschedule" && !action.to && !action.toClock) {
    return result([say(R.askNewTime(ref.title))], [], {
      kind: "fillTime",
      action,
      at: ctx.now.getTime(),
    });
  }

  return commit(action, [ref], ctx);
}

/** Titik satu-satunya yang menghasilkan efek merusak. */
function commit(action: PendingAction, refs: readonly Ref[], ctx: ChatContext): TurnResult {
  const live = refs.filter((r) => stillExists(ctx, r));
  if (live.length === 0) return result([say(R.gone())]);

  switch (action.verb) {
    case "delete": {
      const effects: Effect[] = live.map((r) =>
        r.kind === "task" ? { type: "DELETE_TASK", id: r.id } : { type: "DELETE_BUSY", id: r.id },
      );
      return result([say(R.deleted(live), { choices: ["batal"] })], effects, {
        kind: "undo",
        refs: [...live],
        at: ctx.now.getTime(),
      });
    }

    case "complete": {
      const ref = live[0]!;
      const task = ctx.tasks.find((t) => t.id === ref.id);
      if (task?.status === "done") return result([say(R.alreadyDone(ref.title))]);
      return result(
        [say(R.completed(ref.title))],
        [{ type: "PATCH_TASK", id: ref.id, patch: { status: "done", completedAt: ctx.now.toISOString() } }],
      );
    }

    case "uncomplete": {
      const ref = live[0]!;
      return result(
        [say(R.uncompleted(ref.title))],
        [{ type: "PATCH_TASK", id: ref.id, patch: { status: "todo", completedAt: undefined } }],
      );
    }

    case "reschedule": {
      const ref = live[0]!;
      const target = resolveWhen(action, ref, ctx.now);
      if (!target) return result([say(R.askNewTime(ref.title))]);
      const iso = target.toISOString();
      if (ref.kind === "task") {
        return result(
          [say(R.rescheduled(ref.title, iso))],
          [{ type: "PATCH_TASK", id: ref.id, patch: { dueAt: iso } }],
        );
      }
      const block = ctx.blocks.find((b) => b.id === ref.id);
      // Durasi agenda dipertahankan saat digeser — mindahin rapat sejam
      // mestinya tetap sejam, bukan berubah jadi durasi default.
      const durMs = block ? new Date(block.endAt).getTime() - new Date(block.startAt).getTime() : 3_600_000;
      return result(
        [say(R.rescheduled(ref.title, iso))],
        [
          {
            type: "PATCH_BUSY",
            id: ref.id,
            patch: { startAt: iso, endAt: new Date(target.getTime() + durMs).toISOString() },
          },
        ],
      );
    }

    default:
      return result([say(R.unknown())]);
  }
}

/**
 * Waktu tujuan akhir. Kalau user cuma nyebut jam, harinya diambil dari agenda
 * yang lagi dipindah — "jam 4" pada rapat besok artinya besok jam 4, bukan
 * hari ini jam 4.
 */
function resolveWhen(action: PendingAction, ref: Ref, now: Date): Date | null {
  if (action.to) return action.to.from;
  if (!action.toClock) return null;
  const base = ref.at ? new Date(ref.at) : now;
  const d = new Date(base);
  d.setHours(action.toClock.h, action.toClock.m, 0, 0);
  return d;
}

// ── mengajarkan kamus ────────────────────────────────────────────────────────

interface TeachSentence {
  phrase: string;
  meaning: string;
}

/** "kalau gw bilang X, maksudnya Y" / "X artinya Y" (PLAN-VOCAB §3.1). */
function readTeachSentence(ws: readonly string[]): TeachSentence | null {
  let start = 0;
  for (let i = 0; i < ws.length; i++) {
    const trig = findLongest(ws, i, TEACH_TRIGGER);
    if (trig) {
      start = i + trig.len;
      break;
    }
  }

  for (let i = start; i < ws.length; i++) {
    const sep = findLongest(ws, i, TEACH_SEP);
    if (!sep) continue;
    const phrase = ws.slice(start, i).join(" ").trim();
    const meaning = ws.slice(i + sep.len).join(" ").trim();
    if (phrase && meaning) return { phrase, meaning };
  }
  return null;
}

function startTeach(sentence: TeachSentence | null, ctx: ChatContext): TurnResult {
  if (!sentence) {
    return result([say(R.askTeachPhrase())], [], {
      kind: "teach",
      step: "phrase",
      at: ctx.now.getTime(),
    });
  }
  return proposeTeach(sentence.phrase, sentence.meaning, ctx);
}

function proposeTeach(phrase: string, meaning: string, ctx: ChatContext): TurnResult {
  const v = validateTeach(phrase, meaning, { vocab: ctx.vocab, now: ctx.now });
  if (!v.ok) {
    return result([say(v.error!.message)]);
  }
  return result(
    [say(R.confirmTeach(v.phrase, v.meaning, v.warnings, v.existing), { choices: ["ya", "batal"] })],
    [],
    { kind: "teach", step: "confirm", phrase: v.phrase, meaning: v.meaning, at: ctx.now.getTime() },
  );
}

function handleTeachStep(
  ws: readonly string[],
  p: Extract<Pending, { kind: "teach" }>,
  ctx: ChatContext,
): TurnResult | null {
  if (isDeny(ws) && p.step !== "meaning") return result([say(R.teachCancelled())]);

  if (p.step === "phrase") {
    const phrase = normalizePhrase(ws.join(" "));
    if (!phrase) return null;
    return result([say(R.askTeachMeaning(phrase))], [], {
      kind: "teach",
      step: "meaning",
      phrase,
      at: ctx.now.getTime(),
    });
  }

  if (p.step === "meaning") {
    if (!p.phrase) return null;
    return proposeTeach(p.phrase, ws.join(" "), ctx);
  }

  // step === "confirm"
  if (!isAffirm(ws)) return null;
  if (!p.phrase || !p.meaning) return null;
  return result(
    [say(R.vocabSaved(p.phrase, p.meaning))],
    [{ type: "SAVE_VOCAB", phrase: p.phrase, meaning: p.meaning, vocabType: guessType(p.meaning) }],
  );
}

// ── sapaan pembuka ───────────────────────────────────────────────────────────

/**
 * Pesan pembuka chat (§2). Dihitung ulang tiap app dibuka, gak pernah
 * disimpan — dan ini satu-satunya tempat sapaan muncul sekarang, dashboard
 * udah gak pakai lagi.
 */
export function openingMessage(ctx: Omit<ChatContext, "pending" | "vocab">): ChatMessage {
  const slot = greetingSlot(ctx.now);
  const upcoming = expandBlocks(ctx.blocks, upcomingRange(ctx.now));
  const next = upcoming[0];
  const pendingTasks = queryItems(ctx, { kind: "task", status: "todo" }).total;

  const ref: Ref | null = next
    ? { kind: "busy", id: next.block.id, title: next.block.title, at: next.startAt }
    : null;

  return say(R.greeting(slot, ctx.userName, ref, pendingTasks), {
    ...(ref ? { refs: [ref] } : {}),
  });
}
