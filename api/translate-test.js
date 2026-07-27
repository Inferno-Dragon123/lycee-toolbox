import axios from 'axios';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const {
        text,
        code,
        temperature = 0.3,
        maxTokens = 1500,
        topP = 0.95,
        frequencyPenalty = 0,
        useCache = false
    } = req.body;

    if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: '请提供有效的文本' });
    }

    try {
        // 如果启用缓存且提供了code，先检查Redis缓存
        let fromCache = false;
        if (useCache && code) {
            const { Redis } = await import('@upstash/redis');
            const redis = new Redis({
                url: process.env.UPSTASH_REDIS_REST_URL,
                token: process.env.UPSTASH_REDIS_REST_TOKEN,
            });

            const cacheKey = `trans:${String(code)}`;
            const cached = await redis.get(cacheKey);

            if (cached && cached.zh) {
                return res.status(200).json({
                    translatedText: cached.zh,
                    fromCache: true,
                    parameters: { temperature, maxTokens, topP, frequencyPenalty }
                });
            }
        }

        // 构建系统提示词
        const systemPrompt = `你是一个专业的日语到中文翻译助手，专门翻译Lycee卡牌游戏的卡牌效果。

翻译规则：
1. 保留所有特殊符号：【】、（）、：、｜等
2. 专有名词翻译对照：
   - ｷｬﾗ → 角色
   - ｵｰﾀﾞｰｴﾘｱ → 序列区
   - ｺｽﾄ → cost
   - ﾀﾞｳﾝ → down
   - ﾀｰﾝ → 回合
   - AP → AP
   - DP → DP
   - SP → SP
   - 宣言 → 宣言
   - 誘発 → 诱发
   - 自動 → 自动
   - 永続 → 永续
   - 控え室 → 等待区
   - 登場 → 登场
   - 破棄 → 弃置
3. 保持原文的换行和格式
4. 翻译要准确、流畅，符合中文卡牌游戏术语习惯
5. 对于能力效果的描述要清晰准确，不要意译或省略关键信息

请直接输出翻译结果，不要添加任何解释或说明。`;

        // 调用DeepSeek API
        const response = await axios.post(
            'https://api.deepseek.com/chat/completions',
            {
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `请翻译以下日文卡牌效果：\n\n${text}` }
                ],
                temperature: temperature,
                max_tokens: maxTokens,
                top_p: topP,
                frequency_penalty: frequencyPenalty,
                stream: false
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        const translatedText = response.data.choices[0].message.content.trim();

        // 如果提供了code，保存到缓存
        if (code) {
            try {
                const { Redis } = await import('@upstash/redis');
                const redis = new Redis({
                    url: process.env.UPSTASH_REDIS_REST_URL,
                    token: process.env.UPSTASH_REDIS_REST_TOKEN,
                });

                const cacheKey = `trans:${String(code)}`;
                await redis.set(cacheKey, {
                    zh: translatedText,
                    src: text,
                    ts: Date.now()
                }, { ex: 2592000 }); // 30天过期
            } catch (cacheError) {
                console.error('缓存保存失败:', cacheError);
                // 缓存失败不影响返回结果
            }
        }

        return res.status(200).json({
            translatedText,
            fromCache: false,
            parameters: {
                temperature,
                maxTokens,
                topP,
                frequencyPenalty
            },
            usage: response.data.usage
        });

    } catch (error) {
        console.error('翻译API错误:', error.response?.data || error.message);

        return res.status(500).json({
            error: '翻译失败',
            details: error.response?.data?.error?.message || error.message
        });
    }
}
