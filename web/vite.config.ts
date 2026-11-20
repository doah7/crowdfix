import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 브라우저는 web(5173)만 보고, /api 요청은 FastAPI로 넘긴다.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": process.env.API_PROXY_TARGET ?? "http://localhost:8000",
    },
  },
});
