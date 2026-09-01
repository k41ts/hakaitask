/**
 * Kamus pribadi — PLAN-VOCAB.md
 *
 * Mekanismenya cuma satu: **ekspansi teks ke frasa kanonik** (§4.1). Kamus
 * gak pernah ngajarin parser hal baru — dia cuma nulis ulang kalimat user
 * jadi kalimat yang parser udah ngerti. Tiga "tipe" (alias/aksi/filter) cuma
 * label UI dan aturan validasi, BUKAN cabang logika.
 *
 * Ekspansi jalan **tepat sekali** dan gak rekursif (§5.3): siklus jadi
 * mustahil secara konstruksi, dan hasilnya selalu bisa ditampilin utuh ke
 * user dalam satu baris.
 */
import lex from "../parser/lexicon.id.json";
import chatLex from "./lexicon.chat.id.json";
import { findLongest, words } from "./match.js";
import { resolveDateRange } from "./range.js";

export type VocabType = "alias" | "aksi" | "filter" | "slang" | "buang";

export interface VocabEntry {
  id: string;
  /** Selalu ternormalisasi: huruf kecil, spasi rapat. */
  phrase: string;
  meaning: string;
  type: VocabType;
}

export interface AppliedExpansion {
  phrase: string;
  meaning: string;
}

/** Batas dari §16.3 — kamus itu buat singkatan, bukan nulis kalimat utuh. */
export const MAX_PHRASE_WORDS = 4;
export const MAX_MEANING_WORDS = 6;
export const MAX_ENTRIES = 200;

const RESERVED = new Set(chatLex.reserved as string[]);
const DELETE_VERBS = chatLex.verbs.delete as string[];
const BULK_WORDS = chatLex.bulkWords as string[];

export function normalizePhrase(input: string): string {
  return words(input).join(" ");
}

// ── ekspansi ─────────────────────────────────────────────────────────────────

/**
 * Terapkan kamus ke deretan kata. Frasa terpanjang menang (§6.5).
 *
 * Kata hasil ekspansi ditandai supaya gak ikut diperiksa lagi — inilah yang
 * bikin "sekali jalan" itu terjamin, bukan sekadar diharapkan.
 */
export function expandVocab(
  ws: readonly string[],
  vocab: readonly VocabEntry[],
): { words: string[]; applied: AppliedExpansion[] } {
  if (vocab.length === 0) return { words: [...ws], applied: [] };

  // Kelompokkan per frasa biar bisa dicocokkan pakai findLongest.
  const phrases = vocab.map((v) => v.phrase);
  const byPhrase = new Map(vocab.map((v) => [v.phrase, v]));

  const out: string[] = [];
  const applied: AppliedExpansion[] = [];

  for (let i = 0; i < ws.length; ) {
    const hit = findLongest(ws, i, phrases);
    const entry = hit ? byPhrase.get(hit.phrase) : undefined;

    if (hit && entry) {
      // `buang` = frasa yang sengaja dihapus user (mis. "btw", "anjay")
      if (entry.type !== "buang") {
        out.push(...words(entry.meaning));
      }
      applied.push({ phrase: entry.phrase, meaning: entry.meaning });
      i += hit.len;
      continue;
    }

    out.push(ws[i]!);
    i += 1;
  }

  return { words: out, applied };
}

// ── validasi saat diajarin ───────────────────────────────────────────────────

export interface TeachIssue {
  code:
    | "phrase_kosong"
    | "phrase_reserved"
    | "phrase_waktu"
    | "phrase_angka"
    | "phrase_panjang"
    | "meaning_kosong"
    | "meaning_panjang"
    | "meaning_siklus"
    | "duplikat"
    | "penuh";
  message: string;
}

export interface TeachWarning {
  code: "nimpa_bawaan" | "merusak" | "berwaktu";
  message: string;
}

export interface TeachValidation {
  ok: boolean;
  phrase: string;
  meaning: string;
  error?: TeachIssue;
  warnings: TeachWarning[];
  /** Entri lama kalau frasanya udah pernah diajarin — buat tawaran timpa. */
  existing?: VocabEntry;
}

/**
 * Kamus bawaan mana yang udah make kata ini. Dipakai buat peringatan §10.1
 * — dan sengaja balikin CONTOH KALIMAT, bukan nama kamus internal. User gak
 * peduli soal "nounTask"; dia peduli kalimatnya bakal beda arti.
 */
function builtinConflict(phrase: string): string | null {
  const single = !phrase.includes(" ");
  if (!single) return null;

  if ((lex.nounTask as string[]).includes(phrase)) {
    return `"${phrase}" sekarang gue baca sebagai kata benda, jadi "${phrase} meja" = bikin task "${phrase} meja". Kalau diajarin, kalimat itu bakal jadi perintah.`;
  }
  if ((lex.nounSchedule as string[]).includes(phrase)) {
    return `"${phrase}" sekarang gue baca sebagai jenis agenda, jadi "${phrase} besok jam 3" = bikin jadwal. Kalau diajarin, artinya bakal beda.`;
  }
  if (Object.prototype.hasOwnProperty.call(lex.slang, phrase)) {
    const to = (lex.slang as Record<string, string>)[phrase];
    return `"${phrase}" sekarang gue anggap sama dengan "${to}". Kamus kamu bakal ngalahin itu.`;
  }
  return null;
}

function containsAny(ws: readonly string[], list: readonly string[]): boolean {
  for (let i = 0; i < ws.length; i++) {
    if (findLongest(ws, i, list)) return true;
  }
  return false;
}

export function validateTeach(
  rawPhrase: string,
  rawMeaning: string,
  opts: { vocab: readonly VocabEntry[]; now: Date },
): TeachValidation {
  const phrase = normalizePhrase(rawPhrase);
  const meaning = normalizePhrase(rawMeaning);
  const warnings: TeachWarning[] = [];

  const fail = (code: TeachIssue["code"], message: string): TeachValidation => ({
    ok: false,
    phrase,
    meaning,
    error: { code, message },
    warnings,
  });

  const pw = words(phrase);
  const mw = words(meaning);

  if (pw.length === 0) return fail("phrase_kosong", "Istilahnya belum keisi.");
  if (pw.length > MAX_PHRASE_WORDS) {
    return fail("phrase_panjang", `Istilahnya kepanjangan — maksimal ${MAX_PHRASE_WORDS} kata.`);
  }
  if (pw.every((w) => /^\d+$/.test(w))) {
    return fail("phrase_angka", "Angka gak bisa dijadikan istilah — nanti bentrok sama jam dan tanggal.");
  }
  if (pw.length === 1 && RESERVED.has(pw[0]!)) {
    return fail(
      "phrase_reserved",
      `"${phrase}" itu perintah bawaan, gak bisa dipakai buat kamus — nanti kamu gak bisa pakai perintah itu lagi.`,
    );
  }
  // Frasa waktu ditolak lewat parser waktu kita sendiri, bukan daftar manual:
  // apa pun yang kebaca sebagai tanggal berarti bakal nyulik arti waktu (§7.1).
  if (resolveDateRange(phrase, opts.now) !== null) {
    return fail(
      "phrase_waktu",
      `"${phrase}" udah punya arti waktu buat gue. Kalau ditimpa, tanggal bisa kebaca salah.`,
    );
  }

  if (mw.length === 0) return fail("meaning_kosong", "Artinya belum kebaca. Coba pakai kalimat yang biasa kamu ketik.");
  if (mw.length > MAX_MEANING_WORDS) {
    return fail("meaning_panjang", `Artinya kepanjangan — maksimal ${MAX_MEANING_WORDS} kata. Kamus itu buat singkatan.`);
  }
  if (containsAny(mw, [phrase])) {
    return fail("meaning_siklus", `Artinya gak boleh ngandung "${phrase}" itu sendiri.`);
  }

  const existing = opts.vocab.find((v) => v.phrase === phrase);
  if (!existing && opts.vocab.length >= MAX_ENTRIES) {
    return fail("penuh", `Kamus kamu udah penuh (${MAX_ENTRIES} istilah). Hapus yang gak kepake dulu.`);
  }

  // ── peringatan (gak ngeblokir) ─────────────────────────────────────────────
  const conflict = builtinConflict(phrase);
  if (conflict) warnings.push({ code: "nimpa_bawaan", message: conflict });

  if (containsAny(mw, DELETE_VERBS)) {
    const massal = containsAny(mw, BULK_WORDS) ? " dan kena banyak data sekaligus" : "";
    warnings.push({
      code: "merusak",
      message: `"${phrase}" bakal jadi perintah yang menghapus data${massal}. Tiap dipakai gue tetap minta konfirmasi dulu.`,
    });
  }

  const asRange = resolveDateRange(meaning, opts.now);
  if (asRange) {
    warnings.push({
      code: "berwaktu",
      message: `Artinya ngandung waktu — "${phrase}" bakal nunjuk ke ${asRange.label}.`,
    });
  }

  return { ok: true, phrase, meaning, warnings, ...(existing ? { existing } : {}) };
}

/** Tipe ditebak dari bentuk artinya — user gak perlu ditanya soal ini. */
export function guessType(meaning: string): VocabType {
  const mw = words(meaning);
  for (let i = 0; i < mw.length; i++) {
    const hit = findLongest(mw, i, [
      ...(chatLex.verbs.complete as string[]),
      ...(chatLex.verbs.delete as string[]),
      ...(chatLex.verbs.list as string[]),
      ...(chatLex.verbs.reschedule as string[]),
    ]);
    if (hit) return "aksi";
  }
  for (const group of Object.values(chatLex.topicGroups as Record<string, string[]>)) {
    for (let i = 0; i < mw.length; i++) {
      if (findLongest(mw, i, group)) return "filter";
    }
  }
  return "alias";
}
