import https from 'https';
import fs from 'fs';

async function testSingleCard(code) {
    console.log(`\n测试卡牌: ${code}`);
    console.log(`URL: https://lycee-tcg.com/card/card_detail.pl?cardno=${code}`);

    return new Promise((resolve) => {
        const startTime = Date.now();

        const req = https.get(`https://lycee-tcg.com/card/card_detail.pl?cardno=${code}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
                'Connection': 'keep-alive'
            },
            timeout: 30000
        }, (res) => {
            console.log(`状态码: ${res.statusCode}`);
            console.log(`响应头: ${JSON.stringify(res.headers, null, 2)}`);

            let html = '';
            res.on('data', chunk => html += chunk);
            res.on('end', () => {
                const elapsed = Date.now() - startTime;
                console.log(`响应时间: ${elapsed}ms`);
                console.log(`HTML长度: ${html.length}`);

                // 检查是否包含效果文本的table
                const hasTable = html.includes('colspan="10"');
                console.log(`包含colspan="10": ${hasTable}`);

                // 尝试提取
                const match = html.match(/<td colspan="10" height="[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
                if (match) {
                    const effectHtml = match[1];
                    const japaneseText = effectHtml
                        .replace(/<br\s*\/?>/gi, '\n')
                        .replace(/<DIV[\s\S]*?<\/DIV>/gi, '')
                        .replace(/<[^>]+>/g, '')
                        .trim();
                    console.log(`✅ 提取成功:`);
                    console.log(japaneseText.substring(0, 200));
                } else {
                    console.log(`❌ 正则匹配失败`);
                    // 保存HTML到文件以便检查
                    const filename = `debug-${code}.html`;
                    fs.writeFileSync(filename, html);
                    console.log(`HTML已保存到: ${filename}`);
                }

                resolve();
            });
        });

        req.on('timeout', () => {
            console.log('❌ 请求超时 (30s)');
            req.destroy();
            resolve();
        });

        req.on('error', (err) => {
            console.log(`❌ 请求错误: ${err.message}`);
            resolve();
        });
    });
}

(async () => {
    // 测试前3张失败的卡牌
    const testCodes = ['LO-6666', 'LO-6667', 'LO-6668'];

    for (const code of testCodes) {
        await testSingleCard(code);
        await new Promise(r => setTimeout(r, 2000)); // 2秒间隔
    }
})();
