import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  app: {
    keys: env.array('APP_KEYS')!,
  },
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },
  cron: {
    enabled: true,
    tasks: {
      releaseUnpaidOrders: {
        task: async ({ strapi }: { strapi: Core.Strapi }) => {
          await strapi.service('api::checkout.checkout').releaseExpired();
        },
        options: { rule: '*/1 * * * *' },
      },
    },
  },
});

export default config;
