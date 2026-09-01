/**
 * Metro di monorepo pnpm — bagian yang paling gampang bikin pusing.
 *
 * Empat hal yang harus bener bareng-bareng, kalau enggak error-nya muncul
 * jauh dari sebabnya.
 */
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");
const fs = require("node:fs");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const packagesRoot = path.join(workspaceRoot, "packages");

const config = getDefaultConfig(projectRoot);

// 1. packages/* itu symlink — Metro harus ngawasin seluruh workspace.
config.watchFolders = [workspaceRoot];

// 2. pnpm naruh dependensi di dua akar yang dua-duanya sah.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// 3. Subpath exports: "@hakaitask/core/chat", "@hakaitask/app/format".
config.resolver.unstable_enablePackageExports = true;

// 4. Dua salinan React = "invalid hook call" yang paling susah dilacak.
//    Symlink pnpm bikin itu gampang kejadian, jadi dipatok eksplisit.
config.resolver.extraNodeModules = {
  react: path.resolve(workspaceRoot, "node_modules/react"),
  "react-native": path.resolve(projectRoot, "node_modules/react-native"),
};

/**
 * packages/* nulis impor gaya NodeNext ("../types.js") padahal berkasnya .ts —
 * konsekuensi `verbatimModuleSyntax`, dan sengaja gak diubah karena itu
 * konvensi penulisnya. Metro nyelesaiin spesifier apa adanya, jadi ".js"
 * dipetakan balik ke ".ts" KHUSUS di dalam packages/. node_modules asli gak
 * disentuh — di sana ".js" emang beneran ".js".
 */
const baseResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName.startsWith(".") &&
    moduleName.endsWith(".js") &&
    context.originModulePath &&
    context.originModulePath.startsWith(packagesRoot)
  ) {
    const stem = path.resolve(
      path.dirname(context.originModulePath),
      moduleName.slice(0, -3),
    );
    for (const ext of [".ts", ".tsx"]) {
      if (fs.existsSync(stem + ext)) {
        return { type: "sourceFile", filePath: stem + ext };
      }
    }
  }
  return (baseResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
