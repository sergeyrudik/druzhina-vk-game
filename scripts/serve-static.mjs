import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = join(process.cwd(), "out");
const port = Number(process.env.DRUZHINA_PORT || process.env.PORT || 3000);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

if (!existsSync(root)) {
  throw new Error("Каталог out не найден. Сначала выполните pnpm run build.");
}

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(root, safePath);

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }
  if (!existsSync(filePath)) {
    const htmlCandidate = `${filePath}.html`;
    filePath = existsSync(htmlCandidate) ? htmlCandidate : join(root, "404.html");
  }

  if (!existsSync(filePath) || !filePath.startsWith(root)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Не найдено");
    return;
  }

  response.writeHead(200, {
    "Cache-Control": extname(filePath) === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  });
  createReadStream(filePath).pipe(response);
}).listen(port, "0.0.0.0", () => {
  console.log(`Дружина запущена на http://0.0.0.0:${port}`);
});
