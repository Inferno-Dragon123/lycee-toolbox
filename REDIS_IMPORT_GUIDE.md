# Lycee 日文数据库导入 Redis 指南

## 步骤 1: 获取 Upstash Redis 连接信息

1. 登录 [Upstash Console](https://console.upstash.com/)
2. 选择你的 Redis 数据库
3. 在 "REST API" 选项卡中找到：
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

## 步骤 2: 配置环境变量

在 `.env` 文件中添加（如果没有则创建）：

```bash
UPSTASH_REDIS_REST_URL=https://your-redis-url.upstash.io
UPSTASH_REDIS_REST_TOKEN=AXXXXxxxxxxxxxxxxxxxxxxxxxx
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## 步骤 3: 安装依赖

```bash
npm install @vercel/kv
```

## 步骤 4: 运行导入脚本

```bash
node import-to-redis.js
```

## 数据结构

每张卡牌在 Redis 中：

**Key**: `lycee:japanese:{code}`  
**Value**: JSON 字符串

## 导入后如何使用

```javascript
import { createClient } from '@vercel/kv';

const redis = createClient({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// 获取某张卡牌的日文原文
const cardData = await redis.get(`lycee:japanese:${code}`);
const card = JSON.parse(cardData);
console.log(card.japaneseText);
```

## 注意事项

- 导入约 9,585 张卡牌，预计需要 10-15 分钟
- 每 100 张卡牌会暂停 1 秒
- Upstash 免费版有请求限制
