// OpenCode Telegram Bot - Render.com 部署版
// 环境变量: TELEGRAM_BOT_TOKEN, GITHUB_TOKEN, NVIDIA_KEY, GROQ_KEY

const express = require('express');
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json());

const TG_API = 'https://api.telegram.org/bot' + TOKEN;

// 模型调用（优先 GitHub gpt-4.1-nano 速度快，NVIDIA 兜底）
async function callAI(text) {
  const ghKey = process.env.GITHUB_TOKEN;
  const nvKey = process.env.NVIDIA_KEY;

  // GitHub (响应快)
  if (ghKey) {
    try {
      const res = await fetch('https://models.inference.ai.azure.com/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + ghKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4.1-nano', messages: [{ role: 'user', content: text }], max_tokens: 1024 }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) { const d = await res.json(); return d.choices?.[0]?.message?.content || '✅ 已处理'; }
    } catch {}
  }

  // NVIDIA (兜底)
  if (nvKey) {
    try {
      const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + nvKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'meta/llama-3.1-70b-instruct', messages: [{ role: 'user', content: text }], max_tokens: 1024 }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) { const d = await res.json(); return d.choices?.[0]?.message?.content || '✅ 已处理'; }
    } catch {}
  }

  return '❌ 处理失败，请确认环境变量 GITHUB_TOKEN 或 NVIDIA_KEY 已设置';
}

app.post('/webhook', async (req, res) => {
  const msg = req.body.message;
  if (!msg) { res.sendStatus(200); return; }
  // 不支持图片/文件/非文字输入
  if (!msg.text) {
    const chatId = msg.chat.id;
    await fetch(TG_API + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: '抱歉，我只支持文字消息。请直接发文字给我。' }),
    });
    res.sendStatus(200); return;
  }

  const chatId = msg.chat.id;
  const text = msg.text;

  // 发送"处理中"提示
  await fetch(TG_API + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: '⏳ 处理中...' }),
  });

  const reply = await callAI(text);
  await fetch(TG_API + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: reply.slice(0, 4000) }),
  });

  res.sendStatus(200);
});

app.get('/', (req, res) => res.send('OpenCode Bot Running'));

// 设置 Webhook
async function setWebhook() {
  const url = process.env.RENDER_EXTERNAL_URL || 'http://localhost:' + PORT;
  const res = await fetch(TG_API + '/setWebhook?url=' + url + '/webhook');
  const data = await res.json();
  console.log('Webhook:', data.description);
}

app.listen(PORT, async () => {
  console.log('Bot started on :' + PORT);
  await setWebhook();
});
