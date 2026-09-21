export const PRICE_SCALE = 100000000n;
export const FEE_SCALE = 10000n;
export const ROUTER_MAX_BINS = 350;
export function quoteDlmm(s, inSats) {
    let remaining = inSats;
    let out = 0n;
    let binsUsed = 0;
    let firstPrice = null;
    const bins = [...s.bins].sort((a, b) => a.binId - b.binId).filter((b) => b.binId >= s.activeBinId);
    for (const bin of bins) {
        if (remaining === 0n || binsUsed >= ROUTER_MAX_BINS)
            break;
        binsUsed++;
        if (bin.xBalance === 0n && bin.yBalance === 0n)
            continue;
        if (firstPrice === null)
            firstPrice = bin.price;
        const maxY = (bin.xBalance * bin.price + PRICE_SCALE - 1n) / PRICE_SCALE;
        const updatedMaxY = s.feeBips > 0n ? (maxY * FEE_SCALE) / (FEE_SCALE - s.feeBips) : maxY;
        const used = remaining >= updatedMaxY ? updatedMaxY : remaining;
        const feeTotal = (used * s.feeBips) / FEE_SCALE;
        const dy = used - feeTotal;
        const dxBeforeCap = (dy * PRICE_SCALE) / bin.price;
        const dx = dxBeforeCap > bin.xBalance ? bin.xBalance : dxBeforeCap;
        out += dx;
        remaining -= used;
    }
    const taken = inSats - remaining;
    const reserveStx = s.bins.reduce((acc, b) => acc + b.xBalance, 0n);
    const feeSats = (taken * s.feeBips) / FEE_SCALE;
    // impact versus the active bin price
    let impactBips = 0n;
    if (firstPrice && taken > 0n) {
        const atFirst = ((taken - feeSats) * PRICE_SCALE) / firstPrice;
        impactBips = atFirst > 0n ? ((atFirst - out) * 10000n) / atFirst : 0n;
    }
    return { poolId: 3, in: taken, out, feeSats, impactBips, reserveStx, binsUsed, partial: remaining > 0n, ...(out === 0n ? { reason: "no-liquidity" } : {}) };
}
//# sourceMappingURL=dlmm.js.map