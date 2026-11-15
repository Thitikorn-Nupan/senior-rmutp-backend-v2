import type {Core} from '@strapi/strapi';
import type {Context} from 'koa';

export default (plugin: any) => {
    async function addRoleToUser(strapi: Core.Strapi, user: any): Promise<void> {
        if (!user?.id) return;
        const stored = await strapi.db.query('plugin::users-permissions.user').findOne({
            where: {id: user.id}, select: ['id'],
            populate: {role: {select: ['id', 'name', 'type']}},
        });
        // Only the signed-in user's role summary is exposed, never permissions or users.
        user.role = stored?.role ? {id: stored.role.id, name: stored.role.name, type: stored.role.type} : null;
    }

    const originalAuth = plugin.controllers.auth;
    plugin.controllers.auth = (dependencies: { strapi: Core.Strapi }) => {
        const controller = typeof originalAuth === 'function' ? originalAuth(dependencies) : originalAuth;
        for (const action of ['callback', 'register']) {
            const original = controller[action];
            controller[action] = async (ctx: Context) => {
                const result = await original.call(controller, ctx);
                const body = ctx.body as { user?: unknown } | undefined;
                await addRoleToUser(dependencies.strapi, body?.user);
                return result;
            };
        }
        return controller;
    };

    const originalMe = plugin.controllers.user.me;
    plugin.controllers.user.me = async (ctx: Context) => {
        const result = await originalMe(ctx);
        await addRoleToUser(strapi, ctx.body);
        return result;
    };
    return plugin;
};
