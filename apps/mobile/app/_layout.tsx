// Wajib paling atas: supabase-js butuh URL/URLSearchParams yang gak ada di Hermes.
import "react-native-url-polyfill/auto";

import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import {
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from "@expo-google-fonts/plus-jakarta-sans";
import { GeistMono_400Regular } from "@expo-google-fonts/geist-mono";
import { configureStorage } from "@hakaitask/core/store";
import { configurePlatform } from "@hakaitask/app";
import { mobilePlatform, mobileStorage } from "../src/platform";
import { ThemeProvider, useTheme } from "../src/theme";

// Sinkron dan idempoten, jadi aman dipanggil saat modul dievaluasi — posisinya
// sama kayak `main.tsx` di web, sebelum store kesentuh siapa pun.
configurePlatform(mobilePlatform);

export default function RootLayout() {
  const [hydrated, setHydrated] = useState(false);
  const [fontsReady] = useFonts({
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    GeistMono_400Regular,
  });

  useEffect(() => {
    // Hydrate-nya ditunda (`skipHydration` di core), jadi dipicu di sini.
    void configureStorage(mobileStorage).then(() => setHydrated(true));
  }, []);

  // Nunggu DUA-duanya. Kalau font belum siap, RN diem-diem jatuh ke font
  // sistem dan teksnya sempet "lompat" pas font aslinya masuk.
  if (!hydrated || !fontsReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <Chrome />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** Di dalam provider, biar warna bar-nya ikut tema. */
function Chrome() {
  const th = useTheme();
  return (
    <>
      <StatusBar style={th.scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: th.c.paper },
        }}
      />
    </>
  );
}
