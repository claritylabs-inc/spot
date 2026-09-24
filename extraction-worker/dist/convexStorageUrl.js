const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);
/**
 * Native local Convex signs storage URLs with its host-only loopback origin.
 * Containers must use the worker's bridged Convex origin for the same port.
 */
export function resolveConvexStorageUrl(storageUrl, options) {
    if (options.spotEnv !== "local")
        return storageUrl;
    let source;
    let target;
    try {
        source = new URL(storageUrl);
        target = new URL(options.convexUrl);
    }
    catch {
        return storageUrl;
    }
    if (!LOOPBACK_HOSTNAMES.has(source.hostname)
        || source.port !== target.port
        || !["http:", "https:"].includes(source.protocol)
        || !["http:", "https:"].includes(target.protocol)) {
        return storageUrl;
    }
    source.protocol = target.protocol;
    source.host = target.host;
    return source.toString();
}
//# sourceMappingURL=convexStorageUrl.js.map