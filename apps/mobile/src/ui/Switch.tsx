/**
 * Switch — padanan `.switch-track` + `.switch-thumb`.
 * Ditulis tangan, bukan `Switch` bawaan RN: yang bawaan gak bisa dibikin
 * ukuran & warnanya ngikut token, dan bentuknya beda antara Android & iOS.
 */
import { useEffect } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Pressable } from "react-native";
import { useTheme } from "../theme";

const W = 48;
const H = 28;
const THUMB = 22;
const PAD = (H - THUMB) / 2;

export function Switch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const th = useTheme();
  const x = useSharedValue(value ? W - THUMB - PAD : PAD);

  useEffect(() => {
    x.value = withSpring(value ? W - THUMB - PAD : PAD, th.spring.standard);
  }, [value, x, th.spring.standard]);

  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      hitSlop={10}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onChange(!value);
      }}
    >
      <View
        style={{
          width: W,
          height: H,
          borderRadius: th.radius.full,
          backgroundColor: value ? th.c.ink : th.trackOff,
          justifyContent: "center",
        }}
      >
        <Animated.View
          style={[
            {
              width: THUMB,
              height: THUMB,
              borderRadius: th.radius.full,
              backgroundColor: th.c.surface,
            },
            thumb,
          ]}
        />
      </View>
    </Pressable>
  );
}
