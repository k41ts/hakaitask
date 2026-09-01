/** Tombol pil — padanan `.btn-pill` (solid) & `.btn-pill-soft` (di atas paper). */
import type { ViewStyle } from "react-native";
import { useTheme } from "../theme";
import { Tappable } from "./Pressable";
import { T } from "./T";

export function Pill({
  label,
  onPress,
  tone = "solid",
  style,
  disabled,
}: {
  label: string;
  onPress?: () => void;
  tone?: "solid" | "soft";
  style?: ViewStyle;
  disabled?: boolean;
}) {
  const th = useTheme();
  const solid = tone === "solid";
  return (
    <Tappable
      onPress={onPress}
      disabled={disabled}
      style={[
        {
          backgroundColor: solid ? th.c.ink : th.c.surface,
          borderRadius: th.radius.full,
          paddingVertical: 13,
          paddingHorizontal: th.space[4],
          alignItems: "center",
          opacity: disabled ? 0.4 : 1,
        },
        style ?? {},
      ]}
    >
      <T variant="meta" tone={solid ? "surface" : "ink"}>
        {label}
      </T>
    </Tappable>
  );
}
