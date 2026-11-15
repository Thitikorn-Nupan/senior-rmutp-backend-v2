import type {Core} from '@strapi/strapi';

const config: Core.Config.Middlewares = [
    'strapi::logger',
    'strapi::errors',
    'strapi::security',
    {name: 'strapi::cors', config: {headers: ['Content-Type', 'Authorization', 'Origin', 'Accept', 'Idempotency-Key']}},
    'strapi::poweredBy',
    'strapi::query',
    'global::receipt-cleanup',
    'strapi::body',
    'strapi::session',
    'strapi::favicon',
    'strapi::public',
];

export default config;
