import { factories } from '@strapi/strapi';

// Management CRUD uses API tokens; customer reads use the catalog API.
export default factories.createCoreRouter('api::order.order', {
  config: {
    find: { policies: ['global::management-api-token'] },
    findOne: { policies: ['global::management-api-token'] },
    create: { policies: ['global::management-api-token'] },
    update: { policies: ['global::management-api-token'] },
    delete: { policies: ['global::management-api-token'] },
  },
});
