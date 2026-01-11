/**
 * Setup TLS options based on --insecure flag
 */
export function setupTls(options: { insecure?: boolean }) {
  if (options.insecure) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
}
