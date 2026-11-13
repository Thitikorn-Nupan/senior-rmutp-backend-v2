import type { Core } from '@strapi/strapi';

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
  */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    const role = await strapi.db.query('plugin::users-permissions.role').findOne({ where: { type: 'authenticated' } });
    if (!role) return;
    // Only customer workflow actions are enabled. Every action also checks the
    // signed-in user and order ownership; management CRUD remains token-only.
    const permissions = strapi.db.query('plugin::users-permissions.permission');
    for (const actionName of ['quote', 'create', 'request', 'order', 'history', 'receipt', 'download']) {
      const action = `api::checkout.checkout.${actionName}`;
      if (!await permissions.findOne({ where: { action, role: role.id } })) {
        await permissions.create({ data: { action, role: role.id } });
      }
    }
  },
};
