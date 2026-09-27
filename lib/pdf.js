import axios from 'axios';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

export async function downloadImages(cards) {
    const images = new Map();
    let next = 0;
    const abort = new AbortController();
    const deadline = setTimeout(() => abort.abort(), 18000);
    try {
        await Promise.all(Array.from({ length: Math.min(4, cards.length) }, async () => {
            while (next < cards.length && !abort.signal.aborted) {
                const card = cards[next++];
                try {
                    const response = await axios.get(card.img, { responseType: 'arraybuffer', timeout: 6000,
                        signal: abort.signal, maxRedirects: 0, maxContentLength: 3000000,
                        headers: { Referer: 'https://lycee-tcg.com/', 'User-Agent': 'LyceeToolbox/1.0' } });
                    // Match print size while keeping the PDF within Vercel's response limit.
                    const image = await sharp(Buffer.from(response.data), { limitInputPixels: 12000000 })
                        .resize({ width: 480, withoutEnlargement: true }).flatten({ background: '#fff' })
                        .jpeg({ quality: 78 }).toBuffer();
                    images.set(card.code, image);
                } catch { /* Keep the text card table if a remote image is unavailable. */ }
            }
        }));
    } finally { clearTimeout(deadline); }
    return images;
}

export async function renderPdf(deck, cards, images) {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 30, bottom: 30, left: 24, right: 24 }, bufferPages: true });
    const chunks = [];
    const finished = new Promise((resolve, reject) => {
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });
    let missingImages = 0;
    doc.registerFont('Chinese', fileURLToPath(new URL('../public/fonts/NotoSansSC.ttf', import.meta.url)));
    doc.font('Chinese').fontSize(17).text(deck.name, { align: 'center' });
    doc.fontSize(10).text(`${cards.length} 种 / ${Object.values(deck.cards).reduce((a, b) => a + b, 0)} 张`, { align: 'center' });
    let y = doc.y + 18;
    const imageX = 24, imageW = 102, imageH = 143, textX = 142;
    const width = doc.page.width - textX - 24;
    for (const card of cards) {
        const name = `${card.code} × ${deck.cards[card.code]}\n${card.name}`;
        const effect = [(card.effectZh || card.effect || '无效果').replace(/\|/g, '\n'), card.team].filter(Boolean).join('\n');
        const label = card.translated ? '效果' : '效果（日文）';
        doc.fontSize(12);
        const headingH = doc.heightOfString(name, { width, lineGap: 2 });
        doc.fontSize(10);
        const text = `${label}\n${effect}`;
        const rowH = Math.max(imageH, headingH + 8 + doc.heightOfString(text, { width, lineGap: 3 })) + 18;
        if (y + Math.min(rowH, doc.page.height - 60) > doc.page.height - 30) { doc.addPage(); y = 30; }
        if (images.has(card.code)) {
            try { doc.image(images.get(card.code), imageX, y, { fit: [imageW, imageH] }); }
            catch { missingImages++; doc.fontSize(9).text('卡图不可用', imageX, y, { width: imageW }); }
        } else { missingImages++; doc.fontSize(9).text('卡图暂不可用', imageX, y, { width: imageW }); }
        const pageBefore = doc.bufferedPageRange().count;
        doc.fontSize(12).text(name, textX, y, { width, lineGap: 2 });
        doc.fontSize(10).text(text, textX, doc.y + 8, { width, lineGap: 3 });
        // PDFKit flows unusually long effects onto following pages; resume below actual text.
        y = (doc.bufferedPageRange().count === pageBefore ? Math.max(y + imageH, doc.y) : doc.y) + 18;
        if (y < doc.page.height - 30) doc.moveTo(24, y - 8).lineTo(doc.page.width - 24, y - 8).strokeColor('#ccd7e6').stroke();
    }
    const range = doc.bufferedPageRange();
    for (let page = 0; page < range.count; page++) {
        doc.switchToPage(page);
        const bottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.fontSize(8).fillColor('#5b738f').text(`${page + 1} / ${range.count}`, 24, doc.page.height - 22,
            { width: doc.page.width - 48, align: 'center', lineBreak: false });
        doc.page.margins.bottom = bottom;
    }
    doc.end();
    return { buffer: await finished, missingImages };
}
