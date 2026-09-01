/**
 * Implementasi `PlatformAdapter` buat web — pasangannya `storage.ts`
 * (yang itu buat store-nya core, yang ini buat KV di luar store).
 */
import type { PlatformAdapter } from "@hakaitask/app";

const memory = new Map<string, string>();

function usable(): boolean {
  try {
    const probe = "__hakaitask_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

// Mode privat / kuota penuh bukan alasan buat gagal render — jatuh ke memori.
const ok = usable();

export const webPlatform: PlatformAdapter = {
  uuid: () => crypto.randomUUID(),
  isDev: import.meta.env.DEV,
  kv: ok
    ? {
        get: (k) => window.localStorage.getItem(k),
        set: (k, v) => window.localStorage.setItem(k, v),
        remove: (k) => window.localStorage.removeItem(k),
      }
    : {
        get: (k) => memory.get(k) ?? null,
        set: (k, v) => void memory.set(k, v),
        remove: (k) => void memory.delete(k),
      },
};

/** Pemantau koneksi buat `startSync`. Mobile nanti pakai NetInfo. */
export function watchConnectivity(onChange: (online: boolean) => void): () => void {
  const online = () => onChange(true);
  const offline = () => onChange(false);
  window.addEventListener("online", online);
  window.addEventListener("offline", offline);
  onChange(navigator.onLine);
  return () => {
    window.removeEventListener("online", online);
    window.removeEventListener("offline", offline);
  };
}
