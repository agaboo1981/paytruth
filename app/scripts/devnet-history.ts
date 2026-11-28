// Read-only devnet check for filter counts and per-invoice history (no transactions).
// Usage: npx tsx scripts/devnet-history.ts <wallet>[,<wallet>...] [<invoice> ...]
import { Connection, PublicKey } from '@solana/web3.js';

import { fetchInvoiceHistory } from '../components/ui/history/history';
import { fetchInvoicesFor, filterCounts, STATUS_FILTERS, type InvoiceRole } from '../components/ui/invoices/query';
import { formatUsdc } from '../components/ui/sdk/format';

const PROGRAM_ID = new PublicKey('D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H');
const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.devnet.solana.com';
if (rpc.includes('mainnet')) throw new Error('refusing mainnet');
const connection = new Connection(rpc, 'confirmed');

async function main() {
  const [walletsArg, ...invoices] = process.argv.slice(2);
  const now = BigInt(Math.floor(Date.now() / 1000));
  for (const w of walletsArg.split(',')) {
    for (const role of ['merchant', 'payer'] as InvoiceRole[]) {
      const rows = await fetchInvoicesFor(connection, PROGRAM_ID, role, new PublicKey(w));
      const c = filterCounts(rows, now, role);
      console.log(`${w} ${role === 'merchant' ? 'Created by me' : 'Paid by me'}: ` + STATUS_FILTERS.map((f) => `${f.label}=${c[f.id]}`).join(' | '));
    }
  }
  for (const i of invoices) {
    const r = await fetchInvoiceHistory(connection, PROGRAM_ID, new PublicKey(i));
    console.log(`\nHistory ${i}: ${r.signatures} signature(s), ${r.requests} RPC request(s), ${r.entries.length} entr(y/ies)${r.truncated ? ' (truncated)' : ''}`);
    for (const e of r.entries) {
      const t = e.blockTime ? new Date(e.blockTime * 1000).toISOString() : '?';
      const amt = e.amount === null ? '-' : `${e.amount < 0n ? '-' : '+'}${formatUsdc(e.amount < 0n ? -e.amount : e.amount)} [${e.amountSource}]`;
      console.log(`  ${t} ${e.ok ? 'OK    ' : 'FAILED'} ${e.action.padEnd(19)} ${e.label.padEnd(30)} ${amt.padEnd(28)} https://explorer.solana.com/tx/${e.signature}?cluster=devnet`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
