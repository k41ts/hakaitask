/**
 * Env-nya diambil dari .env.local di AKAR monorepo, bukan dari apps/mobile —
 * biar satu berkas dipakai bareng web (Vite udah baca ke sana lewat
 * `envDir: "../.."`). Expo sendiri cuma ngelirik folder app-nya.
 */
import type { ConfigContext, ExpoConfig } from "expo/config";
import { config as loadEnv } from "dotenv";
import path from "node:path";

loadEnv({ path: path.resolve(__dirname, "../../.env.local") });

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  extra: {
    ...config.extra,
    supabaseUrl: process.env.VITE_SUPABASE_URL,
    supabaseKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  },
});
