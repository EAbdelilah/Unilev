(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/dashboard/node_modules/@tanstack/query-core/build/modern/mutationObserver.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "MutationObserver",
    ()=>MutationObserver
]);
// src/mutationObserver.ts
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$mutation$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/query-core/build/modern/mutation.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$notifyManager$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/query-core/build/modern/notifyManager.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$subscribable$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/query-core/build/modern/subscribable.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/query-core/build/modern/utils.js [app-client] (ecmascript)");
;
;
;
;
var MutationObserver = class extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$subscribable$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Subscribable"] {
    #client;
    #currentResult = void 0;
    #currentMutation;
    #mutateOptions;
    constructor(client, options){
        super();
        this.#client = client;
        this.setOptions(options);
        this.bindMethods();
        this.#updateResult();
    }
    bindMethods() {
        this.mutate = this.mutate.bind(this);
        this.reset = this.reset.bind(this);
    }
    setOptions(options) {
        const prevOptions = this.options;
        this.options = this.#client.defaultMutationOptions(options);
        if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["shallowEqualObjects"])(this.options, prevOptions)) {
            this.#client.getMutationCache().notify({
                type: "observerOptionsUpdated",
                mutation: this.#currentMutation,
                observer: this
            });
        }
        if (prevOptions?.mutationKey && this.options.mutationKey && (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hashKey"])(prevOptions.mutationKey) !== (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hashKey"])(this.options.mutationKey)) {
            this.reset();
        } else if (this.#currentMutation?.state.status === "pending") {
            this.#currentMutation.setOptions(this.options);
        }
    }
    onUnsubscribe() {
        if (!this.hasListeners()) {
            this.#currentMutation?.removeObserver(this);
        }
    }
    onMutationUpdate(action) {
        this.#updateResult();
        this.#notify(action);
    }
    getCurrentResult() {
        return this.#currentResult;
    }
    reset() {
        this.#currentMutation?.removeObserver(this);
        this.#currentMutation = void 0;
        this.#updateResult();
        this.#notify();
    }
    mutate(variables, options) {
        this.#mutateOptions = options;
        this.#currentMutation?.removeObserver(this);
        this.#currentMutation = this.#client.getMutationCache().build(this.#client, this.options);
        this.#currentMutation.addObserver(this);
        return this.#currentMutation.execute(variables);
    }
    #updateResult() {
        const state = this.#currentMutation?.state ?? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$mutation$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getDefaultState"])();
        this.#currentResult = {
            ...state,
            isPending: state.status === "pending",
            isSuccess: state.status === "success",
            isError: state.status === "error",
            isIdle: state.status === "idle",
            mutate: this.mutate,
            reset: this.reset
        };
    }
    #notify(action) {
        __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$notifyManager$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["notifyManager"].batch(()=>{
            if (this.#mutateOptions && this.hasListeners()) {
                const variables = this.#currentResult.variables;
                const onMutateResult = this.#currentResult.context;
                const context = {
                    client: this.#client,
                    meta: this.options.meta,
                    mutationKey: this.options.mutationKey
                };
                if (action?.type === "success") {
                    try {
                        this.#mutateOptions.onSuccess?.(action.data, variables, onMutateResult, context);
                    } catch (e) {
                        void Promise.reject(e);
                    }
                    try {
                        this.#mutateOptions.onSettled?.(action.data, null, variables, onMutateResult, context);
                    } catch (e) {
                        void Promise.reject(e);
                    }
                } else if (action?.type === "error") {
                    try {
                        this.#mutateOptions.onError?.(action.error, variables, onMutateResult, context);
                    } catch (e) {
                        void Promise.reject(e);
                    }
                    try {
                        this.#mutateOptions.onSettled?.(void 0, action.error, variables, onMutateResult, context);
                    } catch (e) {
                        void Promise.reject(e);
                    }
                }
            }
            this.listeners.forEach((listener)=>{
                listener(this.#currentResult);
            });
        });
    }
};
;
 //# sourceMappingURL=mutationObserver.js.map
}),
"[project]/dashboard/node_modules/@tanstack/query-core/build/modern/queryObserver.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "QueryObserver",
    ()=>QueryObserver
]);
// src/queryObserver.ts
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$focusManager$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/query-core/build/modern/focusManager.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$environmentManager$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/query-core/build/modern/environmentManager.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$notifyManager$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/query-core/build/modern/notifyManager.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$query$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/query-core/build/modern/query.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$subscribable$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/query-core/build/modern/subscribable.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$thenable$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/query-core/build/modern/thenable.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/query-core/build/modern/utils.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$timeoutManager$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/query-core/build/modern/timeoutManager.js [app-client] (ecmascript)");
;
;
;
;
;
;
;
;
var QueryObserver = class extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$subscribable$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Subscribable"] {
    constructor(client, options){
        super();
        this.options = options;
        this.#client = client;
        this.#selectError = null;
        this.#currentThenable = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$thenable$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["pendingThenable"])();
        this.bindMethods();
        this.setOptions(options);
    }
    #client;
    #currentQuery = void 0;
    #currentQueryInitialState = void 0;
    #currentResult = void 0;
    #currentResultState;
    #currentResultOptions;
    #currentThenable;
    #selectError;
    #selectFn;
    #selectResult;
    // This property keeps track of the last query with defined data.
    // It will be used to pass the previous data and query to the placeholder function between renders.
    #lastQueryWithDefinedData;
    #staleTimeoutId;
    #refetchIntervalId;
    #currentRefetchInterval;
    #trackedProps = /* @__PURE__ */ new Set();
    bindMethods() {
        this.refetch = this.refetch.bind(this);
    }
    onSubscribe() {
        if (this.listeners.size === 1) {
            this.#currentQuery.addObserver(this);
            if (shouldFetchOnMount(this.#currentQuery, this.options)) {
                this.#executeFetch();
            } else {
                this.updateResult();
            }
            this.#updateTimers();
        }
    }
    onUnsubscribe() {
        if (!this.hasListeners()) {
            this.destroy();
        }
    }
    shouldFetchOnReconnect() {
        return shouldFetchOn(this.#currentQuery, this.options, this.options.refetchOnReconnect);
    }
    shouldFetchOnWindowFocus() {
        return shouldFetchOn(this.#currentQuery, this.options, this.options.refetchOnWindowFocus);
    }
    destroy() {
        this.listeners = /* @__PURE__ */ new Set();
        this.#clearStaleTimeout();
        this.#clearRefetchInterval();
        this.#currentQuery.removeObserver(this);
    }
    setOptions(options) {
        const prevOptions = this.options;
        const prevQuery = this.#currentQuery;
        this.options = this.#client.defaultQueryOptions(options);
        if (this.options.enabled !== void 0 && typeof this.options.enabled !== "boolean" && typeof this.options.enabled !== "function" && typeof (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["resolveEnabled"])(this.options.enabled, this.#currentQuery) !== "boolean") {
            throw new Error("Expected enabled to be a boolean or a callback that returns a boolean");
        }
        this.#updateQuery();
        this.#currentQuery.setOptions(this.options);
        if (prevOptions._defaulted && !(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["shallowEqualObjects"])(this.options, prevOptions)) {
            this.#client.getQueryCache().notify({
                type: "observerOptionsUpdated",
                query: this.#currentQuery,
                observer: this
            });
        }
        const mounted = this.hasListeners();
        if (mounted && shouldFetchOptionally(this.#currentQuery, prevQuery, this.options, prevOptions)) {
            this.#executeFetch();
        }
        this.updateResult();
        if (mounted && (this.#currentQuery !== prevQuery || (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["resolveEnabled"])(this.options.enabled, this.#currentQuery) !== (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["resolveEnabled"])(prevOptions.enabled, this.#currentQuery) || (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["resolveStaleTime"])(this.options.staleTime, this.#currentQuery) !== (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["resolveStaleTime"])(prevOptions.staleTime, this.#currentQuery))) {
            this.#updateStaleTimeout();
        }
        const nextRefetchInterval = this.#computeRefetchInterval();
        if (mounted && (this.#currentQuery !== prevQuery || (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["resolveEnabled"])(this.options.enabled, this.#currentQuery) !== (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["resolveEnabled"])(prevOptions.enabled, this.#currentQuery) || nextRefetchInterval !== this.#currentRefetchInterval)) {
            this.#updateRefetchInterval(nextRefetchInterval);
        }
    }
    getOptimisticResult(options) {
        const query = this.#client.getQueryCache().build(this.#client, options);
        const result = this.createResult(query, options);
        if (shouldAssignObserverCurrentProperties(this, result)) {
            this.#currentResult = result;
            this.#currentResultOptions = this.options;
            this.#currentResultState = this.#currentQuery.state;
        }
        return result;
    }
    getCurrentResult() {
        return this.#currentResult;
    }
    trackResult(result, onPropTracked) {
        return new Proxy(result, {
            get: (target, key)=>{
                this.trackProp(key);
                onPropTracked?.(key);
                if (key === "promise") {
                    this.trackProp("data");
                    if (!this.options.experimental_prefetchInRender && this.#currentThenable.status === "pending") {
                        this.#currentThenable.reject(new Error("experimental_prefetchInRender feature flag is not enabled"));
                    }
                }
                return Reflect.get(target, key);
            }
        });
    }
    trackProp(key) {
        this.#trackedProps.add(key);
    }
    getCurrentQuery() {
        return this.#currentQuery;
    }
    refetch({ ...options } = {}) {
        return this.fetch({
            ...options
        });
    }
    fetchOptimistic(options) {
        const defaultedOptions = this.#client.defaultQueryOptions(options);
        const query = this.#client.getQueryCache().build(this.#client, defaultedOptions);
        return query.fetch().then(()=>this.createResult(query, defaultedOptions));
    }
    fetch(fetchOptions) {
        return this.#executeFetch({
            ...fetchOptions,
            cancelRefetch: fetchOptions.cancelRefetch ?? true
        }).then(()=>{
            this.updateResult();
            return this.#currentResult;
        });
    }
    #executeFetch(fetchOptions) {
        this.#updateQuery();
        let promise = this.#currentQuery.fetch(this.options, fetchOptions);
        if (!fetchOptions?.throwOnError) {
            promise = promise.catch(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["noop"]);
        }
        return promise;
    }
    #updateStaleTimeout() {
        this.#clearStaleTimeout();
        const staleTime = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["resolveStaleTime"])(this.options.staleTime, this.#currentQuery);
        if (__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$environmentManager$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["environmentManager"].isServer() || this.#currentResult.isStale || !(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isValidTimeout"])(staleTime)) {
            return;
        }
        const time = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["timeUntilStale"])(this.#currentResult.dataUpdatedAt, staleTime);
        const timeout = time + 1;
        this.#staleTimeoutId = __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$timeoutManager$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["timeoutManager"].setTimeout(()=>{
            if (!this.#currentResult.isStale) {
                this.updateResult();
            }
        }, timeout);
    }
    #computeRefetchInterval() {
        return (typeof this.options.refetchInterval === "function" ? this.options.refetchInterval(this.#currentQuery) : this.options.refetchInterval) ?? false;
    }
    #updateRefetchInterval(nextInterval) {
        this.#clearRefetchInterval();
        this.#currentRefetchInterval = nextInterval;
        if (__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$environmentManager$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["environmentManager"].isServer() || (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["resolveEnabled"])(this.options.enabled, this.#currentQuery) === false || !(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isValidTimeout"])(this.#currentRefetchInterval) || this.#currentRefetchInterval === 0) {
            return;
        }
        this.#refetchIntervalId = __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$timeoutManager$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["timeoutManager"].setInterval(()=>{
            if (this.options.refetchIntervalInBackground || __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$focusManager$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["focusManager"].isFocused()) {
                this.#executeFetch();
            }
        }, this.#currentRefetchInterval);
    }
    #updateTimers() {
        this.#updateStaleTimeout();
        this.#updateRefetchInterval(this.#computeRefetchInterval());
    }
    #clearStaleTimeout() {
        if (this.#staleTimeoutId) {
            __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$timeoutManager$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["timeoutManager"].clearTimeout(this.#staleTimeoutId);
            this.#staleTimeoutId = void 0;
        }
    }
    #clearRefetchInterval() {
        if (this.#refetchIntervalId) {
            __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$timeoutManager$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["timeoutManager"].clearInterval(this.#refetchIntervalId);
            this.#refetchIntervalId = void 0;
        }
    }
    createResult(query, options) {
        const prevQuery = this.#currentQuery;
        const prevOptions = this.options;
        const prevResult = this.#currentResult;
        const prevResultState = this.#currentResultState;
        const prevResultOptions = this.#currentResultOptions;
        const queryChange = query !== prevQuery;
        const queryInitialState = queryChange ? query.state : this.#currentQueryInitialState;
        const { state } = query;
        let newState = {
            ...state
        };
        let isPlaceholderData = false;
        let data;
        if (options._optimisticResults) {
            const mounted = this.hasListeners();
            const fetchOnMount = !mounted && shouldFetchOnMount(query, options);
            const fetchOptionally = mounted && shouldFetchOptionally(query, prevQuery, options, prevOptions);
            if (fetchOnMount || fetchOptionally) {
                newState = {
                    ...newState,
                    ...(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$query$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["fetchState"])(state.data, query.options)
                };
            }
            if (options._optimisticResults === "isRestoring") {
                newState.fetchStatus = "idle";
            }
        }
        let { error, errorUpdatedAt, status } = newState;
        data = newState.data;
        let skipSelect = false;
        if (options.placeholderData !== void 0 && data === void 0 && status === "pending") {
            let placeholderData;
            if (prevResult?.isPlaceholderData && options.placeholderData === prevResultOptions?.placeholderData) {
                placeholderData = prevResult.data;
                skipSelect = true;
            } else {
                placeholderData = typeof options.placeholderData === "function" ? options.placeholderData(this.#lastQueryWithDefinedData?.state.data, this.#lastQueryWithDefinedData) : options.placeholderData;
            }
            if (placeholderData !== void 0) {
                status = "success";
                data = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["replaceData"])(prevResult?.data, placeholderData, options);
                isPlaceholderData = true;
            }
        }
        if (options.select && data !== void 0 && !skipSelect) {
            if (prevResult && data === prevResultState?.data && options.select === this.#selectFn) {
                data = this.#selectResult;
            } else {
                try {
                    this.#selectFn = options.select;
                    data = options.select(data);
                    data = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["replaceData"])(prevResult?.data, data, options);
                    this.#selectResult = data;
                    this.#selectError = null;
                } catch (selectError) {
                    this.#selectError = selectError;
                }
            }
        }
        if (this.#selectError) {
            error = this.#selectError;
            data = this.#selectResult;
            errorUpdatedAt = Date.now();
            status = "error";
        }
        const isFetching = newState.fetchStatus === "fetching";
        const isPending = status === "pending";
        const isError = status === "error";
        const isLoading = isPending && isFetching;
        const hasData = data !== void 0;
        const result = {
            status,
            fetchStatus: newState.fetchStatus,
            isPending,
            isSuccess: status === "success",
            isError,
            isInitialLoading: isLoading,
            isLoading,
            data,
            dataUpdatedAt: newState.dataUpdatedAt,
            error,
            errorUpdatedAt,
            failureCount: newState.fetchFailureCount,
            failureReason: newState.fetchFailureReason,
            errorUpdateCount: newState.errorUpdateCount,
            isFetched: query.isFetched(),
            isFetchedAfterMount: newState.dataUpdateCount > queryInitialState.dataUpdateCount || newState.errorUpdateCount > queryInitialState.errorUpdateCount,
            isFetching,
            isRefetching: isFetching && !isPending,
            isLoadingError: isError && !hasData,
            isPaused: newState.fetchStatus === "paused",
            isPlaceholderData,
            isRefetchError: isError && hasData,
            isStale: isStale(query, options),
            refetch: this.refetch,
            promise: this.#currentThenable,
            isEnabled: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["resolveEnabled"])(options.enabled, query) !== false
        };
        const nextResult = result;
        if (this.options.experimental_prefetchInRender) {
            const hasResultData = nextResult.data !== void 0;
            const isErrorWithoutData = nextResult.status === "error" && !hasResultData;
            const finalizeThenableIfPossible = (thenable)=>{
                if (isErrorWithoutData) {
                    thenable.reject(nextResult.error);
                } else if (hasResultData) {
                    thenable.resolve(nextResult.data);
                }
            };
            const recreateThenable = ()=>{
                const pending = this.#currentThenable = nextResult.promise = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$thenable$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["pendingThenable"])();
                finalizeThenableIfPossible(pending);
            };
            const prevThenable = this.#currentThenable;
            switch(prevThenable.status){
                case "pending":
                    if (query.queryHash === prevQuery.queryHash) {
                        finalizeThenableIfPossible(prevThenable);
                    }
                    break;
                case "fulfilled":
                    if (isErrorWithoutData || nextResult.data !== prevThenable.value) {
                        recreateThenable();
                    }
                    break;
                case "rejected":
                    if (!isErrorWithoutData || nextResult.error !== prevThenable.reason) {
                        recreateThenable();
                    }
                    break;
            }
        }
        return nextResult;
    }
    updateResult() {
        const prevResult = this.#currentResult;
        const nextResult = this.createResult(this.#currentQuery, this.options);
        this.#currentResultState = this.#currentQuery.state;
        this.#currentResultOptions = this.options;
        if (this.#currentResultState.data !== void 0) {
            this.#lastQueryWithDefinedData = this.#currentQuery;
        }
        if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["shallowEqualObjects"])(nextResult, prevResult)) {
            return;
        }
        this.#currentResult = nextResult;
        const shouldNotifyListeners = ()=>{
            if (!prevResult) {
                return true;
            }
            const { notifyOnChangeProps } = this.options;
            const notifyOnChangePropsValue = typeof notifyOnChangeProps === "function" ? notifyOnChangeProps() : notifyOnChangeProps;
            if (notifyOnChangePropsValue === "all" || !notifyOnChangePropsValue && !this.#trackedProps.size) {
                return true;
            }
            const includedProps = new Set(notifyOnChangePropsValue ?? this.#trackedProps);
            if (this.options.throwOnError) {
                includedProps.add("error");
            }
            return Object.keys(this.#currentResult).some((key)=>{
                const typedKey = key;
                const changed = this.#currentResult[typedKey] !== prevResult[typedKey];
                return changed && includedProps.has(typedKey);
            });
        };
        this.#notify({
            listeners: shouldNotifyListeners()
        });
    }
    #updateQuery() {
        const query = this.#client.getQueryCache().build(this.#client, this.options);
        if (query === this.#currentQuery) {
            return;
        }
        const prevQuery = this.#currentQuery;
        this.#currentQuery = query;
        this.#currentQueryInitialState = query.state;
        if (this.hasListeners()) {
            prevQuery?.removeObserver(this);
            query.addObserver(this);
        }
    }
    onQueryUpdate() {
        this.updateResult();
        if (this.hasListeners()) {
            this.#updateTimers();
        }
    }
    #notify(notifyOptions) {
        __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$notifyManager$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["notifyManager"].batch(()=>{
            if (notifyOptions.listeners) {
                this.listeners.forEach((listener)=>{
                    listener(this.#currentResult);
                });
            }
            this.#client.getQueryCache().notify({
                query: this.#currentQuery,
                type: "observerResultsUpdated"
            });
        });
    }
};
function shouldLoadOnMount(query, options) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["resolveEnabled"])(options.enabled, query) !== false && query.state.data === void 0 && !(query.state.status === "error" && options.retryOnMount === false);
}
function shouldFetchOnMount(query, options) {
    return shouldLoadOnMount(query, options) || query.state.data !== void 0 && shouldFetchOn(query, options, options.refetchOnMount);
}
function shouldFetchOn(query, options, field) {
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["resolveEnabled"])(options.enabled, query) !== false && (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["resolveStaleTime"])(options.staleTime, query) !== "static") {
        const value = typeof field === "function" ? field(query) : field;
        return value === "always" || value !== false && isStale(query, options);
    }
    return false;
}
function shouldFetchOptionally(query, prevQuery, options, prevOptions) {
    return (query !== prevQuery || (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["resolveEnabled"])(prevOptions.enabled, query) === false) && (!options.suspense || query.state.status !== "error") && isStale(query, options);
}
function isStale(query, options) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["resolveEnabled"])(options.enabled, query) !== false && query.isStaleByTime((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["resolveStaleTime"])(options.staleTime, query));
}
function shouldAssignObserverCurrentProperties(observer, optimisticResult) {
    if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["shallowEqualObjects"])(observer.getCurrentResult(), optimisticResult)) {
        return true;
    }
    return false;
}
;
 //# sourceMappingURL=queryObserver.js.map
}),
"[project]/dashboard/node_modules/@tanstack/query-core/build/modern/infiniteQueryObserver.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "InfiniteQueryObserver",
    ()=>InfiniteQueryObserver
]);
// src/infiniteQueryObserver.ts
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$queryObserver$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/query-core/build/modern/queryObserver.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$infiniteQueryBehavior$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/query-core/build/modern/infiniteQueryBehavior.js [app-client] (ecmascript)");
;
;
var InfiniteQueryObserver = class extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$queryObserver$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["QueryObserver"] {
    constructor(client, options){
        super(client, options);
    }
    bindMethods() {
        super.bindMethods();
        this.fetchNextPage = this.fetchNextPage.bind(this);
        this.fetchPreviousPage = this.fetchPreviousPage.bind(this);
    }
    setOptions(options) {
        super.setOptions({
            ...options,
            behavior: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$infiniteQueryBehavior$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["infiniteQueryBehavior"])()
        });
    }
    getOptimisticResult(options) {
        options.behavior = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$infiniteQueryBehavior$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["infiniteQueryBehavior"])();
        return super.getOptimisticResult(options);
    }
    fetchNextPage(options) {
        return this.fetch({
            ...options,
            meta: {
                fetchMore: {
                    direction: "forward"
                }
            }
        });
    }
    fetchPreviousPage(options) {
        return this.fetch({
            ...options,
            meta: {
                fetchMore: {
                    direction: "backward"
                }
            }
        });
    }
    createResult(query, options) {
        const { state } = query;
        const parentResult = super.createResult(query, options);
        const { isFetching, isRefetching, isError, isRefetchError } = parentResult;
        const fetchDirection = state.fetchMeta?.fetchMore?.direction;
        const isFetchNextPageError = isError && fetchDirection === "forward";
        const isFetchingNextPage = isFetching && fetchDirection === "forward";
        const isFetchPreviousPageError = isError && fetchDirection === "backward";
        const isFetchingPreviousPage = isFetching && fetchDirection === "backward";
        const result = {
            ...parentResult,
            fetchNextPage: this.fetchNextPage,
            fetchPreviousPage: this.fetchPreviousPage,
            hasNextPage: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$infiniteQueryBehavior$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hasNextPage"])(options, state.data),
            hasPreviousPage: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$infiniteQueryBehavior$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hasPreviousPage"])(options, state.data),
            isFetchNextPageError,
            isFetchingNextPage,
            isFetchPreviousPageError,
            isFetchingPreviousPage,
            isRefetchError: isRefetchError && !isFetchNextPageError && !isFetchPreviousPageError,
            isRefetching: isRefetching && !isFetchingNextPage && !isFetchingPreviousPage
        };
        return result;
    }
};
;
 //# sourceMappingURL=infiniteQueryObserver.js.map
}),
"[project]/dashboard/node_modules/@tanstack/react-query/build/modern/useMutation.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useMutation",
    ()=>useMutation
]);
// src/useMutation.ts
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$mutationObserver$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/query-core/build/modern/mutationObserver.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/query-core/build/modern/utils.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$notifyManager$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/query-core/build/modern/notifyManager.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$QueryClientProvider$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/react-query/build/modern/QueryClientProvider.js [app-client] (ecmascript)");
"use client";
;
;
;
function useMutation(options, queryClient) {
    const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$QueryClientProvider$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useQueryClient"])(queryClient);
    const [observer] = __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"]({
        "useMutation.useState": ()=>new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$mutationObserver$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["MutationObserver"](client, options)
    }["useMutation.useState"]);
    __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"]({
        "useMutation.useEffect": ()=>{
            observer.setOptions(options);
        }
    }["useMutation.useEffect"], [
        observer,
        options
    ]);
    const result = __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useSyncExternalStore"](__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"]({
        "useMutation.useSyncExternalStore[result]": (onStoreChange)=>observer.subscribe(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$notifyManager$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["notifyManager"].batchCalls(onStoreChange))
    }["useMutation.useSyncExternalStore[result]"], [
        observer
    ]), {
        "useMutation.useSyncExternalStore[result]": ()=>observer.getCurrentResult()
    }["useMutation.useSyncExternalStore[result]"], {
        "useMutation.useSyncExternalStore[result]": ()=>observer.getCurrentResult()
    }["useMutation.useSyncExternalStore[result]"]);
    const mutate = __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"]({
        "useMutation.useCallback[mutate]": (variables, mutateOptions)=>{
            observer.mutate(variables, mutateOptions).catch(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["noop"]);
        }
    }["useMutation.useCallback[mutate]"], [
        observer
    ]);
    if (result.error && (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["shouldThrowError"])(observer.options.throwOnError, [
        result.error
    ])) {
        throw result.error;
    }
    return {
        ...result,
        mutate,
        mutateAsync: result.mutate
    };
}
;
 //# sourceMappingURL=useMutation.js.map
}),
"[project]/dashboard/node_modules/@tanstack/react-query/build/modern/QueryErrorResetBoundary.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "QueryErrorResetBoundary",
    ()=>QueryErrorResetBoundary,
    "useQueryErrorResetBoundary",
    ()=>useQueryErrorResetBoundary
]);
// src/QueryErrorResetBoundary.tsx
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/jsx-runtime.js [app-client] (ecmascript)");
"use client";
;
;
function createValue() {
    let isReset = false;
    return {
        clearReset: ()=>{
            isReset = false;
        },
        reset: ()=>{
            isReset = true;
        },
        isReset: ()=>{
            return isReset;
        }
    };
}
var QueryErrorResetBoundaryContext = __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createContext"](createValue());
var useQueryErrorResetBoundary = ()=>__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useContext"](QueryErrorResetBoundaryContext);
var QueryErrorResetBoundary = ({ children })=>{
    const [value] = __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"]({
        "QueryErrorResetBoundary.useState": ()=>createValue()
    }["QueryErrorResetBoundary.useState"]);
    return /* @__PURE__ */ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsx"])(QueryErrorResetBoundaryContext.Provider, {
        value,
        children: typeof children === "function" ? children(value) : children
    });
};
;
 //# sourceMappingURL=QueryErrorResetBoundary.js.map
}),
"[project]/dashboard/node_modules/@tanstack/react-query/build/modern/errorBoundaryUtils.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ensurePreventErrorBoundaryRetry",
    ()=>ensurePreventErrorBoundaryRetry,
    "getHasError",
    ()=>getHasError,
    "useClearResetErrorBoundary",
    ()=>useClearResetErrorBoundary
]);
// src/errorBoundaryUtils.ts
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/query-core/build/modern/utils.js [app-client] (ecmascript)");
"use client";
;
;
var ensurePreventErrorBoundaryRetry = (options, errorResetBoundary, query)=>{
    const throwOnError = query?.state.error && typeof options.throwOnError === "function" ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["shouldThrowError"])(options.throwOnError, [
        query.state.error,
        query
    ]) : options.throwOnError;
    if (options.suspense || options.experimental_prefetchInRender || throwOnError) {
        if (!errorResetBoundary.isReset()) {
            options.retryOnMount = false;
        }
    }
};
var useClearResetErrorBoundary = (errorResetBoundary)=>{
    __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"]({
        "useClearResetErrorBoundary.useEffect": ()=>{
            errorResetBoundary.clearReset();
        }
    }["useClearResetErrorBoundary.useEffect"], [
        errorResetBoundary
    ]);
};
var getHasError = ({ result, errorResetBoundary, throwOnError, query, suspense })=>{
    return result.isError && !errorResetBoundary.isReset() && !result.isFetching && query && (suspense && result.data === void 0 || (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["shouldThrowError"])(throwOnError, [
        result.error,
        query
    ]));
};
;
 //# sourceMappingURL=errorBoundaryUtils.js.map
}),
"[project]/dashboard/node_modules/@tanstack/react-query/build/modern/IsRestoringProvider.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "IsRestoringProvider",
    ()=>IsRestoringProvider,
    "useIsRestoring",
    ()=>useIsRestoring
]);
// src/IsRestoringProvider.ts
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
"use client";
;
var IsRestoringContext = __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createContext"](false);
var useIsRestoring = ()=>__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useContext"](IsRestoringContext);
var IsRestoringProvider = IsRestoringContext.Provider;
;
 //# sourceMappingURL=IsRestoringProvider.js.map
}),
"[project]/dashboard/node_modules/@tanstack/react-query/build/modern/suspense.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "defaultThrowOnError",
    ()=>defaultThrowOnError,
    "ensureSuspenseTimers",
    ()=>ensureSuspenseTimers,
    "fetchOptimistic",
    ()=>fetchOptimistic,
    "shouldSuspend",
    ()=>shouldSuspend,
    "willFetch",
    ()=>willFetch
]);
// src/suspense.ts
var defaultThrowOnError = (_error, query)=>query.state.data === void 0;
var ensureSuspenseTimers = (defaultedOptions)=>{
    if (defaultedOptions.suspense) {
        const MIN_SUSPENSE_TIME_MS = 1e3;
        const clamp = (value)=>value === "static" ? value : Math.max(value ?? MIN_SUSPENSE_TIME_MS, MIN_SUSPENSE_TIME_MS);
        const originalStaleTime = defaultedOptions.staleTime;
        defaultedOptions.staleTime = typeof originalStaleTime === "function" ? (...args)=>clamp(originalStaleTime(...args)) : clamp(originalStaleTime);
        if (typeof defaultedOptions.gcTime === "number") {
            defaultedOptions.gcTime = Math.max(defaultedOptions.gcTime, MIN_SUSPENSE_TIME_MS);
        }
    }
};
var willFetch = (result, isRestoring)=>result.isLoading && result.isFetching && !isRestoring;
var shouldSuspend = (defaultedOptions, result)=>defaultedOptions?.suspense && result.isPending;
var fetchOptimistic = (defaultedOptions, observer, errorResetBoundary)=>observer.fetchOptimistic(defaultedOptions).catch(()=>{
        errorResetBoundary.clearReset();
    });
;
 //# sourceMappingURL=suspense.js.map
}),
"[project]/dashboard/node_modules/@tanstack/react-query/build/modern/useBaseQuery.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useBaseQuery",
    ()=>useBaseQuery
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$build$2f$polyfills$2f$process$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = /*#__PURE__*/ __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/build/polyfills/process.js [app-client] (ecmascript)");
// src/useBaseQuery.ts
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$environmentManager$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/query-core/build/modern/environmentManager.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/query-core/build/modern/utils.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$notifyManager$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/query-core/build/modern/notifyManager.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$QueryClientProvider$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/react-query/build/modern/QueryClientProvider.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$QueryErrorResetBoundary$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/react-query/build/modern/QueryErrorResetBoundary.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$errorBoundaryUtils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/react-query/build/modern/errorBoundaryUtils.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$IsRestoringProvider$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/react-query/build/modern/IsRestoringProvider.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$suspense$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/react-query/build/modern/suspense.js [app-client] (ecmascript)");
"use client";
;
;
;
;
;
;
;
function useBaseQuery(options, Observer, queryClient) {
    if ("TURBOPACK compile-time truthy", 1) {
        if (typeof options !== "object" || Array.isArray(options)) {
            throw new Error('Bad argument type. Starting with v5, only the "Object" form is allowed when calling query related functions. Please use the error stack to find the culprit call. More info here: https://tanstack.com/query/latest/docs/react/guides/migrating-to-v5#supports-a-single-signature-one-object');
        }
    }
    const isRestoring = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$IsRestoringProvider$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useIsRestoring"])();
    const errorResetBoundary = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$QueryErrorResetBoundary$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useQueryErrorResetBoundary"])();
    const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$QueryClientProvider$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useQueryClient"])(queryClient);
    const defaultedOptions = client.defaultQueryOptions(options);
    client.getDefaultOptions().queries?._experimental_beforeQuery?.(defaultedOptions);
    const query = client.getQueryCache().get(defaultedOptions.queryHash);
    if ("TURBOPACK compile-time truthy", 1) {
        if (!defaultedOptions.queryFn) {
            console.error(`[${defaultedOptions.queryHash}]: No queryFn was passed as an option, and no default queryFn was found. The queryFn parameter is only optional when using a default queryFn. More info here: https://tanstack.com/query/latest/docs/framework/react/guides/default-query-function`);
        }
    }
    defaultedOptions._optimisticResults = isRestoring ? "isRestoring" : "optimistic";
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$suspense$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ensureSuspenseTimers"])(defaultedOptions);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$errorBoundaryUtils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ensurePreventErrorBoundaryRetry"])(defaultedOptions, errorResetBoundary, query);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$errorBoundaryUtils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useClearResetErrorBoundary"])(errorResetBoundary);
    const isNewCacheEntry = !client.getQueryCache().get(defaultedOptions.queryHash);
    const [observer] = __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"]({
        "useBaseQuery.useState": ()=>new Observer(client, defaultedOptions)
    }["useBaseQuery.useState"]);
    const result = observer.getOptimisticResult(defaultedOptions);
    const shouldSubscribe = !isRestoring && options.subscribed !== false;
    __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useSyncExternalStore"](__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"]({
        "useBaseQuery.useSyncExternalStore.useCallback": (onStoreChange)=>{
            const unsubscribe = shouldSubscribe ? observer.subscribe(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$notifyManager$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["notifyManager"].batchCalls(onStoreChange)) : __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["noop"];
            observer.updateResult();
            return unsubscribe;
        }
    }["useBaseQuery.useSyncExternalStore.useCallback"], [
        observer,
        shouldSubscribe
    ]), {
        "useBaseQuery.useSyncExternalStore": ()=>observer.getCurrentResult()
    }["useBaseQuery.useSyncExternalStore"], {
        "useBaseQuery.useSyncExternalStore": ()=>observer.getCurrentResult()
    }["useBaseQuery.useSyncExternalStore"]);
    __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"]({
        "useBaseQuery.useEffect": ()=>{
            observer.setOptions(defaultedOptions);
        }
    }["useBaseQuery.useEffect"], [
        defaultedOptions,
        observer
    ]);
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$suspense$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["shouldSuspend"])(defaultedOptions, result)) {
        throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$suspense$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["fetchOptimistic"])(defaultedOptions, observer, errorResetBoundary);
    }
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$errorBoundaryUtils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getHasError"])({
        result,
        errorResetBoundary,
        throwOnError: defaultedOptions.throwOnError,
        query,
        suspense: defaultedOptions.suspense
    })) {
        throw result.error;
    }
    ;
    client.getDefaultOptions().queries?._experimental_afterQuery?.(defaultedOptions, result);
    if (defaultedOptions.experimental_prefetchInRender && !__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$environmentManager$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["environmentManager"].isServer() && (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$suspense$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["willFetch"])(result, isRestoring)) {
        const promise = isNewCacheEntry ? // Fetch immediately on render in order to ensure `.promise` is resolved even if the component is unmounted
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$suspense$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["fetchOptimistic"])(defaultedOptions, observer, errorResetBoundary) : // subscribe to the "cache promise" so that we can finalize the currentThenable once data comes in
        query?.promise;
        promise?.catch(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["noop"]).finally(()=>{
            observer.updateResult();
        });
    }
    return !defaultedOptions.notifyOnChangeProps ? observer.trackResult(result) : result;
}
;
 //# sourceMappingURL=useBaseQuery.js.map
}),
"[project]/dashboard/node_modules/@tanstack/react-query/build/modern/useInfiniteQuery.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useInfiniteQuery",
    ()=>useInfiniteQuery
]);
// src/useInfiniteQuery.ts
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$infiniteQueryObserver$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/query-core/build/modern/infiniteQueryObserver.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useBaseQuery$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/react-query/build/modern/useBaseQuery.js [app-client] (ecmascript)");
"use client";
;
;
function useInfiniteQuery(options, queryClient) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useBaseQuery$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useBaseQuery"])(options, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$infiniteQueryObserver$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["InfiniteQueryObserver"], queryClient);
}
;
 //# sourceMappingURL=useInfiniteQuery.js.map
}),
"[project]/dashboard/node_modules/@tanstack/react-query/build/modern/useQuery.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useQuery",
    ()=>useQuery
]);
// src/useQuery.ts
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$queryObserver$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/query-core/build/modern/queryObserver.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useBaseQuery$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/react-query/build/modern/useBaseQuery.js [app-client] (ecmascript)");
"use client";
;
;
function useQuery(options, queryClient) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useBaseQuery$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useBaseQuery"])(options, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$queryObserver$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["QueryObserver"], queryClient);
}
;
 //# sourceMappingURL=useQuery.js.map
}),
"[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/connect.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "connect",
    ()=>connect
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$errors$2f$config$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/errors/config.js [app-client] (ecmascript)");
;
async function connect(config, parameters) {
    // "Register" connector if not already created
    let connector;
    if (typeof parameters.connector === 'function') {
        connector = config._internal.connectors.setup(parameters.connector);
    } else connector = parameters.connector;
    // Check if connector is already connected
    if (connector.uid === config.state.current) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$errors$2f$config$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ConnectorAlreadyConnectedError"]();
    try {
        config.setState((x)=>({
                ...x,
                status: 'connecting'
            }));
        connector.emitter.emit('message', {
            type: 'connecting'
        });
        const { connector: _, ...rest } = parameters;
        const data = await connector.connect(rest);
        connector.emitter.off('connect', config._internal.events.connect);
        connector.emitter.on('change', config._internal.events.change);
        connector.emitter.on('disconnect', config._internal.events.disconnect);
        await config.storage?.setItem('recentConnectorId', connector.id);
        config.setState((x)=>({
                ...x,
                connections: new Map(x.connections).set(connector.uid, {
                    accounts: rest.withCapabilities ? data.accounts.map((account)=>typeof account === 'object' ? account.address : account) : data.accounts,
                    chainId: data.chainId,
                    connector: connector
                }),
                current: connector.uid,
                status: 'connected'
            }));
        return {
            // TODO(v3): Remove `withCapabilities: true` default behavior so remove compat marshalling
            // Workaround so downstream connectors work with `withCapabilities` without any changes required
            accounts: rest.withCapabilities ? data.accounts.map((address)=>typeof address === 'object' ? address : {
                    address,
                    capabilities: {}
                }) : data.accounts,
            chainId: data.chainId
        };
    } catch (error) {
        config.setState((x)=>({
                ...x,
                // Keep existing connector connected in case of error
                status: x.current ? 'connected' : 'disconnected'
            }));
        throw error;
    }
} //# sourceMappingURL=connect.js.map
}),
"[project]/dashboard/node_modules/@wagmi/core/dist/esm/query/connect.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "connectMutationOptions",
    ()=>connectMutationOptions
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$connect$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/connect.js [app-client] (ecmascript)");
;
function connectMutationOptions(config, options = {}) {
    return {
        ...options.mutation,
        mutationFn: async (variables)=>{
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$connect$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["connect"])(config, variables);
        },
        mutationKey: [
            'connect'
        ]
    };
} //# sourceMappingURL=connect.js.map
}),
"[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/getConnectors.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getConnectors",
    ()=>getConnectors
]);
let previousConnectors = [];
function getConnectors(config) {
    const connectors = config.connectors;
    if (previousConnectors.length === connectors.length && previousConnectors.every((connector, index)=>connector === connectors[index])) return previousConnectors;
    previousConnectors = connectors;
    return connectors;
} //# sourceMappingURL=getConnectors.js.map
}),
"[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/watchConnectors.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/** https://wagmi.sh/core/api/actions/watchConnectors */ __turbopack_context__.s([
    "watchConnectors",
    ()=>watchConnectors
]);
function watchConnectors(config, parameters) {
    const { onChange } = parameters;
    return config._internal.connectors.subscribe((connectors, prevConnectors)=>{
        onChange(Object.values(connectors), prevConnectors);
    });
} //# sourceMappingURL=watchConnectors.js.map
}),
"[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/disconnect.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/** https://wagmi.sh/core/api/actions/disconnect */ __turbopack_context__.s([
    "disconnect",
    ()=>disconnect
]);
async function disconnect(config, parameters = {}) {
    let connector;
    if (parameters.connector) connector = parameters.connector;
    else {
        const { connections, current } = config.state;
        const connection = connections.get(current);
        connector = connection?.connector;
    }
    const connections = config.state.connections;
    if (connector) {
        await connector.disconnect();
        connector.emitter.off('change', config._internal.events.change);
        connector.emitter.off('disconnect', config._internal.events.disconnect);
        connector.emitter.on('connect', config._internal.events.connect);
        connections.delete(connector.uid);
    }
    config.setState((x)=>{
        // if no connections exist, move to disconnected state
        if (connections.size === 0) return {
            ...x,
            connections: new Map(),
            current: null,
            status: 'disconnected'
        };
        // switch over to another connection
        const nextConnection = connections.values().next().value;
        return {
            ...x,
            connections: new Map(connections),
            current: nextConnection.connector.uid
        };
    });
    // Set recent connector if exists
    {
        const current = config.state.current;
        if (!current) return;
        const connector = config.state.connections.get(current)?.connector;
        if (!connector) return;
        await config.storage?.setItem('recentConnectorId', connector.id);
    }
} //# sourceMappingURL=disconnect.js.map
}),
"[project]/dashboard/node_modules/@wagmi/core/dist/esm/query/disconnect.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "disconnectMutationOptions",
    ()=>disconnectMutationOptions
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$disconnect$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/disconnect.js [app-client] (ecmascript)");
;
function disconnectMutationOptions(config, options = {}) {
    return {
        ...options.mutation,
        mutationFn: async (variables)=>{
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$disconnect$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["disconnect"])(config, variables);
        },
        mutationKey: [
            'disconnect'
        ]
    };
} //# sourceMappingURL=disconnect.js.map
}),
"[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/getConnections.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getConnections",
    ()=>getConnections
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$utils$2f$deepEqual$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/utils/deepEqual.js [app-client] (ecmascript)");
;
let previousConnections = [];
function getConnections(config) {
    const connections = [
        ...config.state.connections.values()
    ];
    if (config.state.status === 'reconnecting') return previousConnections;
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$utils$2f$deepEqual$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["deepEqual"])(previousConnections, connections)) return previousConnections;
    previousConnections = connections;
    return connections;
} //# sourceMappingURL=getConnections.js.map
}),
"[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/watchConnections.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "watchConnections",
    ()=>watchConnections
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$utils$2f$deepEqual$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/utils/deepEqual.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$getConnections$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/getConnections.js [app-client] (ecmascript)");
;
;
function watchConnections(config, parameters) {
    const { onChange } = parameters;
    return config.subscribe(()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$getConnections$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getConnections"])(config), onChange, {
        equalityFn: __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$utils$2f$deepEqual$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["deepEqual"]
    });
} //# sourceMappingURL=watchConnections.js.map
}),
"[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/switchChain.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "switchChain",
    ()=>switchChain
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$errors$2f$config$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/errors/config.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$errors$2f$connector$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/errors/connector.js [app-client] (ecmascript)");
;
;
async function switchChain(config, parameters) {
    const { addEthereumChainParameter, chainId } = parameters;
    const connection = config.state.connections.get(parameters.connector?.uid ?? config.state.current);
    if (connection) {
        const connector = connection.connector;
        if (!connector.switchChain) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$errors$2f$connector$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["SwitchChainNotSupportedError"]({
            connector
        });
        const chain = await connector.switchChain({
            addEthereumChainParameter,
            chainId
        });
        return chain;
    }
    const chain = config.chains.find((x)=>x.id === chainId);
    if (!chain) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$errors$2f$config$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ChainNotConfiguredError"]();
    config.setState((x)=>({
            ...x,
            chainId
        }));
    return chain;
} //# sourceMappingURL=switchChain.js.map
}),
"[project]/dashboard/node_modules/@wagmi/core/dist/esm/query/switchChain.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "switchChainMutationOptions",
    ()=>switchChainMutationOptions
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$switchChain$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/switchChain.js [app-client] (ecmascript)");
;
function switchChainMutationOptions(config, options = {}) {
    return {
        ...options.mutation,
        mutationFn (variables) {
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$switchChain$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["switchChain"])(config, variables);
        },
        mutationKey: [
            'switchChain'
        ]
    };
} //# sourceMappingURL=switchChain.js.map
}),
"[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/getChains.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getChains",
    ()=>getChains
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$utils$2f$deepEqual$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/utils/deepEqual.js [app-client] (ecmascript)");
;
let previousChains = [];
function getChains(config) {
    const chains = config.chains;
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$utils$2f$deepEqual$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["deepEqual"])(previousChains, chains)) return previousChains;
    previousChains = chains;
    return chains;
} //# sourceMappingURL=getChains.js.map
}),
"[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/watchChains.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * @internal
 * We don't expose this because as far as consumers know, you can't chainge (lol) `config.chains` at runtime.
 * Setting `config.chains` via `config._internal.chains.setState(...)` is an extremely advanced use case that's not worth documenting or supporting in the public API at this time.
 */ __turbopack_context__.s([
    "watchChains",
    ()=>watchChains
]);
function watchChains(config, parameters) {
    const { onChange } = parameters;
    return config._internal.chains.subscribe((chains, prevChains)=>{
        onChange(chains, prevChains);
    });
} //# sourceMappingURL=watchChains.js.map
}),
"[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/getConnectorClient.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getConnectorClient",
    ()=>getConnectorClient
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$clients$2f$createClient$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/clients/createClient.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$clients$2f$transports$2f$custom$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/clients/transports/custom.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$getAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/address/getAddress.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/accounts/utils/parseAccount.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$errors$2f$config$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/errors/config.js [app-client] (ecmascript)");
;
;
;
async function getConnectorClient(config, parameters = {}) {
    const { assertChainId = true } = parameters;
    // Get connection
    let connection;
    if (parameters.connector) {
        const { connector } = parameters;
        if (config.state.status === 'reconnecting' && !connector.getAccounts && !connector.getChainId) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$errors$2f$config$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ConnectorUnavailableReconnectingError"]({
            connector
        });
        const [accounts, chainId] = await Promise.all([
            connector.getAccounts().catch((e)=>{
                if (parameters.account === null) return [];
                throw e;
            }),
            connector.getChainId()
        ]);
        connection = {
            accounts: accounts,
            chainId,
            connector
        };
    } else connection = config.state.connections.get(config.state.current);
    if (!connection) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$errors$2f$config$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ConnectorNotConnectedError"]();
    const chainId = parameters.chainId ?? connection.chainId;
    // Check connector using same chainId as connection
    const connectorChainId = await connection.connector.getChainId();
    if (assertChainId && connectorChainId !== chainId) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$errors$2f$config$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ConnectorChainMismatchError"]({
        connectionChainId: chainId,
        connectorChainId
    });
    const connector = connection.connector;
    if (connector.getClient) return connector.getClient({
        chainId
    });
    // Default using `custom` transport
    const account = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["parseAccount"])(parameters.account ?? connection.accounts[0]);
    if (account) account.address = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$getAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAddress"])(account.address); // TODO: Checksum address as part of `parseAccount`?
    // If account was provided, check that it exists on the connector
    if (parameters.account && !connection.accounts.some((x)=>x.toLowerCase() === account.address.toLowerCase())) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$errors$2f$config$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ConnectorAccountNotFoundError"]({
        address: account.address,
        connector
    });
    const chain = config.chains.find((chain)=>chain.id === chainId);
    const provider = await connection.connector.getProvider({
        chainId
    });
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$clients$2f$createClient$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createClient"])({
        account,
        chain,
        name: 'Connector Client',
        transport: (opts)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$clients$2f$transports$2f$custom$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["custom"])(provider)({
                ...opts,
                retryCount: 0
            })
    });
} //# sourceMappingURL=getConnectorClient.js.map
}),
"[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/getWalletClient.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getWalletClient",
    ()=>getWalletClient
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$clients$2f$decorators$2f$wallet$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/clients/decorators/wallet.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$getConnectorClient$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/getConnectorClient.js [app-client] (ecmascript)");
;
;
async function getWalletClient(config, parameters = {}) {
    const client = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$getConnectorClient$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getConnectorClient"])(config, parameters);
    // @ts-ignore
    return client.extend(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$clients$2f$decorators$2f$wallet$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["walletActions"]);
} //# sourceMappingURL=getWalletClient.js.map
}),
"[project]/dashboard/node_modules/@wagmi/core/dist/esm/query/utils.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "filterQueryOptions",
    ()=>filterQueryOptions,
    "hashFn",
    ()=>hashFn,
    "structuralSharing",
    ()=>structuralSharing
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/query-core/build/modern/utils.js [app-client] (ecmascript)");
;
function structuralSharing(oldData, newData) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$query$2d$core$2f$build$2f$modern$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["replaceEqualDeep"])(oldData, newData);
}
function hashFn(queryKey) {
    return JSON.stringify(queryKey, (_, value)=>{
        if (isPlainObject(value)) return Object.keys(value).sort().reduce((result, key)=>{
            result[key] = value[key];
            return result;
        }, {});
        if (typeof value === 'bigint') return value.toString();
        return value;
    });
}
// biome-ignore lint/complexity/noBannedTypes: using
function isPlainObject(value) {
    if (!hasObjectPrototype(value)) {
        return false;
    }
    // If has modified constructor
    const ctor = value.constructor;
    if (typeof ctor === 'undefined') return true;
    // If has modified prototype
    const prot = ctor.prototype;
    if (!hasObjectPrototype(prot)) return false;
    // If constructor does not have an Object-specific method
    // biome-ignore lint/suspicious/noPrototypeBuiltins: using
    if (!prot.hasOwnProperty('isPrototypeOf')) return false;
    // Most likely a plain Object
    return true;
}
function hasObjectPrototype(o) {
    return Object.prototype.toString.call(o) === '[object Object]';
}
function filterQueryOptions(options) {
    // destructuring is super fast
    // biome-ignore format: no formatting
    const { // import('@tanstack/query-core').QueryOptions
    // biome-ignore lint/correctness/noUnusedVariables: tossing
    _defaulted, behavior, gcTime, initialData, initialDataUpdatedAt, maxPages, meta, networkMode, queryFn, queryHash, queryKey, queryKeyHashFn, retry, retryDelay, structuralSharing, // import('@tanstack/query-core').InfiniteQueryObserverOptions
    // biome-ignore lint/correctness/noUnusedVariables: tossing
    getPreviousPageParam, getNextPageParam, initialPageParam, // import('@tanstack/react-query').UseQueryOptions
    // biome-ignore lint/correctness/noUnusedVariables: tossing
    _optimisticResults, enabled, notifyOnChangeProps, placeholderData, refetchInterval, refetchIntervalInBackground, refetchOnMount, refetchOnReconnect, refetchOnWindowFocus, retryOnMount, select, staleTime, suspense, throwOnError, ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // wagmi
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // biome-ignore lint/correctness/noUnusedVariables: tossing
    abi, config, connector, query, watch, ...rest } = options;
    if (connector) return {
        connectorUid: connector?.uid,
        ...rest
    };
    return rest;
} //# sourceMappingURL=utils.js.map
}),
"[project]/dashboard/node_modules/@wagmi/core/dist/esm/query/getWalletClient.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getWalletClientQueryKey",
    ()=>getWalletClientQueryKey,
    "getWalletClientQueryOptions",
    ()=>getWalletClientQueryOptions
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$getWalletClient$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/getWalletClient.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$query$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/query/utils.js [app-client] (ecmascript)");
;
;
function getWalletClientQueryOptions(config, options = {}) {
    return {
        ...options.query,
        enabled: Boolean(options.connector?.getProvider && (options.query?.enabled ?? true)),
        gcTime: 0,
        queryFn: async (context)=>{
            if (!options.connector?.getProvider) throw new Error('connector is required');
            const [, { connectorUid: _, scopeKey: __, ...parameters }] = context.queryKey;
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$getWalletClient$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getWalletClient"])(config, {
                ...parameters,
                connector: options.connector
            });
        },
        queryKey: getWalletClientQueryKey(options),
        staleTime: Number.POSITIVE_INFINITY
    };
}
function getWalletClientQueryKey(options = {}) {
    return [
        'walletClient',
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$query$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["filterQueryOptions"])(options)
    ];
} //# sourceMappingURL=getWalletClient.js.map
}),
"[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/getChainId.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/** https://wagmi.sh/core/api/actions/getChainId */ __turbopack_context__.s([
    "getChainId",
    ()=>getChainId
]);
function getChainId(config) {
    return config.state.chainId;
} //# sourceMappingURL=getChainId.js.map
}),
"[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/watchChainId.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/** https://wagmi.sh/core/api/actions/watchChainId */ __turbopack_context__.s([
    "watchChainId",
    ()=>watchChainId
]);
function watchChainId(config, parameters) {
    const { onChange } = parameters;
    return config.subscribe((state)=>state.chainId, onChange);
} //# sourceMappingURL=watchChainId.js.map
}),
"[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useConnectors.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useConnectors",
    ()=>useConnectors
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$getConnectors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/getConnectors.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$watchConnectors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/watchConnectors.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConfig$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useConfig.js [app-client] (ecmascript)");
'use client';
;
;
;
function useConnectors(parameters = {}) {
    const config = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConfig$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useConfig"])(parameters);
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useSyncExternalStore"])({
        "useConnectors.useSyncExternalStore": (onChange)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$watchConnectors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["watchConnectors"])(config, {
                onChange
            })
    }["useConnectors.useSyncExternalStore"], {
        "useConnectors.useSyncExternalStore": ()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$getConnectors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getConnectors"])(config)
    }["useConnectors.useSyncExternalStore"], {
        "useConnectors.useSyncExternalStore": ()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$getConnectors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getConnectors"])(config)
    }["useConnectors.useSyncExternalStore"]);
} //# sourceMappingURL=useConnectors.js.map
}),
"[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useConnect.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useConnect",
    ()=>useConnect
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useMutation$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/react-query/build/modern/useMutation.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$query$2f$connect$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/query/connect.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConfig$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useConfig.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnectors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useConnectors.js [app-client] (ecmascript)");
'use client';
;
;
;
;
;
function useConnect(parameters = {}) {
    const config = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConfig$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useConfig"])(parameters);
    const options = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$query$2f$connect$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["connectMutationOptions"])(config, parameters);
    const mutation = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useMutation$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useMutation"])(options);
    // Reset mutation back to an idle state when the connector disconnects.
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "useConnect.useEffect": ()=>{
            return config.subscribe({
                "useConnect.useEffect": ({ status })=>status
            }["useConnect.useEffect"], {
                "useConnect.useEffect": (status, previousStatus)=>{
                    if (previousStatus === 'connected' && status === 'disconnected') mutation.reset();
                }
            }["useConnect.useEffect"]);
        }
    }["useConnect.useEffect"], [
        config,
        mutation.reset
    ]);
    return {
        ...mutation,
        connect: mutation.mutate,
        connectAsync: mutation.mutateAsync,
        connectors: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnectors$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useConnectors"])({
            config
        })
    };
} //# sourceMappingURL=useConnect.js.map
}),
"[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useConnections.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useConnections",
    ()=>useConnections
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$getConnections$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/getConnections.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$watchConnections$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/watchConnections.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConfig$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useConfig.js [app-client] (ecmascript)");
'use client';
;
;
;
function useConnections(parameters = {}) {
    const config = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConfig$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useConfig"])(parameters);
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useSyncExternalStore"])({
        "useConnections.useSyncExternalStore": (onChange)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$watchConnections$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["watchConnections"])(config, {
                onChange
            })
    }["useConnections.useSyncExternalStore"], {
        "useConnections.useSyncExternalStore": ()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$getConnections$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getConnections"])(config)
    }["useConnections.useSyncExternalStore"], {
        "useConnections.useSyncExternalStore": ()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$getConnections$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getConnections"])(config)
    }["useConnections.useSyncExternalStore"]);
} //# sourceMappingURL=useConnections.js.map
}),
"[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useDisconnect.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useDisconnect",
    ()=>useDisconnect
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useMutation$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/react-query/build/modern/useMutation.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$query$2f$disconnect$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/query/disconnect.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConfig$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useConfig.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnections$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useConnections.js [app-client] (ecmascript)");
'use client';
;
;
;
;
function useDisconnect(parameters = {}) {
    const config = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConfig$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useConfig"])(parameters);
    const options = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$query$2f$disconnect$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["disconnectMutationOptions"])(config, parameters);
    const mutation = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useMutation$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useMutation"])(options);
    return {
        ...mutation,
        connectors: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnections$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useConnections"])({
            config
        }).map((connection)=>connection.connector),
        disconnect: mutation.mutate,
        disconnectAsync: mutation.mutateAsync
    };
} //# sourceMappingURL=useDisconnect.js.map
}),
"[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useChains.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useChains",
    ()=>useChains
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$getChains$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/getChains.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$watchChains$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/watchChains.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConfig$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useConfig.js [app-client] (ecmascript)");
'use client';
;
;
;
;
function useChains(parameters = {}) {
    const config = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConfig$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useConfig"])(parameters);
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useSyncExternalStore"])({
        "useChains.useSyncExternalStore": (onChange)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$watchChains$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["watchChains"])(config, {
                onChange
            })
    }["useChains.useSyncExternalStore"], {
        "useChains.useSyncExternalStore": ()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$getChains$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getChains"])(config)
    }["useChains.useSyncExternalStore"], {
        "useChains.useSyncExternalStore": ()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$getChains$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getChains"])(config)
    }["useChains.useSyncExternalStore"]);
} //# sourceMappingURL=useChains.js.map
}),
"[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useSwitchChain.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useSwitchChain",
    ()=>useSwitchChain
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useMutation$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/react-query/build/modern/useMutation.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$query$2f$switchChain$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/query/switchChain.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useChains$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useChains.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConfig$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useConfig.js [app-client] (ecmascript)");
'use client';
;
;
;
;
function useSwitchChain(parameters = {}) {
    const config = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConfig$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useConfig"])(parameters);
    const options = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$query$2f$switchChain$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["switchChainMutationOptions"])(config, parameters);
    const mutation = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useMutation$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useMutation"])(options);
    return {
        ...mutation,
        chains: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useChains$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useChains"])({
            config
        }),
        switchChain: mutation.mutate,
        switchChainAsync: mutation.mutateAsync
    };
} //# sourceMappingURL=useSwitchChain.js.map
}),
"[project]/dashboard/node_modules/wagmi/dist/esm/utils/query.js [app-client] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useInfiniteQuery",
    ()=>useInfiniteQuery,
    "useQuery",
    ()=>useQuery
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useInfiniteQuery$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/react-query/build/modern/useInfiniteQuery.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useQuery$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/react-query/build/modern/useQuery.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useMutation$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/react-query/build/modern/useMutation.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$query$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/query/utils.js [app-client] (ecmascript)");
;
;
;
function useQuery(parameters) {
    const result = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useQuery$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useQuery"])({
        ...parameters,
        queryKeyHashFn: __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$query$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hashFn"]
    });
    result.queryKey = parameters.queryKey;
    return result;
}
function useInfiniteQuery(parameters) {
    const result = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$useInfiniteQuery$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useInfiniteQuery"])({
        ...parameters,
        queryKeyHashFn: __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$query$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hashFn"]
    });
    result.queryKey = parameters.queryKey;
    return result;
} //# sourceMappingURL=query.js.map
}),
"[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useChainId.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useChainId",
    ()=>useChainId
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$getChainId$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/getChainId.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$watchChainId$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/actions/watchChainId.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConfig$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useConfig.js [app-client] (ecmascript)");
'use client';
;
;
;
function useChainId(parameters = {}) {
    const config = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConfig$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useConfig"])(parameters);
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useSyncExternalStore"])({
        "useChainId.useSyncExternalStore": (onChange)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$watchChainId$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["watchChainId"])(config, {
                onChange
            })
    }["useChainId.useSyncExternalStore"], {
        "useChainId.useSyncExternalStore": ()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$getChainId$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getChainId"])(config)
    }["useChainId.useSyncExternalStore"], {
        "useChainId.useSyncExternalStore": ()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$actions$2f$getChainId$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getChainId"])(config)
    }["useChainId.useSyncExternalStore"]);
} //# sourceMappingURL=useChainId.js.map
}),
"[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useWalletClient.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useWalletClient",
    ()=>useWalletClient
]);
// Almost identical implementation to `useConnectorClient` (except for return type)
// Should update both in tandem
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$QueryClientProvider$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@tanstack/react-query/build/modern/QueryClientProvider.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$query$2f$getWalletClient$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/@wagmi/core/dist/esm/query/getWalletClient.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$utils$2f$query$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/dashboard/node_modules/wagmi/dist/esm/utils/query.js [app-client] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useChainId$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useChainId.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConfig$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useConfig.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnection$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/wagmi/dist/esm/hooks/useConnection.js [app-client] (ecmascript)");
'use client';
;
;
;
;
;
;
;
function useWalletClient(parameters = {}) {
    const config = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConfig$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useConfig"])(parameters);
    const chainId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useChainId$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useChainId"])({
        config
    });
    const { address, connector } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$hooks$2f$useConnection$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useConnection"])({
        config
    });
    const options = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$wagmi$2f$core$2f$dist$2f$esm$2f$query$2f$getWalletClient$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getWalletClientQueryOptions"])(config, {
        ...parameters,
        chainId: parameters.chainId ?? chainId,
        connector: parameters.connector ?? connector,
        query: parameters.query
    });
    const addressRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(address);
    const queryClient = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f40$tanstack$2f$react$2d$query$2f$build$2f$modern$2f$QueryClientProvider$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useQueryClient"])();
    // biome-ignore lint/correctness/useExhaustiveDependencies: `queryKey` not required
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "useWalletClient.useEffect": ()=>{
            const previousAddress = addressRef.current;
            if (!address && previousAddress) {
                // remove when account is disconnected
                queryClient.removeQueries({
                    queryKey: options.queryKey
                });
                addressRef.current = undefined;
            } else if (address !== previousAddress) {
                // invalidate when address changes
                queryClient.invalidateQueries({
                    queryKey: options.queryKey
                });
                addressRef.current = address;
            }
        }
    }["useWalletClient.useEffect"], [
        address,
        queryClient
    ]);
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$wagmi$2f$dist$2f$esm$2f$utils$2f$query$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__$3c$locals$3e$__["useQuery"])(options);
} //# sourceMappingURL=useWalletClient.js.map
}),
"[project]/dashboard/node_modules/@adraffy/ens-normalize/dist/index.mjs [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ens_beautify",
    ()=>ens_beautify,
    "ens_emoji",
    ()=>ens_emoji,
    "ens_normalize",
    ()=>ens_normalize,
    "ens_normalize_fragment",
    ()=>ens_normalize_fragment,
    "ens_split",
    ()=>ens_split,
    "ens_tokenize",
    ()=>ens_tokenize,
    "is_combining_mark",
    ()=>is_combining_mark,
    "nfc",
    ()=>nfc,
    "nfd",
    ()=>nfd,
    "safe_str_from_cps",
    ()=>safe_str_from_cps,
    "should_escape",
    ()=>should_escape
]);
// created 2023-09-25T01:01:55.148Z
// compressed base64-encoded blob for include-ens data
// source: https://github.com/adraffy/ens-normalize.js/blob/main/src/make.js
// see: https://github.com/adraffy/ens-normalize.js#security
// SHA-256: 0565ed049b9cf1614bb9e11ba7d8ac6a6fb96c893253d890f7e2b2884b9ded32
var COMPRESSED$1 = 'AEEUdwmgDS8BxQKKAP4BOgDjATAAngDUAIMAoABoAOAAagCOAEQAhABMAHIAOwA9ACsANgAmAGIAHgAuACgAJwAXAC0AGgAjAB8ALwAUACkAEgAeAAkAGwARABkAFgA5ACgALQArADcAFQApABAAHgAiABAAGgAeABMAGAUhBe8BFxREN8sF2wC5AK5HAW8ArQkDzQCuhzc3NzcBP68NEfMABQdHBuw5BV8FYAA9MzkI9r4ZBg7QyQAWA9CeOwLNCjcCjqkChuA/lm+RAsXTAoP6ASfnEQDytQFJAjWVCkeXAOsA6godAB/cwdAUE0WlBCN/AQUCQRjFD/MRBjHxDQSJbw0jBzUAswBxme+tnIcAYwabAysG8QAjAEMMmxcDqgPKQyDXCMMxA7kUQwD3NXOrAKmFIAAfBC0D3x4BJQDBGdUFAhEgVD8JnwmQJiNWYUzrg0oAGwAUAB0AFnNcACkAFgBP9h3gPfsDOWDKneY2ChglX1UDYD30ABsAFAAdABZzIGRAnwDD8wAjAEEMzRbDqgMB2sAFYwXqAtCnAsS4AwpUJKRtFHsadUz9AMMVbwLpABM1NJEX0ZkCgYMBEyMAxRVvAukAEzUBUFAtmUwSAy4DBTER33EftQHfSwB5MxJ/AjkWKQLzL8E/cwBB6QH9LQDPDtO9ASNriQC5DQANAwCK21EFI91zHwCoL9kBqQcHBwcHKzUDowBvAQohPvU3fAQgHwCyAc8CKQMA5zMSezr7ULgFmDp/LzVQBgEGAi8FYQVgt8AFcTtlQhpCWEmfe5tmZ6IAExsDzQ8t+X8rBKtTAltbAn0jsy8Bl6utPWMDTR8Ei2kRANkDBrNHNysDBzECQWUAcwFpJ3kAiyUhAJ0BUb8AL3EfAbfNAz81KUsFWwF3YQZtAm0A+VEfAzEJDQBRSQCzAQBlAHsAM70GD/v3IZWHBwARKQAxALsjTwHZAeMPEzmXgIHwABIAGQA8AEUAQDt3gdvIEGcQZAkGTRFMdEIVEwK0D64L7REdDNkq09PgADSxB/MDWwfzA1sDWwfzB/MDWwfzA1sDWwNbA1scEvAi28gQZw9QBHUFlgWTBN4IiyZREYkHMAjaVBV0JhxPA00BBCMtSSQ7mzMTJUpMFE0LCAQ2SmyvfUADTzGzVP2QqgPTMlc5dAkGHnkSqAAyD3skNb1OhnpPcagKU0+2tYdJak5vAsY6sEAACikJm2/Dd1YGRRAfJ6kQ+ww3AbkBPw3xS9wE9QY/BM0fgRkdD9GVoAipLeEM8SbnLqWAXiP5KocF8Uv4POELUVFsD10LaQnnOmeBUgMlAREijwrhDT0IcRD3Cs1vDekRSQc9A9lJngCpBwULFR05FbkmFGKwCw05ewb/GvoLkyazEy17AAXXGiUGUQEtGwMA0y7rhbRaNVwgT2MGBwspI8sUrFAkDSlAu3hMGh8HGSWtApVDdEqLUToelyH6PEENai4XUYAH+TwJGVMLhTyiRq9FEhHWPpE9TCJNTDAEOYMsMyePCdMPiQy9fHYBXQklCbUMdRM1ERs3yQg9Bx0xlygnGQglRplgngT7owP3E9UDDwVDCUUHFwO5HDETMhUtBRGBKNsC9zbZLrcCk1aEARsFzw8pH+MQVEfkDu0InwJpA4cl7wAxFSUAGyKfCEdnAGOP3FMJLs8Iy2pwI3gDaxTrZRF3B5UOWwerHDcVwxzlcMxeD4YMKKezCV8BeQmdAWME5wgNNV+MpCBFZ1eLXBifIGVBQ14AAjUMaRWjRMGHfAKPD28SHwE5AXcHPQ0FAnsR8RFvEJkI74YINbkz/DopBFMhhyAVCisDU2zSCysm/Qz8bQGnEmYDEDRBd/Jnr2C6KBgBBx0yyUFkIfULlk/RDKAaxRhGVDIZ6AfDA/ca9yfuQVsGAwOnBxc6UTPyBMELbQiPCUMATQ6nGwfbGG4KdYzUATWPAbudA1uVhwJzkwY7Bw8Aaw+LBX3pACECqwinAAkA0wNbAD0CsQehAB0AiUUBQQMrMwEl6QKTA5cINc8BmTMB9y0EH8cMGQD7O25OAsO1AoBuZqYF4VwCkgJNOQFRKQQJUktVA7N15QDfAE8GF+NLARmvTs8e50cB43MvAMsA/wAJOQcJRQHRAfdxALsBYws1Caa3uQFR7S0AhwAZbwHbAo0A4QA5AIP1AVcAUQVd/QXXAlNNARU1HC9bZQG/AyMBNwERAH0Gz5GpzQsjBHEH1wIQHxXlAu8yB7kFAyLjE9FCyQK94lkAMhoKPAqrCqpgX2Q3CjV2PVQAEh+sPss/UgVVO1c7XDtXO1w7VztcO1c7XDtXO1wDm8Pmw+YKcF9JYe8Mqg3YRMw6TRPfYFVgNhPMLbsUxRXSJVoZQRrAJwkl6FUNDwgt12Y0CDA0eRfAAEMpbINFY4oeNApPHOtTlVT8LR8AtUumM7MNsBsZREQFS3XxYi4WEgomAmSFAmJGX1GzAV83JAKh+wJonAJmDQKfiDgfDwJmPwJmKgRyBIMDfxcDfpY5Cjl7GzmGOicnAmwhAjI6OA4CbcsCbbLzjgM3a0kvAWsA4gDlAE4JB5wMkQECD8YAEbkCdzMCdqZDAnlPRwJ4viFg30WyRvcCfEMCeswCfQ0CfPRIBEiBZygALxlJXEpfGRtK0ALRBQLQ0EsrA4hTA4fqRMmRNgLypV0HAwOyS9JMMSkH001QTbMCi0MCitzFHwshR2sJuwKOOwKOYESbhQKO3QKOYHxRuFM5AQ5S2FSJApP/ApMQAO0AIFUiVbNV1AosHymZijLleGpFPz0Cl6MC77ZYJawAXSkClpMCloCgAK1ZsFoNhVEAPwKWuQKWUlxIXNUCmc8CmWhczl0LHQKcnznGOqECnBoCn58CnryOACETNS4TAp31Ap6WALlBYThh8wKe1wKgcgGtAp6jIwKeUqljzGQrKS8CJ7MCJoICoP8CoFDbAqYzAqXSAqgDAIECp/ZogGi1AAdNaiBq1QKs5wKssgKtawKtBgJXIQJV4AKx5dsDH1JsmwKywRECsuwbbORtZ21MYwMl0QK2YD9DbpQDKUkCuGICuUsZArkue3A6cOUCvR0DLbYDMhUCvoxyBgMzdQK+HnMmc1MCw88CwwhzhnRPOUl05AM8qwEDPJ4DPcMCxYACxksCxhSNAshtVQLISALJUwLJMgJkoQLd1nh9ZXiyeSlL1AMYp2cGAmH4GfeVKHsPXpZevxUCz28Cz3AzT1fW9xejAMqxAs93AS3uA04Wfk8JAtwrAtuOAtJTA1JgA1NjAQUDVZCAjUMEzxrxZEl5A4LSg5EC2ssC2eKEFIRNp0ADhqkAMwNkEoZ1Xf0AWQLfaQLevHd7AuIz7RgB8zQrAfSfAfLWiwLr9wLpdH0DAur9AuroAP1LAb0C7o0C66CWrpcHAu5DA4XkmH1w5HGlAvMHAG0DjhqZlwL3FwORcgOSiwL3nAL53QL4apogmq+/O5siA52HAv7+AR8APZ8gAZ+3AwWRA6ZuA6bdANXJAwZuoYyiCQ0DDE0BEwEjB3EGZb1rCQC/BG/DFY8etxEAG3k9ACcDNxJRA42DAWcrJQCM8wAlAOanC6OVCLsGI6fJBgCvBRnDBvElRUYFFoAFcD9GSDNCKUK8X3kZX8QAls0FOgCQVCGbwTsuYDoZutcONxjOGJHJ/gVfBWAFXwVgBWsFYAVfBWAFXwVgBV8FYAVfBWBOHQjfjW8KCgoKbF7xMwTRA7kGN8PDAMMEr8MA70gxFroFTj5xPnhCR0K+X30/X/AAWBkzswCNBsxzzASm70aCRS4rDDMeLz49fnXfcsH5GcoscQFz13Y4HwVnBXLJycnACNdRYwgICAqEXoWTxgA7P4kACxbZBu21Kw0AjMsTAwkVAOVtJUUsJ1JCuULESUArXy9gPi9AKwnJRQYKTD9LPoA+iT54PnkCkULEUUpDX9NWV3JVEjQAc1w3A3IBE3YnX+g7QiMJb6MKaiszRCUuQrNCxDPMCcwEX9EWJzYREBEEBwIHKn6l33JCNVIfybPJtAltydPUCmhBZw/tEKsZAJOVJU1CLRuxbUHOQAo7P0s+eEJHHA8SJVRPdGM0NVrpvBoKhfUlM0JHHGUQUhEWO1xLSj8MO0ucNAqJIzVCRxv9EFsqKyA4OQgNj2nwZgp5ZNFgE2A1K3YHS2AhQQojJmC7DgpzGG1WYFUZCQYHZO9gHWCdYIVgu2BTYJlwFh8GvRbcXbG8YgtDHrMBwzPVyQonHQgkCyYBgQJ0Ajc4nVqIAwGSCsBPIgDsK3SWEtIVBa5N8gGjAo+kVwVIZwD/AEUSCDweX4ITrRQsJ8K3TwBXFDwEAB0TvzVcAtoTS20RIwDgVgZ9BBImYgA5AL4Coi8LFnezOkCnIQFjAY4KBAPh9RcGsgZSBsEAJctdsWIRu2kTkQstRw7DAcMBKgpPBGIGMDAwKCYnKTQaLg4AKRSVAFwCdl+YUZ0JdicFD3lPAdt1F9ZZKCGxuE3yBxkFVGcA/wBFEgiCBwAOLHQSjxOtQDg1z7deFRMAZ8QTAGtKb1ApIiPHADkAvgKiLy1DFtYCmBiDAlDDWNB0eo7fpaMO/aEVRRv0ATEQZBIODyMEAc8JQhCbDRgzFD4TAEMAu9YBCgCsAOkAm5I3ABwAYxvONnR+MhXJAxgKQyxL2+kkJhMbhQKDBMkSsvF0AD9BNQ6uQC7WqSQHwxEAEEIu1hkhAH2z4iQPwyJPHNWpdyYBRSpnJALzoBAEVPPsH20MxA0CCEQKRgAFyAtFAlMNwwjEDUQJRArELtapMg7DDZgJIw+TGukEIwvDFkMAqAtDEMMMBhioe+QAO3MMRAACrgnEBSPY9Q0FDnbSBoMAB8MSYxkSxAEJAPIJAAB8FWMOFtMc/HcXwxhDAC7DAvOowwAewwJdKDKHAAHDAALrFUQVwwAbwyvzpWMWv8wA/ABpAy++bcYDUKPD0KhDCwKmJ1MAAmMA5+UZwxAagwipBRL/eADfw6fDGOMCGsOjk3l6BwOpo4sAEsMOGxMAA5sAbcMOAAvDp0MJGkMDwgipnNIPAwfIqUMGAOGDAAPzABXDAAcDAAnDAGmTABrDAA7DChjDjnEWAwABYwAOcwAuUyYABsMAF8MIKQANUgC6wy4AA8MADqMq8wCyYgAcIwAB8wqpAAXOCx0V4wAHowBCwwEKAGnDAAuDAB3DAAjDCakABdIAbqcZ3QCZCCkABdIAAAFDAAfjAB2jCCkABqIACYMAGzMAbSMA5sOIAAhjAAhDABTDBAkpAAbSAOOTAAlDC6kOzPtnAAdDAG6kQFAATwAKwwwAA0MACbUDPwAHIwAZgwACE6cDAAojAApDAAoDp/MGwwAJIwADEwAQQwgAFEMAEXMAD5MADfMADcMAGRMOFiMAFUMAbqMWuwHDAMIAE0MLAGkzEgDhUwACQwAEWgAXgwUjAAbYABjDBSYBgzBaAEFNALcQBxUMegAwMngBrA0IZgJ0KxQHBREPd1N0ZzKRJwaIHAZqNT4DqQq8BwngAB4DAwt2AX56T1ocKQNXAh1GATQGC3tOxYNagkgAMQA5CQADAQEAWxLjAIOYNAEzAH7tFRk6TglSAF8NAAlYAQ+S1ACAQwQorQBiAN4dAJ1wPyeTANVzuQDX3AIeEMp9eyMgXiUAEdkBkJizKltbVVAaRMqRAAEAhyQ/SDEz6BmfVwB6ATEsOClKIRcDOF0E/832AFNt5AByAnkCRxGCOs94NjXdAwINGBonDBwPALW2AwICAgAAAAAAAAYDBQMDARrUAwAtAAAAAgEGBgYGBgYFBQUFBQUEBQYHCAkEBQUFBQQAAAICAAAAIgCNAJAAlT0A6gC7ANwApEQAwgCyAK0AqADuAKYA2gCjAOcBCAEDAMcAgQBiANIA1AEDAN4A8gCQAKkBMQDqAN8A3AsBCQ8yO9ra2tq8xuLT1tRJOB0BUgFcNU0BWgFpAWgBWwFMUUlLbhMBUxsNEAs6PhMOACcUKy0vMj5AQENDQ0RFFEYGJFdXV1dZWVhZL1pbXVxcI2NnZ2ZoZypsbnZ1eHh4eHh4enp6enp6enp6enp8fH18e2IARPIASQCaAHgAMgBm+ACOAFcAVwA3AnbvAIsABfj4AGQAk/IAnwBPAGIAZP//sACFAIUAaQBWALEAJAC2AIMCQAJDAPwA5wD+AP4A6AD/AOkA6QDoAOYALwJ7AVEBQAE+AVQBPgE+AT4BOQE4ATgBOAEcAVgXADEQCAEAUx8SHgsdHhYAjgCWAKYAUQBqIAIxAHYAbwCXAxUDJzIDIUlGTzEAkQJPAMcCVwKkAMAClgKWApYClgKWApYCiwKWApYClgKWApYClgKVApUCmAKgApcClgKWApQClAKUApQCkgKVAnUB1AKXAp8ClgKWApUeAIETBQD+DQOfAmECOh8BVBg9AuIZEjMbAU4/G1WZAXusRAFpYQEFA0FPAQYAmTEeIJdyADFoAHEANgCRA5zMk/C2jGINwjMWygIZCaXdfDILBCs5dAE7YnQBugDlhoiHhoiGiYqKhouOjIaNkI6Ij4qQipGGkoaThpSSlYaWhpeKmIaZhpqGm4aci52QnoqfhuIC4XTpAt90AIp0LHSoAIsAdHQEQwRABEIERQRDBEkERgRBBEcESQRIBEQERgRJAJ5udACrA490ALxuAQ10ANFZdHQA13QCFHQA/mJ0AP4BIQD+APwA/AD9APwDhGZ03ASMK23HAP4A/AD8AP0A/CR0dACRYnQA/gCRASEA/gCRAvQA/gCRA4RmdNwEjCttxyR0AP9idAEhAP4A/gD8APwA/QD8AP8A/AD8AP0A/AOEZnTcBIwrbcckdHQAkWJ0ASEA/gCRAP4AkQL0AP4AkQOEZnTcBIwrbcckdAJLAT50AlIBQXQCU8l0dAJfdHQDpgL0A6YDpgOnA6cDpwOnA4RmdNwEjCttxyR0dACRYnQBIQOmAJEDpgCRAvQDpgCRA4RmdNwEjCttxyR0BDh0AJEEOQCRDpU5dSgCADR03gV2CwArdAEFAM5iCnR0AF1iAAYcOgp0dACRCnQAXAEIwWZ0CnRmdHQAkWZ0CnRmdEXgAFF03gp0dEY0tlT2u3SOAQTwscwhjZZKrhYcBSfFp9XNbKiVDOD2b+cpe4/Z17mQnbtzzhaeQtE2GGj0IDNTjRUSyTxxw/RPHW/+vS7d1NfRt9z9QPZg4X7QFfhCnkvgNPIItOsC2eV6hPannZNHlZ9xrwZXIMOlu3jSoQSq78WEjwLjw1ELSlF1aBvfzwk5ZX7AUvQzjPQKbDuQ+sm4wNOp4A6AdVuRS0t1y/DZpg4R6m7FNjM9HgvW7Bi88zaMjOo6lM8wtBBdj8LP4ylv3zCXPhebMKJc066o9sF71oFW/8JXu86HJbwDID5lzw5GWLR/LhT0Qqnp2JQxNZNfcbLIzPy+YypqRm/lBmGmex+82+PisxUumSeJkALIT6rJezxMH+CTJmQtt5uwTVbL3ptmjDUQzlSIvWi8Tl7ng1NpuRn1Ng4n14Qc+3Iil7OwkvNWogLSPkn3pihIFytyIGmMhOe3n1tWsuMy9BdKyqF4Z3v2SgggTL9KVvMXPnCbRe+oOuFFP3HejBG/w9gvmfNYvg6JuWia2lcSSN1uIjBktzoIazOHPJZ7kKHPz8mRWVdW3lA8WGF9dQF6Bm673boov3BUWDU2JNcahR23GtfHKLOz/viZ+rYnZFaIznXO67CYEJ1fXuTRpZhYZkKe54xeoagkNGLs+NTZHE0rX45/XvQ2RGADX6vcAvdxIUBV27wxGm2zjZo4X3ILgAlrOFheuZ6wtsvaIj4yLY7qqawlliaIcrz2G+c3vscAnCkCuMzMmZvMfu9lLwTvfX+3cVSyPdN9ZwgDZhfjRgNJcLiJ67b9xx8JHswprbiE3v9UphotAPIgnXVIN5KmMc0piXhc6cChPnN+MRhG9adtdttQTTwSIpl8I4/j//d3sz1326qTBTpPRM/Hgh3kzqEXs8ZAk4ErQhNO8hzrQ0DLkWMA/N+91tn2MdOJnWC2FCZehkQrwzwbKOjhvZsbM95QoeL9skYyMf4srVPVJSgg7pOLUtr/n9eT99oe9nLtFRpjA9okV2Kj8h9k5HaC0oivRD8VyXkJ81tcd4fHNXPCfloIQasxsuO18/46dR2jgul/UIet2G0kRvnyONMKhHs6J26FEoqSqd+rfYjeEGwHWVDpX1fh1jBBcKGMqRepju9Y00mDVHC+Xdij/j44rKfvfjGinNs1jO/0F3jB83XCDINN/HB84axlP+3E/klktRo+vl3U/aiyMJbIodE1XSsDn6UAzIoMtUObY2+k/4gY/l+AkZJ5Sj2vQrkyLm3FoxjhDX+31UXBFf9XrAH31fFqoBmDEZvhvvpnZ87N+oZEu7U9O/nnk+QWj3x8uyoRbEnf+O5UMr9i0nHP38IF5AvzrBW8YWBUR0mIAzIvndQq9N3v/Jto3aPjPXUPl8ASdPPyAp7jENf8bk7VMM9ol9XGmlBmeDMuGqt+WzuL6CXAxXjIhCPM5vACchgMJ/8XBGLO/D1isVvGhwwHHr1DLaI5mn2Jr/b1pUD90uciDaS8cXNDzCWvNmT/PhQe5e8nTnnnkt8Ds/SIjibcum/fqDhKopxAY8AkSrPn+IGDEKOO+U3XOP6djFs2H5N9+orhOahiQk5KnEUWa+CzkVzhp8bMHRbg81qhjjXuIKbHjSLSIBKWqockGtKinY+z4/RdBUF6pcc3JmnlxVcNgrI4SEzKUZSwcD2QCyxzKve+gAmg6ZuSRkpPFa6mfThu7LJNu3H5K42uCpNvPAsoedolKV/LHe/eJ+BbaG5MG0NaSGVPRUmNFMFFSSpXEcXwbVh7UETOZZtoVNRGOIbbkig3McEtR68cG0RZAoJevWYo7Dg/lZ1CQzblWeUvVHmr8fY4Nqd9JJiH/zEX24mJviH60fAyFr0A3c4bC1j3yZU60VgJxXn8JgJXLUIsiBnmKmMYz+7yBQFBvqb2eYnuW59joZBf56/wXvWIR4R8wTmV80i1mZy+S4+BUES+hzjk0uXpC///z/IlqHZ1monzlXp8aCfhGKMti73FI1KbL1q6IKO4fuBuZ59gagjn5xU79muMpHXg6S+e+gDM/U9BKLHbl9l6o8czQKl4RUkJJiqftQG2i3BMg/TQlUYFkJDYBOOvAugYuzYSDnZbDDd/aSd9x0Oe6F+bJcHfl9+gp6L5/TgA+BdFFovbfCrQ40s5vMPw8866pNX8zyFGeFWdxIpPVp9Rg1UPOVFbFZrvaFq/YAzHQgqMWpahMYfqHpmwXfHL1/kpYmGuHFwT55mQu0dylfNuq2Oq0hTMCPwqfxnuBIPLXfci4Y1ANy+1CUipQxld/izVh16WyG2Q0CQQ9NqtAnx1HCHwDj7sYxOSB0wopZSnOzxQOcExmxrVTF2BkOthVpGfuhaGECfCJpJKpjnihY+xOT2QJxN61+9K6QSqtv2Shr82I3jgJrqBg0wELFZPjvHpvzTtaJnLK6Vb97Yn933koO/saN7fsjwNKzp4l2lJVx2orjCGzC/4ZL4zCver6aQYtC5sdoychuFE6ufOiog+VWi5UDkbmvmtah/3aArEBIi39s5ILUnlFLgilcGuz9CQshEY7fw2ouoILAYPVT/gyAIq3TFAIwVsl+ktkRz/qGfnCDGrm5gsl/l9QdvCWGsjPz3dU7XuqKfdUrr/6XIgjp4rey6AJBmCmUJMjITHVdFb5m1p+dLMCL8t55zD42cmftmLEJC0Da04YiRCVUBLLa8D071/N5UBNBXDh0LFsmhV/5B5ExOB4j3WVG/S3lfK5o+V6ELHvy6RR9n4ac+VsK4VE4yphPvV+kG9FegTBH4ZRXL2HytUHCduJazB/KykjfetYxOXTLws267aGOd+I+JhKP//+VnXmS90OD/jvLcVu0asyqcuYN1mSb6XTlCkqv1vigZPIYwNF/zpWcT1GR/6aEIRjkh0yhg4LXJfaGobYJTY4JI58KiAKgmmgAKWdl5nYCeLqavRJGQNuYuZtZFGx+IkI4w4NS2xwbetNMunOjBu/hmKCI/w7tfiiyUd//4rbTeWt4izBY8YvGIN6vyKYmP/8X8wHKCeN+WRcKM70+tXKNGyevU9H2Dg5BsljnTf8YbsJ1TmMs74Ce2XlHisleguhyeg44rQOHZuw/6HTkhnnurK2d62q6yS7210SsAIaR+jXMQA+svkrLpsUY+F30Uw89uOdGAR6vo4FIME0EfVVeHTu6eKicfhSqOeXJhbftcd08sWEnNUL1C9fnprTgd83IMut8onVUF0hvqzZfHduPjbjwEXIcoYmy+P6tcJZHmeOv6VrvEdkHDJecjHuHeWANe79VG662qTjA/HCvumVv3qL+LrOcpqGps2ZGwQdFJ7PU4iuyRlBrwfO+xnPyr47s2cXVbWzAyznDiBGjCM3ksxjjqM62GE9C8f5U38kB3VjtabKp/nRdvMESPGDG90bWRLAt1Qk5DyLuazRR1YzdC1c+hZXvAWV8xA72S4A8B67vjVhbba3MMop293FeEXpe7zItMWrJG/LOH9ByOXmYnNJfjmfuX9KbrpgLOba4nZ+fl8Gbdv/ihv+6wFGKHCYrVwmhFC0J3V2bn2tIB1wCc1CST3d3X2OyxhguXcs4sm679UngzofuSeBewMFJboIQHbUh/m2JhW2hG9DIvG2t7yZIzKBTz9wBtnNC+2pCRYhSIuQ1j8xsz5VvqnyUIthvuoyyu7fNIrg/KQUVmGQaqkqZk/Vx5b33/gsEs8yX7SC1J+NV4icz6bvIE7C5G6McBaI8rVg56q5QBJWxn/87Q1sPK4+sQa8fLU5gXo4paaq4cOcQ4wR0VBHPGjKh+UlPCbA1nLXyEUX45qZ8J7/Ln4FPJE2TdzD0Z8MLSNQiykMMmSyOCiFfy84Rq60emYB2vD09KjYwsoIpeDcBDTElBbXxND72yhd9pC/1CMid/5HUMvAL27OtcIJDzNKpRPNqPOpyt2aPGz9QWIs9hQ9LiX5s8m9hjTUu/f7MyIatjjd+tSfQ3ufZxPpmJhTaBtZtKLUcfOCUqADuO+QoH8B9v6U+P0HV1GLQmtoNFTb3s74ivZgjES0qfK+8RdGgBbcCMSy8eBvh98+et1KIFqSe1KQPyXULBMTsIYnysIwiZBJYdI20vseV+wuJkcqGemehKjaAb9L57xZm3g2zX0bZ2xk/fU+bCo7TlnbW7JuF1YdURo/2Gw7VclDG1W7LOtas2LX4upifZ/23rzpsnY/ALfRgrcWP5hYmV9VxVOQA1fZvp9F2UNU+7d7xRyVm5wiLp3/0dlV7vdw1PMiZrbDAYzIVqEjRY2YU03sJhPnlwIPcZUG5ltL6S8XCxU1eYS5cjr34veBmXAvy7yN4ZjArIG0dfD/5UpBNlX1ZPoxJOwyqRi3wQWtOzd4oNKh0LkoTm8cwqgIfKhqqGOhwo71I+zXnMemTv2B2AUzABWyFztGgGULjDDzWYwJUVBTjKCn5K2QGMK1CQT7SzziOjo+BhAmqBjzuc3xYym2eedGeOIRJVyTwDw37iCMe4g5Vbnsb5ZBdxOAnMT7HU4DHpxWGuQ7GeiY30Cpbvzss55+5Km1YsbD5ea3NI9QNYIXol5apgSu9dZ8f8xS5dtHpido5BclDuLWY4lhik0tbJa07yJhH0BOyEut/GRbYTS6RfiTYWGMCkNpfSHi7HvdiTglEVHKZXaVhezH4kkXiIvKopYAlPusftpE4a5IZwvw1x/eLvoDIh/zpo9FiQInsTb2SAkKHV42XYBjpJDg4374XiVb3ws4qM0s9eSQ5HzsMU4OZJKuopFjBM+dAZEl8RUMx5uU2N486Kr141tVsGQfGjORYMCJAMsxELeNT4RmWjRcpdTGBwcx6XN9drWqPmJzcrGrH4+DRc7+n1w3kPZwu0BkNr6hQrqgo7JTB9A5kdJ/H7P4cWBMwsmuixAzJB3yrQpnGIq90lxAXLzDCdn1LPibsRt7rHNjgQBklRgPZ8vTbjXdgXrTWQsK5MdrXXQVPp0Rinq3frzZKJ0qD6Qhc40VzAraUXlob1gvkhK3vpmHgI6FRlQZNx6eRqkp0zy4AQlX813fAPtL3jMRaitGFFjo0zmErloC+h+YYdVQ6k4F/epxAoF0BmqEoKNTt6j4vQZNQ2BoqF9Vj53TOIoNmDiu9Xp15RkIgQIGcoLpfoIbenzpGUAtqFJp5W+LLnx38jHeECTJ/navKY1NWfN0sY1T8/pB8kIH3DU3DX+u6W3YwpypBMYOhbSxGjq84RZ84fWJow8pyHqn4S/9J15EcCMsXqrfwyd9mhiu3+rEo9pPpoJkdZqHjra4NvzFwuThNKy6hao/SlLw3ZADUcUp3w3SRVfW2rhl80zOgTYnKE0Hs2qp1J6H3xqPqIkvUDRMFDYyRbsFI3M9MEyovPk8rlw7/0a81cDVLmBsR2ze2pBuKb23fbeZC0uXoIvDppfTwIDxk1Oq2dGesGc+oJXWJLGkOha3CX+DUnzgAp9HGH9RsPZN63Hn4RMA5eSVhPHO+9RcRb/IOgtW31V1Q5IPGtoxPjC+MEJbVlIMYADd9aHYWUIQKopuPOHmoqSkubnAKnzgKHqgIOfW5RdAgotN6BN+O2ZYHkuemLnvQ8U9THVrS1RtLmKbcC7PeeDsYznvqzeg6VCNwmr0Yyx1wnLjyT84BZz3EJyCptD3yeueAyDWIs0L2qs/VQ3HUyqfrja0V1LdDzqAikeWuV4sc7RLIB69jEIBjCkyZedoUHqCrOvShVzyd73OdrJW0hPOuQv2qOoHDc9xVb6Yu6uq3Xqp2ZaH46A7lzevbxQEmfrzvAYSJuZ4WDk1Hz3QX1LVdiUK0EvlAGAYlG3Md30r7dcPN63yqBCIj25prpvZP0nI4+EgWoFG95V596CurXpKRBGRjQlHCvy5Ib/iW8nZJWwrET3mgd6mEhfP4KCuaLjopWs7h+MdXFdIv8dHQJgg1xi1eYqB0uDYjxwVmri0Sv5XKut/onqapC+FQiC2C1lvYJ9MVco6yDYsS3AANUfMtvtbYI2hfwZatiSsnoUeMZd34GVjkMMKA+XnjJpXgRW2SHTZplVowPmJsvXy6w3cfO1AK2dvtZEKTkC/TY9LFiKHCG0DnrMQdGm2lzlBHM9iEYynH2UcVMhUEjsc0oDBTgo2ZSQ1gzkAHeWeBXYFjYLuuf8yzTCy7/RFR81WDjXMbq2BOH5dURnxo6oivmxL3cKzKInlZkD31nvpHB9Kk7GfcfE1t+1V64b9LtgeJGlpRFxQCAqWJ5DoY77ski8gsOEOr2uywZaoO/NGa0X0y1pNQHBi3b2SUGNpcZxDT7rLbBf1FSnQ8guxGW3W+36BW0gBje4DOz6Ba6SVk0xiKgt+q2JOFyr4SYfnu+Ic1QZYIuwHBrgzr6UvOcSCzPTOo7D6IC4ISeS7zkl4h+2VoeHpnG/uWR3+ysNgPcOIXQbv0n4mr3BwQcdKJxgPSeyuP/z1Jjg4e9nUvoXegqQVIE30EHx5GHv+FAVUNTowYDJgyFhf5IvlYmEqRif6+WN1MkEJmDcQITx9FX23a4mxy1AQRsOHO/+eImX9l8EMJI3oPWzVXxSOeHU1dUWYr2uAA7AMb+vAEZSbU3qob9ibCyXeypEMpZ6863o6QPqlqGHZkuWABSTVNd4cOh9hv3qEpSx2Zy/DJMP6cItEmiBJ5PFqQnDEIt3NrA3COlOSgz43D7gpNFNJ5MBh4oFzhDPiglC2ypsNU4ISywY2erkyb1NC3Qh/IfWj0eDgZI4/ln8WPfBsT3meTjq1Uqt1E7Zl/qftqkx6aM9KueMCekSnMrcHj1CqTWWzEzPsZGcDe3Ue4Ws+XFYVxNbOFF8ezkvQGR6ZOtOLU2lQEnMBStx47vE6Pb7AYMBRj2OOfZXfisjJnpTfSNjo6sZ6qSvNxZNmDeS7Gk3yYyCk1HtKN2UnhMIjOXUzAqDv90lx9O/q/AT1ZMnit5XQe9wmQxnE/WSH0CqZ9/2Hy+Sfmpeg8RwsHI5Z8kC8H293m/LHVVM/BA7HaTJYg5Enk7M/xWpq0192ACfBai2LA/qrCjCr6Dh1BIMzMXINBmX96MJ5Hn2nxln/RXPFhwHxUmSV0EV2V0jm86/dxxuYSU1W7sVkEbN9EzkG0QFwPhyHKyb3t+Fj5WoUUTErcazE/N6EW6Lvp0d//SDPj7EV9UdJN+Amnf3Wwk3A0SlJ9Z00yvXZ7n3z70G47Hfsow8Wq1JXcfwnA+Yxa5mFsgV464KKP4T31wqIgzFPd3eCe3j5ory5fBF2hgCFyVFrLzI9eetNXvM7oQqyFgDo4CTp/hDV9NMX9JDHQ/nyHTLvZLNLF6ftn2OxjGm8+PqOwhxnPHWipkE/8wbtyri80Sr7pMNkQGMfo4ZYK9OcCC4ESVFFbLMIvlxSoRqWie0wxqnLfcLSXMSpMMQEJYDVObYsXIQNv4TGNwjq1kvT1UOkicTrG3IaBZ3XdScS3u8sgeZPVpOLkbiF940FjbCeNRINNvDbd01EPBrTCPpm12m43ze1bBB59Ia6Ovhnur/Nvx3IxwSWol+3H2qfCJR8df6aQf4v6WiONxkK+IqT4pKQrZK/LplgDI/PJZbOep8dtbV7oCr6CgfpWa8NczOkPx81iSHbsNhVSJBOtrLIMrL31LK9TqHqAbAHe0RLmmV806kRLDLNEhUEJfm9u0sxpkL93Zgd6rw+tqBfTMi59xqXHLXSHwSbSBl0EK0+loECOPtrl+/nsaFe197di4yUgoe4jKoAJDXc6DGDjrQOoFDWZJ9HXwt8xDrQP+7aRwWKWI1GF8s8O4KzxWBBcwnl3vnl1Oez3oh6Ea1vjR7/z7DDTrFtqU2W/KAEzAuXDNZ7MY73MF216dzdSbWmUp4lcm7keJfWaMHgut9x5C9mj66Z0lJ+yhsjVvyiWrfk1lzPOTdhG15Y7gQlXtacvI7qv/XNSscDwqkgwHT/gUsD5yB7LdRRvJxQGYINn9hTpodKFVSTPrtGvyQw+HlRFXIkodErAGu9Iy1YpfSPc3jkFh5CX3lPxv7aqjE/JAfTIpEjGb/H7MO0e2vsViSW1qa/Lmi4/n4DEI3g7lYrcanspDfEpKkdV1OjSLOy0BCUqVoECaB55vs06rXl4jqmLsPsFM/7vYJ0vrBhDCm/00A/H81l1uekJ/6Lml3Hb9+NKiLqATJmDpyzfYZFHumEjC662L0Bwkxi7E9U4cQA0XMVDuMYAIeLMPgQaMVOd8fmt5SflFIfuBoszeAw7ow5gXPE2Y/yBc/7jExARUf/BxIHQBF5Sn3i61w4z5xJdCyO1F1X3+3ax+JSvMeZ7S6QSKp1Fp/sjYz6Z+VgCZzibGeEoujryfMulH7Rai5kAft9ebcW50DyJr2uo2z97mTWIu45YsSnNSMrrNUuG1XsYBtD9TDYzQffKB87vWbkM4EbPAFgoBV4GQS+vtFDUqOFAoi1nTtmIOvg38N4hT2Sn8r8clmBCXspBlMBYTnrqFJGBT3wZOzAyJDre9dHH7+x7qaaKDOB4UQALD5ecS0DE4obubQEiuJZ0EpBVpLuYcce8Aa4PYd/V4DLDAJBYKQPCWTcrEaZ5HYbJi11Gd6hjGom1ii18VHYnG28NKpkz2UKVPxlhYSp8uZr367iOmoy7zsxehW9wzcy2zG0a80PBMCRQMb32hnaHeOR8fnNDzZhaNYhkOdDsBUZ3loDMa1YP0uS0cjUP3b/6DBlqmZOeNABDsLl5BI5QJups8uxAuWJdkUB/pO6Zax6tsg7fN5mjjDgMGngO+DPcKqiHIDbFIGudxtPTIyDi9SFMKBDcfdGQRv41q1AqmxgkVfJMnP8w/Bc7N9/TR6C7mGObFqFkIEom8sKi2xYqJLTCHK7cxzaZvqODo22c3wisBCP4HeAgcRbNPAsBkNRhSmD48dHupdBRw4mIvtS5oeF6zeT1KMCyhMnmhpkFAGWnGscoNkwvQ8ZM5lE/vgTHFYL99OuNxdFBxTEDd5v2qLR8y9WkXsWgG6kZNndFG+pO/UAkOCipqIhL3hq7cRSdrCq7YhUsTocEcnaFa6nVkhnSeRYUA1YO0z5itF9Sly3VlxYDw239TJJH6f3EUfYO5lb7bcFcz8Bp7Oo8QmnsUHOz/fagVUBtKEw1iT88j+aKkv8cscKNkMxjYr8344D1kFoZ7/td1W6LCNYN594301tUGRmFjAzeRg5vyoM1F6+bJZ/Q54jN/k8SFd3DxPTYaAUsivsBfgTn7Mx8H2SpPt4GOdYRnEJOH6jHM2p6SgB0gzIRq6fHxGMmSmqaPCmlfwxiuloaVIitLGN8wie2CDWhkzLoCJcODh7KIOAqbHEvXdUxaS4TTTs07Clzj/6GmVs9kiZDerMxEnhUB6QQPlcfqkG9882RqHoLiHGBoHfQuXIsAG8GTAtao2KVwRnvvam8jo1e312GQAKWEa4sUVEAMG4G6ckcONDwRcg1e2D3+ohXgY4UAWF8wHKQMrSnzCgfFpsxh+aHXMGtPQroQasRY4U6UdG0rz1Vjbka0MekOGRZQEvqQFlxseFor8zWFgHek3v29+WqN6gaK5gZOTOMZzpQIC1201LkMCXild3vWXSc5UX9xcFYfbRPzGFa1FDcPfPB/jUEq/FeGt419CI3YmBlVoHsa4KdcwQP5ZSwHHhFJ7/Ph/Rap/4vmG91eDwPP0lDfCDRCLszTqfzM71xpmiKi2HwS4WlqvGNwtvwF5Dqpn6KTq8ax00UMPkxDcZrEEEsIvHiUXXEphdb4GB4FymlPwBz4Gperqq5pW7TQ6/yNRhW8VT5NhuP0udlxo4gILq5ZxAZk8ZGh3g4CqxJlPKY7AQxupfUcVpWT5VItp1+30UqoyP4wWsRo3olRRgkWZZ2ZN6VC3OZFeXB8NbnUrSdikNptD1QiGuKkr8EmSR/AK9Rw+FF3s5uwuPbvHGiPeFOViltMK7AUaOsq9+x9cndk3iJEE5LKZRlWJbKOZweROzmPNVPkjE3K/TyA57Rs68TkZ3MR8akKpm7cFjnjPd/DdkWjgYoKHSr5Wu5ssoBYU4acRs5g2DHxUmdq8VXOXRbunD8QN0LhgkssgahcdoYsNvuXGUK/KXD/7oFb+VGdhqIn02veuM5bLudJOc2Ky0GMaG4W/xWBxIJcL7yliJOXOpx0AkBqUgzlDczmLT4iILXDxxtRR1oZa2JWFgiAb43obrJnG/TZC2KSK2wqOzRZTXavZZFMb1f3bXvVaNaK828w9TO610gk8JNf3gMfETzXXsbcvRGCG9JWQZ6+cDPqc4466Yo2RcKH+PILeKOqtnlbInR3MmBeGG3FH10yzkybuqEC2HSQwpA0An7d9+73BkDUTm30bZmoP/RGbgFN+GrCOfADgqr0WbI1a1okpFms8iHYw9hm0zUvlEMivBRxModrbJJ+9/p3jUdQQ9BCtQdxnOGrT5dzRUmw0593/mbRSdBg0nRvRZM5/E16m7ZHmDEtWhwvfdZCZ8J8M12W0yRMszXamWfQTwIZ4ayYktrnscQuWr8idp3PjT2eF/jmtdhIfcpMnb+IfZY2FebW6UY/AK3jP4u3Tu4zE4qlnQgLFbM19EBIsNf7KhjdbqQ/D6yiDb+NlEi2SKD+ivXVUK8ib0oBo366gXkR8ZxGjpJIDcEgZPa9TcYe0TIbiPl/rPUQDu3XBJ9X/GNq3FAUsKsll57DzaGMrjcT+gctp+9MLYXCq+sqP81eVQ0r9lt+gcQfZbACRbEjvlMskztZG8gbC8Qn9tt26Q7y7nDrbZq/LEz7kR6Jc6pg3N9rVX8Y5MJrGlML9p9lU4jbTkKqCveeZUJjHB03m2KRKR2TytoFkTXOLg7keU1s1lrPMQJpoOKLuAAC+y1HlJucU6ysB5hsXhvSPPLq5J7JtnqHKZ4vYjC4Vy8153QY+6780xDuGARsGbOs1WqzH0QS765rnSKEbbKlkO8oI/VDwUd0is13tKpqILu1mDJFNy/iJAWcvDgjxvusIT+PGz3ST/J9r9Mtfd0jpaGeiLYIqXc7DiHSS8TcjFVksi66PEkxW1z6ujbLLUGNNYnzOWpH8BZGK4bCK7iR+MbIv8ncDAz1u4StN3vTTzewr9IQjk9wxFxn+6N1ddKs0vffJiS08N3a4G1SVrlZ97Q/M+8G9fe5AP6d9/Qq4WRnORVhofPIKEdCr3llspUfE0oKIIYoByBRPh+bX1HLS3JWGJRhIvE1aW4NTd8ePi4Z+kXb+Z8snYfSNcqijhAgVsx4RCM54cXUiYkjeBmmC4ajOHrChoELscJJC7+9jjMjw5BagZKlgRMiSNYz7h7vvZIoQqbtQmspc0cUk1G/73iXtSpROl5wtLgQi0mW2Ex8i3WULhcggx6E1LMVHUsdc9GHI1PH3U2Ko0PyGdn9KdVOLm7FPBui0i9a0HpA60MsewVE4z8CAt5d401Gv6zXlIT5Ybit1VIA0FCs7wtvYreru1fUyW3oLAZ/+aTnZrOcYRNVA8spoRtlRoWflsRClFcgzkqiHOrf0/SVw+EpVaFlJ0g4Kxq1MMOmiQdpMNpte8lMMQqm6cIFXlnGbfJllysKDi+0JJMotkqgIxOSQgU9dn/lWkeVf8nUm3iwX2Nl3WDw9i6AUK3vBAbZZrcJpDQ/N64AVwjT07Jef30GSSmtNu2WlW7YoyW2FlWfZFQUwk867EdLYKk9VG6JgEnBiBxkY7LMo4YLQJJlAo9l/oTvJkSARDF/XtyAzM8O2t3eT/iXa6wDN3WewNmQHdPfsxChU/KtLG2Mn8i4ZqKdSlIaBZadxJmRzVS/o4yA65RTSViq60oa395Lqw0pzY4SipwE0SXXsKV+GZraGSkr/RW08wPRvqvSUkYBMA9lPx4m24az+IHmCbXA+0faxTRE9wuGeO06DIXa6QlKJ3puIyiuAVfPr736vzo2pBirS+Vxel3TMm3JKhz9o2ZoRvaFVpIkykb0Hcm4oHFBMcNSNj7/4GJt43ogonY2Vg4nsDQIWxAcorpXACzgBqQPjYsE/VUpXpwNManEru4NwMCFPkXvMoqvoeLN3qyu/N1eWEHttMD65v19l/0kH2mR35iv/FI+yjoHJ9gPMz67af3Mq/BoWXqu3rphiWMXVkmnPSEkpGpUI2h1MThideGFEOK6YZHPwYzMBvpNC7+ZHxPb7epfefGyIB4JzO9DTNEYnDLVVHdQyvOEVefrk6Uv5kTQYVYWWdqrdcIl7yljwwIWdfQ/y+2QB3eR/qxYObuYyB4gTbo2in4PzarU1sO9nETkmj9/AoxDA+JM3GMqQtJR4jtduHtnoCLxd1gQUscHRB/MoRYIEsP2pDZ9KvHgtlk1iTbWWbHhohwFEYX7y51fUV2nuUmnoUcqnWIQAAgl9LTVX+Bc0QGNEhChxHR4YjfE51PUdGfsSFE6ck7BL3/hTf9jLq4G1IafINxOLKeAtO7quulYvH5YOBc+zX7CrMgWnW47/jfRsWnJjYYoE7xMfWV2HN2iyIqLI';
const FENCED = new Map([
    [
        8217,
        "apostrophe"
    ],
    [
        8260,
        "fraction slash"
    ],
    [
        12539,
        "middle dot"
    ]
]);
const NSM_MAX = 4;
function decode_arithmetic(bytes) {
    let pos = 0;
    function u16() {
        return bytes[pos++] << 8 | bytes[pos++];
    }
    // decode the frequency table
    let symbol_count = u16();
    let total = 1;
    let acc = [
        0,
        1
    ]; // first symbol has frequency 1
    for(let i = 1; i < symbol_count; i++){
        acc.push(total += u16());
    }
    // skip the sized-payload that the last 3 symbols index into
    let skip = u16();
    let pos_payload = pos;
    pos += skip;
    let read_width = 0;
    let read_buffer = 0;
    function read_bit() {
        if (read_width == 0) {
            // this will read beyond end of buffer
            // but (undefined|0) => zero pad
            read_buffer = read_buffer << 8 | bytes[pos++];
            read_width = 8;
        }
        return read_buffer >> --read_width & 1;
    }
    const N = 31;
    const FULL = 2 ** N;
    const HALF = FULL >>> 1;
    const QRTR = HALF >> 1;
    const MASK = FULL - 1;
    // fill register
    let register = 0;
    for(let i = 0; i < N; i++)register = register << 1 | read_bit();
    let symbols = [];
    let low = 0;
    let range = FULL; // treat like a float
    while(true){
        let value = Math.floor(((register - low + 1) * total - 1) / range);
        let start = 0;
        let end = symbol_count;
        while(end - start > 1){
            let mid = start + end >>> 1;
            if (value < acc[mid]) {
                end = mid;
            } else {
                start = mid;
            }
        }
        if (start == 0) break; // first symbol is end mark
        symbols.push(start);
        let a = low + Math.floor(range * acc[start] / total);
        let b = low + Math.floor(range * acc[start + 1] / total) - 1;
        while(((a ^ b) & HALF) == 0){
            register = register << 1 & MASK | read_bit();
            a = a << 1 & MASK;
            b = b << 1 & MASK | 1;
        }
        while(a & ~b & QRTR){
            register = register & HALF | register << 1 & MASK >>> 1 | read_bit();
            a = a << 1 ^ HALF;
            b = (b ^ HALF) << 1 | HALF | 1;
        }
        low = a;
        range = 1 + b - a;
    }
    let offset = symbol_count - 4;
    return symbols.map((x)=>{
        switch(x - offset){
            case 3:
                return offset + 0x10100 + (bytes[pos_payload++] << 16 | bytes[pos_payload++] << 8 | bytes[pos_payload++]);
            case 2:
                return offset + 0x100 + (bytes[pos_payload++] << 8 | bytes[pos_payload++]);
            case 1:
                return offset + bytes[pos_payload++];
            default:
                return x - 1;
        }
    });
}
// returns an iterator which returns the next symbol
function read_payload(v) {
    let pos = 0;
    return ()=>v[pos++];
}
function read_compressed_payload(s) {
    return read_payload(decode_arithmetic(unsafe_atob(s)));
}
// unsafe in the sense:
// expected well-formed Base64 w/o padding 
// 20220922: added for https://github.com/adraffy/ens-normalize.js/issues/4
function unsafe_atob(s) {
    let lookup = [];
    [
        ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    ].forEach((c, i)=>lookup[c.charCodeAt(0)] = i);
    let n = s.length;
    let ret = new Uint8Array(6 * n >> 3);
    for(let i = 0, pos = 0, width = 0, carry = 0; i < n; i++){
        carry = carry << 6 | lookup[s.charCodeAt(i)];
        width += 6;
        if (width >= 8) {
            ret[pos++] = carry >> (width -= 8);
        }
    }
    return ret;
}
// eg. [0,1,2,3...] => [0,-1,1,-2,...]
function signed(i) {
    return i & 1 ? ~i >> 1 : i >> 1;
}
function read_deltas(n, next) {
    let v = Array(n);
    for(let i = 0, x = 0; i < n; i++)v[i] = x += signed(next());
    return v;
}
// [123][5] => [0 3] [1 1] [0 0]
function read_sorted(next, prev = 0) {
    let ret = [];
    while(true){
        let x = next();
        let n = next();
        if (!n) break;
        prev += x;
        for(let i = 0; i < n; i++){
            ret.push(prev + i);
        }
        prev += n + 1;
    }
    return ret;
}
function read_sorted_arrays(next) {
    return read_array_while(()=>{
        let v = read_sorted(next);
        if (v.length) return v;
    });
}
// returns map of x => ys
function read_mapped(next) {
    let ret = [];
    while(true){
        let w = next();
        if (w == 0) break;
        ret.push(read_linear_table(w, next));
    }
    while(true){
        let w = next() - 1;
        if (w < 0) break;
        ret.push(read_replacement_table(w, next));
    }
    return ret.flat();
}
// read until next is falsy
// return array of read values
function read_array_while(next) {
    let v = [];
    while(true){
        let x = next(v.length);
        if (!x) break;
        v.push(x);
    }
    return v;
}
// read w columns of length n
// return as n rows of length w
function read_transposed(n, w, next) {
    let m = Array(n).fill().map(()=>[]);
    for(let i = 0; i < w; i++){
        read_deltas(n, next).forEach((x, j)=>m[j].push(x));
    }
    return m;
}
// returns [[x, ys], [x+dx, ys+dy], [x+2*dx, ys+2*dy], ...]
// where dx/dy = steps, n = run size, w = length of y
function read_linear_table(w, next) {
    let dx = 1 + next();
    let dy = next();
    let vN = read_array_while(next);
    let m = read_transposed(vN.length, 1 + w, next);
    return m.flatMap((v, i)=>{
        let [x, ...ys] = v;
        return Array(vN[i]).fill().map((_, j)=>{
            let j_dy = j * dy;
            return [
                x + j * dx,
                ys.map((y)=>y + j_dy)
            ];
        });
    });
}
// return [[x, ys...], ...]
// where w = length of y
function read_replacement_table(w, next) {
    let n = 1 + next();
    let m = read_transposed(n, 1 + w, next);
    return m.map((v)=>[
            v[0],
            v.slice(1)
        ]);
}
function read_trie(next) {
    let ret = [];
    let sorted = read_sorted(next);
    expand(decode([]), []);
    return ret; // not sorted
    //TURBOPACK unreachable
    ;
    function decode(Q) {
        let S = next(); // state: valid, save, check
        let B = read_array_while(()=>{
            let cps = read_sorted(next).map((i)=>sorted[i]);
            if (cps.length) return decode(cps);
        });
        return {
            S,
            B,
            Q
        };
    }
    function expand({ S, B }, cps, saved) {
        if (S & 4 && saved === cps[cps.length - 1]) return;
        if (S & 2) saved = cps[cps.length - 1];
        if (S & 1) ret.push(cps);
        for (let br of B){
            for (let cp of br.Q){
                expand(br, [
                    ...cps,
                    cp
                ], saved);
            }
        }
    }
}
function hex_cp(cp) {
    return cp.toString(16).toUpperCase().padStart(2, '0');
}
function quote_cp(cp) {
    return `{${hex_cp(cp)}}`; // raffy convention: like "\u{X}" w/o the "\u"
}
/*
export function explode_cp(s) {
	return [...s].map(c => c.codePointAt(0));
}
*/ function explode_cp(s) {
    let cps = [];
    for(let pos = 0, len = s.length; pos < len;){
        let cp = s.codePointAt(pos);
        pos += cp < 0x10000 ? 1 : 2;
        cps.push(cp);
    }
    return cps;
}
function str_from_cps(cps) {
    const chunk = 4096;
    let len = cps.length;
    if (len < chunk) return String.fromCodePoint(...cps);
    let buf = [];
    for(let i = 0; i < len;){
        buf.push(String.fromCodePoint(...cps.slice(i, i += chunk)));
    }
    return buf.join('');
}
function compare_arrays(a, b) {
    let n = a.length;
    let c = n - b.length;
    for(let i = 0; c == 0 && i < n; i++)c = a[i] - b[i];
    return c;
}
// created 2023-09-25T01:01:55.148Z
// compressed base64-encoded blob for include-nf data
// source: https://github.com/adraffy/ens-normalize.js/blob/main/src/make.js
// see: https://github.com/adraffy/ens-normalize.js#security
// SHA-256: a974b6f8541fc29d919bc85118af0a44015851fab5343f8679cb31be2bdb209e
var COMPRESSED = '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';
// https://unicode.org/reports/tr15/
// for reference implementation
// see: /derive/nf.js
// algorithmic hangul
// https://www.unicode.org/versions/Unicode15.0.0/ch03.pdf (page 144)
const S0 = 0xAC00;
const L0 = 0x1100;
const V0 = 0x1161;
const T0 = 0x11A7;
const L_COUNT = 19;
const V_COUNT = 21;
const T_COUNT = 28;
const N_COUNT = V_COUNT * T_COUNT;
const S_COUNT = L_COUNT * N_COUNT;
const S1 = S0 + S_COUNT;
const L1 = L0 + L_COUNT;
const V1 = V0 + V_COUNT;
const T1 = T0 + T_COUNT;
function unpack_cc(packed) {
    return packed >> 24 & 0xFF;
}
function unpack_cp(packed) {
    return packed & 0xFFFFFF;
}
let SHIFTED_RANK, EXCLUSIONS, DECOMP, RECOMP;
function init$1() {
    //console.time('nf');
    let r = read_compressed_payload(COMPRESSED);
    SHIFTED_RANK = new Map(read_sorted_arrays(r).flatMap((v, i)=>v.map((x)=>[
                x,
                i + 1 << 24
            ]))); // pre-shifted
    EXCLUSIONS = new Set(read_sorted(r));
    DECOMP = new Map();
    RECOMP = new Map();
    for (let [cp, cps] of read_mapped(r)){
        if (!EXCLUSIONS.has(cp) && cps.length == 2) {
            let [a, b] = cps;
            let bucket = RECOMP.get(a);
            if (!bucket) {
                bucket = new Map();
                RECOMP.set(a, bucket);
            }
            bucket.set(b, cp);
        }
        DECOMP.set(cp, cps.reverse()); // stored reversed
    }
//console.timeEnd('nf');
// 20230905: 11ms
}
function is_hangul(cp) {
    return cp >= S0 && cp < S1;
}
function compose_pair(a, b) {
    if (a >= L0 && a < L1 && b >= V0 && b < V1) {
        return S0 + (a - L0) * N_COUNT + (b - V0) * T_COUNT;
    } else if (is_hangul(a) && b > T0 && b < T1 && (a - S0) % T_COUNT == 0) {
        return a + (b - T0);
    } else {
        let recomp = RECOMP.get(a);
        if (recomp) {
            recomp = recomp.get(b);
            if (recomp) {
                return recomp;
            }
        }
        return -1;
    }
}
function decomposed(cps) {
    if (!SHIFTED_RANK) init$1();
    let ret = [];
    let buf = [];
    let check_order = false;
    function add(cp) {
        let cc = SHIFTED_RANK.get(cp);
        if (cc) {
            check_order = true;
            cp |= cc;
        }
        ret.push(cp);
    }
    for (let cp of cps){
        while(true){
            if (cp < 0x80) {
                ret.push(cp);
            } else if (is_hangul(cp)) {
                let s_index = cp - S0;
                let l_index = s_index / N_COUNT | 0;
                let v_index = s_index % N_COUNT / T_COUNT | 0;
                let t_index = s_index % T_COUNT;
                add(L0 + l_index);
                add(V0 + v_index);
                if (t_index > 0) add(T0 + t_index);
            } else {
                let mapped = DECOMP.get(cp);
                if (mapped) {
                    buf.push(...mapped);
                } else {
                    add(cp);
                }
            }
            if (!buf.length) break;
            cp = buf.pop();
        }
    }
    if (check_order && ret.length > 1) {
        let prev_cc = unpack_cc(ret[0]);
        for(let i = 1; i < ret.length; i++){
            let cc = unpack_cc(ret[i]);
            if (cc == 0 || prev_cc <= cc) {
                prev_cc = cc;
                continue;
            }
            let j = i - 1;
            while(true){
                let tmp = ret[j + 1];
                ret[j + 1] = ret[j];
                ret[j] = tmp;
                if (!j) break;
                prev_cc = unpack_cc(ret[--j]);
                if (prev_cc <= cc) break;
            }
            prev_cc = unpack_cc(ret[i]);
        }
    }
    return ret;
}
function composed_from_decomposed(v) {
    let ret = [];
    let stack = [];
    let prev_cp = -1;
    let prev_cc = 0;
    for (let packed of v){
        let cc = unpack_cc(packed);
        let cp = unpack_cp(packed);
        if (prev_cp == -1) {
            if (cc == 0) {
                prev_cp = cp;
            } else {
                ret.push(cp);
            }
        } else if (prev_cc > 0 && prev_cc >= cc) {
            if (cc == 0) {
                ret.push(prev_cp, ...stack);
                stack.length = 0;
                prev_cp = cp;
            } else {
                stack.push(cp);
            }
            prev_cc = cc;
        } else {
            let composed = compose_pair(prev_cp, cp);
            if (composed >= 0) {
                prev_cp = composed;
            } else if (prev_cc == 0 && cc == 0) {
                ret.push(prev_cp);
                prev_cp = cp;
            } else {
                stack.push(cp);
                prev_cc = cc;
            }
        }
    }
    if (prev_cp >= 0) {
        ret.push(prev_cp, ...stack);
    }
    return ret;
}
// note: cps can be iterable
function nfd(cps) {
    return decomposed(cps).map(unpack_cp);
}
function nfc(cps) {
    return composed_from_decomposed(decomposed(cps));
}
const HYPHEN = 0x2D;
const STOP = 0x2E;
const STOP_CH = '.';
const FE0F = 0xFE0F;
const UNIQUE_PH = 1;
// 20230913: replace [...v] with Array_from(v) to avoid large spreads
const Array_from = (x)=>Array.from(x); // Array.from.bind(Array);
function group_has_cp(g, cp) {
    // 20230913: keep primary and secondary distinct instead of creating valid union
    return g.P.has(cp) || g.Q.has(cp);
}
class Emoji extends Array {
    get is_emoji() {
        return true;
    }
}
let MAPPED, IGNORED, CM, NSM, ESCAPE, NFC_CHECK, GROUPS, WHOLE_VALID, WHOLE_MAP, VALID, EMOJI_LIST, EMOJI_ROOT;
function init() {
    if (MAPPED) return;
    let r = read_compressed_payload(COMPRESSED$1);
    const read_sorted_array = ()=>read_sorted(r);
    const read_sorted_set = ()=>new Set(read_sorted_array());
    const set_add_many = (set, v)=>v.forEach((x)=>set.add(x));
    MAPPED = new Map(read_mapped(r));
    IGNORED = read_sorted_set(); // ignored characters are not valid, so just read raw codepoints
    /*
	// direct include from payload is smaller than the decompression code
	const FENCED = new Map(read_array_while(() => {
		let cp = r();
		if (cp) return [cp, read_str(r())];
	}));
	*/ // 20230217: we still need all CM for proper error formatting
    // but norm only needs NSM subset that are potentially-valid
    CM = read_sorted_array();
    NSM = new Set(read_sorted_array().map((i)=>CM[i]));
    CM = new Set(CM);
    ESCAPE = read_sorted_set(); // characters that should not be printed
    NFC_CHECK = read_sorted_set(); // only needed to illustrate ens_tokenize() transformations
    let chunks = read_sorted_arrays(r);
    let unrestricted = r();
    //const read_chunked = () => new Set(read_sorted_array().flatMap(i => chunks[i]).concat(read_sorted_array()));
    const read_chunked = ()=>{
        // 20230921: build set in parts, 2x faster
        let set = new Set();
        read_sorted_array().forEach((i)=>set_add_many(set, chunks[i]));
        set_add_many(set, read_sorted_array());
        return set;
    };
    GROUPS = read_array_while((i)=>{
        // minifier property mangling seems unsafe
        // so these are manually renamed to single chars
        let N = read_array_while(r).map((x)=>x + 0x60);
        if (N.length) {
            let R = i >= unrestricted; // unrestricted then restricted
            N[0] -= 32; // capitalize
            N = str_from_cps(N);
            if (R) N = `Restricted[${N}]`;
            let P = read_chunked(); // primary
            let Q = read_chunked(); // secondary
            let M = !r(); // not-whitelisted, check for NSM
            // *** this code currently isn't needed ***
            /*
			let V = [...P, ...Q].sort((a, b) => a-b); // derive: sorted valid
			let M = r()-1; // number of combining mark
			if (M < 0) { // whitelisted
				M = new Map(read_array_while(() => {
					let i = r();
					if (i) return [V[i-1], read_array_while(() => {
						let v = read_array_while(r);
						if (v.length) return v.map(x => x-1);
					})];
				}));
			}*/ return {
                N,
                P,
                Q,
                M,
                R
            };
        }
    });
    // decode compressed wholes
    WHOLE_VALID = read_sorted_set();
    WHOLE_MAP = new Map();
    let wholes = read_sorted_array().concat(Array_from(WHOLE_VALID)).sort((a, b)=>a - b); // must be sorted
    wholes.forEach((cp, i)=>{
        let d = r();
        let w = wholes[i] = d ? wholes[i - d] : {
            V: [],
            M: new Map()
        };
        w.V.push(cp); // add to member set
        if (!WHOLE_VALID.has(cp)) {
            WHOLE_MAP.set(cp, w); // register with whole map
        }
    });
    // compute confusable-extent complements
    // usage: WHOLE_MAP.get(cp).M.get(cp) = complement set
    for (let { V, M } of new Set(WHOLE_MAP.values())){
        // connect all groups that have each whole character
        let recs = [];
        for (let cp of V){
            let gs = GROUPS.filter((g)=>group_has_cp(g, cp));
            let rec = recs.find(({ G })=>gs.some((g)=>G.has(g)));
            if (!rec) {
                rec = {
                    G: new Set(),
                    V: []
                };
                recs.push(rec);
            }
            rec.V.push(cp);
            set_add_many(rec.G, gs);
        }
        // per character cache groups which are not a member of the extent
        let union = recs.flatMap((x)=>Array_from(x.G)); // all of the groups used by this whole
        for (let { G, V } of recs){
            let complement = new Set(union.filter((g)=>!G.has(g))); // groups not covered by the extent
            for (let cp of V){
                M.set(cp, complement); // this is the same reference
            }
        }
    }
    // compute valid set
    // 20230924: VALID was union but can be re-used
    VALID = new Set(); // exists in 1+ groups
    let multi = new Set(); // exists in 2+ groups
    const add_to_union = (cp)=>VALID.has(cp) ? multi.add(cp) : VALID.add(cp);
    for (let g of GROUPS){
        for (let cp of g.P)add_to_union(cp);
        for (let cp of g.Q)add_to_union(cp);
    }
    // dual purpose WHOLE_MAP: return placeholder if unique non-confusable
    for (let cp of VALID){
        if (!WHOLE_MAP.has(cp) && !multi.has(cp)) {
            WHOLE_MAP.set(cp, UNIQUE_PH);
        }
    }
    // add all decomposed parts
    // see derive: "Valid is Closed (via Brute-force)"
    set_add_many(VALID, nfd(VALID));
    // decode emoji
    // 20230719: emoji are now fully-expanded to avoid quirk logic 
    EMOJI_LIST = read_trie(r).map((v)=>Emoji.from(v)).sort(compare_arrays);
    EMOJI_ROOT = new Map(); // this has approx 7K nodes (2+ per emoji)
    for (let cps of EMOJI_LIST){
        // 20230719: change to *slightly* stricter algorithm which disallows 
        // insertion of misplaced FE0F in emoji sequences (matching ENSIP-15)
        // example: beautified [A B] (eg. flag emoji) 
        //  before: allow: [A FE0F B], error: [A FE0F FE0F B] 
        //   after: error: both
        // note: this code now matches ENSNormalize.{cs,java} logic
        let prev = [
            EMOJI_ROOT
        ];
        for (let cp of cps){
            let next = prev.map((node)=>{
                let child = node.get(cp);
                if (!child) {
                    // should this be object? 
                    // (most have 1-2 items, few have many)
                    // 20230719: no, v8 default map is 4?
                    child = new Map();
                    node.set(cp, child);
                }
                return child;
            });
            if (cp === FE0F) {
                prev.push(...next); // less than 20 elements
            } else {
                prev = next;
            }
        }
        for (let x of prev){
            x.V = cps;
        }
    }
}
// if escaped: {HEX}
//       else: "x" {HEX}
function quoted_cp(cp) {
    return (should_escape(cp) ? '' : `${bidi_qq(safe_str_from_cps([
        cp
    ]))} `) + quote_cp(cp);
}
// 20230211: some messages can be mixed-directional and result in spillover
// use 200E after a quoted string to force the remainder of a string from 
// acquring the direction of the quote
// https://www.w3.org/International/questions/qa-bidi-unicode-controls#exceptions
function bidi_qq(s) {
    return `"${s}"\u200E`; // strong LTR
}
function check_label_extension(cps) {
    if (cps.length >= 4 && cps[2] == HYPHEN && cps[3] == HYPHEN) {
        throw new Error(`invalid label extension: "${str_from_cps(cps.slice(0, 4))}"`); // this can only be ascii so cant be bidi
    }
}
function check_leading_underscore(cps) {
    const UNDERSCORE = 0x5F;
    for(let i = cps.lastIndexOf(UNDERSCORE); i > 0;){
        if (cps[--i] !== UNDERSCORE) {
            throw new Error('underscore allowed only at start');
        }
    }
}
// check that a fenced cp is not leading, trailing, or touching another fenced cp
function check_fenced(cps) {
    let cp = cps[0];
    let prev = FENCED.get(cp);
    if (prev) throw error_placement(`leading ${prev}`);
    let n = cps.length;
    let last = -1; // prevents trailing from throwing
    for(let i = 1; i < n; i++){
        cp = cps[i];
        let match = FENCED.get(cp);
        if (match) {
            // since cps[0] isn't fenced, cps[1] cannot throw
            if (last == i) throw error_placement(`${prev} + ${match}`);
            last = i + 1;
            prev = match;
        }
    }
    if (last == n) throw error_placement(`trailing ${prev}`);
}
// create a safe to print string 
// invisibles are escaped
// leading cm uses placeholder
// if cps exceed max, middle truncate with ellipsis
// quoter(cp) => string, eg. 3000 => "{3000}"
// note: in html, you'd call this function then replace [<>&] with entities
function safe_str_from_cps(cps, max = Infinity, quoter = quote_cp) {
    //if (Number.isInteger(cps)) cps = [cps];
    //if (!Array.isArray(cps)) throw new TypeError(`expected codepoints`);
    let buf = [];
    if (is_combining_mark(cps[0])) buf.push('◌');
    if (cps.length > max) {
        max >>= 1;
        cps = [
            ...cps.slice(0, max),
            0x2026,
            ...cps.slice(-max)
        ];
    }
    let prev = 0;
    let n = cps.length;
    for(let i = 0; i < n; i++){
        let cp = cps[i];
        if (should_escape(cp)) {
            buf.push(str_from_cps(cps.slice(prev, i)));
            buf.push(quoter(cp));
            prev = i + 1;
        }
    }
    buf.push(str_from_cps(cps.slice(prev, n)));
    return buf.join('');
}
// note: set(s) cannot be exposed because they can be modified
// note: Object.freeze() doesn't work
function is_combining_mark(cp) {
    init();
    return CM.has(cp);
}
function should_escape(cp) {
    init();
    return ESCAPE.has(cp);
}
// return all supported emoji as fully-qualified emoji 
// ordered by length then lexicographic 
function ens_emoji() {
    init();
    return EMOJI_LIST.map((x)=>x.slice()); // emoji are exposed so copy
}
function ens_normalize_fragment(frag, decompose) {
    init();
    let nf = decompose ? nfd : nfc;
    return frag.split(STOP_CH).map((label)=>str_from_cps(tokens_from_str(explode_cp(label), nf, filter_fe0f).flat())).join(STOP_CH);
}
function ens_normalize(name) {
    return flatten(split(name, nfc, filter_fe0f));
}
function ens_beautify(name) {
    let labels = split(name, nfc, (x)=>x); // emoji not exposed
    for (let { type, output, error } of labels){
        if (error) break; // flatten will throw
        // replace leading/trailing hyphen
        // 20230121: consider beautifing all or leading/trailing hyphen to unicode variant
        // not exactly the same in every font, but very similar: "-" vs "‐"
        /*
		const UNICODE_HYPHEN = 0x2010;
		// maybe this should replace all for visual consistancy?
		// `node tools/reg-count.js regex ^-\{2,\}` => 592
		//for (let i = 0; i < output.length; i++) if (output[i] == 0x2D) output[i] = 0x2010;
		if (output[0] == HYPHEN) output[0] = UNICODE_HYPHEN;
		let end = output.length-1;
		if (output[end] == HYPHEN) output[end] = UNICODE_HYPHEN;
		*/ // 20230123: WHATWG URL uses "CheckHyphens" false
        // https://url.spec.whatwg.org/#idna
        // update ethereum symbol
        // ξ => Ξ if not greek
        if (type !== 'Greek') array_replace(output, 0x3BE, 0x39E);
    // 20221213: fixes bidi subdomain issue, but breaks invariant (200E is disallowed)
    // could be fixed with special case for: 2D (.) + 200E (LTR)
    // https://discuss.ens.domains/t/bidi-label-ordering-spoof/15824
    //output.splice(0, 0, 0x200E);
    }
    return flatten(labels);
}
function array_replace(v, a, b) {
    let prev = 0;
    while(true){
        let next = v.indexOf(a, prev);
        if (next < 0) break;
        v[next] = b;
        prev = next + 1;
    }
}
function ens_split(name, preserve_emoji) {
    return split(name, nfc, preserve_emoji ? (x)=>x.slice() : filter_fe0f); // emoji are exposed so copy
}
function split(name, nf, ef) {
    if (!name) return []; // 20230719: empty name allowance
    init();
    let offset = 0;
    // https://unicode.org/reports/tr46/#Validity_Criteria
    // 4.) "The label must not contain a U+002E ( . ) FULL STOP."
    return name.split(STOP_CH).map((label)=>{
        let input = explode_cp(label);
        let info = {
            input,
            offset
        };
        offset += input.length + 1; // + stop
        try {
            // 1.) "The label must be in Unicode Normalization Form NFC"
            let tokens = info.tokens = tokens_from_str(input, nf, ef);
            let token_count = tokens.length;
            let type;
            if (!token_count) {
                //norm = [];
                //type = 'None'; // use this instead of next match, "ASCII"
                // 20230120: change to strict
                // https://discuss.ens.domains/t/ens-name-normalization-2nd/14564/59
                throw new Error(`empty label`);
            }
            let norm = info.output = tokens.flat();
            check_leading_underscore(norm);
            let emoji = info.emoji = token_count > 1 || tokens[0].is_emoji; // same as: tokens.some(x => x.is_emoji);
            if (!emoji && norm.every((cp)=>cp < 0x80)) {
                // 20230123: matches matches WHATWG, see note 3.3
                check_label_extension(norm); // only needed for ascii
                // cant have fenced
                // cant have cm
                // cant have wholes
                // see derive: "Fastpath ASCII"
                type = 'ASCII';
            } else {
                let chars = tokens.flatMap((x)=>x.is_emoji ? [] : x); // all of the nfc tokens concat together
                if (!chars.length) {
                    type = 'Emoji';
                } else {
                    // 5.) "The label must not begin with a combining mark, that is: General_Category=Mark."
                    if (CM.has(norm[0])) throw error_placement('leading combining mark');
                    for(let i = 1; i < token_count; i++){
                        let cps = tokens[i];
                        if (!cps.is_emoji && CM.has(cps[0])) {
                            // bidi_qq() not needed since emoji is LTR and cps is a CM
                            throw error_placement(`emoji + combining mark: "${str_from_cps(tokens[i - 1])} + ${safe_str_from_cps([
                                cps[0]
                            ])}"`);
                        }
                    }
                    check_fenced(norm);
                    let unique = Array_from(new Set(chars));
                    let [g] = determine_group(unique); // take the first match
                    // see derive: "Matching Groups have Same CM Style"
                    // alternative: could form a hybrid type: Latin/Japanese/...	
                    check_group(g, chars); // need text in order
                    check_whole(g, unique); // only need unique text (order would be required for multiple-char confusables)
                    type = g.N;
                // 20230121: consider exposing restricted flag
                // it's simpler to just check for 'Restricted'
                // or even better: type.endsWith(']')
                //if (g.R) info.restricted = true;
                }
            }
            info.type = type;
        } catch (err) {
            info.error = err; // use full error object
        }
        return info;
    });
}
function check_whole(group, unique) {
    let maker;
    let shared = [];
    for (let cp of unique){
        let whole = WHOLE_MAP.get(cp);
        if (whole === UNIQUE_PH) return; // unique, non-confusable
        if (whole) {
            let set = whole.M.get(cp); // groups which have a character that look-like this character
            maker = maker ? maker.filter((g)=>set.has(g)) : Array_from(set);
            if (!maker.length) return; // confusable intersection is empty
        } else {
            shared.push(cp);
        }
    }
    if (maker) {
        // we have 1+ confusable
        // check if any of the remaining groups
        // contain the shared characters too
        for (let g of maker){
            if (shared.every((cp)=>group_has_cp(g, cp))) {
                throw new Error(`whole-script confusable: ${group.N}/${g.N}`);
            }
        }
    }
}
// assumption: unique.size > 0
// returns list of matching groups
function determine_group(unique) {
    let groups = GROUPS;
    for (let cp of unique){
        // note: we need to dodge CM that are whitelisted
        // but that code isn't currently necessary
        let gs = groups.filter((g)=>group_has_cp(g, cp));
        if (!gs.length) {
            if (!GROUPS.some((g)=>group_has_cp(g, cp))) {
                // the character was composed of valid parts
                // but it's NFC form is invalid
                // 20230716: change to more exact statement, see: ENSNormalize.{cs,java}
                // note: this doesn't have to be a composition
                // 20230720: change to full check
                throw error_disallowed(cp); // this should be rare
            } else {
                // there is no group that contains all these characters
                // throw using the highest priority group that matched
                // https://www.unicode.org/reports/tr39/#mixed_script_confusables
                throw error_group_member(groups[0], cp);
            }
        }
        groups = gs;
        if (gs.length == 1) break; // there is only one group left
    }
    // there are at least 1 group(s) with all of these characters
    return groups;
}
// throw on first error
function flatten(split) {
    return split.map(({ input, error, output })=>{
        if (error) {
            // don't print label again if just a single label
            let msg = error.message;
            // bidi_qq() only necessary if msg is digits
            throw new Error(split.length == 1 ? msg : `Invalid label ${bidi_qq(safe_str_from_cps(input, 63))}: ${msg}`);
        }
        return str_from_cps(output);
    }).join(STOP_CH);
}
function error_disallowed(cp) {
    // TODO: add cp to error?
    return new Error(`disallowed character: ${quoted_cp(cp)}`);
}
function error_group_member(g, cp) {
    let quoted = quoted_cp(cp);
    let gg = GROUPS.find((g)=>g.P.has(cp)); // only check primary
    if (gg) {
        quoted = `${gg.N} ${quoted}`;
    }
    return new Error(`illegal mixture: ${g.N} + ${quoted}`);
}
function error_placement(where) {
    return new Error(`illegal placement: ${where}`);
}
// assumption: cps.length > 0
// assumption: cps[0] isn't a CM
// assumption: the previous character isn't an emoji
function check_group(g, cps) {
    for (let cp of cps){
        if (!group_has_cp(g, cp)) {
            // for whitelisted scripts, this will throw illegal mixture on invalid cm, eg. "e{300}{300}"
            // at the moment, it's unnecessary to introduce an extra error type
            // until there exists a whitelisted multi-character
            //   eg. if (M < 0 && is_combining_mark(cp)) { ... }
            // there are 3 cases:
            //   1. illegal cm for wrong group => mixture error
            //   2. illegal cm for same group => cm error
            //       requires set of whitelist cm per group: 
            //        eg. new Set([...g.P, ...g.Q].flatMap(nfc).filter(cp => CM.has(cp)))
            //   3. wrong group => mixture error
            throw error_group_member(g, cp);
        }
    }
    //if (M >= 0) { // we have a known fixed cm count
    if (g.M) {
        let decomposed = nfd(cps);
        for(let i = 1, e = decomposed.length; i < e; i++){
            // 20230210: bugfix: using cps instead of decomposed h/t Carbon225
            /*
			if (CM.has(decomposed[i])) {
				let j = i + 1;
				while (j < e && CM.has(decomposed[j])) j++;
				if (j - i > M) {
					throw new Error(`too many combining marks: ${g.N} ${bidi_qq(str_from_cps(decomposed.slice(i-1, j)))} (${j-i}/${M})`);
				}
				i = j;
			}
			*/ // 20230217: switch to NSM counting
            // https://www.unicode.org/reports/tr39/#Optional_Detection
            if (NSM.has(decomposed[i])) {
                let j = i + 1;
                for(let cp; j < e && NSM.has(cp = decomposed[j]); j++){
                    // a. Forbid sequences of the same nonspacing mark.
                    for(let k = i; k < j; k++){
                        if (decomposed[k] == cp) {
                            throw new Error(`duplicate non-spacing marks: ${quoted_cp(cp)}`);
                        }
                    }
                }
                // parse to end so we have full nsm count
                // b. Forbid sequences of more than 4 nonspacing marks (gc=Mn or gc=Me).
                if (j - i > NSM_MAX) {
                    // note: this slice starts with a base char or spacing-mark cm
                    throw new Error(`excessive non-spacing marks: ${bidi_qq(safe_str_from_cps(decomposed.slice(i - 1, j)))} (${j - i}/${NSM_MAX})`);
                }
                i = j;
            }
        }
    }
// *** this code currently isn't needed ***
/*
	let cm_whitelist = M instanceof Map;
	for (let i = 0, e = cps.length; i < e; ) {
		let cp = cps[i++];
		let seqs = cm_whitelist && M.get(cp);
		if (seqs) { 
			// list of codepoints that can follow
			// if this exists, this will always be 1+
			let j = i;
			while (j < e && CM.has(cps[j])) j++;
			let cms = cps.slice(i, j);
			let match = seqs.find(seq => !compare_arrays(seq, cms));
			if (!match) throw new Error(`disallowed combining mark sequence: "${safe_str_from_cps([cp, ...cms])}"`);
			i = j;
		} else if (!V.has(cp)) {
			// https://www.unicode.org/reports/tr39/#mixed_script_confusables
			let quoted = quoted_cp(cp);
			for (let cp of cps) {
				let u = UNIQUE.get(cp);
				if (u && u !== g) {
					// if both scripts are restricted this error is confusing
					// because we don't differentiate RestrictedA from RestrictedB 
					if (!u.R) quoted = `${quoted} is ${u.N}`;
					break;
				}
			}
			throw new Error(`disallowed ${g.N} character: ${quoted}`);
			//throw new Error(`disallowed character: ${quoted} (expected ${g.N})`);
			//throw new Error(`${g.N} does not allow: ${quoted}`);
		}
	}
	if (!cm_whitelist) {
		let decomposed = nfd(cps);
		for (let i = 1, e = decomposed.length; i < e; i++) { // we know it can't be cm leading
			if (CM.has(decomposed[i])) {
				let j = i + 1;
				while (j < e && CM.has(decomposed[j])) j++;
				if (j - i > M) {
					throw new Error(`too many combining marks: "${str_from_cps(decomposed.slice(i-1, j))}" (${j-i}/${M})`);
				}
				i = j;
			}
		}
	}
	*/ }
// given a list of codepoints
// returns a list of lists, where emoji are a fully-qualified (as Array subclass)
// eg. explode_cp("abc💩d") => [[61, 62, 63], Emoji[1F4A9, FE0F], [64]]
// 20230818: rename for 'process' name collision h/t Javarome
// https://github.com/adraffy/ens-normalize.js/issues/23
function tokens_from_str(input, nf, ef) {
    let ret = [];
    let chars = [];
    input = input.slice().reverse(); // flip so we can pop
    while(input.length){
        let emoji = consume_emoji_reversed(input);
        if (emoji) {
            if (chars.length) {
                ret.push(nf(chars));
                chars = [];
            }
            ret.push(ef(emoji));
        } else {
            let cp = input.pop();
            if (VALID.has(cp)) {
                chars.push(cp);
            } else {
                let cps = MAPPED.get(cp);
                if (cps) {
                    chars.push(...cps); // less than 10 elements
                } else if (!IGNORED.has(cp)) {
                    // 20230912: unicode 15.1 changed the order of processing such that
                    // disallowed parts are only rejected after NFC
                    // https://unicode.org/reports/tr46/#Validity_Criteria
                    // this doesn't impact normalization as of today
                    // technically, this error can be removed as the group logic will apply similar logic
                    // however the error type might be less clear
                    throw error_disallowed(cp);
                }
            }
        }
    }
    if (chars.length) {
        ret.push(nf(chars));
    }
    return ret;
}
function filter_fe0f(cps) {
    return cps.filter((cp)=>cp != FE0F);
}
// given array of codepoints
// returns the longest valid emoji sequence (or undefined if no match)
// *MUTATES* the supplied array
// disallows interleaved ignored characters
// fills (optional) eaten array with matched codepoints
function consume_emoji_reversed(cps, eaten) {
    let node = EMOJI_ROOT;
    let emoji;
    let pos = cps.length;
    while(pos){
        node = node.get(cps[--pos]);
        if (!node) break;
        let { V } = node;
        if (V) {
            emoji = V;
            if (eaten) eaten.push(...cps.slice(pos).reverse()); // (optional) copy input, used for ens_tokenize()
            cps.length = pos; // truncate
        }
    }
    return emoji;
}
// ************************************************************
// tokenizer 
const TY_VALID = 'valid';
const TY_MAPPED = 'mapped';
const TY_IGNORED = 'ignored';
const TY_DISALLOWED = 'disallowed';
const TY_EMOJI = 'emoji';
const TY_NFC = 'nfc';
const TY_STOP = 'stop';
function ens_tokenize(name, { nf = true } = {}) {
    init();
    let input = explode_cp(name).reverse();
    let eaten = [];
    let tokens = [];
    while(input.length){
        let emoji = consume_emoji_reversed(input, eaten);
        if (emoji) {
            tokens.push({
                type: TY_EMOJI,
                emoji: emoji.slice(),
                input: eaten,
                cps: filter_fe0f(emoji)
            });
            eaten = []; // reset buffer
        } else {
            let cp = input.pop();
            if (cp == STOP) {
                tokens.push({
                    type: TY_STOP,
                    cp
                });
            } else if (VALID.has(cp)) {
                tokens.push({
                    type: TY_VALID,
                    cps: [
                        cp
                    ]
                });
            } else if (IGNORED.has(cp)) {
                tokens.push({
                    type: TY_IGNORED,
                    cp
                });
            } else {
                let cps = MAPPED.get(cp);
                if (cps) {
                    tokens.push({
                        type: TY_MAPPED,
                        cp,
                        cps: cps.slice()
                    });
                } else {
                    tokens.push({
                        type: TY_DISALLOWED,
                        cp
                    });
                }
            }
        }
    }
    if (nf) {
        for(let i = 0, start = -1; i < tokens.length; i++){
            let token = tokens[i];
            if (is_valid_or_mapped(token.type)) {
                if (requires_check(token.cps)) {
                    let end = i + 1;
                    for(let pos = end; pos < tokens.length; pos++){
                        let { type, cps } = tokens[pos];
                        if (is_valid_or_mapped(type)) {
                            if (!requires_check(cps)) break;
                            end = pos + 1;
                        } else if (type !== TY_IGNORED) {
                            break;
                        }
                    }
                    if (start < 0) start = i;
                    let slice = tokens.slice(start, end);
                    let cps0 = slice.flatMap((x)=>is_valid_or_mapped(x.type) ? x.cps : []); // strip junk tokens
                    let cps = nfc(cps0);
                    if (compare_arrays(cps, cps0)) {
                        tokens.splice(start, end - start, {
                            type: TY_NFC,
                            input: cps0,
                            cps,
                            tokens0: collapse_valid_tokens(slice),
                            tokens: ens_tokenize(str_from_cps(cps), {
                                nf: false
                            })
                        });
                        i = start;
                    } else {
                        i = end - 1; // skip to end of slice
                    }
                    start = -1; // reset
                } else {
                    start = i; // remember last
                }
            } else if (token.type !== TY_IGNORED) {
                start = -1; // reset
            }
        }
    }
    return collapse_valid_tokens(tokens);
}
function is_valid_or_mapped(type) {
    return type == TY_VALID || type == TY_MAPPED;
}
function requires_check(cps) {
    return cps.some((cp)=>NFC_CHECK.has(cp));
}
function collapse_valid_tokens(tokens) {
    for(let i = 0; i < tokens.length; i++){
        if (tokens[i].type == TY_VALID) {
            let j = i + 1;
            while(j < tokens.length && tokens[j].type == TY_VALID)j++;
            tokens.splice(i, j - i, {
                type: TY_VALID,
                cps: tokens.slice(i, j).flatMap((x)=>x.cps)
            });
        }
    }
    return tokens;
}
;
}),
"[project]/dashboard/node_modules/aes-js/lib.esm/aes.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AES",
    ()=>AES
]);
/*! MIT License. Copyright 2015-2022 Richard Moore <me@ricmoo.com>. See LICENSE.txt. */ var __classPrivateFieldGet = ("TURBOPACK compile-time value", void 0) && ("TURBOPACK compile-time value", void 0).__classPrivateFieldGet || function(receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __classPrivateFieldSet = ("TURBOPACK compile-time value", void 0) && ("TURBOPACK compile-time value", void 0).__classPrivateFieldSet || function(receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
};
var _AES_key, _AES_Kd, _AES_Ke;
// Number of rounds by keysize
const numberOfRounds = {
    16: 10,
    24: 12,
    32: 14
};
// Round constant words
const rcon = [
    0x01,
    0x02,
    0x04,
    0x08,
    0x10,
    0x20,
    0x40,
    0x80,
    0x1b,
    0x36,
    0x6c,
    0xd8,
    0xab,
    0x4d,
    0x9a,
    0x2f,
    0x5e,
    0xbc,
    0x63,
    0xc6,
    0x97,
    0x35,
    0x6a,
    0xd4,
    0xb3,
    0x7d,
    0xfa,
    0xef,
    0xc5,
    0x91
];
// S-box and Inverse S-box (S is for Substitution)
const S = [
    0x63,
    0x7c,
    0x77,
    0x7b,
    0xf2,
    0x6b,
    0x6f,
    0xc5,
    0x30,
    0x01,
    0x67,
    0x2b,
    0xfe,
    0xd7,
    0xab,
    0x76,
    0xca,
    0x82,
    0xc9,
    0x7d,
    0xfa,
    0x59,
    0x47,
    0xf0,
    0xad,
    0xd4,
    0xa2,
    0xaf,
    0x9c,
    0xa4,
    0x72,
    0xc0,
    0xb7,
    0xfd,
    0x93,
    0x26,
    0x36,
    0x3f,
    0xf7,
    0xcc,
    0x34,
    0xa5,
    0xe5,
    0xf1,
    0x71,
    0xd8,
    0x31,
    0x15,
    0x04,
    0xc7,
    0x23,
    0xc3,
    0x18,
    0x96,
    0x05,
    0x9a,
    0x07,
    0x12,
    0x80,
    0xe2,
    0xeb,
    0x27,
    0xb2,
    0x75,
    0x09,
    0x83,
    0x2c,
    0x1a,
    0x1b,
    0x6e,
    0x5a,
    0xa0,
    0x52,
    0x3b,
    0xd6,
    0xb3,
    0x29,
    0xe3,
    0x2f,
    0x84,
    0x53,
    0xd1,
    0x00,
    0xed,
    0x20,
    0xfc,
    0xb1,
    0x5b,
    0x6a,
    0xcb,
    0xbe,
    0x39,
    0x4a,
    0x4c,
    0x58,
    0xcf,
    0xd0,
    0xef,
    0xaa,
    0xfb,
    0x43,
    0x4d,
    0x33,
    0x85,
    0x45,
    0xf9,
    0x02,
    0x7f,
    0x50,
    0x3c,
    0x9f,
    0xa8,
    0x51,
    0xa3,
    0x40,
    0x8f,
    0x92,
    0x9d,
    0x38,
    0xf5,
    0xbc,
    0xb6,
    0xda,
    0x21,
    0x10,
    0xff,
    0xf3,
    0xd2,
    0xcd,
    0x0c,
    0x13,
    0xec,
    0x5f,
    0x97,
    0x44,
    0x17,
    0xc4,
    0xa7,
    0x7e,
    0x3d,
    0x64,
    0x5d,
    0x19,
    0x73,
    0x60,
    0x81,
    0x4f,
    0xdc,
    0x22,
    0x2a,
    0x90,
    0x88,
    0x46,
    0xee,
    0xb8,
    0x14,
    0xde,
    0x5e,
    0x0b,
    0xdb,
    0xe0,
    0x32,
    0x3a,
    0x0a,
    0x49,
    0x06,
    0x24,
    0x5c,
    0xc2,
    0xd3,
    0xac,
    0x62,
    0x91,
    0x95,
    0xe4,
    0x79,
    0xe7,
    0xc8,
    0x37,
    0x6d,
    0x8d,
    0xd5,
    0x4e,
    0xa9,
    0x6c,
    0x56,
    0xf4,
    0xea,
    0x65,
    0x7a,
    0xae,
    0x08,
    0xba,
    0x78,
    0x25,
    0x2e,
    0x1c,
    0xa6,
    0xb4,
    0xc6,
    0xe8,
    0xdd,
    0x74,
    0x1f,
    0x4b,
    0xbd,
    0x8b,
    0x8a,
    0x70,
    0x3e,
    0xb5,
    0x66,
    0x48,
    0x03,
    0xf6,
    0x0e,
    0x61,
    0x35,
    0x57,
    0xb9,
    0x86,
    0xc1,
    0x1d,
    0x9e,
    0xe1,
    0xf8,
    0x98,
    0x11,
    0x69,
    0xd9,
    0x8e,
    0x94,
    0x9b,
    0x1e,
    0x87,
    0xe9,
    0xce,
    0x55,
    0x28,
    0xdf,
    0x8c,
    0xa1,
    0x89,
    0x0d,
    0xbf,
    0xe6,
    0x42,
    0x68,
    0x41,
    0x99,
    0x2d,
    0x0f,
    0xb0,
    0x54,
    0xbb,
    0x16
];
const Si = [
    0x52,
    0x09,
    0x6a,
    0xd5,
    0x30,
    0x36,
    0xa5,
    0x38,
    0xbf,
    0x40,
    0xa3,
    0x9e,
    0x81,
    0xf3,
    0xd7,
    0xfb,
    0x7c,
    0xe3,
    0x39,
    0x82,
    0x9b,
    0x2f,
    0xff,
    0x87,
    0x34,
    0x8e,
    0x43,
    0x44,
    0xc4,
    0xde,
    0xe9,
    0xcb,
    0x54,
    0x7b,
    0x94,
    0x32,
    0xa6,
    0xc2,
    0x23,
    0x3d,
    0xee,
    0x4c,
    0x95,
    0x0b,
    0x42,
    0xfa,
    0xc3,
    0x4e,
    0x08,
    0x2e,
    0xa1,
    0x66,
    0x28,
    0xd9,
    0x24,
    0xb2,
    0x76,
    0x5b,
    0xa2,
    0x49,
    0x6d,
    0x8b,
    0xd1,
    0x25,
    0x72,
    0xf8,
    0xf6,
    0x64,
    0x86,
    0x68,
    0x98,
    0x16,
    0xd4,
    0xa4,
    0x5c,
    0xcc,
    0x5d,
    0x65,
    0xb6,
    0x92,
    0x6c,
    0x70,
    0x48,
    0x50,
    0xfd,
    0xed,
    0xb9,
    0xda,
    0x5e,
    0x15,
    0x46,
    0x57,
    0xa7,
    0x8d,
    0x9d,
    0x84,
    0x90,
    0xd8,
    0xab,
    0x00,
    0x8c,
    0xbc,
    0xd3,
    0x0a,
    0xf7,
    0xe4,
    0x58,
    0x05,
    0xb8,
    0xb3,
    0x45,
    0x06,
    0xd0,
    0x2c,
    0x1e,
    0x8f,
    0xca,
    0x3f,
    0x0f,
    0x02,
    0xc1,
    0xaf,
    0xbd,
    0x03,
    0x01,
    0x13,
    0x8a,
    0x6b,
    0x3a,
    0x91,
    0x11,
    0x41,
    0x4f,
    0x67,
    0xdc,
    0xea,
    0x97,
    0xf2,
    0xcf,
    0xce,
    0xf0,
    0xb4,
    0xe6,
    0x73,
    0x96,
    0xac,
    0x74,
    0x22,
    0xe7,
    0xad,
    0x35,
    0x85,
    0xe2,
    0xf9,
    0x37,
    0xe8,
    0x1c,
    0x75,
    0xdf,
    0x6e,
    0x47,
    0xf1,
    0x1a,
    0x71,
    0x1d,
    0x29,
    0xc5,
    0x89,
    0x6f,
    0xb7,
    0x62,
    0x0e,
    0xaa,
    0x18,
    0xbe,
    0x1b,
    0xfc,
    0x56,
    0x3e,
    0x4b,
    0xc6,
    0xd2,
    0x79,
    0x20,
    0x9a,
    0xdb,
    0xc0,
    0xfe,
    0x78,
    0xcd,
    0x5a,
    0xf4,
    0x1f,
    0xdd,
    0xa8,
    0x33,
    0x88,
    0x07,
    0xc7,
    0x31,
    0xb1,
    0x12,
    0x10,
    0x59,
    0x27,
    0x80,
    0xec,
    0x5f,
    0x60,
    0x51,
    0x7f,
    0xa9,
    0x19,
    0xb5,
    0x4a,
    0x0d,
    0x2d,
    0xe5,
    0x7a,
    0x9f,
    0x93,
    0xc9,
    0x9c,
    0xef,
    0xa0,
    0xe0,
    0x3b,
    0x4d,
    0xae,
    0x2a,
    0xf5,
    0xb0,
    0xc8,
    0xeb,
    0xbb,
    0x3c,
    0x83,
    0x53,
    0x99,
    0x61,
    0x17,
    0x2b,
    0x04,
    0x7e,
    0xba,
    0x77,
    0xd6,
    0x26,
    0xe1,
    0x69,
    0x14,
    0x63,
    0x55,
    0x21,
    0x0c,
    0x7d
];
// Transformations for encryption
const T1 = [
    0xc66363a5,
    0xf87c7c84,
    0xee777799,
    0xf67b7b8d,
    0xfff2f20d,
    0xd66b6bbd,
    0xde6f6fb1,
    0x91c5c554,
    0x60303050,
    0x02010103,
    0xce6767a9,
    0x562b2b7d,
    0xe7fefe19,
    0xb5d7d762,
    0x4dababe6,
    0xec76769a,
    0x8fcaca45,
    0x1f82829d,
    0x89c9c940,
    0xfa7d7d87,
    0xeffafa15,
    0xb25959eb,
    0x8e4747c9,
    0xfbf0f00b,
    0x41adadec,
    0xb3d4d467,
    0x5fa2a2fd,
    0x45afafea,
    0x239c9cbf,
    0x53a4a4f7,
    0xe4727296,
    0x9bc0c05b,
    0x75b7b7c2,
    0xe1fdfd1c,
    0x3d9393ae,
    0x4c26266a,
    0x6c36365a,
    0x7e3f3f41,
    0xf5f7f702,
    0x83cccc4f,
    0x6834345c,
    0x51a5a5f4,
    0xd1e5e534,
    0xf9f1f108,
    0xe2717193,
    0xabd8d873,
    0x62313153,
    0x2a15153f,
    0x0804040c,
    0x95c7c752,
    0x46232365,
    0x9dc3c35e,
    0x30181828,
    0x379696a1,
    0x0a05050f,
    0x2f9a9ab5,
    0x0e070709,
    0x24121236,
    0x1b80809b,
    0xdfe2e23d,
    0xcdebeb26,
    0x4e272769,
    0x7fb2b2cd,
    0xea75759f,
    0x1209091b,
    0x1d83839e,
    0x582c2c74,
    0x341a1a2e,
    0x361b1b2d,
    0xdc6e6eb2,
    0xb45a5aee,
    0x5ba0a0fb,
    0xa45252f6,
    0x763b3b4d,
    0xb7d6d661,
    0x7db3b3ce,
    0x5229297b,
    0xdde3e33e,
    0x5e2f2f71,
    0x13848497,
    0xa65353f5,
    0xb9d1d168,
    0x00000000,
    0xc1eded2c,
    0x40202060,
    0xe3fcfc1f,
    0x79b1b1c8,
    0xb65b5bed,
    0xd46a6abe,
    0x8dcbcb46,
    0x67bebed9,
    0x7239394b,
    0x944a4ade,
    0x984c4cd4,
    0xb05858e8,
    0x85cfcf4a,
    0xbbd0d06b,
    0xc5efef2a,
    0x4faaaae5,
    0xedfbfb16,
    0x864343c5,
    0x9a4d4dd7,
    0x66333355,
    0x11858594,
    0x8a4545cf,
    0xe9f9f910,
    0x04020206,
    0xfe7f7f81,
    0xa05050f0,
    0x783c3c44,
    0x259f9fba,
    0x4ba8a8e3,
    0xa25151f3,
    0x5da3a3fe,
    0x804040c0,
    0x058f8f8a,
    0x3f9292ad,
    0x219d9dbc,
    0x70383848,
    0xf1f5f504,
    0x63bcbcdf,
    0x77b6b6c1,
    0xafdada75,
    0x42212163,
    0x20101030,
    0xe5ffff1a,
    0xfdf3f30e,
    0xbfd2d26d,
    0x81cdcd4c,
    0x180c0c14,
    0x26131335,
    0xc3ecec2f,
    0xbe5f5fe1,
    0x359797a2,
    0x884444cc,
    0x2e171739,
    0x93c4c457,
    0x55a7a7f2,
    0xfc7e7e82,
    0x7a3d3d47,
    0xc86464ac,
    0xba5d5de7,
    0x3219192b,
    0xe6737395,
    0xc06060a0,
    0x19818198,
    0x9e4f4fd1,
    0xa3dcdc7f,
    0x44222266,
    0x542a2a7e,
    0x3b9090ab,
    0x0b888883,
    0x8c4646ca,
    0xc7eeee29,
    0x6bb8b8d3,
    0x2814143c,
    0xa7dede79,
    0xbc5e5ee2,
    0x160b0b1d,
    0xaddbdb76,
    0xdbe0e03b,
    0x64323256,
    0x743a3a4e,
    0x140a0a1e,
    0x924949db,
    0x0c06060a,
    0x4824246c,
    0xb85c5ce4,
    0x9fc2c25d,
    0xbdd3d36e,
    0x43acacef,
    0xc46262a6,
    0x399191a8,
    0x319595a4,
    0xd3e4e437,
    0xf279798b,
    0xd5e7e732,
    0x8bc8c843,
    0x6e373759,
    0xda6d6db7,
    0x018d8d8c,
    0xb1d5d564,
    0x9c4e4ed2,
    0x49a9a9e0,
    0xd86c6cb4,
    0xac5656fa,
    0xf3f4f407,
    0xcfeaea25,
    0xca6565af,
    0xf47a7a8e,
    0x47aeaee9,
    0x10080818,
    0x6fbabad5,
    0xf0787888,
    0x4a25256f,
    0x5c2e2e72,
    0x381c1c24,
    0x57a6a6f1,
    0x73b4b4c7,
    0x97c6c651,
    0xcbe8e823,
    0xa1dddd7c,
    0xe874749c,
    0x3e1f1f21,
    0x964b4bdd,
    0x61bdbddc,
    0x0d8b8b86,
    0x0f8a8a85,
    0xe0707090,
    0x7c3e3e42,
    0x71b5b5c4,
    0xcc6666aa,
    0x904848d8,
    0x06030305,
    0xf7f6f601,
    0x1c0e0e12,
    0xc26161a3,
    0x6a35355f,
    0xae5757f9,
    0x69b9b9d0,
    0x17868691,
    0x99c1c158,
    0x3a1d1d27,
    0x279e9eb9,
    0xd9e1e138,
    0xebf8f813,
    0x2b9898b3,
    0x22111133,
    0xd26969bb,
    0xa9d9d970,
    0x078e8e89,
    0x339494a7,
    0x2d9b9bb6,
    0x3c1e1e22,
    0x15878792,
    0xc9e9e920,
    0x87cece49,
    0xaa5555ff,
    0x50282878,
    0xa5dfdf7a,
    0x038c8c8f,
    0x59a1a1f8,
    0x09898980,
    0x1a0d0d17,
    0x65bfbfda,
    0xd7e6e631,
    0x844242c6,
    0xd06868b8,
    0x824141c3,
    0x299999b0,
    0x5a2d2d77,
    0x1e0f0f11,
    0x7bb0b0cb,
    0xa85454fc,
    0x6dbbbbd6,
    0x2c16163a
];
const T2 = [
    0xa5c66363,
    0x84f87c7c,
    0x99ee7777,
    0x8df67b7b,
    0x0dfff2f2,
    0xbdd66b6b,
    0xb1de6f6f,
    0x5491c5c5,
    0x50603030,
    0x03020101,
    0xa9ce6767,
    0x7d562b2b,
    0x19e7fefe,
    0x62b5d7d7,
    0xe64dabab,
    0x9aec7676,
    0x458fcaca,
    0x9d1f8282,
    0x4089c9c9,
    0x87fa7d7d,
    0x15effafa,
    0xebb25959,
    0xc98e4747,
    0x0bfbf0f0,
    0xec41adad,
    0x67b3d4d4,
    0xfd5fa2a2,
    0xea45afaf,
    0xbf239c9c,
    0xf753a4a4,
    0x96e47272,
    0x5b9bc0c0,
    0xc275b7b7,
    0x1ce1fdfd,
    0xae3d9393,
    0x6a4c2626,
    0x5a6c3636,
    0x417e3f3f,
    0x02f5f7f7,
    0x4f83cccc,
    0x5c683434,
    0xf451a5a5,
    0x34d1e5e5,
    0x08f9f1f1,
    0x93e27171,
    0x73abd8d8,
    0x53623131,
    0x3f2a1515,
    0x0c080404,
    0x5295c7c7,
    0x65462323,
    0x5e9dc3c3,
    0x28301818,
    0xa1379696,
    0x0f0a0505,
    0xb52f9a9a,
    0x090e0707,
    0x36241212,
    0x9b1b8080,
    0x3ddfe2e2,
    0x26cdebeb,
    0x694e2727,
    0xcd7fb2b2,
    0x9fea7575,
    0x1b120909,
    0x9e1d8383,
    0x74582c2c,
    0x2e341a1a,
    0x2d361b1b,
    0xb2dc6e6e,
    0xeeb45a5a,
    0xfb5ba0a0,
    0xf6a45252,
    0x4d763b3b,
    0x61b7d6d6,
    0xce7db3b3,
    0x7b522929,
    0x3edde3e3,
    0x715e2f2f,
    0x97138484,
    0xf5a65353,
    0x68b9d1d1,
    0x00000000,
    0x2cc1eded,
    0x60402020,
    0x1fe3fcfc,
    0xc879b1b1,
    0xedb65b5b,
    0xbed46a6a,
    0x468dcbcb,
    0xd967bebe,
    0x4b723939,
    0xde944a4a,
    0xd4984c4c,
    0xe8b05858,
    0x4a85cfcf,
    0x6bbbd0d0,
    0x2ac5efef,
    0xe54faaaa,
    0x16edfbfb,
    0xc5864343,
    0xd79a4d4d,
    0x55663333,
    0x94118585,
    0xcf8a4545,
    0x10e9f9f9,
    0x06040202,
    0x81fe7f7f,
    0xf0a05050,
    0x44783c3c,
    0xba259f9f,
    0xe34ba8a8,
    0xf3a25151,
    0xfe5da3a3,
    0xc0804040,
    0x8a058f8f,
    0xad3f9292,
    0xbc219d9d,
    0x48703838,
    0x04f1f5f5,
    0xdf63bcbc,
    0xc177b6b6,
    0x75afdada,
    0x63422121,
    0x30201010,
    0x1ae5ffff,
    0x0efdf3f3,
    0x6dbfd2d2,
    0x4c81cdcd,
    0x14180c0c,
    0x35261313,
    0x2fc3ecec,
    0xe1be5f5f,
    0xa2359797,
    0xcc884444,
    0x392e1717,
    0x5793c4c4,
    0xf255a7a7,
    0x82fc7e7e,
    0x477a3d3d,
    0xacc86464,
    0xe7ba5d5d,
    0x2b321919,
    0x95e67373,
    0xa0c06060,
    0x98198181,
    0xd19e4f4f,
    0x7fa3dcdc,
    0x66442222,
    0x7e542a2a,
    0xab3b9090,
    0x830b8888,
    0xca8c4646,
    0x29c7eeee,
    0xd36bb8b8,
    0x3c281414,
    0x79a7dede,
    0xe2bc5e5e,
    0x1d160b0b,
    0x76addbdb,
    0x3bdbe0e0,
    0x56643232,
    0x4e743a3a,
    0x1e140a0a,
    0xdb924949,
    0x0a0c0606,
    0x6c482424,
    0xe4b85c5c,
    0x5d9fc2c2,
    0x6ebdd3d3,
    0xef43acac,
    0xa6c46262,
    0xa8399191,
    0xa4319595,
    0x37d3e4e4,
    0x8bf27979,
    0x32d5e7e7,
    0x438bc8c8,
    0x596e3737,
    0xb7da6d6d,
    0x8c018d8d,
    0x64b1d5d5,
    0xd29c4e4e,
    0xe049a9a9,
    0xb4d86c6c,
    0xfaac5656,
    0x07f3f4f4,
    0x25cfeaea,
    0xafca6565,
    0x8ef47a7a,
    0xe947aeae,
    0x18100808,
    0xd56fbaba,
    0x88f07878,
    0x6f4a2525,
    0x725c2e2e,
    0x24381c1c,
    0xf157a6a6,
    0xc773b4b4,
    0x5197c6c6,
    0x23cbe8e8,
    0x7ca1dddd,
    0x9ce87474,
    0x213e1f1f,
    0xdd964b4b,
    0xdc61bdbd,
    0x860d8b8b,
    0x850f8a8a,
    0x90e07070,
    0x427c3e3e,
    0xc471b5b5,
    0xaacc6666,
    0xd8904848,
    0x05060303,
    0x01f7f6f6,
    0x121c0e0e,
    0xa3c26161,
    0x5f6a3535,
    0xf9ae5757,
    0xd069b9b9,
    0x91178686,
    0x5899c1c1,
    0x273a1d1d,
    0xb9279e9e,
    0x38d9e1e1,
    0x13ebf8f8,
    0xb32b9898,
    0x33221111,
    0xbbd26969,
    0x70a9d9d9,
    0x89078e8e,
    0xa7339494,
    0xb62d9b9b,
    0x223c1e1e,
    0x92158787,
    0x20c9e9e9,
    0x4987cece,
    0xffaa5555,
    0x78502828,
    0x7aa5dfdf,
    0x8f038c8c,
    0xf859a1a1,
    0x80098989,
    0x171a0d0d,
    0xda65bfbf,
    0x31d7e6e6,
    0xc6844242,
    0xb8d06868,
    0xc3824141,
    0xb0299999,
    0x775a2d2d,
    0x111e0f0f,
    0xcb7bb0b0,
    0xfca85454,
    0xd66dbbbb,
    0x3a2c1616
];
const T3 = [
    0x63a5c663,
    0x7c84f87c,
    0x7799ee77,
    0x7b8df67b,
    0xf20dfff2,
    0x6bbdd66b,
    0x6fb1de6f,
    0xc55491c5,
    0x30506030,
    0x01030201,
    0x67a9ce67,
    0x2b7d562b,
    0xfe19e7fe,
    0xd762b5d7,
    0xabe64dab,
    0x769aec76,
    0xca458fca,
    0x829d1f82,
    0xc94089c9,
    0x7d87fa7d,
    0xfa15effa,
    0x59ebb259,
    0x47c98e47,
    0xf00bfbf0,
    0xadec41ad,
    0xd467b3d4,
    0xa2fd5fa2,
    0xafea45af,
    0x9cbf239c,
    0xa4f753a4,
    0x7296e472,
    0xc05b9bc0,
    0xb7c275b7,
    0xfd1ce1fd,
    0x93ae3d93,
    0x266a4c26,
    0x365a6c36,
    0x3f417e3f,
    0xf702f5f7,
    0xcc4f83cc,
    0x345c6834,
    0xa5f451a5,
    0xe534d1e5,
    0xf108f9f1,
    0x7193e271,
    0xd873abd8,
    0x31536231,
    0x153f2a15,
    0x040c0804,
    0xc75295c7,
    0x23654623,
    0xc35e9dc3,
    0x18283018,
    0x96a13796,
    0x050f0a05,
    0x9ab52f9a,
    0x07090e07,
    0x12362412,
    0x809b1b80,
    0xe23ddfe2,
    0xeb26cdeb,
    0x27694e27,
    0xb2cd7fb2,
    0x759fea75,
    0x091b1209,
    0x839e1d83,
    0x2c74582c,
    0x1a2e341a,
    0x1b2d361b,
    0x6eb2dc6e,
    0x5aeeb45a,
    0xa0fb5ba0,
    0x52f6a452,
    0x3b4d763b,
    0xd661b7d6,
    0xb3ce7db3,
    0x297b5229,
    0xe33edde3,
    0x2f715e2f,
    0x84971384,
    0x53f5a653,
    0xd168b9d1,
    0x00000000,
    0xed2cc1ed,
    0x20604020,
    0xfc1fe3fc,
    0xb1c879b1,
    0x5bedb65b,
    0x6abed46a,
    0xcb468dcb,
    0xbed967be,
    0x394b7239,
    0x4ade944a,
    0x4cd4984c,
    0x58e8b058,
    0xcf4a85cf,
    0xd06bbbd0,
    0xef2ac5ef,
    0xaae54faa,
    0xfb16edfb,
    0x43c58643,
    0x4dd79a4d,
    0x33556633,
    0x85941185,
    0x45cf8a45,
    0xf910e9f9,
    0x02060402,
    0x7f81fe7f,
    0x50f0a050,
    0x3c44783c,
    0x9fba259f,
    0xa8e34ba8,
    0x51f3a251,
    0xa3fe5da3,
    0x40c08040,
    0x8f8a058f,
    0x92ad3f92,
    0x9dbc219d,
    0x38487038,
    0xf504f1f5,
    0xbcdf63bc,
    0xb6c177b6,
    0xda75afda,
    0x21634221,
    0x10302010,
    0xff1ae5ff,
    0xf30efdf3,
    0xd26dbfd2,
    0xcd4c81cd,
    0x0c14180c,
    0x13352613,
    0xec2fc3ec,
    0x5fe1be5f,
    0x97a23597,
    0x44cc8844,
    0x17392e17,
    0xc45793c4,
    0xa7f255a7,
    0x7e82fc7e,
    0x3d477a3d,
    0x64acc864,
    0x5de7ba5d,
    0x192b3219,
    0x7395e673,
    0x60a0c060,
    0x81981981,
    0x4fd19e4f,
    0xdc7fa3dc,
    0x22664422,
    0x2a7e542a,
    0x90ab3b90,
    0x88830b88,
    0x46ca8c46,
    0xee29c7ee,
    0xb8d36bb8,
    0x143c2814,
    0xde79a7de,
    0x5ee2bc5e,
    0x0b1d160b,
    0xdb76addb,
    0xe03bdbe0,
    0x32566432,
    0x3a4e743a,
    0x0a1e140a,
    0x49db9249,
    0x060a0c06,
    0x246c4824,
    0x5ce4b85c,
    0xc25d9fc2,
    0xd36ebdd3,
    0xacef43ac,
    0x62a6c462,
    0x91a83991,
    0x95a43195,
    0xe437d3e4,
    0x798bf279,
    0xe732d5e7,
    0xc8438bc8,
    0x37596e37,
    0x6db7da6d,
    0x8d8c018d,
    0xd564b1d5,
    0x4ed29c4e,
    0xa9e049a9,
    0x6cb4d86c,
    0x56faac56,
    0xf407f3f4,
    0xea25cfea,
    0x65afca65,
    0x7a8ef47a,
    0xaee947ae,
    0x08181008,
    0xbad56fba,
    0x7888f078,
    0x256f4a25,
    0x2e725c2e,
    0x1c24381c,
    0xa6f157a6,
    0xb4c773b4,
    0xc65197c6,
    0xe823cbe8,
    0xdd7ca1dd,
    0x749ce874,
    0x1f213e1f,
    0x4bdd964b,
    0xbddc61bd,
    0x8b860d8b,
    0x8a850f8a,
    0x7090e070,
    0x3e427c3e,
    0xb5c471b5,
    0x66aacc66,
    0x48d89048,
    0x03050603,
    0xf601f7f6,
    0x0e121c0e,
    0x61a3c261,
    0x355f6a35,
    0x57f9ae57,
    0xb9d069b9,
    0x86911786,
    0xc15899c1,
    0x1d273a1d,
    0x9eb9279e,
    0xe138d9e1,
    0xf813ebf8,
    0x98b32b98,
    0x11332211,
    0x69bbd269,
    0xd970a9d9,
    0x8e89078e,
    0x94a73394,
    0x9bb62d9b,
    0x1e223c1e,
    0x87921587,
    0xe920c9e9,
    0xce4987ce,
    0x55ffaa55,
    0x28785028,
    0xdf7aa5df,
    0x8c8f038c,
    0xa1f859a1,
    0x89800989,
    0x0d171a0d,
    0xbfda65bf,
    0xe631d7e6,
    0x42c68442,
    0x68b8d068,
    0x41c38241,
    0x99b02999,
    0x2d775a2d,
    0x0f111e0f,
    0xb0cb7bb0,
    0x54fca854,
    0xbbd66dbb,
    0x163a2c16
];
const T4 = [
    0x6363a5c6,
    0x7c7c84f8,
    0x777799ee,
    0x7b7b8df6,
    0xf2f20dff,
    0x6b6bbdd6,
    0x6f6fb1de,
    0xc5c55491,
    0x30305060,
    0x01010302,
    0x6767a9ce,
    0x2b2b7d56,
    0xfefe19e7,
    0xd7d762b5,
    0xababe64d,
    0x76769aec,
    0xcaca458f,
    0x82829d1f,
    0xc9c94089,
    0x7d7d87fa,
    0xfafa15ef,
    0x5959ebb2,
    0x4747c98e,
    0xf0f00bfb,
    0xadadec41,
    0xd4d467b3,
    0xa2a2fd5f,
    0xafafea45,
    0x9c9cbf23,
    0xa4a4f753,
    0x727296e4,
    0xc0c05b9b,
    0xb7b7c275,
    0xfdfd1ce1,
    0x9393ae3d,
    0x26266a4c,
    0x36365a6c,
    0x3f3f417e,
    0xf7f702f5,
    0xcccc4f83,
    0x34345c68,
    0xa5a5f451,
    0xe5e534d1,
    0xf1f108f9,
    0x717193e2,
    0xd8d873ab,
    0x31315362,
    0x15153f2a,
    0x04040c08,
    0xc7c75295,
    0x23236546,
    0xc3c35e9d,
    0x18182830,
    0x9696a137,
    0x05050f0a,
    0x9a9ab52f,
    0x0707090e,
    0x12123624,
    0x80809b1b,
    0xe2e23ddf,
    0xebeb26cd,
    0x2727694e,
    0xb2b2cd7f,
    0x75759fea,
    0x09091b12,
    0x83839e1d,
    0x2c2c7458,
    0x1a1a2e34,
    0x1b1b2d36,
    0x6e6eb2dc,
    0x5a5aeeb4,
    0xa0a0fb5b,
    0x5252f6a4,
    0x3b3b4d76,
    0xd6d661b7,
    0xb3b3ce7d,
    0x29297b52,
    0xe3e33edd,
    0x2f2f715e,
    0x84849713,
    0x5353f5a6,
    0xd1d168b9,
    0x00000000,
    0xeded2cc1,
    0x20206040,
    0xfcfc1fe3,
    0xb1b1c879,
    0x5b5bedb6,
    0x6a6abed4,
    0xcbcb468d,
    0xbebed967,
    0x39394b72,
    0x4a4ade94,
    0x4c4cd498,
    0x5858e8b0,
    0xcfcf4a85,
    0xd0d06bbb,
    0xefef2ac5,
    0xaaaae54f,
    0xfbfb16ed,
    0x4343c586,
    0x4d4dd79a,
    0x33335566,
    0x85859411,
    0x4545cf8a,
    0xf9f910e9,
    0x02020604,
    0x7f7f81fe,
    0x5050f0a0,
    0x3c3c4478,
    0x9f9fba25,
    0xa8a8e34b,
    0x5151f3a2,
    0xa3a3fe5d,
    0x4040c080,
    0x8f8f8a05,
    0x9292ad3f,
    0x9d9dbc21,
    0x38384870,
    0xf5f504f1,
    0xbcbcdf63,
    0xb6b6c177,
    0xdada75af,
    0x21216342,
    0x10103020,
    0xffff1ae5,
    0xf3f30efd,
    0xd2d26dbf,
    0xcdcd4c81,
    0x0c0c1418,
    0x13133526,
    0xecec2fc3,
    0x5f5fe1be,
    0x9797a235,
    0x4444cc88,
    0x1717392e,
    0xc4c45793,
    0xa7a7f255,
    0x7e7e82fc,
    0x3d3d477a,
    0x6464acc8,
    0x5d5de7ba,
    0x19192b32,
    0x737395e6,
    0x6060a0c0,
    0x81819819,
    0x4f4fd19e,
    0xdcdc7fa3,
    0x22226644,
    0x2a2a7e54,
    0x9090ab3b,
    0x8888830b,
    0x4646ca8c,
    0xeeee29c7,
    0xb8b8d36b,
    0x14143c28,
    0xdede79a7,
    0x5e5ee2bc,
    0x0b0b1d16,
    0xdbdb76ad,
    0xe0e03bdb,
    0x32325664,
    0x3a3a4e74,
    0x0a0a1e14,
    0x4949db92,
    0x06060a0c,
    0x24246c48,
    0x5c5ce4b8,
    0xc2c25d9f,
    0xd3d36ebd,
    0xacacef43,
    0x6262a6c4,
    0x9191a839,
    0x9595a431,
    0xe4e437d3,
    0x79798bf2,
    0xe7e732d5,
    0xc8c8438b,
    0x3737596e,
    0x6d6db7da,
    0x8d8d8c01,
    0xd5d564b1,
    0x4e4ed29c,
    0xa9a9e049,
    0x6c6cb4d8,
    0x5656faac,
    0xf4f407f3,
    0xeaea25cf,
    0x6565afca,
    0x7a7a8ef4,
    0xaeaee947,
    0x08081810,
    0xbabad56f,
    0x787888f0,
    0x25256f4a,
    0x2e2e725c,
    0x1c1c2438,
    0xa6a6f157,
    0xb4b4c773,
    0xc6c65197,
    0xe8e823cb,
    0xdddd7ca1,
    0x74749ce8,
    0x1f1f213e,
    0x4b4bdd96,
    0xbdbddc61,
    0x8b8b860d,
    0x8a8a850f,
    0x707090e0,
    0x3e3e427c,
    0xb5b5c471,
    0x6666aacc,
    0x4848d890,
    0x03030506,
    0xf6f601f7,
    0x0e0e121c,
    0x6161a3c2,
    0x35355f6a,
    0x5757f9ae,
    0xb9b9d069,
    0x86869117,
    0xc1c15899,
    0x1d1d273a,
    0x9e9eb927,
    0xe1e138d9,
    0xf8f813eb,
    0x9898b32b,
    0x11113322,
    0x6969bbd2,
    0xd9d970a9,
    0x8e8e8907,
    0x9494a733,
    0x9b9bb62d,
    0x1e1e223c,
    0x87879215,
    0xe9e920c9,
    0xcece4987,
    0x5555ffaa,
    0x28287850,
    0xdfdf7aa5,
    0x8c8c8f03,
    0xa1a1f859,
    0x89898009,
    0x0d0d171a,
    0xbfbfda65,
    0xe6e631d7,
    0x4242c684,
    0x6868b8d0,
    0x4141c382,
    0x9999b029,
    0x2d2d775a,
    0x0f0f111e,
    0xb0b0cb7b,
    0x5454fca8,
    0xbbbbd66d,
    0x16163a2c
];
// Transformations for decryption
const T5 = [
    0x51f4a750,
    0x7e416553,
    0x1a17a4c3,
    0x3a275e96,
    0x3bab6bcb,
    0x1f9d45f1,
    0xacfa58ab,
    0x4be30393,
    0x2030fa55,
    0xad766df6,
    0x88cc7691,
    0xf5024c25,
    0x4fe5d7fc,
    0xc52acbd7,
    0x26354480,
    0xb562a38f,
    0xdeb15a49,
    0x25ba1b67,
    0x45ea0e98,
    0x5dfec0e1,
    0xc32f7502,
    0x814cf012,
    0x8d4697a3,
    0x6bd3f9c6,
    0x038f5fe7,
    0x15929c95,
    0xbf6d7aeb,
    0x955259da,
    0xd4be832d,
    0x587421d3,
    0x49e06929,
    0x8ec9c844,
    0x75c2896a,
    0xf48e7978,
    0x99583e6b,
    0x27b971dd,
    0xbee14fb6,
    0xf088ad17,
    0xc920ac66,
    0x7dce3ab4,
    0x63df4a18,
    0xe51a3182,
    0x97513360,
    0x62537f45,
    0xb16477e0,
    0xbb6bae84,
    0xfe81a01c,
    0xf9082b94,
    0x70486858,
    0x8f45fd19,
    0x94de6c87,
    0x527bf8b7,
    0xab73d323,
    0x724b02e2,
    0xe31f8f57,
    0x6655ab2a,
    0xb2eb2807,
    0x2fb5c203,
    0x86c57b9a,
    0xd33708a5,
    0x302887f2,
    0x23bfa5b2,
    0x02036aba,
    0xed16825c,
    0x8acf1c2b,
    0xa779b492,
    0xf307f2f0,
    0x4e69e2a1,
    0x65daf4cd,
    0x0605bed5,
    0xd134621f,
    0xc4a6fe8a,
    0x342e539d,
    0xa2f355a0,
    0x058ae132,
    0xa4f6eb75,
    0x0b83ec39,
    0x4060efaa,
    0x5e719f06,
    0xbd6e1051,
    0x3e218af9,
    0x96dd063d,
    0xdd3e05ae,
    0x4de6bd46,
    0x91548db5,
    0x71c45d05,
    0x0406d46f,
    0x605015ff,
    0x1998fb24,
    0xd6bde997,
    0x894043cc,
    0x67d99e77,
    0xb0e842bd,
    0x07898b88,
    0xe7195b38,
    0x79c8eedb,
    0xa17c0a47,
    0x7c420fe9,
    0xf8841ec9,
    0x00000000,
    0x09808683,
    0x322bed48,
    0x1e1170ac,
    0x6c5a724e,
    0xfd0efffb,
    0x0f853856,
    0x3daed51e,
    0x362d3927,
    0x0a0fd964,
    0x685ca621,
    0x9b5b54d1,
    0x24362e3a,
    0x0c0a67b1,
    0x9357e70f,
    0xb4ee96d2,
    0x1b9b919e,
    0x80c0c54f,
    0x61dc20a2,
    0x5a774b69,
    0x1c121a16,
    0xe293ba0a,
    0xc0a02ae5,
    0x3c22e043,
    0x121b171d,
    0x0e090d0b,
    0xf28bc7ad,
    0x2db6a8b9,
    0x141ea9c8,
    0x57f11985,
    0xaf75074c,
    0xee99ddbb,
    0xa37f60fd,
    0xf701269f,
    0x5c72f5bc,
    0x44663bc5,
    0x5bfb7e34,
    0x8b432976,
    0xcb23c6dc,
    0xb6edfc68,
    0xb8e4f163,
    0xd731dcca,
    0x42638510,
    0x13972240,
    0x84c61120,
    0x854a247d,
    0xd2bb3df8,
    0xaef93211,
    0xc729a16d,
    0x1d9e2f4b,
    0xdcb230f3,
    0x0d8652ec,
    0x77c1e3d0,
    0x2bb3166c,
    0xa970b999,
    0x119448fa,
    0x47e96422,
    0xa8fc8cc4,
    0xa0f03f1a,
    0x567d2cd8,
    0x223390ef,
    0x87494ec7,
    0xd938d1c1,
    0x8ccaa2fe,
    0x98d40b36,
    0xa6f581cf,
    0xa57ade28,
    0xdab78e26,
    0x3fadbfa4,
    0x2c3a9de4,
    0x5078920d,
    0x6a5fcc9b,
    0x547e4662,
    0xf68d13c2,
    0x90d8b8e8,
    0x2e39f75e,
    0x82c3aff5,
    0x9f5d80be,
    0x69d0937c,
    0x6fd52da9,
    0xcf2512b3,
    0xc8ac993b,
    0x10187da7,
    0xe89c636e,
    0xdb3bbb7b,
    0xcd267809,
    0x6e5918f4,
    0xec9ab701,
    0x834f9aa8,
    0xe6956e65,
    0xaaffe67e,
    0x21bccf08,
    0xef15e8e6,
    0xbae79bd9,
    0x4a6f36ce,
    0xea9f09d4,
    0x29b07cd6,
    0x31a4b2af,
    0x2a3f2331,
    0xc6a59430,
    0x35a266c0,
    0x744ebc37,
    0xfc82caa6,
    0xe090d0b0,
    0x33a7d815,
    0xf104984a,
    0x41ecdaf7,
    0x7fcd500e,
    0x1791f62f,
    0x764dd68d,
    0x43efb04d,
    0xccaa4d54,
    0xe49604df,
    0x9ed1b5e3,
    0x4c6a881b,
    0xc12c1fb8,
    0x4665517f,
    0x9d5eea04,
    0x018c355d,
    0xfa877473,
    0xfb0b412e,
    0xb3671d5a,
    0x92dbd252,
    0xe9105633,
    0x6dd64713,
    0x9ad7618c,
    0x37a10c7a,
    0x59f8148e,
    0xeb133c89,
    0xcea927ee,
    0xb761c935,
    0xe11ce5ed,
    0x7a47b13c,
    0x9cd2df59,
    0x55f2733f,
    0x1814ce79,
    0x73c737bf,
    0x53f7cdea,
    0x5ffdaa5b,
    0xdf3d6f14,
    0x7844db86,
    0xcaaff381,
    0xb968c43e,
    0x3824342c,
    0xc2a3405f,
    0x161dc372,
    0xbce2250c,
    0x283c498b,
    0xff0d9541,
    0x39a80171,
    0x080cb3de,
    0xd8b4e49c,
    0x6456c190,
    0x7bcb8461,
    0xd532b670,
    0x486c5c74,
    0xd0b85742
];
const T6 = [
    0x5051f4a7,
    0x537e4165,
    0xc31a17a4,
    0x963a275e,
    0xcb3bab6b,
    0xf11f9d45,
    0xabacfa58,
    0x934be303,
    0x552030fa,
    0xf6ad766d,
    0x9188cc76,
    0x25f5024c,
    0xfc4fe5d7,
    0xd7c52acb,
    0x80263544,
    0x8fb562a3,
    0x49deb15a,
    0x6725ba1b,
    0x9845ea0e,
    0xe15dfec0,
    0x02c32f75,
    0x12814cf0,
    0xa38d4697,
    0xc66bd3f9,
    0xe7038f5f,
    0x9515929c,
    0xebbf6d7a,
    0xda955259,
    0x2dd4be83,
    0xd3587421,
    0x2949e069,
    0x448ec9c8,
    0x6a75c289,
    0x78f48e79,
    0x6b99583e,
    0xdd27b971,
    0xb6bee14f,
    0x17f088ad,
    0x66c920ac,
    0xb47dce3a,
    0x1863df4a,
    0x82e51a31,
    0x60975133,
    0x4562537f,
    0xe0b16477,
    0x84bb6bae,
    0x1cfe81a0,
    0x94f9082b,
    0x58704868,
    0x198f45fd,
    0x8794de6c,
    0xb7527bf8,
    0x23ab73d3,
    0xe2724b02,
    0x57e31f8f,
    0x2a6655ab,
    0x07b2eb28,
    0x032fb5c2,
    0x9a86c57b,
    0xa5d33708,
    0xf2302887,
    0xb223bfa5,
    0xba02036a,
    0x5ced1682,
    0x2b8acf1c,
    0x92a779b4,
    0xf0f307f2,
    0xa14e69e2,
    0xcd65daf4,
    0xd50605be,
    0x1fd13462,
    0x8ac4a6fe,
    0x9d342e53,
    0xa0a2f355,
    0x32058ae1,
    0x75a4f6eb,
    0x390b83ec,
    0xaa4060ef,
    0x065e719f,
    0x51bd6e10,
    0xf93e218a,
    0x3d96dd06,
    0xaedd3e05,
    0x464de6bd,
    0xb591548d,
    0x0571c45d,
    0x6f0406d4,
    0xff605015,
    0x241998fb,
    0x97d6bde9,
    0xcc894043,
    0x7767d99e,
    0xbdb0e842,
    0x8807898b,
    0x38e7195b,
    0xdb79c8ee,
    0x47a17c0a,
    0xe97c420f,
    0xc9f8841e,
    0x00000000,
    0x83098086,
    0x48322bed,
    0xac1e1170,
    0x4e6c5a72,
    0xfbfd0eff,
    0x560f8538,
    0x1e3daed5,
    0x27362d39,
    0x640a0fd9,
    0x21685ca6,
    0xd19b5b54,
    0x3a24362e,
    0xb10c0a67,
    0x0f9357e7,
    0xd2b4ee96,
    0x9e1b9b91,
    0x4f80c0c5,
    0xa261dc20,
    0x695a774b,
    0x161c121a,
    0x0ae293ba,
    0xe5c0a02a,
    0x433c22e0,
    0x1d121b17,
    0x0b0e090d,
    0xadf28bc7,
    0xb92db6a8,
    0xc8141ea9,
    0x8557f119,
    0x4caf7507,
    0xbbee99dd,
    0xfda37f60,
    0x9ff70126,
    0xbc5c72f5,
    0xc544663b,
    0x345bfb7e,
    0x768b4329,
    0xdccb23c6,
    0x68b6edfc,
    0x63b8e4f1,
    0xcad731dc,
    0x10426385,
    0x40139722,
    0x2084c611,
    0x7d854a24,
    0xf8d2bb3d,
    0x11aef932,
    0x6dc729a1,
    0x4b1d9e2f,
    0xf3dcb230,
    0xec0d8652,
    0xd077c1e3,
    0x6c2bb316,
    0x99a970b9,
    0xfa119448,
    0x2247e964,
    0xc4a8fc8c,
    0x1aa0f03f,
    0xd8567d2c,
    0xef223390,
    0xc787494e,
    0xc1d938d1,
    0xfe8ccaa2,
    0x3698d40b,
    0xcfa6f581,
    0x28a57ade,
    0x26dab78e,
    0xa43fadbf,
    0xe42c3a9d,
    0x0d507892,
    0x9b6a5fcc,
    0x62547e46,
    0xc2f68d13,
    0xe890d8b8,
    0x5e2e39f7,
    0xf582c3af,
    0xbe9f5d80,
    0x7c69d093,
    0xa96fd52d,
    0xb3cf2512,
    0x3bc8ac99,
    0xa710187d,
    0x6ee89c63,
    0x7bdb3bbb,
    0x09cd2678,
    0xf46e5918,
    0x01ec9ab7,
    0xa8834f9a,
    0x65e6956e,
    0x7eaaffe6,
    0x0821bccf,
    0xe6ef15e8,
    0xd9bae79b,
    0xce4a6f36,
    0xd4ea9f09,
    0xd629b07c,
    0xaf31a4b2,
    0x312a3f23,
    0x30c6a594,
    0xc035a266,
    0x37744ebc,
    0xa6fc82ca,
    0xb0e090d0,
    0x1533a7d8,
    0x4af10498,
    0xf741ecda,
    0x0e7fcd50,
    0x2f1791f6,
    0x8d764dd6,
    0x4d43efb0,
    0x54ccaa4d,
    0xdfe49604,
    0xe39ed1b5,
    0x1b4c6a88,
    0xb8c12c1f,
    0x7f466551,
    0x049d5eea,
    0x5d018c35,
    0x73fa8774,
    0x2efb0b41,
    0x5ab3671d,
    0x5292dbd2,
    0x33e91056,
    0x136dd647,
    0x8c9ad761,
    0x7a37a10c,
    0x8e59f814,
    0x89eb133c,
    0xeecea927,
    0x35b761c9,
    0xede11ce5,
    0x3c7a47b1,
    0x599cd2df,
    0x3f55f273,
    0x791814ce,
    0xbf73c737,
    0xea53f7cd,
    0x5b5ffdaa,
    0x14df3d6f,
    0x867844db,
    0x81caaff3,
    0x3eb968c4,
    0x2c382434,
    0x5fc2a340,
    0x72161dc3,
    0x0cbce225,
    0x8b283c49,
    0x41ff0d95,
    0x7139a801,
    0xde080cb3,
    0x9cd8b4e4,
    0x906456c1,
    0x617bcb84,
    0x70d532b6,
    0x74486c5c,
    0x42d0b857
];
const T7 = [
    0xa75051f4,
    0x65537e41,
    0xa4c31a17,
    0x5e963a27,
    0x6bcb3bab,
    0x45f11f9d,
    0x58abacfa,
    0x03934be3,
    0xfa552030,
    0x6df6ad76,
    0x769188cc,
    0x4c25f502,
    0xd7fc4fe5,
    0xcbd7c52a,
    0x44802635,
    0xa38fb562,
    0x5a49deb1,
    0x1b6725ba,
    0x0e9845ea,
    0xc0e15dfe,
    0x7502c32f,
    0xf012814c,
    0x97a38d46,
    0xf9c66bd3,
    0x5fe7038f,
    0x9c951592,
    0x7aebbf6d,
    0x59da9552,
    0x832dd4be,
    0x21d35874,
    0x692949e0,
    0xc8448ec9,
    0x896a75c2,
    0x7978f48e,
    0x3e6b9958,
    0x71dd27b9,
    0x4fb6bee1,
    0xad17f088,
    0xac66c920,
    0x3ab47dce,
    0x4a1863df,
    0x3182e51a,
    0x33609751,
    0x7f456253,
    0x77e0b164,
    0xae84bb6b,
    0xa01cfe81,
    0x2b94f908,
    0x68587048,
    0xfd198f45,
    0x6c8794de,
    0xf8b7527b,
    0xd323ab73,
    0x02e2724b,
    0x8f57e31f,
    0xab2a6655,
    0x2807b2eb,
    0xc2032fb5,
    0x7b9a86c5,
    0x08a5d337,
    0x87f23028,
    0xa5b223bf,
    0x6aba0203,
    0x825ced16,
    0x1c2b8acf,
    0xb492a779,
    0xf2f0f307,
    0xe2a14e69,
    0xf4cd65da,
    0xbed50605,
    0x621fd134,
    0xfe8ac4a6,
    0x539d342e,
    0x55a0a2f3,
    0xe132058a,
    0xeb75a4f6,
    0xec390b83,
    0xefaa4060,
    0x9f065e71,
    0x1051bd6e,
    0x8af93e21,
    0x063d96dd,
    0x05aedd3e,
    0xbd464de6,
    0x8db59154,
    0x5d0571c4,
    0xd46f0406,
    0x15ff6050,
    0xfb241998,
    0xe997d6bd,
    0x43cc8940,
    0x9e7767d9,
    0x42bdb0e8,
    0x8b880789,
    0x5b38e719,
    0xeedb79c8,
    0x0a47a17c,
    0x0fe97c42,
    0x1ec9f884,
    0x00000000,
    0x86830980,
    0xed48322b,
    0x70ac1e11,
    0x724e6c5a,
    0xfffbfd0e,
    0x38560f85,
    0xd51e3dae,
    0x3927362d,
    0xd9640a0f,
    0xa621685c,
    0x54d19b5b,
    0x2e3a2436,
    0x67b10c0a,
    0xe70f9357,
    0x96d2b4ee,
    0x919e1b9b,
    0xc54f80c0,
    0x20a261dc,
    0x4b695a77,
    0x1a161c12,
    0xba0ae293,
    0x2ae5c0a0,
    0xe0433c22,
    0x171d121b,
    0x0d0b0e09,
    0xc7adf28b,
    0xa8b92db6,
    0xa9c8141e,
    0x198557f1,
    0x074caf75,
    0xddbbee99,
    0x60fda37f,
    0x269ff701,
    0xf5bc5c72,
    0x3bc54466,
    0x7e345bfb,
    0x29768b43,
    0xc6dccb23,
    0xfc68b6ed,
    0xf163b8e4,
    0xdccad731,
    0x85104263,
    0x22401397,
    0x112084c6,
    0x247d854a,
    0x3df8d2bb,
    0x3211aef9,
    0xa16dc729,
    0x2f4b1d9e,
    0x30f3dcb2,
    0x52ec0d86,
    0xe3d077c1,
    0x166c2bb3,
    0xb999a970,
    0x48fa1194,
    0x642247e9,
    0x8cc4a8fc,
    0x3f1aa0f0,
    0x2cd8567d,
    0x90ef2233,
    0x4ec78749,
    0xd1c1d938,
    0xa2fe8cca,
    0x0b3698d4,
    0x81cfa6f5,
    0xde28a57a,
    0x8e26dab7,
    0xbfa43fad,
    0x9de42c3a,
    0x920d5078,
    0xcc9b6a5f,
    0x4662547e,
    0x13c2f68d,
    0xb8e890d8,
    0xf75e2e39,
    0xaff582c3,
    0x80be9f5d,
    0x937c69d0,
    0x2da96fd5,
    0x12b3cf25,
    0x993bc8ac,
    0x7da71018,
    0x636ee89c,
    0xbb7bdb3b,
    0x7809cd26,
    0x18f46e59,
    0xb701ec9a,
    0x9aa8834f,
    0x6e65e695,
    0xe67eaaff,
    0xcf0821bc,
    0xe8e6ef15,
    0x9bd9bae7,
    0x36ce4a6f,
    0x09d4ea9f,
    0x7cd629b0,
    0xb2af31a4,
    0x23312a3f,
    0x9430c6a5,
    0x66c035a2,
    0xbc37744e,
    0xcaa6fc82,
    0xd0b0e090,
    0xd81533a7,
    0x984af104,
    0xdaf741ec,
    0x500e7fcd,
    0xf62f1791,
    0xd68d764d,
    0xb04d43ef,
    0x4d54ccaa,
    0x04dfe496,
    0xb5e39ed1,
    0x881b4c6a,
    0x1fb8c12c,
    0x517f4665,
    0xea049d5e,
    0x355d018c,
    0x7473fa87,
    0x412efb0b,
    0x1d5ab367,
    0xd25292db,
    0x5633e910,
    0x47136dd6,
    0x618c9ad7,
    0x0c7a37a1,
    0x148e59f8,
    0x3c89eb13,
    0x27eecea9,
    0xc935b761,
    0xe5ede11c,
    0xb13c7a47,
    0xdf599cd2,
    0x733f55f2,
    0xce791814,
    0x37bf73c7,
    0xcdea53f7,
    0xaa5b5ffd,
    0x6f14df3d,
    0xdb867844,
    0xf381caaf,
    0xc43eb968,
    0x342c3824,
    0x405fc2a3,
    0xc372161d,
    0x250cbce2,
    0x498b283c,
    0x9541ff0d,
    0x017139a8,
    0xb3de080c,
    0xe49cd8b4,
    0xc1906456,
    0x84617bcb,
    0xb670d532,
    0x5c74486c,
    0x5742d0b8
];
const T8 = [
    0xf4a75051,
    0x4165537e,
    0x17a4c31a,
    0x275e963a,
    0xab6bcb3b,
    0x9d45f11f,
    0xfa58abac,
    0xe303934b,
    0x30fa5520,
    0x766df6ad,
    0xcc769188,
    0x024c25f5,
    0xe5d7fc4f,
    0x2acbd7c5,
    0x35448026,
    0x62a38fb5,
    0xb15a49de,
    0xba1b6725,
    0xea0e9845,
    0xfec0e15d,
    0x2f7502c3,
    0x4cf01281,
    0x4697a38d,
    0xd3f9c66b,
    0x8f5fe703,
    0x929c9515,
    0x6d7aebbf,
    0x5259da95,
    0xbe832dd4,
    0x7421d358,
    0xe0692949,
    0xc9c8448e,
    0xc2896a75,
    0x8e7978f4,
    0x583e6b99,
    0xb971dd27,
    0xe14fb6be,
    0x88ad17f0,
    0x20ac66c9,
    0xce3ab47d,
    0xdf4a1863,
    0x1a3182e5,
    0x51336097,
    0x537f4562,
    0x6477e0b1,
    0x6bae84bb,
    0x81a01cfe,
    0x082b94f9,
    0x48685870,
    0x45fd198f,
    0xde6c8794,
    0x7bf8b752,
    0x73d323ab,
    0x4b02e272,
    0x1f8f57e3,
    0x55ab2a66,
    0xeb2807b2,
    0xb5c2032f,
    0xc57b9a86,
    0x3708a5d3,
    0x2887f230,
    0xbfa5b223,
    0x036aba02,
    0x16825ced,
    0xcf1c2b8a,
    0x79b492a7,
    0x07f2f0f3,
    0x69e2a14e,
    0xdaf4cd65,
    0x05bed506,
    0x34621fd1,
    0xa6fe8ac4,
    0x2e539d34,
    0xf355a0a2,
    0x8ae13205,
    0xf6eb75a4,
    0x83ec390b,
    0x60efaa40,
    0x719f065e,
    0x6e1051bd,
    0x218af93e,
    0xdd063d96,
    0x3e05aedd,
    0xe6bd464d,
    0x548db591,
    0xc45d0571,
    0x06d46f04,
    0x5015ff60,
    0x98fb2419,
    0xbde997d6,
    0x4043cc89,
    0xd99e7767,
    0xe842bdb0,
    0x898b8807,
    0x195b38e7,
    0xc8eedb79,
    0x7c0a47a1,
    0x420fe97c,
    0x841ec9f8,
    0x00000000,
    0x80868309,
    0x2bed4832,
    0x1170ac1e,
    0x5a724e6c,
    0x0efffbfd,
    0x8538560f,
    0xaed51e3d,
    0x2d392736,
    0x0fd9640a,
    0x5ca62168,
    0x5b54d19b,
    0x362e3a24,
    0x0a67b10c,
    0x57e70f93,
    0xee96d2b4,
    0x9b919e1b,
    0xc0c54f80,
    0xdc20a261,
    0x774b695a,
    0x121a161c,
    0x93ba0ae2,
    0xa02ae5c0,
    0x22e0433c,
    0x1b171d12,
    0x090d0b0e,
    0x8bc7adf2,
    0xb6a8b92d,
    0x1ea9c814,
    0xf1198557,
    0x75074caf,
    0x99ddbbee,
    0x7f60fda3,
    0x01269ff7,
    0x72f5bc5c,
    0x663bc544,
    0xfb7e345b,
    0x4329768b,
    0x23c6dccb,
    0xedfc68b6,
    0xe4f163b8,
    0x31dccad7,
    0x63851042,
    0x97224013,
    0xc6112084,
    0x4a247d85,
    0xbb3df8d2,
    0xf93211ae,
    0x29a16dc7,
    0x9e2f4b1d,
    0xb230f3dc,
    0x8652ec0d,
    0xc1e3d077,
    0xb3166c2b,
    0x70b999a9,
    0x9448fa11,
    0xe9642247,
    0xfc8cc4a8,
    0xf03f1aa0,
    0x7d2cd856,
    0x3390ef22,
    0x494ec787,
    0x38d1c1d9,
    0xcaa2fe8c,
    0xd40b3698,
    0xf581cfa6,
    0x7ade28a5,
    0xb78e26da,
    0xadbfa43f,
    0x3a9de42c,
    0x78920d50,
    0x5fcc9b6a,
    0x7e466254,
    0x8d13c2f6,
    0xd8b8e890,
    0x39f75e2e,
    0xc3aff582,
    0x5d80be9f,
    0xd0937c69,
    0xd52da96f,
    0x2512b3cf,
    0xac993bc8,
    0x187da710,
    0x9c636ee8,
    0x3bbb7bdb,
    0x267809cd,
    0x5918f46e,
    0x9ab701ec,
    0x4f9aa883,
    0x956e65e6,
    0xffe67eaa,
    0xbccf0821,
    0x15e8e6ef,
    0xe79bd9ba,
    0x6f36ce4a,
    0x9f09d4ea,
    0xb07cd629,
    0xa4b2af31,
    0x3f23312a,
    0xa59430c6,
    0xa266c035,
    0x4ebc3774,
    0x82caa6fc,
    0x90d0b0e0,
    0xa7d81533,
    0x04984af1,
    0xecdaf741,
    0xcd500e7f,
    0x91f62f17,
    0x4dd68d76,
    0xefb04d43,
    0xaa4d54cc,
    0x9604dfe4,
    0xd1b5e39e,
    0x6a881b4c,
    0x2c1fb8c1,
    0x65517f46,
    0x5eea049d,
    0x8c355d01,
    0x877473fa,
    0x0b412efb,
    0x671d5ab3,
    0xdbd25292,
    0x105633e9,
    0xd647136d,
    0xd7618c9a,
    0xa10c7a37,
    0xf8148e59,
    0x133c89eb,
    0xa927eece,
    0x61c935b7,
    0x1ce5ede1,
    0x47b13c7a,
    0xd2df599c,
    0xf2733f55,
    0x14ce7918,
    0xc737bf73,
    0xf7cdea53,
    0xfdaa5b5f,
    0x3d6f14df,
    0x44db8678,
    0xaff381ca,
    0x68c43eb9,
    0x24342c38,
    0xa3405fc2,
    0x1dc37216,
    0xe2250cbc,
    0x3c498b28,
    0x0d9541ff,
    0xa8017139,
    0x0cb3de08,
    0xb4e49cd8,
    0x56c19064,
    0xcb84617b,
    0x32b670d5,
    0x6c5c7448,
    0xb85742d0
];
// Transformations for decryption key expansion
const U1 = [
    0x00000000,
    0x0e090d0b,
    0x1c121a16,
    0x121b171d,
    0x3824342c,
    0x362d3927,
    0x24362e3a,
    0x2a3f2331,
    0x70486858,
    0x7e416553,
    0x6c5a724e,
    0x62537f45,
    0x486c5c74,
    0x4665517f,
    0x547e4662,
    0x5a774b69,
    0xe090d0b0,
    0xee99ddbb,
    0xfc82caa6,
    0xf28bc7ad,
    0xd8b4e49c,
    0xd6bde997,
    0xc4a6fe8a,
    0xcaaff381,
    0x90d8b8e8,
    0x9ed1b5e3,
    0x8ccaa2fe,
    0x82c3aff5,
    0xa8fc8cc4,
    0xa6f581cf,
    0xb4ee96d2,
    0xbae79bd9,
    0xdb3bbb7b,
    0xd532b670,
    0xc729a16d,
    0xc920ac66,
    0xe31f8f57,
    0xed16825c,
    0xff0d9541,
    0xf104984a,
    0xab73d323,
    0xa57ade28,
    0xb761c935,
    0xb968c43e,
    0x9357e70f,
    0x9d5eea04,
    0x8f45fd19,
    0x814cf012,
    0x3bab6bcb,
    0x35a266c0,
    0x27b971dd,
    0x29b07cd6,
    0x038f5fe7,
    0x0d8652ec,
    0x1f9d45f1,
    0x119448fa,
    0x4be30393,
    0x45ea0e98,
    0x57f11985,
    0x59f8148e,
    0x73c737bf,
    0x7dce3ab4,
    0x6fd52da9,
    0x61dc20a2,
    0xad766df6,
    0xa37f60fd,
    0xb16477e0,
    0xbf6d7aeb,
    0x955259da,
    0x9b5b54d1,
    0x894043cc,
    0x87494ec7,
    0xdd3e05ae,
    0xd33708a5,
    0xc12c1fb8,
    0xcf2512b3,
    0xe51a3182,
    0xeb133c89,
    0xf9082b94,
    0xf701269f,
    0x4de6bd46,
    0x43efb04d,
    0x51f4a750,
    0x5ffdaa5b,
    0x75c2896a,
    0x7bcb8461,
    0x69d0937c,
    0x67d99e77,
    0x3daed51e,
    0x33a7d815,
    0x21bccf08,
    0x2fb5c203,
    0x058ae132,
    0x0b83ec39,
    0x1998fb24,
    0x1791f62f,
    0x764dd68d,
    0x7844db86,
    0x6a5fcc9b,
    0x6456c190,
    0x4e69e2a1,
    0x4060efaa,
    0x527bf8b7,
    0x5c72f5bc,
    0x0605bed5,
    0x080cb3de,
    0x1a17a4c3,
    0x141ea9c8,
    0x3e218af9,
    0x302887f2,
    0x223390ef,
    0x2c3a9de4,
    0x96dd063d,
    0x98d40b36,
    0x8acf1c2b,
    0x84c61120,
    0xaef93211,
    0xa0f03f1a,
    0xb2eb2807,
    0xbce2250c,
    0xe6956e65,
    0xe89c636e,
    0xfa877473,
    0xf48e7978,
    0xdeb15a49,
    0xd0b85742,
    0xc2a3405f,
    0xccaa4d54,
    0x41ecdaf7,
    0x4fe5d7fc,
    0x5dfec0e1,
    0x53f7cdea,
    0x79c8eedb,
    0x77c1e3d0,
    0x65daf4cd,
    0x6bd3f9c6,
    0x31a4b2af,
    0x3fadbfa4,
    0x2db6a8b9,
    0x23bfa5b2,
    0x09808683,
    0x07898b88,
    0x15929c95,
    0x1b9b919e,
    0xa17c0a47,
    0xaf75074c,
    0xbd6e1051,
    0xb3671d5a,
    0x99583e6b,
    0x97513360,
    0x854a247d,
    0x8b432976,
    0xd134621f,
    0xdf3d6f14,
    0xcd267809,
    0xc32f7502,
    0xe9105633,
    0xe7195b38,
    0xf5024c25,
    0xfb0b412e,
    0x9ad7618c,
    0x94de6c87,
    0x86c57b9a,
    0x88cc7691,
    0xa2f355a0,
    0xacfa58ab,
    0xbee14fb6,
    0xb0e842bd,
    0xea9f09d4,
    0xe49604df,
    0xf68d13c2,
    0xf8841ec9,
    0xd2bb3df8,
    0xdcb230f3,
    0xcea927ee,
    0xc0a02ae5,
    0x7a47b13c,
    0x744ebc37,
    0x6655ab2a,
    0x685ca621,
    0x42638510,
    0x4c6a881b,
    0x5e719f06,
    0x5078920d,
    0x0a0fd964,
    0x0406d46f,
    0x161dc372,
    0x1814ce79,
    0x322bed48,
    0x3c22e043,
    0x2e39f75e,
    0x2030fa55,
    0xec9ab701,
    0xe293ba0a,
    0xf088ad17,
    0xfe81a01c,
    0xd4be832d,
    0xdab78e26,
    0xc8ac993b,
    0xc6a59430,
    0x9cd2df59,
    0x92dbd252,
    0x80c0c54f,
    0x8ec9c844,
    0xa4f6eb75,
    0xaaffe67e,
    0xb8e4f163,
    0xb6edfc68,
    0x0c0a67b1,
    0x02036aba,
    0x10187da7,
    0x1e1170ac,
    0x342e539d,
    0x3a275e96,
    0x283c498b,
    0x26354480,
    0x7c420fe9,
    0x724b02e2,
    0x605015ff,
    0x6e5918f4,
    0x44663bc5,
    0x4a6f36ce,
    0x587421d3,
    0x567d2cd8,
    0x37a10c7a,
    0x39a80171,
    0x2bb3166c,
    0x25ba1b67,
    0x0f853856,
    0x018c355d,
    0x13972240,
    0x1d9e2f4b,
    0x47e96422,
    0x49e06929,
    0x5bfb7e34,
    0x55f2733f,
    0x7fcd500e,
    0x71c45d05,
    0x63df4a18,
    0x6dd64713,
    0xd731dcca,
    0xd938d1c1,
    0xcb23c6dc,
    0xc52acbd7,
    0xef15e8e6,
    0xe11ce5ed,
    0xf307f2f0,
    0xfd0efffb,
    0xa779b492,
    0xa970b999,
    0xbb6bae84,
    0xb562a38f,
    0x9f5d80be,
    0x91548db5,
    0x834f9aa8,
    0x8d4697a3
];
const U2 = [
    0x00000000,
    0x0b0e090d,
    0x161c121a,
    0x1d121b17,
    0x2c382434,
    0x27362d39,
    0x3a24362e,
    0x312a3f23,
    0x58704868,
    0x537e4165,
    0x4e6c5a72,
    0x4562537f,
    0x74486c5c,
    0x7f466551,
    0x62547e46,
    0x695a774b,
    0xb0e090d0,
    0xbbee99dd,
    0xa6fc82ca,
    0xadf28bc7,
    0x9cd8b4e4,
    0x97d6bde9,
    0x8ac4a6fe,
    0x81caaff3,
    0xe890d8b8,
    0xe39ed1b5,
    0xfe8ccaa2,
    0xf582c3af,
    0xc4a8fc8c,
    0xcfa6f581,
    0xd2b4ee96,
    0xd9bae79b,
    0x7bdb3bbb,
    0x70d532b6,
    0x6dc729a1,
    0x66c920ac,
    0x57e31f8f,
    0x5ced1682,
    0x41ff0d95,
    0x4af10498,
    0x23ab73d3,
    0x28a57ade,
    0x35b761c9,
    0x3eb968c4,
    0x0f9357e7,
    0x049d5eea,
    0x198f45fd,
    0x12814cf0,
    0xcb3bab6b,
    0xc035a266,
    0xdd27b971,
    0xd629b07c,
    0xe7038f5f,
    0xec0d8652,
    0xf11f9d45,
    0xfa119448,
    0x934be303,
    0x9845ea0e,
    0x8557f119,
    0x8e59f814,
    0xbf73c737,
    0xb47dce3a,
    0xa96fd52d,
    0xa261dc20,
    0xf6ad766d,
    0xfda37f60,
    0xe0b16477,
    0xebbf6d7a,
    0xda955259,
    0xd19b5b54,
    0xcc894043,
    0xc787494e,
    0xaedd3e05,
    0xa5d33708,
    0xb8c12c1f,
    0xb3cf2512,
    0x82e51a31,
    0x89eb133c,
    0x94f9082b,
    0x9ff70126,
    0x464de6bd,
    0x4d43efb0,
    0x5051f4a7,
    0x5b5ffdaa,
    0x6a75c289,
    0x617bcb84,
    0x7c69d093,
    0x7767d99e,
    0x1e3daed5,
    0x1533a7d8,
    0x0821bccf,
    0x032fb5c2,
    0x32058ae1,
    0x390b83ec,
    0x241998fb,
    0x2f1791f6,
    0x8d764dd6,
    0x867844db,
    0x9b6a5fcc,
    0x906456c1,
    0xa14e69e2,
    0xaa4060ef,
    0xb7527bf8,
    0xbc5c72f5,
    0xd50605be,
    0xde080cb3,
    0xc31a17a4,
    0xc8141ea9,
    0xf93e218a,
    0xf2302887,
    0xef223390,
    0xe42c3a9d,
    0x3d96dd06,
    0x3698d40b,
    0x2b8acf1c,
    0x2084c611,
    0x11aef932,
    0x1aa0f03f,
    0x07b2eb28,
    0x0cbce225,
    0x65e6956e,
    0x6ee89c63,
    0x73fa8774,
    0x78f48e79,
    0x49deb15a,
    0x42d0b857,
    0x5fc2a340,
    0x54ccaa4d,
    0xf741ecda,
    0xfc4fe5d7,
    0xe15dfec0,
    0xea53f7cd,
    0xdb79c8ee,
    0xd077c1e3,
    0xcd65daf4,
    0xc66bd3f9,
    0xaf31a4b2,
    0xa43fadbf,
    0xb92db6a8,
    0xb223bfa5,
    0x83098086,
    0x8807898b,
    0x9515929c,
    0x9e1b9b91,
    0x47a17c0a,
    0x4caf7507,
    0x51bd6e10,
    0x5ab3671d,
    0x6b99583e,
    0x60975133,
    0x7d854a24,
    0x768b4329,
    0x1fd13462,
    0x14df3d6f,
    0x09cd2678,
    0x02c32f75,
    0x33e91056,
    0x38e7195b,
    0x25f5024c,
    0x2efb0b41,
    0x8c9ad761,
    0x8794de6c,
    0x9a86c57b,
    0x9188cc76,
    0xa0a2f355,
    0xabacfa58,
    0xb6bee14f,
    0xbdb0e842,
    0xd4ea9f09,
    0xdfe49604,
    0xc2f68d13,
    0xc9f8841e,
    0xf8d2bb3d,
    0xf3dcb230,
    0xeecea927,
    0xe5c0a02a,
    0x3c7a47b1,
    0x37744ebc,
    0x2a6655ab,
    0x21685ca6,
    0x10426385,
    0x1b4c6a88,
    0x065e719f,
    0x0d507892,
    0x640a0fd9,
    0x6f0406d4,
    0x72161dc3,
    0x791814ce,
    0x48322bed,
    0x433c22e0,
    0x5e2e39f7,
    0x552030fa,
    0x01ec9ab7,
    0x0ae293ba,
    0x17f088ad,
    0x1cfe81a0,
    0x2dd4be83,
    0x26dab78e,
    0x3bc8ac99,
    0x30c6a594,
    0x599cd2df,
    0x5292dbd2,
    0x4f80c0c5,
    0x448ec9c8,
    0x75a4f6eb,
    0x7eaaffe6,
    0x63b8e4f1,
    0x68b6edfc,
    0xb10c0a67,
    0xba02036a,
    0xa710187d,
    0xac1e1170,
    0x9d342e53,
    0x963a275e,
    0x8b283c49,
    0x80263544,
    0xe97c420f,
    0xe2724b02,
    0xff605015,
    0xf46e5918,
    0xc544663b,
    0xce4a6f36,
    0xd3587421,
    0xd8567d2c,
    0x7a37a10c,
    0x7139a801,
    0x6c2bb316,
    0x6725ba1b,
    0x560f8538,
    0x5d018c35,
    0x40139722,
    0x4b1d9e2f,
    0x2247e964,
    0x2949e069,
    0x345bfb7e,
    0x3f55f273,
    0x0e7fcd50,
    0x0571c45d,
    0x1863df4a,
    0x136dd647,
    0xcad731dc,
    0xc1d938d1,
    0xdccb23c6,
    0xd7c52acb,
    0xe6ef15e8,
    0xede11ce5,
    0xf0f307f2,
    0xfbfd0eff,
    0x92a779b4,
    0x99a970b9,
    0x84bb6bae,
    0x8fb562a3,
    0xbe9f5d80,
    0xb591548d,
    0xa8834f9a,
    0xa38d4697
];
const U3 = [
    0x00000000,
    0x0d0b0e09,
    0x1a161c12,
    0x171d121b,
    0x342c3824,
    0x3927362d,
    0x2e3a2436,
    0x23312a3f,
    0x68587048,
    0x65537e41,
    0x724e6c5a,
    0x7f456253,
    0x5c74486c,
    0x517f4665,
    0x4662547e,
    0x4b695a77,
    0xd0b0e090,
    0xddbbee99,
    0xcaa6fc82,
    0xc7adf28b,
    0xe49cd8b4,
    0xe997d6bd,
    0xfe8ac4a6,
    0xf381caaf,
    0xb8e890d8,
    0xb5e39ed1,
    0xa2fe8cca,
    0xaff582c3,
    0x8cc4a8fc,
    0x81cfa6f5,
    0x96d2b4ee,
    0x9bd9bae7,
    0xbb7bdb3b,
    0xb670d532,
    0xa16dc729,
    0xac66c920,
    0x8f57e31f,
    0x825ced16,
    0x9541ff0d,
    0x984af104,
    0xd323ab73,
    0xde28a57a,
    0xc935b761,
    0xc43eb968,
    0xe70f9357,
    0xea049d5e,
    0xfd198f45,
    0xf012814c,
    0x6bcb3bab,
    0x66c035a2,
    0x71dd27b9,
    0x7cd629b0,
    0x5fe7038f,
    0x52ec0d86,
    0x45f11f9d,
    0x48fa1194,
    0x03934be3,
    0x0e9845ea,
    0x198557f1,
    0x148e59f8,
    0x37bf73c7,
    0x3ab47dce,
    0x2da96fd5,
    0x20a261dc,
    0x6df6ad76,
    0x60fda37f,
    0x77e0b164,
    0x7aebbf6d,
    0x59da9552,
    0x54d19b5b,
    0x43cc8940,
    0x4ec78749,
    0x05aedd3e,
    0x08a5d337,
    0x1fb8c12c,
    0x12b3cf25,
    0x3182e51a,
    0x3c89eb13,
    0x2b94f908,
    0x269ff701,
    0xbd464de6,
    0xb04d43ef,
    0xa75051f4,
    0xaa5b5ffd,
    0x896a75c2,
    0x84617bcb,
    0x937c69d0,
    0x9e7767d9,
    0xd51e3dae,
    0xd81533a7,
    0xcf0821bc,
    0xc2032fb5,
    0xe132058a,
    0xec390b83,
    0xfb241998,
    0xf62f1791,
    0xd68d764d,
    0xdb867844,
    0xcc9b6a5f,
    0xc1906456,
    0xe2a14e69,
    0xefaa4060,
    0xf8b7527b,
    0xf5bc5c72,
    0xbed50605,
    0xb3de080c,
    0xa4c31a17,
    0xa9c8141e,
    0x8af93e21,
    0x87f23028,
    0x90ef2233,
    0x9de42c3a,
    0x063d96dd,
    0x0b3698d4,
    0x1c2b8acf,
    0x112084c6,
    0x3211aef9,
    0x3f1aa0f0,
    0x2807b2eb,
    0x250cbce2,
    0x6e65e695,
    0x636ee89c,
    0x7473fa87,
    0x7978f48e,
    0x5a49deb1,
    0x5742d0b8,
    0x405fc2a3,
    0x4d54ccaa,
    0xdaf741ec,
    0xd7fc4fe5,
    0xc0e15dfe,
    0xcdea53f7,
    0xeedb79c8,
    0xe3d077c1,
    0xf4cd65da,
    0xf9c66bd3,
    0xb2af31a4,
    0xbfa43fad,
    0xa8b92db6,
    0xa5b223bf,
    0x86830980,
    0x8b880789,
    0x9c951592,
    0x919e1b9b,
    0x0a47a17c,
    0x074caf75,
    0x1051bd6e,
    0x1d5ab367,
    0x3e6b9958,
    0x33609751,
    0x247d854a,
    0x29768b43,
    0x621fd134,
    0x6f14df3d,
    0x7809cd26,
    0x7502c32f,
    0x5633e910,
    0x5b38e719,
    0x4c25f502,
    0x412efb0b,
    0x618c9ad7,
    0x6c8794de,
    0x7b9a86c5,
    0x769188cc,
    0x55a0a2f3,
    0x58abacfa,
    0x4fb6bee1,
    0x42bdb0e8,
    0x09d4ea9f,
    0x04dfe496,
    0x13c2f68d,
    0x1ec9f884,
    0x3df8d2bb,
    0x30f3dcb2,
    0x27eecea9,
    0x2ae5c0a0,
    0xb13c7a47,
    0xbc37744e,
    0xab2a6655,
    0xa621685c,
    0x85104263,
    0x881b4c6a,
    0x9f065e71,
    0x920d5078,
    0xd9640a0f,
    0xd46f0406,
    0xc372161d,
    0xce791814,
    0xed48322b,
    0xe0433c22,
    0xf75e2e39,
    0xfa552030,
    0xb701ec9a,
    0xba0ae293,
    0xad17f088,
    0xa01cfe81,
    0x832dd4be,
    0x8e26dab7,
    0x993bc8ac,
    0x9430c6a5,
    0xdf599cd2,
    0xd25292db,
    0xc54f80c0,
    0xc8448ec9,
    0xeb75a4f6,
    0xe67eaaff,
    0xf163b8e4,
    0xfc68b6ed,
    0x67b10c0a,
    0x6aba0203,
    0x7da71018,
    0x70ac1e11,
    0x539d342e,
    0x5e963a27,
    0x498b283c,
    0x44802635,
    0x0fe97c42,
    0x02e2724b,
    0x15ff6050,
    0x18f46e59,
    0x3bc54466,
    0x36ce4a6f,
    0x21d35874,
    0x2cd8567d,
    0x0c7a37a1,
    0x017139a8,
    0x166c2bb3,
    0x1b6725ba,
    0x38560f85,
    0x355d018c,
    0x22401397,
    0x2f4b1d9e,
    0x642247e9,
    0x692949e0,
    0x7e345bfb,
    0x733f55f2,
    0x500e7fcd,
    0x5d0571c4,
    0x4a1863df,
    0x47136dd6,
    0xdccad731,
    0xd1c1d938,
    0xc6dccb23,
    0xcbd7c52a,
    0xe8e6ef15,
    0xe5ede11c,
    0xf2f0f307,
    0xfffbfd0e,
    0xb492a779,
    0xb999a970,
    0xae84bb6b,
    0xa38fb562,
    0x80be9f5d,
    0x8db59154,
    0x9aa8834f,
    0x97a38d46
];
const U4 = [
    0x00000000,
    0x090d0b0e,
    0x121a161c,
    0x1b171d12,
    0x24342c38,
    0x2d392736,
    0x362e3a24,
    0x3f23312a,
    0x48685870,
    0x4165537e,
    0x5a724e6c,
    0x537f4562,
    0x6c5c7448,
    0x65517f46,
    0x7e466254,
    0x774b695a,
    0x90d0b0e0,
    0x99ddbbee,
    0x82caa6fc,
    0x8bc7adf2,
    0xb4e49cd8,
    0xbde997d6,
    0xa6fe8ac4,
    0xaff381ca,
    0xd8b8e890,
    0xd1b5e39e,
    0xcaa2fe8c,
    0xc3aff582,
    0xfc8cc4a8,
    0xf581cfa6,
    0xee96d2b4,
    0xe79bd9ba,
    0x3bbb7bdb,
    0x32b670d5,
    0x29a16dc7,
    0x20ac66c9,
    0x1f8f57e3,
    0x16825ced,
    0x0d9541ff,
    0x04984af1,
    0x73d323ab,
    0x7ade28a5,
    0x61c935b7,
    0x68c43eb9,
    0x57e70f93,
    0x5eea049d,
    0x45fd198f,
    0x4cf01281,
    0xab6bcb3b,
    0xa266c035,
    0xb971dd27,
    0xb07cd629,
    0x8f5fe703,
    0x8652ec0d,
    0x9d45f11f,
    0x9448fa11,
    0xe303934b,
    0xea0e9845,
    0xf1198557,
    0xf8148e59,
    0xc737bf73,
    0xce3ab47d,
    0xd52da96f,
    0xdc20a261,
    0x766df6ad,
    0x7f60fda3,
    0x6477e0b1,
    0x6d7aebbf,
    0x5259da95,
    0x5b54d19b,
    0x4043cc89,
    0x494ec787,
    0x3e05aedd,
    0x3708a5d3,
    0x2c1fb8c1,
    0x2512b3cf,
    0x1a3182e5,
    0x133c89eb,
    0x082b94f9,
    0x01269ff7,
    0xe6bd464d,
    0xefb04d43,
    0xf4a75051,
    0xfdaa5b5f,
    0xc2896a75,
    0xcb84617b,
    0xd0937c69,
    0xd99e7767,
    0xaed51e3d,
    0xa7d81533,
    0xbccf0821,
    0xb5c2032f,
    0x8ae13205,
    0x83ec390b,
    0x98fb2419,
    0x91f62f17,
    0x4dd68d76,
    0x44db8678,
    0x5fcc9b6a,
    0x56c19064,
    0x69e2a14e,
    0x60efaa40,
    0x7bf8b752,
    0x72f5bc5c,
    0x05bed506,
    0x0cb3de08,
    0x17a4c31a,
    0x1ea9c814,
    0x218af93e,
    0x2887f230,
    0x3390ef22,
    0x3a9de42c,
    0xdd063d96,
    0xd40b3698,
    0xcf1c2b8a,
    0xc6112084,
    0xf93211ae,
    0xf03f1aa0,
    0xeb2807b2,
    0xe2250cbc,
    0x956e65e6,
    0x9c636ee8,
    0x877473fa,
    0x8e7978f4,
    0xb15a49de,
    0xb85742d0,
    0xa3405fc2,
    0xaa4d54cc,
    0xecdaf741,
    0xe5d7fc4f,
    0xfec0e15d,
    0xf7cdea53,
    0xc8eedb79,
    0xc1e3d077,
    0xdaf4cd65,
    0xd3f9c66b,
    0xa4b2af31,
    0xadbfa43f,
    0xb6a8b92d,
    0xbfa5b223,
    0x80868309,
    0x898b8807,
    0x929c9515,
    0x9b919e1b,
    0x7c0a47a1,
    0x75074caf,
    0x6e1051bd,
    0x671d5ab3,
    0x583e6b99,
    0x51336097,
    0x4a247d85,
    0x4329768b,
    0x34621fd1,
    0x3d6f14df,
    0x267809cd,
    0x2f7502c3,
    0x105633e9,
    0x195b38e7,
    0x024c25f5,
    0x0b412efb,
    0xd7618c9a,
    0xde6c8794,
    0xc57b9a86,
    0xcc769188,
    0xf355a0a2,
    0xfa58abac,
    0xe14fb6be,
    0xe842bdb0,
    0x9f09d4ea,
    0x9604dfe4,
    0x8d13c2f6,
    0x841ec9f8,
    0xbb3df8d2,
    0xb230f3dc,
    0xa927eece,
    0xa02ae5c0,
    0x47b13c7a,
    0x4ebc3774,
    0x55ab2a66,
    0x5ca62168,
    0x63851042,
    0x6a881b4c,
    0x719f065e,
    0x78920d50,
    0x0fd9640a,
    0x06d46f04,
    0x1dc37216,
    0x14ce7918,
    0x2bed4832,
    0x22e0433c,
    0x39f75e2e,
    0x30fa5520,
    0x9ab701ec,
    0x93ba0ae2,
    0x88ad17f0,
    0x81a01cfe,
    0xbe832dd4,
    0xb78e26da,
    0xac993bc8,
    0xa59430c6,
    0xd2df599c,
    0xdbd25292,
    0xc0c54f80,
    0xc9c8448e,
    0xf6eb75a4,
    0xffe67eaa,
    0xe4f163b8,
    0xedfc68b6,
    0x0a67b10c,
    0x036aba02,
    0x187da710,
    0x1170ac1e,
    0x2e539d34,
    0x275e963a,
    0x3c498b28,
    0x35448026,
    0x420fe97c,
    0x4b02e272,
    0x5015ff60,
    0x5918f46e,
    0x663bc544,
    0x6f36ce4a,
    0x7421d358,
    0x7d2cd856,
    0xa10c7a37,
    0xa8017139,
    0xb3166c2b,
    0xba1b6725,
    0x8538560f,
    0x8c355d01,
    0x97224013,
    0x9e2f4b1d,
    0xe9642247,
    0xe0692949,
    0xfb7e345b,
    0xf2733f55,
    0xcd500e7f,
    0xc45d0571,
    0xdf4a1863,
    0xd647136d,
    0x31dccad7,
    0x38d1c1d9,
    0x23c6dccb,
    0x2acbd7c5,
    0x15e8e6ef,
    0x1ce5ede1,
    0x07f2f0f3,
    0x0efffbfd,
    0x79b492a7,
    0x70b999a9,
    0x6bae84bb,
    0x62a38fb5,
    0x5d80be9f,
    0x548db591,
    0x4f9aa883,
    0x4697a38d
];
function convertToInt32(bytes) {
    const result = [];
    for(let i = 0; i < bytes.length; i += 4){
        result.push(bytes[i] << 24 | bytes[i + 1] << 16 | bytes[i + 2] << 8 | bytes[i + 3]);
    }
    return result;
}
class AES {
    get key() {
        return __classPrivateFieldGet(this, _AES_key, "f").slice();
    }
    constructor(key){
        _AES_key.set(this, void 0);
        _AES_Kd.set(this, void 0);
        _AES_Ke.set(this, void 0);
        if (!(this instanceof AES)) {
            throw Error('AES must be instanitated with `new`');
        }
        __classPrivateFieldSet(this, _AES_key, new Uint8Array(key), "f");
        const rounds = numberOfRounds[this.key.length];
        if (rounds == null) {
            throw new TypeError('invalid key size (must be 16, 24 or 32 bytes)');
        }
        // encryption round keys
        __classPrivateFieldSet(this, _AES_Ke, [], "f");
        // decryption round keys
        __classPrivateFieldSet(this, _AES_Kd, [], "f");
        for(let i = 0; i <= rounds; i++){
            __classPrivateFieldGet(this, _AES_Ke, "f").push([
                0,
                0,
                0,
                0
            ]);
            __classPrivateFieldGet(this, _AES_Kd, "f").push([
                0,
                0,
                0,
                0
            ]);
        }
        const roundKeyCount = (rounds + 1) * 4;
        const KC = this.key.length / 4;
        // convert the key into ints
        const tk = convertToInt32(this.key);
        // copy values into round key arrays
        let index;
        for(let i = 0; i < KC; i++){
            index = i >> 2;
            __classPrivateFieldGet(this, _AES_Ke, "f")[index][i % 4] = tk[i];
            __classPrivateFieldGet(this, _AES_Kd, "f")[rounds - index][i % 4] = tk[i];
        }
        // key expansion (fips-197 section 5.2)
        let rconpointer = 0;
        let t = KC, tt;
        while(t < roundKeyCount){
            tt = tk[KC - 1];
            tk[0] ^= S[tt >> 16 & 0xFF] << 24 ^ S[tt >> 8 & 0xFF] << 16 ^ S[tt & 0xFF] << 8 ^ S[tt >> 24 & 0xFF] ^ rcon[rconpointer] << 24;
            rconpointer += 1;
            // key expansion (for non-256 bit)
            if (KC != 8) {
                for(let i = 1; i < KC; i++){
                    tk[i] ^= tk[i - 1];
                }
            // key expansion for 256-bit keys is "slightly different" (fips-197)
            } else {
                for(let i = 1; i < KC / 2; i++){
                    tk[i] ^= tk[i - 1];
                }
                tt = tk[KC / 2 - 1];
                tk[KC / 2] ^= S[tt & 0xFF] ^ S[tt >> 8 & 0xFF] << 8 ^ S[tt >> 16 & 0xFF] << 16 ^ S[tt >> 24 & 0xFF] << 24;
                for(let i = KC / 2 + 1; i < KC; i++){
                    tk[i] ^= tk[i - 1];
                }
            }
            // copy values into round key arrays
            let i = 0, r, c;
            while(i < KC && t < roundKeyCount){
                r = t >> 2;
                c = t % 4;
                __classPrivateFieldGet(this, _AES_Ke, "f")[r][c] = tk[i];
                __classPrivateFieldGet(this, _AES_Kd, "f")[rounds - r][c] = tk[i++];
                t++;
            }
        }
        // inverse-cipher-ify the decryption round key (fips-197 section 5.3)
        for(let r = 1; r < rounds; r++){
            for(let c = 0; c < 4; c++){
                tt = __classPrivateFieldGet(this, _AES_Kd, "f")[r][c];
                __classPrivateFieldGet(this, _AES_Kd, "f")[r][c] = U1[tt >> 24 & 0xFF] ^ U2[tt >> 16 & 0xFF] ^ U3[tt >> 8 & 0xFF] ^ U4[tt & 0xFF];
            }
        }
    }
    encrypt(plaintext) {
        if (plaintext.length != 16) {
            throw new TypeError('invalid plaintext size (must be 16 bytes)');
        }
        const rounds = __classPrivateFieldGet(this, _AES_Ke, "f").length - 1;
        const a = [
            0,
            0,
            0,
            0
        ];
        // convert plaintext to (ints ^ key)
        let t = convertToInt32(plaintext);
        for(let i = 0; i < 4; i++){
            t[i] ^= __classPrivateFieldGet(this, _AES_Ke, "f")[0][i];
        }
        // apply round transforms
        for(let r = 1; r < rounds; r++){
            for(let i = 0; i < 4; i++){
                a[i] = T1[t[i] >> 24 & 0xff] ^ T2[t[(i + 1) % 4] >> 16 & 0xff] ^ T3[t[(i + 2) % 4] >> 8 & 0xff] ^ T4[t[(i + 3) % 4] & 0xff] ^ __classPrivateFieldGet(this, _AES_Ke, "f")[r][i];
            }
            t = a.slice();
        }
        // the last round is special
        const result = new Uint8Array(16);
        let tt = 0;
        for(let i = 0; i < 4; i++){
            tt = __classPrivateFieldGet(this, _AES_Ke, "f")[rounds][i];
            result[4 * i] = (S[t[i] >> 24 & 0xff] ^ tt >> 24) & 0xff;
            result[4 * i + 1] = (S[t[(i + 1) % 4] >> 16 & 0xff] ^ tt >> 16) & 0xff;
            result[4 * i + 2] = (S[t[(i + 2) % 4] >> 8 & 0xff] ^ tt >> 8) & 0xff;
            result[4 * i + 3] = (S[t[(i + 3) % 4] & 0xff] ^ tt) & 0xff;
        }
        return result;
    }
    decrypt(ciphertext) {
        if (ciphertext.length != 16) {
            throw new TypeError('invalid ciphertext size (must be 16 bytes)');
        }
        const rounds = __classPrivateFieldGet(this, _AES_Kd, "f").length - 1;
        const a = [
            0,
            0,
            0,
            0
        ];
        // convert plaintext to (ints ^ key)
        let t = convertToInt32(ciphertext);
        for(let i = 0; i < 4; i++){
            t[i] ^= __classPrivateFieldGet(this, _AES_Kd, "f")[0][i];
        }
        // apply round transforms
        for(let r = 1; r < rounds; r++){
            for(let i = 0; i < 4; i++){
                a[i] = T5[t[i] >> 24 & 0xff] ^ T6[t[(i + 3) % 4] >> 16 & 0xff] ^ T7[t[(i + 2) % 4] >> 8 & 0xff] ^ T8[t[(i + 1) % 4] & 0xff] ^ __classPrivateFieldGet(this, _AES_Kd, "f")[r][i];
            }
            t = a.slice();
        }
        // the last round is special
        const result = new Uint8Array(16);
        let tt = 0;
        for(let i = 0; i < 4; i++){
            tt = __classPrivateFieldGet(this, _AES_Kd, "f")[rounds][i];
            result[4 * i] = (Si[t[i] >> 24 & 0xff] ^ tt >> 24) & 0xff;
            result[4 * i + 1] = (Si[t[(i + 3) % 4] >> 16 & 0xff] ^ tt >> 16) & 0xff;
            result[4 * i + 2] = (Si[t[(i + 2) % 4] >> 8 & 0xff] ^ tt >> 8) & 0xff;
            result[4 * i + 3] = (Si[t[(i + 1) % 4] & 0xff] ^ tt) & 0xff;
        }
        return result;
    }
}
_AES_key = new WeakMap(), _AES_Kd = new WeakMap(), _AES_Ke = new WeakMap(); //# sourceMappingURL=aes.js.map
}),
"[project]/dashboard/node_modules/aes-js/lib.esm/mode.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ModeOfOperation",
    ()=>ModeOfOperation
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$aes$2d$js$2f$lib$2e$esm$2f$aes$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/aes-js/lib.esm/aes.js [app-client] (ecmascript)");
;
class ModeOfOperation {
    constructor(name, key, cls){
        if (cls && !(this instanceof cls)) {
            throw new Error(`${name} must be instantiated with "new"`);
        }
        Object.defineProperties(this, {
            aes: {
                enumerable: true,
                value: new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$aes$2d$js$2f$lib$2e$esm$2f$aes$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AES"](key)
            },
            name: {
                enumerable: true,
                value: name
            }
        });
    }
} //# sourceMappingURL=mode.js.map
}),
"[project]/dashboard/node_modules/aes-js/lib.esm/mode-cbc.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "CBC",
    ()=>CBC
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$aes$2d$js$2f$lib$2e$esm$2f$mode$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/aes-js/lib.esm/mode.js [app-client] (ecmascript)");
// Cipher Block Chaining
var __classPrivateFieldSet = ("TURBOPACK compile-time value", void 0) && ("TURBOPACK compile-time value", void 0).__classPrivateFieldSet || function(receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
};
var __classPrivateFieldGet = ("TURBOPACK compile-time value", void 0) && ("TURBOPACK compile-time value", void 0).__classPrivateFieldGet || function(receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _CBC_iv, _CBC_lastBlock;
;
class CBC extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$aes$2d$js$2f$lib$2e$esm$2f$mode$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ModeOfOperation"] {
    constructor(key, iv){
        super("ECC", key, CBC);
        _CBC_iv.set(this, void 0);
        _CBC_lastBlock.set(this, void 0);
        if (iv) {
            if (iv.length % 16) {
                throw new TypeError("invalid iv size (must be 16 bytes)");
            }
            __classPrivateFieldSet(this, _CBC_iv, new Uint8Array(iv), "f");
        } else {
            __classPrivateFieldSet(this, _CBC_iv, new Uint8Array(16), "f");
        }
        __classPrivateFieldSet(this, _CBC_lastBlock, this.iv, "f");
    }
    get iv() {
        return new Uint8Array(__classPrivateFieldGet(this, _CBC_iv, "f"));
    }
    encrypt(plaintext) {
        if (plaintext.length % 16) {
            throw new TypeError("invalid plaintext size (must be multiple of 16 bytes)");
        }
        const ciphertext = new Uint8Array(plaintext.length);
        for(let i = 0; i < plaintext.length; i += 16){
            for(let j = 0; j < 16; j++){
                __classPrivateFieldGet(this, _CBC_lastBlock, "f")[j] ^= plaintext[i + j];
            }
            __classPrivateFieldSet(this, _CBC_lastBlock, this.aes.encrypt(__classPrivateFieldGet(this, _CBC_lastBlock, "f")), "f");
            ciphertext.set(__classPrivateFieldGet(this, _CBC_lastBlock, "f"), i);
        }
        return ciphertext;
    }
    decrypt(ciphertext) {
        if (ciphertext.length % 16) {
            throw new TypeError("invalid ciphertext size (must be multiple of 16 bytes)");
        }
        const plaintext = new Uint8Array(ciphertext.length);
        for(let i = 0; i < ciphertext.length; i += 16){
            const block = this.aes.decrypt(ciphertext.subarray(i, i + 16));
            for(let j = 0; j < 16; j++){
                plaintext[i + j] = block[j] ^ __classPrivateFieldGet(this, _CBC_lastBlock, "f")[j];
                __classPrivateFieldGet(this, _CBC_lastBlock, "f")[j] = ciphertext[i + j];
            }
        }
        return plaintext;
    }
}
_CBC_iv = new WeakMap(), _CBC_lastBlock = new WeakMap(); //# sourceMappingURL=mode-cbc.js.map
}),
"[project]/dashboard/node_modules/aes-js/lib.esm/mode-cfb.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "CFB",
    ()=>CFB
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$aes$2d$js$2f$lib$2e$esm$2f$mode$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/aes-js/lib.esm/mode.js [app-client] (ecmascript)");
// Cipher Feedback
var __classPrivateFieldSet = ("TURBOPACK compile-time value", void 0) && ("TURBOPACK compile-time value", void 0).__classPrivateFieldSet || function(receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
};
var __classPrivateFieldGet = ("TURBOPACK compile-time value", void 0) && ("TURBOPACK compile-time value", void 0).__classPrivateFieldGet || function(receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _CFB_instances, _CFB_iv, _CFB_shiftRegister, _CFB_shift;
;
class CFB extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$aes$2d$js$2f$lib$2e$esm$2f$mode$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ModeOfOperation"] {
    constructor(key, iv, segmentSize = 8){
        super("CFB", key, CFB);
        _CFB_instances.add(this);
        _CFB_iv.set(this, void 0);
        _CFB_shiftRegister.set(this, void 0);
        // This library currently only handles byte-aligned segmentSize
        if (!Number.isInteger(segmentSize) || segmentSize % 8) {
            throw new TypeError("invalid segmentSize");
        }
        Object.defineProperties(this, {
            segmentSize: {
                enumerable: true,
                value: segmentSize
            }
        });
        if (iv) {
            if (iv.length % 16) {
                throw new TypeError("invalid iv size (must be 16 bytes)");
            }
            __classPrivateFieldSet(this, _CFB_iv, new Uint8Array(iv), "f");
        } else {
            __classPrivateFieldSet(this, _CFB_iv, new Uint8Array(16), "f");
        }
        __classPrivateFieldSet(this, _CFB_shiftRegister, this.iv, "f");
    }
    get iv() {
        return new Uint8Array(__classPrivateFieldGet(this, _CFB_iv, "f"));
    }
    encrypt(plaintext) {
        if (8 * plaintext.length % this.segmentSize) {
            throw new TypeError("invalid plaintext size (must be multiple of segmentSize bytes)");
        }
        const segmentSize = this.segmentSize / 8;
        const ciphertext = new Uint8Array(plaintext);
        for(let i = 0; i < ciphertext.length; i += segmentSize){
            const xorSegment = this.aes.encrypt(__classPrivateFieldGet(this, _CFB_shiftRegister, "f"));
            for(let j = 0; j < segmentSize; j++){
                ciphertext[i + j] ^= xorSegment[j];
            }
            __classPrivateFieldGet(this, _CFB_instances, "m", _CFB_shift).call(this, ciphertext.subarray(i));
        }
        return ciphertext;
    }
    decrypt(ciphertext) {
        if (8 * ciphertext.length % this.segmentSize) {
            throw new TypeError("invalid ciphertext size (must be multiple of segmentSize bytes)");
        }
        const segmentSize = this.segmentSize / 8;
        const plaintext = new Uint8Array(ciphertext);
        for(let i = 0; i < plaintext.length; i += segmentSize){
            const xorSegment = this.aes.encrypt(__classPrivateFieldGet(this, _CFB_shiftRegister, "f"));
            for(let j = 0; j < segmentSize; j++){
                plaintext[i + j] ^= xorSegment[j];
            }
            __classPrivateFieldGet(this, _CFB_instances, "m", _CFB_shift).call(this, ciphertext.subarray(i));
        }
        return plaintext;
    }
}
_CFB_iv = new WeakMap(), _CFB_shiftRegister = new WeakMap(), _CFB_instances = new WeakSet(), _CFB_shift = function _CFB_shift(data) {
    const segmentSize = this.segmentSize / 8;
    // Shift the register
    __classPrivateFieldGet(this, _CFB_shiftRegister, "f").set(__classPrivateFieldGet(this, _CFB_shiftRegister, "f").subarray(segmentSize));
    __classPrivateFieldGet(this, _CFB_shiftRegister, "f").set(data.subarray(0, segmentSize), 16 - segmentSize);
}; //# sourceMappingURL=mode-cfb.js.map
}),
"[project]/dashboard/node_modules/aes-js/lib.esm/mode-ctr.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "CTR",
    ()=>CTR
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$aes$2d$js$2f$lib$2e$esm$2f$mode$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/aes-js/lib.esm/mode.js [app-client] (ecmascript)");
// Counter Mode
var __classPrivateFieldSet = ("TURBOPACK compile-time value", void 0) && ("TURBOPACK compile-time value", void 0).__classPrivateFieldSet || function(receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
};
var __classPrivateFieldGet = ("TURBOPACK compile-time value", void 0) && ("TURBOPACK compile-time value", void 0).__classPrivateFieldGet || function(receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _CTR_remaining, _CTR_remainingIndex, _CTR_counter;
;
class CTR extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$aes$2d$js$2f$lib$2e$esm$2f$mode$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ModeOfOperation"] {
    constructor(key, initialValue){
        super("CTR", key, CTR);
        // Remaining bytes for the one-time pad
        _CTR_remaining.set(this, void 0);
        _CTR_remainingIndex.set(this, void 0);
        // The current counter
        _CTR_counter.set(this, void 0);
        __classPrivateFieldSet(this, _CTR_counter, new Uint8Array(16), "f");
        __classPrivateFieldGet(this, _CTR_counter, "f").fill(0);
        __classPrivateFieldSet(this, _CTR_remaining, __classPrivateFieldGet(this, _CTR_counter, "f"), "f"); // This will be discarded immediately
        __classPrivateFieldSet(this, _CTR_remainingIndex, 16, "f");
        if (initialValue == null) {
            initialValue = 1;
        }
        if (typeof initialValue === "number") {
            this.setCounterValue(initialValue);
        } else {
            this.setCounterBytes(initialValue);
        }
    }
    get counter() {
        return new Uint8Array(__classPrivateFieldGet(this, _CTR_counter, "f"));
    }
    setCounterValue(value) {
        if (!Number.isInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
            throw new TypeError("invalid counter initial integer value");
        }
        for(let index = 15; index >= 0; --index){
            __classPrivateFieldGet(this, _CTR_counter, "f")[index] = value % 256;
            value = Math.floor(value / 256);
        }
    }
    setCounterBytes(value) {
        if (value.length !== 16) {
            throw new TypeError("invalid counter initial Uint8Array value length");
        }
        __classPrivateFieldGet(this, _CTR_counter, "f").set(value);
    }
    increment() {
        for(let i = 15; i >= 0; i--){
            if (__classPrivateFieldGet(this, _CTR_counter, "f")[i] === 255) {
                __classPrivateFieldGet(this, _CTR_counter, "f")[i] = 0;
            } else {
                __classPrivateFieldGet(this, _CTR_counter, "f")[i]++;
                break;
            }
        }
    }
    encrypt(plaintext) {
        var _a, _b;
        const crypttext = new Uint8Array(plaintext);
        for(let i = 0; i < crypttext.length; i++){
            if (__classPrivateFieldGet(this, _CTR_remainingIndex, "f") === 16) {
                __classPrivateFieldSet(this, _CTR_remaining, this.aes.encrypt(__classPrivateFieldGet(this, _CTR_counter, "f")), "f");
                __classPrivateFieldSet(this, _CTR_remainingIndex, 0, "f");
                this.increment();
            }
            crypttext[i] ^= __classPrivateFieldGet(this, _CTR_remaining, "f")[__classPrivateFieldSet(this, _CTR_remainingIndex, (_b = __classPrivateFieldGet(this, _CTR_remainingIndex, "f"), _a = _b++, _b), "f"), _a];
        }
        return crypttext;
    }
    decrypt(ciphertext) {
        return this.encrypt(ciphertext);
    }
}
_CTR_remaining = new WeakMap(), _CTR_remainingIndex = new WeakMap(), _CTR_counter = new WeakMap(); //# sourceMappingURL=mode-ctr.js.map
}),
"[project]/dashboard/node_modules/aes-js/lib.esm/mode-ecb.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ECB",
    ()=>ECB
]);
// Electronic Code Book
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$aes$2d$js$2f$lib$2e$esm$2f$mode$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/aes-js/lib.esm/mode.js [app-client] (ecmascript)");
;
class ECB extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$aes$2d$js$2f$lib$2e$esm$2f$mode$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ModeOfOperation"] {
    constructor(key){
        super("ECB", key, ECB);
    }
    encrypt(plaintext) {
        if (plaintext.length % 16) {
            throw new TypeError("invalid plaintext size (must be multiple of 16 bytes)");
        }
        const crypttext = new Uint8Array(plaintext.length);
        for(let i = 0; i < plaintext.length; i += 16){
            crypttext.set(this.aes.encrypt(plaintext.subarray(i, i + 16)), i);
        }
        return crypttext;
    }
    decrypt(crypttext) {
        if (crypttext.length % 16) {
            throw new TypeError("invalid ciphertext size (must be multiple of 16 bytes)");
        }
        const plaintext = new Uint8Array(crypttext.length);
        for(let i = 0; i < crypttext.length; i += 16){
            plaintext.set(this.aes.decrypt(crypttext.subarray(i, i + 16)), i);
        }
        return plaintext;
    }
} //# sourceMappingURL=mode-ecb.js.map
}),
"[project]/dashboard/node_modules/aes-js/lib.esm/mode-ofb.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "OFB",
    ()=>OFB
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$aes$2d$js$2f$lib$2e$esm$2f$mode$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/aes-js/lib.esm/mode.js [app-client] (ecmascript)");
// Output Feedback
var __classPrivateFieldSet = ("TURBOPACK compile-time value", void 0) && ("TURBOPACK compile-time value", void 0).__classPrivateFieldSet || function(receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
};
var __classPrivateFieldGet = ("TURBOPACK compile-time value", void 0) && ("TURBOPACK compile-time value", void 0).__classPrivateFieldGet || function(receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _OFB_iv, _OFB_lastPrecipher, _OFB_lastPrecipherIndex;
;
class OFB extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$aes$2d$js$2f$lib$2e$esm$2f$mode$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ModeOfOperation"] {
    constructor(key, iv){
        super("OFB", key, OFB);
        _OFB_iv.set(this, void 0);
        _OFB_lastPrecipher.set(this, void 0);
        _OFB_lastPrecipherIndex.set(this, void 0);
        if (iv) {
            if (iv.length % 16) {
                throw new TypeError("invalid iv size (must be 16 bytes)");
            }
            __classPrivateFieldSet(this, _OFB_iv, new Uint8Array(iv), "f");
        } else {
            __classPrivateFieldSet(this, _OFB_iv, new Uint8Array(16), "f");
        }
        __classPrivateFieldSet(this, _OFB_lastPrecipher, this.iv, "f");
        __classPrivateFieldSet(this, _OFB_lastPrecipherIndex, 16, "f");
    }
    get iv() {
        return new Uint8Array(__classPrivateFieldGet(this, _OFB_iv, "f"));
    }
    encrypt(plaintext) {
        var _a, _b;
        if (plaintext.length % 16) {
            throw new TypeError("invalid plaintext size (must be multiple of 16 bytes)");
        }
        const ciphertext = new Uint8Array(plaintext);
        for(let i = 0; i < ciphertext.length; i++){
            if (__classPrivateFieldGet(this, _OFB_lastPrecipherIndex, "f") === 16) {
                __classPrivateFieldSet(this, _OFB_lastPrecipher, this.aes.encrypt(__classPrivateFieldGet(this, _OFB_lastPrecipher, "f")), "f");
                __classPrivateFieldSet(this, _OFB_lastPrecipherIndex, 0, "f");
            }
            ciphertext[i] ^= __classPrivateFieldGet(this, _OFB_lastPrecipher, "f")[__classPrivateFieldSet(this, _OFB_lastPrecipherIndex, (_b = __classPrivateFieldGet(this, _OFB_lastPrecipherIndex, "f"), _a = _b++, _b), "f"), _a];
        }
        return ciphertext;
    }
    decrypt(ciphertext) {
        if (ciphertext.length % 16) {
            throw new TypeError("invalid ciphertext size (must be multiple of 16 bytes)");
        }
        return this.encrypt(ciphertext);
    }
}
_OFB_iv = new WeakMap(), _OFB_lastPrecipher = new WeakMap(), _OFB_lastPrecipherIndex = new WeakMap(); //# sourceMappingURL=mode-ofb.js.map
}),
"[project]/dashboard/node_modules/aes-js/lib.esm/padding.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "pkcs7Pad",
    ()=>pkcs7Pad,
    "pkcs7Strip",
    ()=>pkcs7Strip
]);
function pkcs7Pad(data) {
    const padder = 16 - data.length % 16;
    const result = new Uint8Array(data.length + padder);
    result.set(data);
    for(let i = data.length; i < result.length; i++){
        result[i] = padder;
    }
    return result;
}
function pkcs7Strip(data) {
    if (data.length < 16) {
        throw new TypeError('PKCS#7 invalid length');
    }
    const padder = data[data.length - 1];
    if (padder > 16) {
        throw new TypeError('PKCS#7 padding byte out of range');
    }
    const length = data.length - padder;
    for(let i = 0; i < padder; i++){
        if (data[length + i] !== padder) {
            throw new TypeError('PKCS#7 invalid padding byte');
        }
    }
    return new Uint8Array(data.subarray(0, length));
} //# sourceMappingURL=padding.js.map
}),
"[project]/dashboard/node_modules/aes-js/lib.esm/index.js [app-client] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$aes$2d$js$2f$lib$2e$esm$2f$aes$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/aes-js/lib.esm/aes.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$aes$2d$js$2f$lib$2e$esm$2f$mode$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/aes-js/lib.esm/mode.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$aes$2d$js$2f$lib$2e$esm$2f$mode$2d$cbc$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/aes-js/lib.esm/mode-cbc.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$aes$2d$js$2f$lib$2e$esm$2f$mode$2d$cfb$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/aes-js/lib.esm/mode-cfb.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$aes$2d$js$2f$lib$2e$esm$2f$mode$2d$ctr$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/aes-js/lib.esm/mode-ctr.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$aes$2d$js$2f$lib$2e$esm$2f$mode$2d$ecb$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/aes-js/lib.esm/mode-ecb.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$aes$2d$js$2f$lib$2e$esm$2f$mode$2d$ofb$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/aes-js/lib.esm/mode-ofb.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$aes$2d$js$2f$lib$2e$esm$2f$padding$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/aes-js/lib.esm/padding.js [app-client] (ecmascript)"); //# sourceMappingURL=index.js.map
;
;
;
;
;
;
;
;
}),
"[project]/dashboard/node_modules/abitype/dist/esm/regex.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// TODO: This looks cool. Need to check the performance of `new RegExp` versus defined inline though.
// https://twitter.com/GabrielVergnaud/status/1622906834343366657
__turbopack_context__.s([
    "bytesRegex",
    ()=>bytesRegex,
    "execTyped",
    ()=>execTyped,
    "integerRegex",
    ()=>integerRegex,
    "isTupleRegex",
    ()=>isTupleRegex
]);
function execTyped(regex, string) {
    const match = regex.exec(string);
    return match?.groups;
}
const bytesRegex = /^bytes([1-9]|1[0-9]|2[0-9]|3[0-2])?$/;
const integerRegex = /^u?int(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?$/;
const isTupleRegex = /^\(.+?\).*?$/; //# sourceMappingURL=regex.js.map
}),
"[project]/dashboard/node_modules/abitype/dist/esm/human-readable/formatAbiParameter.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "formatAbiParameter",
    ()=>formatAbiParameter
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$abitype$2f$dist$2f$esm$2f$regex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/abitype/dist/esm/regex.js [app-client] (ecmascript)");
;
// https://regexr.com/7f7rv
const tupleRegex = /^tuple(?<array>(\[(\d*)\])*)$/;
function formatAbiParameter(abiParameter) {
    let type = abiParameter.type;
    if (tupleRegex.test(abiParameter.type) && 'components' in abiParameter) {
        type = '(';
        const length = abiParameter.components.length;
        for(let i = 0; i < length; i++){
            const component = abiParameter.components[i];
            type += formatAbiParameter(component);
            if (i < length - 1) type += ', ';
        }
        const result = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$abitype$2f$dist$2f$esm$2f$regex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["execTyped"])(tupleRegex, abiParameter.type);
        type += `)${result?.array || ''}`;
        return formatAbiParameter({
            ...abiParameter,
            type
        });
    }
    // Add `indexed` to type if in `abiParameter`
    if ('indexed' in abiParameter && abiParameter.indexed) type = `${type} indexed`;
    // Return human-readable ABI parameter
    if (abiParameter.name) return `${type} ${abiParameter.name}`;
    return type;
} //# sourceMappingURL=formatAbiParameter.js.map
}),
"[project]/dashboard/node_modules/abitype/dist/esm/human-readable/formatAbiParameters.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "formatAbiParameters",
    ()=>formatAbiParameters
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$abitype$2f$dist$2f$esm$2f$human$2d$readable$2f$formatAbiParameter$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/abitype/dist/esm/human-readable/formatAbiParameter.js [app-client] (ecmascript)");
;
function formatAbiParameters(abiParameters) {
    let params = '';
    const length = abiParameters.length;
    for(let i = 0; i < length; i++){
        const abiParameter = abiParameters[i];
        params += (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$abitype$2f$dist$2f$esm$2f$human$2d$readable$2f$formatAbiParameter$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatAbiParameter"])(abiParameter);
        if (i !== length - 1) params += ', ';
    }
    return params;
} //# sourceMappingURL=formatAbiParameters.js.map
}),
"[project]/dashboard/node_modules/abitype/dist/esm/human-readable/formatAbiItem.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "formatAbiItem",
    ()=>formatAbiItem
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$abitype$2f$dist$2f$esm$2f$human$2d$readable$2f$formatAbiParameters$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/abitype/dist/esm/human-readable/formatAbiParameters.js [app-client] (ecmascript)");
;
function formatAbiItem(abiItem) {
    if (abiItem.type === 'function') return `function ${abiItem.name}(${(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$abitype$2f$dist$2f$esm$2f$human$2d$readable$2f$formatAbiParameters$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatAbiParameters"])(abiItem.inputs)})${abiItem.stateMutability && abiItem.stateMutability !== 'nonpayable' ? ` ${abiItem.stateMutability}` : ''}${abiItem.outputs?.length ? ` returns (${(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$abitype$2f$dist$2f$esm$2f$human$2d$readable$2f$formatAbiParameters$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatAbiParameters"])(abiItem.outputs)})` : ''}`;
    if (abiItem.type === 'event') return `event ${abiItem.name}(${(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$abitype$2f$dist$2f$esm$2f$human$2d$readable$2f$formatAbiParameters$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatAbiParameters"])(abiItem.inputs)})`;
    if (abiItem.type === 'error') return `error ${abiItem.name}(${(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$abitype$2f$dist$2f$esm$2f$human$2d$readable$2f$formatAbiParameters$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatAbiParameters"])(abiItem.inputs)})`;
    if (abiItem.type === 'constructor') return `constructor(${(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$abitype$2f$dist$2f$esm$2f$human$2d$readable$2f$formatAbiParameters$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatAbiParameters"])(abiItem.inputs)})${abiItem.stateMutability === 'payable' ? ' payable' : ''}`;
    if (abiItem.type === 'fallback') return `fallback() external${abiItem.stateMutability === 'payable' ? ' payable' : ''}`;
    return 'receive() external payable';
} //# sourceMappingURL=formatAbiItem.js.map
}),
"[project]/dashboard/node_modules/clsx/dist/clsx.mjs [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "clsx",
    ()=>clsx,
    "default",
    ()=>__TURBOPACK__default__export__
]);
function r(e) {
    var t, f, n = "";
    if ("string" == typeof e || "number" == typeof e) n += e;
    else if ("object" == typeof e) if (Array.isArray(e)) {
        var o = e.length;
        for(t = 0; t < o; t++)e[t] && (f = r(e[t])) && (n && (n += " "), n += f);
    } else for(f in e)e[f] && (n && (n += " "), n += f);
    return n;
}
function clsx() {
    for(var e, t, f = 0, n = "", o = arguments.length; f < o; f++)(e = arguments[f]) && (t = r(e)) && (n && (n += " "), n += t);
    return n;
}
const __TURBOPACK__default__export__ = clsx;
}),
"[project]/dashboard/node_modules/next/dist/shared/lib/router/utils/querystring.js [app-client] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    assign: null,
    searchParamsToUrlQuery: null,
    urlQueryToSearchParams: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    assign: function() {
        return assign;
    },
    searchParamsToUrlQuery: function() {
        return searchParamsToUrlQuery;
    },
    urlQueryToSearchParams: function() {
        return urlQueryToSearchParams;
    }
});
function searchParamsToUrlQuery(searchParams) {
    const query = {};
    for (const [key, value] of searchParams.entries()){
        const existing = query[key];
        if (typeof existing === 'undefined') {
            query[key] = value;
        } else if (Array.isArray(existing)) {
            existing.push(value);
        } else {
            query[key] = [
                existing,
                value
            ];
        }
    }
    return query;
}
function stringifyUrlQueryParam(param) {
    if (typeof param === 'string') {
        return param;
    }
    if (typeof param === 'number' && !isNaN(param) || typeof param === 'boolean') {
        return String(param);
    } else {
        return '';
    }
}
function urlQueryToSearchParams(query) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(query)){
        if (Array.isArray(value)) {
            for (const item of value){
                searchParams.append(key, stringifyUrlQueryParam(item));
            }
        } else {
            searchParams.set(key, stringifyUrlQueryParam(value));
        }
    }
    return searchParams;
}
function assign(target, ...searchParamsList) {
    for (const searchParams of searchParamsList){
        for (const key of searchParams.keys()){
            target.delete(key);
        }
        for (const [key, value] of searchParams.entries()){
            target.append(key, value);
        }
    }
    return target;
} //# sourceMappingURL=querystring.js.map
}),
"[project]/dashboard/node_modules/next/dist/shared/lib/router/utils/format-url.js [app-client] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$build$2f$polyfills$2f$process$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = /*#__PURE__*/ __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/build/polyfills/process.js [app-client] (ecmascript)");
// Format function modified from nodejs
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    formatUrl: null,
    formatWithValidation: null,
    urlObjectKeys: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    formatUrl: function() {
        return formatUrl;
    },
    formatWithValidation: function() {
        return formatWithValidation;
    },
    urlObjectKeys: function() {
        return urlObjectKeys;
    }
});
const _interop_require_wildcard = __turbopack_context__.r("[project]/dashboard/node_modules/@swc/helpers/cjs/_interop_require_wildcard.cjs [app-client] (ecmascript)");
const _querystring = /*#__PURE__*/ _interop_require_wildcard._(__turbopack_context__.r("[project]/dashboard/node_modules/next/dist/shared/lib/router/utils/querystring.js [app-client] (ecmascript)"));
const slashedProtocols = /https?|ftp|gopher|file/;
function formatUrl(urlObj) {
    let { auth, hostname } = urlObj;
    let protocol = urlObj.protocol || '';
    let pathname = urlObj.pathname || '';
    let hash = urlObj.hash || '';
    let query = urlObj.query || '';
    let host = false;
    auth = auth ? encodeURIComponent(auth).replace(/%3A/i, ':') + '@' : '';
    if (urlObj.host) {
        host = auth + urlObj.host;
    } else if (hostname) {
        host = auth + (~hostname.indexOf(':') ? `[${hostname}]` : hostname);
        if (urlObj.port) {
            host += ':' + urlObj.port;
        }
    }
    if (query && typeof query === 'object') {
        query = String(_querystring.urlQueryToSearchParams(query));
    }
    let search = urlObj.search || query && `?${query}` || '';
    if (protocol && !protocol.endsWith(':')) protocol += ':';
    if (urlObj.slashes || (!protocol || slashedProtocols.test(protocol)) && host !== false) {
        host = '//' + (host || '');
        if (pathname && pathname[0] !== '/') pathname = '/' + pathname;
    } else if (!host) {
        host = '';
    }
    if (hash && hash[0] !== '#') hash = '#' + hash;
    if (search && search[0] !== '?') search = '?' + search;
    pathname = pathname.replace(/[?#]/g, encodeURIComponent);
    search = search.replace('#', '%23');
    return `${protocol}${host}${pathname}${search}${hash}`;
}
const urlObjectKeys = [
    'auth',
    'hash',
    'host',
    'hostname',
    'href',
    'path',
    'pathname',
    'port',
    'protocol',
    'query',
    'search',
    'slashes'
];
function formatWithValidation(url) {
    if ("TURBOPACK compile-time truthy", 1) {
        if (url !== null && typeof url === 'object') {
            Object.keys(url).forEach((key)=>{
                if (!urlObjectKeys.includes(key)) {
                    console.warn(`Unknown key passed via urlObject into url.format: ${key}`);
                }
            });
        }
    }
    return formatUrl(url);
} //# sourceMappingURL=format-url.js.map
}),
"[project]/dashboard/node_modules/next/dist/client/use-merged-ref.js [app-client] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "useMergedRef", {
    enumerable: true,
    get: function() {
        return useMergedRef;
    }
});
const _react = __turbopack_context__.r("[project]/dashboard/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
function useMergedRef(refA, refB) {
    const cleanupA = (0, _react.useRef)(null);
    const cleanupB = (0, _react.useRef)(null);
    // NOTE: In theory, we could skip the wrapping if only one of the refs is non-null.
    // (this happens often if the user doesn't pass a ref to Link/Form/Image)
    // But this can cause us to leak a cleanup-ref into user code (previously via `<Link legacyBehavior>`),
    // and the user might pass that ref into ref-merging library that doesn't support cleanup refs
    // (because it hasn't been updated for React 19)
    // which can then cause things to blow up, because a cleanup-returning ref gets called with `null`.
    // So in practice, it's safer to be defensive and always wrap the ref, even on React 19.
    return (0, _react.useCallback)((current)=>{
        if (current === null) {
            const cleanupFnA = cleanupA.current;
            if (cleanupFnA) {
                cleanupA.current = null;
                cleanupFnA();
            }
            const cleanupFnB = cleanupB.current;
            if (cleanupFnB) {
                cleanupB.current = null;
                cleanupFnB();
            }
        } else {
            if (refA) {
                cleanupA.current = applyRef(refA, current);
            }
            if (refB) {
                cleanupB.current = applyRef(refB, current);
            }
        }
    }, [
        refA,
        refB
    ]);
}
function applyRef(refA, current) {
    if (typeof refA === 'function') {
        const cleanup = refA(current);
        if (typeof cleanup === 'function') {
            return cleanup;
        } else {
            return ()=>refA(null);
        }
    } else {
        refA.current = current;
        return ()=>{
            refA.current = null;
        };
    }
}
if ((typeof exports.default === 'function' || typeof exports.default === 'object' && exports.default !== null) && typeof exports.default.__esModule === 'undefined') {
    Object.defineProperty(exports.default, '__esModule', {
        value: true
    });
    Object.assign(exports.default, exports);
    module.exports = exports.default;
} //# sourceMappingURL=use-merged-ref.js.map
}),
"[project]/dashboard/node_modules/next/dist/shared/lib/utils.js [app-client] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$build$2f$polyfills$2f$process$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = /*#__PURE__*/ __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/build/polyfills/process.js [app-client] (ecmascript)");
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    DecodeError: null,
    MiddlewareNotFoundError: null,
    MissingStaticPage: null,
    NormalizeError: null,
    PageNotFoundError: null,
    SP: null,
    ST: null,
    WEB_VITALS: null,
    execOnce: null,
    getDisplayName: null,
    getLocationOrigin: null,
    getURL: null,
    isAbsoluteUrl: null,
    isResSent: null,
    loadGetInitialProps: null,
    normalizeRepeatedSlashes: null,
    stringifyError: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    DecodeError: function() {
        return DecodeError;
    },
    MiddlewareNotFoundError: function() {
        return MiddlewareNotFoundError;
    },
    MissingStaticPage: function() {
        return MissingStaticPage;
    },
    NormalizeError: function() {
        return NormalizeError;
    },
    PageNotFoundError: function() {
        return PageNotFoundError;
    },
    SP: function() {
        return SP;
    },
    ST: function() {
        return ST;
    },
    WEB_VITALS: function() {
        return WEB_VITALS;
    },
    execOnce: function() {
        return execOnce;
    },
    getDisplayName: function() {
        return getDisplayName;
    },
    getLocationOrigin: function() {
        return getLocationOrigin;
    },
    getURL: function() {
        return getURL;
    },
    isAbsoluteUrl: function() {
        return isAbsoluteUrl;
    },
    isResSent: function() {
        return isResSent;
    },
    loadGetInitialProps: function() {
        return loadGetInitialProps;
    },
    normalizeRepeatedSlashes: function() {
        return normalizeRepeatedSlashes;
    },
    stringifyError: function() {
        return stringifyError;
    }
});
const WEB_VITALS = [
    'CLS',
    'FCP',
    'FID',
    'INP',
    'LCP',
    'TTFB'
];
function execOnce(fn) {
    let used = false;
    let result;
    return (...args)=>{
        if (!used) {
            used = true;
            result = fn(...args);
        }
        return result;
    };
}
// Scheme: https://tools.ietf.org/html/rfc3986#section-3.1
// Absolute URL: https://tools.ietf.org/html/rfc3986#section-4.3
const ABSOLUTE_URL_REGEX = /^[a-zA-Z][a-zA-Z\d+\-.]*?:/;
const isAbsoluteUrl = (url)=>ABSOLUTE_URL_REGEX.test(url);
function getLocationOrigin() {
    const { protocol, hostname, port } = window.location;
    return `${protocol}//${hostname}${port ? ':' + port : ''}`;
}
function getURL() {
    const { href } = window.location;
    const origin = getLocationOrigin();
    return href.substring(origin.length);
}
function getDisplayName(Component) {
    return typeof Component === 'string' ? Component : Component.displayName || Component.name || 'Unknown';
}
function isResSent(res) {
    return res.finished || res.headersSent;
}
function normalizeRepeatedSlashes(url) {
    const urlParts = url.split('?');
    const urlNoQuery = urlParts[0];
    return urlNoQuery // first we replace any non-encoded backslashes with forward
    // then normalize repeated forward slashes
    .replace(/\\/g, '/').replace(/\/\/+/g, '/') + (urlParts[1] ? `?${urlParts.slice(1).join('?')}` : '');
}
async function loadGetInitialProps(App, ctx) {
    if ("TURBOPACK compile-time truthy", 1) {
        if (App.prototype?.getInitialProps) {
            const message = `"${getDisplayName(App)}.getInitialProps()" is defined as an instance method - visit https://nextjs.org/docs/messages/get-initial-props-as-an-instance-method for more information.`;
            throw Object.defineProperty(new Error(message), "__NEXT_ERROR_CODE", {
                value: "E394",
                enumerable: false,
                configurable: true
            });
        }
    }
    // when called from _app `ctx` is nested in `ctx`
    const res = ctx.res || ctx.ctx && ctx.ctx.res;
    if (!App.getInitialProps) {
        if (ctx.ctx && ctx.Component) {
            // @ts-ignore pageProps default
            return {
                pageProps: await loadGetInitialProps(ctx.Component, ctx.ctx)
            };
        }
        return {};
    }
    const props = await App.getInitialProps(ctx);
    if (res && isResSent(res)) {
        return props;
    }
    if (!props) {
        const message = `"${getDisplayName(App)}.getInitialProps()" should resolve to an object. But found "${props}" instead.`;
        throw Object.defineProperty(new Error(message), "__NEXT_ERROR_CODE", {
            value: "E394",
            enumerable: false,
            configurable: true
        });
    }
    if ("TURBOPACK compile-time truthy", 1) {
        if (Object.keys(props).length === 0 && !ctx.ctx) {
            console.warn(`${getDisplayName(App)} returned an empty object from \`getInitialProps\`. This de-optimizes and prevents automatic static optimization. https://nextjs.org/docs/messages/empty-object-getInitialProps`);
        }
    }
    return props;
}
const SP = typeof performance !== 'undefined';
const ST = SP && [
    'mark',
    'measure',
    'getEntriesByName'
].every((method)=>typeof performance[method] === 'function');
class DecodeError extends Error {
}
class NormalizeError extends Error {
}
class PageNotFoundError extends Error {
    constructor(page){
        super();
        this.code = 'ENOENT';
        this.name = 'PageNotFoundError';
        this.message = `Cannot find module for page: ${page}`;
    }
}
class MissingStaticPage extends Error {
    constructor(page, message){
        super();
        this.message = `Failed to load static file for page: ${page} ${message}`;
    }
}
class MiddlewareNotFoundError extends Error {
    constructor(){
        super();
        this.code = 'ENOENT';
        this.message = `Cannot find the middleware module`;
    }
}
function stringifyError(error) {
    return JSON.stringify({
        message: error.message,
        stack: error.stack
    });
} //# sourceMappingURL=utils.js.map
}),
"[project]/dashboard/node_modules/next/dist/shared/lib/router/utils/is-local-url.js [app-client] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "isLocalURL", {
    enumerable: true,
    get: function() {
        return isLocalURL;
    }
});
const _utils = __turbopack_context__.r("[project]/dashboard/node_modules/next/dist/shared/lib/utils.js [app-client] (ecmascript)");
const _hasbasepath = __turbopack_context__.r("[project]/dashboard/node_modules/next/dist/client/has-base-path.js [app-client] (ecmascript)");
function isLocalURL(url) {
    // prevent a hydration mismatch on href for url with anchor refs
    if (!(0, _utils.isAbsoluteUrl)(url)) return true;
    try {
        // absolute urls can be local if they are on the same origin
        const locationOrigin = (0, _utils.getLocationOrigin)();
        const resolved = new URL(url, locationOrigin);
        return resolved.origin === locationOrigin && (0, _hasbasepath.hasBasePath)(resolved.pathname);
    } catch (_) {
        return false;
    }
} //# sourceMappingURL=is-local-url.js.map
}),
"[project]/dashboard/node_modules/next/dist/shared/lib/utils/error-once.js [app-client] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$build$2f$polyfills$2f$process$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = /*#__PURE__*/ __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/build/polyfills/process.js [app-client] (ecmascript)");
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "errorOnce", {
    enumerable: true,
    get: function() {
        return errorOnce;
    }
});
let errorOnce = (_)=>{};
if ("TURBOPACK compile-time truthy", 1) {
    const errors = new Set();
    errorOnce = (msg)=>{
        if (!errors.has(msg)) {
            console.error(msg);
        }
        errors.add(msg);
    };
} //# sourceMappingURL=error-once.js.map
}),
"[project]/dashboard/node_modules/next/dist/client/app-dir/link.js [app-client] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$build$2f$polyfills$2f$process$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = /*#__PURE__*/ __turbopack_context__.i("[project]/dashboard/node_modules/next/dist/build/polyfills/process.js [app-client] (ecmascript)");
'use client';
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    default: null,
    useLinkStatus: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    /**
 * A React component that extends the HTML `<a>` element to provide
 * [prefetching](https://nextjs.org/docs/app/building-your-application/routing/linking-and-navigating#2-prefetching)
 * and client-side navigation. This is the primary way to navigate between routes in Next.js.
 *
 * @remarks
 * - Prefetching is only enabled in production.
 *
 * @see https://nextjs.org/docs/app/api-reference/components/link
 */ default: function() {
        return LinkComponent;
    },
    useLinkStatus: function() {
        return useLinkStatus;
    }
});
const _interop_require_wildcard = __turbopack_context__.r("[project]/dashboard/node_modules/@swc/helpers/cjs/_interop_require_wildcard.cjs [app-client] (ecmascript)");
const _jsxruntime = __turbopack_context__.r("[project]/dashboard/node_modules/next/dist/compiled/react/jsx-runtime.js [app-client] (ecmascript)");
const _react = /*#__PURE__*/ _interop_require_wildcard._(__turbopack_context__.r("[project]/dashboard/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)"));
const _formaturl = __turbopack_context__.r("[project]/dashboard/node_modules/next/dist/shared/lib/router/utils/format-url.js [app-client] (ecmascript)");
const _approutercontextsharedruntime = __turbopack_context__.r("[project]/dashboard/node_modules/next/dist/shared/lib/app-router-context.shared-runtime.js [app-client] (ecmascript)");
const _usemergedref = __turbopack_context__.r("[project]/dashboard/node_modules/next/dist/client/use-merged-ref.js [app-client] (ecmascript)");
const _utils = __turbopack_context__.r("[project]/dashboard/node_modules/next/dist/shared/lib/utils.js [app-client] (ecmascript)");
const _addbasepath = __turbopack_context__.r("[project]/dashboard/node_modules/next/dist/client/add-base-path.js [app-client] (ecmascript)");
const _warnonce = __turbopack_context__.r("[project]/dashboard/node_modules/next/dist/shared/lib/utils/warn-once.js [app-client] (ecmascript)");
const _links = __turbopack_context__.r("[project]/dashboard/node_modules/next/dist/client/components/links.js [app-client] (ecmascript)");
const _islocalurl = __turbopack_context__.r("[project]/dashboard/node_modules/next/dist/shared/lib/router/utils/is-local-url.js [app-client] (ecmascript)");
const _types = __turbopack_context__.r("[project]/dashboard/node_modules/next/dist/client/components/segment-cache/types.js [app-client] (ecmascript)");
const _erroronce = __turbopack_context__.r("[project]/dashboard/node_modules/next/dist/shared/lib/utils/error-once.js [app-client] (ecmascript)");
function isModifiedEvent(event) {
    const eventTarget = event.currentTarget;
    const target = eventTarget.getAttribute('target');
    return target && target !== '_self' || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || // triggers resource download
    event.nativeEvent && event.nativeEvent.which === 2;
}
function linkClicked(e, href, as, linkInstanceRef, replace, scroll, onNavigate) {
    if (typeof window !== 'undefined') {
        const { nodeName } = e.currentTarget;
        // anchors inside an svg have a lowercase nodeName
        const isAnchorNodeName = nodeName.toUpperCase() === 'A';
        if (isAnchorNodeName && isModifiedEvent(e) || e.currentTarget.hasAttribute('download')) {
            // ignore click for browser’s default behavior
            return;
        }
        if (!(0, _islocalurl.isLocalURL)(href)) {
            if (replace) {
                // browser default behavior does not replace the history state
                // so we need to do it manually
                e.preventDefault();
                location.replace(href);
            }
            // ignore click for browser’s default behavior
            return;
        }
        e.preventDefault();
        if (onNavigate) {
            let isDefaultPrevented = false;
            onNavigate({
                preventDefault: ()=>{
                    isDefaultPrevented = true;
                }
            });
            if (isDefaultPrevented) {
                return;
            }
        }
        const { dispatchNavigateAction } = __turbopack_context__.r("[project]/dashboard/node_modules/next/dist/client/components/app-router-instance.js [app-client] (ecmascript)");
        _react.default.startTransition(()=>{
            dispatchNavigateAction(as || href, replace ? 'replace' : 'push', scroll ?? true, linkInstanceRef.current);
        });
    }
}
function formatStringOrUrl(urlObjOrString) {
    if (typeof urlObjOrString === 'string') {
        return urlObjOrString;
    }
    return (0, _formaturl.formatUrl)(urlObjOrString);
}
function LinkComponent(props) {
    const [linkStatus, setOptimisticLinkStatus] = (0, _react.useOptimistic)(_links.IDLE_LINK_STATUS);
    let children;
    const linkInstanceRef = (0, _react.useRef)(null);
    const { href: hrefProp, as: asProp, children: childrenProp, prefetch: prefetchProp = null, passHref, replace, shallow, scroll, onClick, onMouseEnter: onMouseEnterProp, onTouchStart: onTouchStartProp, legacyBehavior = false, onNavigate, ref: forwardedRef, unstable_dynamicOnHover, ...restProps } = props;
    children = childrenProp;
    if (legacyBehavior && (typeof children === 'string' || typeof children === 'number')) {
        children = /*#__PURE__*/ (0, _jsxruntime.jsx)("a", {
            children: children
        });
    }
    const router = _react.default.useContext(_approutercontextsharedruntime.AppRouterContext);
    const prefetchEnabled = prefetchProp !== false;
    const fetchStrategy = prefetchProp !== false ? getFetchStrategyFromPrefetchProp(prefetchProp) : _types.FetchStrategy.PPR;
    if ("TURBOPACK compile-time truthy", 1) {
        function createPropError(args) {
            return Object.defineProperty(new Error(`Failed prop type: The prop \`${args.key}\` expects a ${args.expected} in \`<Link>\`, but got \`${args.actual}\` instead.` + (typeof window !== 'undefined' ? "\nOpen your browser's console to view the Component stack trace." : '')), "__NEXT_ERROR_CODE", {
                value: "E319",
                enumerable: false,
                configurable: true
            });
        }
        // TypeScript trick for type-guarding:
        const requiredPropsGuard = {
            href: true
        };
        const requiredProps = Object.keys(requiredPropsGuard);
        requiredProps.forEach((key)=>{
            if (key === 'href') {
                if (props[key] == null || typeof props[key] !== 'string' && typeof props[key] !== 'object') {
                    throw createPropError({
                        key,
                        expected: '`string` or `object`',
                        actual: props[key] === null ? 'null' : typeof props[key]
                    });
                }
            } else {
                // TypeScript trick for type-guarding:
                const _ = key;
            }
        });
        // TypeScript trick for type-guarding:
        const optionalPropsGuard = {
            as: true,
            replace: true,
            scroll: true,
            shallow: true,
            passHref: true,
            prefetch: true,
            unstable_dynamicOnHover: true,
            onClick: true,
            onMouseEnter: true,
            onTouchStart: true,
            legacyBehavior: true,
            onNavigate: true
        };
        const optionalProps = Object.keys(optionalPropsGuard);
        optionalProps.forEach((key)=>{
            const valType = typeof props[key];
            if (key === 'as') {
                if (props[key] && valType !== 'string' && valType !== 'object') {
                    throw createPropError({
                        key,
                        expected: '`string` or `object`',
                        actual: valType
                    });
                }
            } else if (key === 'onClick' || key === 'onMouseEnter' || key === 'onTouchStart' || key === 'onNavigate') {
                if (props[key] && valType !== 'function') {
                    throw createPropError({
                        key,
                        expected: '`function`',
                        actual: valType
                    });
                }
            } else if (key === 'replace' || key === 'scroll' || key === 'shallow' || key === 'passHref' || key === 'legacyBehavior' || key === 'unstable_dynamicOnHover') {
                if (props[key] != null && valType !== 'boolean') {
                    throw createPropError({
                        key,
                        expected: '`boolean`',
                        actual: valType
                    });
                }
            } else if (key === 'prefetch') {
                if (props[key] != null && valType !== 'boolean' && props[key] !== 'auto') {
                    throw createPropError({
                        key,
                        expected: '`boolean | "auto"`',
                        actual: valType
                    });
                }
            } else {
                // TypeScript trick for type-guarding:
                const _ = key;
            }
        });
    }
    if ("TURBOPACK compile-time truthy", 1) {
        if (props.locale) {
            (0, _warnonce.warnOnce)('The `locale` prop is not supported in `next/link` while using the `app` router. Read more about app router internalization: https://nextjs.org/docs/app/building-your-application/routing/internationalization');
        }
        if (!asProp) {
            let href;
            if (typeof hrefProp === 'string') {
                href = hrefProp;
            } else if (typeof hrefProp === 'object' && typeof hrefProp.pathname === 'string') {
                href = hrefProp.pathname;
            }
            if (href) {
                const hasDynamicSegment = href.split('/').some((segment)=>segment.startsWith('[') && segment.endsWith(']'));
                if (hasDynamicSegment) {
                    throw Object.defineProperty(new Error(`Dynamic href \`${href}\` found in <Link> while using the \`/app\` router, this is not supported. Read more: https://nextjs.org/docs/messages/app-dir-dynamic-href`), "__NEXT_ERROR_CODE", {
                        value: "E267",
                        enumerable: false,
                        configurable: true
                    });
                }
            }
        }
    }
    const { href, as } = _react.default.useMemo({
        "LinkComponent.useMemo": ()=>{
            const resolvedHref = formatStringOrUrl(hrefProp);
            return {
                href: resolvedHref,
                as: asProp ? formatStringOrUrl(asProp) : resolvedHref
            };
        }
    }["LinkComponent.useMemo"], [
        hrefProp,
        asProp
    ]);
    // This will return the first child, if multiple are provided it will throw an error
    let child;
    if (legacyBehavior) {
        if (children?.$$typeof === Symbol.for('react.lazy')) {
            throw Object.defineProperty(new Error(`\`<Link legacyBehavior>\` received a direct child that is either a Server Component, or JSX that was loaded with React.lazy(). This is not supported. Either remove legacyBehavior, or make the direct child a Client Component that renders the Link's \`<a>\` tag.`), "__NEXT_ERROR_CODE", {
                value: "E863",
                enumerable: false,
                configurable: true
            });
        }
        if ("TURBOPACK compile-time truthy", 1) {
            if (onClick) {
                console.warn(`"onClick" was passed to <Link> with \`href\` of \`${hrefProp}\` but "legacyBehavior" was set. The legacy behavior requires onClick be set on the child of next/link`);
            }
            if (onMouseEnterProp) {
                console.warn(`"onMouseEnter" was passed to <Link> with \`href\` of \`${hrefProp}\` but "legacyBehavior" was set. The legacy behavior requires onMouseEnter be set on the child of next/link`);
            }
            try {
                child = _react.default.Children.only(children);
            } catch (err) {
                if (!children) {
                    throw Object.defineProperty(new Error(`No children were passed to <Link> with \`href\` of \`${hrefProp}\` but one child is required https://nextjs.org/docs/messages/link-no-children`), "__NEXT_ERROR_CODE", {
                        value: "E320",
                        enumerable: false,
                        configurable: true
                    });
                }
                throw Object.defineProperty(new Error(`Multiple children were passed to <Link> with \`href\` of \`${hrefProp}\` but only one child is supported https://nextjs.org/docs/messages/link-multiple-children` + (typeof window !== 'undefined' ? " \nOpen your browser's console to view the Component stack trace." : '')), "__NEXT_ERROR_CODE", {
                    value: "E266",
                    enumerable: false,
                    configurable: true
                });
            }
        } else //TURBOPACK unreachable
        ;
    } else {
        if ("TURBOPACK compile-time truthy", 1) {
            if (children?.type === 'a') {
                throw Object.defineProperty(new Error('Invalid <Link> with <a> child. Please remove <a> or use <Link legacyBehavior>.\nLearn more: https://nextjs.org/docs/messages/invalid-new-link-with-extra-anchor'), "__NEXT_ERROR_CODE", {
                    value: "E209",
                    enumerable: false,
                    configurable: true
                });
            }
        }
    }
    const childRef = legacyBehavior ? child && typeof child === 'object' && child.ref : forwardedRef;
    // Use a callback ref to attach an IntersectionObserver to the anchor tag on
    // mount. In the future we will also use this to keep track of all the
    // currently mounted <Link> instances, e.g. so we can re-prefetch them after
    // a revalidation or refresh.
    const observeLinkVisibilityOnMount = _react.default.useCallback({
        "LinkComponent.useCallback[observeLinkVisibilityOnMount]": (element)=>{
            if (router !== null) {
                linkInstanceRef.current = (0, _links.mountLinkInstance)(element, href, router, fetchStrategy, prefetchEnabled, setOptimisticLinkStatus);
            }
            return ({
                "LinkComponent.useCallback[observeLinkVisibilityOnMount]": ()=>{
                    if (linkInstanceRef.current) {
                        (0, _links.unmountLinkForCurrentNavigation)(linkInstanceRef.current);
                        linkInstanceRef.current = null;
                    }
                    (0, _links.unmountPrefetchableInstance)(element);
                }
            })["LinkComponent.useCallback[observeLinkVisibilityOnMount]"];
        }
    }["LinkComponent.useCallback[observeLinkVisibilityOnMount]"], [
        prefetchEnabled,
        href,
        router,
        fetchStrategy,
        setOptimisticLinkStatus
    ]);
    const mergedRef = (0, _usemergedref.useMergedRef)(observeLinkVisibilityOnMount, childRef);
    const childProps = {
        ref: mergedRef,
        onClick (e) {
            if ("TURBOPACK compile-time truthy", 1) {
                if (!e) {
                    throw Object.defineProperty(new Error(`Component rendered inside next/link has to pass click event to "onClick" prop.`), "__NEXT_ERROR_CODE", {
                        value: "E312",
                        enumerable: false,
                        configurable: true
                    });
                }
            }
            if (!legacyBehavior && typeof onClick === 'function') {
                onClick(e);
            }
            if (legacyBehavior && child.props && typeof child.props.onClick === 'function') {
                child.props.onClick(e);
            }
            if (!router) {
                return;
            }
            if (e.defaultPrevented) {
                return;
            }
            linkClicked(e, href, as, linkInstanceRef, replace, scroll, onNavigate);
        },
        onMouseEnter (e) {
            if (!legacyBehavior && typeof onMouseEnterProp === 'function') {
                onMouseEnterProp(e);
            }
            if (legacyBehavior && child.props && typeof child.props.onMouseEnter === 'function') {
                child.props.onMouseEnter(e);
            }
            if (!router) {
                return;
            }
            if ("TURBOPACK compile-time truthy", 1) {
                return;
            }
            //TURBOPACK unreachable
            ;
            const upgradeToDynamicPrefetch = undefined;
        },
        onTouchStart: ("TURBOPACK compile-time falsy", 0) ? "TURBOPACK unreachable" : function onTouchStart(e) {
            if (!legacyBehavior && typeof onTouchStartProp === 'function') {
                onTouchStartProp(e);
            }
            if (legacyBehavior && child.props && typeof child.props.onTouchStart === 'function') {
                child.props.onTouchStart(e);
            }
            if (!router) {
                return;
            }
            if (!prefetchEnabled) {
                return;
            }
            const upgradeToDynamicPrefetch = unstable_dynamicOnHover === true;
            (0, _links.onNavigationIntent)(e.currentTarget, upgradeToDynamicPrefetch);
        }
    };
    // If the url is absolute, we can bypass the logic to prepend the basePath.
    if ((0, _utils.isAbsoluteUrl)(as)) {
        childProps.href = as;
    } else if (!legacyBehavior || passHref || child.type === 'a' && !('href' in child.props)) {
        childProps.href = (0, _addbasepath.addBasePath)(as);
    }
    let link;
    if (legacyBehavior) {
        if ("TURBOPACK compile-time truthy", 1) {
            (0, _erroronce.errorOnce)('`legacyBehavior` is deprecated and will be removed in a future ' + 'release. A codemod is available to upgrade your components:\n\n' + 'npx @next/codemod@latest new-link .\n\n' + 'Learn more: https://nextjs.org/docs/app/building-your-application/upgrading/codemods#remove-a-tags-from-link-components');
        }
        link = /*#__PURE__*/ _react.default.cloneElement(child, childProps);
    } else {
        link = /*#__PURE__*/ (0, _jsxruntime.jsx)("a", {
            ...restProps,
            ...childProps,
            children: children
        });
    }
    return /*#__PURE__*/ (0, _jsxruntime.jsx)(LinkStatusContext.Provider, {
        value: linkStatus,
        children: link
    });
}
const LinkStatusContext = /*#__PURE__*/ (0, _react.createContext)(_links.IDLE_LINK_STATUS);
const useLinkStatus = ()=>{
    return (0, _react.useContext)(LinkStatusContext);
};
function getFetchStrategyFromPrefetchProp(prefetchProp) {
    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
    ;
    else {
        return prefetchProp === null || prefetchProp === 'auto' ? _types.FetchStrategy.PPR : // (although invalid values should've been filtered out by prop validation in dev)
        _types.FetchStrategy.Full;
    }
}
if ((typeof exports.default === 'function' || typeof exports.default === 'object' && exports.default !== null) && typeof exports.default.__esModule === 'undefined') {
    Object.defineProperty(exports.default, '__esModule', {
        value: true
    });
    Object.assign(exports.default, exports);
    module.exports = exports.default;
} //# sourceMappingURL=link.js.map
}),
]);

//# sourceMappingURL=9f1d4_863c7c4a._.js.map