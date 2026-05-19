/**
 * Bermuda SDK: attach recipient `note` (memo) to transfer output UTXOs.
 * Upstream buildTransferInputsOutputs drops note when constructing outputs.
 *
 * v0.1.5 still ships minified strategy.js with the same three patterns —
 * we use exact substring replacements. If any pattern stops matching upstream,
 * the script no-ops with a warning rather than corrupting the file.
 */
import fs from "fs";

const path = "node_modules/@bermuda/sdk/build/src/strategy.js";

if (!fs.existsSync(path)) {
  console.warn("patch-bermuda-strategy-memo: strategy.js not found, skip");
  process.exit(0);
}

let s = fs.readFileSync(path, "utf8");

if (s.includes("BERMUDA_MEMO_PATCH")) {
  console.log("✓ Bermuda SDK strategy.js memo patch already applied");
  process.exit(0);
}

// 1) Recipient specs in M(): include optional note on each h.push entry
const recipientLoop =
  "for(let e=0;e<s.recipients.length;e++)h.push({amount:s.recipients[e].amount,keypair:q.fromAddress(s.recipients[e].to),requiresCompliant:!0});";
const recipientLoopPatched =
  "for(let e=0;e<s.recipients.length;e++){const __r=s.recipients[e],__h={amount:__r.amount,keypair:q.fromAddress(__r.to),requiresCompliant:!0};__r.note!=null&&__r.note!==\"\"&&(__h.note=__r.note),h.push(__h)}/*BERMUDA_MEMO_PATCH*/";

// 2) P(): first allocation chunk for each output carries the memo
const allocPush =
  "for(let o=0;o<c.length;o++){const i=c[o];for(const a of p[o])u.push({amount:a.amount,keypair:i.keypair}),e.push({subDepositIds:a.subDepositIds,subDepositAmounts:a.subDepositAmounts})}";
const allocPushPatched =
  "for(let o=0;o<c.length;o++){const i=c[o];let __f=!0;for(const a of p[o]){const __u={amount:a.amount,keypair:i.keypair};__f&&i.note!=null&&i.note!==\"\"&&(__u.note=i.note),u.push(__u),__f=!1,e.push({subDepositIds:a.subDepositIds,subDepositAmounts:a.subDepositAmounts})}}";

// 3) M(): pass note into Utxo constructor when present on merged output spec
const utxoMap =
  "u=w.map((e,p)=>{const r=t[p];return new v({token:m,chainId:l,keypair:e.keypair,amount:e.amount,subDepositIds:r.subDepositIds,subDepositAmounts:r.subDepositAmounts})})";
const utxoMapPatched =
  "u=w.map((e,p)=>{const r=t[p],__o={token:m,chainId:l,keypair:e.keypair,amount:e.amount,subDepositIds:r.subDepositIds,subDepositAmounts:r.subDepositAmounts};return e.note!=null&&e.note!==\"\"&&(__o.note=e.note),new v(__o)})";

if (!s.includes(recipientLoop)) {
  console.warn(
    "patch-bermuda-strategy-memo: recipient loop pattern not found; SDK may have changed",
  );
  process.exit(0);
}
s = s.replace(recipientLoop, recipientLoopPatched);

if (!s.includes(allocPush)) {
  console.warn(
    "patch-bermuda-strategy-memo: allocation push loop pattern not found; SDK may have changed",
  );
  process.exit(0);
}
s = s.replace(allocPush, allocPushPatched);

if (!s.includes(utxoMap)) {
  console.warn(
    "patch-bermuda-strategy-memo: Utxo map pattern not found; SDK may have changed",
  );
  process.exit(0);
}
s = s.replace(utxoMap, utxoMapPatched);

fs.writeFileSync(path, s);
console.log("✓ Patched Bermuda SDK strategy.js to preserve transfer memos on outputs");
