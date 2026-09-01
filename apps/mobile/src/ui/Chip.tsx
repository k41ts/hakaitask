/** Chip — padanan `.chip` / `.chip-active`. */
import type { ViewStyle } from "react-native";
import { useTheme } from "../theme";
import { Tappable } from "./Pressable";
import { T } from "./T";

export function Chip({
  label,
  onPress,
  active,
  style,
}: {
  label: string;
  onPress?: () => void;
  active?: boolean;
  style?: ViewStyle;
}) {
  const th = useTheme();
  return (
    <Tappable
      onPress={onPress}
      style={[
        {
          backgroundColor: active ? th.c.ink : th.c.subtle,
          borderRadius: th.radius.full,
          paddingVertical: 8,
          paddingHorizontal: 14,
          minHeight: 36,
          alignSelf: "flex-start",
        },
        style ?? {},
      ]}
    >
      <T variant="meta" tone={active ? "surface" : "ink70"}>
        {label}
      </T>
    </Tappable>
  );
}
