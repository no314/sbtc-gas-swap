;; sbtc-gas-swap-v1
;;
;; Sponsored sBTC to STX swap where the sponsor is repaid inside the transaction.
;;
;; The user (tx-sender) holds sBTC and no STX. A sponsor co-signs the transaction
;; and pays the network fee. Inside this call:
;;   b  service fee     50 bips of `amount` in sBTC to `fee-recipient`
;;   c  integrator fee  0..100 bips of `amount` in sBTC to `integrator` (optional)
;;      the remaining sBTC is swapped to STX through one whitelisted pool
;;   a  rebate          `tier` uSTX from the user to the sponsor (the tx-sponsor keyword)
;; The user keeps the swapped STX minus the rebate.
;;
;; The contract never holds assets: every transfer is from tx-sender or from the
;; pool to tx-sender. The rate (FEE_BIPS) and the pool whitelist are immutable.
;; Only `fee-recipient` and `owner` can change, by the owner.
;;
;; Error codes are documented in docs/contract.md.

;; --- constants: fees and tiers
(define-constant FEE_BIPS u50)
(define-constant BIPS_DENOM u10000)
(define-constant MAX_INTEGRATOR_BIPS u100)
(define-constant TIER_LOW u10000)      ;; 0.01 STX
(define-constant TIER_MID u100000)     ;; 0.1 STX
(define-constant TIER_HIGH u1000000)   ;; 1 STX

;; --- constants: pool ids
(define-constant POOL_BITFLOW_XYK u1)
(define-constant POOL_VELAR u2)
(define-constant POOL_BITFLOW_DLMM u3)

;; --- errors
(define-constant ERR_NOT_OWNER (err u100))
(define-constant ERR_NOT_SPONSORED (err u101))
(define-constant ERR_BAD_AMOUNT (err u102))
(define-constant ERR_BAD_TIER (err u103))
(define-constant ERR_MIN_OUT_BELOW_TIER (err u104))
(define-constant ERR_UNKNOWN_POOL (err u105))
(define-constant ERR_BAD_BIPS (err u106))
(define-constant ERR_NET_ZERO (err u107))
(define-constant ERR_RECEIVED_BELOW_MIN (err u108))
(define-constant ERR_SAME_PRINCIPAL (err u109))

;; --- state
(define-data-var owner principal tx-sender)
(define-data-var fee-recipient principal tx-sender)

;; --- read-only

(define-read-only (get-owner) (var-get owner))
(define-read-only (get-fee-recipient) (var-get fee-recipient))

(define-read-only (get-config)
  {
    fee-bips: FEE_BIPS,
    max-integrator-bips: MAX_INTEGRATOR_BIPS,
    tiers: (list TIER_LOW TIER_MID TIER_HIGH),
    pools: (list POOL_BITFLOW_XYK POOL_VELAR POOL_BITFLOW_DLMM),
    fee-recipient: (var-get fee-recipient),
    owner: (var-get owner)
  }
)

(define-read-only (is-valid-tier (tier uint))
  (or (is-eq tier TIER_LOW) (is-eq tier TIER_MID) (is-eq tier TIER_HIGH))
)

(define-read-only (is-known-pool (pool-id uint))
  (or (is-eq pool-id POOL_BITFLOW_XYK) (is-eq pool-id POOL_VELAR) (is-eq pool-id POOL_BITFLOW_DLMM))
)

;; Fee split for a given input. Integrators call this through call-read.
(define-read-only (quote-fees (amount uint) (integrator-bips uint))
  (let (
      (service-fee (/ (* amount FEE_BIPS) BIPS_DENOM))
      (integrator-fee (/ (* amount integrator-bips) BIPS_DENOM))
    )
    (if (> integrator-bips MAX_INTEGRATOR_BIPS)
      ERR_BAD_BIPS
      (ok {
        service-fee: service-fee,
        integrator-fee: integrator-fee,
        net: (- amount (+ service-fee integrator-fee))
      })
    )
  )
)

;; --- owner functions

(define-public (set-fee-recipient (new-recipient principal))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR_NOT_OWNER)
    (var-set fee-recipient new-recipient)
    (print {topic: "set-fee-recipient", fee-recipient: new-recipient, by: tx-sender})
    (ok true)
  )
)

(define-public (transfer-ownership (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR_NOT_OWNER)
    (var-set owner new-owner)
    (print {topic: "transfer-ownership", owner: new-owner, by: tx-sender})
    (ok true)
  )
)

;; --- the swap

(define-public (swap-sbtc-for-gas
    (amount uint)
    (tier uint)
    (min-out uint)
    (pool-id uint)
    (integrator (optional principal))
    (integrator-bips uint)
  )
  (let (
      (user tx-sender)
      (sponsor (unwrap! (sponsor-principal) ERR_NOT_SPONSORED))
      (bips (match integrator i integrator-bips u0))
      (service-fee (/ (* amount FEE_BIPS) BIPS_DENOM))
      (integrator-fee (/ (* amount bips) BIPS_DENOM))
      (net (- amount (+ service-fee integrator-fee)))
    )
    (asserts! (> amount u0) ERR_BAD_AMOUNT)
    (asserts! (is-valid-tier tier) ERR_BAD_TIER)
    (asserts! (>= min-out tier) ERR_MIN_OUT_BELOW_TIER)
    (asserts! (is-known-pool pool-id) ERR_UNKNOWN_POOL)
    (asserts! (<= integrator-bips MAX_INTEGRATOR_BIPS) ERR_BAD_BIPS)
    (asserts! (> net u0) ERR_NET_ZERO)
    (asserts! (not (is-eq user sponsor)) ERR_SAME_PRINCIPAL)

    ;; b: service fee in sBTC
    (if (> service-fee u0)
      (try! (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
        transfer service-fee user (var-get fee-recipient) none))
      true
    )

    ;; c: integrator fee in sBTC
    (match integrator i
      (if (> integrator-fee u0)
        (try! (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
          transfer integrator-fee user i none))
        true
      )
      true
    )

    ;; swap net sBTC to STX through the selected pool
    (let (
        (received (try! (swap-through-pool pool-id net min-out)))
      )
      (asserts! (>= received min-out) ERR_RECEIVED_BELOW_MIN)

      ;; a: rebate to the sponsor, in STX, from the user
      (try! (stx-transfer? tier user sponsor))

      (print {
        topic: "swap-sbtc-for-gas",
        user: user,
        sponsor: sponsor,
        amount: amount,
        pool-id: pool-id,
        received: received,
        rebate: tier,
        service-fee: service-fee,
        integrator-fee: integrator-fee,
        integrator: integrator,
        min-out: min-out
      })
      (ok {
        received: received,
        rebate: tier,
        service-fee: service-fee,
        integrator-fee: integrator-fee,
        pool-id: pool-id
      })
    )
  )
)

;; --- private

;; Who pays the network fee. In simnet builds this is substituted by a mock.
(define-private (sponsor-principal)
  tx-sponsor?
)

;; One branch per whitelisted pool. Each pool pulls sBTC from tx-sender and pays
;; STX to tx-sender; this contract holds nothing.
(define-private (swap-through-pool (pool-id uint) (net uint) (min-out uint))
  (if (is-eq pool-id POOL_BITFLOW_XYK)
    (swap-bitflow-xyk net min-out)
    (if (is-eq pool-id POOL_VELAR)
      (swap-velar net min-out)
      (swap-bitflow-dlmm net min-out)
    )
  )
)

;; Bitflow XYK: x = sBTC, y = STX (token-stx-v-1-2). Returns dy in uSTX.
(define-private (swap-bitflow-xyk (net uint) (min-out uint))
  (contract-call? 'SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.xyk-core-v-1-2 swap-x-for-y
    'SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.xyk-pool-sbtc-stx-v-1-1
    'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
    'SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.token-stx-v-1-2
    net min-out)
)

;; Velar univ2 pool 70: token0 = wstx, token1 = sBTC. Returns amt-out in uSTX.
(define-private (swap-velar (net uint) (min-out uint))
  (let (
      (result (try! (contract-call? 'SP20X3DC5R091J8B6YPQT638J8NR1W83KN6TN5BJY.univ2-pool-v1_0_0-0070 swap
        'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
        'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx
        'SP20X3DC5R091J8B6YPQT638J8NR1W83KN6TN5BJY.univ2-fees-v1_0_0-0070
        net min-out)))
    )
    (ok (get amt-out result))
  )
)

;; Bitflow DLMM: x = STX (token-stx-v-1-2), y = sBTC, so sBTC in is swap-y-for-x.
;; Returns out in uSTX. `in` may be below net when bins run out; the router still
;; enforces min-out on the output.
(define-private (swap-bitflow-dlmm (net uint) (min-out uint))
  (let (
      (result (try! (contract-call? 'SP1PFR4V08H1RAZXREBGFFQ59WB739XM8VVGTFSEA.dlmm-swap-router-v-1-1 swap-y-for-x-simple-multi
        'SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-stx-sbtc-v-2-bps-15
        'SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.token-stx-v-1-2
        'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
        net min-out)))
    )
    (ok (get out result))
  )
)
