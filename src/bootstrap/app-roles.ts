import type {Core} from '@strapi/strapi';

export const USER_ROLE_TYPE = 'authenticated';
export const ADMIN_ROLE_TYPE = 'app-admin';

// Used only by the one-time migration, never during registration or login.
export function isLegacyAdminEmail(email: unknown): boolean {
    return typeof email === 'string' && /^adminv[^@\s]*@[^@\s]+$/i.test(email.trim());
}

export async function configureAppRoles(strapi: Core.Strapi): Promise<void> {
    const roles = strapi.db.query('plugin::users-permissions.role');
    let userRole = await roles.findOne({where: {type: USER_ROLE_TYPE}});
    if (!userRole) throw new Error('The authenticated Users & Permissions role is missing');
    if (userRole.name !== 'User') {
        userRole = await roles.update({where: {id: userRole.id}, data: {name: 'User'}});
    }
    let adminRole = await roles.findOne({where: {type: ADMIN_ROLE_TYPE}});
    if (!adminRole) {
        adminRole = await roles.create({
            data: {
                name: 'Admin',
                type: ADMIN_ROLE_TYPE,
                description: 'Application administrator (not a Strapi admin-panel account)',
            }
        });
    }

    const store = strapi.store({type: 'plugin', name: 'users-permissions'});
    const settings = await store.get({key: 'advanced'}) as Record<string, unknown>;
    if (settings.default_role !== USER_ROLE_TYPE) {
        await store.set({key: 'advanced', value: {...settings, default_role: USER_ROLE_TYPE}});
    }

    const permissions = strapi.db.query('plugin::users-permissions.permission');

    async function grant(roleId: number, action: string) {
        if (!await permissions.findOne({where: {action, role: roleId}})) {
            await permissions.create({data: {action, role: roleId}});
        }
    }

    for (const role of [userRole, adminRole]) {
        await grant(role.id, 'plugin::users-permissions.user.me');
        for (const action of ['me', 'updateMe', 'avatar', 'removeAvatar']) {
            await grant(role.id, `api::customer-profile.customer-profile.${action}`);
        }
        for (const action of ['quote', 'create', 'request', 'order', 'history', 'receipt', 'download']) {
            await grant(role.id, `api::checkout.checkout.${action}`);
        }
    }
    // Application admins can use protected commerce CRUD; user/role management
    // remains restricted to the Strapi admin panel and trusted management tokens.
    for (const type of Object.values(strapi.contentTypes)) {
        if (!type.uid.startsWith('api::')) continue;
        const actions = type.kind === 'singleType' ? ['find', 'update', 'delete'] : ['find', 'findOne', 'create', 'update', 'delete'];
        for (const action of actions) await grant(adminRole.id, `${type.uid}.${action}`);
    }
    await grant(adminRole.id, 'api::checkout.checkout.reviewReceipt');
    for (const action of ['manageList', 'manageSave', 'manageDelete']) await grant(adminRole.id, `api::product.product.${action}`);
    await grant(adminRole.id, 'plugin::upload.content-api.upload');

    const key = 'app-role-migration-v1';
    if (await store.get({key})) return;
    await strapi.db.transaction(async () => {
        const users = strapi.db.query('plugin::users-permissions.user');
        const existing = await users.findMany({select: ['id', 'email'], populate: ['role']});
        const changes: { userId: number; previousRoleId: number | null; roleId: number }[] = [];
        for (const user of existing) {
            const roleId = isLegacyAdminEmail(user.email) ? adminRole.id : userRole.id;
            if (user.role?.id !== roleId) {
                changes.push({userId: user.id, previousRoleId: user.role?.id ?? null, roleId});
                await users.update({where: {id: user.id}, data: {role: roleId}});
            }
        }
        await store.set({key, value: {completedAt: new Date().toISOString(), changes, checked: existing.length}});
        strapi.log.info(`App roles: migrated ${existing.length} existing users; promoted ${changes.filter(c => c.roleId === adminRole.id).length} admins.`);
    });
}
