import axios from 'axios';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

// 直接使用 REST API 批量导入
async function batchImportToRedis() {
  console.log('='.repeat(60));
  console.log('Lycee 日文数据库批量导入 Upstash Redis (REST API)');
  console.log('='.repeat(60));
  console.log();

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.error('❌ 错误: 未找到 UPSTASH_REDIS_REST_URL 或 UPSTASH_REDIS_REST_TOKEN');
    console.error('请在 .env 文件中配置这两个环境变量');
    process.exit(1);
  }

  // 读取JSON数据库
  const database = JSON.parse(fs.readFileSync('lycee-japanese-database-final.json', 'utf-8'));
  const cards = database.cards;

  console.log(`📋 准备批量导入 ${cards.length} 张卡牌到 Redis\n`);

  // 使用 pipeline 批量导入
  const batchSize = 100; // 每批100张
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < cards.length; i += batchSize) {
    const batch = cards.slice(i, Math.min(i + batchSize, cards.length));
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(cards.length / batchSize);

    process.stdout.write(`批次 [${batchNum}/${totalBatches}] (${batch.length} 张) ... `);

    try {
      // 构建 pipeline 命令
      const commands = batch.map(card => [
        'SET',
        `lycee:japanese:${card.code}`,
        JSON.stringify(card)
      ]);

      // 发送 pipeline 请求
      const response = await axios.post(
        `${url}/pipeline`,
        commands,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.status === 200) {
        successCount += batch.length;
        console.log('✅');
      } else {
        failCount += batch.length;
        console.log(`❌ (状态码: ${response.status})`);
      }

      // 每批之间休息一下
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      failCount += batch.length;
      console.log(`❌ (${error.message})`);
    }
  }

  console.log(`\n✅ 导入成功: ${successCount} 张`);
  console.log(`❌ 导入失败: ${failCount} 张`);

  console.log('\n' + '='.repeat(60));
  console.log('✅ 导入完成！');
  console.log('='.repeat(60));
}

batchImportToRedis().catch(err => {
  console.error('错误:', err.message);
  process.exit(1);
});
