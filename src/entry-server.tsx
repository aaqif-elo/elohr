// @refresh reload
import { config } from "dotenv";
config();
import { createHandler, StartServer } from "@solidjs/start/server";
console.log("Starting the server...");
import { initializeDiscord } from "./server/services/discord/index";

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
export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="icon" href="/favicon.ico" />
          {assets}
        </head>
        <body>
          <div id="app">{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
));
console.log("Server started successfully.");