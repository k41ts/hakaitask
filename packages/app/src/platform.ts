/**
 * Titik suntik hal-hal yang beda antar platform — PLAN.md §2.2
 *
 * ATURAN KERAS buat seluruh `packages/app`: boleh import `react`,
 * `@hakaitask/core`, `@hakaitask/tokens`, dan *tipe* dari `@supabase/supabase-js`.
 * TIDAK boleh import `react-dom`, `react-native`, atau nyentuh global DOM.
 *
 * Catatan penting: `lib: ["ES2022"]` di tsconfig.base TIDAK cukup buat menjaga
 * ini. `types: ["vitest/globals"]` narik balik lib DOM secara transitif, jadi
 * `localStorage` tetap lolos tsc — di sini maupun di `packages/core`. Yang
 * beneran menjaga aturannya: `purity.test.ts`.
 *
 * Yang SENGAJA gak masuk sini: klien Supabase dan URL redirect auth. Bedanya
 * kejauhan (`detectSessionInUrl`, penyimpanan sesi, PKCE, `window.location`
 * lawan `Linking.createURL`) — dibungkus interface malah nambah lapisan tanpa
 * ngurangin apa-apa. Makanya `startSync` nerima kliennya sebagai argumen.
 */

/** Penyimpanan kunci-nilai SINKRON. Web: localStorage. Mobile: MMKV. */
export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface PlatformAdapter {
  /** `crypto.randomUUID` di web, `expo-crypto` di mobile. */
  uuid(): string;
  /**
   * KV di LUAR persist-nya store: riwayat chat, watermark sync, tema,
   * id user lokal. Store sendiri tetap lewat `configureStorage()` di core.
   */
  kv: KV;
  /** Pengganti `import.meta.env.DEV` — konstanta itu gak ada di Metro. */
  isDev: boolean;
}

let current: PlatformAdapter | undefined;

export function configurePlatform(adapter: PlatformAdapter): void {
  current = adapter;
}

/**
 * Dibaca per panggilan, bukan sekali di awal — alasannya sama persis kayak
 * `lazyStorage` di core/store: modul ini dievaluasi saat di-import, jauh
 * sebelum app sempat manggil `configurePlatform()`.
 */
export function platform(): PlatformAdapter {
  if (!current) {
    throw new Error("configurePlatform() belum dipanggil — panggil sebelum app dipakai.");
  }
  return current;
}
