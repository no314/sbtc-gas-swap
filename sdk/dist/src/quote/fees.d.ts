export interface FeeSplit {
    serviceFee: bigint;
    integratorFee: bigint;
    net: bigint;
}
export declare function splitFees(amountSats: bigint, integratorBips: bigint): FeeSplit;
