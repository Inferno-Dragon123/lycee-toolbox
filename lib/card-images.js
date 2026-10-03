import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { CODE } from '../public/deck-format.js';

export const SOURCE_ORIGIN = 'https://lycee-tcg.com';
export const CARD_BACK_SOURCE = SOURCE_ORIGIN + '/about/images/card.png';
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 12000000;
const imageError = message => Object.assign(new Error(message), { status: 400 });

function imageCode(code) {
    if (code !== 'card-back' && (typeof code !== 'string' || !CODE.test(code))) throw imageError('Invalid image code');
    return code;
}
export function imageStorageDirectory(env = process.env) {
    if (!env.IMAGE_STORAGE_DIR) return null;
    if (!path.isAbsolute(env.IMAGE_STORAGE_DIR)) throw new Error('IMAGE_STORAGE_DIR must be an absolute path');
    return path.resolve(env.IMAGE_STORAGE_DIR);
}
export function publicImageOrigin(env = process.env) {
    const value = env.IMAGE_PUBLIC_ORIGIN || env.SITE_ORIGIN;
    if (!value) return null;
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) throw new Error('IMAGE_PUBLIC_ORIGIN / SITE_ORIGIN must be an HTTPS origin');
    return url.origin;
}
export function imageRelativePath(code, variant = 'original') {
    imageCode(code);
    if (!['original', 'thumb'].includes(variant)) throw imageError('Invalid image variant');
    return `${variant}/${code}.${variant === 'original' ? 'png' : 'webp'}`;
}
export function parseImagePath(pathname) {
    if (!pathname.startsWith('/images/')) return null;
    const match = /^\/images\/(original|thumb)\/(LO-\d{4}(?:-?[A-Z]+)?|card-back)\.(png|webp)$/.exec(pathname);
    if (!match || (match[1] === 'original' ? match[3] !== 'png' : match[3] !== 'webp')) throw imageError('Invalid image path');
    return { code: match[2], variant: match[1] };
}
export function imageKeyForSource(value) {
    let url;
    try { url = new URL(value); } catch { throw imageError('Invalid image source'); }
    if (url.origin !== SOURCE_ORIGIN || url.username || url.password || url.search || url.hash) throw imageError('Invalid image source');
    if (url.href === CARD_BACK_SOURCE) return 'card-back';
    const match = /^\/card\/image\/(LO-\d{4}(?:-?[A-Z]+)?)\.png$/.exec(url.pathname);
    if (!match) throw imageError('Invalid image source');
    return match[1];
}
export function withCardImageUrls(card, { env = process.env } = {}) {
    const sourceImg = card.sourceImg || card.img;
    if (!imageStorageDirectory(env)) return { ...card, sourceImg, originalImg: sourceImg,
        thumbnailImg: '/api/image-proxy?url=' + encodeURIComponent(sourceImg), backImg: CARD_BACK_SOURCE };
    const origin = publicImageOrigin(env);
    if (!origin) throw new Error('Set IMAGE_PUBLIC_ORIGIN or SITE_ORIGIN when using mirrored images');
    imageCode(card.code);
    const originalImg = `${origin}/images/${imageRelativePath(card.code)}`;
    return { ...card, sourceImg, img: originalImg, originalImg,
        thumbnailImg: `${origin}/images/${imageRelativePath(card.code, 'thumb')}`,
        backImg: `${origin}/images/${imageRelativePath('card-back')}` };
}
export async function inspectImage(buffer, code) {
    imageCode(code);
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('Invalid image byte size');
    const meta = await sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' }).metadata();
    // The official PNG URLs are stored verbatim; accepting HTML or the proxy's
    // 1x1 failure placeholder here would make a missing image permanent.
    if (meta.format !== 'png' || meta.pages > 1 || meta.width < (code === 'card-back' ? 32 : 100) ||
        meta.height < (code === 'card-back' ? 32 : 100) || meta.width * meta.height > MAX_IMAGE_PIXELS) throw new Error('Invalid original card image');
    await sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' }).raw().toBuffer();
    return { sha256: createHash('sha256').update(buffer).digest('hex'), bytes: buffer.length,
        width: meta.width, height: meta.height, format: meta.format };
}
export async function readStoredImage(code, variant = 'original', { directory = imageStorageDirectory() } = {}) {
    const relative = imageRelativePath(code, variant);
    if (!directory) return null;
    const target = path.resolve(directory, relative);
    try {
        const [root, actual] = await Promise.all([fs.realpath(directory), fs.realpath(target)]);
        if (!actual.startsWith(root + path.sep)) throw imageError('Image path leaves storage directory');
        const stat = await fs.stat(actual);
        if (!stat.isFile() || !stat.size || stat.size > MAX_IMAGE_BYTES) throw new Error('Invalid stored image');
        const buffer = await fs.readFile(actual);
        return { buffer, contentType: variant === 'original' ? 'image/png' : 'image/webp',
            etag: '"' + createHash('sha256').update(buffer).digest('hex') + '"', lastModified: stat.mtime.toUTCString() };
    } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
    }
}
