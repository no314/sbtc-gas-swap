// Structural mirrors of the Leather swap provider contract as of leather-io/mono PR #2554
// (head adedaac5d, 2026-08-31, branch feat/swaps), files:
//   packages/services/src/swap/swap-provider.interface.ts
//   packages/models/src/swap/swap.model.ts
// Mirrored on purpose: this package must not depend on the mono packages. When integrating,
// replace these with the real imports; the shapes are field-compatible. Money is reduced to
// { amount: bigint; decimals: number; symbol: string } here; mono's Money carries a BigNumber.
export {};
//# sourceMappingURL=types.js.map