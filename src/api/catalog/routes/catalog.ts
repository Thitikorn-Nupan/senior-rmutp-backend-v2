export default {
  routes: [
    { method: 'GET', path: '/catalog/products', handler: 'catalog.products', config: { auth: false } },
    { method: 'GET', path: '/catalog/products/:documentId', handler: 'catalog.product', config: { auth: false } },
    { method: 'GET', path: '/catalog/categories', handler: 'catalog.categories', config: { auth: false } },
  ],
};
