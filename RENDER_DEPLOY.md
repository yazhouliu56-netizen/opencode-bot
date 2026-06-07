# 将 Telegram Bot 部署到 Render.com（免费 24/7）

## 前提
- 一个 GitHub 账号
- 一个 Render.com 账号

## 步骤

### 1. 创建 GitHub 仓库
```bash
# 在 D:\dev 目录
cd D:\dev
mkdir opencode-bot
cd opencode-bot

# 复制相关文件
copy ..\telegram-bot\render-bot.js bot.js
copy ..\telegram-bot\package.json .
copy ..\telegram-bot\render.yaml .
copy ..\bridge\ask.js .
copy ..\bridge\query-expert.js .
copy ..\bridge\query-models.js .
copy ..\bridge\router.js .
copy ..\bridge\errors.js .
copy ..\bridge\env.js .
copy ..\bridge\memory.js .
copy ..\config\.env .

# 忽略敏感文件
echo .env > .gitignore
echo node_modules >> .gitignore

# 推送
git init
git add -A
git commit -m "init"
git remote add origin https://github.com/yazhouliu56/opencode-bot.git
git push -u origin main
```

### 2. 在 Render.com 部署
1. 打开 https://dashboard.render.com
2. 点 "New +" → "Web Service"
3. 连接你的 GitHub 仓库 `opencode-bot`
4. 设置:
   - Name: `opencode-bot`
   - Environment: `Node`
   - Build Command: `npm install`
   - Start Command: `node bot.js`
   - Plan: **Free**
5. 添加环境变量:
   - `TELEGRAM_BOT_TOKEN`: 你的 Bot Token
6. 点 "Create Web Service"

### 3. 验证
Render 会自动部署，几分钟后 Bot 就在线了。
访问 https://t.me/你的机器人用户名 发消息测试。

## 注意
- 免费版 15 分钟无请求会休眠，唤醒需 5-10 秒
- 可以用 UptimeRobot (https://uptimerobot.com) 每 5 分钟 ping 一次保持在线
- 或升级到 Starter 计划 ($7/月) 永不休眠
