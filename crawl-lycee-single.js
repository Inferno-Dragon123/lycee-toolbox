import axios from 'axios';

// 从单个卡片页面提取日文原文
async function fetchJapaneseText(code) {
    try {
        const url = `https://lycee-tcg.com/card/card_detail.pl?cardno=${code}`;
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 30000
        });

        const html = response.data;

        console.log('HTTP Status:', response.status);
        console.log('Content length:', html.length);

        // 搜索包含"チャージ"的部分
        const chargeIndex = html.indexOf('チャージ');
        if (chargeIndex !== -1) {
            console.log('\n找到"チャージ"，周围内容:');
            console.log(html.substring(chargeIndex - 200, chargeIndex + 500));
        }

        // 提取效果文本区域 - 正确的模式：height="200px"
        let match = html.match(/<td colspan="10" height="200px"[^>]*>([\s\S]*?)<\/td>/i);

        if (!match) {
            // 也尝试其他高度值
            match = html.match(/<td colspan="10" height="[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
        }

        if (!match) {
            console.log('\n未找到效果区域');
            return null;
        }

        if (!match) {
            return null;
        }

        const effectHtml = match[1];

        // 清理 HTML 标签，保留换行
        const text = effectHtml
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<DIV[\s\S]*?<\/DIV>/gi, '') // 移除底部链接
            .replace(/<[^>]+>/g, '')
            .replace(/\[このカードを使用したデッキを検索する\]/g, '')
            .replace(/\s+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        return text;

    } catch (error) {
        console.error(`❌ ${code} 获取失败:`, error.message);
        return null;
    }
}

// 测试单张卡片
async function testSingleCard() {
    console.log('='.repeat(60));
    console.log('测试单张卡片: LO-6420-K');
    console.log('='.repeat(60));

    const text = await fetchJapaneseText('LO-6420-K');

    if (text) {
        console.log('\n✅ 成功提取日文原文:');
        console.log('─'.repeat(60));
        console.log(text);
        console.log('─'.repeat(60));
    } else {
        console.log('\n❌ 提取失败');
    }
}

testSingleCard();
