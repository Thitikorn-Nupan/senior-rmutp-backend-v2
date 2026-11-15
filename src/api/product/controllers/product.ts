import {factories} from '@strapi/strapi';

export default factories.createCoreController('api::product.product', ({strapi}) => ({
    async manageList(ctx) {
        ctx.set('Cache-Control', 'private, no-store');
        ctx.body = await strapi.service('api::product.management').list(ctx.query);
    },
    async manageSave(ctx) {
        ctx.body = {data: await strapi.service('api::product.management').save(ctx.params.documentId, ctx.request.body?.data)};
        ctx.status = ctx.params.documentId ? 200 : 201;
    },
    async manageDelete(ctx) {
        await strapi.service('api::product.management').remove(ctx.params.documentId);
        ctx.body = {data: {documentId: ctx.params.documentId}};
    },
}));
