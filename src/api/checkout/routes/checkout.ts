export default {
    routes: [
        {method: 'POST', path: '/checkout/quote', handler: 'checkout.quote', config: {}},
        {method: 'POST', path: '/checkout/orders', handler: 'checkout.create', config: {}},
        {method: 'GET', path: '/checkout/orders', handler: 'checkout.history', config: {}},
        {method: 'GET', path: '/checkout/admin/orders', handler: 'checkout.adminHistory', config: {policies: ['global::management-api-token']}},
        {method: 'GET', path: '/checkout/admin/members', handler: 'checkout.adminMembers', config: {policies: ['global::management-api-token']}},
        {method: 'POST', path: '/checkout/admin/orders/:documentId/approve', handler: 'checkout.approvePayment', config: {policies: ['global::management-api-token']}},
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
