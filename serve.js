// Tiny zero-dependency static server — for local preview only.
// (The deployed app is just the static files in /public; no server needed.)
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "public");
const PORT = process.env.PORT || 3000;
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

http
  .createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      // SPA-ish fallback
      const idx = fs.readFileSync(path.join(ROOT, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(idx);
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () =>
    console.log(`Finance Tracker (static) at http://localhost:${PORT}`)
  );
