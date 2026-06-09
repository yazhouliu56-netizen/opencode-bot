const http = require("http");
const https = require("https");
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PORT = process.env.PORT || 3000;

function httpsPost(host, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const opts = { hostname: host, path: path, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } };
    const r = https.request(opts, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } }); });
    r.on("error", reject);
    r.write(data);
    r.end();
  });
}

function httpsGet(host, path) {
  return new Promise((resolve, reject) => {
    const r = https.get("https://" + host + path, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } }); });
    r.on("error", reject);
  });
}

async function send(chatId, text) {
  if (!TOKEN) return;
  try { await httpsPost("api.telegram.org", "/bot" + TOKEN + "/sendMessage", { chat_id: chatId, text: text.slice(0, 4096) }); } catch {}
}

async function setWebhook() {
  if (!TOKEN) { console.log("No TOKEN"); return; }
  const base = process.env.RENDER_EXTERNAL_URL || "https://opencode-bot.onrender.com";
  try {
    const d = await httpsGet("api.telegram.org", "/bot" + TOKEN + "/setWebhook?url=" + base + "/webhook");
    console.log("Webhook:", d?.description || "?");
  } catch (e) { console.error("Webhook fail:", e.message); }
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/webhook") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const msg = JSON.parse(body).message;
        if (msg && msg.text) {
          const t = msg.text.trim();
          if (t === "/start") send(msg.chat.id, "Hello! I am OpenCode Bot. Commands: /help");
          else if (t === "/help") send(msg.chat.id, "/status /ping /echo <text>");
          else if (t === "/status") send(msg.chat.id, "Online (Webhook)");
          else if (t === "/ping") send(msg.chat.id, "pong");
          else if (t.startsWith("/echo ")) send(msg.chat.id, t.slice(6));
          else send(msg.chat.id, "Unknown: " + t + " - use /help");
        }
      } catch {}
      res.end("OK");
    });
  } else {
    res.end("OK");
  }
});

server.listen(PORT, () => {
  console.log("Bot on port " + PORT);
  setTimeout(setWebhook, 2000);
});
