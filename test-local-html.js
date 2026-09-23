import axios from 'axios';
import fs from 'fs';

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

        // 提取效果文本区域 (td colspan="10" height="200px")
        const match = html.match(/<td colspan="10" height="[^"]*"[^>]*>([\s\S]*?)<\/td>/i);

        if (!match) {
            console.log('未找到效果区域');
            return null;
        }

        const effectHtml = match[1];

        // 清理 HTML 标签，保留换行
        const text = effectHtml
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<DIV[\s\S]*?<\/DIV>/gi, '')
            .replace(/<[^>]+>/g, '')
            .replace(/\[このカードを使用したデッキを検索する\]/g, '')
            .replace(/\s+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        return text;

    } catch (error) {
        console.error(`获取失败:`, error.message);
        return null;
    }
}

// 测试本地 HTML 文件
async function testLocalFile() {
    console.log('='.repeat(60));
    console.log('测试本地 HTML 文件: 6420.html');
    console.log('='.repeat(60));

    const html = fs.readFileSync('6420.html', 'utf-8');

    const match = html.match(/<td colspan="10" height="[^"]*"[^>]*>([\s\S]*?)<\/td>/i);

    if (match) {
        const effectHtml = match[1];
        const text = effectHtml
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<DIV[\s\S]*?<\/DIV>/gi, '')
            .replace(/<[^>]+>/g, '')
            .replace(/\[このカードを使用したデッキを検索する\]/g, '')
            .replace(/\s+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        console.log('\n✅ 成功提取日文原文:');
        console.log('─'.repeat(60));
        console.log(text);
        console.log('─'.repeat(60));
    } else {
        console.log('\n❌ 未找到效果区域');
    }
}

testLocalFile();
