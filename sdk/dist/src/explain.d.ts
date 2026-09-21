export interface Explanation {
    title: string;
    action: string;
    retryable: boolean;
}
export declare function explainRelayError(code: string): Explanation;
export declare function explainTxFailure(status: string, result?: string): Explanation;
