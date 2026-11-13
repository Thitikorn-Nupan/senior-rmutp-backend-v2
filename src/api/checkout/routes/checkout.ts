export default {
    routes: [
        {method: 'POST', path: '/checkout/quote', handler: 'checkout.quote', config: {}},
        {method: 'POST', path: '/checkout/orders', handler: 'checkout.create', config: {}},
        {method: 'GET', path: '/checkout/orders', handler: 'checkout.history', config: {}},
        {method: 'GET', path: '/checkout/requests/:key', handler: 'checkout.request', config: {}},
        {method: 'GET', path: '/checkout/orders/:documentId', handler: 'checkout.order', config: {}},
        {method: 'POST', path: '/checkout/orders/:documentId/receipt', handler: 'checkout.receipt', config: {}},
        {method: 'GET', path: '/checkout/orders/:documentId/receipt', handler: 'checkout.download', config: {}},
        {
            method: 'GET', path: '/checkout/review/:documentId/receipt', handler: 'checkout.reviewReceipt',
            config: {policies: ['global::management-api-token']}
        },
    ],
};
