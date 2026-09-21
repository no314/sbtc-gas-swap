;; Simnet stand-in for SP20X3DC5R091J8B6YPQT638J8NR1W83KN6TN5BJY.univ2-pool-v1_0_0-0070 swap.
;; token0 = wstx (STX), token1 = sBTC. Same arithmetic as the deployed pool and
;; univ2-fees-0070: amt-in-adjusted = amt-in * 9970 / 10000, out = r_out * adj / (r_in + adj).
;; Single precondition error like the original.
(define-constant ERR_SWAP_PRECONDITIONS (err u107))
(define-data-var reserve0 uint u212869098374)   ;; uSTX, mainnet 2026-09-05
(define-data-var reserve1 uint u69663360)       ;; sats, mainnet 2026-09-05
(define-constant FEE_NUM u9970)
(define-data-var calls uint u0)

(define-public (set-reserves (r0 uint) (r1 uint))
  (ok (begin (var-set reserve0 r0) (var-set reserve1 r1))))
(define-read-only (get-calls) (var-get calls))
(define-read-only (get-reserves) {reserve0: (var-get reserve0), reserve1: (var-get reserve1)})

(define-read-only (quote-out (amt-in uint))
  (let ((adj (/ (* amt-in FEE_NUM) u10000)))
    (/ (* (var-get reserve0) adj) (+ (var-get reserve1) adj))))

;; sBTC in (token1), STX out (token0)
(define-public (swap (token-in principal) (token-out principal) (fees principal) (amt-in uint) (amt-out-desired uint))
  (let (
      (user tx-sender)
      (adj (/ (* amt-in FEE_NUM) u10000))
      (amt-out (quote-out amt-in))
    )
    (asserts! (and (> amt-in u0) (> amt-out-desired u0) (> adj u0) (>= amt-out amt-out-desired)) ERR_SWAP_PRECONDITIONS)
    (try! (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token transfer amt-in user (as-contract tx-sender) none))
    (try! (as-contract (stx-transfer? amt-out tx-sender user)))
    (var-set reserve0 (- (var-get reserve0) amt-out))
    (var-set reserve1 (+ (var-get reserve1) adj))
    (var-set calls (+ (var-get calls) u1))
    (ok {op: "swap", user: user, amt-in: amt-in, amt-out-desired: amt-out-desired, amt-out: amt-out, amt-in-adjusted: adj})))
