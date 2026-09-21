import { type TierName } from "./config.js";
export interface RelayInfo {
    url: string;
    contract: string;
    network: string;
    sponsors: Record<TierName, string>;
    minTier: TierName;
    feeEstimate: Record<TierName, string>;
    feeFactor: number;
    maxPerOriginPerHour: number;
    termsUrl?: string;
    version: string;
}
export interface RelayCandidate {
    url: string;
    info?: RelayInfo;
    error?: string;
}
export interface SubmitOk {
    ok: true;
    txid: string;
    relay: string;
    fee: string;
    tier: string;
    sponsor: string;
    sponsoredTx: string;
}
export interface SubmitFail {
    ok: false;
    attempts: {
        relay: string;
        code: string;
        message: string;
    }[];
}
export declare const DEFAULT_SPONSORS_URL = "https://stackslabs.github.io/sbtc-gas-swap/sponsors.json";
export interface RelayClientOptions {
    fetch?: typeof fetch;
    sponsorsUrl?: string;
    relays?: string[];
    timeoutMs?: number;
}
export declare class RelayClient {
    private readonly f;
    private readonly sponsorsUrl;
    private readonly fixed?;
    private readonly timeoutMs;
    constructor(o?: RelayClientOptions);
    private get;
    listUrls(): Promise<string[]>;
    discover(): Promise<RelayCandidate[]>;
    static rank(candidates: RelayCandidate[], tier: TierName): RelayInfo[];
    submit(signedTxHex: string, relays: RelayInfo[]): Promise<SubmitOk | SubmitFail>;
}
