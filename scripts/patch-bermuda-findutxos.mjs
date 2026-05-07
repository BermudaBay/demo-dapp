/**
 * Bermuda SDK findUtxos performance patch (validated on v0.1.4).
 *
 * Default behavior on every call:
 *   - Queries chain from `snapshot.block` (overwritten by GitHub fetch),
 *     not from `utxoCache.block` — so it re-downloads events we've already seen.
 *   - Re-decrypts EVERY cached commitment event into `w` even though
 *     `f.utxos` already has the decrypted output. For pools with thousands
 *     of events this dominates wall time on each refresh.
 *   - Re-checks `isSpent` for each cached UTXO sequentially.
 *
 * Patched behavior:
 *   - Starts the chain query from `max(snapshot.block, utxoCache.block)` so
 *     the incremental query is always small.
 *   - Tracks `lastIndex` (highest commitment index processed) in a separate
 *     localStorage key so non-ours events aren't re-decrypted next time.
 *     Decrypts only events whose index > lastIndex.
 *   - Parallelizes `isSpent` checks via Promise.all.
 */
import fs from "fs";

const path = "node_modules/@bermuda/sdk/build/src/find-utxos.js";

if (!fs.existsSync(path)) {
  console.warn("patch-bermuda-findutxos: file not found, skip");
  process.exit(0);
}

const original = fs.readFileSync(path, "utf8");

// Bump the marker whenever the patch body changes so npm-installs against an
// already-patched node_modules upgrade in place rather than skipping.
const PATCH_MARKER = "BERMUDA_PATCH_FINDUTXOS_V2";
if (original.includes(PATCH_MARKER)) {
  console.log("✓ Bermuda SDK find-utxos.js already patched (V2)");
  process.exit(0);
}

// Rewrite findUtxos using the same imports as the original module.
const replacement = `import F from"./utxo.js";import P,{fileSystemStorage as _}from"./storage.js";import{CommitmentEventsKey as E,utxoDeserializer as W,utxoSerializer as X,fetchComplianceBlackList as z,hex as C,mergeFindUtxosResults as H,queryFilterBatched as q,sortDescByAmount as K,STX_DEPOSIT_COMPONENTS as M}from"./utils.js";
// BERMUDA_PATCH_FINDUTXOS_V2
function R(r,N){
  const O="utxos";
  const j=(m,a)=>{for(const d of Object.values(m))for(const p of d)p.keypair.pubkeyHash===a.pubkeyHash&&(p.keypair=a)};
  let L; if(r.fs&&r.utxoCache)L=_(r.utxoCache,r.fs);
  const T=P(r,L);
  // lastIndex key must include the pool address: when the SDK ships a new pool
  // (e.g. v0.1.2 -> v0.1.4 on base-sepolia) the previous max event index is
  // stale and would skip every event of the new pool. r.storagePrefix already
  // encodes "bermuda:<chainId>:<pool>".
  const lastIndexKey=(addr)=>\`\${r.storagePrefix}:lastIndex:\${addr.toLowerCase()}\`;
  const getLastIndex=(addr)=>{
    if(typeof globalThis.localStorage==="undefined")return -1n;
    const v=globalThis.localStorage.getItem(lastIndexKey(addr));
    return v?BigInt(v):-1n;
  };
  const setLastIndex=(addr,idx)=>{
    if(typeof globalThis.localStorage==="undefined")return;
    try{globalThis.localStorage.setItem(lastIndexKey(addr),idx.toString());}catch{}
  };
  // One-shot cleanup of the old pre-pool key — only relevant for users coming
  // from the previous patch revision; skipped after the first call per session.
  const legacyCleanedFlag=\`\${r.storagePrefix}:lastIndex:legacyCleaned\`;
  const cleanLegacy=(addr)=>{
    if(typeof globalThis.localStorage==="undefined")return;
    if(globalThis.localStorage.getItem(legacyCleanedFlag))return;
    try{
      globalThis.localStorage.removeItem(\`bermuda:lastIndex:\${r.chainId}:\${addr.toLowerCase()}\`);
      globalThis.localStorage.setItem(legacyCleanedFlag,"1");
    }catch{}
  };
  return {
    async findUtxos({pool:m=r.pool,keypair:a,tokens:d,excludeSpent:p=!0,excludeOthers:D=!0,from:l=r.startBlock}){
      const g=BigInt(r.chainId);
      const b=await a.address();
      cleanLegacy(b);
      let I=await N.populate("commitment-events",E);
      const f=T.get({namespace:O,key:b,deserializer:W})||{block:0n,utxos:{}};
      const cachedBlock=f.block>I.block?f.block:I.block;
      const v=cachedBlock!==0n?cachedBlock:l;
      const y=await r.provider.getBlockNumber().then(BigInt);
      let S=[];
      if(v<y){
        S=(await q(v,y,m,m.filters.NewCommitment())).map(i=>({commitment:i.args.commitment,index:i.args.index,encryptedOutput:i.args.encryptedOutput}));
      }
      I=N.upsert("commitment-events",E,{block:y,events:S});
      const lastIndex=getLastIndex(b);
      const w={};
      let maxIndex=lastIndex;
      for(const i of I.events){
        const eventIndex=BigInt(i.index);
        if(eventIndex<=lastIndex)continue;
        if(eventIndex>maxIndex)maxIndex=eventIndex;
        let e;
        try{e=(await F.decrypt(a,i.encryptedOutput,eventIndex,g)).utxo}catch{continue}
        if(!e||e.amount===0n)continue;
        if(D&&e.keypair.pubkeyHash!==a.pubkeyHash)continue;
        const o=C(e.token).toLowerCase();
        Array.isArray(w[o])?w[o].push(e):w[o]=[e];
      }
      setLastIndex(b,maxIndex);
      j(f.utxos,a);
      const merged=H(f.utxos,w);
      f.block=y; f.utxos=merged;
      T.set({namespace:O,key:b,value:f,serializer:X});
      let result=merged;
      if(p){
        result={};
        for(const[token,utxos]of Object.entries(merged)){
          const checks=await Promise.all(utxos.map(async(u)=>{
            const nf=await u.getNullifier().then(n=>C(n,32));
            return{utxo:u,spent:await m.isSpent(nf)};
          }));
          result[token]=checks.filter(c=>!c.spent).map(c=>c.utxo);
        }
      }
      if(d){
        const out={};
        for(const t of d){
          const k=t.toLowerCase();
          if(result[k])out[k]=result[k];
        }
        return out;
      }
      return result;
    },
    async findFlaggedUtxos({pool:m=r.pool,keypair:a,excludeSpent:d=!0,excludeOthers:p=!0,from:D=r.startBlock,token:l,excludeUtxos:g}){l=l.toLowerCase();const b=await this.findUtxos({pool:m,keypair:a,excludeSpent:d,excludeOthers:p,from:D,tokens:[l]}).then(x=>x[l]),I=new Set(g??[]),f=b.filter(x=>!I.has(x));if(f.length===0)throw new Error("No utxos found.");const v=await z(r.complianceManager),y=new Set;for(const x of v.blacklist)y.add(BigInt(x));const U=new Set;for(const x of f)for(let S=0;S<M;S++){if(x.subDepositAmounts[S]===0n)continue;const c=x.subDepositIds[S];y.has(c)&&U.add(x)}return{utxos:Array.from(U)}},
    async findUtxosUpTo({pool:m=r.pool,keypair:a,excludeSpent:d=!0,excludeOthers:p=!0,from:D=r.startBlock,token:l,amount:g,results:b=16,excludeUtxos:I,targetCompliant:f=!0}){l=l.toLowerCase();const v=await this.findUtxos({pool:m,keypair:a,excludeSpent:d,excludeOthers:p,from:D,tokens:[l]}).then(t=>K(t[l]).slice(0,16)),y=new Set(I??[]),U=v.filter(t=>!y.has(t));if(U.length===0)throw new Error("cannot cover amount with candidate utxos.");const S=U.slice(0,b).reduce((t,u)=>t+u.amount,0n)<g?U:U.slice(0,b);let w=0n,c=null;for(let t=0;t<S.length;t++)if(w+=S[t].amount,w>=g){c=S.slice(0,t+1);break}if(c===null)throw new Error("insufficient UTXOs");let B=new Set;const h=new Map;for(const t of c)for(let u=0;u<M;u++){if(t.subDepositAmounts[u]===0n)continue;const s=t.subDepositIds[u];B.add(s);const k=h.get(s);k===void 0?h.set(s,t.subDepositAmounts[u]):h.set(s,k+t.subDepositAmounts[u])}const A=[...B].map(t=>t.toString()).sort(),i=await z(r.complianceManager),e=A.filter(t=>!i.blacklist.includes(t)),o=A.filter(t=>i.blacklist.includes(t));if(f){if(o.length===0)return{utxos:c};const t=[...B].reduce((s,k)=>s+(h.get(k)??0n),0n),u=o.reduce((s,k)=>s+(h.get(BigInt(k))??0n),0n);if(t-u>=g)return{utxos:c,uncompliantDepositIds:o.map(s=>BigInt(s)),uncompliantAmounts:o.map(s=>h.get(BigInt(s))??0n)};const n=c.filter(s=>s.subDepositIds.some(k=>o.includes(k.toString())));return this.findUtxosUpTo({pool:m,keypair:a,excludeSpent:d,excludeOthers:p,from:D,token:l,amount:g,results:b,targetCompliant:f,excludeUtxos:[...I??[],...n]})}else{if(e.length===0)return{utxos:c};if(o.reduce((n,s)=>n+(h.get(BigInt(s))??0n),0n)>=g)return{utxos:c,uncompliantDepositIds:o.map(n=>BigInt(n)),uncompliantAmounts:o.map(n=>h.get(BigInt(n))??0n),compliantDepositIds:e.map(n=>BigInt(n)),compliantAmounts:e.map(n=>h.get(BigInt(n))??0n)};const u=c.filter(n=>n.subDepositIds.some(s=>e.includes(s.toString())));return this.findUtxosUpTo({pool:m,keypair:a,excludeSpent:d,excludeOthers:p,from:D,token:l,amount:g,results:b,targetCompliant:f,excludeUtxos:[...I??[],...u]})}}
  };
}
export{R as default};
`;

fs.writeFileSync(path, replacement);
console.log("✓ Patched Bermuda SDK find-utxos.js (skip re-decrypt + parallel isSpent)");
