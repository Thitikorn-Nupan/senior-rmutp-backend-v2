export default {
    routes: [
        {method: 'GET', path: '/profile/me', handler: 'customer-profile.me', config: {}},
        {method: 'PUT', path: '/profile/me', handler: 'customer-profile.updateMe', config: {}},
        {method: 'POST', path: '/profile/me/avatar', handler: 'customer-profile.avatar', config: {}},
        {method: 'DELETE', path: '/profile/me/avatar', handler: 'customer-profile.removeAvatar', config: {}},
    ],
};
