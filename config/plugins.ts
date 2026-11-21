import type {Core} from '@strapi/strapi';

const allowedMediaTypes = [
    'image/*',
    'video/*',
    'audio/*',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.*',
    'text/plain',
    'text/csv',
];

const deniedTypes = [
    'image/svg+xml',
    'application/vnd.microsoft.portable-executable',
    'application/x-msdownload',
    'application/x-msdos-program',
    'application/x-executable',
    'application/x-dosexec',
    'application/x-sh',
    'text/x-shellscript',
    'application/x-mach-binary',
];

const thirtyMinutes = 30 * 60;

const config = ({env}: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({
    'users-permissions': {
        config: {
            jwtManagement: 'refresh',
            register: {allowedFields: []},
            sessions: {
                accessTokenLifespan: thirtyMinutes,
                maxRefreshTokenLifespan: thirtyMinutes,
                idleRefreshTokenLifespan: thirtyMinutes,
                maxSessionLifespan: thirtyMinutes,
                idleSessionLifespan: thirtyMinutes,
                httpOnly: true,
            },
        },
    },
    upload: {
        config: {
            security: {
                allowedTypes: allowedMediaTypes,
                deniedTypes,
            },
        },
    },
});

export default config;
