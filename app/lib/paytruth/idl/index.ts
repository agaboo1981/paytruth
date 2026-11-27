// GENERATED from sdk/src by `pnpm sync:app` — do not edit here.
// Next 14 SWC does not yet support `with { type: 'json' }`, so use a plain
// JSON import. This stays the single swap point: to re-swap, copy a new
// target/idl/paytruth.json and target/types/paytruth.ts into this directory.
import idl from './paytruth.json';

export interface PaytruthIdlAccount {
  name: string;
  writable?: boolean;
  signer?: boolean;
  optional?: boolean;
  address?: string;
  pda?: { seeds: unknown[] };
}

export interface PaytruthIdlInstruction {
  name: string;
  discriminator: number[];
  accounts: PaytruthIdlAccount[];
  args: { name: string; type: unknown }[];
}

export interface PaytruthIdlAccountDef {
  name: string;
  discriminator: number[];
}

export interface PaytruthIdlEventDef {
  name: string;
  discriminator: number[];
}

export interface PaytruthIdlError {
  code: number;
  name: string;
  msg: string;
}

export interface PaytruthIdlType {
  name: string;
  type: { kind: 'struct'; fields: { name: string; type: unknown }[] };
}

export interface PaytruthIdl {
  address: string;
  metadata: { name: string; version: string; spec: string };
  instructions: PaytruthIdlInstruction[];
  accounts: PaytruthIdlAccountDef[];
  events: PaytruthIdlEventDef[];
  errors: PaytruthIdlError[];
  types: PaytruthIdlType[];
}

/**
 * The only module that imports the IDL JSON. A re-swap is a one-line change
 * to the import above; all other modules read the IDL through here.
 */
export const PAYTRUTH_IDL = idl as unknown as PaytruthIdl;

export const IDL_SOURCE = 'anchor-4252df8' as const;
