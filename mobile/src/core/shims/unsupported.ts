// Stands in for node:zlib, node:stream and node:http(s). Only the desktop's
// file backup and cloud-backup client use them; those features report
// "not available" on mobile instead of loading these.
function unsupported(): never {
  throw new Error("This feature is not available in the mobile app yet.");
}

const handler: ProxyHandler<object> = { get: (_t, key) => (key === "__esModule" ? true : unsupported) };
const stub = new Proxy({}, handler);

export const pipeline = unsupported;
export const Readable = unsupported;
export const Transform = unsupported;
export const createGzip = unsupported;
export const createGunzip = unsupported;
export const request = unsupported;
export const get = unsupported;
export default stub;
