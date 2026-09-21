import { DLMM_MIN_OUTPUT_USTX } from "../config.js";
export { DLMM_MIN_OUTPUT_USTX };
export interface Selectable {
    poolId: number;
    out: bigint;
    reserveStx: bigint;
    partial?: boolean;
}
export declare function selectPool<T extends Selectable>(quotes: T[], _minOut: bigint): T;
