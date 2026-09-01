/** Tombol ikon bulat — padanan `.icon-btn` (di kartu) & `.icon-btn-paper`. */
import type { ReactNode } from "react";
import { useTheme } from "../theme";
import { Tappable } from "./Pressable";

export function IconButton({
  children,
  onPress,
  on = "card",
}: {
  children: ReactNode;
  onPress?: () => void;
  on?: "card" | "paper";
}) {
  const th = useTheme();
  return (
    <Tappable
      onPress={onPress}
      style={{
        width: 44,
        height: 44,
        borderRadius: th.radius.full,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: on === "card" ? th.c.subtle : th.c.surface,
      }}
    >
      {children}
    </Tappable>
  );
}
