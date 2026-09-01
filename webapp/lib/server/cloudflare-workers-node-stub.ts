/**
 * Webpack-only fallback for Alibaba Cloud builds. Route imports are replaced
 * with runtime-node.ts; this module prevents the Cloudflare URI scheme from
 * being parsed if webpack still analyzes an unreachable Worker module.
 */
export const env: Record<string, never> = {};
