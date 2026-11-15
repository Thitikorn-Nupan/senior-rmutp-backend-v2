export default {
    routes: [
        {method: 'GET', path: '/locations/provinces', handler: 'location.provinces', config: {auth: false}},
        {method: 'GET', path: '/locations/districts', handler: 'location.districts', config: {auth: false}},
    ],
};
