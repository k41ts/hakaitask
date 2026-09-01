import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { BusyBlock, Task } from "@hakaitask/core";
import {
  chatTurn,
  openingMessage,
  type DateRange,
  type Pending,
  type Ref,
} from "@hakaitask/core/chat";
import { press, listItem } from "../lib/motion.js";
import {
  applyEffect,
  clearHistory,
  loadHistory,
  saveHistory,
  useVocab,
  type StoredMessage,
} from "@hakaitask/app/chat";
import { respond } from "@hakaitask/core/chat";

/**
 * Halaman utama — antarmuka perintah bahasa alami (PLAN-CHAT.md §1).
 *
 * Ini BUKAN asisten. Semua kalimat sistem berasal dari template di
 * `respond.ts`, dan seluruh keputusan diambil `chatTurn()` yang murni. Yang
 * dikerjain komponen ini cuma tiga: nampilin, nerusin ketikan, dan
 * ngejalanin efek yang dibalikin mesin.
 */
export function ChatView({
  now,
  tasks,
  blocks,
  userId,
  userName,
  draft,
  onDraftUsed,
  onOpenTask,
}: {
  now: Date;
  tasks: Task[];
  blocks: BusyBlock[];
  userId: string;
  userName: string;
  /** Titipan teks dari halaman lain (tombol tambah di dashboard/kalender). */
  draft?: string | null;
  onDraftUsed?: () => void;
  onOpenTask: (task: Task) => void;
}) {
  const vocab = useVocab();
  const [messages, setMessages] = useState<StoredMessage[]>(() => loadHistory());
  const [pending, setPending] = useState<Pending>(null);
  // Hari yang lagi dibahas, biar "hapus semua task di hari itu" nyambung ke
  // pertanyaan sebelumnya. Sengaja gak ikut disimpan: konteks percakapan
  // hilang begitu app ditutup, sama seperti pending.
  const [lastRange, setLastRange] = useState<DateRange | undefined>(undefined);
  const [value, setValue] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sapaan pembuka dihitung ulang tiap app dibuka & gak pernah disimpan (§2).
  // Kalau riwayatnya masih hidup, jangan nyapa lagi — user belum ke mana-mana.
  const opening = useMemo(
    () => openingMessage({ now, tasks, blocks, userName }),
    // Sengaja cuma bergantung ke userName: `now` berdetak tiap menit dan
    // bakal bikin sapaannya nulis ulang terus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userName],
  );

  useEffect(() => {
    saveHistory(messages);
  }, [messages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  // Titipan dari halaman lain: isi kolomnya, taruh kursor di ujung, lalu
  // lepas titipannya biar gak keisi ulang tiap render.
  useEffect(() => {
    if (draft === null || draft === undefined) return;
    setValue(draft);
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(draft.length, draft.length);
    }
    onDraftUsed?.();
  }, [draft, onDraftUsed]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // `now` diambil SAAT KIRIM, bukan saat komponen mount — sesi yang
      // kebuka lewat tengah malam bakal salah ngartiin "hari ini" (E9).
      const at = new Date();

      const turn = chatTurn(trimmed, {
        now: at,
        tasks,
        blocks,
        vocab,
        pending,
        userName,
        ...(lastRange ? { lastRange } : {}),
      });

      for (const effect of turn.effects) applyEffect(effect, userId);

      setMessages((prev) => [
        ...prev,
        { role: "user", text: trimmed, at: at.getTime() },
        ...turn.messages.map((m) => ({ ...m, at: at.getTime() })),
      ]);
      setPending(turn.pending);
      setLastRange(turn.lastRange);
      setValue("");
    },
    [tasks, blocks, vocab, pending, lastRange, userName, userId],
  );

  /**
   * Bersihin percakapan. Pending dan `lastRange` WAJIB ikut direset — kalau
   * enggak, sisa "yang mana?" atau "hari itu" dari percakapan yang udah ilang
   * dari layar masih nempel diam-diam dan bikin balasan berikutnya aneh.
   */
  const clear = useCallback(() => {
    setMessages([]);
    setPending(null);
    setLastRange(undefined);
    clearHistory();
  }, []);

  const openRef = useCallback(
    (ref: Ref) => {
      if (ref.kind !== "task") return;
      const task = tasks.find((t) => t.id === ref.id);
      if (task) onOpenTask(task);
    },
    [tasks, onOpenTask],
  );

  const shown = messages.length > 0 ? messages : [{ ...opening, at: now.getTime() }];

  return (
    <div className="flex min-h-[60vh] flex-col">
      <div className="flex-1 space-y-3">
        <AnimatePresence initial={false}>
          {shown.map((m, i) => (
            <motion.div
              key={`${m.at}-${i}`}
              variants={listItem}
              initial="hidden"
              animate="show"
              className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <Bubble message={m} onOpenRef={openRef} onPick={send} />
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={endRef} />
      </div>

      <Composer
        value={value}
        onChange={setValue}
        onSubmit={() => send(value)}
        inputRef={inputRef}
        {...(messages.length > 0 ? { onClear: clear } : {})}
      />
    </div>
  );
}

function Bubble({
  message,
  onOpenRef,
  onPick,
}: {
  message: StoredMessage;
  onOpenRef: (ref: Ref) => void;
  onPick: (text: string) => void;
}) {
  const mine = message.role === "user";

  return (
    <div
      className={`max-w-[85%] rounded-3xl px-5 py-3 ${
        mine ? "bg-ink text-surface" : "card"
      }`}
    >
      {/* Balasan sistem pakai baris ganda (daftar, konfirmasi), jadi
          whitespace-nya harus dipertahankan apa adanya. */}
      <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{message.text}</p>

      {message.refs && message.refs.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {message.refs
            .filter((r) => r.kind === "task")
            .map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onOpenRef(r)}
                className="t-num rounded-full bg-paper px-3 py-1.5 text-[12px] text-ink70 transition-colors duration-[var(--dur-fast)] hover:text-ink"
              >
                {r.title}
              </button>
            ))}
        </div>
      )}

      {message.choices && message.choices.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {message.choices.map((c) => (
            <motion.button
              key={c}
              type="button"
              whileTap={press}
              onClick={() => onPick(c)}
              className="t-num rounded-full border border-line px-3 py-1.5 text-[12px] text-ink transition-colors duration-[var(--dur-fast)] hover:bg-paper"
            >
              {c}
            </motion.button>
          ))}
        </div>
      )}
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSubmit,
  inputRef,
  onClear,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Kosong kalau belum ada yang bisa dibersihin. */
  onClear?: () => void;
}) {
  return (
    <div className="sticky bottom-6 mt-6">
      {/*
        "Bersihkan chat" ikut di blok sticky ini, BUKAN di atas daftar pesan.
        Waktu ditaruh di atas, dia ketutup begitu percakapan panjang — persis
        masalah yang bikin navbar dibikin sticky. Di sini dia selalu
        kejangkau tanpa perlu scroll ke pucuk.
      */}
      {onClear && (
        <div className="mb-2 flex justify-end">
          <motion.button
            type="button"
            whileTap={press}
            onClick={onClear}
            className="t-num rounded-full bg-surface px-3 py-1.5 text-[12px] text-ink40 transition-colors duration-[var(--dur-fast)] hover:text-ink"
          >
            Bersihkan chat
          </motion.button>
        </div>
      )}

      <div className="card flex items-center gap-3 px-5">
        <span aria-hidden className="t-num text-ink40">
          ›
        </span>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder="Tulis perintah atau pertanyaan"
          aria-label="Tulis pesan"
          className="w-full bg-transparent py-4 text-[16px] font-semibold text-ink outline-none placeholder:font-medium placeholder:text-ink40"
          autoComplete="off"
          spellCheck={false}
        />
        {value.trim() && (
          <motion.button
            type="button"
            whileTap={press}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onSubmit}
            className="btn-pill shrink-0 py-2 text-[13px]"
          >
            Kirim
          </motion.button>
        )}
      </div>

      {!value.trim() && <Suggestions onPick={onChange} />}
    </div>
  );
}

/** Contoh yang bisa diketuk — jauh lebih kepake daripada dokumentasi (§10). */
function Suggestions({ onPick }: { onPick: (v: string) => void }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {respond.HELP_EXAMPLES.slice(0, 3).map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => onPick(e)}
          className="t-num rounded-full bg-surface px-3 py-1.5 text-[12px] text-ink70 transition-colors duration-[var(--dur-fast)] hover:text-ink"
        >
          {e}
        </button>
      ))}
    </div>
  );
}
