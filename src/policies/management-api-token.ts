import type { Context } from 'koa';

// Core CRUD is for trusted management clients. Customer APIs need ownership
// checks and commerce workflows rather than unrestricted document access.
const managementApiToken = (ctx: Context): boolean => {
  return ctx.state.auth?.strategy?.name === 'content-api-token';
};

export default managementApiToken;
