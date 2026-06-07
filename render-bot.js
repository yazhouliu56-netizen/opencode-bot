// OpenCode Telegram Bot - Render.com 部署版
// 环境变量: TELEGRAM_BOT_TOKEN, GITHUB_TOKEN, NVIDIA_KEY, GROQ_KEY

const express = require('express');
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json());

const TG_API = 'https://api.telegram.org/bot' + TOKEN;

// 模型调用（直接用 NVIDIA / GitHub，不需要本地 bridge）
async function callAI(text) {
  const key = process.env.NVIDIA_KEY || process.env.GITHUB_TOKEN;
  const base = process.env.NVIDIA_KEY
    ? 'https://integrate.api.nvidia.com/v1'
    : 'https://models.inference.ai.azure.com';
  const model = process.env.NVIDIA_KEY
    ? 'meta/llama-3.1-70b-instruct'
    : 'gpt-4.1-nano';

  const res = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: text }], max_tokens: 1024 }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return '❌ 处理失败，请稍后重试';
  const d = await res.json();
  return d.choices?.[0]?.message?.content || '✅ 已处理（无返回内容）';
}

app.post('/webhook', async (req, res) => {
  const msg = req.body.message;
  if (!msg || !msg.text) { res.sendStatus(200); return; }

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
