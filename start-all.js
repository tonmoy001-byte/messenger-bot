/**
 * start-all.js
 * ─────────────────────────────────────────────────────────────
 * Starts both the backend server and ngrok tunnel with a single command.
 * Run: npm start
 * ─────────────────────────────────────────────────────────────
 */

const { spawn } = require("child_process");
const path = require("path");

console.log(`
╔═══════════════════════════════════════════════════════════╗
║           🚀 Cyberbot AI Startup            ║
╚═══════════════════════════════════════════════════════════╝
`);

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function startServer() {
  log("\n📦 Starting Backend Server...", colors.blue);

  const serverProcess = spawn("node", ["index.js"], {
    cwd: __dirname,
    stdio: "inherit",
    shell: true
  });

  serverProcess.on("error", (err) => {
    log(`\n❌ Failed to start server: ${err.message}`, colors.yellow);
  });

  serverProcess.on("exit", (code, signal) => {
    if (code !== 0) {
      log(`\n❌ Server process exited with code ${code}${signal ? ` (signal: ${signal})` : ""}`, colors.yellow);
    } else {
      log(`\n⚠️ Server process exited cleanly (code 0)`, colors.yellow);
    }
    log("   The server has stopped. You can restart it manually.", colors.cyan);
    // Don't exit the parent process - keep ngrok running if active
  });

  return serverProcess;
}

function startNgrok() {
  log("\n🌐 Starting ngrok Tunnel...", colors.blue);

  // Wait a bit for server to start first
  setTimeout(() => {
    // Use local ngrok.exe if available, otherwise fallback to npx
    const ngrokPath = path.join(__dirname, "ngrok.exe");
    const fs = require("fs");
    const useLocalNgrok = fs.existsSync(ngrokPath);
    
    let ngrokProcess;
    if (useLocalNgrok) {
      log("   Using local ngrok.exe...", colors.cyan);
      ngrokProcess = spawn(ngrokPath, ["http", "3000"], {
        cwd: __dirname,
        stdio: "inherit"
      });
    } else {
      ngrokProcess = spawn("npx", ["ngrok", "http", "3000"], {
        cwd: __dirname,
        stdio: "inherit",
        shell: true
      });
    }

    ngrokProcess.on("error", (err) => {
      log(`\n⚠️ Failed to start ngrok: ${err.message}`, colors.yellow);
      log("   You can manually start ngrok with: npx ngrok http 3000", colors.yellow);
    });

    ngrokProcess.on("exit", (code) => {
      log(`\n⚠️ ngrok process exited with code ${code}`, colors.yellow);
    });
  }, 3000);
}

// Main startup sequence
log("Starting all services...\n", colors.cyan);

// Start the server (which also serves the dashboard)
const server = startServer();

// Start ngrok after a short delay
startNgrok();

// Handle graceful shutdown
process.on("SIGINT", () => {
  log("\n\n🛑 Shutting down services...", colors.yellow);
  process.exit(0);
});

process.on("SIGTERM", () => {
  log("\n\n🛑 Shutting down services...", colors.yellow);
  process.exit(0);
});