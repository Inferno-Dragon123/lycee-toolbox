// api/generate-pdf.js - 后端生成带卡图的 PDF (使用 pdfkit 支持中文)
import axios from 'axios';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    let cards;
    try {
        cards = req.body?.cards;
        if (!cards || !Array.isArray(cards)) {
            console.error('[PDF Generator] 错误: 无效的请求体', req.body);
            return res.status(400).json({ error: 'Missing or invalid cards array' });
        }
    } catch (err) {
        console.error('[PDF Generator] JSON解析错误:', err.message);
        return res.status(400).json({ error: 'Invalid request format' });
    }

    console.log(`[PDF Generator] 开始生成 PDF,共 ${cards.length} 张卡`);

    try {
        // 加载中文字体
        const fontPath = path.join(__dirname, '../../fonts/NotoSansSC.ttf');
        if (!fs.existsSync(fontPath)) {
            throw new Error('中文字体文件不存在');
        }

        // 创建 PDF 文档
        const doc = new PDFDocument({
            size: 'A4',
            margins: { top: 25, left: 10, right: 10, bottom: 25 }
        });

        // 收集 PDF 数据
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => {
            const pdfBuffer = Buffer.concat(chunks);
            console.log(`[PDF Generator] 生成成功,大小: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=deck_${Date.now()}.pdf`);
            res.send(pdfBuffer);
        });

        // 注册中文字体
        doc.registerFont('NotoSansSC', fontPath);
        doc.font('NotoSansSC');

        // 标题
        doc.fontSize(18).text('卡组列表', { align: 'center' });
        doc.moveDown(1);

        const leftMargin = 10;
        const cardImgWidth = 120;   // 40mm = 113.4pt, 取 120pt
        const cardImgHeight = 168;  // 56mm = 158.7pt, 取 168pt
        const rowHeight = 195;      // 65mm = 184.3pt, 取 195pt
        const textLeftMargin = leftMargin + cardImgWidth + 24;
        const pageHeight = 842;     // A4 高度 pt
        const topMargin = 70;

        let yPos = topMargin;

        for (let i = 0; i < cards.length; i++) {
            const card = cards[i];

            // 检查是否需要新页
            if (yPos + rowHeight > pageHeight - 25) {
                doc.addPage();
                yPos = topMargin;
            }

            // 下载卡图（尝试多个URL格式）
            let imgBuffer = null;
            if (card.img) {
                const imgUrls = [
                    card.img,
                    // 尝试替换 /image/card/ 为 /card/image/
                    card.img.replace('/image/card/', '/card/image/'),
                    // 尝试添加 .png 扩展名
                    card.img.replace(/\.(jpg|jpeg)$/i, '.png')
                ];

                for (const url of imgUrls) {
                    try {
                        console.log(`[PDF Generator] 尝试下载: ${url}`);
                        const imgResp = await axios.get(url, {
                            responseType: 'arraybuffer',
                            timeout: 8000,
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                'Referer': 'https://lycee-tcg.com/',
                                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
                            }
                        });
                        imgBuffer = Buffer.from(imgResp.data);
                        console.log(`[PDF Generator] ✅ 卡图下载成功: ${url}`);
                        break; // 成功就跳出
                    } catch (imgErr) {
                        console.warn(`[PDF Generator] ❌ ${url} 失败: ${imgErr.message}`);
                    }
                }

                if (!imgBuffer) {
                    console.warn(`[PDF Generator] ⚠️  所有URL均失败: ${card.code}`);
                }
            }

            // 绘制卡图
            if (imgBuffer) {
                try {
                    doc.image(imgBuffer, leftMargin, yPos, {
                        width: cardImgWidth,
                        height: cardImgHeight
                    });
                } catch (e) {
                    console.warn(`[PDF Generator] 卡图添加失败`);
                    // 画个框
                    doc.rect(leftMargin, yPos, cardImgWidth, cardImgHeight).stroke();
                }
            } else {
                // 无图时画个框
                doc.rect(leftMargin, yPos, cardImgWidth, cardImgHeight).stroke();
            }

            // 卡号 + 数量
            doc.font('NotoSansSC').fontSize(14);
            const codeLine = `卡号: ${card.code || 'N/A'}  x${card.num || 1}`;
            doc.text(codeLine, textLeftMargin, yPos + 10, {
                width: 440
            });

            // 卡名
            doc.fontSize(13);
            const nameLine = `卡名: ${card.name || '未知'}`;
            doc.text(nameLine, textLeftMargin, yPos + 30, {
                width: 440,
                ellipsis: true
            });

            // 效果（自动换行，支持较长文本）
            doc.fontSize(11);
            const effect = card.effectTranslated || card.effect || '无效果';
            const effectText = `效果:\n${effect.replace(/\|/g, '\n')}`;
            doc.text(effectText, textLeftMargin, yPos + 52, {
                width: 440,
                height: 130,
                lineGap: 4
            });

            // 分隔线
            doc.moveTo(leftMargin, yPos + rowHeight - 8)
               .lineTo(585, yPos + rowHeight - 8)
               .stroke();

            yPos += rowHeight;
        }

        // 结束文档
        doc.end();

    } catch (error) {
        console.error('[PDF Generator] 错误:', error.message);
        return res.status(500).json({ error: 'PDF generation failed', details: error.message });
    }
}
