/**
 * Kartu — padanan `.card`.
 * TANPA border, TANPA shadow: elevasinya murni dari kontras surface vs paper
 * (§7.3). Kebetulan itu juga yang paling gampang dipindah ke RN, karena
 * `elevation` Android dan `shadow*` iOS gak pernah kelihatan sama.
 */
import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";
import { useTheme } from "../theme";

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const th = useTheme();
  return (
    <View
      style={[
        { backgroundColor: th.c.surface, borderRadius: th.radius.md, padding: th.space[4] },
        style,
      ]}
    >
      {children}
    </View>
  );
}
