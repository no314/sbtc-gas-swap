#!/usr/bin/env node
// Sponsor key generation. One 24-word seed phrase, Leather-compatible (BIP39, Stacks derivation
// m/44'/5757'/0'/0/i), so the sponsor wallet can be restored in Leather at any time.
// Account 1 = LOW, account 2 = MID, account 3 = HIGH. Nothing is written to disk.
//
//   npm run keygen                         # new seed phrase and the three accounts
//   MNEMONIC="word1 ... word24" npm run keygen -- --from-mnemonic [--accounts 4]
//                                          # re-derive accounts from an existing seed phrase
//                                          # (also how to get the private key of a Leather account,
//                                          #  for example the dust-swap user: account N in Leather = index N-1)
import { generateSecretKey, generateWallet, generateNewAccount } from "@stacks/wallet-sdk";
import { getAddressFromPrivateKey } from "@stacks/transactions";

const args = process.argv.slice(2);
const fromMnemonic = args.includes("--from-mnemonic");
const nIdx = args.indexOf("--accounts");
const count = nIdx >= 0 ? Number(args[nIdx + 1]) : 3;
const mnemonic = fromMnemonic ? (process.env.MNEMONIC ?? "").trim() : generateSecretKey(256);
if (fromMnemonic && mnemonic.split(/\s+/).length < 12) { console.error("MNEMONIC must hold the 12 or 24 word seed phrase"); process.exit(1); }

let wallet = await generateWallet({ secretKey: mnemonic, password: "" });
while (wallet.accounts.length < count) wallet = generateNewAccount(wallet);
const accounts = wallet.accounts.map((a, i) => ({ index: i, leatherAccount: i + 1, address: getAddressFromPrivateKey(a.stxPrivateKey, "mainnet"), key: a.stxPrivateKey }));

const tiers = ["LOW", "MID", "HIGH"];
const funding = { LOW: "2 STX", MID: "5 STX", HIGH: "10 STX" };
console.log(fromMnemonic ? "# Accounts derived from the given seed phrase" : "# NEW sponsor wallet. Store the seed phrase in your password manager; it restores all three accounts in Leather.");
console.log(`# Seed phrase (${mnemonic.split(/\s+/).length} words):`);
console.log(mnemonic);
console.log();
for (const a of accounts) {
  const tier = tiers[a.index];
  const label = tier ? `${tier} sponsor (Leather account ${a.leatherAccount})` : `account ${a.leatherAccount}`;
  console.log(`# ${label}`);
  console.log(`#   address: ${a.address}${tier ? `   fund with ${funding[tier]}` : ""}`);
  console.log(`#   key:     ${a.key}`);
  if (tier) console.log(`npx wrangler secret put SPONSOR_KEY_${tier}   # paste the key above when asked`);
  console.log();
}
console.log("# Fund the three addresses before deploying. Keys are shown once; nothing was written to disk.");
