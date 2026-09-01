/**
 * Tema buat React Native — pengganti CSS variable di web.
 *
 * Di web, warna dibalik cukup dengan nyetel `data-theme` di <html> dan CSS
 * variable-nya ngikut. RN gak punya itu, jadi objek temanya disodorin lewat
 * context dan tiap komponen ambil warnanya dari sana.
 *
 * TIGA konversi token yang gampang salah, ditulis sekali di sini:
 *
 *  1. `tracking` di token satuannya EM, `letterSpacing` di RN satuannya DP.
 *     Jadi harus dikali ukuran font. display: -0.03 * 44 = -1.32.
 *  2. `leading` langsung jadi `lineHeight` — dua-duanya px/dp, gak usah diapa-apain.
 *  3. `fontWeight` doang GAK CUKUP di Android: kalau keluarganya gak punya
 *     berat itu, sistem malah bikin versi tebal palsu yang bentuknya beda.
 *     Jadi beratnya dibawa lewat NAMA KELUARGA (PlusJakartaSans_700Bold),
 *     `fontWeight` cuma dipasang sebagai cadangan.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useColorScheme, type TextStyle } from "react-native";
import {
  color,
  motion,
  radius,
  space,
  spring,
  type,
  type ColorName,
  type TypeName,
} from "@hakaitask/tokens";
import {
  nextTheme,
  readThemePref,
  resolveTheme,
  writeThemePref,
  type ResolvedTheme,
  type ThemePref,
} from "@hakaitask/app/theme";

/** Berat token → nama keluarga font. Lihat alasan (3) di atas. */
const FAMILY: Record<number, string> = {
  500: "PlusJakartaSans_500Medium",
  600: "PlusJakartaSans_600SemiBold",
  700: "PlusJakartaSans_700Bold",
  800: "PlusJakartaSans_800ExtraBold",
};
const MONO_FAMILY = "GeistMono_400Regular";

function textStyle(name: TypeName): TextStyle {
  const t = type[name];
  const isMono = name === "mono";
  return {
    fontFamily: isMono ? MONO_FAMILY : (FAMILY[t.weight] ?? FAMILY[500]!),
    fontSize: t.size,
    lineHeight: t.leading,
    letterSpacing: t.tracking * t.size,
    fontWeight: String(t.weight) as TextStyle["fontWeight"],
  };
}

const TEXT: Record<TypeName, TextStyle> = Object.fromEntries(
  (Object.keys(type) as TypeName[]).map((k) => [k, textStyle(k)]),
) as Record<TypeName, TextStyle>;

export interface Theme {
  scheme: ResolvedTheme;
  /**
   * Sengaja Record<ColorName, string>, bukan `typeof color.light`: token-nya
   * `as const`, jadi tipe itu ngunci nilai literal terang dan nolak palet gelap.
   */
  c: Record<ColorName, string>;
  t: Record<TypeName, TextStyle>;
  space: typeof space;
  radius: typeof radius;
  spring: typeof spring;
  motion: typeof motion;
  /** Isian track switch pas mati — padanan `color-mix(ink 15%)` di web. */
  trackOff: string;
}

interface ThemeCtx {
  theme: Theme;
  pref: ThemePref;
  setPref: (p: ThemePref) => void;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemDark = useColorScheme() === "dark";
  const [pref, setPrefState] = useState<ThemePref>(() => readThemePref());

  const scheme = resolveTheme(pref, systemDark);

  const setPref = useCallback((p: ThemePref) => {
    writeThemePref(p);
    setPrefState(p);
  }, []);

  const value = useMemo<ThemeCtx>(() => {
    const c = color[scheme];
    return {
      pref,
      setPref,
      toggle: () => setPref(nextTheme(scheme)),
      theme: {
        scheme,
        c,
        t: TEXT,
        space,
        radius,
        spring,
        motion,
        trackOff: scheme === "dark" ? "#3A3A3F" : "#D8D8D8",
      },
    };
  }, [scheme, pref, setPref]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme() di luar <ThemeProvider>");
  return ctx.theme;
}

export function useThemePref(): Omit<ThemeCtx, "theme"> {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useThemePref() di luar <ThemeProvider>");
  const { theme: _theme, ...rest } = ctx;
  return rest;
}
