import type {Context, Next} from 'koa';
import {unlink} from 'node:fs/promises';

// Invalid/auth-rejected multipart requests must not leave private receipts in
// the OS temporary directory. This wraps the body parser and auth middleware.
export default () => async (ctx: Context, next: Next) => {
    const receipt = ctx.method === 'POST' && /^\/api\/checkout\/orders\/[^/]+\/receipt\/?$/.test(ctx.path);
    const avatar = ctx.method === 'POST' && /^\/api\/profile\/me\/avatar\/?$/.test(ctx.path);
    if (!receipt && !avatar) return next();
    if (Number(ctx.get('Content-Length')) > 6 * 1024 * 1024) ctx.throw(413, 'Receipt images must be no larger than 5 MB');
    try {
        await next();
    } finally {
        type Upload = { filepath?: string };
        const files = (ctx.request as typeof ctx.request & { files?: Record<string, Upload | Upload[]> }).files;
        for (const file of Object.values(files ?? {}).flat()) {
            if (file.filepath) await unlink(file.filepath).catch(() => {
            });
        }
    }
};
