import { defineConfig } from "@solidjs/start/config";
import tailwindcss from "@tailwindcss/vite";
import { initializeDiscord } from "./src/server/services/discord/index";

console.log("Loading app.config.ts");
console.log("NODE_ENV", process.env);

if (!process.env.PORT) {
  console.error("PORT is not set. Please set the PORT environment variable.");
  process.exit(1);
}

initializeDiscord()
  .then(() => {
    console.log("Discord client initialized");
  })
  .catch((error) => {
    console.error("Error initializing Discord client:", error);
    process.exit(1);
  });

export default defineConfig({
  vite: {
    ssr: { external: ["@prisma/client"] },
    plugins: [tailwindcss()],
    server: {
      port: Number(process.env.PORT),
    },
  },
});
