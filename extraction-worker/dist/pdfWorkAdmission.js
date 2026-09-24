import { INITIAL_LITEPARSE_QUEUE_FAIRNESS_STATE, selectNextLiteParseQueueIndex, } from "./liteparseQueue.js";
function abortError() {
    if (typeof DOMException === "function") {
        return new DOMException("PDF work admission aborted", "AbortError");
    }
    const error = new Error("PDF work admission aborted");
    error.name = "AbortError";
    return error;
}
export function createPdfWorkAdmission(options) {
    const maxActive = Math.max(1, Math.floor(options.maxActive));
    const maxFullActive = Math.max(1, Math.min(maxActive, Math.floor(options.maxFullActive)));
    const waiters = [];
    let active = 0;
    let activeFull = 0;
    let fairnessState = {
        ...INITIAL_LITEPARSE_QUEUE_FAIRNESS_STATE,
    };
    function pump() {
        while (active < maxActive) {
            for (let index = waiters.length - 1; index >= 0; index -= 1) {
                const waiter = waiters[index];
                if (!waiter.signal?.aborted)
                    continue;
                waiters.splice(index, 1);
                waiter.reject(abortError());
            }
            const eligible = waiters
                .map((waiter, index) => ({ waiter, index }))
                .filter(({ waiter }) => waiter.priority !== "full" || activeFull < maxFullActive);
            if (eligible.length === 0)
                return;
            const selection = selectNextLiteParseQueueIndex(eligible.map(({ waiter }) => waiter.priority), fairnessState);
            fairnessState = selection.state;
            const selected = eligible[selection.index];
            if (!selected)
                return;
            const [waiter] = waiters.splice(selected.index, 1);
            if (!waiter)
                continue;
            if (waiter.onAbort && waiter.signal) {
                waiter.signal.removeEventListener("abort", waiter.onAbort);
            }
            active += 1;
            if (waiter.priority === "full")
                activeFull += 1;
            let released = false;
            waiter.resolve(() => {
                if (released)
                    return;
                released = true;
                active -= 1;
                if (waiter.priority === "full")
                    activeFull -= 1;
                pump();
            });
        }
    }
    return {
        acquire(priority, signal) {
            if (signal?.aborted)
                return Promise.reject(abortError());
            return new Promise((resolve, reject) => {
                const waiter = {
                    priority,
                    signal,
                    resolve,
                    reject,
                };
                if (signal) {
                    waiter.onAbort = () => {
                        const index = waiters.indexOf(waiter);
                        if (index < 0)
                            return;
                        waiters.splice(index, 1);
                        reject(abortError());
                        pump();
                    };
                    signal.addEventListener("abort", waiter.onAbort, { once: true });
                }
                waiters.push(waiter);
                pump();
            });
        },
        snapshot() {
            const waiting = {
                http: 0,
                preview: 0,
                full: 0,
            };
            for (const waiter of waiters)
                waiting[waiter.priority] += 1;
            return {
                active,
                activeFull,
                waiting,
            };
        },
    };
}
//# sourceMappingURL=pdfWorkAdmission.js.map