import type {Context} from 'koa';

// Fixed read-only responses for checkout. Management CRUD remains token-protected.
export default {
    async provinces(ctx: Context) {
        const data = await strapi.documents('api::province.province').findMany({
            fields: ['code', 'nameTh', 'nameEn'], sort: ['code:asc'], limit: 1000,
        });
        ctx.body = {data};
    },

    async districts(ctx: Context) {
        const province = ctx.query.province;
        if (typeof province !== 'string' || !/^[1-9]\d*$/.test(province) || !Number.isSafeInteger(Number(province))) {
            return ctx.badRequest('A valid province ID is required');
        }
        const data = await strapi.documents('api::district.district').findMany({
            fields: ['code', 'nameTh', 'nameEn'], filters: {province: {id: Number(province)}},
            sort: ['nameEn:asc', 'nameTh:asc'], limit: 1000,
        });
        ctx.body = {data};
    },
};
