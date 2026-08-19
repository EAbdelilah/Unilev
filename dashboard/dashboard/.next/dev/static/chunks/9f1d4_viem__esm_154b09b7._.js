(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/dashboard/node_modules/viem/_esm/errors/fee.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "BaseFeeScalarError",
    ()=>BaseFeeScalarError,
    "Eip1559FeesNotSupportedError",
    ()=>Eip1559FeesNotSupportedError,
    "MaxFeePerGasTooLowError",
    ()=>MaxFeePerGasTooLowError
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$unit$2f$formatGwei$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/unit/formatGwei.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/base.js [app-client] (ecmascript)");
;
;
class BaseFeeScalarError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor(){
        super('`baseFeeMultiplier` must be greater than 1.', {
            name: 'BaseFeeScalarError'
        });
    }
}
class Eip1559FeesNotSupportedError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor(){
        super('Chain does not support EIP-1559 fees.', {
            name: 'Eip1559FeesNotSupportedError'
        });
    }
}
class MaxFeePerGasTooLowError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor({ maxPriorityFeePerGas }){
        super(`\`maxFeePerGas\` cannot be less than the \`maxPriorityFeePerGas\` (${(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$unit$2f$formatGwei$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatGwei"])(maxPriorityFeePerGas)} gwei).`, {
            name: 'MaxFeePerGasTooLowError'
        });
    }
} //# sourceMappingURL=fee.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/errors/getNodeError.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "containsNodeError",
    ()=>containsNodeError,
    "getNodeError",
    ()=>getNodeError
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/base.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/node.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$request$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/request.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$rpc$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/rpc.js [app-client] (ecmascript)");
;
;
;
;
function containsNodeError(err) {
    return err instanceof __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$rpc$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["TransactionRejectedRpcError"] || err instanceof __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$rpc$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["InvalidInputRpcError"] || err instanceof __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$request$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["RpcRequestError"] && err.code === __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ExecutionRevertedError"].code;
}
function getNodeError(err, args) {
    const message = (err.details || '').toLowerCase();
    const executionRevertedError = err instanceof __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] ? err.walk((e)=>e?.code === __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ExecutionRevertedError"].code) : err;
    if (executionRevertedError instanceof __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"]) return new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ExecutionRevertedError"]({
        cause: err,
        message: executionRevertedError.details
    });
    if (__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ExecutionRevertedError"].nodeMessage.test(message)) return new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ExecutionRevertedError"]({
        cause: err,
        message: err.details
    });
    if (__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["FeeCapTooHighError"].nodeMessage.test(message)) return new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["FeeCapTooHighError"]({
        cause: err,
        maxFeePerGas: args?.maxFeePerGas
    });
    if (__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["FeeCapTooLowError"].nodeMessage.test(message)) return new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["FeeCapTooLowError"]({
        cause: err,
        maxFeePerGas: args?.maxFeePerGas
    });
    if (__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["NonceTooHighError"].nodeMessage.test(message)) return new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["NonceTooHighError"]({
        cause: err,
        nonce: args?.nonce
    });
    if (__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["NonceTooLowError"].nodeMessage.test(message)) return new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["NonceTooLowError"]({
        cause: err,
        nonce: args?.nonce
    });
    if (__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["NonceMaxValueError"].nodeMessage.test(message)) return new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["NonceMaxValueError"]({
        cause: err,
        nonce: args?.nonce
    });
    if (__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["InsufficientFundsError"].nodeMessage.test(message)) return new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["InsufficientFundsError"]({
        cause: err
    });
    if (__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["IntrinsicGasTooHighError"].nodeMessage.test(message)) return new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["IntrinsicGasTooHighError"]({
        cause: err,
        gas: args?.gas
    });
    if (__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["IntrinsicGasTooLowError"].nodeMessage.test(message)) return new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["IntrinsicGasTooLowError"]({
        cause: err,
        gas: args?.gas
    });
    if (__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["TransactionTypeNotSupportedError"].nodeMessage.test(message)) return new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["TransactionTypeNotSupportedError"]({
        cause: err
    });
    if (__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["TipAboveFeeCapError"].nodeMessage.test(message)) return new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["TipAboveFeeCapError"]({
        cause: err,
        maxFeePerGas: args?.maxFeePerGas,
        maxPriorityFeePerGas: args?.maxPriorityFeePerGas
    });
    return new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["UnknownNodeError"]({
        cause: err
    });
} //# sourceMappingURL=getNodeError.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/errors/getTransactionError.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getTransactionError",
    ()=>getTransactionError
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/node.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$transaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/transaction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$errors$2f$getNodeError$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/errors/getNodeError.js [app-client] (ecmascript)");
;
;
;
function getTransactionError(err, { docsPath, ...args }) {
    const cause = (()=>{
        const cause = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$errors$2f$getNodeError$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getNodeError"])(err, args);
        if (cause instanceof __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["UnknownNodeError"]) return err;
        return cause;
    })();
    return new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$transaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["TransactionExecutionError"](cause, {
        docsPath,
        ...args
    });
} //# sourceMappingURL=getTransactionError.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/formatters/extract.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * @description Picks out the keys from `value` that exist in the formatter..
 */ __turbopack_context__.s([
    "extract",
    ()=>extract
]);
function extract(value_, { format }) {
    if (!format) return {};
    const value = {};
    function extract_(formatted) {
        const keys = Object.keys(formatted);
        for (const key of keys){
            if (key in value_) value[key] = value_[key];
            if (formatted[key] && typeof formatted[key] === 'object' && !Array.isArray(formatted[key])) extract_(formatted[key]);
        }
    }
    const formatted = format(value_ || {});
    extract_(formatted);
    return value;
} //# sourceMappingURL=extract.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/formatters/transactionRequest.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "defineTransactionRequest",
    ()=>defineTransactionRequest,
    "formatTransactionRequest",
    ()=>formatTransactionRequest,
    "rpcTransactionType",
    ()=>rpcTransactionType
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/toHex.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$formatter$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/formatters/formatter.js [app-client] (ecmascript)");
;
;
const rpcTransactionType = {
    legacy: '0x0',
    eip2930: '0x1',
    eip1559: '0x2',
    eip4844: '0x3',
    eip7702: '0x4'
};
function formatTransactionRequest(request, _) {
    const rpcRequest = {};
    if (typeof request.authorizationList !== 'undefined') rpcRequest.authorizationList = formatAuthorizationList(request.authorizationList);
    if (typeof request.accessList !== 'undefined') rpcRequest.accessList = request.accessList;
    if (typeof request.blobVersionedHashes !== 'undefined') rpcRequest.blobVersionedHashes = request.blobVersionedHashes;
    if (typeof request.blobs !== 'undefined') {
        if (typeof request.blobs[0] !== 'string') rpcRequest.blobs = request.blobs.map((x)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["bytesToHex"])(x));
        else rpcRequest.blobs = request.blobs;
    }
    if (typeof request.data !== 'undefined') rpcRequest.data = request.data;
    if (request.account) rpcRequest.from = request.account.address;
    if (typeof request.from !== 'undefined') rpcRequest.from = request.from;
    if (typeof request.gas !== 'undefined') rpcRequest.gas = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(request.gas);
    if (typeof request.gasPrice !== 'undefined') rpcRequest.gasPrice = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(request.gasPrice);
    if (typeof request.maxFeePerBlobGas !== 'undefined') rpcRequest.maxFeePerBlobGas = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(request.maxFeePerBlobGas);
    if (typeof request.maxFeePerGas !== 'undefined') rpcRequest.maxFeePerGas = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(request.maxFeePerGas);
    if (typeof request.maxPriorityFeePerGas !== 'undefined') rpcRequest.maxPriorityFeePerGas = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(request.maxPriorityFeePerGas);
    if (typeof request.nonce !== 'undefined') rpcRequest.nonce = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(request.nonce);
    if (typeof request.to !== 'undefined') rpcRequest.to = request.to;
    if (typeof request.type !== 'undefined') rpcRequest.type = rpcTransactionType[request.type];
    if (typeof request.value !== 'undefined') rpcRequest.value = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(request.value);
    return rpcRequest;
}
const defineTransactionRequest = /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$formatter$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["defineFormatter"])('transactionRequest', formatTransactionRequest);
//////////////////////////////////////////////////////////////////////////////
function formatAuthorizationList(authorizationList) {
    return authorizationList.map((authorization)=>({
            address: authorization.address,
            r: authorization.r ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(BigInt(authorization.r)) : authorization.r,
            s: authorization.s ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(BigInt(authorization.s)) : authorization.s,
            chainId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(authorization.chainId),
            nonce: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(authorization.nonce),
            ...typeof authorization.yParity !== 'undefined' ? {
                yParity: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(authorization.yParity)
            } : {},
            ...typeof authorization.v !== 'undefined' && typeof authorization.yParity === 'undefined' ? {
                v: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(authorization.v)
            } : {}
        }));
} //# sourceMappingURL=transactionRequest.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/getAction.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Retrieves and returns an action from the client (if exists), and falls
 * back to the tree-shakable action.
 *
 * Useful for extracting overridden actions from a client (ie. if a consumer
 * wants to override the `sendTransaction` implementation).
 */ __turbopack_context__.s([
    "getAction",
    ()=>getAction
]);
function getAction(client, actionFn, // Some minifiers drop `Function.prototype.name`, or replace it with short letters,
// meaning that `actionFn.name` will not always work. For that case, the consumer
// needs to pass the name explicitly.
name) {
    const action_implicit = client[actionFn.name];
    if (typeof action_implicit === 'function') return action_implicit;
    const action_explicit = client[name];
    if (typeof action_explicit === 'function') return action_explicit;
    return (params)=>actionFn(client, params);
} //# sourceMappingURL=getAction.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/transaction/assertRequest.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "assertRequest",
    ()=>assertRequest
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/accounts/utils/parseAccount.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$constants$2f$number$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/constants/number.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$address$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/address.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/node.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$isAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/address/isAddress.js [app-client] (ecmascript)");
;
;
;
;
;
function assertRequest(args) {
    const { account: account_, maxFeePerGas, maxPriorityFeePerGas, to } = args;
    const account = account_ ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["parseAccount"])(account_) : undefined;
    if (account && !(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$isAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAddress"])(account.address)) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$address$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["InvalidAddressError"]({
        address: account.address
    });
    if (to && !(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$isAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAddress"])(to)) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$address$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["InvalidAddressError"]({
        address: to
    });
    if (maxFeePerGas && maxFeePerGas > __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$constants$2f$number$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["maxUint256"]) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["FeeCapTooHighError"]({
        maxFeePerGas
    });
    if (maxPriorityFeePerGas && maxFeePerGas && maxPriorityFeePerGas > maxFeePerGas) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["TipAboveFeeCapError"]({
        maxFeePerGas,
        maxPriorityFeePerGas
    });
} //# sourceMappingURL=assertRequest.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/errors/block.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "BlockNotFoundError",
    ()=>BlockNotFoundError
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/base.js [app-client] (ecmascript)");
;
class BlockNotFoundError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor({ blockHash, blockNumber }){
        let identifier = 'Block';
        if (blockHash) identifier = `Block at hash "${blockHash}"`;
        if (blockNumber) identifier = `Block at number "${blockNumber}"`;
        super(`${identifier} could not be found.`, {
            name: 'BlockNotFoundError'
        });
    }
} //# sourceMappingURL=block.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/public/getBlock.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getBlock",
    ()=>getBlock
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$block$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/block.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/toHex.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$block$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/formatters/block.js [app-client] (ecmascript)");
;
;
;
async function getBlock(client, { blockHash, blockNumber, blockTag = client.experimental_blockTag ?? 'latest', includeTransactions: includeTransactions_ } = {}) {
    const includeTransactions = includeTransactions_ ?? false;
    const blockNumberHex = blockNumber !== undefined ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(blockNumber) : undefined;
    let block = null;
    if (blockHash) {
        block = await client.request({
            method: 'eth_getBlockByHash',
            params: [
                blockHash,
                includeTransactions
            ]
        }, {
            dedupe: true
        });
    } else {
        block = await client.request({
            method: 'eth_getBlockByNumber',
            params: [
                blockNumberHex || blockTag,
                includeTransactions
            ]
        }, {
            dedupe: Boolean(blockNumberHex)
        });
    }
    if (!block) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$block$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BlockNotFoundError"]({
        blockHash,
        blockNumber
    });
    const format = client.chain?.formatters?.block?.format || __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$block$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatBlock"];
    return format(block, 'getBlock');
} //# sourceMappingURL=getBlock.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/public/getChainId.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getChainId",
    ()=>getChainId
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/fromHex.js [app-client] (ecmascript)");
;
async function getChainId(client) {
    const chainIdHex = await client.request({
        method: 'eth_chainId'
    }, {
        dedupe: true
    });
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hexToNumber"])(chainIdHex);
} //# sourceMappingURL=getChainId.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/public/fillTransaction.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "fillTransaction",
    ()=>fillTransaction
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/accounts/utils/parseAccount.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$fee$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/fee.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$errors$2f$getTransactionError$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/errors/getTransactionError.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$extract$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/formatters/extract.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$transaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/formatters/transaction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$transactionRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/formatters/transactionRequest.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/getAction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$transaction$2f$assertRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/transaction/assertRequest.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getBlock$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/public/getBlock.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getChainId$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/public/getChainId.js [app-client] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
async function fillTransaction(client, parameters) {
    const { account = client.account, accessList, authorizationList, chain = client.chain, blobVersionedHashes, blobs, data, gas, gasPrice, maxFeePerBlobGas, maxFeePerGas, maxPriorityFeePerGas, nonce: nonce_, nonceManager, to, type, value, ...rest } = parameters;
    const nonce = await (async ()=>{
        if (!account) return nonce_;
        if (!nonceManager) return nonce_;
        if (typeof nonce_ !== 'undefined') return nonce_;
        const account_ = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["parseAccount"])(account);
        const chainId = chain ? chain.id : await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getChainId$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getChainId"], 'getChainId')({});
        return await nonceManager.consume({
            address: account_.address,
            chainId,
            client
        });
    })();
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$transaction$2f$assertRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["assertRequest"])(parameters);
    const chainFormat = chain?.formatters?.transactionRequest?.format;
    const format = chainFormat || __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$transactionRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatTransactionRequest"];
    const request = format({
        // Pick out extra data that might exist on the chain's transaction request type.
        ...(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$extract$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["extract"])(rest, {
            format: chainFormat
        }),
        account: account ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["parseAccount"])(account) : undefined,
        accessList,
        authorizationList,
        blobs,
        blobVersionedHashes,
        data,
        gas,
        gasPrice,
        maxFeePerBlobGas,
        maxFeePerGas,
        maxPriorityFeePerGas,
        nonce,
        to,
        type,
        value
    }, 'fillTransaction');
    try {
        const response = await client.request({
            method: 'eth_fillTransaction',
            params: [
                request
            ]
        });
        const format = chain?.formatters?.transaction?.format || __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$transaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatTransaction"];
        const transaction = format(response.tx);
        // Remove unnecessary fields.
        delete transaction.blockHash;
        delete transaction.blockNumber;
        delete transaction.r;
        delete transaction.s;
        delete transaction.transactionIndex;
        delete transaction.v;
        delete transaction.yParity;
        // Rewrite fields.
        transaction.data = transaction.input;
        // Preference supplied fees (some nodes do not take these preferences).
        if (transaction.gas) transaction.gas = parameters.gas ?? transaction.gas;
        if (transaction.gasPrice) transaction.gasPrice = parameters.gasPrice ?? transaction.gasPrice;
        if (transaction.maxFeePerBlobGas) transaction.maxFeePerBlobGas = parameters.maxFeePerBlobGas ?? transaction.maxFeePerBlobGas;
        if (transaction.maxFeePerGas) transaction.maxFeePerGas = parameters.maxFeePerGas ?? transaction.maxFeePerGas;
        if (transaction.maxPriorityFeePerGas) transaction.maxPriorityFeePerGas = parameters.maxPriorityFeePerGas ?? transaction.maxPriorityFeePerGas;
        if (transaction.nonce) transaction.nonce = parameters.nonce ?? transaction.nonce;
        // Build fee multiplier function.
        const feeMultiplier = await (async ()=>{
            if (typeof chain?.fees?.baseFeeMultiplier === 'function') {
                const block = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getBlock$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getBlock"], 'getBlock')({});
                return chain.fees.baseFeeMultiplier({
                    block,
                    client,
                    request: parameters
                });
            }
            return chain?.fees?.baseFeeMultiplier ?? 1.2;
        })();
        if (feeMultiplier < 1) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$fee$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseFeeScalarError"]();
        const decimals = feeMultiplier.toString().split('.')[1]?.length ?? 0;
        const denominator = 10 ** decimals;
        const multiplyFee = (base)=>base * BigInt(Math.ceil(feeMultiplier * denominator)) / BigInt(denominator);
        // Apply fee multiplier.
        if (transaction.maxFeePerGas && !parameters.maxFeePerGas) transaction.maxFeePerGas = multiplyFee(transaction.maxFeePerGas);
        if (transaction.gasPrice && !parameters.gasPrice) transaction.gasPrice = multiplyFee(transaction.gasPrice);
        return {
            raw: response.raw,
            transaction: {
                from: request.from,
                ...transaction
            }
        };
    } catch (err) {
        throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$errors$2f$getTransactionError$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getTransactionError"])(err, {
            ...parameters,
            chain: client.chain
        });
    }
} //# sourceMappingURL=fillTransaction.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/wallet/addChain.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "addChain",
    ()=>addChain
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/toHex.js [app-client] (ecmascript)");
;
async function addChain(client, { chain }) {
    const { id, name, nativeCurrency, rpcUrls, blockExplorers } = chain;
    await client.request({
        method: 'wallet_addEthereumChain',
        params: [
            {
                chainId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(id),
                chainName: name,
                nativeCurrency,
                rpcUrls: rpcUrls.default.http,
                blockExplorerUrls: blockExplorers ? Object.values(blockExplorers).map(({ url })=>url) : undefined
            }
        ]
    }, {
        dedupe: true,
        retryCount: 0
    });
} //# sourceMappingURL=addChain.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/abi/formatAbiItem.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "formatAbiItem",
    ()=>formatAbiItem,
    "formatAbiParams",
    ()=>formatAbiParams
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/abi.js [app-client] (ecmascript)");
;
function formatAbiItem(abiItem, { includeName = false } = {}) {
    if (abiItem.type !== 'function' && abiItem.type !== 'event' && abiItem.type !== 'error') throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["InvalidDefinitionTypeError"](abiItem.type);
    return `${abiItem.name}(${formatAbiParams(abiItem.inputs, {
        includeName
    })})`;
}
function formatAbiParams(params, { includeName = false } = {}) {
    if (!params) return '';
    return params.map((param)=>formatAbiParam(param, {
            includeName
        })).join(includeName ? ', ' : ',');
}
function formatAbiParam(param, { includeName }) {
    if (param.type.startsWith('tuple')) {
        return `(${formatAbiParams(param.components, {
            includeName
        })})${param.type.slice('tuple'.length)}`;
    }
    return param.type + (includeName && param.name ? ` ${param.name}` : '');
} //# sourceMappingURL=formatAbiItem.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/errors/abi.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AbiConstructorNotFoundError",
    ()=>AbiConstructorNotFoundError,
    "AbiConstructorParamsNotFoundError",
    ()=>AbiConstructorParamsNotFoundError,
    "AbiDecodingDataSizeInvalidError",
    ()=>AbiDecodingDataSizeInvalidError,
    "AbiDecodingDataSizeTooSmallError",
    ()=>AbiDecodingDataSizeTooSmallError,
    "AbiDecodingZeroDataError",
    ()=>AbiDecodingZeroDataError,
    "AbiEncodingArrayLengthMismatchError",
    ()=>AbiEncodingArrayLengthMismatchError,
    "AbiEncodingBytesSizeMismatchError",
    ()=>AbiEncodingBytesSizeMismatchError,
    "AbiEncodingLengthMismatchError",
    ()=>AbiEncodingLengthMismatchError,
    "AbiErrorInputsNotFoundError",
    ()=>AbiErrorInputsNotFoundError,
    "AbiErrorNotFoundError",
    ()=>AbiErrorNotFoundError,
    "AbiErrorSignatureNotFoundError",
    ()=>AbiErrorSignatureNotFoundError,
    "AbiEventNotFoundError",
    ()=>AbiEventNotFoundError,
    "AbiEventSignatureEmptyTopicsError",
    ()=>AbiEventSignatureEmptyTopicsError,
    "AbiEventSignatureNotFoundError",
    ()=>AbiEventSignatureNotFoundError,
    "AbiFunctionNotFoundError",
    ()=>AbiFunctionNotFoundError,
    "AbiFunctionOutputsNotFoundError",
    ()=>AbiFunctionOutputsNotFoundError,
    "AbiFunctionSignatureNotFoundError",
    ()=>AbiFunctionSignatureNotFoundError,
    "AbiItemAmbiguityError",
    ()=>AbiItemAmbiguityError,
    "BytesSizeMismatchError",
    ()=>BytesSizeMismatchError,
    "DecodeLogDataMismatch",
    ()=>DecodeLogDataMismatch,
    "DecodeLogTopicsMismatch",
    ()=>DecodeLogTopicsMismatch,
    "InvalidAbiDecodingTypeError",
    ()=>InvalidAbiDecodingTypeError,
    "InvalidAbiEncodingTypeError",
    ()=>InvalidAbiEncodingTypeError,
    "InvalidArrayError",
    ()=>InvalidArrayError,
    "InvalidDefinitionTypeError",
    ()=>InvalidDefinitionTypeError,
    "UnsupportedPackedAbiType",
    ()=>UnsupportedPackedAbiType
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$formatAbiItem$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/abi/formatAbiItem.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$size$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/data/size.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/base.js [app-client] (ecmascript)");
;
;
;
class AbiConstructorNotFoundError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor({ docsPath }){
        super([
            'A constructor was not found on the ABI.',
            'Make sure you are using the correct ABI and that the constructor exists on it.'
        ].join('\n'), {
            docsPath,
            name: 'AbiConstructorNotFoundError'
        });
    }
}
class AbiConstructorParamsNotFoundError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor({ docsPath }){
        super([
            'Constructor arguments were provided (`args`), but a constructor parameters (`inputs`) were not found on the ABI.',
            'Make sure you are using the correct ABI, and that the `inputs` attribute on the constructor exists.'
        ].join('\n'), {
            docsPath,
            name: 'AbiConstructorParamsNotFoundError'
        });
    }
}
class AbiDecodingDataSizeInvalidError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor({ data, size }){
        super([
            `Data size of ${size} bytes is invalid.`,
            'Size must be in increments of 32 bytes (size % 32 === 0).'
        ].join('\n'), {
            metaMessages: [
                `Data: ${data} (${size} bytes)`
            ],
            name: 'AbiDecodingDataSizeInvalidError'
        });
    }
}
class AbiDecodingDataSizeTooSmallError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor({ data, params, size }){
        super([
            `Data size of ${size} bytes is too small for given parameters.`
        ].join('\n'), {
            metaMessages: [
                `Params: (${(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$formatAbiItem$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatAbiParams"])(params, {
                    includeName: true
                })})`,
                `Data:   ${data} (${size} bytes)`
            ],
            name: 'AbiDecodingDataSizeTooSmallError'
        });
        Object.defineProperty(this, "data", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "params", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "size", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.data = data;
        this.params = params;
        this.size = size;
    }
}
class AbiDecodingZeroDataError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor({ cause } = {}){
        super('Cannot decode zero data ("0x") with ABI parameters.', {
            name: 'AbiDecodingZeroDataError',
            cause
        });
    }
}
class AbiEncodingArrayLengthMismatchError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor({ expectedLength, givenLength, type }){
        super([
            `ABI encoding array length mismatch for type ${type}.`,
            `Expected length: ${expectedLength}`,
            `Given length: ${givenLength}`
        ].join('\n'), {
            name: 'AbiEncodingArrayLengthMismatchError'
        });
    }
}
class AbiEncodingBytesSizeMismatchError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor({ expectedSize, value }){
        super(`Size of bytes "${value}" (bytes${(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$size$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["size"])(value)}) does not match expected size (bytes${expectedSize}).`, {
            name: 'AbiEncodingBytesSizeMismatchError'
        });
    }
}
class AbiEncodingLengthMismatchError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor({ expectedLength, givenLength }){
        super([
            'ABI encoding params/values length mismatch.',
            `Expected length (params): ${expectedLength}`,
            `Given length (values): ${givenLength}`
        ].join('\n'), {
            name: 'AbiEncodingLengthMismatchError'
        });
    }
}
class AbiErrorInputsNotFoundError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor(errorName, { docsPath }){
        super([
            `Arguments (\`args\`) were provided to "${errorName}", but "${errorName}" on the ABI does not contain any parameters (\`inputs\`).`,
            'Cannot encode error result without knowing what the parameter types are.',
            'Make sure you are using the correct ABI and that the inputs exist on it.'
        ].join('\n'), {
            docsPath,
            name: 'AbiErrorInputsNotFoundError'
        });
    }
}
class AbiErrorNotFoundError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor(errorName, { docsPath } = {}){
        super([
            `Error ${errorName ? `"${errorName}" ` : ''}not found on ABI.`,
            'Make sure you are using the correct ABI and that the error exists on it.'
        ].join('\n'), {
            docsPath,
            name: 'AbiErrorNotFoundError'
        });
    }
}
class AbiErrorSignatureNotFoundError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor(signature, { docsPath, cause }){
        super([
            `Encoded error signature "${signature}" not found on ABI.`,
            'Make sure you are using the correct ABI and that the error exists on it.',
            `You can look up the decoded signature here: https://4byte.sourcify.dev/?q=${signature}.`
        ].join('\n'), {
            docsPath,
            name: 'AbiErrorSignatureNotFoundError',
            cause
        });
        Object.defineProperty(this, "signature", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.signature = signature;
    }
}
class AbiEventSignatureEmptyTopicsError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor({ docsPath }){
        super('Cannot extract event signature from empty topics.', {
            docsPath,
            name: 'AbiEventSignatureEmptyTopicsError'
        });
    }
}
class AbiEventSignatureNotFoundError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor(signature, { docsPath }){
        super([
            `Encoded event signature "${signature}" not found on ABI.`,
            'Make sure you are using the correct ABI and that the event exists on it.',
            `You can look up the signature here: https://4byte.sourcify.dev/?q=${signature}.`
        ].join('\n'), {
            docsPath,
            name: 'AbiEventSignatureNotFoundError'
        });
    }
}
class AbiEventNotFoundError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor(eventName, { docsPath } = {}){
        super([
            `Event ${eventName ? `"${eventName}" ` : ''}not found on ABI.`,
            'Make sure you are using the correct ABI and that the event exists on it.'
        ].join('\n'), {
            docsPath,
            name: 'AbiEventNotFoundError'
        });
    }
}
class AbiFunctionNotFoundError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor(functionName, { docsPath } = {}){
        super([
            `Function ${functionName ? `"${functionName}" ` : ''}not found on ABI.`,
            'Make sure you are using the correct ABI and that the function exists on it.'
        ].join('\n'), {
            docsPath,
            name: 'AbiFunctionNotFoundError'
        });
    }
}
class AbiFunctionOutputsNotFoundError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor(functionName, { docsPath }){
        super([
            `Function "${functionName}" does not contain any \`outputs\` on ABI.`,
            'Cannot decode function result without knowing what the parameter types are.',
            'Make sure you are using the correct ABI and that the function exists on it.'
        ].join('\n'), {
            docsPath,
            name: 'AbiFunctionOutputsNotFoundError'
        });
    }
}
class AbiFunctionSignatureNotFoundError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor(signature, { docsPath }){
        super([
            `Encoded function signature "${signature}" not found on ABI.`,
            'Make sure you are using the correct ABI and that the function exists on it.',
            `You can look up the signature here: https://4byte.sourcify.dev/?q=${signature}.`
        ].join('\n'), {
            docsPath,
            name: 'AbiFunctionSignatureNotFoundError'
        });
    }
}
class AbiItemAmbiguityError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor(x, y){
        super('Found ambiguous types in overloaded ABI items.', {
            metaMessages: [
                `\`${x.type}\` in \`${(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$formatAbiItem$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatAbiItem"])(x.abiItem)}\`, and`,
                `\`${y.type}\` in \`${(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$formatAbiItem$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatAbiItem"])(y.abiItem)}\``,
                '',
                'These types encode differently and cannot be distinguished at runtime.',
                'Remove one of the ambiguous items in the ABI.'
            ],
            name: 'AbiItemAmbiguityError'
        });
    }
}
class BytesSizeMismatchError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor({ expectedSize, givenSize }){
        super(`Expected bytes${expectedSize}, got bytes${givenSize}.`, {
            name: 'BytesSizeMismatchError'
        });
    }
}
class DecodeLogDataMismatch extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor({ abiItem, data, params, size }){
        super([
            `Data size of ${size} bytes is too small for non-indexed event parameters.`
        ].join('\n'), {
            metaMessages: [
                `Params: (${(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$formatAbiItem$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatAbiParams"])(params, {
                    includeName: true
                })})`,
                `Data:   ${data} (${size} bytes)`
            ],
            name: 'DecodeLogDataMismatch'
        });
        Object.defineProperty(this, "abiItem", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "data", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "params", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "size", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.abiItem = abiItem;
        this.data = data;
        this.params = params;
        this.size = size;
    }
}
class DecodeLogTopicsMismatch extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor({ abiItem, param }){
        super([
            `Expected a topic for indexed event parameter${param.name ? ` "${param.name}"` : ''} on event "${(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$formatAbiItem$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatAbiItem"])(abiItem, {
                includeName: true
            })}".`
        ].join('\n'), {
            name: 'DecodeLogTopicsMismatch'
        });
        Object.defineProperty(this, "abiItem", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.abiItem = abiItem;
    }
}
class InvalidAbiEncodingTypeError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor(type, { docsPath }){
        super([
            `Type "${type}" is not a valid encoding type.`,
            'Please provide a valid ABI type.'
        ].join('\n'), {
            docsPath,
            name: 'InvalidAbiEncodingType'
        });
    }
}
class InvalidAbiDecodingTypeError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor(type, { docsPath }){
        super([
            `Type "${type}" is not a valid decoding type.`,
            'Please provide a valid ABI type.'
        ].join('\n'), {
            docsPath,
            name: 'InvalidAbiDecodingType'
        });
    }
}
class InvalidArrayError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor(value){
        super([
            `Value "${value}" is not a valid array.`
        ].join('\n'), {
            name: 'InvalidArrayError'
        });
    }
}
class InvalidDefinitionTypeError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor(type){
        super([
            `"${type}" is not a valid definition type.`,
            'Valid types: "function", "event", "error"'
        ].join('\n'), {
            name: 'InvalidDefinitionTypeError'
        });
    }
}
class UnsupportedPackedAbiType extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor(type){
        super(`Type "${type}" is not supported for packed encoding.`, {
            name: 'UnsupportedPackedAbiType'
        });
    }
} //# sourceMappingURL=abi.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/regex.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "arrayRegex",
    ()=>arrayRegex,
    "bytesRegex",
    ()=>bytesRegex,
    "integerRegex",
    ()=>integerRegex
]);
const arrayRegex = /^(.*)\[([0-9]*)\]$/;
const bytesRegex = /^bytes([1-9]|1[0-9]|2[0-9]|3[0-2])?$/;
const integerRegex = /^(u?int)(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?$/; //# sourceMappingURL=regex.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/abi/encodeAbiParameters.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "encodeAbiParameters",
    ()=>encodeAbiParameters,
    "getArrayComponents",
    ()=>getArrayComponents
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/abi.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$address$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/address.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/base.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$encoding$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/encoding.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$isAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/address/isAddress.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$concat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/data/concat.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$pad$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/data/pad.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$size$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/data/size.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$slice$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/data/slice.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/toHex.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$regex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/regex.js [app-client] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
;
function encodeAbiParameters(params, values) {
    if (params.length !== values.length) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AbiEncodingLengthMismatchError"]({
        expectedLength: params.length,
        givenLength: values.length
    });
    // Prepare the parameters to determine dynamic types to encode.
    const preparedParams = prepareParams({
        params: params,
        values: values
    });
    const data = encodeParams(preparedParams);
    if (data.length === 0) return '0x';
    return data;
}
function prepareParams({ params, values }) {
    const preparedParams = [];
    for(let i = 0; i < params.length; i++){
        preparedParams.push(prepareParam({
            param: params[i],
            value: values[i]
        }));
    }
    return preparedParams;
}
function prepareParam({ param, value }) {
    const arrayComponents = getArrayComponents(param.type);
    if (arrayComponents) {
        const [length, type] = arrayComponents;
        return encodeArray(value, {
            length,
            param: {
                ...param,
                type
            }
        });
    }
    if (param.type === 'tuple') {
        return encodeTuple(value, {
            param: param
        });
    }
    if (param.type === 'address') {
        return encodeAddress(value);
    }
    if (param.type === 'bool') {
        return encodeBool(value);
    }
    if (param.type.startsWith('uint') || param.type.startsWith('int')) {
        const signed = param.type.startsWith('int');
        const [, , size = '256'] = __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$regex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["integerRegex"].exec(param.type) ?? [];
        return encodeNumber(value, {
            signed,
            size: Number(size)
        });
    }
    if (param.type.startsWith('bytes')) {
        return encodeBytes(value, {
            param
        });
    }
    if (param.type === 'string') {
        return encodeString(value);
    }
    throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["InvalidAbiEncodingTypeError"](param.type, {
        docsPath: '/docs/contract/encodeAbiParameters'
    });
}
function encodeParams(preparedParams) {
    // 1. Compute the size of the static part of the parameters.
    let staticSize = 0;
    for(let i = 0; i < preparedParams.length; i++){
        const { dynamic, encoded } = preparedParams[i];
        if (dynamic) staticSize += 32;
        else staticSize += (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$size$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["size"])(encoded);
    }
    // 2. Split the parameters into static and dynamic parts.
    const staticParams = [];
    const dynamicParams = [];
    let dynamicSize = 0;
    for(let i = 0; i < preparedParams.length; i++){
        const { dynamic, encoded } = preparedParams[i];
        if (dynamic) {
            staticParams.push((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(staticSize + dynamicSize, {
                size: 32
            }));
            dynamicParams.push(encoded);
            dynamicSize += (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$size$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["size"])(encoded);
        } else {
            staticParams.push(encoded);
        }
    }
    // 3. Concatenate static and dynamic parts.
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$concat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["concat"])([
        ...staticParams,
        ...dynamicParams
    ]);
}
function encodeAddress(value) {
    if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$isAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAddress"])(value)) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$address$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["InvalidAddressError"]({
        address: value
    });
    return {
        dynamic: false,
        encoded: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$pad$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["padHex"])(value.toLowerCase())
    };
}
function encodeArray(value, { length, param }) {
    const dynamic = length === null;
    if (!Array.isArray(value)) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["InvalidArrayError"](value);
    if (!dynamic && value.length !== length) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AbiEncodingArrayLengthMismatchError"]({
        expectedLength: length,
        givenLength: value.length,
        type: `${param.type}[${length}]`
    });
    let dynamicChild = false;
    const preparedParams = [];
    for(let i = 0; i < value.length; i++){
        const preparedParam = prepareParam({
            param,
            value: value[i]
        });
        if (preparedParam.dynamic) dynamicChild = true;
        preparedParams.push(preparedParam);
    }
    if (dynamic || dynamicChild) {
        const data = encodeParams(preparedParams);
        if (dynamic) {
            const length = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(preparedParams.length, {
                size: 32
            });
            return {
                dynamic: true,
                encoded: preparedParams.length > 0 ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$concat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["concat"])([
                    length,
                    data
                ]) : length
            };
        }
        if (dynamicChild) return {
            dynamic: true,
            encoded: data
        };
    }
    return {
        dynamic: false,
        encoded: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$concat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["concat"])(preparedParams.map(({ encoded })=>encoded))
    };
}
function encodeBytes(value, { param }) {
    const [, paramSize] = param.type.split('bytes');
    const bytesSize = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$size$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["size"])(value);
    if (!paramSize) {
        let value_ = value;
        // If the size is not divisible by 32 bytes, pad the end
        // with empty bytes to the ceiling 32 bytes.
        if (bytesSize % 32 !== 0) value_ = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$pad$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["padHex"])(value_, {
            dir: 'right',
            size: Math.ceil((value.length - 2) / 2 / 32) * 32
        });
        return {
            dynamic: true,
            encoded: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$concat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["concat"])([
                (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$pad$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["padHex"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(bytesSize, {
                    size: 32
                })),
                value_
            ])
        };
    }
    if (bytesSize !== Number.parseInt(paramSize, 10)) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AbiEncodingBytesSizeMismatchError"]({
        expectedSize: Number.parseInt(paramSize, 10),
        value
    });
    return {
        dynamic: false,
        encoded: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$pad$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["padHex"])(value, {
            dir: 'right'
        })
    };
}
function encodeBool(value) {
    if (typeof value !== 'boolean') throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"](`Invalid boolean value: "${value}" (type: ${typeof value}). Expected: \`true\` or \`false\`.`);
    return {
        dynamic: false,
        encoded: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$pad$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["padHex"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["boolToHex"])(value))
    };
}
function encodeNumber(value, { signed, size = 256 }) {
    if (typeof size === 'number') {
        const max = 2n ** (BigInt(size) - (signed ? 1n : 0n)) - 1n;
        const min = signed ? -max - 1n : 0n;
        if (value > max || value < min) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$encoding$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["IntegerOutOfRangeError"]({
            max: max.toString(),
            min: min.toString(),
            signed,
            size: size / 8,
            value: value.toString()
        });
    }
    return {
        dynamic: false,
        encoded: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(value, {
            size: 32,
            signed
        })
    };
}
function encodeString(value) {
    const hexValue = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["stringToHex"])(value);
    const partsLength = Math.ceil((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$size$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["size"])(hexValue) / 32);
    const parts = [];
    for(let i = 0; i < partsLength; i++){
        parts.push((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$pad$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["padHex"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$slice$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["slice"])(hexValue, i * 32, (i + 1) * 32), {
            dir: 'right'
        }));
    }
    return {
        dynamic: true,
        encoded: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$concat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["concat"])([
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$pad$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["padHex"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$size$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["size"])(hexValue), {
                size: 32
            })),
            ...parts
        ])
    };
}
function encodeTuple(value, { param }) {
    let dynamic = false;
    const preparedParams = [];
    for(let i = 0; i < param.components.length; i++){
        const param_ = param.components[i];
        const index = Array.isArray(value) ? i : param_.name;
        const preparedParam = prepareParam({
            param: param_,
            value: value[index]
        });
        preparedParams.push(preparedParam);
        if (preparedParam.dynamic) dynamic = true;
    }
    return {
        dynamic,
        encoded: dynamic ? encodeParams(preparedParams) : (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$concat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["concat"])(preparedParams.map(({ encoded })=>encoded))
    };
}
function getArrayComponents(type) {
    const matches = type.match(/^(.*)\[(\d+)?\]$/);
    return matches ? [
        matches[2] ? Number(matches[2]) : null,
        matches[1]
    ] : undefined;
} //# sourceMappingURL=encodeAbiParameters.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/abi/encodeDeployData.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "encodeDeployData",
    ()=>encodeDeployData
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/abi.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$concat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/data/concat.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$encodeAbiParameters$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/abi/encodeAbiParameters.js [app-client] (ecmascript)");
;
;
;
const docsPath = '/docs/contract/encodeDeployData';
function encodeDeployData(parameters) {
    const { abi, args, bytecode } = parameters;
    if (!args || args.length === 0) return bytecode;
    const description = abi.find((x)=>'type' in x && x.type === 'constructor');
    if (!description) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AbiConstructorNotFoundError"]({
        docsPath
    });
    if (!('inputs' in description)) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AbiConstructorParamsNotFoundError"]({
        docsPath
    });
    if (!description.inputs || description.inputs.length === 0) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AbiConstructorParamsNotFoundError"]({
        docsPath
    });
    const data = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$encodeAbiParameters$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["encodeAbiParameters"])(description.inputs, args);
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$concat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["concatHex"])([
        bytecode,
        data
    ]);
} //# sourceMappingURL=encodeDeployData.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/errors/account.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AccountNotFoundError",
    ()=>AccountNotFoundError,
    "AccountTypeNotSupportedError",
    ()=>AccountTypeNotSupportedError
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/base.js [app-client] (ecmascript)");
;
class AccountNotFoundError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor({ docsPath } = {}){
        super([
            'Could not find an Account to execute with this Action.',
            'Please provide an Account with the `account` argument on the Action, or by supplying an `account` to the Client.'
        ].join('\n'), {
            docsPath,
            docsSlug: 'account',
            name: 'AccountNotFoundError'
        });
    }
}
class AccountTypeNotSupportedError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor({ docsPath, metaMessages, type }){
        super(`Account type "${type}" is not supported.`, {
            docsPath,
            metaMessages,
            name: 'AccountTypeNotSupportedError'
        });
    }
} //# sourceMappingURL=account.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/accounts/utils/publicKeyToAddress.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "publicKeyToAddress",
    ()=>publicKeyToAddress
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$getAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/address/getAddress.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$keccak256$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/hash/keccak256.js [app-client] (ecmascript)");
;
;
function publicKeyToAddress(publicKey) {
    const address = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$keccak256$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["keccak256"])(`0x${publicKey.substring(4)}`).substring(26);
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$getAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["checksumAddress"])(`0x${address}`);
} //# sourceMappingURL=publicKeyToAddress.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/signature/recoverPublicKey.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "recoverPublicKey",
    ()=>recoverPublicKey
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$isHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/data/isHex.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$size$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/data/size.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/fromHex.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/toHex.js [app-client] (ecmascript)");
;
;
;
;
async function recoverPublicKey({ hash, signature }) {
    const hashHex = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$isHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isHex"])(hash) ? hash : (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["toHex"])(hash);
    const { secp256k1 } = await __turbopack_context__.A("[project]/dashboard/node_modules/viem/node_modules/@noble/curves/esm/secp256k1.js [app-client] (ecmascript, async loader)");
    const signature_ = (()=>{
        // typeof signature: `Signature`
        if (typeof signature === 'object' && 'r' in signature && 's' in signature) {
            const { r, s, v, yParity } = signature;
            const yParityOrV = Number(yParity ?? v);
            const recoveryBit = toRecoveryBit(yParityOrV);
            return new secp256k1.Signature((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hexToBigInt"])(r), (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hexToBigInt"])(s)).addRecoveryBit(recoveryBit);
        }
        // typeof signature: `Hex | ByteArray`
        const signatureHex = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$isHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isHex"])(signature) ? signature : (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["toHex"])(signature);
        if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$size$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["size"])(signatureHex) !== 65) throw new Error('invalid signature length');
        const yParityOrV = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hexToNumber"])(`0x${signatureHex.slice(130)}`);
        const recoveryBit = toRecoveryBit(yParityOrV);
        return secp256k1.Signature.fromCompact(signatureHex.substring(2, 130)).addRecoveryBit(recoveryBit);
    })();
    const publicKey = signature_.recoverPublicKey(hashHex.substring(2)).toHex(false);
    return `0x${publicKey}`;
}
function toRecoveryBit(yParityOrV) {
    if (yParityOrV === 0 || yParityOrV === 1) return yParityOrV;
    if (yParityOrV === 27) return 0;
    if (yParityOrV === 28) return 1;
    throw new Error('Invalid yParityOrV value');
} //# sourceMappingURL=recoverPublicKey.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/signature/recoverAddress.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "recoverAddress",
    ()=>recoverAddress
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$publicKeyToAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/accounts/utils/publicKeyToAddress.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$signature$2f$recoverPublicKey$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/signature/recoverPublicKey.js [app-client] (ecmascript)");
;
;
async function recoverAddress({ hash, signature }) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$publicKeyToAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["publicKeyToAddress"])(await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$signature$2f$recoverPublicKey$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["recoverPublicKey"])({
        hash,
        signature
    }));
} //# sourceMappingURL=recoverAddress.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/authorization/hashAuthorization.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "hashAuthorization",
    ()=>hashAuthorization
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$concat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/data/concat.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toBytes$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/toBytes.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/toHex.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toRlp$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/toRlp.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$keccak256$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/hash/keccak256.js [app-client] (ecmascript)");
;
;
;
;
;
function hashAuthorization(parameters) {
    const { chainId, nonce, to } = parameters;
    const address = parameters.contractAddress ?? parameters.address;
    const hash = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$keccak256$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["keccak256"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$concat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["concatHex"])([
        '0x05',
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toRlp$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["toRlp"])([
            chainId ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(chainId) : '0x',
            address,
            nonce ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(nonce) : '0x'
        ])
    ]));
    if (to === 'bytes') return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toBytes$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hexToBytes"])(hash);
    return hash;
} //# sourceMappingURL=hashAuthorization.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/authorization/recoverAuthorizationAddress.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "recoverAuthorizationAddress",
    ()=>recoverAuthorizationAddress
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$signature$2f$recoverAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/signature/recoverAddress.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$authorization$2f$hashAuthorization$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/authorization/hashAuthorization.js [app-client] (ecmascript)");
;
;
async function recoverAuthorizationAddress(parameters) {
    const { authorization, signature } = parameters;
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$signature$2f$recoverAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["recoverAddress"])({
        hash: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$authorization$2f$hashAuthorization$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hashAuthorization"])(authorization),
        signature: signature ?? authorization
    });
} //# sourceMappingURL=recoverAuthorizationAddress.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/chain/assertCurrentChain.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "assertCurrentChain",
    ()=>assertCurrentChain
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$chain$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/chain.js [app-client] (ecmascript)");
;
function assertCurrentChain({ chain, currentChainId }) {
    if (!chain) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$chain$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ChainNotFoundError"]();
    if (currentChainId !== chain.id) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$chain$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ChainMismatchError"]({
        chain,
        currentChainId
    });
} //# sourceMappingURL=assertCurrentChain.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/public/getGasPrice.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Returns the current price of gas (in wei).
 *
 * - Docs: https://viem.sh/docs/actions/public/getGasPrice
 * - JSON-RPC Methods: [`eth_gasPrice`](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_gasprice)
 *
 * @param client - Client to use
 * @returns The gas price (in wei). {@link GetGasPriceReturnType}
 *
 * @example
 * import { createPublicClient, http } from 'viem'
 * import { mainnet } from 'viem/chains'
 * import { getGasPrice } from 'viem/public'
 *
 * const client = createPublicClient({
 *   chain: mainnet,
 *   transport: http(),
 * })
 * const gasPrice = await getGasPrice(client)
 */ __turbopack_context__.s([
    "getGasPrice",
    ()=>getGasPrice
]);
async function getGasPrice(client) {
    const gasPrice = await client.request({
        method: 'eth_gasPrice'
    });
    return BigInt(gasPrice);
} //# sourceMappingURL=getGasPrice.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/public/estimateMaxPriorityFeePerGas.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "estimateMaxPriorityFeePerGas",
    ()=>estimateMaxPriorityFeePerGas,
    "internal_estimateMaxPriorityFeePerGas",
    ()=>internal_estimateMaxPriorityFeePerGas
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$fee$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/fee.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/fromHex.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/getAction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getBlock$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/public/getBlock.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getGasPrice$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/public/getGasPrice.js [app-client] (ecmascript)");
;
;
;
;
;
async function estimateMaxPriorityFeePerGas(client, args) {
    return internal_estimateMaxPriorityFeePerGas(client, args);
}
async function internal_estimateMaxPriorityFeePerGas(client, args) {
    const { block: block_, chain = client.chain, request } = args || {};
    try {
        const maxPriorityFeePerGas = chain?.fees?.maxPriorityFeePerGas ?? chain?.fees?.defaultPriorityFee;
        if (typeof maxPriorityFeePerGas === 'function') {
            const block = block_ || await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getBlock$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getBlock"], 'getBlock')({});
            const maxPriorityFeePerGas_ = await maxPriorityFeePerGas({
                block,
                client,
                request
            });
            if (maxPriorityFeePerGas_ === null) throw new Error();
            return maxPriorityFeePerGas_;
        }
        if (typeof maxPriorityFeePerGas !== 'undefined') return maxPriorityFeePerGas;
        const maxPriorityFeePerGasHex = await client.request({
            method: 'eth_maxPriorityFeePerGas'
        });
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hexToBigInt"])(maxPriorityFeePerGasHex);
    } catch  {
        // If the RPC Provider does not support `eth_maxPriorityFeePerGas`
        // fall back to calculating it manually via `gasPrice - baseFeePerGas`.
        // See: https://github.com/ethereum/pm/issues/328#:~:text=eth_maxPriorityFeePerGas%20after%20London%20will%20effectively%20return%20eth_gasPrice%20%2D%20baseFee
        const [block, gasPrice] = await Promise.all([
            block_ ? Promise.resolve(block_) : (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getBlock$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getBlock"], 'getBlock')({}),
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getGasPrice$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getGasPrice"], 'getGasPrice')({})
        ]);
        if (typeof block.baseFeePerGas !== 'bigint') throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$fee$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Eip1559FeesNotSupportedError"]();
        const maxPriorityFeePerGas = gasPrice - block.baseFeePerGas;
        if (maxPriorityFeePerGas < 0n) return 0n;
        return maxPriorityFeePerGas;
    }
} //# sourceMappingURL=estimateMaxPriorityFeePerGas.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/public/estimateFeesPerGas.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "estimateFeesPerGas",
    ()=>estimateFeesPerGas,
    "internal_estimateFeesPerGas",
    ()=>internal_estimateFeesPerGas
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$fee$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/fee.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/getAction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$estimateMaxPriorityFeePerGas$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/public/estimateMaxPriorityFeePerGas.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getBlock$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/public/getBlock.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getGasPrice$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/public/getGasPrice.js [app-client] (ecmascript)");
;
;
;
;
;
async function estimateFeesPerGas(client, args) {
    return internal_estimateFeesPerGas(client, args);
}
async function internal_estimateFeesPerGas(client, args) {
    const { block: block_, chain = client.chain, request, type = 'eip1559' } = args || {};
    const baseFeeMultiplier = await (async ()=>{
        if (typeof chain?.fees?.baseFeeMultiplier === 'function') return chain.fees.baseFeeMultiplier({
            block: block_,
            client,
            request
        });
        return chain?.fees?.baseFeeMultiplier ?? 1.2;
    })();
    if (baseFeeMultiplier < 1) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$fee$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseFeeScalarError"]();
    const decimals = baseFeeMultiplier.toString().split('.')[1]?.length ?? 0;
    const denominator = 10 ** decimals;
    const multiply = (base)=>base * BigInt(Math.ceil(baseFeeMultiplier * denominator)) / BigInt(denominator);
    const block = block_ ? block_ : await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getBlock$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getBlock"], 'getBlock')({});
    if (typeof chain?.fees?.estimateFeesPerGas === 'function') {
        const fees = await chain.fees.estimateFeesPerGas({
            block: block_,
            client,
            multiply,
            request,
            type
        });
        if (fees !== null) return fees;
    }
    if (type === 'eip1559') {
        if (typeof block.baseFeePerGas !== 'bigint') throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$fee$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Eip1559FeesNotSupportedError"]();
        const maxPriorityFeePerGas = typeof request?.maxPriorityFeePerGas === 'bigint' ? request.maxPriorityFeePerGas : await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$estimateMaxPriorityFeePerGas$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["internal_estimateMaxPriorityFeePerGas"])(client, {
            block: block,
            chain,
            request
        });
        const baseFeePerGas = multiply(block.baseFeePerGas);
        const maxFeePerGas = request?.maxFeePerGas ?? baseFeePerGas + maxPriorityFeePerGas;
        return {
            maxFeePerGas,
            maxPriorityFeePerGas
        };
    }
    const gasPrice = request?.gasPrice ?? multiply(await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getGasPrice$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getGasPrice"], 'getGasPrice')({}));
    return {
        gasPrice
    };
} //# sourceMappingURL=estimateFeesPerGas.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/errors/estimateGas.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "EstimateGasExecutionError",
    ()=>EstimateGasExecutionError
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$unit$2f$formatEther$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/unit/formatEther.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$unit$2f$formatGwei$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/unit/formatGwei.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/base.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$transaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/transaction.js [app-client] (ecmascript)");
;
;
;
;
class EstimateGasExecutionError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor(cause, { account, docsPath, chain, data, gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas, nonce, to, value }){
        const prettyArgs = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$transaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["prettyPrint"])({
            from: account?.address,
            to,
            value: typeof value !== 'undefined' && `${(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$unit$2f$formatEther$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatEther"])(value)} ${chain?.nativeCurrency?.symbol || 'ETH'}`,
            data,
            gas,
            gasPrice: typeof gasPrice !== 'undefined' && `${(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$unit$2f$formatGwei$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatGwei"])(gasPrice)} gwei`,
            maxFeePerGas: typeof maxFeePerGas !== 'undefined' && `${(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$unit$2f$formatGwei$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatGwei"])(maxFeePerGas)} gwei`,
            maxPriorityFeePerGas: typeof maxPriorityFeePerGas !== 'undefined' && `${(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$unit$2f$formatGwei$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatGwei"])(maxPriorityFeePerGas)} gwei`,
            nonce
        });
        super(cause.shortMessage, {
            cause,
            docsPath,
            metaMessages: [
                ...cause.metaMessages ? [
                    ...cause.metaMessages,
                    ' '
                ] : [],
                'Estimate Gas Arguments:',
                prettyArgs
            ].filter(Boolean),
            name: 'EstimateGasExecutionError'
        });
        Object.defineProperty(this, "cause", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.cause = cause;
    }
} //# sourceMappingURL=estimateGas.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/errors/getEstimateGasError.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getEstimateGasError",
    ()=>getEstimateGasError
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$estimateGas$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/estimateGas.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/node.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$errors$2f$getNodeError$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/errors/getNodeError.js [app-client] (ecmascript)");
;
;
;
function getEstimateGasError(err, { docsPath, ...args }) {
    const cause = (()=>{
        const cause = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$errors$2f$getNodeError$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getNodeError"])(err, args);
        if (cause instanceof __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$node$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["UnknownNodeError"]) return err;
        return cause;
    })();
    return new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$estimateGas$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["EstimateGasExecutionError"](cause, {
        docsPath,
        ...args
    });
} //# sourceMappingURL=getEstimateGasError.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/errors/stateOverride.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AccountStateConflictError",
    ()=>AccountStateConflictError,
    "StateAssignmentConflictError",
    ()=>StateAssignmentConflictError,
    "prettyStateMapping",
    ()=>prettyStateMapping,
    "prettyStateOverride",
    ()=>prettyStateOverride
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/base.js [app-client] (ecmascript)");
;
class AccountStateConflictError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor({ address }){
        super(`State for account "${address}" is set multiple times.`, {
            name: 'AccountStateConflictError'
        });
    }
}
class StateAssignmentConflictError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor(){
        super('state and stateDiff are set on the same account.', {
            name: 'StateAssignmentConflictError'
        });
    }
}
function prettyStateMapping(stateMapping) {
    return stateMapping.reduce((pretty, { slot, value })=>{
        return `${pretty}        ${slot}: ${value}\n`;
    }, '');
}
function prettyStateOverride(stateOverride) {
    return stateOverride.reduce((pretty, { address, ...state })=>{
        let val = `${pretty}    ${address}:\n`;
        if (state.nonce) val += `      nonce: ${state.nonce}\n`;
        if (state.balance) val += `      balance: ${state.balance}\n`;
        if (state.code) val += `      code: ${state.code}\n`;
        if (state.state) {
            val += '      state:\n';
            val += prettyStateMapping(state.state);
        }
        if (state.stateDiff) {
            val += '      stateDiff:\n';
            val += prettyStateMapping(state.stateDiff);
        }
        return val;
    }, '  State Override:\n').slice(0, -1);
} //# sourceMappingURL=stateOverride.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/stateOverride.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "serializeAccountStateOverride",
    ()=>serializeAccountStateOverride,
    "serializeStateMapping",
    ()=>serializeStateMapping,
    "serializeStateOverride",
    ()=>serializeStateOverride
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$address$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/address.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$data$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/data.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$stateOverride$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/stateOverride.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$isAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/address/isAddress.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/toHex.js [app-client] (ecmascript)");
;
;
;
;
;
function serializeStateMapping(stateMapping) {
    if (!stateMapping || stateMapping.length === 0) return undefined;
    return stateMapping.reduce((acc, { slot, value })=>{
        if (slot.length !== 66) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$data$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["InvalidBytesLengthError"]({
            size: slot.length,
            targetSize: 66,
            type: 'hex'
        });
        if (value.length !== 66) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$data$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["InvalidBytesLengthError"]({
            size: value.length,
            targetSize: 66,
            type: 'hex'
        });
        acc[slot] = value;
        return acc;
    }, {});
}
function serializeAccountStateOverride(parameters) {
    const { balance, nonce, state, stateDiff, code } = parameters;
    const rpcAccountStateOverride = {};
    if (code !== undefined) rpcAccountStateOverride.code = code;
    if (balance !== undefined) rpcAccountStateOverride.balance = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(balance);
    if (nonce !== undefined) rpcAccountStateOverride.nonce = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(nonce);
    if (state !== undefined) rpcAccountStateOverride.state = serializeStateMapping(state);
    if (stateDiff !== undefined) {
        if (rpcAccountStateOverride.state) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$stateOverride$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["StateAssignmentConflictError"]();
        rpcAccountStateOverride.stateDiff = serializeStateMapping(stateDiff);
    }
    return rpcAccountStateOverride;
}
function serializeStateOverride(parameters) {
    if (!parameters) return undefined;
    const rpcStateOverride = {};
    for (const { address, ...accountState } of parameters){
        if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$isAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAddress"])(address, {
            strict: false
        })) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$address$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["InvalidAddressError"]({
            address
        });
        if (rpcStateOverride[address]) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$stateOverride$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AccountStateConflictError"]({
            address: address
        });
        rpcStateOverride[address] = serializeAccountStateOverride(accountState);
    }
    return rpcStateOverride;
} //# sourceMappingURL=stateOverride.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/public/estimateGas.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "estimateGas",
    ()=>estimateGas
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/accounts/utils/parseAccount.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/base.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$authorization$2f$recoverAuthorizationAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/authorization/recoverAuthorizationAddress.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/toHex.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$errors$2f$getEstimateGasError$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/errors/getEstimateGasError.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$extract$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/formatters/extract.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$transactionRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/formatters/transactionRequest.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$stateOverride$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/stateOverride.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$transaction$2f$assertRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/transaction/assertRequest.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$prepareTransactionRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/prepareTransactionRequest.js [app-client] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
async function estimateGas(client, args) {
    const { account: account_ = client.account, prepare = true } = args;
    const account = account_ ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["parseAccount"])(account_) : undefined;
    const parameters = (()=>{
        if (Array.isArray(prepare)) return prepare;
        // Some RPC Providers do not compute versioned hashes from blobs. We will need
        // to compute them.
        if (account?.type !== 'local') return [
            'blobVersionedHashes'
        ];
        return undefined;
    })();
    try {
        const to = await (async ()=>{
            // If `to` exists on the parameters, use that.
            if (args.to) return args.to;
            // If no `to` exists, and we are sending a EIP-7702 transaction, use the
            // address of the first authorization in the list.
            if (args.authorizationList && args.authorizationList.length > 0) return await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$authorization$2f$recoverAuthorizationAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["recoverAuthorizationAddress"])({
                authorization: args.authorizationList[0]
            }).catch(()=>{
                throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"]('`to` is required. Could not infer from `authorizationList`');
            });
            // Otherwise, we are sending a deployment transaction.
            return undefined;
        })();
        const { accessList, authorizationList, blobs, blobVersionedHashes, blockNumber, blockTag, data, gas, gasPrice, maxFeePerBlobGas, maxFeePerGas, maxPriorityFeePerGas, nonce, value, stateOverride, ...rest } = prepare ? await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$prepareTransactionRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["prepareTransactionRequest"])(client, {
            ...args,
            parameters,
            to
        }) : args;
        // If we get `gas` back from the prepared transaction request, which is
        // different from the `gas` we provided, it was likely filled by other means
        // during request preparation (e.g. `eth_fillTransaction` or `chain.transactionRequest.prepare`).
        // (e.g. `eth_fillTransaction` or `chain.transactionRequest.prepare`).
        if (gas && args.gas !== gas) return gas;
        const blockNumberHex = typeof blockNumber === 'bigint' ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(blockNumber) : undefined;
        const block = blockNumberHex || blockTag;
        const rpcStateOverride = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$stateOverride$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["serializeStateOverride"])(stateOverride);
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$transaction$2f$assertRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["assertRequest"])(args);
        const chainFormat = client.chain?.formatters?.transactionRequest?.format;
        const format = chainFormat || __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$transactionRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatTransactionRequest"];
        const request = format({
            // Pick out extra data that might exist on the chain's transaction request type.
            ...(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$extract$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["extract"])(rest, {
                format: chainFormat
            }),
            account,
            accessList,
            authorizationList,
            blobs,
            blobVersionedHashes,
            data,
            gasPrice,
            maxFeePerBlobGas,
            maxFeePerGas,
            maxPriorityFeePerGas,
            nonce,
            to,
            value
        }, 'estimateGas');
        return BigInt(await client.request({
            method: 'eth_estimateGas',
            params: rpcStateOverride ? [
                request,
                block ?? client.experimental_blockTag ?? 'latest',
                rpcStateOverride
            ] : block ? [
                request,
                block
            ] : [
                request
            ]
        }));
    } catch (err) {
        throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$errors$2f$getEstimateGasError$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getEstimateGasError"])(err, {
            ...args,
            account,
            chain: client.chain
        });
    }
} //# sourceMappingURL=estimateGas.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/public/getTransactionCount.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getTransactionCount",
    ()=>getTransactionCount
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/fromHex.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/toHex.js [app-client] (ecmascript)");
;
;
async function getTransactionCount(client, { address, blockTag = 'latest', blockNumber }) {
    const count = await client.request({
        method: 'eth_getTransactionCount',
        params: [
            address,
            typeof blockNumber === 'bigint' ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(blockNumber) : blockTag
        ]
    }, {
        dedupe: Boolean(blockNumber)
    });
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hexToNumber"])(count);
} //# sourceMappingURL=getTransactionCount.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/wallet/prepareTransactionRequest.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "defaultParameters",
    ()=>defaultParameters,
    "eip1559NetworkCache",
    ()=>eip1559NetworkCache,
    "prepareTransactionRequest",
    ()=>prepareTransactionRequest,
    "supportsFillTransaction",
    ()=>supportsFillTransaction
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/accounts/utils/parseAccount.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$estimateFeesPerGas$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/public/estimateFeesPerGas.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$estimateGas$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/public/estimateGas.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getBlock$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/public/getBlock.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getTransactionCount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/public/getTransactionCount.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$fee$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/fee.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$blob$2f$blobsToCommitments$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/blob/blobsToCommitments.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$blob$2f$blobsToProofs$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/blob/blobsToProofs.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$blob$2f$commitmentsToVersionedHashes$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/blob/commitmentsToVersionedHashes.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$blob$2f$toBlobSidecars$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/blob/toBlobSidecars.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/getAction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$lru$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/lru.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$transaction$2f$assertRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/transaction/assertRequest.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$transaction$2f$getTransactionType$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/transaction/getTransactionType.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$fillTransaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/public/fillTransaction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getChainId$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/public/getChainId.js [app-client] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
const defaultParameters = [
    'blobVersionedHashes',
    'chainId',
    'fees',
    'gas',
    'nonce',
    'type'
];
const eip1559NetworkCache = /*#__PURE__*/ new Map();
const supportsFillTransaction = /*#__PURE__*/ new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$lru$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["LruMap"](128);
async function prepareTransactionRequest(client, args) {
    let request = args;
    request.account ??= client.account;
    request.parameters ??= defaultParameters;
    const { account: account_, chain = client.chain, nonceManager, parameters } = request;
    const prepareTransactionRequest = (()=>{
        if (typeof chain?.prepareTransactionRequest === 'function') return {
            fn: chain.prepareTransactionRequest,
            runAt: [
                'beforeFillTransaction'
            ]
        };
        if (Array.isArray(chain?.prepareTransactionRequest)) return {
            fn: chain.prepareTransactionRequest[0],
            runAt: chain.prepareTransactionRequest[1].runAt
        };
        return undefined;
    })();
    let chainId;
    async function getChainId() {
        if (chainId) return chainId;
        if (typeof request.chainId !== 'undefined') return request.chainId;
        if (chain) return chain.id;
        const chainId_ = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getChainId$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getChainId"], 'getChainId')({});
        chainId = chainId_;
        return chainId;
    }
    const account = account_ ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["parseAccount"])(account_) : account_;
    let nonce = request.nonce;
    if (parameters.includes('nonce') && typeof nonce === 'undefined' && account && nonceManager) {
        const chainId = await getChainId();
        nonce = await nonceManager.consume({
            address: account.address,
            chainId,
            client
        });
    }
    if (prepareTransactionRequest?.fn && prepareTransactionRequest.runAt?.includes('beforeFillTransaction')) {
        request = await prepareTransactionRequest.fn({
            ...request,
            chain
        }, {
            phase: 'beforeFillTransaction'
        });
        nonce ??= request.nonce;
    }
    const attemptFill = (()=>{
        // Do not attempt if blobs are provided.
        if ((parameters.includes('blobVersionedHashes') || parameters.includes('sidecars')) && request.kzg && request.blobs) return false;
        // Do not attempt if `eth_fillTransaction` is not supported.
        if (supportsFillTransaction.get(client.uid) === false) return false;
        // Should attempt `eth_fillTransaction` if "fees" or "gas" are required to be populated,
        // otherwise, can just use the other individual calls.
        const shouldAttempt = [
            'fees',
            'gas'
        ].some((parameter)=>parameters.includes(parameter));
        if (!shouldAttempt) return false;
        // Check if `eth_fillTransaction` needs to be called.
        if (parameters.includes('chainId') && typeof request.chainId !== 'number') return true;
        if (parameters.includes('nonce') && typeof nonce !== 'number') return true;
        if (parameters.includes('fees') && typeof request.gasPrice !== 'bigint' && (typeof request.maxFeePerGas !== 'bigint' || typeof request.maxPriorityFeePerGas !== 'bigint')) return true;
        if (parameters.includes('gas') && typeof request.gas !== 'bigint') return true;
        return false;
    })();
    const fillResult = attemptFill ? await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$fillTransaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["fillTransaction"], 'fillTransaction')({
        ...request,
        nonce
    }).then((result)=>{
        const { chainId, from, gas, gasPrice, nonce, maxFeePerBlobGas, maxFeePerGas, maxPriorityFeePerGas, type, ...rest } = result.transaction;
        supportsFillTransaction.set(client.uid, true);
        return {
            ...request,
            ...from ? {
                from
            } : {},
            ...type && !request.type ? {
                type
            } : {},
            ...typeof chainId !== 'undefined' ? {
                chainId
            } : {},
            ...typeof gas !== 'undefined' ? {
                gas
            } : {},
            ...typeof gasPrice !== 'undefined' ? {
                gasPrice
            } : {},
            ...typeof nonce !== 'undefined' ? {
                nonce
            } : {},
            ...typeof maxFeePerBlobGas !== 'undefined' && request.type !== 'legacy' && request.type !== 'eip2930' ? {
                maxFeePerBlobGas
            } : {},
            ...typeof maxFeePerGas !== 'undefined' && request.type !== 'legacy' && request.type !== 'eip2930' ? {
                maxFeePerGas
            } : {},
            ...typeof maxPriorityFeePerGas !== 'undefined' && request.type !== 'legacy' && request.type !== 'eip2930' ? {
                maxPriorityFeePerGas
            } : {},
            ...'nonceKey' in rest && typeof rest.nonceKey !== 'undefined' ? {
                nonceKey: rest.nonceKey
            } : {}
        };
    }).catch((e)=>{
        const error = e;
        if (error.name !== 'TransactionExecutionError') return request;
        const unsupported = error.walk?.((e)=>{
            const error = e;
            return error.name === 'MethodNotFoundRpcError' || error.name === 'MethodNotSupportedRpcError' || error.message?.includes('eth_fillTransaction is not available');
        });
        if (unsupported) supportsFillTransaction.set(client.uid, false);
        return request;
    }) : request;
    nonce ??= fillResult.nonce;
    request = {
        ...fillResult,
        ...account ? {
            from: account?.address
        } : {},
        ...nonce ? {
            nonce
        } : {}
    };
    const { blobs, gas, kzg, type } = request;
    if (prepareTransactionRequest?.fn && prepareTransactionRequest.runAt?.includes('beforeFillParameters')) {
        request = await prepareTransactionRequest.fn({
            ...request,
            chain
        }, {
            phase: 'beforeFillParameters'
        });
    }
    let block;
    async function getBlock() {
        if (block) return block;
        block = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getBlock$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getBlock"], 'getBlock')({
            blockTag: 'latest'
        });
        return block;
    }
    if (parameters.includes('nonce') && typeof nonce === 'undefined' && account && !nonceManager) request.nonce = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getTransactionCount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getTransactionCount"], 'getTransactionCount')({
        address: account.address,
        blockTag: 'pending'
    });
    if ((parameters.includes('blobVersionedHashes') || parameters.includes('sidecars')) && blobs && kzg) {
        const commitments = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$blob$2f$blobsToCommitments$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["blobsToCommitments"])({
            blobs,
            kzg
        });
        if (parameters.includes('blobVersionedHashes')) {
            const versionedHashes = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$blob$2f$commitmentsToVersionedHashes$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["commitmentsToVersionedHashes"])({
                commitments,
                to: 'hex'
            });
            request.blobVersionedHashes = versionedHashes;
        }
        if (parameters.includes('sidecars')) {
            const proofs = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$blob$2f$blobsToProofs$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["blobsToProofs"])({
                blobs,
                commitments,
                kzg
            });
            const sidecars = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$blob$2f$toBlobSidecars$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["toBlobSidecars"])({
                blobs,
                commitments,
                proofs,
                to: 'hex'
            });
            request.sidecars = sidecars;
        }
    }
    if (parameters.includes('chainId')) request.chainId = await getChainId();
    if ((parameters.includes('fees') || parameters.includes('type')) && typeof type === 'undefined') {
        try {
            request.type = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$transaction$2f$getTransactionType$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getTransactionType"])(request);
        } catch  {
            let isEip1559Network = eip1559NetworkCache.get(client.uid);
            if (typeof isEip1559Network === 'undefined') {
                const block = await getBlock();
                isEip1559Network = typeof block?.baseFeePerGas === 'bigint';
                eip1559NetworkCache.set(client.uid, isEip1559Network);
            }
            request.type = isEip1559Network ? 'eip1559' : 'legacy';
        }
    }
    if (parameters.includes('fees')) {
        // TODO(4844): derive blob base fees once https://github.com/ethereum/execution-apis/pull/486 is merged.
        if (request.type !== 'legacy' && request.type !== 'eip2930') {
            // EIP-1559 fees
            if (typeof request.maxFeePerGas === 'undefined' || typeof request.maxPriorityFeePerGas === 'undefined') {
                const block = await getBlock();
                const { maxFeePerGas, maxPriorityFeePerGas } = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$estimateFeesPerGas$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["internal_estimateFeesPerGas"])(client, {
                    block: block,
                    chain,
                    request: request
                });
                if (typeof request.maxPriorityFeePerGas === 'undefined' && request.maxFeePerGas && request.maxFeePerGas < maxPriorityFeePerGas) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$fee$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["MaxFeePerGasTooLowError"]({
                    maxPriorityFeePerGas
                });
                request.maxPriorityFeePerGas = maxPriorityFeePerGas;
                request.maxFeePerGas = maxFeePerGas;
            }
        } else {
            // Legacy fees
            if (typeof request.maxFeePerGas !== 'undefined' || typeof request.maxPriorityFeePerGas !== 'undefined') throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$fee$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Eip1559FeesNotSupportedError"]();
            if (typeof request.gasPrice === 'undefined') {
                const block = await getBlock();
                const { gasPrice: gasPrice_ } = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$estimateFeesPerGas$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["internal_estimateFeesPerGas"])(client, {
                    block: block,
                    chain,
                    request: request,
                    type: 'legacy'
                });
                request.gasPrice = gasPrice_;
            }
        }
    }
    if (parameters.includes('gas') && typeof gas === 'undefined') request.gas = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$estimateGas$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["estimateGas"], 'estimateGas')({
        ...request,
        account,
        prepare: account?.type === 'local' ? [] : [
            'blobVersionedHashes'
        ]
    });
    if (prepareTransactionRequest?.fn && prepareTransactionRequest.runAt?.includes('afterFillParameters')) request = await prepareTransactionRequest.fn({
        ...request,
        chain
    }, {
        phase: 'afterFillParameters'
    });
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$transaction$2f$assertRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["assertRequest"])(request);
    delete request.parameters;
    return request;
} //# sourceMappingURL=prepareTransactionRequest.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/wallet/sendRawTransaction.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Sends a **signed** transaction to the network
 *
 * - Docs: https://viem.sh/docs/actions/wallet/sendRawTransaction
 * - JSON-RPC Method: [`eth_sendRawTransaction`](https://ethereum.github.io/execution-apis/api-documentation/)
 *
 * @param client - Client to use
 * @param parameters - {@link SendRawTransactionParameters}
 * @returns The transaction hash. {@link SendRawTransactionReturnType}
 *
 * @example
 * import { createWalletClient, custom } from 'viem'
 * import { mainnet } from 'viem/chains'
 * import { sendRawTransaction } from 'viem/wallet'
 *
 * const client = createWalletClient({
 *   chain: mainnet,
 *   transport: custom(window.ethereum),
 * })
 *
 * const hash = await sendRawTransaction(client, {
 *   serializedTransaction: '0x02f850018203118080825208808080c080a04012522854168b27e5dc3d5839bab5e6b39e1a0ffd343901ce1622e3d64b48f1a04e00902ae0502c4728cbf12156290df99c3ed7de85b1dbfe20b5c36931733a33'
 * })
 */ __turbopack_context__.s([
    "sendRawTransaction",
    ()=>sendRawTransaction
]);
async function sendRawTransaction(client, { serializedTransaction }) {
    return client.request({
        method: 'eth_sendRawTransaction',
        params: [
            serializedTransaction
        ]
    }, {
        retryCount: 0
    });
} //# sourceMappingURL=sendRawTransaction.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/wallet/sendTransaction.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "sendTransaction",
    ()=>sendTransaction
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/accounts/utils/parseAccount.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$account$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/account.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/base.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$authorization$2f$recoverAuthorizationAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/authorization/recoverAuthorizationAddress.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$chain$2f$assertCurrentChain$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/chain/assertCurrentChain.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$concat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/data/concat.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$errors$2f$getTransactionError$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/errors/getTransactionError.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$extract$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/formatters/extract.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$transactionRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/formatters/transactionRequest.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/getAction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$lru$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/lru.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$transaction$2f$assertRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/transaction/assertRequest.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getChainId$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/public/getChainId.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$prepareTransactionRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/prepareTransactionRequest.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendRawTransaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/sendRawTransaction.js [app-client] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
const supportsWalletNamespace = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$lru$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["LruMap"](128);
async function sendTransaction(client, parameters) {
    const { account: account_ = client.account, assertChainId = true, chain = client.chain, accessList, authorizationList, blobs, data, dataSuffix = typeof client.dataSuffix === 'string' ? client.dataSuffix : client.dataSuffix?.value, gas, gasPrice, maxFeePerBlobGas, maxFeePerGas, maxPriorityFeePerGas, nonce, type, value, ...rest } = parameters;
    if (typeof account_ === 'undefined') throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$account$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AccountNotFoundError"]({
        docsPath: '/docs/actions/wallet/sendTransaction'
    });
    const account = account_ ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["parseAccount"])(account_) : null;
    try {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$transaction$2f$assertRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["assertRequest"])(parameters);
        const to = await (async ()=>{
            // If `to` exists on the parameters, use that.
            if (parameters.to) return parameters.to;
            // If `to` is null, we are sending a deployment transaction.
            if (parameters.to === null) return undefined;
            // If no `to` exists, and we are sending a EIP-7702 transaction, use the
            // address of the first authorization in the list.
            if (authorizationList && authorizationList.length > 0) return await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$authorization$2f$recoverAuthorizationAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["recoverAuthorizationAddress"])({
                authorization: authorizationList[0]
            }).catch(()=>{
                throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"]('`to` is required. Could not infer from `authorizationList`.');
            });
            // Otherwise, we are sending a deployment transaction.
            return undefined;
        })();
        if (account?.type === 'json-rpc' || account === null) {
            let chainId;
            if (chain !== null) {
                chainId = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getChainId$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getChainId"], 'getChainId')({});
                if (assertChainId) (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$chain$2f$assertCurrentChain$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["assertCurrentChain"])({
                    currentChainId: chainId,
                    chain
                });
            }
            const chainFormat = client.chain?.formatters?.transactionRequest?.format;
            const format = chainFormat || __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$transactionRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatTransactionRequest"];
            const request = format({
                // Pick out extra data that might exist on the chain's transaction request type.
                ...(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$extract$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["extract"])(rest, {
                    format: chainFormat
                }),
                accessList,
                account,
                authorizationList,
                blobs,
                chainId,
                data: dataSuffix ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$concat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["concat"])([
                    data ?? '0x',
                    dataSuffix
                ]) : data,
                gas,
                gasPrice,
                maxFeePerBlobGas,
                maxFeePerGas,
                maxPriorityFeePerGas,
                nonce,
                to,
                type,
                value
            }, 'sendTransaction');
            const isWalletNamespaceSupported = supportsWalletNamespace.get(client.uid);
            const method = isWalletNamespaceSupported ? 'wallet_sendTransaction' : 'eth_sendTransaction';
            try {
                return await client.request({
                    method,
                    params: [
                        request
                    ]
                }, {
                    retryCount: 0
                });
            } catch (e) {
                if (isWalletNamespaceSupported === false) throw e;
                const error = e;
                // If the transport does not support the method or input, attempt to use the
                // `wallet_sendTransaction` method.
                if (error.name === 'InvalidInputRpcError' || error.name === 'InvalidParamsRpcError' || error.name === 'MethodNotFoundRpcError' || error.name === 'MethodNotSupportedRpcError') {
                    return await client.request({
                        method: 'wallet_sendTransaction',
                        params: [
                            request
                        ]
                    }, {
                        retryCount: 0
                    }).then((hash)=>{
                        supportsWalletNamespace.set(client.uid, true);
                        return hash;
                    }).catch((e)=>{
                        const walletNamespaceError = e;
                        if (walletNamespaceError.name === 'MethodNotFoundRpcError' || walletNamespaceError.name === 'MethodNotSupportedRpcError') {
                            supportsWalletNamespace.set(client.uid, false);
                            throw error;
                        }
                        throw walletNamespaceError;
                    });
                }
                throw error;
            }
        }
        if (account?.type === 'local') {
            // Prepare the request for signing (assign appropriate fees, etc.)
            const request = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$prepareTransactionRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["prepareTransactionRequest"], 'prepareTransactionRequest')({
                account,
                accessList,
                authorizationList,
                blobs,
                chain,
                data: dataSuffix ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$concat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["concat"])([
                    data ?? '0x',
                    dataSuffix
                ]) : data,
                gas,
                gasPrice,
                maxFeePerBlobGas,
                maxFeePerGas,
                maxPriorityFeePerGas,
                nonce,
                nonceManager: account.nonceManager,
                parameters: [
                    ...__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$prepareTransactionRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["defaultParameters"],
                    'sidecars'
                ],
                type,
                value,
                ...rest,
                to
            });
            const serializer = chain?.serializers?.transaction;
            const serializedTransaction = await account.signTransaction(request, {
                serializer
            });
            return await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendRawTransaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["sendRawTransaction"], 'sendRawTransaction')({
                serializedTransaction
            });
        }
        if (account?.type === 'smart') throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$account$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AccountTypeNotSupportedError"]({
            metaMessages: [
                'Consider using the `sendUserOperation` Action instead.'
            ],
            docsPath: '/docs/actions/bundler/sendUserOperation',
            type: 'smart'
        });
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$account$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AccountTypeNotSupportedError"]({
            docsPath: '/docs/actions/wallet/sendTransaction',
            type: account?.type
        });
    } catch (err) {
        if (err instanceof __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$account$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AccountTypeNotSupportedError"]) throw err;
        throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$errors$2f$getTransactionError$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getTransactionError"])(err, {
            ...parameters,
            account,
            chain: parameters.chain || undefined
        });
    }
} //# sourceMappingURL=sendTransaction.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/wallet/deployContract.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "deployContract",
    ()=>deployContract
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$encodeDeployData$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/abi/encodeDeployData.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendTransaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/sendTransaction.js [app-client] (ecmascript)");
;
;
function deployContract(walletClient, parameters) {
    const { abi, args, bytecode, ...request } = parameters;
    const calldata = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$encodeDeployData$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["encodeDeployData"])({
        abi,
        args,
        bytecode
    });
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendTransaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["sendTransaction"])(walletClient, {
        ...request,
        ...request.authorizationList ? {
            to: null
        } : {},
        data: calldata
    });
} //# sourceMappingURL=deployContract.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/wallet/getAddresses.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getAddresses",
    ()=>getAddresses
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$getAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/address/getAddress.js [app-client] (ecmascript)");
;
async function getAddresses(client) {
    if (client.account?.type === 'local') return [
        client.account.address
    ];
    const addresses = await client.request({
        method: 'eth_accounts'
    }, {
        dedupe: true
    });
    return addresses.map((address)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$getAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["checksumAddress"])(address));
} //# sourceMappingURL=getAddresses.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/hash/hashSignature.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "hashSignature",
    ()=>hashSignature
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toBytes$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/toBytes.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$keccak256$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/hash/keccak256.js [app-client] (ecmascript)");
;
;
const hash = (value)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$keccak256$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["keccak256"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toBytes$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["toBytes"])(value));
function hashSignature(sig) {
    return hash(sig);
} //# sourceMappingURL=hashSignature.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/hash/normalizeSignature.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "normalizeSignature",
    ()=>normalizeSignature
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/base.js [app-client] (ecmascript)");
;
function normalizeSignature(signature) {
    let active = true;
    let current = '';
    let level = 0;
    let result = '';
    let valid = false;
    for(let i = 0; i < signature.length; i++){
        const char = signature[i];
        // If the character is a separator, we want to reactivate.
        if ([
            '(',
            ')',
            ','
        ].includes(char)) active = true;
        // If the character is a "level" token, we want to increment/decrement.
        if (char === '(') level++;
        if (char === ')') level--;
        // If we aren't active, we don't want to mutate the result.
        if (!active) continue;
        // If level === 0, we are at the definition level.
        if (level === 0) {
            if (char === ' ' && [
                'event',
                'function',
                ''
            ].includes(result)) result = '';
            else {
                result += char;
                // If we are at the end of the definition, we must be finished.
                if (char === ')') {
                    valid = true;
                    break;
                }
            }
            continue;
        }
        // Ignore spaces
        if (char === ' ') {
            // If the previous character is a separator, and the current section isn't empty, we want to deactivate.
            if (signature[i - 1] !== ',' && current !== ',' && current !== ',(') {
                current = '';
                active = false;
            }
            continue;
        }
        result += char;
        current += char;
    }
    if (!valid) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"]('Unable to normalize signature.');
    return result;
} //# sourceMappingURL=normalizeSignature.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/hash/toSignature.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "toSignature",
    ()=>toSignature
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$abitype$2f$dist$2f$esm$2f$human$2d$readable$2f$formatAbiItem$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/abitype/dist/esm/human-readable/formatAbiItem.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$normalizeSignature$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/hash/normalizeSignature.js [app-client] (ecmascript)");
;
;
const toSignature = (def)=>{
    const def_ = (()=>{
        if (typeof def === 'string') return def;
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$abitype$2f$dist$2f$esm$2f$human$2d$readable$2f$formatAbiItem$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatAbiItem"])(def);
    })();
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$normalizeSignature$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["normalizeSignature"])(def_);
}; //# sourceMappingURL=toSignature.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/hash/toSignatureHash.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "toSignatureHash",
    ()=>toSignatureHash
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$hashSignature$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/hash/hashSignature.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$toSignature$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/hash/toSignature.js [app-client] (ecmascript)");
;
;
function toSignatureHash(fn) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$hashSignature$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hashSignature"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$toSignature$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["toSignature"])(fn));
} //# sourceMappingURL=toSignatureHash.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/hash/toFunctionSelector.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "toFunctionSelector",
    ()=>toFunctionSelector
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$slice$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/data/slice.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$toSignatureHash$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/hash/toSignatureHash.js [app-client] (ecmascript)");
;
;
const toFunctionSelector = (fn)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$slice$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["slice"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$toSignatureHash$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["toSignatureHash"])(fn), 0, 4); //# sourceMappingURL=toFunctionSelector.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/hash/toEventSelector.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "toEventSelector",
    ()=>toEventSelector
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$toSignatureHash$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/hash/toSignatureHash.js [app-client] (ecmascript)");
;
const toEventSelector = __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$toSignatureHash$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["toSignatureHash"]; //# sourceMappingURL=toEventSelector.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/abi/getAbiItem.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getAbiItem",
    ()=>getAbiItem,
    "getAmbiguousTypes",
    ()=>getAmbiguousTypes,
    "isArgOfType",
    ()=>isArgOfType
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/abi.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$isHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/data/isHex.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$isAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/address/isAddress.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$toEventSelector$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/hash/toEventSelector.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$toFunctionSelector$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/hash/toFunctionSelector.js [app-client] (ecmascript)");
;
;
;
;
;
function getAbiItem(parameters) {
    const { abi, args = [], name } = parameters;
    const isSelector = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$isHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isHex"])(name, {
        strict: false
    });
    const abiItems = abi.filter((abiItem)=>{
        if (isSelector) {
            if (abiItem.type === 'function') return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$toFunctionSelector$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["toFunctionSelector"])(abiItem) === name;
            if (abiItem.type === 'event') return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$toEventSelector$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["toEventSelector"])(abiItem) === name;
            return false;
        }
        return 'name' in abiItem && abiItem.name === name;
    });
    if (abiItems.length === 0) return undefined;
    if (abiItems.length === 1) return abiItems[0];
    let matchedAbiItem;
    for (const abiItem of abiItems){
        if (!('inputs' in abiItem)) continue;
        if (!args || args.length === 0) {
            if (!abiItem.inputs || abiItem.inputs.length === 0) return abiItem;
            continue;
        }
        if (!abiItem.inputs) continue;
        if (abiItem.inputs.length === 0) continue;
        if (abiItem.inputs.length !== args.length) continue;
        const matched = args.every((arg, index)=>{
            const abiParameter = 'inputs' in abiItem && abiItem.inputs[index];
            if (!abiParameter) return false;
            return isArgOfType(arg, abiParameter);
        });
        if (matched) {
            // Check for ambiguity against already matched parameters (e.g. `address` vs `bytes20`).
            if (matchedAbiItem && 'inputs' in matchedAbiItem && matchedAbiItem.inputs) {
                const ambiguousTypes = getAmbiguousTypes(abiItem.inputs, matchedAbiItem.inputs, args);
                if (ambiguousTypes) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AbiItemAmbiguityError"]({
                    abiItem,
                    type: ambiguousTypes[0]
                }, {
                    abiItem: matchedAbiItem,
                    type: ambiguousTypes[1]
                });
            }
            matchedAbiItem = abiItem;
        }
    }
    if (matchedAbiItem) return matchedAbiItem;
    return abiItems[0];
}
function isArgOfType(arg, abiParameter) {
    const argType = typeof arg;
    const abiParameterType = abiParameter.type;
    switch(abiParameterType){
        case 'address':
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$isAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAddress"])(arg, {
                strict: false
            });
        case 'bool':
            return argType === 'boolean';
        case 'function':
            return argType === 'string';
        case 'string':
            return argType === 'string';
        default:
            {
                if (abiParameterType === 'tuple' && 'components' in abiParameter) return Object.values(abiParameter.components).every((component, index)=>{
                    return argType === 'object' && isArgOfType(Object.values(arg)[index], component);
                });
                // `(u)int<M>`: (un)signed integer type of `M` bits, `0 < M <= 256`, `M % 8 == 0`
                // https://regexr.com/6v8hp
                if (/^u?int(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?$/.test(abiParameterType)) return argType === 'number' || argType === 'bigint';
                // `bytes<M>`: binary type of `M` bytes, `0 < M <= 32`
                // https://regexr.com/6va55
                if (/^bytes([1-9]|1[0-9]|2[0-9]|3[0-2])?$/.test(abiParameterType)) return argType === 'string' || arg instanceof Uint8Array;
                // fixed-length (`<type>[M]`) and dynamic (`<type>[]`) arrays
                // https://regexr.com/6va6i
                if (/[a-z]+[1-9]{0,3}(\[[0-9]{0,}\])+$/.test(abiParameterType)) {
                    return Array.isArray(arg) && arg.every((x)=>isArgOfType(x, {
                            ...abiParameter,
                            // Pop off `[]` or `[M]` from end of type
                            type: abiParameterType.replace(/(\[[0-9]{0,}\])$/, '')
                        }));
                }
                return false;
            }
    }
}
function getAmbiguousTypes(sourceParameters, targetParameters, args) {
    for(const parameterIndex in sourceParameters){
        const sourceParameter = sourceParameters[parameterIndex];
        const targetParameter = targetParameters[parameterIndex];
        if (sourceParameter.type === 'tuple' && targetParameter.type === 'tuple' && 'components' in sourceParameter && 'components' in targetParameter) return getAmbiguousTypes(sourceParameter.components, targetParameter.components, args[parameterIndex]);
        const types = [
            sourceParameter.type,
            targetParameter.type
        ];
        const ambiguous = (()=>{
            if (types.includes('address') && types.includes('bytes20')) return true;
            if (types.includes('address') && types.includes('string')) return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$isAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAddress"])(args[parameterIndex], {
                strict: false
            });
            if (types.includes('address') && types.includes('bytes')) return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$isAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAddress"])(args[parameterIndex], {
                strict: false
            });
            return false;
        })();
        if (ambiguous) return types;
    }
    return;
} //# sourceMappingURL=getAbiItem.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/abi/prepareEncodeFunctionData.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "prepareEncodeFunctionData",
    ()=>prepareEncodeFunctionData
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/abi.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$toFunctionSelector$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/hash/toFunctionSelector.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$formatAbiItem$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/abi/formatAbiItem.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$getAbiItem$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/abi/getAbiItem.js [app-client] (ecmascript)");
;
;
;
;
const docsPath = '/docs/contract/encodeFunctionData';
function prepareEncodeFunctionData(parameters) {
    const { abi, args, functionName } = parameters;
    let abiItem = abi[0];
    if (functionName) {
        const item = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$getAbiItem$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAbiItem"])({
            abi,
            args,
            name: functionName
        });
        if (!item) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AbiFunctionNotFoundError"](functionName, {
            docsPath
        });
        abiItem = item;
    }
    if (abiItem.type !== 'function') throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AbiFunctionNotFoundError"](undefined, {
        docsPath
    });
    return {
        abi: [
            abiItem
        ],
        functionName: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$toFunctionSelector$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["toFunctionSelector"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$formatAbiItem$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatAbiItem"])(abiItem))
    };
} //# sourceMappingURL=prepareEncodeFunctionData.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/abi/encodeFunctionData.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "encodeFunctionData",
    ()=>encodeFunctionData
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$concat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/data/concat.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$encodeAbiParameters$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/abi/encodeAbiParameters.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$prepareEncodeFunctionData$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/abi/prepareEncodeFunctionData.js [app-client] (ecmascript)");
;
;
;
function encodeFunctionData(parameters) {
    const { args } = parameters;
    const { abi, functionName } = (()=>{
        if (parameters.abi.length === 1 && parameters.functionName?.startsWith('0x')) return parameters;
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$prepareEncodeFunctionData$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["prepareEncodeFunctionData"])(parameters);
    })();
    const abiItem = abi[0];
    const signature = functionName;
    const data = 'inputs' in abiItem && abiItem.inputs ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$encodeAbiParameters$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["encodeAbiParameters"])(abiItem.inputs, args ?? []) : undefined;
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$concat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["concatHex"])([
        signature,
        data ?? '0x'
    ]);
} //# sourceMappingURL=encodeFunctionData.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/wallet/sendCalls.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "fallbackMagicIdentifier",
    ()=>fallbackMagicIdentifier,
    "fallbackTransactionErrorMagicIdentifier",
    ()=>fallbackTransactionErrorMagicIdentifier,
    "sendCalls",
    ()=>sendCalls
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/accounts/utils/parseAccount.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/base.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$rpc$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/rpc.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$encodeFunctionData$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/abi/encodeFunctionData.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$concat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/data/concat.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/fromHex.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/toHex.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$errors$2f$getTransactionError$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/errors/getTransactionError.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendTransaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/sendTransaction.js [app-client] (ecmascript)");
;
;
;
;
;
;
;
;
;
const fallbackMagicIdentifier = '0x5792579257925792579257925792579257925792579257925792579257925792';
const fallbackTransactionErrorMagicIdentifier = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(0, {
    size: 32
});
async function sendCalls(client, parameters) {
    const { account: account_ = client.account, chain = client.chain, experimental_fallback, experimental_fallbackDelay = 32, forceAtomic = false, id, version = '2.0.0' } = parameters;
    const account = account_ ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["parseAccount"])(account_) : null;
    let capabilities = parameters.capabilities;
    if (client.dataSuffix && !parameters.capabilities?.dataSuffix) {
        if (typeof client.dataSuffix === 'string') capabilities = {
            ...parameters.capabilities,
            dataSuffix: {
                value: client.dataSuffix,
                optional: true
            }
        };
        else capabilities = {
            ...parameters.capabilities,
            dataSuffix: {
                value: client.dataSuffix.value,
                ...client.dataSuffix.required ? {} : {
                    optional: true
                }
            }
        };
    }
    const calls = parameters.calls.map((call_)=>{
        const call = call_;
        const data = call.abi ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$encodeFunctionData$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["encodeFunctionData"])({
            abi: call.abi,
            functionName: call.functionName,
            args: call.args
        }) : call.data;
        return {
            data: call.dataSuffix && data ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$concat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["concat"])([
                data,
                call.dataSuffix
            ]) : data,
            to: call.to,
            value: call.value ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(call.value) : undefined
        };
    });
    try {
        const response = await client.request({
            method: 'wallet_sendCalls',
            params: [
                {
                    atomicRequired: forceAtomic,
                    calls,
                    capabilities,
                    chainId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(chain.id),
                    from: account?.address,
                    id,
                    version
                }
            ]
        }, {
            retryCount: 0
        });
        if (typeof response === 'string') return {
            id: response
        };
        return response;
    } catch (err) {
        const error = err;
        // If the transport does not support EIP-5792, fall back to
        // `eth_sendTransaction`.
        if (experimental_fallback && (error.name === 'MethodNotFoundRpcError' || error.name === 'MethodNotSupportedRpcError' || error.name === 'UnknownRpcError' || error.details.toLowerCase().includes('does not exist / is not available') || error.details.toLowerCase().includes('missing or invalid. request()') || error.details.toLowerCase().includes('did not match any variant of untagged enum') || error.details.toLowerCase().includes('account upgraded to unsupported contract') || error.details.toLowerCase().includes('eip-7702 not supported') || error.details.toLowerCase().includes('unsupported wc_ method') || // magic.link
        error.details.toLowerCase().includes('feature toggled misconfigured') || // Trust Wallet
        error.details.toLowerCase().includes('jsonrpcengine: response has no error or result for request'))) {
            if (capabilities) {
                const hasNonOptionalCapability = Object.values(capabilities).some((capability)=>!capability.optional);
                if (hasNonOptionalCapability) {
                    const message = 'non-optional `capabilities` are not supported on fallback to `eth_sendTransaction`.';
                    throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$rpc$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["UnsupportedNonOptionalCapabilityError"](new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"](message, {
                        details: message
                    }));
                }
            }
            if (forceAtomic && calls.length > 1) {
                const message = '`forceAtomic` is not supported on fallback to `eth_sendTransaction`.';
                throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$rpc$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AtomicityNotSupportedError"](new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"](message, {
                    details: message
                }));
            }
            const promises = [];
            for (const call of calls){
                const promise = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendTransaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["sendTransaction"])(client, {
                    account,
                    chain,
                    data: call.data,
                    to: call.to,
                    value: call.value ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hexToBigInt"])(call.value) : undefined
                });
                promises.push(promise);
                // Note: some browser wallets require a small delay between transactions
                // to prevent duplicate JSON-RPC requests.
                if (experimental_fallbackDelay > 0) await new Promise((resolve)=>setTimeout(resolve, experimental_fallbackDelay));
            }
            const results = await Promise.allSettled(promises);
            if (results.every((r)=>r.status === 'rejected')) throw results[0].reason;
            const hashes = results.map((result)=>{
                if (result.status === 'fulfilled') return result.value;
                return fallbackTransactionErrorMagicIdentifier;
            });
            return {
                id: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$concat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["concat"])([
                    ...hashes,
                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(chain.id, {
                        size: 32
                    }),
                    fallbackMagicIdentifier
                ])
            };
        }
        throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$errors$2f$getTransactionError$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getTransactionError"])(err, {
            ...parameters,
            account,
            chain: parameters.chain
        });
    }
} //# sourceMappingURL=sendCalls.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/wallet/getCallsStatus.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getCallsStatus",
    ()=>getCallsStatus
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$slice$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/data/slice.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$trim$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/data/trim.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/fromHex.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$transactionReceipt$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/formatters/transactionReceipt.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendCalls$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/sendCalls.js [app-client] (ecmascript)");
;
;
;
;
;
async function getCallsStatus(client, parameters) {
    async function getStatus(id) {
        const isTransactions = id.endsWith(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendCalls$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["fallbackMagicIdentifier"].slice(2));
        if (isTransactions) {
            const chainId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$trim$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["trim"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$slice$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["sliceHex"])(id, -64, -32));
            const hashes = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$slice$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["sliceHex"])(id, 0, -64).slice(2).match(/.{1,64}/g);
            const receipts = await Promise.all(hashes.map((hash)=>__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendCalls$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["fallbackTransactionErrorMagicIdentifier"].slice(2) !== hash ? client.request({
                    method: 'eth_getTransactionReceipt',
                    params: [
                        `0x${hash}`
                    ]
                }, {
                    dedupe: true
                }) : undefined));
            const status = (()=>{
                if (receipts.some((r)=>r === null)) return 100; // pending
                if (receipts.every((r)=>r?.status === '0x1')) return 200; // success
                if (receipts.every((r)=>r?.status === '0x0')) return 500; // complete failure
                return 600; // partial failure
            })();
            return {
                atomic: false,
                chainId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hexToNumber"])(chainId),
                receipts: receipts.filter(Boolean),
                status,
                version: '2.0.0'
            };
        }
        return client.request({
            method: 'wallet_getCallsStatus',
            params: [
                id
            ]
        });
    }
    const { atomic = false, chainId, receipts, version = '2.0.0', ...response } = await getStatus(parameters.id);
    const [status, statusCode] = (()=>{
        const statusCode = response.status;
        if (statusCode >= 100 && statusCode < 200) return [
            'pending',
            statusCode
        ];
        if (statusCode >= 200 && statusCode < 300) return [
            'success',
            statusCode
        ];
        if (statusCode >= 300 && statusCode < 700) return [
            'failure',
            statusCode
        ];
        // @ts-expect-error: for backwards compatibility
        if (statusCode === 'CONFIRMED') return [
            'success',
            200
        ];
        // @ts-expect-error: for backwards compatibility
        if (statusCode === 'PENDING') return [
            'pending',
            100
        ];
        return [
            undefined,
            statusCode
        ];
    })();
    return {
        ...response,
        atomic,
        // @ts-expect-error: for backwards compatibility
        chainId: chainId ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hexToNumber"])(chainId) : undefined,
        receipts: receipts?.map((receipt)=>({
                ...receipt,
                blockNumber: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hexToBigInt"])(receipt.blockNumber),
                gasUsed: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hexToBigInt"])(receipt.gasUsed),
                status: __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$transactionReceipt$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["receiptStatuses"][receipt.status]
            })) ?? [],
        statusCode,
        status,
        version
    };
} //# sourceMappingURL=getCallsStatus.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/wallet/getCapabilities.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getCapabilities",
    ()=>getCapabilities
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/accounts/utils/parseAccount.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/toHex.js [app-client] (ecmascript)");
;
;
async function getCapabilities(client, parameters = {}) {
    const { account = client.account, chainId } = parameters;
    const account_ = account ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["parseAccount"])(account) : undefined;
    const params = chainId ? [
        account_?.address,
        [
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(chainId)
        ]
    ] : [
        account_?.address
    ];
    const capabilities_raw = await client.request({
        method: 'wallet_getCapabilities',
        params
    });
    const capabilities = {};
    for (const [chainId, capabilities_] of Object.entries(capabilities_raw)){
        capabilities[Number(chainId)] = {};
        for (let [key, value] of Object.entries(capabilities_)){
            if (key === 'addSubAccount') key = 'unstable_addSubAccount';
            capabilities[Number(chainId)][key] = value;
        }
    }
    return typeof chainId === 'number' ? capabilities[chainId] : capabilities;
} //# sourceMappingURL=getCapabilities.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/wallet/getPermissions.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Gets the wallets current permissions.
 *
 * - Docs: https://viem.sh/docs/actions/wallet/getPermissions
 * - JSON-RPC Methods: [`wallet_getPermissions`](https://eips.ethereum.org/EIPS/eip-2255)
 *
 * @param client - Client to use
 * @returns The wallet permissions. {@link GetPermissionsReturnType}
 *
 * @example
 * import { createWalletClient, custom } from 'viem'
 * import { mainnet } from 'viem/chains'
 * import { getPermissions } from 'viem/wallet'
 *
 * const client = createWalletClient({
 *   chain: mainnet,
 *   transport: custom(window.ethereum),
 * })
 * const permissions = await getPermissions(client)
 */ __turbopack_context__.s([
    "getPermissions",
    ()=>getPermissions
]);
async function getPermissions(client) {
    const permissions = await client.request({
        method: 'wallet_getPermissions'
    }, {
        dedupe: true
    });
    return permissions;
} //# sourceMappingURL=getPermissions.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/address/isAddressEqual.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "isAddressEqual",
    ()=>isAddressEqual
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$address$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/address.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$isAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/address/isAddress.js [app-client] (ecmascript)");
;
;
function isAddressEqual(a, b) {
    if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$isAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAddress"])(a, {
        strict: false
    })) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$address$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["InvalidAddressError"]({
        address: a
    });
    if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$isAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAddress"])(b, {
        strict: false
    })) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$address$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["InvalidAddressError"]({
        address: b
    });
    return a.toLowerCase() === b.toLowerCase();
} //# sourceMappingURL=isAddressEqual.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/wallet/prepareAuthorization.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "prepareAuthorization",
    ()=>prepareAuthorization
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/accounts/utils/parseAccount.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$account$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/account.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$isAddressEqual$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/address/isAddressEqual.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/getAction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getChainId$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/public/getChainId.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getTransactionCount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/public/getTransactionCount.js [app-client] (ecmascript)");
;
;
;
;
;
;
async function prepareAuthorization(client, parameters) {
    const { account: account_ = client.account, chainId, nonce } = parameters;
    if (!account_) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$account$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AccountNotFoundError"]({
        docsPath: '/docs/eip7702/prepareAuthorization'
    });
    const account = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["parseAccount"])(account_);
    const executor = (()=>{
        if (!parameters.executor) return undefined;
        if (parameters.executor === 'self') return parameters.executor;
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["parseAccount"])(parameters.executor);
    })();
    const authorization = {
        address: parameters.contractAddress ?? parameters.address,
        chainId,
        nonce
    };
    if (typeof authorization.chainId === 'undefined') authorization.chainId = client.chain?.id ?? await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getChainId$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getChainId"], 'getChainId')({});
    if (typeof authorization.nonce === 'undefined') {
        authorization.nonce = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getTransactionCount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getTransactionCount"], 'getTransactionCount')({
            address: account.address,
            blockTag: 'pending'
        });
        if (executor === 'self' || executor?.address && (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$isAddressEqual$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAddressEqual"])(executor.address, account.address)) authorization.nonce += 1;
    }
    return authorization;
} //# sourceMappingURL=prepareAuthorization.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/wallet/requestAddresses.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "requestAddresses",
    ()=>requestAddresses
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$getAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/address/getAddress.js [app-client] (ecmascript)");
;
async function requestAddresses(client) {
    const addresses = await client.request({
        method: 'eth_requestAccounts'
    }, {
        dedupe: true,
        retryCount: 0
    });
    return addresses.map((address)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$getAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAddress"])(address));
} //# sourceMappingURL=requestAddresses.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/wallet/requestPermissions.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Requests permissions for a wallet.
 *
 * - Docs: https://viem.sh/docs/actions/wallet/requestPermissions
 * - JSON-RPC Methods: [`wallet_requestPermissions`](https://eips.ethereum.org/EIPS/eip-2255)
 *
 * @param client - Client to use
 * @param parameters - {@link RequestPermissionsParameters}
 * @returns The wallet permissions. {@link RequestPermissionsReturnType}
 *
 * @example
 * import { createWalletClient, custom } from 'viem'
 * import { mainnet } from 'viem/chains'
 * import { requestPermissions } from 'viem/wallet'
 *
 * const client = createWalletClient({
 *   chain: mainnet,
 *   transport: custom(window.ethereum),
 * })
 * const permissions = await requestPermissions(client, {
 *   eth_accounts: {}
 * })
 */ __turbopack_context__.s([
    "requestPermissions",
    ()=>requestPermissions
]);
async function requestPermissions(client, permissions) {
    return client.request({
        method: 'wallet_requestPermissions',
        params: [
            permissions
        ]
    }, {
        retryCount: 0
    });
} //# sourceMappingURL=requestPermissions.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/errors/calls.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "BundleFailedError",
    ()=>BundleFailedError
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/base.js [app-client] (ecmascript)");
;
class BundleFailedError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor(result){
        super(`Call bundle failed with status: ${result.statusCode}`, {
            name: 'BundleFailedError'
        });
        Object.defineProperty(this, "result", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.result = result;
    }
} //# sourceMappingURL=calls.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/observe.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/** @internal */ __turbopack_context__.s([
    "cleanupCache",
    ()=>cleanupCache,
    "listenersCache",
    ()=>listenersCache,
    "observe",
    ()=>observe
]);
const listenersCache = /*#__PURE__*/ new Map();
const cleanupCache = /*#__PURE__*/ new Map();
let callbackCount = 0;
function observe(observerId, callbacks, fn) {
    const callbackId = ++callbackCount;
    const getListeners = ()=>listenersCache.get(observerId) || [];
    const unsubscribe = ()=>{
        const listeners = getListeners();
        listenersCache.set(observerId, listeners.filter((cb)=>cb.id !== callbackId));
    };
    const unwatch = ()=>{
        const listeners = getListeners();
        if (!listeners.some((cb)=>cb.id === callbackId)) return;
        const cleanup = cleanupCache.get(observerId);
        if (listeners.length === 1 && cleanup) {
            const p = cleanup();
            if (p instanceof Promise) p.catch(()=>{});
        }
        unsubscribe();
    };
    const listeners = getListeners();
    listenersCache.set(observerId, [
        ...listeners,
        {
            id: callbackId,
            fns: callbacks
        }
    ]);
    if (listeners && listeners.length > 0) return unwatch;
    const emit = {};
    for(const key in callbacks){
        emit[key] = (...args)=>{
            const listeners = getListeners();
            if (listeners.length === 0) return;
            for (const listener of listeners)listener.fns[key]?.(...args);
        };
    }
    const cleanup = fn(emit);
    if (typeof cleanup === 'function') cleanupCache.set(observerId, cleanup);
    return unwatch;
} //# sourceMappingURL=observe.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/poll.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "poll",
    ()=>poll
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$wait$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/wait.js [app-client] (ecmascript)");
;
function poll(fn, { emitOnBegin, initialWaitTime, interval }) {
    let active = true;
    const unwatch = ()=>active = false;
    const watch = async ()=>{
        let data;
        if (emitOnBegin) data = await fn({
            unpoll: unwatch
        });
        const initialWait = await initialWaitTime?.(data) ?? interval;
        await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$wait$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["wait"])(initialWait);
        const poll = async ()=>{
            if (!active) return;
            await fn({
                unpoll: unwatch
            });
            await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$wait$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["wait"])(interval);
            poll();
        };
        poll();
    };
    watch();
    return unwatch;
} //# sourceMappingURL=poll.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/wallet/waitForCallsStatus.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "WaitForCallsStatusTimeoutError",
    ()=>WaitForCallsStatusTimeoutError,
    "waitForCallsStatus",
    ()=>waitForCallsStatus
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/base.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$calls$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/calls.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/getAction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$observe$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/observe.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$poll$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/poll.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$promise$2f$withResolvers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/promise/withResolvers.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$promise$2f$withRetry$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/promise/withRetry.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$stringify$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/stringify.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$getCallsStatus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/getCallsStatus.js [app-client] (ecmascript)");
;
;
;
;
;
;
;
;
;
async function waitForCallsStatus(client, parameters) {
    const { id, pollingInterval = client.pollingInterval, status = ({ statusCode })=>statusCode === 200 || statusCode >= 300, retryCount = 4, retryDelay = ({ count })=>~~(1 << count) * 200, timeout = 60_000, throwOnFailure = false } = parameters;
    const observerId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$stringify$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["stringify"])([
        'waitForCallsStatus',
        client.uid,
        id
    ]);
    const { promise, resolve, reject } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$promise$2f$withResolvers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["withResolvers"])();
    let timer;
    const unobserve = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$observe$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["observe"])(observerId, {
        resolve,
        reject
    }, (emit)=>{
        const unpoll = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$poll$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["poll"])(async ()=>{
            const done = (fn)=>{
                clearTimeout(timer);
                unpoll();
                fn();
                unobserve();
            };
            try {
                const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$promise$2f$withRetry$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["withRetry"])(async ()=>{
                    const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$getCallsStatus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getCallsStatus"], 'getCallsStatus')({
                        id
                    });
                    if (throwOnFailure && result.status === 'failure') throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$calls$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BundleFailedError"](result);
                    return result;
                }, {
                    retryCount,
                    delay: retryDelay
                });
                if (!status(result)) return;
                done(()=>emit.resolve(result));
            } catch (error) {
                done(()=>emit.reject(error));
            }
        }, {
            interval: pollingInterval,
            emitOnBegin: true
        });
        return unpoll;
    });
    timer = timeout ? setTimeout(()=>{
        unobserve();
        clearTimeout(timer);
        reject(new WaitForCallsStatusTimeoutError({
            id
        }));
    }, timeout) : undefined;
    return await promise;
}
class WaitForCallsStatusTimeoutError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor({ id }){
        super(`Timed out while waiting for call bundle with id "${id}" to be confirmed.`, {
            name: 'WaitForCallsStatusTimeoutError'
        });
    }
} //# sourceMappingURL=waitForCallsStatus.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/wallet/sendCallsSync.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "sendCallsSync",
    ()=>sendCallsSync
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/getAction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendCalls$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/sendCalls.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$waitForCallsStatus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/waitForCallsStatus.js [app-client] (ecmascript)");
;
;
;
async function sendCallsSync(client, parameters) {
    const { chain = client.chain } = parameters;
    const timeout = parameters.timeout ?? Math.max((chain?.blockTime ?? 0) * 3, 5_000);
    const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendCalls$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["sendCalls"], 'sendCalls')(parameters);
    const status = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$waitForCallsStatus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["waitForCallsStatus"], 'waitForCallsStatus')({
        ...parameters,
        id: result.id,
        timeout
    });
    return status;
} //# sourceMappingURL=sendCallsSync.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/wallet/sendRawTransactionSync.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "sendRawTransactionSync",
    ()=>sendRawTransactionSync
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$transaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/transaction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$transactionReceipt$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/formatters/transactionReceipt.js [app-client] (ecmascript)");
;
;
async function sendRawTransactionSync(client, { serializedTransaction, throwOnReceiptRevert, timeout }) {
    const receipt = await client.request({
        method: 'eth_sendRawTransactionSync',
        params: timeout ? [
            serializedTransaction,
            timeout
        ] : [
            serializedTransaction
        ]
    }, {
        retryCount: 0
    });
    const format = client.chain?.formatters?.transactionReceipt?.format || __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$transactionReceipt$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatTransactionReceipt"];
    const formatted = format(receipt);
    if (formatted.status === 'reverted' && throwOnReceiptRevert) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$transaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["TransactionReceiptRevertedError"]({
        receipt: formatted
    });
    return formatted;
} //# sourceMappingURL=sendRawTransactionSync.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/public/getTransaction.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getTransaction",
    ()=>getTransaction
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$transaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/transaction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/toHex.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$transaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/formatters/transaction.js [app-client] (ecmascript)");
;
;
;
async function getTransaction(client, { blockHash, blockNumber, blockTag: blockTag_, hash, index, sender, nonce }) {
    const blockTag = blockTag_ || 'latest';
    const blockNumberHex = blockNumber !== undefined ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(blockNumber) : undefined;
    let transaction = null;
    if (hash) {
        transaction = await client.request({
            method: 'eth_getTransactionByHash',
            params: [
                hash
            ]
        }, {
            dedupe: true
        });
    } else if (blockHash) {
        transaction = await client.request({
            method: 'eth_getTransactionByBlockHashAndIndex',
            params: [
                blockHash,
                (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(index)
            ]
        }, {
            dedupe: true
        });
    } else if ((blockNumberHex || blockTag) && typeof index === 'number') {
        transaction = await client.request({
            method: 'eth_getTransactionByBlockNumberAndIndex',
            params: [
                blockNumberHex || blockTag,
                (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(index)
            ]
        }, {
            dedupe: Boolean(blockNumberHex)
        });
    } else if (sender && typeof nonce === 'number') {
        transaction = await client.request({
            method: 'eth_getTransactionBySenderAndNonce',
            params: [
                sender,
                (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(nonce)
            ]
        }, {
            dedupe: true
        });
    }
    if (!transaction) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$transaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["TransactionNotFoundError"]({
        blockHash,
        blockNumber,
        blockTag,
        hash,
        index
    });
    const format = client.chain?.formatters?.transaction?.format || __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$transaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatTransaction"];
    return format(transaction, 'getTransaction');
} //# sourceMappingURL=getTransaction.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/public/getTransactionReceipt.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getTransactionReceipt",
    ()=>getTransactionReceipt
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$transaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/transaction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$transactionReceipt$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/formatters/transactionReceipt.js [app-client] (ecmascript)");
;
;
async function getTransactionReceipt(client, { hash }) {
    const receipt = await client.request({
        method: 'eth_getTransactionReceipt',
        params: [
            hash
        ]
    }, {
        dedupe: true
    });
    if (!receipt) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$transaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["TransactionReceiptNotFoundError"]({
        hash
    });
    const format = client.chain?.formatters?.transactionReceipt?.format || __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$transactionReceipt$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatTransactionReceipt"];
    return format(receipt, 'getTransactionReceipt');
} //# sourceMappingURL=getTransactionReceipt.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/promise/withCache.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/** @internal */ __turbopack_context__.s([
    "getCache",
    ()=>getCache,
    "promiseCache",
    ()=>promiseCache,
    "responseCache",
    ()=>responseCache,
    "withCache",
    ()=>withCache
]);
const promiseCache = /*#__PURE__*/ new Map();
const responseCache = /*#__PURE__*/ new Map();
function getCache(cacheKey) {
    const buildCache = (cacheKey, cache)=>({
            clear: ()=>cache.delete(cacheKey),
            get: ()=>cache.get(cacheKey),
            set: (data)=>cache.set(cacheKey, data)
        });
    const promise = buildCache(cacheKey, promiseCache);
    const response = buildCache(cacheKey, responseCache);
    return {
        clear: ()=>{
            promise.clear();
            response.clear();
        },
        promise,
        response
    };
}
async function withCache(fn, { cacheKey, cacheTime = Number.POSITIVE_INFINITY }) {
    const cache = getCache(cacheKey);
    // If a response exists in the cache, and it's not expired, return it
    // and do not invoke the promise.
    // If the max age is 0, the cache is disabled.
    const response = cache.response.get();
    if (response && cacheTime > 0) {
        const age = Date.now() - response.created.getTime();
        if (age < cacheTime) return response.data;
    }
    let promise = cache.promise.get();
    if (!promise) {
        promise = fn();
        // Store the promise in the cache so that subsequent invocations
        // will wait for the same promise to resolve (deduping).
        cache.promise.set(promise);
    }
    try {
        const data = await promise;
        // Store the response in the cache so that subsequent invocations
        // will return the same response.
        cache.response.set({
            created: new Date(),
            data
        });
        return data;
    } finally{
        // Clear the promise cache so that subsequent invocations will
        // invoke the promise again.
        cache.promise.clear();
    }
} //# sourceMappingURL=withCache.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/public/getBlockNumber.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getBlockNumber",
    ()=>getBlockNumber,
    "getBlockNumberCache",
    ()=>getBlockNumberCache
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$promise$2f$withCache$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/promise/withCache.js [app-client] (ecmascript)");
;
const cacheKey = (id)=>`blockNumber.${id}`;
function getBlockNumberCache(id) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$promise$2f$withCache$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getCache"])(cacheKey(id));
}
async function getBlockNumber(client, { cacheTime = client.cacheTime } = {}) {
    const blockNumberHex = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$promise$2f$withCache$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["withCache"])(()=>client.request({
            method: 'eth_blockNumber'
        }), {
        cacheKey: cacheKey(client.uid),
        cacheTime
    });
    return BigInt(blockNumberHex);
} //# sourceMappingURL=getBlockNumber.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/public/watchBlockNumber.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "watchBlockNumber",
    ()=>watchBlockNumber
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/fromHex.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/getAction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$observe$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/observe.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$poll$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/poll.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$stringify$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/stringify.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getBlockNumber$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/public/getBlockNumber.js [app-client] (ecmascript)");
;
;
;
;
;
;
function watchBlockNumber(client, { emitOnBegin = false, emitMissed = false, onBlockNumber, onError, poll: poll_, pollingInterval = client.pollingInterval }) {
    const enablePolling = (()=>{
        if (typeof poll_ !== 'undefined') return poll_;
        if (client.transport.type === 'webSocket' || client.transport.type === 'ipc') return false;
        if (client.transport.type === 'fallback' && (client.transport.transports[0].config.type === 'webSocket' || client.transport.transports[0].config.type === 'ipc')) return false;
        return true;
    })();
    let prevBlockNumber;
    const pollBlockNumber = ()=>{
        const observerId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$stringify$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["stringify"])([
            'watchBlockNumber',
            client.uid,
            emitOnBegin,
            emitMissed,
            pollingInterval
        ]);
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$observe$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["observe"])(observerId, {
            onBlockNumber,
            onError
        }, (emit)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$poll$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["poll"])(async ()=>{
                try {
                    const blockNumber = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getBlockNumber$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getBlockNumber"], 'getBlockNumber')({
                        cacheTime: 0
                    });
                    if (prevBlockNumber !== undefined) {
                        // If the current block number is the same as the previous,
                        // we can skip.
                        if (blockNumber === prevBlockNumber) return;
                        // If we have missed out on some previous blocks, and the
                        // `emitMissed` flag is truthy, let's emit those blocks.
                        if (blockNumber - prevBlockNumber > 1 && emitMissed) {
                            for(let i = prevBlockNumber + 1n; i < blockNumber; i++){
                                emit.onBlockNumber(i, prevBlockNumber);
                                prevBlockNumber = i;
                            }
                        }
                    }
                    // If the next block number is greater than the previous,
                    // it is not in the past, and we can emit the new block number.
                    if (prevBlockNumber === undefined || blockNumber > prevBlockNumber) {
                        emit.onBlockNumber(blockNumber, prevBlockNumber);
                        prevBlockNumber = blockNumber;
                    }
                } catch (err) {
                    emit.onError?.(err);
                }
            }, {
                emitOnBegin,
                interval: pollingInterval
            }));
    };
    const subscribeBlockNumber = ()=>{
        const observerId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$stringify$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["stringify"])([
            'watchBlockNumber',
            client.uid,
            emitOnBegin,
            emitMissed
        ]);
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$observe$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["observe"])(observerId, {
            onBlockNumber,
            onError
        }, (emit)=>{
            let active = true;
            let unsubscribe = ()=>active = false;
            (async ()=>{
                try {
                    const transport = (()=>{
                        if (client.transport.type === 'fallback') {
                            const transport = client.transport.transports.find((transport)=>transport.config.type === 'webSocket' || transport.config.type === 'ipc');
                            if (!transport) return client.transport;
                            return transport.value;
                        }
                        return client.transport;
                    })();
                    const { unsubscribe: unsubscribe_ } = await transport.subscribe({
                        params: [
                            'newHeads'
                        ],
                        onData (data) {
                            if (!active) return;
                            const blockNumber = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hexToBigInt"])(data.result?.number);
                            emit.onBlockNumber(blockNumber, prevBlockNumber);
                            prevBlockNumber = blockNumber;
                        },
                        onError (error) {
                            emit.onError?.(error);
                        }
                    });
                    unsubscribe = unsubscribe_;
                    if (!active) unsubscribe();
                } catch (err) {
                    onError?.(err);
                }
            })();
            return ()=>unsubscribe();
        });
    };
    return enablePolling ? pollBlockNumber() : subscribeBlockNumber();
} //# sourceMappingURL=watchBlockNumber.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/public/waitForTransactionReceipt.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "waitForTransactionReceipt",
    ()=>waitForTransactionReceipt
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$block$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/block.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$transaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/transaction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/getAction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$observe$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/observe.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$promise$2f$withResolvers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/promise/withResolvers.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$promise$2f$withRetry$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/promise/withRetry.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$stringify$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/stringify.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getBlock$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/public/getBlock.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getTransaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/public/getTransaction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getTransactionReceipt$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/public/getTransactionReceipt.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$watchBlockNumber$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/public/watchBlockNumber.js [app-client] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
;
async function waitForTransactionReceipt(client, parameters) {
    const { checkReplacement = true, confirmations = 1, hash, onReplaced, retryCount = 6, retryDelay = ({ count })=>~~(1 << count) * 200, timeout = 180_000 } = parameters;
    const observerId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$stringify$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["stringify"])([
        'waitForTransactionReceipt',
        client.uid,
        hash
    ]);
    const pollingInterval = (()=>{
        if (parameters.pollingInterval) return parameters.pollingInterval;
        if (client.chain?.experimental_preconfirmationTime) return client.chain.experimental_preconfirmationTime;
        return client.pollingInterval;
    })();
    let transaction;
    let replacedTransaction;
    let receipt;
    let retrying = false;
    let _unobserve;
    let _unwatch;
    const { promise, resolve, reject } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$promise$2f$withResolvers$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["withResolvers"])();
    const timer = timeout ? setTimeout(()=>{
        _unwatch?.();
        _unobserve?.();
        reject(new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$transaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["WaitForTransactionReceiptTimeoutError"]({
            hash
        }));
    }, timeout) : undefined;
    _unobserve = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$observe$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["observe"])(observerId, {
        onReplaced,
        resolve,
        reject
    }, async (emit)=>{
        receipt = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getTransactionReceipt$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getTransactionReceipt"], 'getTransactionReceipt')({
            hash
        }).catch(()=>undefined);
        if (receipt && confirmations <= 1) {
            clearTimeout(timer);
            emit.resolve(receipt);
            _unobserve?.();
            return;
        }
        _unwatch = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$watchBlockNumber$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["watchBlockNumber"], 'watchBlockNumber')({
            emitMissed: true,
            emitOnBegin: true,
            poll: true,
            pollingInterval,
            async onBlockNumber (blockNumber_) {
                const done = (fn)=>{
                    clearTimeout(timer);
                    _unwatch?.();
                    fn();
                    _unobserve?.();
                };
                let blockNumber = blockNumber_;
                if (retrying) return;
                try {
                    // If we already have a valid receipt, let's check if we have enough
                    // confirmations. If we do, then we can resolve.
                    if (receipt) {
                        if (confirmations > 1 && (!receipt.blockNumber || blockNumber - receipt.blockNumber + 1n < confirmations)) return;
                        done(()=>emit.resolve(receipt));
                        return;
                    }
                    // Get the transaction to check if it's been replaced.
                    // We need to retry as some RPC Providers may be slow to sync
                    // up mined transactions.
                    if (checkReplacement && !transaction) {
                        retrying = true;
                        await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$promise$2f$withRetry$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["withRetry"])(async ()=>{
                            transaction = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getTransaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getTransaction"], 'getTransaction')({
                                hash
                            });
                            if (transaction.blockNumber) blockNumber = transaction.blockNumber;
                        }, {
                            delay: retryDelay,
                            retryCount
                        });
                        retrying = false;
                    }
                    // Get the receipt to check if it's been processed.
                    receipt = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getTransactionReceipt$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getTransactionReceipt"], 'getTransactionReceipt')({
                        hash
                    });
                    // Check if we have enough confirmations. If not, continue polling.
                    if (confirmations > 1 && (!receipt.blockNumber || blockNumber - receipt.blockNumber + 1n < confirmations)) return;
                    done(()=>emit.resolve(receipt));
                } catch (err) {
                    // If the receipt is not found, the transaction will be pending.
                    // We need to check if it has potentially been replaced.
                    if (err instanceof __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$transaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["TransactionNotFoundError"] || err instanceof __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$transaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["TransactionReceiptNotFoundError"]) {
                        if (!transaction) {
                            retrying = false;
                            return;
                        }
                        try {
                            replacedTransaction = transaction;
                            // Let's retrieve the transactions from the current block.
                            // We need to retry as some RPC Providers may be slow to sync
                            // up mined blocks.
                            retrying = true;
                            const block = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$promise$2f$withRetry$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["withRetry"])(()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getBlock$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getBlock"], 'getBlock')({
                                    blockNumber,
                                    includeTransactions: true
                                }), {
                                delay: retryDelay,
                                retryCount,
                                shouldRetry: ({ error })=>error instanceof __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$block$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BlockNotFoundError"]
                            });
                            retrying = false;
                            const replacementTransaction = block.transactions.find(({ from, nonce })=>from === replacedTransaction.from && nonce === replacedTransaction.nonce);
                            // If we couldn't find a replacement transaction, continue polling.
                            if (!replacementTransaction) return;
                            // If we found a replacement transaction, return it's receipt.
                            receipt = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getTransactionReceipt$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getTransactionReceipt"], 'getTransactionReceipt')({
                                hash: replacementTransaction.hash
                            });
                            // Check if we have enough confirmations. If not, continue polling.
                            if (confirmations > 1 && (!receipt.blockNumber || blockNumber - receipt.blockNumber + 1n < confirmations)) return;
                            let reason = 'replaced';
                            if (replacementTransaction.to === replacedTransaction.to && replacementTransaction.value === replacedTransaction.value && replacementTransaction.input === replacedTransaction.input) {
                                reason = 'repriced';
                            } else if (replacementTransaction.from === replacementTransaction.to && replacementTransaction.value === 0n) {
                                reason = 'cancelled';
                            }
                            done(()=>{
                                emit.onReplaced?.({
                                    reason,
                                    replacedTransaction: replacedTransaction,
                                    transaction: replacementTransaction,
                                    transactionReceipt: receipt
                                });
                                emit.resolve(receipt);
                            });
                        } catch (err_) {
                            done(()=>emit.reject(err_));
                        }
                    } else {
                        done(()=>emit.reject(err));
                    }
                }
            }
        });
    });
    return promise;
} //# sourceMappingURL=waitForTransactionReceipt.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/wallet/sendTransactionSync.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "sendTransactionSync",
    ()=>sendTransactionSync
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/accounts/utils/parseAccount.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$account$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/account.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/base.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$transaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/transaction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$authorization$2f$recoverAuthorizationAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/authorization/recoverAuthorizationAddress.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$chain$2f$assertCurrentChain$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/chain/assertCurrentChain.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$concat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/data/concat.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$errors$2f$getTransactionError$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/errors/getTransactionError.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$extract$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/formatters/extract.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$transactionRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/formatters/transactionRequest.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/getAction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$lru$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/lru.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$transaction$2f$assertRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/transaction/assertRequest.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getChainId$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/public/getChainId.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$waitForTransactionReceipt$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/public/waitForTransactionReceipt.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$prepareTransactionRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/prepareTransactionRequest.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendRawTransactionSync$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/sendRawTransactionSync.js [app-client] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
const supportsWalletNamespace = new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$lru$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["LruMap"](128);
async function sendTransactionSync(client, parameters) {
    const { account: account_ = client.account, assertChainId = true, chain = client.chain, accessList, authorizationList, blobs, data, dataSuffix = typeof client.dataSuffix === 'string' ? client.dataSuffix : client.dataSuffix?.value, gas, gasPrice, maxFeePerBlobGas, maxFeePerGas, maxPriorityFeePerGas, nonce, pollingInterval, throwOnReceiptRevert, type, value, ...rest } = parameters;
    const timeout = parameters.timeout ?? Math.max((chain?.blockTime ?? 0) * 3, 5_000);
    if (typeof account_ === 'undefined') throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$account$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AccountNotFoundError"]({
        docsPath: '/docs/actions/wallet/sendTransactionSync'
    });
    const account = account_ ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["parseAccount"])(account_) : null;
    try {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$transaction$2f$assertRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["assertRequest"])(parameters);
        const to = await (async ()=>{
            // If `to` exists on the parameters, use that.
            if (parameters.to) return parameters.to;
            // If `to` is null, we are sending a deployment transaction.
            if (parameters.to === null) return undefined;
            // If no `to` exists, and we are sending a EIP-7702 transaction, use the
            // address of the first authorization in the list.
            if (authorizationList && authorizationList.length > 0) return await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$authorization$2f$recoverAuthorizationAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["recoverAuthorizationAddress"])({
                authorization: authorizationList[0]
            }).catch(()=>{
                throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"]('`to` is required. Could not infer from `authorizationList`.');
            });
            // Otherwise, we are sending a deployment transaction.
            return undefined;
        })();
        if (account?.type === 'json-rpc' || account === null) {
            let chainId;
            if (chain !== null) {
                chainId = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getChainId$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getChainId"], 'getChainId')({});
                if (assertChainId) (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$chain$2f$assertCurrentChain$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["assertCurrentChain"])({
                    currentChainId: chainId,
                    chain
                });
            }
            const chainFormat = client.chain?.formatters?.transactionRequest?.format;
            const format = chainFormat || __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$transactionRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatTransactionRequest"];
            const request = format({
                // Pick out extra data that might exist on the chain's transaction request type.
                ...(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$extract$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["extract"])(rest, {
                    format: chainFormat
                }),
                accessList,
                account,
                authorizationList,
                blobs,
                chainId,
                data: data ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$concat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["concat"])([
                    data,
                    dataSuffix ?? '0x'
                ]) : data,
                gas,
                gasPrice,
                maxFeePerBlobGas,
                maxFeePerGas,
                maxPriorityFeePerGas,
                nonce,
                to,
                type,
                value
            }, 'sendTransaction');
            const isWalletNamespaceSupported = supportsWalletNamespace.get(client.uid);
            const method = isWalletNamespaceSupported ? 'wallet_sendTransaction' : 'eth_sendTransaction';
            const hash = await (async ()=>{
                try {
                    return await client.request({
                        method,
                        params: [
                            request
                        ]
                    }, {
                        retryCount: 0
                    });
                } catch (e) {
                    if (isWalletNamespaceSupported === false) throw e;
                    const error = e;
                    // If the transport does not support the method or input, attempt to use the
                    // `wallet_sendTransaction` method.
                    if (error.name === 'InvalidInputRpcError' || error.name === 'InvalidParamsRpcError' || error.name === 'MethodNotFoundRpcError' || error.name === 'MethodNotSupportedRpcError') {
                        return await client.request({
                            method: 'wallet_sendTransaction',
                            params: [
                                request
                            ]
                        }, {
                            retryCount: 0
                        }).then((hash)=>{
                            supportsWalletNamespace.set(client.uid, true);
                            return hash;
                        }).catch((e)=>{
                            const walletNamespaceError = e;
                            if (walletNamespaceError.name === 'MethodNotFoundRpcError' || walletNamespaceError.name === 'MethodNotSupportedRpcError') {
                                supportsWalletNamespace.set(client.uid, false);
                                throw error;
                            }
                            throw walletNamespaceError;
                        });
                    }
                    throw error;
                }
            })();
            const receipt = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$waitForTransactionReceipt$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["waitForTransactionReceipt"], 'waitForTransactionReceipt')({
                checkReplacement: false,
                hash,
                pollingInterval,
                timeout
            });
            if (throwOnReceiptRevert && receipt.status === 'reverted') throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$transaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["TransactionReceiptRevertedError"]({
                receipt
            });
            return receipt;
        }
        if (account?.type === 'local') {
            // Prepare the request for signing (assign appropriate fees, etc.)
            const request = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$prepareTransactionRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["prepareTransactionRequest"], 'prepareTransactionRequest')({
                account,
                accessList,
                authorizationList,
                blobs,
                chain,
                data: data ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$concat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["concat"])([
                    data,
                    dataSuffix ?? '0x'
                ]) : data,
                gas,
                gasPrice,
                maxFeePerBlobGas,
                maxFeePerGas,
                maxPriorityFeePerGas,
                nonce,
                nonceManager: account.nonceManager,
                parameters: [
                    ...__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$prepareTransactionRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["defaultParameters"],
                    'sidecars'
                ],
                type,
                value,
                ...rest,
                to
            });
            const serializer = chain?.serializers?.transaction;
            const serializedTransaction = await account.signTransaction(request, {
                serializer
            });
            return await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendRawTransactionSync$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["sendRawTransactionSync"], 'sendRawTransactionSync')({
                serializedTransaction,
                throwOnReceiptRevert,
                timeout: parameters.timeout
            });
        }
        if (account?.type === 'smart') throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$account$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AccountTypeNotSupportedError"]({
            metaMessages: [
                'Consider using the `sendUserOperation` Action instead.'
            ],
            docsPath: '/docs/actions/bundler/sendUserOperation',
            type: 'smart'
        });
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$account$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AccountTypeNotSupportedError"]({
            docsPath: '/docs/actions/wallet/sendTransactionSync',
            type: account?.type
        });
    } catch (err) {
        if (err instanceof __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$account$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AccountTypeNotSupportedError"]) throw err;
        throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$errors$2f$getTransactionError$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getTransactionError"])(err, {
            ...parameters,
            account,
            chain: parameters.chain || undefined
        });
    }
} //# sourceMappingURL=sendTransactionSync.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/wallet/showCallsStatus.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Requests for the wallet to show information about a call batch
 * that was sent via `sendCalls`.
 *
 * - Docs: https://viem.sh/docs/actions/wallet/showCallsStatus
 * - JSON-RPC Methods: [`wallet_showCallsStatus`](https://eips.ethereum.org/EIPS/eip-5792)
 *
 * @param client - Client to use
 * @returns Status of the calls. {@link ShowCallsStatusReturnType}
 *
 * @example
 * import { createWalletClient, custom } from 'viem'
 * import { mainnet } from 'viem/chains'
 * import { showCallsStatus } from 'viem/actions'
 *
 * const client = createWalletClient({
 *   chain: mainnet,
 *   transport: custom(window.ethereum),
 * })
 * await showCallsStatus(client, { id: '0xdeadbeef' })
 */ __turbopack_context__.s([
    "showCallsStatus",
    ()=>showCallsStatus
]);
async function showCallsStatus(client, parameters) {
    const { id } = parameters;
    await client.request({
        method: 'wallet_showCallsStatus',
        params: [
            id
        ]
    });
    return;
} //# sourceMappingURL=showCallsStatus.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/wallet/signAuthorization.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "signAuthorization",
    ()=>signAuthorization
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/accounts/utils/parseAccount.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$account$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/account.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$prepareAuthorization$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/prepareAuthorization.js [app-client] (ecmascript)");
;
;
;
async function signAuthorization(client, parameters) {
    const { account: account_ = client.account } = parameters;
    if (!account_) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$account$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AccountNotFoundError"]({
        docsPath: '/docs/eip7702/signAuthorization'
    });
    const account = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["parseAccount"])(account_);
    if (!account.signAuthorization) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$account$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AccountTypeNotSupportedError"]({
        docsPath: '/docs/eip7702/signAuthorization',
        metaMessages: [
            'The `signAuthorization` Action does not support JSON-RPC Accounts.'
        ],
        type: account.type
    });
    const authorization = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$prepareAuthorization$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["prepareAuthorization"])(client, parameters);
    return account.signAuthorization(authorization);
} //# sourceMappingURL=signAuthorization.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/wallet/signMessage.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "signMessage",
    ()=>signMessage
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/accounts/utils/parseAccount.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$account$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/account.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/toHex.js [app-client] (ecmascript)");
;
;
;
async function signMessage(client, { account: account_ = client.account, message }) {
    if (!account_) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$account$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AccountNotFoundError"]({
        docsPath: '/docs/actions/wallet/signMessage'
    });
    const account = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["parseAccount"])(account_);
    if (account.signMessage) return account.signMessage({
        message
    });
    const message_ = (()=>{
        if (typeof message === 'string') return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["stringToHex"])(message);
        if (message.raw instanceof Uint8Array) return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["toHex"])(message.raw);
        return message.raw;
    })();
    return client.request({
        method: 'personal_sign',
        params: [
            message_,
            account.address
        ]
    }, {
        retryCount: 0
    });
} //# sourceMappingURL=signMessage.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/wallet/signTransaction.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "signTransaction",
    ()=>signTransaction
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/accounts/utils/parseAccount.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$account$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/account.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$chain$2f$assertCurrentChain$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/chain/assertCurrentChain.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/toHex.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$transactionRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/formatters/transactionRequest.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/getAction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$transaction$2f$assertRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/transaction/assertRequest.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getChainId$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/public/getChainId.js [app-client] (ecmascript)");
;
;
;
;
;
;
;
;
async function signTransaction(client, parameters) {
    const { account: account_ = client.account, chain = client.chain, ...transaction } = parameters;
    if (!account_) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$account$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AccountNotFoundError"]({
        docsPath: '/docs/actions/wallet/signTransaction'
    });
    const account = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["parseAccount"])(account_);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$transaction$2f$assertRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["assertRequest"])({
        account,
        ...parameters
    });
    const chainId = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getChainId$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getChainId"], 'getChainId')({});
    if (chain !== null) (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$chain$2f$assertCurrentChain$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["assertCurrentChain"])({
        currentChainId: chainId,
        chain
    });
    const formatters = chain?.formatters || client.chain?.formatters;
    const format = formatters?.transactionRequest?.format || __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$formatters$2f$transactionRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatTransactionRequest"];
    if (account.signTransaction) return account.signTransaction({
        ...transaction,
        chainId
    }, {
        serializer: client.chain?.serializers?.transaction
    });
    return await client.request({
        method: 'eth_signTransaction',
        params: [
            {
                ...format({
                    ...transaction,
                    account
                }, 'signTransaction'),
                chainId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(chainId),
                from: account.address
            }
        ]
    }, {
        retryCount: 0
    });
} //# sourceMappingURL=signTransaction.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/errors/typedData.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "InvalidDomainError",
    ()=>InvalidDomainError,
    "InvalidPrimaryTypeError",
    ()=>InvalidPrimaryTypeError,
    "InvalidStructTypeError",
    ()=>InvalidStructTypeError
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$stringify$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/stringify.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/base.js [app-client] (ecmascript)");
;
;
class InvalidDomainError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor({ domain }){
        super(`Invalid domain "${(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$stringify$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["stringify"])(domain)}".`, {
            metaMessages: [
                'Must be a valid EIP-712 domain.'
            ]
        });
    }
}
class InvalidPrimaryTypeError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor({ primaryType, types }){
        super(`Invalid primary type \`${primaryType}\` must be one of \`${JSON.stringify(Object.keys(types))}\`.`, {
            docsPath: '/api/glossary/Errors#typeddatainvalidprimarytypeerror',
            metaMessages: [
                'Check that the primary type is a key in `types`.'
            ]
        });
    }
}
class InvalidStructTypeError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor({ type }){
        super(`Struct type "${type}" is invalid.`, {
            metaMessages: [
                'Struct type must not be a Solidity type.'
            ],
            name: 'InvalidStructTypeError'
        });
    }
} //# sourceMappingURL=typedData.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/signature/hashTypedData.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "encodeType",
    ()=>encodeType,
    "hashDomain",
    ()=>hashDomain,
    "hashStruct",
    ()=>hashStruct,
    "hashTypedData",
    ()=>hashTypedData
]);
// Implementation forked and adapted from https://github.com/MetaMask/eth-sig-util/blob/main/src/sign-typed-data.ts
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$encodeAbiParameters$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/abi/encodeAbiParameters.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$concat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/data/concat.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/toHex.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$keccak256$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/hash/keccak256.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$typedData$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/typedData.js [app-client] (ecmascript)");
;
;
;
;
;
function hashTypedData(parameters) {
    const { domain = {}, message, primaryType } = parameters;
    const types = {
        EIP712Domain: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$typedData$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getTypesForEIP712Domain"])({
            domain
        }),
        ...parameters.types
    };
    // Need to do a runtime validation check on addresses, byte ranges, integer ranges, etc
    // as we can't statically check this with TypeScript.
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$typedData$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["validateTypedData"])({
        domain,
        message,
        primaryType,
        types
    });
    const parts = [
        '0x1901'
    ];
    if (domain) parts.push(hashDomain({
        domain,
        types: types
    }));
    if (primaryType !== 'EIP712Domain') parts.push(hashStruct({
        data: message,
        primaryType,
        types: types
    }));
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$keccak256$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["keccak256"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$concat$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["concat"])(parts));
}
function hashDomain({ domain, types }) {
    return hashStruct({
        data: domain,
        primaryType: 'EIP712Domain',
        types: types
    });
}
function hashStruct({ data, primaryType, types }) {
    const encoded = encodeData({
        data: data,
        primaryType,
        types: types
    });
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$keccak256$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["keccak256"])(encoded);
}
function encodeData({ data, primaryType, types }) {
    const encodedTypes = [
        {
            type: 'bytes32'
        }
    ];
    const encodedValues = [
        hashType({
            primaryType,
            types
        })
    ];
    for (const field of types[primaryType]){
        const [type, value] = encodeField({
            types,
            name: field.name,
            type: field.type,
            value: data[field.name]
        });
        encodedTypes.push(type);
        encodedValues.push(value);
    }
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$encodeAbiParameters$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["encodeAbiParameters"])(encodedTypes, encodedValues);
}
function hashType({ primaryType, types }) {
    const encodedHashType = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["toHex"])(encodeType({
        primaryType,
        types
    }));
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$keccak256$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["keccak256"])(encodedHashType);
}
function encodeType({ primaryType, types }) {
    let result = '';
    const unsortedDeps = findTypeDependencies({
        primaryType,
        types
    });
    unsortedDeps.delete(primaryType);
    const deps = [
        primaryType,
        ...Array.from(unsortedDeps).sort()
    ];
    for (const type of deps){
        result += `${type}(${types[type].map(({ name, type: t })=>`${t} ${name}`).join(',')})`;
    }
    return result;
}
function findTypeDependencies({ primaryType: primaryType_, types }, results = new Set()) {
    const match = primaryType_.match(/^\w*/u);
    const primaryType = match?.[0];
    if (results.has(primaryType) || types[primaryType] === undefined) {
        return results;
    }
    results.add(primaryType);
    for (const field of types[primaryType]){
        findTypeDependencies({
            primaryType: field.type,
            types
        }, results);
    }
    return results;
}
function encodeField({ types, name, type, value }) {
    if (types[type] !== undefined) {
        return [
            {
                type: 'bytes32'
            },
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$keccak256$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["keccak256"])(encodeData({
                data: value,
                primaryType: type,
                types
            }))
        ];
    }
    if (type === 'bytes') return [
        {
            type: 'bytes32'
        },
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$keccak256$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["keccak256"])(value)
    ];
    if (type === 'string') return [
        {
            type: 'bytes32'
        },
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$keccak256$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["keccak256"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["toHex"])(value))
    ];
    if (type.lastIndexOf(']') === type.length - 1) {
        const parsedType = type.slice(0, type.lastIndexOf('['));
        const typeValuePairs = value.map((item)=>encodeField({
                name,
                type: parsedType,
                types,
                value: item
            }));
        return [
            {
                type: 'bytes32'
            },
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$keccak256$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["keccak256"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$encodeAbiParameters$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["encodeAbiParameters"])(typeValuePairs.map(([t])=>t), typeValuePairs.map(([, v])=>v)))
        ];
    }
    return [
        {
            type
        },
        value
    ];
} //# sourceMappingURL=hashTypedData.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/typedData.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "domainSeparator",
    ()=>domainSeparator,
    "getTypesForEIP712Domain",
    ()=>getTypesForEIP712Domain,
    "serializeTypedData",
    ()=>serializeTypedData,
    "validateTypedData",
    ()=>validateTypedData
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/abi.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$address$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/address.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$typedData$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/typedData.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$isAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/address/isAddress.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$size$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/data/size.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/toHex.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$regex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/regex.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$signature$2f$hashTypedData$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/signature/hashTypedData.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$stringify$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/stringify.js [app-client] (ecmascript)");
;
;
;
;
;
;
;
;
;
function serializeTypedData(parameters) {
    const { domain: domain_, message: message_, primaryType, types } = parameters;
    const normalizeData = (struct, data_)=>{
        const data = {
            ...data_
        };
        for (const param of struct){
            const { name, type } = param;
            if (type === 'address') data[name] = data[name].toLowerCase();
        }
        return data;
    };
    const domain = (()=>{
        if (!types.EIP712Domain) return {};
        if (!domain_) return {};
        return normalizeData(types.EIP712Domain, domain_);
    })();
    const message = (()=>{
        if (primaryType === 'EIP712Domain') return undefined;
        return normalizeData(types[primaryType], message_);
    })();
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$stringify$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["stringify"])({
        domain,
        message,
        primaryType,
        types
    });
}
function validateTypedData(parameters) {
    const { domain, message, primaryType, types } = parameters;
    const validateData = (struct, data)=>{
        for (const param of struct){
            const { name, type } = param;
            const value = data[name];
            const integerMatch = type.match(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$regex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["integerRegex"]);
            if (integerMatch && (typeof value === 'number' || typeof value === 'bigint')) {
                const [_type, base, size_] = integerMatch;
                // If number cannot be cast to a sized hex value, it is out of range
                // and will throw.
                (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(value, {
                    signed: base === 'int',
                    size: Number.parseInt(size_, 10) / 8
                });
            }
            if (type === 'address' && typeof value === 'string' && !(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$isAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["isAddress"])(value)) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$address$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["InvalidAddressError"]({
                address: value
            });
            const bytesMatch = type.match(__TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$regex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["bytesRegex"]);
            if (bytesMatch) {
                const [_type, size_] = bytesMatch;
                if (size_ && (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$size$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["size"])(value) !== Number.parseInt(size_, 10)) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BytesSizeMismatchError"]({
                    expectedSize: Number.parseInt(size_, 10),
                    givenSize: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$size$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["size"])(value)
                });
            }
            const struct = types[type];
            if (struct) {
                validateReference(type);
                validateData(struct, value);
            }
        }
    };
    // Validate domain types.
    if (types.EIP712Domain && domain) {
        if (typeof domain !== 'object') throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$typedData$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["InvalidDomainError"]({
            domain
        });
        validateData(types.EIP712Domain, domain);
    }
    // Validate message types.
    if (primaryType !== 'EIP712Domain') {
        if (types[primaryType]) validateData(types[primaryType], message);
        else throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$typedData$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["InvalidPrimaryTypeError"]({
            primaryType,
            types
        });
    }
}
function getTypesForEIP712Domain({ domain }) {
    return [
        typeof domain?.name === 'string' && {
            name: 'name',
            type: 'string'
        },
        domain?.version && {
            name: 'version',
            type: 'string'
        },
        (typeof domain?.chainId === 'number' || typeof domain?.chainId === 'bigint') && {
            name: 'chainId',
            type: 'uint256'
        },
        domain?.verifyingContract && {
            name: 'verifyingContract',
            type: 'address'
        },
        domain?.salt && {
            name: 'salt',
            type: 'bytes32'
        }
    ].filter(Boolean);
}
function domainSeparator({ domain }) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$signature$2f$hashTypedData$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hashDomain"])({
        domain: domain,
        types: {
            EIP712Domain: getTypesForEIP712Domain({
                domain
            })
        }
    });
}
/** @internal */ function validateReference(type) {
    // Struct type must not be a Solidity type.
    if (type === 'address' || type === 'bool' || type === 'string' || type.startsWith('bytes') || type.startsWith('uint') || type.startsWith('int')) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$typedData$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["InvalidStructTypeError"]({
        type
    });
} //# sourceMappingURL=typedData.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/wallet/signTypedData.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "signTypedData",
    ()=>signTypedData
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/accounts/utils/parseAccount.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$account$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/account.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$typedData$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/typedData.js [app-client] (ecmascript)");
;
;
;
async function signTypedData(client, parameters) {
    const { account: account_ = client.account, domain, message, primaryType } = parameters;
    if (!account_) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$account$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AccountNotFoundError"]({
        docsPath: '/docs/actions/wallet/signTypedData'
    });
    const account = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["parseAccount"])(account_);
    const types = {
        EIP712Domain: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$typedData$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getTypesForEIP712Domain"])({
            domain
        }),
        ...parameters.types
    };
    // Need to do a runtime validation check on addresses, byte ranges, integer ranges, etc
    // as we can't statically check this with TypeScript.
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$typedData$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["validateTypedData"])({
        domain,
        message,
        primaryType,
        types
    });
    if (account.signTypedData) return account.signTypedData({
        domain,
        message,
        primaryType,
        types
    });
    const typedData = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$typedData$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["serializeTypedData"])({
        domain,
        message,
        primaryType,
        types
    });
    return client.request({
        method: 'eth_signTypedData_v4',
        params: [
            account.address,
            typedData
        ]
    }, {
        retryCount: 0
    });
} //# sourceMappingURL=signTypedData.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/wallet/switchChain.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "switchChain",
    ()=>switchChain
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/toHex.js [app-client] (ecmascript)");
;
async function switchChain(client, { id }) {
    await client.request({
        method: 'wallet_switchEthereumChain',
        params: [
            {
                chainId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberToHex"])(id)
            }
        ]
    }, {
        retryCount: 0
    });
} //# sourceMappingURL=switchChain.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/wallet/watchAsset.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Adds an EVM chain to the wallet.
 *
 * - Docs: https://viem.sh/docs/actions/wallet/watchAsset
 * - JSON-RPC Methods: [`eth_switchEthereumChain`](https://eips.ethereum.org/EIPS/eip-747)
 *
 * @param client - Client to use
 * @param parameters - {@link WatchAssetParameters}
 * @returns Boolean indicating if the token was successfully added. {@link WatchAssetReturnType}
 *
 * @example
 * import { createWalletClient, custom } from 'viem'
 * import { mainnet } from 'viem/chains'
 * import { watchAsset } from 'viem/wallet'
 *
 * const client = createWalletClient({
 *   chain: mainnet,
 *   transport: custom(window.ethereum),
 * })
 * const success = await watchAsset(client, {
 *   type: 'ERC20',
 *   options: {
 *     address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
 *     decimals: 18,
 *     symbol: 'WETH',
 *   },
 * })
 */ __turbopack_context__.s([
    "watchAsset",
    ()=>watchAsset
]);
async function watchAsset(client, params) {
    const added = await client.request({
        method: 'wallet_watchAsset',
        params
    }, {
        retryCount: 0
    });
    return added;
} //# sourceMappingURL=watchAsset.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/constants/solidity.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// https://docs.soliditylang.org/en/v0.8.16/control-structures.html#panic-via-assert-and-error-via-require
__turbopack_context__.s([
    "panicReasons",
    ()=>panicReasons,
    "solidityError",
    ()=>solidityError,
    "solidityPanic",
    ()=>solidityPanic
]);
const panicReasons = {
    1: 'An `assert` condition failed.',
    17: 'Arithmetic operation resulted in underflow or overflow.',
    18: 'Division or modulo by zero (e.g. `5 / 0` or `23 % 0`).',
    33: 'Attempted to convert to an invalid type.',
    34: 'Attempted to access a storage byte array that is incorrectly encoded.',
    49: 'Performed `.pop()` on an empty array',
    50: 'Array index is out of bounds.',
    65: 'Allocated too much memory or created an array which is too large.',
    81: 'Attempted to call a zero-initialized variable of internal function type.'
};
const solidityError = {
    inputs: [
        {
            name: 'message',
            type: 'string'
        }
    ],
    name: 'Error',
    type: 'error'
};
const solidityPanic = {
    inputs: [
        {
            name: 'reason',
            type: 'uint256'
        }
    ],
    name: 'Panic',
    type: 'error'
}; //# sourceMappingURL=solidity.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/encoding/fromBytes.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "bytesToBigInt",
    ()=>bytesToBigInt,
    "bytesToBool",
    ()=>bytesToBool,
    "bytesToNumber",
    ()=>bytesToNumber,
    "bytesToString",
    ()=>bytesToString,
    "fromBytes",
    ()=>fromBytes
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$encoding$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/encoding.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$trim$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/data/trim.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/fromHex.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/toHex.js [app-client] (ecmascript)");
;
;
;
;
function fromBytes(bytes, toOrOpts) {
    const opts = typeof toOrOpts === 'string' ? {
        to: toOrOpts
    } : toOrOpts;
    const to = opts.to;
    if (to === 'number') return bytesToNumber(bytes, opts);
    if (to === 'bigint') return bytesToBigInt(bytes, opts);
    if (to === 'boolean') return bytesToBool(bytes, opts);
    if (to === 'string') return bytesToString(bytes, opts);
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["bytesToHex"])(bytes, opts);
}
function bytesToBigInt(bytes, opts = {}) {
    if (typeof opts.size !== 'undefined') (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["assertSize"])(bytes, {
        size: opts.size
    });
    const hex = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["bytesToHex"])(bytes, opts);
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hexToBigInt"])(hex, opts);
}
function bytesToBool(bytes_, opts = {}) {
    let bytes = bytes_;
    if (typeof opts.size !== 'undefined') {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["assertSize"])(bytes, {
            size: opts.size
        });
        bytes = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$trim$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["trim"])(bytes);
    }
    if (bytes.length > 1 || bytes[0] > 1) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$encoding$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["InvalidBytesBooleanError"](bytes);
    return Boolean(bytes[0]);
}
function bytesToNumber(bytes, opts = {}) {
    if (typeof opts.size !== 'undefined') (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["assertSize"])(bytes, {
        size: opts.size
    });
    const hex = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["bytesToHex"])(bytes, opts);
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hexToNumber"])(hex, opts);
}
function bytesToString(bytes_, opts = {}) {
    let bytes = bytes_;
    if (typeof opts.size !== 'undefined') {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["assertSize"])(bytes, {
            size: opts.size
        });
        bytes = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$trim$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["trim"])(bytes, {
            dir: 'right'
        });
    }
    return new TextDecoder().decode(bytes);
} //# sourceMappingURL=fromBytes.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/abi/decodeAbiParameters.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "decodeAbiParameters",
    ()=>decodeAbiParameters
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/abi.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$getAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/address/getAddress.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$cursor$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/cursor.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$size$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/data/size.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$slice$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/data/slice.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$trim$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/data/trim.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromBytes$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/fromBytes.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toBytes$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/toBytes.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/encoding/toHex.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$encodeAbiParameters$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/abi/encodeAbiParameters.js [app-client] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
function decodeAbiParameters(params, data) {
    const bytes = typeof data === 'string' ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toBytes$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["hexToBytes"])(data) : data;
    const cursor = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$cursor$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createCursor"])(bytes);
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$size$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["size"])(bytes) === 0 && params.length > 0) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AbiDecodingZeroDataError"]();
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$size$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["size"])(data) && (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$size$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["size"])(data) < 32) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AbiDecodingDataSizeTooSmallError"]({
        data: typeof data === 'string' ? data : (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["bytesToHex"])(data),
        params: params,
        size: (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$size$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["size"])(data)
    });
    let consumed = 0;
    const values = [];
    for(let i = 0; i < params.length; ++i){
        const param = params[i];
        cursor.setPosition(consumed);
        const [data, consumed_] = decodeParameter(cursor, param, {
            staticPosition: 0
        });
        consumed += consumed_;
        values.push(data);
    }
    return values;
}
function decodeParameter(cursor, param, { staticPosition }) {
    const arrayComponents = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$encodeAbiParameters$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getArrayComponents"])(param.type);
    if (arrayComponents) {
        const [length, type] = arrayComponents;
        return decodeArray(cursor, {
            ...param,
            type
        }, {
            length,
            staticPosition
        });
    }
    if (param.type === 'tuple') return decodeTuple(cursor, param, {
        staticPosition
    });
    if (param.type === 'address') return decodeAddress(cursor);
    if (param.type === 'bool') return decodeBool(cursor);
    if (param.type.startsWith('bytes')) return decodeBytes(cursor, param, {
        staticPosition
    });
    if (param.type.startsWith('uint') || param.type.startsWith('int')) return decodeNumber(cursor, param);
    if (param.type === 'string') return decodeString(cursor, {
        staticPosition
    });
    throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["InvalidAbiDecodingTypeError"](param.type, {
        docsPath: '/docs/contract/decodeAbiParameters'
    });
}
////////////////////////////////////////////////////////////////////
// Type Decoders
const sizeOfLength = 32;
const sizeOfOffset = 32;
function decodeAddress(cursor) {
    const value = cursor.readBytes(32);
    return [
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$address$2f$getAddress$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["checksumAddress"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["bytesToHex"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$slice$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["sliceBytes"])(value, -20))),
        32
    ];
}
function decodeArray(cursor, param, { length, staticPosition }) {
    // If the length of the array is not known in advance (dynamic array),
    // this means we will need to wonder off to the pointer and decode.
    if (!length) {
        // Dealing with a dynamic type, so get the offset of the array data.
        const offset = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromBytes$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["bytesToNumber"])(cursor.readBytes(sizeOfOffset));
        // Start is the static position of current slot + offset.
        const start = staticPosition + offset;
        const startOfData = start + sizeOfLength;
        // Get the length of the array from the offset.
        cursor.setPosition(start);
        const length = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromBytes$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["bytesToNumber"])(cursor.readBytes(sizeOfLength));
        // Check if the array has any dynamic children.
        const dynamicChild = hasDynamicChild(param);
        let consumed = 0;
        const value = [];
        for(let i = 0; i < length; ++i){
            // If any of the children is dynamic, then all elements will be offset pointer, thus size of one slot (32 bytes).
            // Otherwise, elements will be the size of their encoding (consumed bytes).
            cursor.setPosition(startOfData + (dynamicChild ? i * 32 : consumed));
            const [data, consumed_] = decodeParameter(cursor, param, {
                staticPosition: startOfData
            });
            consumed += consumed_;
            value.push(data);
        }
        // As we have gone wondering, restore to the original position + next slot.
        cursor.setPosition(staticPosition + 32);
        return [
            value,
            32
        ];
    }
    // If the length of the array is known in advance,
    // and the length of an element deeply nested in the array is not known,
    // we need to decode the offset of the array data.
    if (hasDynamicChild(param)) {
        // Dealing with dynamic types, so get the offset of the array data.
        const offset = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromBytes$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["bytesToNumber"])(cursor.readBytes(sizeOfOffset));
        // Start is the static position of current slot + offset.
        const start = staticPosition + offset;
        const value = [];
        for(let i = 0; i < length; ++i){
            // Move cursor along to the next slot (next offset pointer).
            cursor.setPosition(start + i * 32);
            const [data] = decodeParameter(cursor, param, {
                staticPosition: start
            });
            value.push(data);
        }
        // As we have gone wondering, restore to the original position + next slot.
        cursor.setPosition(staticPosition + 32);
        return [
            value,
            32
        ];
    }
    // If the length of the array is known in advance and the array is deeply static,
    // then we can just decode each element in sequence.
    let consumed = 0;
    const value = [];
    for(let i = 0; i < length; ++i){
        const [data, consumed_] = decodeParameter(cursor, param, {
            staticPosition: staticPosition + consumed
        });
        consumed += consumed_;
        value.push(data);
    }
    return [
        value,
        consumed
    ];
}
function decodeBool(cursor) {
    return [
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromBytes$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["bytesToBool"])(cursor.readBytes(32), {
            size: 32
        }),
        32
    ];
}
function decodeBytes(cursor, param, { staticPosition }) {
    const [_, size] = param.type.split('bytes');
    if (!size) {
        // Dealing with dynamic types, so get the offset of the bytes data.
        const offset = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromBytes$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["bytesToNumber"])(cursor.readBytes(32));
        // Set position of the cursor to start of bytes data.
        cursor.setPosition(staticPosition + offset);
        const length = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromBytes$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["bytesToNumber"])(cursor.readBytes(32));
        // If there is no length, we have zero data.
        if (length === 0) {
            // As we have gone wondering, restore to the original position + next slot.
            cursor.setPosition(staticPosition + 32);
            return [
                '0x',
                32
            ];
        }
        const data = cursor.readBytes(length);
        // As we have gone wondering, restore to the original position + next slot.
        cursor.setPosition(staticPosition + 32);
        return [
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["bytesToHex"])(data),
            32
        ];
    }
    const value = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$toHex$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["bytesToHex"])(cursor.readBytes(Number.parseInt(size, 10), 32));
    return [
        value,
        32
    ];
}
function decodeNumber(cursor, param) {
    const signed = param.type.startsWith('int');
    const size = Number.parseInt(param.type.split('int')[1] || '256', 10);
    const value = cursor.readBytes(32);
    return [
        size > 48 ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromBytes$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["bytesToBigInt"])(value, {
            signed
        }) : (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromBytes$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["bytesToNumber"])(value, {
            signed
        }),
        32
    ];
}
function decodeTuple(cursor, param, { staticPosition }) {
    // Tuples can have unnamed components (i.e. they are arrays), so we must
    // determine whether the tuple is named or unnamed. In the case of a named
    // tuple, the value will be an object where each property is the name of the
    // component. In the case of an unnamed tuple, the value will be an array.
    const hasUnnamedChild = param.components.length === 0 || param.components.some(({ name })=>!name);
    // Initialize the value to an object or an array, depending on whether the
    // tuple is named or unnamed.
    const value = hasUnnamedChild ? [] : {};
    let consumed = 0;
    // If the tuple has a dynamic child, we must first decode the offset to the
    // tuple data.
    if (hasDynamicChild(param)) {
        // Dealing with dynamic types, so get the offset of the tuple data.
        const offset = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromBytes$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["bytesToNumber"])(cursor.readBytes(sizeOfOffset));
        // Start is the static position of referencing slot + offset.
        const start = staticPosition + offset;
        for(let i = 0; i < param.components.length; ++i){
            const component = param.components[i];
            cursor.setPosition(start + consumed);
            const [data, consumed_] = decodeParameter(cursor, component, {
                staticPosition: start
            });
            consumed += consumed_;
            value[hasUnnamedChild ? i : component?.name] = data;
        }
        // As we have gone wondering, restore to the original position + next slot.
        cursor.setPosition(staticPosition + 32);
        return [
            value,
            32
        ];
    }
    // If the tuple has static children, we can just decode each component
    // in sequence.
    for(let i = 0; i < param.components.length; ++i){
        const component = param.components[i];
        const [data, consumed_] = decodeParameter(cursor, component, {
            staticPosition
        });
        value[hasUnnamedChild ? i : component?.name] = data;
        consumed += consumed_;
    }
    return [
        value,
        consumed
    ];
}
function decodeString(cursor, { staticPosition }) {
    // Get offset to start of string data.
    const offset = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromBytes$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["bytesToNumber"])(cursor.readBytes(32));
    // Start is the static position of current slot + offset.
    const start = staticPosition + offset;
    cursor.setPosition(start);
    const length = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromBytes$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["bytesToNumber"])(cursor.readBytes(32));
    // If there is no length, we have zero data (empty string).
    if (length === 0) {
        cursor.setPosition(staticPosition + 32);
        return [
            '',
            32
        ];
    }
    const data = cursor.readBytes(length, 32);
    const value = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$encoding$2f$fromBytes$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["bytesToString"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$trim$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["trim"])(data));
    // As we have gone wondering, restore to the original position + next slot.
    cursor.setPosition(staticPosition + 32);
    return [
        value,
        32
    ];
}
function hasDynamicChild(param) {
    const { type } = param;
    if (type === 'string') return true;
    if (type === 'bytes') return true;
    if (type.endsWith('[]')) return true;
    if (type === 'tuple') return param.components?.some(hasDynamicChild);
    const arrayComponents = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$encodeAbiParameters$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getArrayComponents"])(param.type);
    if (arrayComponents && hasDynamicChild({
        ...param,
        type: arrayComponents[1]
    })) return true;
    return false;
} //# sourceMappingURL=decodeAbiParameters.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/abi/decodeErrorResult.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "decodeErrorResult",
    ()=>decodeErrorResult
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$constants$2f$solidity$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/constants/solidity.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/abi.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$slice$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/data/slice.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$toFunctionSelector$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/hash/toFunctionSelector.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$decodeAbiParameters$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/abi/decodeAbiParameters.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$formatAbiItem$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/abi/formatAbiItem.js [app-client] (ecmascript)");
;
;
;
;
;
;
function decodeErrorResult(parameters) {
    const { abi, data, cause } = parameters;
    const signature = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$slice$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["slice"])(data, 0, 4);
    if (signature === '0x') throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AbiDecodingZeroDataError"]({
        cause
    });
    const abi_ = [
        ...abi || [],
        __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$constants$2f$solidity$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["solidityError"],
        __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$constants$2f$solidity$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["solidityPanic"]
    ];
    const abiItem = abi_.find((x)=>x.type === 'error' && signature === (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$hash$2f$toFunctionSelector$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["toFunctionSelector"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$formatAbiItem$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatAbiItem"])(x)));
    if (!abiItem) throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AbiErrorSignatureNotFoundError"](signature, {
        docsPath: '/docs/contract/decodeErrorResult',
        cause
    });
    return {
        abiItem,
        args: 'inputs' in abiItem && abiItem.inputs && abiItem.inputs.length > 0 ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$decodeAbiParameters$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["decodeAbiParameters"])(abiItem.inputs, (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$data$2f$slice$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["slice"])(data, 4)) : undefined,
        errorName: abiItem.name
    };
} //# sourceMappingURL=decodeErrorResult.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/abi/formatAbiItemWithArgs.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "formatAbiItemWithArgs",
    ()=>formatAbiItemWithArgs
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$stringify$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/stringify.js [app-client] (ecmascript)");
;
function formatAbiItemWithArgs({ abiItem, args, includeFunctionName = true, includeName = false }) {
    if (!('name' in abiItem)) return;
    if (!('inputs' in abiItem)) return;
    if (!abiItem.inputs) return;
    return `${includeFunctionName ? abiItem.name : ''}(${abiItem.inputs.map((input, i)=>`${includeName && input.name ? `${input.name}: ` : ''}${typeof args[i] === 'object' ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$stringify$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["stringify"])(args[i]) : args[i]}`).join(', ')})`;
} //# sourceMappingURL=formatAbiItemWithArgs.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/errors/contract.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "CallExecutionError",
    ()=>CallExecutionError,
    "ContractFunctionExecutionError",
    ()=>ContractFunctionExecutionError,
    "ContractFunctionRevertedError",
    ()=>ContractFunctionRevertedError,
    "ContractFunctionZeroDataError",
    ()=>ContractFunctionZeroDataError,
    "CounterfactualDeploymentFailedError",
    ()=>CounterfactualDeploymentFailedError,
    "RawContractError",
    ()=>RawContractError
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/accounts/utils/parseAccount.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$constants$2f$solidity$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/constants/solidity.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$decodeErrorResult$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/abi/decodeErrorResult.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$formatAbiItem$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/abi/formatAbiItem.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$formatAbiItemWithArgs$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/abi/formatAbiItemWithArgs.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$getAbiItem$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/abi/getAbiItem.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$unit$2f$formatEther$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/unit/formatEther.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$unit$2f$formatGwei$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/unit/formatGwei.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/abi.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/base.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$stateOverride$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/stateOverride.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$transaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/transaction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/utils.js [app-client] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
;
;
;
class CallExecutionError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor(cause, { account: account_, docsPath, chain, data, gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas, nonce, to, value, stateOverride }){
        const account = account_ ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["parseAccount"])(account_) : undefined;
        let prettyArgs = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$transaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["prettyPrint"])({
            from: account?.address,
            to,
            value: typeof value !== 'undefined' && `${(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$unit$2f$formatEther$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatEther"])(value)} ${chain?.nativeCurrency?.symbol || 'ETH'}`,
            data,
            gas,
            gasPrice: typeof gasPrice !== 'undefined' && `${(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$unit$2f$formatGwei$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatGwei"])(gasPrice)} gwei`,
            maxFeePerGas: typeof maxFeePerGas !== 'undefined' && `${(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$unit$2f$formatGwei$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatGwei"])(maxFeePerGas)} gwei`,
            maxPriorityFeePerGas: typeof maxPriorityFeePerGas !== 'undefined' && `${(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$unit$2f$formatGwei$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatGwei"])(maxPriorityFeePerGas)} gwei`,
            nonce
        });
        if (stateOverride) {
            prettyArgs += `\n${(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$stateOverride$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["prettyStateOverride"])(stateOverride)}`;
        }
        super(cause.shortMessage, {
            cause,
            docsPath,
            metaMessages: [
                ...cause.metaMessages ? [
                    ...cause.metaMessages,
                    ' '
                ] : [],
                'Raw Call Arguments:',
                prettyArgs
            ].filter(Boolean),
            name: 'CallExecutionError'
        });
        Object.defineProperty(this, "cause", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.cause = cause;
    }
}
class ContractFunctionExecutionError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor(cause, { abi, args, contractAddress, docsPath, functionName, sender }){
        const abiItem = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$getAbiItem$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAbiItem"])({
            abi,
            args,
            name: functionName
        });
        const formattedArgs = abiItem ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$formatAbiItemWithArgs$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatAbiItemWithArgs"])({
            abiItem,
            args,
            includeFunctionName: false,
            includeName: false
        }) : undefined;
        const functionWithParams = abiItem ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$formatAbiItem$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatAbiItem"])(abiItem, {
            includeName: true
        }) : undefined;
        const prettyArgs = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$transaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["prettyPrint"])({
            address: contractAddress && (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$utils$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getContractAddress"])(contractAddress),
            function: functionWithParams,
            args: formattedArgs && formattedArgs !== '()' && `${[
                ...Array(functionName?.length ?? 0).keys()
            ].map(()=>' ').join('')}${formattedArgs}`,
            sender
        });
        super(cause.shortMessage || `An unknown error occurred while executing the contract function "${functionName}".`, {
            cause,
            docsPath,
            metaMessages: [
                ...cause.metaMessages ? [
                    ...cause.metaMessages,
                    ' '
                ] : [],
                prettyArgs && 'Contract Call:',
                prettyArgs
            ].filter(Boolean),
            name: 'ContractFunctionExecutionError'
        });
        Object.defineProperty(this, "abi", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "args", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "cause", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "contractAddress", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "formattedArgs", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "functionName", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "sender", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.abi = abi;
        this.args = args;
        this.cause = cause;
        this.contractAddress = contractAddress;
        this.functionName = functionName;
        this.sender = sender;
    }
}
class ContractFunctionRevertedError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor({ abi, data, functionName, message, cause: error }){
        let cause;
        let decodedData;
        let metaMessages;
        let reason;
        if (data && data !== '0x') {
            try {
                decodedData = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$decodeErrorResult$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["decodeErrorResult"])({
                    abi,
                    data,
                    cause: error
                });
                const { abiItem, errorName, args: errorArgs } = decodedData;
                if (errorName === 'Error') {
                    reason = errorArgs[0];
                } else if (errorName === 'Panic') {
                    const [firstArg] = errorArgs;
                    reason = __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$constants$2f$solidity$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["panicReasons"][firstArg];
                } else {
                    const errorWithParams = abiItem ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$formatAbiItem$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatAbiItem"])(abiItem, {
                        includeName: true
                    }) : undefined;
                    const formattedArgs = abiItem && errorArgs ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$formatAbiItemWithArgs$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatAbiItemWithArgs"])({
                        abiItem,
                        args: errorArgs,
                        includeFunctionName: false,
                        includeName: false
                    }) : undefined;
                    metaMessages = [
                        errorWithParams ? `Error: ${errorWithParams}` : '',
                        formattedArgs && formattedArgs !== '()' ? `       ${[
                            ...Array(errorName?.length ?? 0).keys()
                        ].map(()=>' ').join('')}${formattedArgs}` : ''
                    ];
                }
            } catch (err) {
                cause = err;
            }
        } else if (message) reason = message;
        let signature;
        if (cause instanceof __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AbiErrorSignatureNotFoundError"]) {
            signature = cause.signature;
            metaMessages = [
                `Unable to decode signature "${signature}" as it was not found on the provided ABI.`,
                'Make sure you are using the correct ABI and that the error exists on it.',
                `You can look up the decoded signature here: https://4byte.sourcify.dev/?q=${signature}.`
            ];
        }
        super(reason && reason !== 'execution reverted' || signature ? [
            `The contract function "${functionName}" reverted with the following ${signature ? 'signature' : 'reason'}:`,
            reason || signature
        ].join('\n') : `The contract function "${functionName}" reverted.`, {
            cause: cause ?? error,
            metaMessages,
            name: 'ContractFunctionRevertedError'
        });
        Object.defineProperty(this, "data", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "raw", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "reason", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "signature", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.data = decodedData;
        this.raw = data;
        this.reason = reason;
        this.signature = signature;
    }
}
class ContractFunctionZeroDataError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor({ functionName, cause }){
        super(`The contract function "${functionName}" returned no data ("0x").`, {
            metaMessages: [
                'This could be due to any of the following:',
                `  - The contract does not have the function "${functionName}",`,
                '  - The parameters passed to the contract function may be invalid, or',
                '  - The address is not a contract.'
            ],
            name: 'ContractFunctionZeroDataError',
            cause
        });
    }
}
class CounterfactualDeploymentFailedError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor({ factory }){
        super(`Deployment for counterfactual contract call failed${factory ? ` for factory "${factory}".` : ''}`, {
            metaMessages: [
                'Please ensure:',
                '- The `factory` is a valid contract deployment factory (ie. Create2 Factory, ERC-4337 Factory, etc).',
                '- The `factoryData` is a valid encoded function call for contract deployment function on the factory.'
            ],
            name: 'CounterfactualDeploymentFailedError'
        });
    }
}
class RawContractError extends __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] {
    constructor({ data, message }){
        super(message || '', {
            name: 'RawContractError'
        });
        Object.defineProperty(this, "code", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 3
        });
        Object.defineProperty(this, "data", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.data = data;
    }
} //# sourceMappingURL=contract.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/utils/errors/getContractError.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getContractError",
    ()=>getContractError
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/abi.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/base.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$contract$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/contract.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$request$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/request.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$rpc$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/rpc.js [app-client] (ecmascript)");
;
;
;
;
;
const EXECUTION_REVERTED_ERROR_CODE = 3;
function getContractError(err, { abi, address, args, docsPath, functionName, sender }) {
    const error = err instanceof __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$contract$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["RawContractError"] ? err : err instanceof __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$base$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["BaseError"] ? err.walk((err)=>'data' in err) || err.walk() : {};
    const { code, data, details, message, shortMessage } = error;
    const cause = (()=>{
        if (err instanceof __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$abi$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AbiDecodingZeroDataError"]) return new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$contract$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ContractFunctionZeroDataError"]({
            functionName,
            cause: err
        });
        if ([
            EXECUTION_REVERTED_ERROR_CODE,
            __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$rpc$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["InternalRpcError"].code
        ].includes(code) && (data || details || message || shortMessage) || code === __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$rpc$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["InvalidInputRpcError"].code && details === 'execution reverted' && data) {
            return new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$contract$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ContractFunctionRevertedError"]({
                abi,
                data: typeof data === 'object' ? data.data : data,
                functionName,
                message: error instanceof __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$request$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["RpcRequestError"] ? details : shortMessage ?? message,
                cause: err
            });
        }
        return err;
    })();
    return new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$contract$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["ContractFunctionExecutionError"](cause, {
        abi,
        args,
        contractAddress: address,
        docsPath,
        functionName,
        sender
    });
} //# sourceMappingURL=getContractError.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/wallet/writeContract.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "writeContract",
    ()=>writeContract
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/accounts/utils/parseAccount.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$account$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/errors/account.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$encodeFunctionData$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/abi/encodeFunctionData.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$errors$2f$getContractError$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/errors/getContractError.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/utils/getAction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendTransaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/sendTransaction.js [app-client] (ecmascript)");
;
;
;
;
;
;
async function writeContract(client, parameters) {
    return writeContract.internal(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendTransaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["sendTransaction"], 'sendTransaction', parameters);
}
(function(writeContract) {
    async function internal(client, actionFn, name, parameters) {
        const { abi, account: account_ = client.account, address, args, functionName, ...request } = parameters;
        if (typeof account_ === 'undefined') throw new __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$errors$2f$account$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AccountNotFoundError"]({
            docsPath: '/docs/contract/writeContract'
        });
        const account = account_ ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$accounts$2f$utils$2f$parseAccount$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["parseAccount"])(account_) : null;
        const data = (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$abi$2f$encodeFunctionData$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["encodeFunctionData"])({
            abi,
            args,
            functionName
        });
        try {
            return await (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$getAction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAction"])(client, actionFn, name)({
                data,
                to: address,
                account,
                ...request
            });
        } catch (error) {
            throw (0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$utils$2f$errors$2f$getContractError$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getContractError"])(error, {
                abi,
                address,
                args,
                docsPath: '/docs/contract/writeContract',
                functionName,
                sender: account?.address
            });
        }
    }
    writeContract.internal = internal;
})(writeContract || (writeContract = {})); //# sourceMappingURL=writeContract.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/actions/wallet/writeContractSync.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "writeContractSync",
    ()=>writeContractSync
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendTransactionSync$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/sendTransactionSync.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$writeContract$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/writeContract.js [app-client] (ecmascript)");
;
;
async function writeContractSync(client, parameters) {
    return __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$writeContract$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["writeContract"].internal(client, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendTransactionSync$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["sendTransactionSync"], 'sendTransactionSync', parameters);
} //# sourceMappingURL=writeContractSync.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/clients/decorators/wallet.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "walletActions",
    ()=>walletActions
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$fillTransaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/public/fillTransaction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getChainId$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/public/getChainId.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$addChain$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/addChain.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$deployContract$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/deployContract.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$getAddresses$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/getAddresses.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$getCallsStatus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/getCallsStatus.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$getCapabilities$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/getCapabilities.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$getPermissions$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/getPermissions.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$prepareAuthorization$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/prepareAuthorization.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$prepareTransactionRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/prepareTransactionRequest.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$requestAddresses$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/requestAddresses.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$requestPermissions$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/requestPermissions.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendCalls$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/sendCalls.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendCallsSync$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/sendCallsSync.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendRawTransaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/sendRawTransaction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendRawTransactionSync$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/sendRawTransactionSync.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendTransaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/sendTransaction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendTransactionSync$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/sendTransactionSync.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$showCallsStatus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/showCallsStatus.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$signAuthorization$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/signAuthorization.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$signMessage$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/signMessage.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$signTransaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/signTransaction.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$signTypedData$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/signTypedData.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$switchChain$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/switchChain.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$waitForCallsStatus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/waitForCallsStatus.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$watchAsset$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/watchAsset.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$writeContract$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/writeContract.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$writeContractSync$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/actions/wallet/writeContractSync.js [app-client] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
function walletActions(client) {
    return {
        addChain: (args)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$addChain$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["addChain"])(client, args),
        deployContract: (args)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$deployContract$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["deployContract"])(client, args),
        fillTransaction: (args)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$fillTransaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["fillTransaction"])(client, args),
        getAddresses: ()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$getAddresses$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getAddresses"])(client),
        getCallsStatus: (args)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$getCallsStatus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getCallsStatus"])(client, args),
        getCapabilities: (args)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$getCapabilities$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getCapabilities"])(client, args),
        getChainId: ()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$public$2f$getChainId$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getChainId"])(client),
        getPermissions: ()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$getPermissions$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getPermissions"])(client),
        prepareAuthorization: (args)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$prepareAuthorization$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["prepareAuthorization"])(client, args),
        prepareTransactionRequest: (args)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$prepareTransactionRequest$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["prepareTransactionRequest"])(client, args),
        requestAddresses: ()=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$requestAddresses$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["requestAddresses"])(client),
        requestPermissions: (args)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$requestPermissions$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["requestPermissions"])(client, args),
        sendCalls: (args)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendCalls$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["sendCalls"])(client, args),
        sendCallsSync: (args)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendCallsSync$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["sendCallsSync"])(client, args),
        sendRawTransaction: (args)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendRawTransaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["sendRawTransaction"])(client, args),
        sendRawTransactionSync: (args)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendRawTransactionSync$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["sendRawTransactionSync"])(client, args),
        sendTransaction: (args)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendTransaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["sendTransaction"])(client, args),
        sendTransactionSync: (args)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$sendTransactionSync$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["sendTransactionSync"])(client, args),
        showCallsStatus: (args)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$showCallsStatus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["showCallsStatus"])(client, args),
        signAuthorization: (args)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$signAuthorization$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["signAuthorization"])(client, args),
        signMessage: (args)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$signMessage$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["signMessage"])(client, args),
        signTransaction: (args)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$signTransaction$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["signTransaction"])(client, args),
        signTypedData: (args)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$signTypedData$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["signTypedData"])(client, args),
        switchChain: (args)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$switchChain$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["switchChain"])(client, args),
        waitForCallsStatus: (args)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$waitForCallsStatus$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["waitForCallsStatus"])(client, args),
        watchAsset: (args)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$watchAsset$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["watchAsset"])(client, args),
        writeContract: (args)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$writeContract$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["writeContract"])(client, args),
        writeContractSync: (args)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$actions$2f$wallet$2f$writeContractSync$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["writeContractSync"])(client, args)
    };
} //# sourceMappingURL=wallet.js.map
}),
"[project]/dashboard/node_modules/viem/_esm/clients/transports/custom.js [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "custom",
    ()=>custom
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$clients$2f$transports$2f$createTransport$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/dashboard/node_modules/viem/_esm/clients/transports/createTransport.js [app-client] (ecmascript)");
;
function custom(provider, config = {}) {
    const { key = 'custom', methods, name = 'Custom Provider', retryDelay } = config;
    return ({ retryCount: defaultRetryCount })=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$dashboard$2f$node_modules$2f$viem$2f$_esm$2f$clients$2f$transports$2f$createTransport$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["createTransport"])({
            key,
            methods,
            name,
            request: provider.request.bind(provider),
            retryCount: config.retryCount ?? defaultRetryCount,
            retryDelay,
            type: 'custom'
        });
} //# sourceMappingURL=custom.js.map
}),
]);

//# sourceMappingURL=9f1d4_viem__esm_154b09b7._.js.map