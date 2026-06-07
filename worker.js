// OpenCode Telegram Bot - Cloudflare Workers 版
// 环境变量: TELEGRAM_BOT_TOKEN, GITHUB_TOKEN
// 部署: 复制此文件到 Cloudflare Workers 控制台, 或通过 wrangler CLI 部署

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 特殊端点：在浏览器访问 /setup 即可设置 Webhook
    if (url.pathname === '/setup') {
      const webhookUrl = url.origin + '/webhook';
      const res = await fetch('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/setWebhook?url=' + webhookUrl);
      const data = await res.json();
      return new Response(JSON.stringify(data, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 只接收 POST (Telegram Webhook)
    if (request.method !== 'POST') {
      return new Response('OK');
    }

    const update = await request.json();
    const msg = update.message;
    if (!msg) return new Response('OK');

    if (!msg.text) {
      await send(env.TELEGRAM_BOT_TOKEN, msg.chat.id, '抱歉，我只支持文字消息，不支持图片/文件。');
      return new Response('OK');
    }

    const text = msg.text;
    const chatId = msg.chat.id;
    await send(env.TELEGRAM_BOT_TOKEN, chatId, '⏳ 处理中...');

    const reply = await callAI(env, text);
    await send(env.TELEGRAM_BOT_TOKEN, chatId, reply.slice(0, 4000));
    return new Response('OK');
  },
};

async function callAI(env, text) {
  // 1. GitHub gpt-4.1-nano (快)
  if (env.GITHUB_TOKEN) {
    try {
      const res = await fetch('https://models.inference.ai.azure.com/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + env.GITHUB_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4.1-nano', messages: [{ role: 'user', content: text }], max_tokens: 1024 }),
        signal: AbortSignal.timeout(25000),
      });
      if (res.ok) { const d = await res.json(); return d.choices?.[0]?.message?.content || '✅ 已处理'; }
    } catch {}
  }

  return '❌ 处理失败。请联系管理员检查 GITHUB_TOKEN 是否已设置。';
}

async function send(token, chatId, text) {
  try {
    await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch {}
}
