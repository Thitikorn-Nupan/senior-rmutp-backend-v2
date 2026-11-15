const config = {policies: ['global::management-api-token']};
export default {
    routes: [
        {method: 'GET', path: '/management/products', handler: 'product.manageList', config},
        {method: 'POST', path: '/management/products', handler: 'product.manageSave', config},
        {method: 'PUT', path: '/management/products/:documentId', handler: 'product.manageSave', config},
        {method: 'DELETE', path: '/management/products/:documentId', handler: 'product.manageDelete', config},
    ],
};
