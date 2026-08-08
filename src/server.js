require("dotenv").config();
const { app, server, io, startServer } = require("../index");
const next = require("next");
const { parse } = require("url");

const dev = process.env.NODE_ENV !== "production";
const port = process.env.PORT || 3000;
const hostname = "localhost";

const nextApp = next({ dev, hostname, port, dir: "./dashboard" });
const handle = nextApp.getRequestHandler();

async function main() {
  await nextApp.prepare();

  app.use((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  await startServer();

  server.listen(port, () => {
    console.log(`\n Server running at http://localhost:${port}`);
    console.log(` Dashboard: http://localhost:${port}/dashboard`);
    console.log(` API: http://localhost:${port}/api/admin/stats\n`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
