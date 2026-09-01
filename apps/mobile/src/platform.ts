/**
 * Implementasi platform buat mobile — pasangannya `apps/web/src/lib/platform.ts`.
 *
 * MMKV, bukan AsyncStorage. Alasannya bukan cuma cepet: MMKV SINKRON, jadi
 * antarmuka `KV` di packages/app bisa tetep sinkron persis kayak localStorage
 * di web. Kalau async, riwayat chat dan watermark sync harus dibongkar jadi
 * berbasis efek — dan bug klasiknya (simpan array kosong duluan sebelum load
 * kelar, riwayatnya keburu ketimpa) jadi gampang banget kejadian.
 */
import { createMMKV } from "react-native-mmkv";
import { randomUUID } from "expo-crypto";
import type { PlatformAdapter } from "@hakaitask/app";
import type { StateStorage } from "zustand/middleware";

// MMKV v4 pakai factory + `remove()`, bukan `new MMKV()` + `delete()`.
const store = createMMKV({ id: "hakaitask" });

export const mobilePlatform: PlatformAdapter = {
  uuid: () => randomUUID(),
  isDev: __DEV__,
  kv: {
    get: (k) => store.getString(k) ?? null,
    set: (k, v) => store.set(k, v),
    remove: (k) => void store.remove(k),
  },
};

/** Adapter buat persist-nya store di core — bentuknya beda dari `KV`. */
export const mobileStorage: StateStorage = {
  getItem: (name) => store.getString(name) ?? null,
  setItem: (name, value) => store.set(name, value),
  removeItem: (name) => void store.remove(name),
};
