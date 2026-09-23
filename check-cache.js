import { Redis } from '@upstash/redis';

async function checkCache() {
    try {
        const redis = new Redis({
            url: process.env.UPSTASH_REDIS_REST_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN,
        });

        const key = 'trans:LO-6420-K';
        const cached = await redis.get(key);

        console.log('Redis 缓存内容 (LO-6420-K):');
        console.log('─'.repeat(60));
        if (cached) {
            console.log('中文翻译:');
            console.log(cached.zh || '(无)');
            console.log('\n日文原文:');
            console.log(cached.src || '(无)');
            console.log('\n时间戳:', cached.ts ? new Date(cached.ts).toLocaleString('zh-CN') : '(无)');
        } else {
            console.log('未找到缓存');
        }
        console.log('─'.repeat(60));

    } catch (error) {
        console.error('错误:', error.message);
    }
}

checkCache();
