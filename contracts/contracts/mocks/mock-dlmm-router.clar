;; Simnet stand-in for SP1PFR4V08H1RAZXREBGFFQ59WB739XM8VVGTFSEA.dlmm-swap-router-v-1-1
;; swap-y-for-x-simple-multi. x = STX, y = sBTC. Simplified: one active bin at a fixed
;; price with a capacity; input above capacity is left with the user (partial fill),
;; which is the behaviour the real router has when bins run out. 50 bps fee.
(define-constant ERR_MINIMUM_RECEIVED (err u2003))
(define-constant PRICE_SCALE u100000000)
;; uSTX per sat scaled by PRICE_SCALE: 3055 uSTX per sat on 2026-09-05
(define-data-var price uint u305500000000)
(define-data-var capacity-sats uint u100000000)
(define-data-var fee-bips uint u50)
(define-data-var calls uint u0)

(define-public (set-price (p uint)) (ok (var-set price p)))
(define-public (set-capacity (c uint)) (ok (var-set capacity-sats c)))
(define-read-only (get-calls) (var-get calls))

(define-read-only (quote (y-amount uint))
  (let (
      (taken (if (> y-amount (var-get capacity-sats)) (var-get capacity-sats) y-amount))
      (fee (/ (* taken (var-get fee-bips)) u10000))
      (out (/ (* (- taken fee) (var-get price)) PRICE_SCALE))
    )
    {in: taken, out: out}))

(define-public (swap-y-for-x-simple-multi (pool principal) (x-token principal) (y-token principal) (y-amount uint) (min-dx uint))
  (let (
      (user tx-sender)
      (q (quote y-amount))
      (taken (get in q))
      (out (get out q))
    )
    (asserts! (>= out min-dx) ERR_MINIMUM_RECEIVED)
    (try! (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token transfer taken user (as-contract tx-sender) none))
    (try! (as-contract (stx-transfer? out tx-sender user)))
    (var-set calls (+ (var-get calls) u1))
    (ok {in: taken, out: out})))
