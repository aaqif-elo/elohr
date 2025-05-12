import { defineConfig } from "@solidjs/start/config";
import tailwindcss from "@tailwindcss/vite";

import { config } from "dotenv";
config();

export default defineConfig({
  vite: {
    optimizeDeps: {
      exclude: [
        "mongodb",
        "axios",
        "cheerio",
        "cron",
        "discord.js",
        "jsonwebtoken",
        "valibot",
        "puppeteer",
        "@google/genai",
      ],
    },
    ssr: {
      external: [
        "@prisma/client",
        "mongodb",
        "axios",
        "cheerio",
        "cron",
        "discord.js",
        "jsonwebtoken",
        "valibot",
        "puppeteer",
        "@google/genai",
      ],
    },
    plugins: [tailwindcss()],
    server: {
      port: Number(process.env.PORT),
    },
    resolve: {
      alias: {
        ".prisma/client/index-browser":
          "./node_modules/.prisma/client/index-browser.js",
      },
    },
  },
});
