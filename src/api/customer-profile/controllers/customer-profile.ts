import {factories} from '@strapi/strapi';

function owner(ctx: any): number {
    ctx.set('Cache-Control', 'private, no-store');
    if (!Number.isSafeInteger(ctx.state.user?.id)) ctx.throw(401, 'Please log in to continue');
    return ctx.state.user.id;
}

export default factories.createCoreController('api::customer-profile.customer-profile', ({strapi}) => ({
    async me(ctx) {
        ctx.body = {data: await strapi.service('api::customer-profile.customer-profile').readForUser(owner(ctx))};
    },
    async updateMe(ctx) {
        ctx.body = {data: await strapi.service('api::customer-profile.customer-profile').saveForUser(owner(ctx), ctx.request.body?.data)};
    },
    async avatar(ctx) {
        const id = owner(ctx);
        const files = (ctx.request as any).files;
        if (!files || Object.keys(files).length !== 1 || !files.avatar || Array.isArray(files.avatar)) ctx.throw(400, 'Choose exactly one avatar image');
        ctx.body = {data: await strapi.service('api::customer-profile.customer-profile').uploadAvatar(id, files.avatar)};
    },
    async removeAvatar(ctx) {
        ctx.body = {data: await strapi.service('api::customer-profile.customer-profile').deleteAvatar(owner(ctx))};
    },
}));
