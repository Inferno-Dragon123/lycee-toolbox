import axios from 'axios';
import https from 'https';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// 访问卡片详情页
axios.get('https://www.moetcg.club/cardBuilder/detail/cid/99823.html', {
    headers: {
        'Referer': 'https://www.moetcg.club/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    httpsAgent
}).then(response => {
    const html = response.data;

    // 查找包含日文的部分
    const customKeyMatches = html.match(/custom_key_\d+/g);
    if (customKeyMatches) {
        console.log('找到的 custom_key 字段:', [...new Set(customKeyMatches)]);
    }

    // 查找可能的 API 调用
    const apiMatches = html.match(/https?:\/\/[^\s"']+api[^\s"']*/gi);
    if (apiMatches) {
        console.log('\n找到的 API 地址:', [...new Set(apiMatches)]);
    }

    // 查找效果文本
    const effectMatch = html.match(/<div[^>]*class="[^"]*effect[^"]*"[^>]*>([\s\S]{0,500}?)<\/div>/i);
    if (effectMatch) {
        console.log('\n效果区域HTML片段:');
        console.log(effectMatch[0].substring(0, 300));
    }

}).catch(e => console.error('错误:', e.message));
