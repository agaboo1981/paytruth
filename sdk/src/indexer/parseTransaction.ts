import { BorshEventCoder, BorshInstructionCoder } from '@anchor-lang/core';
import {
  MessageV0,
  PublicKey,
  VersionedMessage,
  type TransactionResponse,
  type VersionedTransactionResponse,
} from '@solana/web3.js';
import { PAYTRUTH_IDL } from '../idl';
import { mapError, type MappedError } from '../errors';

const ixCoder = new BorshInstructionCoder(PAYTRUTH_IDL as never);
const eventCoder = new BorshEventCoder(PAYTRUTH_IDL as never);

export interface ParsedInstruction {
  name: string;
  args: Record<string, unknown>;
  accounts: string[];
}

export interface ParsedEvent {
  name: string;
  data: Record<string, unknown>;
}

export interface ParsedPaytruthTx {
  signature: string;
  slot: number;
  blockTime: number | null;
  ok: boolean;
  instructions: ParsedInstruction[];
  events: ParsedEvent[];
  error?: MappedError;
}

type AnyTxResponse = VersionedTransactionResponse | TransactionResponse;

function decodeMessage(raw: AnyTxResponse): {
  keys: PublicKey[];
  instructions: { programIdIndex: number; accounts: number[]; data: string }[];
} | null {
  const tx = raw.transaction as unknown as { message: unknown };
  let versioned: VersionedMessage | null = null;
  let staticKeys: PublicKey[] = [];

  try {
    const messageField = tx.message;
    if (messageField && typeof messageField === 'object' && 'serialize' in (messageField as object)) {
      const msg = messageField as VersionedMessage;
      versioned = VersionedMessage.deserialize(Buffer.from(msg.serialize()));
      staticKeys = [...versioned.staticAccountKeys];
    } else if (typeof messageField === 'string') {
      versioned = VersionedMessage.deserialize(Buffer.from(messageField, 'base64'));
      staticKeys = [...versioned.staticAccountKeys];
    } else {
      // Legacy Transaction with a compile-able message
      const legacy = tx as unknown as import('@solana/web3.js').Transaction;
      const message = legacy.compileMessage();
      return {
        keys: message.accountKeys,
        instructions: message.instructions.map((ci) => ({
          programIdIndex: ci.programIdIndex,
          accounts: [...ci.accounts],
          data: ci.data,
        })),
      };
    }
  } catch {
    return null;
  }

  if (!versioned) return null;
  const keys = [...staticKeys];
  if (versioned instanceof MessageV0) {
    const loaded = raw.meta?.loadedAddresses;
    if (loaded) keys.push(...loaded.writable, ...loaded.readonly);
  }
  return {
    keys,
    instructions: versioned.compiledInstructions.map((ci) => ({
      programIdIndex: ci.programIdIndex,
      accounts: [...ci.accountKeyIndexes],
      data: Buffer.from(ci.data).toString('base64'),
    })),
  };
}

function accountKeysFromMeta(raw: AnyTxResponse): PublicKey[] | null {
  const msg = decodeMessage(raw);
  return msg?.keys ?? null;
}

function mapAccounts(
  keys: PublicKey[],
  accountIndexes: number[],
  idlAccounts: { name: string }[],
): string[] {
  return idlAccounts.map((acc, i) => {
    const idx = accountIndexes[i];
    if (idx === undefined) return '';
    const key = keys[idx];
    return key ? key.toBase58() : '';
  });
}

/**
 * Parse a getTransaction response for Paytruth instructions and events.
 * Tolerant of legacy and v0 messages. Decodes "Program data:" event logs.
 */
export function parseTransaction(raw: AnyTxResponse | null, programId: PublicKey): ParsedPaytruthTx {
  const signature = raw?.transaction.signatures?.[0] ?? '';
  if (!raw) {
    return { signature, slot: 0, blockTime: null, ok: false, instructions: [], events: [] };
  }

  const ok = raw.meta?.err == null;
  const slot = raw.slot ?? 0;
  const blockTime = raw.blockTime ?? null;
  const decoded = decodeMessage(raw);
  const keys = decoded?.keys ?? accountKeysFromMeta(raw) ?? [];

  const instructions: ParsedInstruction[] = [];
  if (decoded) {
    const idlByName = new Map(PAYTRUTH_IDL.instructions.map((i) => [i.name, i]));
    for (const ci of decoded.instructions) {
      const programKey = keys[ci.programIdIndex];
      if (!programKey || !programKey.equals(programId)) continue;
      try {
        const data = Buffer.from(ci.data, 'base64');
        const decodedIx = ixCoder.decode(data);
        if (!decodedIx) continue;
        const idlIx = idlByName.get(decodedIx.name);
        const accounts = idlIx ? mapAccounts(keys, ci.accounts, idlIx.accounts) : [];
        instructions.push({
          name: decodedIx.name,
          args: decodedIx.data as Record<string, unknown>,
          accounts,
        });
      } catch {
        // ignore undecodable instruction
      }
    }
  }

  const events: ParsedEvent[] = [];
  for (const line of raw.meta?.logMessages ?? []) {
    if (!line.startsWith('Program data: ')) continue;
    const payload = line.slice('Program data: '.length);
    try {
      const decoded = eventCoder.decode(payload);
      if (decoded) events.push({ name: decoded.name, data: decoded.data as Record<string, unknown> });
    } catch {
      // ignore
    }
  }

  const result: ParsedPaytruthTx = { signature, slot, blockTime, ok, instructions, events };
  if (!ok) {
    result.error = mapError({ err: raw.meta?.err, logs: raw.meta?.logMessages ?? [] });
  }
  return result;
}
