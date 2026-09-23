import { createClient } from '@vercel/kv';
import fs from 'fs';

// 从环境变量读取Redis配置
// 你需要在 .env 文件中添加：
// UPSTASH_REDIS_REST_URL=https://your-redis-url.upstash.io
// UPSTASH_REDIS_REST_TOKEN=your-token

const redis = createClient({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function importToRedis() {
  console.log('='.repeat(60));
  console.log('Lycee 日文数据库导入 Upstash Redis');
  console.log('='.repeat(60));
  console.log();

  // 读取JSON数据库
  const database = JSON.parse(fs.readFileSync('lycee-japanese-database-final.json', 'utf-8'));
  const cards = database.cards;

  console.log(`📋 准备导入 ${cards.length} 张卡牌到 Redis\n`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const progress = i + 1;
    const percent = ((progress / cards.length) * 100).toFixed(1);

    process.stdout.write(`[${progress}/${cards.length}] (${percent}%) ${card.code} ... `);

    try {
      // 使用卡牌code作为key，存储整个卡牌对象
      const key = `lycee:japanese:${card.code}`;
      await redis.set(key, JSON.stringify(card));
      successCount++;
      console.log('✅');

      // 每100张休息一下，避免请求过快
      if ((i + 1) % 100 === 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      failCount++;
      console.log(`❌ ${error.message}`);
    }
  }

  console.log(`\n✅ 导入成功: ${successCount} 张`);
  console.log(`❌ 导入失败: ${failCount} 张`);

  console.log('\n' + '='.repeat(60));
  console.log('✅ 导入完成！');
  console.log('='.repeat(60));
}

importToRedis().catch(err => {
  console.error('错误:', err.message);
  process.exit(1);
});
