#!/usr/bin/env node
/**
 * Initialize Paytruth Config on devnet immediately after program deploy.
 *
 * Never prints keypair / secret material. Refuses mainnet URLs.
 *
 * Usage:
 *   WEB3JS_PATH=/path/to/@solana/web3.js node initialize-config.mjs \
 *     --url https://api.devnet.solana.com \
 *     --wallet ~/.config/solana/paytruth-devnet-deployer.json \
 *     --mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
 *     --program-id D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H \
 *     --config-pda C9nFHNFgdTZ27PTz4pvrjxgmkWVyng4RNVFcpc4xLEPx
 */

import { createRequire } from "module";
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { homedir } from "os";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {
    url: "https://api.devnet.solana.com",
    wallet: join(homedir(), ".config/solana/paytruth-devnet-deployer.json"),
    mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    programId: "D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H",
    configPda: "C9nFHNFgdTZ27PTz4pvrjxgmkWVyng4RNVFcpc4xLEPx",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) die(`Missing value for ${a}`);
      return argv[++i];
    };
    if (a === "--url") out.url = next();
    else if (a === "--wallet") out.wallet = next();
    else if (a === "--mint") out.mint = next();
    else if (a === "--program-id") out.programId = next();
    else if (a === "--config-pda") out.configPda = next();
    else if (a === "--help" || a === "-h") {
      console.log("See file header for usage.");
      process.exit(0);
    } else die(`Unknown argument: ${a}`);
  }
  return out;
}

function assertDevnet(url) {
  const u = String(url).toLowerCase();
  if (u.includes("mainnet")) {
    die(`Refusing to run against mainnet URL: ${url}`);
  }
  const ok =
    u === "devnet" ||
    u.includes("devnet") ||
    u.includes("localhost") ||
    u.includes("127.0.0.1");
  if (!ok) {
    die(`Refusing URL that is not clearly devnet/local: ${url}`);
  }
}

function loadWeb3() {
  const candidates = [
    process.env.WEB3JS_PATH,
    join(repoRoot, "sdk/node_modules/@solana/web3.js"),
    join(repoRoot, "node_modules/@solana/web3.js"),
    join(scriptDir, "node_modules/@solana/web3.js"),
  ].filter(Boolean);

  for (const c of candidates) {
    const pkg = c.endsWith("web3.js") ? c : join(c, "@solana/web3.js");
    const pkgJson = join(pkg, "package.json");
    if (!existsSync(pkgJson)) continue;
    const require = createRequire(pkgJson);
    return require(pkg);
  }
  try {
    const require = createRequire(import.meta.url);
    return require("@solana/web3.js");
  } catch (e) {
    die(
      "Cannot find @solana/web3.js. Set WEB3JS_PATH to the package directory, or install it under sdk/node_modules.",
    );
  }
}

const args = parseArgs(process.argv.slice(2));
assertDevnet(args.url);

const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} = loadWeb3();

const INIT_DISCRIMINATOR = Buffer.from([208, 127, 21, 1, 194, 190, 196, 70]);
const CONFIG_DISCRIMINATOR = Buffer.from([155, 12, 170, 224, 30, 250, 204, 130]);
const CONFIG_SEED = Buffer.from("config");

const walletPath = resolve(args.wallet.replace(/^~/, homedir()));
if (!existsSync(walletPath)) die(`Wallet file not found: ${walletPath}`);

let authority;
try {
  const raw = JSON.parse(readFileSync(walletPath, "utf8"));
  if (!Array.isArray(raw)) die("Wallet file is not a Solana JSON keypair array.");
  authority = Keypair.fromSecretKey(Uint8Array.from(raw));
} catch (e) {
  die(`Failed to load wallet (not printing contents): ${e.message}`);
}

const programId = new PublicKey(args.programId);
const usdcMint = new PublicKey(args.mint);
const expectedConfig = new PublicKey(args.configPda);
const [derivedConfig] = PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
if (!derivedConfig.equals(expectedConfig)) {
  die(
    `Config PDA mismatch: derived ${derivedConfig.toBase58()} != expected ${expectedConfig.toBase58()}`,
  );
}

const authorityPk = authority.publicKey.toBase58();
console.log("Cluster:", args.url);
console.log("Program ID:", programId.toBase58());
console.log("Authority pubkey:", authorityPk);
console.log("USDC mint:", usdcMint.toBase58());
console.log("Config PDA:", derivedConfig.toBase58());

const connection = new Connection(args.url, "confirmed");

const existing = await connection.getAccountInfo(derivedConfig, "confirmed");
if (existing) {
  console.log("Config account already exists; will decode and verify, not re-initialize.");
} else {
  const data = Buffer.concat([INIT_DISCRIMINATOR, usdcMint.toBuffer()]);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: derivedConfig, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [authority], {
    commitment: "confirmed",
  });
  console.log("initialize_config signature:", sig);
  console.log(
    "explorer:",
    `https://explorer.solana.com/tx/${sig}?cluster=devnet`,
  );
}

const info = await connection.getAccountInfo(derivedConfig, "confirmed");
if (!info) die("Config account missing after initialize_config.");
if (!info.owner.equals(programId)) {
  die(`Config owner mismatch: ${info.owner.toBase58()} != ${programId.toBase58()}`);
}
if (info.data.length !== 73) {
  die(`Config account size ${info.data.length} != 73`);
}
if (!info.data.subarray(0, 8).equals(CONFIG_DISCRIMINATOR)) {
  die("Config discriminator mismatch.");
}

const gotAuthority = new PublicKey(info.data.subarray(8, 40)).toBase58();
const gotMint = new PublicKey(info.data.subarray(40, 72)).toBase58();
const gotBump = info.data[72];

console.log("Config.authority:", gotAuthority);
console.log("Config.usdc_mint:", gotMint);
console.log("Config.bump:", gotBump);

const errors = [];
if (gotAuthority !== authorityPk) {
  errors.push(`authority ${gotAuthority} != signer ${authorityPk}`);
}
if (gotMint !== usdcMint.toBase58()) {
  errors.push(`usdc_mint ${gotMint} != ${usdcMint.toBase58()}`);
}
if (errors.length) die("Config verification failed: " + errors.join("; "));
console.log("Config verification: OK");
