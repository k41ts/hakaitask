/**
 * Deteksi verba, objek, dan penyaring — PLAN-CHAT.md §3, §5.2 tahap ②–⑥
 *
 * Lapisan ini yang bikin chat mungkin. Parser lama (`parseQuickAdd`) sepenuhnya
 * berorientasi **penciptaan** — dia gak punya konsep "perintah", jadi kalau
 * "hapus task laporan" dikasih langsung ke sana, hasilnya task baru berjudul
 * "Hapus task laporan". Modul ini jalan **sebelum** parser lama dan mengenali
 * kata kerjanya duluan.
 *
 * Dua racun dari kamus lama yang ditangkal di sini (PLAN-CHAT T2–T4):
 *   • `belum`/`udah`/`sudah` ada di daftar `drop` → status dibaca DULUAN,
 *     sebelum apa pun sempat membuangnya.
 *   • `jadwal` ada di `intent.schedule` (= perintah bikin jadwal) → di sini dia
 *     diperlakukan sebagai OBJEK, jadi "jadwal gw hari ini apa?" kebaca query.
 */
import chatLex from "./lexicon.chat.id.json";
import lex from "../parser/lexicon.id.json";
import { findLongest, findLongestIn, words } from "./match.js";
import { findRange, type DateRange } from "./range.js";

export type Verb =
  | "create"
  | "list"
  | "complete"
  | "uncomplete"
  | "reschedule"
  | "delete"
  | "availability"
  | "help"
  | "teach"
  /** Basa-basi ("makasih", "sip") — dijawab pendek, gak ninggalin jejak. */
  | "chitchat"
  /** Kelihatan kayak judul tapi gak ada aba-aba bikin — tanya dulu. */
  | "maybeCreate"
  | "unknown";

export type ObjectKind = "task" | "schedule" | "vocab" | "any";
export type StatusFilter = "todo" | "done" | "overdue";

const VERBS = chatLex.verbs as Record<
  Exclude<Verb, "create" | "maybeCreate" | "chitchat" | "unknown">,
  string[]
>;
const OBJECTS = chatLex.objects as Record<"any" | "vocab", string[]>;
const STATUS = chatLex.statusWords as Record<StatusFilter, string[]>;
const TOPICS = chatLex.topicGroups as Record<string, string[]>;
const QUESTION = chatLex.questionWords as string[];
const BULK = chatLex.bulkWords as string[];
const SOCIAL = chatLex.social as string[];
const THANKS = chatLex.thanks as string[];
const AFFIRM = chatLex.affirm as string[];
const DENY = chatLex.deny as string[];

/** Kata yang, kalau berdiri sendirian, gak minta apa-apa dari sistem. */
const NO_OP_WORDS = new Set([...SOCIAL, ...AFFIRM, ...DENY].flatMap((w) => w.split(" ")));

/** Aba-aba bikin yang eksplisit: "tambahin", "bikin", "jadwalin", "ingetin". */
const CREATE_WORDS = new Set(
  [
    ...(lex.intent.neutral as string[]),
    ...(lex.intent.schedule as string[]),
    ...(lex.intent.remind as string[]),
  ].flatMap((w) => w.split(" ")),
);

export function isThanks(ws: readonly string[]): boolean {
  const flat = new Set(THANKS.flatMap((w) => w.split(" ")));
  return ws.some((w) => flat.has(w));
}

/**
 * Kata sisa yang gak layak jadi kata kunci pencarian.
 *
 * Aman meminjam `drop`/`filler` kamus lama DI SINI — bahayanya (T2) cuma
 * berlaku kalau pembuangan terjadi sebelum status dibaca. Di titik ini status
 * sudah dikonsumsi duluan, jadi `belum`/`udah` yang tersisa memang benar-benar
 * partikel. Kata tanya ditambahkan manual karena kamus lama gak mengenalnya.
 */
const NOISE = new Set([
  ...(lex.drop as string[]),
  ...(lex.filler as string[]),
  ...(lex.dropIfTrailing as string[]),
  "ini",
  "itu",
  "sih",
  "dong",
  "ya",
  "ada",
  // "hari" nyangkut jadi kata kunci pas frasanya gak keparsing utuh ("di hari
  // itu"), dan sebagai kata kunci dia nyaring habis semua hasil.
  "hari",
  "tanggal",
  "tsb",
  "tersebut",
  "gak",
  "ga",
  "engga",
  "enggak",
  "nggak",
  "punya",
]);

export interface ChatAnalysis {
  verb: Verb;
  kind: ObjectKind;
  range?: DateRange;
  status?: StatusFilter;
  topic?: string;
  /** Dipicu kata "semua" — nentuin apakah operasi butuh konfirmasi (§9). */
  bulk: boolean;
  /** Sisa kata setelah semua yang dikenali dikonsumsi (§4a). */
  keyword: string;
  question: boolean;
  /** Kata yang gak kekonsumsi siapa pun — bahan tawaran "ajarin" (§11). */
  leftover: string[];
}

// ── pembacaan satuan ─────────────────────────────────────────────────────────

export function readVerb(ws: readonly string[], i: number): { verb: Verb; len: number } | null {
  const hit = findLongestIn(ws, i, VERBS);
  return hit ? { verb: hit.key as Verb, len: hit.len } : null;
}

export function readObject(
  ws: readonly string[],
  i: number,
): { kind: ObjectKind; len: number } | null {
  const hit = findLongestIn(ws, i, OBJECTS);
  return hit ? { kind: hit.key, len: hit.len } : null;
}

/**
 * Semua kata yang dikenal sistem, dari KEDUA kamus, dipecah per kata.
 *
 * Dipakai buat mutusin apakah sebuah kata layak ditawarin buat "diajarin".
 * `leftover` gak bisa dipakai langsung: dia berarti "gak dikonsumsi", bukan
 * "gak dikenal" — kata topik sengaja dibiarkan utuh biar bisa merangkap jadi
 * kata kunci. Tanpa pemisahan ini, "tampilin agenda zoom gw" bakal jawab
 * "belum ngerti zoom" padahal `zoom` ada di kamus bawaan.
 */
const KNOWN_WORDS: ReadonlySet<string> = (() => {
  const out = new Set<string>();
  const eat = (v: unknown): void => {
    if (typeof v === "string") {
      for (const w of v.toLowerCase().split(/\s+/)) if (w) out.add(w);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) eat(x);
      return;
    }
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (k.startsWith("_")) continue; // catatan, bukan kosakata
        eat(k);
        eat(x);
      }
    }
  };
  eat(lex);
  eat(chatLex);
  return out;
})();

export function isKnownWord(w: string): boolean {
  return KNOWN_WORDS.has(w.toLowerCase());
}

/** Penanda tanya, termasuk "gak?" di ujung kalimat — khas Indonesia. */
export function isQuestion(ws: readonly string[]): boolean {
  const tail = ws[ws.length - 1];
  if (tail === "gak" || tail === "ga" || tail === "engga" || tail === "enggak" || tail === "nggak") {
    return true;
  }
  for (let i = 0; i < ws.length; i++) {
    if (findLongest(ws, i, QUESTION)) return true;
  }
  return false;
}

// ── analisis kalimat ─────────────────────────────────────────────────────────

/**
 * Bongkar satu kalimat jadi bagian-bagiannya. Belum mengeksekusi apa pun —
 * `chatTurn()` (Tahap 2) yang nanti mengubah ini jadi efek + balasan.
 */
export function analyze(input: string, now: Date): ChatAnalysis {
  return analyzeWords(words(input), now);
}

/**
 * Versi yang nerima kata jadi. Dipakai `chatTurn()` supaya kamus pribadi
 * sempat diekspansi dulu sebelum dianalisis (PLAN-VOCAB §5.2 tahap ③).
 */
export function analyzeWords(ws: readonly string[], now: Date): ChatAnalysis {
  const used = new Array<boolean>(ws.length).fill(false);

  const take = (at: number, len: number): void => {
    for (let k = at; k < at + len && k < ws.length; k++) used[k] = true;
  };
  const free = (): string[] => ws.filter((_, i) => !used[i]);

  // ② verba — paling dulu, biar "hapus"/"tampilin" gak jatuh ke judul
  let verb: Verb | null = null;
  for (let i = 0; i < ws.length && verb === null; i++) {
    const hit = readVerb(ws, i);
    if (hit) {
      verb = hit.verb;
      take(i, hit.len);
    }
  }

  // ③ objek eksplisit
  let kind: ObjectKind = "any";
  for (let i = 0; i < ws.length; i++) {
    if (used[i]) continue;
    const hit = readObject(ws, i);
    if (hit) {
      kind = hit.kind;
      take(i, hit.len);
      break;
    }
  }

  // ④ status — WAJIB sebelum apa pun yang membuang kata, karena `belum`,
  //    `udah`, dan `sudah` semuanya ada di daftar `drop` kamus lama (T2)
  let status: StatusFilter | undefined;
  for (let i = 0; i < ws.length; i++) {
    if (used[i]) continue;
    const hit = findLongestIn(ws, i, STATUS);
    if (hit) {
      status = hit.key;
      take(i, hit.len);
      break;
    }
  }

  // ⑤ grup topik — token TIDAK dikonsumsi: dia juga kata kunci pencarian
  let topic: string | undefined;
  for (let i = 0; i < ws.length && topic === undefined; i++) {
    if (used[i]) continue;
    const hit = findLongestIn(ws, i, TOPICS);
    if (hit) topic = hit.key;
  }

  // massal
  let bulk = false;
  for (let i = 0; i < ws.length; i++) {
    if (used[i]) continue;
    const hit = findLongest(ws, i, BULK);
    if (hit) {
      bulk = true;
      take(i, hit.len);
      break;
    }
  }

  // ⑦ rentang tanggal
  //
  // Kata bagian hari yang berdiri sendiri ("malam") ditolak kalau kata
  // sebelumnya masih kata isi — di posisi itu dia hampir selalu bagian JUDUL,
  // bukan penyaring: "makan malam", "shift malam", "lari pagi". Tanpa
  // penjagaan ini, "selesaikan makan malam" nyari agenda petang ini doang dan
  // task-nya gak pernah ketemu.
  const found = findRange(ws, now, (hit) => {
    if (!hit.bareDaypart || hit.at === 0) return true;
    const prev = ws[hit.at - 1];
    const prevMasihIsi = prev !== undefined && !used[hit.at - 1] && !NOISE.has(prev);
    return !prevMasihIsi;
  });

  let range: DateRange | undefined;
  if (found && !used[found.at]) {
    range = found.range;
    take(found.at, found.len);
  }

  const question = isQuestion(ws);

  // Kata sisa: buang partikel & kata bantu, sisanya jadi kata kunci
  const leftover = free().filter((w) => !NOISE.has(w) && !QUESTION.includes(w));
  const keyword = leftover.join(" ");

  return {
    verb:
      verb ??
      fallbackVerb({
        kind,
        question,
        leftover,
        hasDate: range !== undefined,
        hasCreateWord: ws.some((w) => CREATE_WORDS.has(w)),
      }),
    // Kata benda kayak "rapat" DULU dipakai nebak jenis (task vs jadwal).
    // Sekarang jenisnya disatuin, jadi kata itu murni jadi kata kunci /
    // grup topik — bukan penyempit jenis lagi.
    kind,
    ...(range ? { range } : {}),
    ...(status ? { status } : {}),
    ...(topic ? { topic } : {}),
    bulk,
    keyword,
    question,
    leftover,
  };
}

/**
 * Kalau gak ada verba sama sekali. Aturan aman §1.3: **kalau ragu, pilih baca.**
 *
 * Dulu di sini langsung balik "create", dan itu ngelanggar aturannya sendiri:
 * bikin task itu MUTASI, dan mutasi kejadian diam-diam cuma karena kalimatnya
 * nyisain kata. Akibatnya "ok terimakasih" kesimpen jadi task berjudul
 * "Terimakasih". Sekarang bikin cuma otomatis kalau ada aba-abanya —
 * kata perintah ("tambahin") atau waktu ("besok jam 9"). Selain itu: ditanya.
 */
function fallbackVerb(c: {
  kind: ObjectKind;
  question: boolean;
  leftover: string[];
  hasDate: boolean;
  hasCreateWord: boolean;
}): Verb {
  if (c.question) return "list";
  if (c.kind === "vocab") return "list";
  // Cuma nulis waktu doang ("besok") — gak ada bahan buat judul, jadi ini
  // pertanyaan, bukan perintah bikin (E16)
  if (c.leftover.length === 0) return "list";
  if (c.leftover.every((w) => NO_OP_WORDS.has(w))) return "chitchat";
  if (c.hasCreateWord || c.hasDate) return "create";
  return "maybeCreate";
}
