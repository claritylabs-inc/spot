const ACTIVE_RAILWAY_ENVIRONMENTS = new Set([
    "dev",
    "production",
]);
export function resolveWorkerRuntimeAccess(env) {
    const railwayEnvironment = env.RAILWAY_ENVIRONMENT_NAME?.trim();
    if (!railwayEnvironment
        || ACTIVE_RAILWAY_ENVIRONMENTS.has(railwayEnvironment.toLowerCase())) {
        return {
            mode: "active",
            railwayEnvironment: railwayEnvironment || undefined,
            jobsEnabled: true,
            conversionsEnabled: true,
        };
    }
    return {
        mode: "health_only",
        railwayEnvironment,
        jobsEnabled: false,
        conversionsEnabled: false,
    };
}
//# sourceMappingURL=railwayRuntime.js.map