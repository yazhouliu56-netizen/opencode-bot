const http = require("http");
const https = require("https");
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GH_TOKEN = process.env.GITHUB_TOKEN;
const PORT = process.env.PORT || 3000;

function httpsPost(host, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const opts = { hostname: host, path, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } };
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

async function askAI(question) {
  if (!GH_TOKEN) return null;
  try {
    const d = await httpsPost("models.inference.ai.azure.com", "/chat/completions", {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: question }],
      max_tokens: 512,
    });
    return d?.choices?.[0]?.message?.content || null;
  } catch { return null; }
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
          const chat = msg.chat.id;

          if (t === "/start") {
            send(chat, "Hello! I am OpenCode Bot.\n/help - Commands\n/ask <q> - AI answer\n/status - Status\n/ping - Pong");
          } else if (t === "/help") {
            send(chat, "/ask <q> - Ask AI\n/status - Status\n/ping - Pong\n/echo <t> - Echo");
          } else if (t === "/status") {
            let s = "Bot online (Webhook)\n";
            s += GH_TOKEN ? "AI: Connected\n" : "AI: No GITHUB_TOKEN (set in ENV)\n";
            send(chat, s);
          } else if (t === "/ping") {
            send(chat, "pong");
          } else if (t.startsWith("/ask ")) {
            const q = t.slice(5);
            send(chat, "Thinking...");
            askAI(q).then(a => send(chat, a || "AI unavailable (set GITHUB_TOKEN)")).catch(() => send(chat, "Error"));
          } else if (t.startsWith("/echo ")) {
            send(chat, t.slice(6));
          } else {
            send(chat, "Unknown: " + t + "\nUse /help");
          }
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
