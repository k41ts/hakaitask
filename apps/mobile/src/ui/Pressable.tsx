/**
 * Dasar buat semua yang bisa ditekan: skala 0.97 + haptic ringan.
 *
 * Dua aturan §7.2a yang gampang kelewat kalau tiap tombol nulis sendiri:
 * target sentuh minimal 44dp, dan animasinya pakai spring `press` dari token
 * (damping 18, stiffness 320) — bukan angka karangan.
 */
import type { ReactNode } from "react";
import { Pressable as RNPressable, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useTheme } from "../theme";

const AnimatedPressable = Animated.createAnimatedComponent(RNPressable);

export function Tappable({
  children,
  onPress,
  style,
  haptic = true,
  disabled,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: ViewStyle | ViewStyle[];
  haptic?: boolean;
  disabled?: boolean;
}) {
  const th = useTheme();
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      disabled={disabled}
      onPressIn={() => {
        scale.value = withSpring(0.97, th.spring.press);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, th.spring.press);
      }}
      onPress={() => {
        if (haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.();
      }}
      style={[{ minHeight: 44, justifyContent: "center" }, anim, style]}
    >
      {children}
    </AnimatedPressable>
  );
}
