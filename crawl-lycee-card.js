import axios from 'axios';

async function testCardPage() {
    try {
        // 测试 LO-6420-K 详情页
        const response = await axios.get('https://lycee-tcg.com/card/?code=LO-6420-K', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const html = response.data;

        // 提取卡名
        const nameMatch = html.match(/<h2[^>]*class="[^"]*card-name[^"]*"[^>]*>([^<]+)<\/h2>/i) ||
                         html.match(/<h2[^>]*>([^<]+)<\/h2>/);

        // 提取效果文本 (通常在 ability 或 effect class 里)
        const abilityMatch = html.match(/<div[^>]*class="[^"]*ability[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        const effectMatch = html.match(/<div[^>]*class="[^"]*effect[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

        console.log('='.repeat(60));
        console.log('LO-6420-K 卡片页面结构分析');
        console.log('='.repeat(60));

        if (nameMatch) {
            console.log('\n✅ 找到卡名:', nameMatch[1].trim());
        }

        if (abilityMatch) {
            const abilityHtml = abilityMatch[1];
            const abilityText = abilityHtml
                .replace(/<br\s*\/?>/gi, '|')
                .replace(/<[^>]+>/g, '')
                .replace(/&nbsp;/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            console.log('\n✅ 找到效果文本 (ability class):');
            console.log(abilityText);
        }

        if (effectMatch) {
            const effectHtml = effectMatch[1];
            const effectText = effectHtml
                .replace(/<br\s*\/?>/gi, '|')
                .replace(/<[^>]+>/g, '')
                .replace(/&nbsp;/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            console.log('\n✅ 找到效果文本 (effect class):');
            console.log(effectText);
        }

        if (!abilityMatch && !effectMatch) {
            console.log('\n❌ 未找到效果文本，需要手动分析 HTML');
            console.log('\n部分 HTML 内容:');
            console.log(html.substring(0, 2000));
        }

    } catch (error) {
        console.error('❌ 错误:', error.message);
    }
}

testCardPage();
