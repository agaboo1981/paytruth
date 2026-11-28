// Read-only devnet check: runs the same getProgramAccounts query the /invoices page uses.
// Usage: npx tsx scripts/devnet-invoices.ts <wallet> [<wallet> ...]
import { Connection, PublicKey } from '@solana/web3.js';

import { classifyInvoice, fetchInvoicesFor, GROUP_ORDER, type InvoiceRole } from '../components/ui/invoices/query';
import { decodeMemo } from '../components/ui/sdk/format';

const PROGRAM_ID = new PublicKey('D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H');
const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.devnet.solana.com';
if (rpc.includes('mainnet')) throw new Error('refusing mainnet');
const connection = new Connection(rpc, 'confirmed');

async function main() {
  const now = BigInt(Math.floor(Date.now() / 1000));
  for (const w of process.argv.slice(2)) {
    const wallet = new PublicKey(w);
    for (const role of ['merchant', 'payer'] as InvoiceRole[]) {
      const rows = await fetchInvoicesFor(connection, PROGRAM_ID, role, wallet);
      const counts: Record<string, number> = { 'needs-action': 0, open: 0, done: 0 };
      console.log(`\n${w} as ${role}: ${rows.length} invoice(s)`);
      for (const r of rows) {
        const s = classifyInvoice(r.invoice, now, role);
        counts[s.group] += 1;
        console.log(`  [${s.group}] ${r.pda.toBase58()} status=${r.invoice.status} payer=${r.invoice.payer.toBase58()} claimed=${r.invoice.claimed} due=${r.invoice.amountDue} paid=${r.invoice.paidAmount} refunded=${r.invoice.refundedExcess} "${decodeMemo(r.invoice.memo)}" -> ${s.label}`);
      }
      console.log('  counts:', GROUP_ORDER.map((g) => `${g}=${counts[g]}`).join(' '));
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
