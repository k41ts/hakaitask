/**
 * Jembatan chat: store ⇄ mesin murni di core — PLAN-CHAT.md §18
 *
 * `chatTurn()` gak boleh nyentuh store, jadi dia balikin *deskripsi* efek.
 * File inilah yang menjalankannya — dan dia sengaja lewat action store yang
 * udah ada (`patchTask`, `removeTask`, …), bukan nulis sendiri, supaya chat
 * gak bikin jalur tulis kedua yang lolos dari outbox & offline-first.
 */
import { useMemo } from "react";
import { useKaiStore } from "@hakaitask/core/store";
import type { Effect, ChatMessage, VocabEntry } from "@hakaitask/core/chat";
import type { UserLexiconEntry } from "@hakaitask/core";
import { createFromParse, newId } from "./tasks.js";
import { platform } from "./platform.js";
import { selectVocab } from "./select.js";

// ── riwayat percakapan (keputusan P6: umur 1 jam) ────────────────────────────

const HISTORY_KEY = "hakaitask-chat";

/** Riwayat chat hidup 1 jam. Kamus pribadi TIDAK ikut aturan ini (V5). */
export const CHAT_TTL_MS = 60 * 60_000;

export interface StoredMessage extends ChatMessage {
  at: number;
}

/**
 * Dibersihkan **saat dibaca**, bukan pakai timer: timer mati begitu tab
 * ditutup, sedangkan penyaringan saat muat selalu jalan. Efek sampingnya
 * disengaja — sesi yang lagi aktif gak pernah kehilangan pesan di depan mata
 * user, pembersihan baru kerasa pas app dibuka lagi.
 */
export function loadHistory(now: number = Date.now()): StoredMessage[] {
  try {
    const raw = platform().kv.get(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredMessage[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((m) => typeof m.at === "number" && now - m.at <= CHAT_TTL_MS);
  } catch {
    // Storage rusak/diblokir bukan alasan buat gagal render — chat mulai kosong.
    return [];
  }
}

export function saveHistory(messages: readonly StoredMessage[]): void {
  try {
    // Isi percakapan gak pernah masuk `partialize` store maupun outbox —
    // dia berhenti di device ini.
    platform().kv.set(HISTORY_KEY, JSON.stringify(messages));
  } catch {
    /* kuota penuh / mode privat — gak fatal */
  }
}

export function clearHistory(): void {
  try {
    platform().kv.remove(HISTORY_KEY);
  } catch {
    /* diabaikan */
  }
}

// ── kamus pribadi ────────────────────────────────────────────────────────────

/** Bentuk store (`dari`/`ke`) → bentuk mesin chat (`phrase`/`meaning`). */
export function useVocab(): VocabEntry[] {
  const map = useKaiStore((s) => s.lexicon);
  return useMemo(() => selectVocab(map), [map]);
}

// ── penerapan efek ───────────────────────────────────────────────────────────

export function applyEffect(effect: Effect, userId: string): void {
  const store = useKaiStore.getState();

  switch (effect.type) {
    case "CREATE_FROM_PARSE":
      createFromParse(effect.parsed, userId);
      return;

    case "PATCH_TASK":
      store.patchTask(effect.id, effect.patch);
      return;

    case "PATCH_BUSY": {
      const block = store.busyBlocks[effect.id];
      if (block) store.upsertBusyBlock({ ...block, ...effect.patch });
      return;
    }

    case "DELETE_TASK":
      store.removeTask(effect.id);
      return;

    case "DELETE_BUSY":
      store.removeBusyBlock(effect.id);
      return;

    // Hapus itu tombstone, jadi undo cuma perlu ngosongin penandanya lagi.
    case "RESTORE_TASK":
      store.patchTask(effect.id, { deletedAt: undefined });
      return;

    case "SAVE_VOCAB": {
      // Ngajarin ulang frasa yang sama = memperbarui entrinya, bukan bikin
      // kembar. Termasuk entri yang pernah dihapus — dia dihidupkan lagi.
      const existing = Object.values(store.lexicon).find((v) => v.dari === effect.phrase);
      store.upsertLexicon({
        id: existing?.id ?? newId(),
        userId,
        dari: effect.phrase,
        ke: effect.meaning,
        tipe: effect.vocabType as UserLexiconEntry["tipe"],
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      });
      return;
    }

    case "DELETE_VOCAB":
      store.removeLexicon(effect.id);
      return;
  }
}
