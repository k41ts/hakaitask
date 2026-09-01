/** Teks bertema — padanan `.t-display` / `.t-meta` / `.t-num` / `.t-mono` di web. */
import { Text, type TextProps, type TextStyle } from "react-native";
import type { TypeName } from "@hakaitask/tokens";
import { useTheme } from "../theme";

type Tone = "ink" | "ink70" | "ink40" | "accent" | "surface";

export interface TProps extends TextProps {
  variant?: TypeName;
  tone?: Tone;
  /** Angka & jam: lebarnya dikunci biar gak goyang tiap detik berubah. */
  tabular?: boolean;
}

export function T({ variant = "body", tone = "ink", tabular, style, ...rest }: TProps) {
  const th = useTheme();
  const base = th.t[variant];

  // `display` 44px kegedean buat layar HP — dipangkas, sisanya ikut token.
  const size = variant === "display" ? 32 : base.fontSize;
  const leading = variant === "display" ? 36 : base.lineHeight;

  const s: TextStyle = {
    ...base,
    fontSize: size,
    lineHeight: leading,
    color: th.c[tone],
    ...(tabular || variant === "num" ? { fontVariant: ["tabular-nums"] } : {}),
  };

  return <Text {...rest} style={[s, style]} />;
}
