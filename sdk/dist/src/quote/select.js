import { DLMM_MIN_OUTPUT_USTX } from "../config.js";
export { DLMM_MIN_OUTPUT_USTX };
// Highest output wins; DLMM (pool 3) is skipped when the best non-DLMM output is small, because its
// bin walk costs more runtime than a small swap saves; ties break by STX reserve (deeper pool).
export function selectPool(quotes, _minOut) {
    const live = quotes.filter((q) => q.out > 0n);
    if (live.length === 0)
        throw new Error("no pool can quote this amount");
    const bestOther = live.filter((q) => q.poolId !== 3).reduce((m, q) => (q.out > m ? q.out : m), 0n);
    const eligible = live.filter((q) => q.poolId !== 3 || bestOther === 0n || bestOther >= DLMM_MIN_OUTPUT_USTX);
    return eligible.sort((a, b) => {
        if (a.out !== b.out)
            return a.out > b.out ? -1 : 1;
        if (a.reserveStx !== b.reserveStx)
            return a.reserveStx > b.reserveStx ? -1 : 1;
        return a.poolId - b.poolId;
    })[0];
}
//# sourceMappingURL=select.js.map