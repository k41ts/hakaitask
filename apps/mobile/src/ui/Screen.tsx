/** Bingkai halaman: latar `paper`, aman dari notch, padding sisi 24. */
import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme";

export function Screen({
  children,
  style,
  pad = true,
}: {
  children: ReactNode;
  style?: ViewStyle;
  pad?: boolean;
}) {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        {
          flex: 1,
          backgroundColor: th.c.paper,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          ...(pad ? { paddingHorizontal: th.space[4] } : {}),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
