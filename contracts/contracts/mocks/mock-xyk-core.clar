;; Simnet stand-in for SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.xyk-core-v-1-2 swap-x-for-y.
;; Same arithmetic as the deployed core (integer floors, protocol + provider fee in bips),
;; same asserts and error codes. Pulls x (sBTC) from tx-sender, pays y (STX) from this
;; contract's own balance so tests can assert the flow. Reserves are settable.
(define-constant BPS u10000)
(define-constant ERR_INVALID_AMOUNT (err u1002))
(define-constant ERR_MINIMUM_Y_AMOUNT (err u1020))
(define-constant ERR_POOL_DISABLED (err u1010))

(define-data-var x-balance uint u44730224)        ;; sats, mainnet 2026-09-05
(define-data-var y-balance uint u136671025817)    ;; uSTX, mainnet 2026-09-05
(define-data-var protocol-fee uint u10)
(define-data-var provider-fee uint u40)
(define-data-var enabled bool true)
(define-data-var calls uint u0)

(define-public (set-reserves (x uint) (y uint))
  (ok (begin (var-set x-balance x) (var-set y-balance y))))
(define-public (set-fees (protocol uint) (provider uint))
  (ok (begin (var-set protocol-fee protocol) (var-set provider-fee provider))))
(define-public (set-enabled (on bool)) (ok (var-set enabled on)))
(define-read-only (get-calls) (var-get calls))
(define-read-only (get-reserves) {x-balance: (var-get x-balance), y-balance: (var-get y-balance)})

(define-read-only (quote-dy (x-amount uint))
  (let (
      (fp (/ (* x-amount (var-get protocol-fee)) BPS))
      (fv (/ (* x-amount (var-get provider-fee)) BPS))
      (dx (- x-amount (+ fp fv)))
    )
    (/ (* (var-get y-balance) dx) (+ (var-get x-balance) dx))))

(define-public (swap-x-for-y (pool principal) (x-token principal) (y-token principal) (x-amount uint) (min-dy uint))
  (let (
      (caller tx-sender)
      (fp (/ (* x-amount (var-get protocol-fee)) BPS))
      (fv (/ (* x-amount (var-get provider-fee)) BPS))
      (dx (- x-amount (+ fp fv)))
      (dy (quote-dy x-amount))
    )
    (asserts! (var-get enabled) ERR_POOL_DISABLED)
    (asserts! (> x-amount u0) ERR_INVALID_AMOUNT)
    (asserts! (> min-dy u0) ERR_INVALID_AMOUNT)
    (asserts! (>= dy min-dy) ERR_MINIMUM_Y_AMOUNT)
    (try! (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token transfer x-amount caller (as-contract tx-sender) none))
    (try! (as-contract (stx-transfer? dy tx-sender caller)))
    (var-set x-balance (+ (var-get x-balance) dx fv))
    (var-set y-balance (- (var-get y-balance) dy))
    (var-set calls (+ (var-get calls) u1))
    (ok dy)))
