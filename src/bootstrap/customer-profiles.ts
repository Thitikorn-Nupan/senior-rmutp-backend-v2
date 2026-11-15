import type {Core} from '@strapi/strapi';

export async function configureCustomerProfiles(strapi: Core.Strapi): Promise<void> {
    const ensure = (id: number) => strapi.service('api::customer-profile.customer-profile').ensureForUser(id);
    strapi.db.lifecycles.subscribe({
        models: ['plugin::users-permissions.user'],
        async afterCreate(event) {
            await ensure(event.result.id);
        },
    });
    // Fill missing profiles without modifying existing customer/order details.
    const users = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: {profile: {id: {$null: true}}}, select: ['id'],
    });
    for (const user of users) await ensure(user.id);
}
