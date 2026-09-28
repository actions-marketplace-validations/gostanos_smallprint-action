import { defineConfig } from "tsup";

// one CommonJS file, with the command's discovery code bundled in; vscode is provided by the editor
export default defineConfig({ entry: { extension: "src/extension.ts" }, format: ["cjs"], target: "node20", platform: "node", bundle: true, external: ["vscode"], clean: true, outDir: "dist", minify: false, sourcemap: false });
