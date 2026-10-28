import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

/**
 * DeltaDesigner JWT 验证中间件
 * Next.js 反向代理转发时会把 auth_token cookie 一起带过来。
 * 读取 cookie，用共享的 JWT_SECRET 验签，失败返回 401。
 * 验签通过后把 { userId, email, role } 挂到 req.user。
 *
 * 开发模式 (NODE_ENV !== 'production') 下如果设了 TOONFLOW_SKIP_AUTH=1 可跳过校验。
 * 这允许我们不登录直接跑 Toonflow，但生产必须验。
 */

export interface DeltaUser {
  userId: string;
  email: string;
  role?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: DeltaUser;
    }
  }
}

function extractCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  // 手动解析 cookie 头，避免引入 cookie-parser 依赖
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) {
      try { return decodeURIComponent(trimmed.slice(eq + 1)); } catch { return trimmed.slice(eq + 1); }
    }
  }
  return null;
}

export function requireDeltaAuth(req: Request, res: Response, next: NextFunction) {
  // 生产/开发都允许 TOONFLOW_SKIP_AUTH=1 绕过（便于反代调试/独立部署）
  if (process.env.TOONFLOW_SKIP_AUTH === "1") {
    req.user = { userId: "dev-skip", email: "dev@local", role: "user" };
    return next();
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error("[toonflow-auth] JWT_SECRET 未配置！请与 DeltaDesigner 后端保持一致。");
    return res.status(500).json({ code: 500, message: "Server misconfigured: missing JWT_SECRET" });
  }

  // 优先读 cookie，其次读 Authorization header（兼容 Next.js 塞进的 header）
  let token = extractCookie(req.headers.cookie, "auth_token");
  if (!token) {
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) token = auth.slice(7);
  }

  if (!token) {
    // SPA 首次请求 index.html 也需要登录态。302 到 Next.js /login，带上 returnTo。
    const isPageGet = req.method === "GET" && !req.path.startsWith("/api") && !req.path.startsWith("/a2a") && !req.path.startsWith("/mcp");
    if (isPageGet) {
      const loginUrl = new URL("/login", `${req.protocol}://${req.get("host")}`);
      loginUrl.searchParams.set("returnTo", req.originalUrl);
      return res.status(302).location(loginUrl.toString()).end();
    }
    return res.status(401).json({ code: 401, message: "Unauthorized: missing auth_token" });
  }

  let decoded: any;
  try {
    decoded = jwt.verify(token, secret);
  } catch (err: any) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ code: 401, message: "Token expired" });
    }
    return res.status(401).json({ code: 401, message: "Invalid token: " + err.message });
  }

  req.user = {
    userId: String(decoded.userId ?? decoded.sub ?? ""),
    email: String(decoded.email ?? ""),
    role: decoded.role,
  };
  next();
}
