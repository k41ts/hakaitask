/**
 * Worker sinkronisasi — PLAN.md §6.8
 *
 * Alurnya satu arah dan membosankan on purpose:
 *   mutasi lokal → outbox → drain satu-satu ke Supabase → ack
 *   perubahan remote → merge ke store
 *
 * Gak ada yang nunggu jaringan di jalur UI. Kalau offline, outbox numpuk dan
 * drain-nya lanjut sendiri begitu online.
 *
 * Klien Supabase dan sumber status online-nya DISUNTIK, bukan di-import: web
 * pakai `window online/offline`, mobile pakai NetInfo, dan tes pakai klien
 * palsu. Efek sampingnya bagus — worker ini akhirnya bisa diuji tanpa jaringan.
 */
import { backoffMs, type Mutation } from "@hakaitask/core/sync";
import { useKaiStore } from "@hakaitask/core/store";
import type { SupabaseClient } from "@supabase/supabase-js";
import { platform } from "../platform.js";
import { entityList, ENTITIES, type EntitySync } from "./entities.js";
import type { TaskRow } from "../mapping.js";

const LAST_PULL_PREFIX = "hakaitask-last-pull";
const EPOCH = "1970-01-01T00:00:00.000Z";

export interface SyncDeps {
  client: SupabaseClient;
  userId: string;
  /**
   * Pasang pemantau koneksi, balikin fungsi buat nyabutnya.
   * Web: `window` online/offline. Mobile: NetInfo.
   */
  watchConnectivity: (onChange: (online: boolean) => void) => () => void;
}

export interface SyncHandle {
  /** Matiin semuanya: timer, listener, channel realtime. */
  stop: () => void;
  /**
   * Tarik-lalu-drain sekali. Dipanggil mobile tiap app balik ke depan —
   * WebSocket mati diem-diem pas di-background, dan watermark-lah sumber
   * kebenarannya. Realtime cuma pemangkas latensi.
   */
  kick: () => Promise<void>;
}

// ── watermark ────────────────────────────────────────────────────────────────
// Di-cache di memori: satu siklus pull cuma perlu satu baca, dan tulisnya
// sekali di akhir, bukan sekali per baris.

const watermarks = new Map<string, string>();

function readLastPull(table: string): string {
  const cached = watermarks.get(table);
  if (cached !== undefined) return cached;
  const stored = platform().kv.get(`${LAST_PULL_PREFIX}:${table}`) ?? EPOCH;
  watermarks.set(table, stored);
  return stored;
}

function writeLastPull(table: string, iso: string): void {
  if (iso <= readLastPull(table)) return;
  watermarks.set(table, iso);
  platform().kv.set(`${LAST_PULL_PREFIX}:${table}`, iso);
}

// ── kirim & tarik ────────────────────────────────────────────────────────────

async function push(client: SupabaseClient, mutation: Mutation, userId: string): Promise<void> {
  const spec = ENTITIES[mutation.entity];
  // Entitas yang belum disinkronkan (project, settings) di-ack diam-diam,
  // bukan bikin antrean mampet selamanya.
  if (!spec) return;

  if (mutation.op === "delete") {
    const { error } = await client
      .from(spec.table)
      .update({ deleted_at: mutation.payload.deletedAt ?? new Date().toISOString() })
      .eq("id", mutation.entityId);
    if (error) throw error;
    return;
  }

  const snapshot = spec.snapshot(mutation.entityId);
  // Udah kehapus lokal sebelum sempat kekirim — gak ada yang perlu dikirim.
  if (!snapshot) return;

  const row = { ...snapshot, id: mutation.entityId, user_id: userId };
  const { error } = await client.from(spec.table).upsert(row, { onConflict: "id" });
  if (error) throw error;
}

async function pullTable(
  client: SupabaseClient,
  spec: EntitySync,
  userId: string,
): Promise<void> {
  const since = readLastPull(spec.table);
  const { data, error } = await client
    .from(spec.table)
    .select("*")
    .eq("user_id", userId)
    .gt("updated_at", since)
    .order("updated_at", { ascending: true });

  if (error) throw error;
  if (!data) return;

  let newest = since;
  for (const row of data as TaskRow[]) {
    const at = String(row.updated_at ?? new Date().toISOString());
    spec.merge(row, at);
    if (at > newest) newest = at;
  }
  writeLastPull(spec.table, newest);
}

// ── worker ───────────────────────────────────────────────────────────────────

export function startSync({ client, userId, watchConnectivity }: SyncDeps): SyncHandle {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let draining = false;

  async function drain(): Promise<void> {
    if (stopped || draining) return;
    draining = true;
    try {
      for (;;) {
        const state = useKaiStore.getState();
        if (stopped || !state.online) break;
        const head = state.outbox.queue[0];
        if (!head) break;

        try {
          await push(client, head, userId);
          useKaiStore.getState().ackMutation(head.id);
        } catch (err) {
          useKaiStore.getState().failMutation(head.id);
          // Antre ulang di belakang backoff. Kalau errornya jaringan,
          // `online` bakal false duluan dan loop berhenti sendiri.
          schedule(backoffMs(head.attempts));
          if (platform().isDev) console.warn("[sync] gagal kirim", err);
          break;
        }
      }
    } finally {
      draining = false;
    }
  }

  function schedule(ms: number): void {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => void kick(), ms);
  }

  async function kick(): Promise<void> {
    if (stopped) return;
    try {
      for (const spec of entityList()) await pullTable(client, spec, userId);
    } catch (err) {
      if (platform().isDev) console.warn("[sync] gagal tarik", err);
    }
    await drain();
  }

  const unwatch = watchConnectivity((online) => {
    useKaiStore.getState().setOnline(online);
    if (online) void kick();
  });

  // Antrean baru dari UI langsung memicu drain, tanpa polling.
  const unsubscribe = useKaiStore.subscribe((s, prev) => {
    if (s.outbox.queue.length > prev.outbox.queue.length) void drain();
  });

  const channels = entityList().map((spec) =>
    client
      .channel(`${spec.table}:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: spec.table, filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as TaskRow | null;
          if (!row?.id) return;
          const at = String(row.updated_at ?? new Date().toISOString());
          spec.merge(row, at);
          writeLastPull(spec.table, at);
        },
      )
      .subscribe(),
  );

  void kick();

  return {
    kick,
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      unsubscribe();
      unwatch();
      for (const ch of channels) void client.removeChannel(ch);
    },
  };
}
