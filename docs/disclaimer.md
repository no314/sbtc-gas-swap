# Disclaimer

Published at `https://stx.fan/zero_to/gas/disclaimer.html` and referenced by the relay as `termsUrl`. This file mirrors the page; the page is the version users read.

sBTC to Stacks gas is published on stx.fan as open source software. It, the sbtc-gas-swap-v1 contract it calls, and any relay that sponsors transactions for it are provided as is, without warranty of any kind. Read this page before swapping. If you do not agree with it, do not use the app.

**No warranty.** The software, the contract, the documentation, and any relay are provided as is and as available, without warranty of any kind, express or implied, including any warranty of merchantability, fitness for a particular purpose, title, or non-infringement. Nothing here is a guarantee of sponsorship, execution, price, availability, or fitness for your purpose.

**Your responsibility.** You use this software at your own risk. All responsibility for using it rests with the user or the integrator. You decide the swap amount, the tier, and the slippage; you review the post-conditions in your wallet before signing; you accept that pool prices move between the quote and the mined transaction. stx.fan does not hold your assets at any point and cannot recover a swap you did not intend.

**Relays may refuse.** A relay operator may refuse any transaction for any reason, at any time, without notice: because the fee market moved, because a rate limit was reached, because the sponsor key is out of funds, or for no stated reason. A refusal costs you nothing; a refused transaction was never broadcast. Anyone may run a relay from the public source. Each relay is the responsibility of whoever operates it, and listing a relay in this app is not an endorsement of it.

**The contract is immutable.** The swap contract is deployed on the Stacks mainnet and cannot be changed. Its fee rate and its list of pools are fixed. Once a swap is mined, nobody can reverse it: not stx.fan, not a relay operator, not the contract owner. It cannot be refunded or its result altered. A swap that aborts on chain moves nothing.

**Fees.** Every swap pays three fees inside the transaction, all shown on the review screen before you sign: a network fee in STX to the sponsor who paid for the transaction, a default provider fee of 0.5 percent of the sBTC input, and an integrator fee of 1 percent of the sBTC input to the publisher of this page. The amounts are fixed by the contract call you sign and cannot change afterwards.

**Not legal, financial, or tax advice.** Nothing in this app, its documentation, or its source code is legal, financial, investment, or tax advice. Swapping one digital asset for another may have tax consequences and carries the risk of loss. Consult your own advisers.

**Limitation of liability.** To the fullest extent permitted by applicable law, the publisher of this page, the contract deployer, and any relay operator are not liable for any loss or damage arising from your use of this software, including loss of digital assets, lost profits, or consequential damages, however caused. Where a limitation of liability is not permitted, liability is limited to the smallest amount the applicable law allows.

## Why there is no governing law clause

stx.fan is a website, not a legal entity, and has no seat. A governing law clause names a jurisdiction on behalf of a party that can be sued there; naming one here would assert something that is not true. Without the clause, a dispute falls under whatever law applies to the parties involved by default. The limitation of liability is written to bend to that law rather than to override it, which is the strongest form such a clause can take without a jurisdiction to anchor it.
