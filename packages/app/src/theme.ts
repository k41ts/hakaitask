/**
 * Kebijakan tema — bagian yang murni, dipakai bareng web & mobile.
 *
 * Cara MENERAPKAN-nya beda jauh (web nyetel atribut `data-theme` biar CSS
 * variable-nya kebalik; mobile nyodorin objek warna lewat context), jadi itu
 * tetep di masing-masing app. Yang dibagi cuma tiga hal yang gampang beda
 * kalau ditulis dua kali: nama kuncinya, arti "system", dan cara baca-tulisnya.
 */
import { platform } from "./platform.js";

export type ThemePref = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_KEY = "hakaitask-theme";

/** "system" disimpan sebagai KETIADAAN kunci, bukan string "system". */
export function readThemePref(): ThemePref {
  const raw = platform().kv.get(THEME_KEY);
  return raw === "light" || raw === "dark" ? raw : "system";
}

export function writeThemePref(pref: ThemePref): void {
  if (pref === "system") platform().kv.remove(THEME_KEY);
  else platform().kv.set(THEME_KEY, pref);
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): ResolvedTheme {
  if (pref === "system") return systemDark ? "dark" : "light";
  return pref;
}

/** Toggle selalu mendarat di nilai eksplisit — gak pernah balik ke "system". */
export function nextTheme(resolved: ResolvedTheme): ThemePref {
  return resolved === "dark" ? "light" : "dark";
}
