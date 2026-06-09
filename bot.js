const http = require("http");
const https = require("https");
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GH_TOKEN = process.env.GITHUB_TOKEN;
const GA_KEY = process.env.GOOGLE_API_KEY;
const GA_CX = process.env.GOOGLE_CX;
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

function httpsBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => { let d = []; res.on("data", c => d.push(c)); res.on("end", () => resolve(Buffer.concat(d))); }).on("error", reject);
  });
}

async function downloadTelegramFile(fileId) {
  const f = await httpsGet("api.telegram.org", "/bot" + TOKEN + "/getFile?file_id=" + fileId);
  if (!f?.result?.file_path) return null;
  return await httpsBuffer("https://api.telegram.org/file/bot" + TOKEN + "/" + f.result.file_path);
}

async function searchGoogle(query) {
  if (!GA_KEY || !GA_CX) return null;
  const url = "https://www.googleapis.com/customsearch/v1?key=" + GA_KEY + "&cx=" + GA_CX + "&q=" + encodeURIComponent(query) + "&hl=zh-CN&num=3";
  return new Promise(resolve => {
    https.get(url, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => {
      try {
        const items = JSON.parse(d).items || [];
        resolve(items.map((i, idx) => (idx + 1) + ". " + i.title + " - " + (i.link || "") + "\n   " + (i.snippet || "")).join("\n\n").slice(0, 2000));
      } catch { resolve(null); }
    }); }).on("error", () => resolve(null));
  });
}

async function searchDuck(query) {
  return new Promise(resolve => {
    const r = https.get("https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(query), { timeout: 10000, headers: { "User-Agent": "Mozilla/5.0" } }, res => {
      let d = ""; res.on("data", c => d += c); res.on("end", () => {
        const titles = [...d.matchAll(/class='result-link'>([^<]+)<\/a>/g)].map(m => m[1]);
        const snippets = [...d.matchAll(/class='result-snippet'>([^<]*(?:<[^>]+>[^<]*)*)<\/td>/g)].map(m => m[1].replace(/<[^>]+>/g, ""));
        const urls = [...d.matchAll(/class='link-text'>([^<]+)<\/span>/g)].map(m => m[1]);
        const lines = [];
        for (let i = 0; i < Math.min(3, titles.length); i++) {
          lines.push((i + 1) + ". " + titles[i] + " - " + (urls[i] || "") + "\n   " + (snippets[i] || ""));
        }
        resolve(lines.join("\n\n").slice(0, 2000));
      });
    });
    r.on("error", () => resolve(""));
    r.end();
  });
}

async function searchWeb(query) {
  return (await searchGoogle(query)) || (await searchDuck(query)) || "";
}

async function askAI(question) {
  if (!GH_TOKEN) return null;
  const today = new Date().toISOString().slice(0, 10);
  let context = "";
  try { context = await searchWeb(question); } catch {}
  const msgs = [{ role: "system", content: "You are OpenCode AI assistant. Today is " + today + ". Answer directly from the web context below. Do NOT tell users to check sources themselves - you summarize the information for them." }, { role: "user", content: question }];
  if (context) msgs.splice(1, 0, { role: "system", content: "Web search results (use these to answer directly):\n" + context });
  try {
    const d = await httpsPost("models.inference.ai.azure.com", "/chat/completions", {
      model: "gpt-4o", messages: msgs, max_tokens: 1024,
    }, { "Authorization": "Bearer " + GH_TOKEN });
    return d?.choices?.[0]?.message?.content || null;
  } catch { return null; }
}

async function analyzeImage(base64, mime) {
  if (!GH_TOKEN) return "AI unavailable (no GITHUB_TOKEN)";
  try {
    const d = await httpsPost("models.inference.ai.azure.com", "/chat/completions", {
      model: "gpt-4o", max_tokens: 512,
      messages: [{
        role: "user", content: [
          { type: "text", text: "Describe this image in detail in the user's language." },
          { type: "image_url", image_url: { url: "data:" + mime + ";base64," + base64 } }
        ]
      }]
    }, { "Authorization": "Bearer " + GH_TOKEN });
    return d?.choices?.[0]?.message?.content || "Could not analyze image.";
  } catch { return "Vision API error."; }
}

async function transcribeAudio(base64) {
  if (!GH_TOKEN) return "AI unavailable (no GITHUB_TOKEN)";
  const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
  const body = Buffer.concat([
    Buffer.from("--" + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="voice.ogg"\r\nContent-Type: audio/ogg\r\n\r\n'),
    Buffer.from(base64, "base64"),
    Buffer.from('\r\n--' + boundary + '\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n--' + boundary + '--\r\n')
  ]);
  return new Promise(resolve => {
    const opts = { hostname: "models.inference.ai.azure.com", path: "/openai/deployments/whisper/audio/transcriptions?api-version=2024-10-21", method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=" + boundary, "Content-Length": body.length, "Authorization": "Bearer " + GH_TOKEN } };
    const r = https.request(opts, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => { try { resolve(JSON.parse(d).text); } catch { resolve(null); } }); });
    r.on("error", () => resolve(null));
    r.write(body);
    r.end();
  });
}

async function send(chatId, text) {
  if (!TOKEN) return;
  try { await httpsPost("api.telegram.org", "/bot" + TOKEN + "/sendMessage", { chat_id: chatId, text: text.slice(0, 4096) }); } catch {}
}

async function sendAction(chatId, action) {
  if (!TOKEN) return;
  try { await httpsPost("api.telegram.org", "/bot" + TOKEN + "/sendChatAction", { chat_id: chatId, action }); } catch {}
}

async function setWebhook() {
  if (!TOKEN) { console.log("No TOKEN"); return; }
  const base = process.env.RENDER_EXTERNAL_URL || "https://opencode-bot-80xf.onrender.com";
  try {
    const d = await httpsGet("api.telegram.org", "/bot" + TOKEN + "/setWebhook?url=" + base + "/webhook");
    console.log("Webhook:", d?.description || "?");
  } catch (e) { console.error("Webhook fail:", e.message); }
}

function handleMessage(msg) {
  const chat = msg.chat.id;
  if (msg.text) {
    const t = msg.text.trim();
    const isCmd = t.startsWith("/");
    if (t === "/start") return send(chat, "Hello! I am OpenCode Bot.\nSend text, photos, or voice messages.\n/read <url> - Read & summarize a webpage\n/status - Status\n/help - Commands");
    if (t === "/help") return send(chat, "Send text / photos / voice. AI auto-answers.\n/read <url> - Summarize a webpage\n/status - Info\n/ping - Pong");
    if (t === "/status") return send(chat, "Bot online\nSearch: " + (GA_KEY && GA_CX ? "Google" : "DuckDuckGo") + "\nVision: " + (GH_TOKEN ? "GPT-4o" : "off") + "\nVoice: " + (GH_TOKEN ? "Whisper" : "off"));
    if (t === "/ping") return send(chat, "pong");
    if (t.startsWith("/read ")) {
      sendAction(chat, "typing");
      const url = t.slice(6).trim();
      if (!url.startsWith("http")) return send(chat, "Invalid URL. Use /read https://...");
      httpsBuffer(url).then(buf => {
        const html = buf.toString("utf8").replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 4000);
        if (html.length < 50) return send(chat, "Could not read page content.");
        httpsPost("models.inference.ai.azure.com", "/chat/completions", {
          model: "gpt-4o", max_tokens: 512,
          messages: [{ role: "system", content: "Summarize this webpage content concisely in Chinese." }, { role: "user", content: html }]
        }, { "Authorization": "Bearer " + GH_TOKEN }).then(d => send(chat, d?.choices?.[0]?.message?.content || "Summary failed.")).catch(() => send(chat, "AI error."));
      }).catch(() => send(chat, "Failed to fetch URL."));
      return;
    }
    if (!isCmd) {
      send(chat, "Thinking...");
      askAI(t).then(a => send(chat, a || "AI unavailable")).catch(() => send(chat, "Error"));
    }
    return;
  }
  if (msg.photo) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    sendAction(chat, "typing");
    downloadTelegramFile(fileId).then(buf => {
      if (!buf) return send(chat, "Failed to download image.");
      const b64 = buf.toString("base64");
      const mime = "image/jpeg";
      send(chat, "Analyzing image...");
      analyzeImage(b64, mime).then(desc => send(chat, desc));
    }).catch(() => send(chat, "Image download error."));
    return;
  }
  if (msg.voice) {
    sendAction(chat, "typing");
    downloadTelegramFile(msg.voice.file_id).then(buf => {
      if (!buf) return send(chat, "Failed to download voice.");
      send(chat, "Transcribing...");
      transcribeAudio(buf.toString("base64")).then(text => send(chat, text || "Transcription failed (whisper may not be available on this plan)."));
    }).catch(() => send(chat, "Voice download error."));
    return;
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/webhook") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const update = JSON.parse(body);
        if (update.message) handleMessage(update.message);
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
