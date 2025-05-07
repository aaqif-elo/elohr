import { defineConfig } from "@solidjs/start/config";
import tailwindcss from "@tailwindcss/vite";
import { config } from "dotenv";

config();
console.log("Loading app.config.ts");
console.log("NODE_ENV", process.env);

if (!process.env.PORT) {
  console.error("PORT is not set. Please set the PORT environment variable.");
  process.exit(1);
}

export default defineConfig({
  vite: {
    ssr: { external: ["@prisma/client"] },
    plugins: [tailwindcss()],
    server: {
      port: Number(process.env.PORT),
    },
  },
});
