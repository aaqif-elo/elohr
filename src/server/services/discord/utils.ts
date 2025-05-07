import { launch } from "puppeteer";

export const getAttendanceStatsImage = async (token: string) => {
  const browser = await launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  // Set the viewport size
  await page.setViewport({ width: 1300, height: 700 });
  // inject JWT into localStorage on every new document before any script runs
  await page.evaluateOnNewDocument((token: string) => {
    window.localStorage.setItem("authJWT", token);
  }, token);
  await page.goto("http://localhost:2500/home", { waitUntil: "networkidle0" });

  await page.waitForSelector("#app");
  // Set local storage with the JWT
  await page.evaluate((token) => {
    localStorage.setItem("authJWT", token);
  }, token);
  // Navigate to the page that uses the JWT

  // Wait for the page to load
  await page.waitForSelector("#app");
  // Take a screenshot of the page
  const buffer = await page.screenshot({
    encoding: "binary",
    type: "png",
    fullPage: true,
  });
  await browser.close();
  return Buffer.from(buffer);
};
