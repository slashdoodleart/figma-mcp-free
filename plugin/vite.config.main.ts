import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2015",
    lib: {
      entry: "src/main/code.ts",
      formats: ["iife"],
      name: "code",
      fileName: () => "code.js"
    },
    outDir: "dist",
    emptyOutDir: false,
    minify: false
  }
});
