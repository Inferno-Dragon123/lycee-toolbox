import { Redis } from '@upstash/redis';

async function clearTranslationCache() {
    try {
        const redis = new Redis({
            url: process.env.UPSTASH_REDIS_REST_URL || 'YOUR_UPSTASH_REDIS_REST_URL',
            token: process.env.UPSTASH_REDIS_REST_TOKEN || 'YOUR_UPSTASH_REDIS_REST_TOKEN',
        });

        console.log('🔍 查找所有翻译缓存...');
        const keys = await redis.keys('trans:*');

        console.log(`📊 找到 ${keys.length} 条缓存记录`);

        if (keys.length === 0) {
            console.log('✅ 无需清理');
            return;
        }

        console.log('⚠️  准备删除所有旧的萌卡社翻译缓存');
        console.log('删除后，所有卡牌将使用 DeepSeek 重新翻译\n');

        // 批量删除
        if (keys.length > 0) {
            await redis.del(...keys);
            console.log(`✅ 已删除 ${keys.length} 条缓存`);
            console.log('下次用户查询卡牌时，将自动调用 DeepSeek 生成高质量翻译');
        }

    } catch (error) {
        console.error('❌ 错误:', error.message);
    }
}

clearTranslationCache();
