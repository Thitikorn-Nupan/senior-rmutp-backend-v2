import type {Context} from 'koa';

// Keep API token scopes enforced by Strapi; app admins additionally pass this
// policy using the database-backed role loaded by Users & Permissions.
const managementApiToken = (ctx: Context): boolean => {
    return ctx.state.auth?.strategy?.name === 'content-api-token' || (ctx.state.auth?.strategy?.name === 'users-permissions' && ctx.state.user?.role?.type === 'app-admin');
};

export default managementApiToken;
