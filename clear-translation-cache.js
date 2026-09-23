import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

async function clearOldTranslationCache() {
  console.log('='.repeat(60));
  console.log('清理旧的翻译缓存（基于劣质中文）');
  console.log('='.repeat(60));
  console.log();

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.error('❌ 错误: 未找到 Redis 配置');
    process.exit(1);
  }

  console.log('📋 扫描并删除 trans: 开头的翻译缓存键...\n');

  try {
    let cursor = '0';
    let totalDeleted = 0;

    do {
      const scanResponse = await axios.post(
        `${url}/scan/${cursor}`,
        ['MATCH', 'trans:*', 'COUNT', '100'],
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      cursor = scanResponse.data.result[0];
      const keys = scanResponse.data.result[1];

      if (keys.length > 0) {
        await axios.post(
          `${url}/del`,
          keys,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          }
        );

        totalDeleted += keys.length;
        console.log(`删除了 ${keys.length} 个缓存键 (累计: ${totalDeleted})`);
      }

      await new Promise(resolve => setTimeout(resolve, 100));

    } while (cursor !== '0');

    console.log(`\n✅ 清理完成！共删除 ${totalDeleted} 个旧的翻译缓存`);

  } catch (error) {
    console.error('❌ 清理失败:', error.message);
    process.exit(1);
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ 清理完成！');
  console.log('='.repeat(60));
}

clearOldTranslationCache();
