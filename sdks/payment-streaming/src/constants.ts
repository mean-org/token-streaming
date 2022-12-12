import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

/** Address of the Payment Streaming program in mainnet */
export const PAYMENT_STREAMING_PROGRAM_ID = new PublicKey(
  'MSPCUMbLfy2MeT6geLMMzrUkv1Tx88XRApaVRdyxTuu',
);

/** Address of the Payment Streaming program in devnet */
export const PAYMENT_STREAMING_PROGRAM_ID_DEVNET = new PublicKey(
  'MSPdQo5ZdrPh6rU1LsvUv5nRhAnj1mj6YQEqBUq8YwZ',
);

export const FEE_ACCOUNT = new PublicKey(
  '3TD6SWY9M1mLY2kZWJNavPLhwXvcRsWdnZLRaMzERJBw',
);

export const CLIFF_PERCENT_NUMERATOR = 10_000;
export const CLIFF_PERCENT_DENOMINATOR = 1_000_000;

/**
 * Dummy account used to configure the Anchor wallet in order to use
 * program getters by parsing the logs of a simulation. This account
 * needs to exist in the blockchain (i.e. needs to have SOL balance)
 * to avoid a SimulateError (AccountNotFound). No signing is done with
 * this account.
 */
export const SIMULATION_PUBKEY = new PublicKey(
  '3KmMEv7A8R3MMhScQceXBQe69qLmnFfxSM3q8HyzkrSx',
);

/** Internal convention to identify the intention to use NATIVE sol and not SPL wSOL */
export const NATIVE_SOL_MINT = new PublicKey(
  'So11111111111111111111111111111111111111111',
);

/** Current version number that needs to be set as argument when creating any
 * transaction of the Payment Streaming program */
export const LATEST_IDL_FILE_VERSION = 5;

export enum WARNING_TYPES {
  NO_WARNING = 0,
  INVALID_ADDRESS = 1,
  WARNING = 2,
}

// Re-export some constants
export const SYSTEM_PROGRAM_ID = SystemProgram.programId;
export { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, SYSVAR_RENT_PUBKEY };

/**
 * Constants
 * @deprecated Deprecated since v3.2.0. Please use exported constants instead.
 */
export class Constants {
  /** @deprecated Deprecated in v3.2.0. Please use {@link FEE_ACCOUNT} instead. */
  static FEE_TREASURY = new PublicKey(
    '3TD6SWY9M1mLY2kZWJNavPLhwXvcRsWdnZLRaMzERJBw',
  );
  static TREASURY_SIZE = 300;
  static STREAM_SIZE = 500;
  /**
   * 0-100 percentage values should be multiplied by this value before being
   * passed as argument to program instructions.
   */
  static CLIFF_PERCENT_NUMERATOR = 10_000;
  static CLIFF_PERCENT_DENOMINATOR = 1_000_000;
  static MAX_TX_SIZE = 1200;
  // This is an internal convention to identify the intention to use NATIVE sol and not SPL wSOL
  /** @deprecated Deprecated in v3.2.0. Please use {@link NATIVE_SOL_MINT} */
  static SOL_MINT = new PublicKey('11111111111111111111111111111111');
  static READONLY_PUBKEY = new PublicKey(
    '3KmMEv7A8R3MMhScQceXBQe69qLmnFfxSM3q8HyzkrSx',
  );
}
