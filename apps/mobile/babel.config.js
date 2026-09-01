module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // WAJIB paling akhir. Di Reanimated 4 paketnya pindah dari
    // "react-native-reanimated/plugin" ke sini.
    plugins: ["react-native-worklets/plugin"],
  };
};
