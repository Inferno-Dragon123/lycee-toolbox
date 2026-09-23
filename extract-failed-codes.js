import fs from 'fs';

const content = fs.readFileSync('C:/Users/35057/Desktop/失败.md', 'utf-8');

// 提取所有 LO- 开头的卡牌编号（处理转义的 \-）
const matches = content.match(/LO\\?-[0-9A-Z\\-]+/g) || [];
// 去掉反斜杠转义
const codes = matches.map(code => code.replace(/\\/g, ''));
const uniqueCodes = [...new Set(codes)].sort();

console.log(`找到 ${uniqueCodes.length} 张失败的卡牌\n`);
console.log('前20张:');
uniqueCodes.slice(0, 20).forEach(code => console.log(code));

// 保存到文件
fs.writeFileSync('failed-cards.txt', uniqueCodes.join('\n'), 'utf-8');

console.log(`\n✅ 已保存到 failed-cards.txt`);
console.log(`📊 总计: ${uniqueCodes.length} 张`);
