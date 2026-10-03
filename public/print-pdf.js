import { jsPDF } from 'jspdf';
import { validateDeck } from './deck-format.js';

export const PRINT_LAYOUT = Object.freeze({ width: 210, height: 297, margin: 7, gap: 1, cardWidth: 63, cardHeight: 88 });

export function printSlots(input) {
    const deck = validateDeck(input);
    const { width, height, margin, gap, cardWidth, cardHeight } = PRINT_LAYOUT;
    const columns = Math.floor((width - 2 * margin + gap) / (cardWidth + gap));
    const rows = Math.floor((height - 2 * margin + gap) / (cardHeight + gap));
    const slots = [];
    for (const [code, quantity] of Object.entries(deck.cards)) {
        for (let copy = 0; copy < quantity; copy++) {
            const index = slots.length, cell = index % (columns * rows);
            slots.push({ code, page: Math.floor(index / (columns * rows)),
                x: margin + (cell % columns) * (cardWidth + gap),
                y: margin + Math.floor(cell / columns) * (cardHeight + gap) });
        }
    }
    return slots;
}

// Use the existing same-origin image proxy. Reject its transparent failure placeholder:
// a print sheet must never silently omit a card or substitute a blank image.
export async function loadPrintImage(card) {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 15000);
    let bitmap;
    try {
        const url = card.originalImg && card.originalImg !== (card.sourceImg || card.img) ? card.originalImg :
            '/api/image-proxy?url=' + encodeURIComponent(card.sourceImg || card.img);
        const response = await fetch(url, { signal: abort.signal });
        if (!response.ok) throw new Error('Image download failed');
        const blob = await response.blob();
        bitmap = await createImageBitmap(blob);
        if (bitmap.width < 100 || bitmap.height < 100 || bitmap.width * bitmap.height > 12000000) throw new Error('Invalid card image');
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        const context = canvas.getContext('2d');
        context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0);
        // Preserve source resolution. JPEG avoids huge PNG PDFs on image-heavy decks.
        return canvas.toDataURL('image/jpeg', 0.95);
    } finally { clearTimeout(timer); bitmap?.close(); }
}

export async function createPrintPdf(input, cardInfo, { loadImage = loadPrintImage, onProgress = () => {} } = {}) {
    const deck = validateDeck(input), slots = printSlots(deck);
    const cards = new Map(cardInfo.map(card => [card.code, card]));
    const codes = Object.keys(deck.cards), images = new Map(), failures = [];
    const unknown = codes.filter(code => !(cards.get(code)?.originalImg || cards.get(code)?.img));
    if (unknown.length) throw new Error(`缺少卡图资料：${unknown.join('、')}`);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, codes.length) }, async () => {
        while (next < codes.length && !failures.length) {
            const code = codes[next++];
            try { images.set(code, await loadImage(cards.get(code))); }
            catch { failures.push(code); }
            if (!failures.length) onProgress(images.size, codes.length);
        }
    }));
    if (failures.length) throw new Error(`卡图加载失败：${failures.join('、')}。请稍后重新导出，未生成不完整的打印文件。`);
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [PRINT_LAYOUT.width, PRINT_LAYOUT.height],
        precision: 8, compress: true, putOnlyUsedFonts: true });
    pdf.setProperties({ title: deck.name + ' - Print Cards', creator: 'Lycee Toolbox' });
    pdf.viewerPreferences({ PrintScaling: 'None' });
    let page = 0;
    for (const slot of slots) {
        if (slot.page !== page) { pdf.addPage(); page = slot.page; }
        pdf.addImage(images.get(slot.code), 'JPEG', slot.x, slot.y,
            PRINT_LAYOUT.cardWidth, PRINT_LAYOUT.cardHeight, slot.code, 'FAST');
    }
    return { blob: pdf.output('blob'), pages: page + 1, count: slots.length };
}
