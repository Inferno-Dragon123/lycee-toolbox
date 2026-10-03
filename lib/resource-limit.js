// Bound work that decodes card images before it allocates buffers.
export function createLimiter(maximum = 1) {
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 2) throw new Error('PDF_CONCURRENCY must be 1 or 2');
    let active = 0;
    return {
        acquire() {
            if (active >= maximum) return null;
            active++;
            let released = false;
            return () => { if (!released) { released = true; active--; } };
        },
        get active() { return active; }
    };
}
export const pdfLimiter = createLimiter(Number(process.env.PDF_CONCURRENCY || 1));
