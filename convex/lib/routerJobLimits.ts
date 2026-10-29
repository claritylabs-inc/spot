// Requests up to this many serialized bytes are written beside the router job
// row by `routerJobs.prepare` itself, so creating a job needs no storage
// upload; larger ones are stored first. Well under the 1 MiB document limit.
export const ROUTER_JOB_INLINE_REQUEST_BYTES = 512 * 1024;
