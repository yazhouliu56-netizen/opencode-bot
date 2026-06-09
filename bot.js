const express = require("express");
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json());

app.post("/webhook", (req, res) => {
  const msg = req.body.message;
  if (!msg || !msg.text) { res.sendStatus(200); return; }
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const name = msg.from?.first_name || "User";

  if (text === "/start") {
    send(chatId, `Hello ${name}! I am OpenCode Bot.\nCommands: /help, /status, /ping`);
  } else if (text === "/help") {
    send(chatId, "/start - Welcome\n/status - System status\n/ping - Latency test\n/echo <text> - Echo back");
  } else if (text === "/status") {
    send(chatId, "✅ Bot online (Webhook mode)");
  } else if (text === "/ping") {
    send(chatId, "pong");
  } else if (text.startsWith("/echo ")) {
    send(chatId, text.slice(6));
  } else {
    send(chatId, "Unknown: " + text + "\nUse /help for commands");
  }
  res.sendStatus(200);
});

app.get("/", (req, res) => res.send("OK"));

async function send(chatId, text) {
  try {
    await fetch("https://api.telegram.org/bot" + TOKEN + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096) }),
    });
  } catch {}
}

async function setWebhook() {
  const base = process.env.RENDER_EXTERNAL_URL || ("https://opencode-bot.onrender.com");
  try {
    const r = await fetch("https://api.telegram.org/bot" + TOKEN + "/setWebhook?url=" + base + "/webhook");
    const d = await r.json();
    console.log("Webhook:", d.description || "OK");
  } catch (e) { console.error("Webhook fail:", e.message); }
}

app.listen(PORT, () => { console.log("Bot on :" + PORT); setWebhook(); });