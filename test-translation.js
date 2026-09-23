import axios from 'axios';
import readline from 'readline';

// 配置
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'sk-fd77023f6d844a53b39efa90ac251bda';
const API_URL = 'https://api.deepseek.com/chat/completions';

// 默认参数
let config = {
    temperature: 0.3,
    maxTokens: 1500,
    topP: 0.95,
    frequencyPenalty: 0
};

// 系统提示词
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

// 测试示例
const samples = {
    1: '[諸神々への祈り]\n【宣言】（ｺｽﾄ：このｷｬﾗをﾀﾞｳﾝする）：目標のあなたのｷｬﾗ１体を選ぶ。次の相手ﾀｰﾝの終了時まで、そのｷｬﾗの能力すべてを無効にする。',
    2: '[雪月花]\n【誘発】(ｺｽﾄ：このｷｬﾗをﾀﾞｳﾝする)：あなたが登場したｷｬﾗ１体は次の相手ﾀｰﾝの終了時まで、AP+2/DP+2/SP+2を得る。さらにあなたの控え室のｷｬﾗ１体を目標として選んでもよい。その場合、そのｷｬﾗを登場させる。',
    3: '【自動α】：このｷｬﾗがｵｰﾀﾞｰｴﾘｱに登場した場合、相手のｷｬﾗ１体をﾀﾞｳﾝする。'
};

// 翻译函数
async function translate(text) {
    console.log('\n🔄 翻译中...');
    console.log(`📊 当前参数: temp=${config.temperature}, maxTokens=${config.maxTokens}, topP=${config.topP}, freqPenalty=${config.frequencyPenalty}`);

    const startTime = Date.now();

    try {
        const response = await axios.post(
            API_URL,
            {
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `请翻译以下日文卡牌效果：\n\n${text}` }
                ],
                temperature: config.temperature,
                max_tokens: config.maxTokens,
                top_p: config.topP,
                frequency_penalty: config.frequencyPenalty,
                stream: false
            },
            {
                headers: {
                    'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        const elapsed = Date.now() - startTime;
        const result = response.data.choices[0].message.content.trim();
        const usage = response.data.usage;

        console.log('\n✅ 翻译完成');
        console.log(`⏱️  耗时: ${elapsed}ms`);
        console.log(`📈 Token用量: prompt=${usage.prompt_tokens}, completion=${usage.completion_tokens}, total=${usage.total_tokens}`);
        console.log('\n📝 原文:');
        console.log('─'.repeat(60));
        console.log(text);
        console.log('\n🎯 译文:');
        console.log('─'.repeat(60));
        console.log(result);
        console.log('─'.repeat(60));

    } catch (error) {
        console.error('\n❌ 翻译失败:', error.response?.data?.error?.message || error.message);
    }
}

// 显示帮助
function showHelp() {
    console.log('\n📖 命令列表:');
    console.log('  sample <1-3>       - 加载测试示例');
    console.log('  trans <文本>       - 翻译指定文本');
    console.log('  temp <0-2>         - 设置temperature');
    console.log('  tokens <100-4000>  - 设置max_tokens');
    console.log('  topp <0-1>         - 设置top_p');
    console.log('  freq <0-2>         - 设置frequency_penalty');
    console.log('  preset <模式>      - 快速预设 (accurate/balanced/creative)');
    console.log('  config             - 显示当前参数');
    console.log('  help               - 显示此帮助');
    console.log('  exit               - 退出程序');
}

// 显示当前配置
function showConfig() {
    console.log('\n⚙️  当前参数配置:');
    console.log(`  Temperature:        ${config.temperature}`);
    console.log(`  Max Tokens:         ${config.maxTokens}`);
    console.log(`  Top P:              ${config.topP}`);
    console.log(`  Frequency Penalty:  ${config.frequencyPenalty}`);
}

// 预设模式
function setPreset(mode) {
    switch (mode) {
        case 'accurate':
            config.temperature = 0.1;
            config.topP = 0.9;
            config.frequencyPenalty = 0;
            console.log('✅ 已切换到精确模式');
            break;
        case 'balanced':
            config.temperature = 0.3;
            config.topP = 0.95;
            config.frequencyPenalty = 0;
            console.log('✅ 已切换到平衡模式');
            break;
        case 'creative':
            config.temperature = 0.7;
            config.topP = 1.0;
            config.frequencyPenalty = 0.3;
            console.log('✅ 已切换到创意模式');
            break;
        default:
            console.log('❌ 未知模式，可用: accurate, balanced, creative');
    }
    showConfig();
}

// 主程序
async function main() {
    console.log('🔧 Lycee 翻译测试工具');
    console.log('═'.repeat(60));

    console.log(`🔑 API Key: ${DEEPSEEK_API_KEY.substring(0, 10)}...${DEEPSEEK_API_KEY.substring(DEEPSEEK_API_KEY.length - 4)}\n`);

    showHelp();
    showConfig();

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: '\n> '
    });

    rl.prompt();

    rl.on('line', async (line) => {
        const input = line.trim();
        const parts = input.split(' ');
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1).join(' ');

        switch (cmd) {
            case 'sample':
                const num = parseInt(args);
                if (samples[num]) {
                    await translate(samples[num]);
                } else {
                    console.log('❌ 示例编号无效，请使用 1-3');
                }
                break;

            case 'trans':
                if (args) {
                    await translate(args);
                } else {
                    console.log('❌ 请提供要翻译的文本');
                }
                break;

            case 'temp':
                const temp = parseFloat(args);
                if (!isNaN(temp) && temp >= 0 && temp <= 2) {
                    config.temperature = temp;
                    console.log(`✅ Temperature 设置为 ${temp}`);
                } else {
                    console.log('❌ 请提供 0-2 之间的数值');
                }
                break;

            case 'tokens':
                const tokens = parseInt(args);
                if (!isNaN(tokens) && tokens >= 100 && tokens <= 4000) {
                    config.maxTokens = tokens;
                    console.log(`✅ Max Tokens 设置为 ${tokens}`);
                } else {
                    console.log('❌ 请提供 100-4000 之间的数值');
                }
                break;

            case 'topp':
                const topp = parseFloat(args);
                if (!isNaN(topp) && topp >= 0 && topp <= 1) {
                    config.topP = topp;
                    console.log(`✅ Top P 设置为 ${topp}`);
                } else {
                    console.log('❌ 请提供 0-1 之间的数值');
                }
                break;

            case 'freq':
                const freq = parseFloat(args);
                if (!isNaN(freq) && freq >= 0 && freq <= 2) {
                    config.frequencyPenalty = freq;
                    console.log(`✅ Frequency Penalty 设置为 ${freq}`);
                } else {
                    console.log('❌ 请提供 0-2 之间的数值');
                }
                break;

            case 'preset':
                setPreset(args);
                break;

            case 'config':
                showConfig();
                break;

            case 'help':
                showHelp();
                break;

            case 'exit':
                console.log('👋 再见！');
                process.exit(0);
                break;

            case '':
                break;

            default:
                console.log(`❌ 未知命令: ${cmd}，输入 help 查看帮助`);
        }

        rl.prompt();
    });

    rl.on('close', () => {
        console.log('\n👋 再见！');
        process.exit(0);
    });
}

main();
