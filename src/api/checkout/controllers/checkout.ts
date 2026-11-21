import type { Context } from 'koa';

function userId(ctx: Context): number {
  ctx.set('Cache-Control', 'private, no-store');
  const id = ctx.state.user?.id;
  if (!Number.isSafeInteger(id)) ctx.throw(401, 'Please log in to continue');
  return id;
}

export default {
  async quote(ctx: Context) {
    userId(ctx);
    ctx.body = { data: await strapi.service('api::checkout.checkout').quote(ctx.request.body) };
  },
  async create(ctx: Context) {
    ctx.body = { data: await strapi.service('api::checkout.checkout').createOrder(
      userId(ctx), ctx.request.body, ctx.get('Idempotency-Key')) };
    ctx.status = 201;
  },
  async history(ctx: Context) {
    ctx.body = await strapi.service('api::checkout.checkout').history(userId(ctx), ctx.query);
  },
  async adminHistory(ctx: Context) {
    ctx.set('Cache-Control', 'private, no-store');
    ctx.body = await strapi.service('api::checkout.checkout').adminHistory(ctx.query);
  },
  async adminMembers(ctx: Context) {
    ctx.set('Cache-Control', 'private, no-store');
    ctx.body = await strapi.service('api::checkout.checkout').adminMembers(ctx.query);
  },
  async approvePayment(ctx: Context) {
    ctx.set('Cache-Control', 'private, no-store');
    ctx.body = {data: await strapi.service('api::checkout.checkout').approvePayment(ctx.params.documentId)};
  },
  async order(ctx: Context) {
    const user = userId(ctx);
    await strapi.service('api::checkout.checkout').releaseExpired();
    ctx.body = { data: await strapi.service('api::checkout.checkout').getOrder(user, ctx.params.documentId) };
  },
  async request(ctx: Context) {
    const user = userId(ctx);
    await strapi.service('api::checkout.checkout').releaseExpired();
    ctx.body = { data: await strapi.service('api::checkout.checkout').findRequest(user, ctx.params.key) };
  },
  async receipt(ctx: Context) {
    const files = (ctx.request as typeof ctx.request & { files?: Record<string, unknown> }).files;
    ctx.body = { data: await strapi.service('api::checkout.checkout').submitReceipt(
      userId(ctx), ctx.params.documentId, files?.files) };
  },
  async download(ctx: Context) {
    await strapi.service('api::checkout.checkout').downloadReceipt(ctx, ctx.params.documentId, userId(ctx));
  },
  async reviewReceipt(ctx: Context) {
    await strapi.service('api::checkout.checkout').downloadReceipt(ctx, ctx.params.documentId);
  },
};
