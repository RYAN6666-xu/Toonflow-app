import { AsyncLocalStorage } from "node:async_hooks";

// ACT: 跨 provider fetch 转发 auth context。Express 中间件设入 store，
// provider 的 fetch 从 store 读取当前请求的 auth_token cookie 转发给下游。

export interface RequestContext {
  authToken?: string;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();
