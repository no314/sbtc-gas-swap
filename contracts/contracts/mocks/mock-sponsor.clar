;; Simnet stand-in for tx-sponsor?, which simnet cannot set.
;; The simnet build of sbtc-gas-swap-v1 reads the sponsor from here.
(define-data-var sponsor (optional principal) none)
(define-public (set-sponsor (who (optional principal)))
  (ok (var-set sponsor who)))
(define-read-only (get-sponsor) (var-get sponsor))
