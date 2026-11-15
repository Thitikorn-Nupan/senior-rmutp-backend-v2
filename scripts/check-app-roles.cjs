'use strict';

const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {compileStrapi, createStrapi} = require('@strapi/strapi');

async function main() {
    if (process.env.NODE_ENV === 'production') throw new Error('Use a development/test database.');
    const app = createStrapi(await compileStrapi());
    const marker = `roles-check-${randomUUID()}`;
    const fixtureIds = [];
    try {
        await app.load();
        const {configureAppRoles, isLegacyAdminEmail} = require('../dist/src/bootstrap/app-roles');
        assert.equal(isLegacyAdminEmail('AdminV1@example.com'), true);
        assert.equal(isLegacyAdminEmail('adminv.test@example.com'), true);
        assert.equal(isLegacyAdminEmail('customer-adminv1@example.com'), false);
        assert.equal(isLegacyAdminEmail('adminv1'), false);
        const roles = app.db.query('plugin::users-permissions.role');
        const users = app.db.query('plugin::users-permissions.user');
        const userRole = await roles.findOne({where: {type: 'authenticated'}});
        const adminRole = await roles.findOne({where: {type: 'app-admin'}});
        assert.equal(userRole.name, 'User');
        assert.equal(adminRole.name, 'Admin');
        const store = app.store({type: 'plugin', name: 'users-permissions'});
        const migration = await store.get({key: 'app-role-migration-v1'});
        assert.ok(migration?.completedAt);
        console.log(`Migration: checked ${migration.checked} existing accounts; ${migration.changes.filter(c => c.roleId === adminRole.id).length} promoted to Admin.`);

        await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${app.server.httpServer.address().port}/api`;
        const request = async (path, {method = 'GET', token, body} = {}) => {
            const response = await fetch(base + path, {
                method,
                headers: {...(token ? {Authorization: `Bearer ${token}`} : {}), ...(body ? {'Content-Type': 'application/json'} : {})},
                ...(body ? {body: JSON.stringify(body)} : {}),
            });
            return {status: response.status, body: await response.json()};
        };
        const password = randomUUID();
        const email = `adminv-${marker}@example.invalid`;
        const signup = await request('/auth/local/register', {
            method: 'POST',
            body: {username: marker, email, password}
        });
        assert.equal(signup.status, 200, `Registration status: ${signup.status}`);
        fixtureIds.push(signup.body.user.id);
        assert.equal(signup.body.user.role.type, 'authenticated', 'New adminv email must stay User');
        assert.equal(signup.body.user.password, undefined);
        assert.deepEqual(Object.keys(signup.body.user.role).sort(), ['id', 'name', 'type']);
        const login = async identifier => {
            const result = await request('/auth/local', {method: 'POST', body: {identifier, password}});
            assert.equal(result.status, 200);
            return result.body;
        };
        const customer = await login(email);
        assert.equal(customer.user.role.type, 'authenticated');
        assert.equal((await request('/users/me', {token: customer.jwt})).body.role.type, 'authenticated');
        assert.equal((await request('/brands', {token: customer.jwt})).status, 403);
        assert.ok([401, 403].includes((await request('/brands')).status));
        const escalate = await request('/auth/local/register', {
            method: 'POST', body: {
                username: `${marker}-injection`,
                email: `${marker}-injection@example.invalid`,
                password,
                role: adminRole.id,
            }
        });
        assert.equal(escalate.status, 400);
        assert.equal((await request(`/users/${customer.user.id}`, {
            method: 'PUT',
            token: customer.jwt,
            body: {role: adminRole.id}
        })).status, 403);

        const admin = await app.plugin('users-permissions').service('user').add({
            username: `${marker}-admin`, email: `${marker}-admin@example.invalid`, password,
            provider: 'local', confirmed: true, blocked: false, role: adminRole.id,
        });
        fixtureIds.push(admin.id);
        const adminSession = await login(admin.email);
        assert.equal(adminSession.user.role.type, 'app-admin');
        assert.equal((await request('/users/me', {token: adminSession.jwt})).body.role.type, 'app-admin');
        assert.equal((await request('/brands', {token: adminSession.jwt})).status, 200);
        assert.equal((await request(`/users/${customer.user.id}`, {
            method: 'PUT',
            token: adminSession.jwt,
            body: {role: adminRole.id}
        })).status, 403);
        await users.update({where: {id: admin.id}, data: {role: userRole.id}});
        assert.equal((await request('/brands', {token: adminSession.jwt})).status, 403, 'Backend must read current DB roles');

        await configureAppRoles(app);
        const afterRestart = await users.findOne({where: {id: customer.user.id}, populate: ['role']});
        assert.equal(afterRestart.role.type, 'authenticated', 'A later bootstrap must not promote new adminv signups');
        console.log('PASS: role migration, default User registration, username/email login, safe role responses, /users/me, Admin access, denied User/anonymous access, rejected role injection/self-promotion and one-time migration.');
    } finally {
        for (const id of fixtureIds) {
            await app.sessionManager('users-permissions').invalidateRefreshToken(String(id));
            await app.db.query('plugin::users-permissions.user').delete({where: {id}});
        }
        await app.destroy();
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
