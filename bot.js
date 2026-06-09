const http = require("http");
const https = require("https");
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GH_TOKEN = process.env.GITHUB_TOKEN;
const PORT = process.env.PORT || 3000;

function httpsPost(host, path, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const headers = { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...extraHeaders };
    const opts = { hostname: host, path, method: "POST", headers };
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

async function searchWeb(query) {
  return new Promise(resolve => {
    const r = https.get("https://s.jina.ai/" + encodeURIComponent(query), { timeout: 8000 }, res => {
      let d = ""; res.on("data", c => d += c); res.on("end", () => {
        const m = d.match(/<article>([\s\S]*?)<\/article>/g);
        resolve(m ? m.slice(0, 3).join("\n").replace(/<[^>]+>/g, "").slice(0, 2000) : "");
      });
    });
    r.on("error", () => resolve(""));
    r.end();
  });
}

async function askAI(question) {
  if (!GH_TOKEN) return null;
  const today = new Date().toISOString().slice(0, 10);
  let context = "";
  try { context = await searchWeb(question); } catch {}
  const sysMsg = "You are OpenCode AI assistant. Today is " + today + ". Answer helpfully and concisely. Use the web context below if relevant.";
  const msgs = [{ role: "system", content: sysMsg }, { role: "user", content: question }];
  if (context) msgs.splice(1, 0, { role: "system", content: "Web context:\n" + context });
  try {
    const d = await httpsPost("models.inference.ai.azure.com", "/chat/completions", {
      model: "gpt-4o-mini", messages: msgs, max_tokens: 1024,
    }, { "Authorization": "Bearer " + GH_TOKEN });
    return d?.choices?.[0]?.message?.content || null;
  } catch { return null; }
}

async function send(chatId, text) {
  if (!TOKEN) return;
  try { await httpsPost("api.telegram.org", "/bot" + TOKEN + "/sendMessage", { chat_id: chatId, text: text.slice(0, 4096) }); } catch {}
}

async function setWebhook() {
  if (!TOKEN) { console.log("No TOKEN"); return; }
  const base = process.env.RENDER_EXTERNAL_URL || "https://opencode-bot-80xf.onrender.com";
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
          const isCmd = t.startsWith("/");

          if (t === "/start") {
            send(chat, "Hello! I am OpenCode Bot.\n直接发文字给我，我会用AI回答。\n/status - Status\n/help - Commands");
          } else if (t === "/help") {
            send(chat, "直接发文字给我即可。\n/status - 状态\n/ping - Pong");
          } else if (t === "/status") {
            send(chat, "Bot online (Webhook)\nAI: " + (GH_TOKEN ? "Connected" : "No GITHUB_TOKEN"));
          } else if (t === "/ping") {
            send(chat, "pong");
          } else if (!isCmd) {
            send(chat, "Thinking...");
            askAI(t).then(a => send(chat, a || "AI unavailable")).catch(() => send(chat, "Error"));
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
