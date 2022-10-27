import { PublicKey, Keypair, Connection, SystemProgram } from '@solana/web3.js';
import { AnchorProvider, web3 } from '@project-serum/anchor';
export const LATEST_IDL_FILE_VERSION = 5;
export const DECIMALS = 6;
export const TREASURY_TYPE_OPEN = 0;
export const TREASURY_TYPE_LOCKED = 1;
export const MSP_FEES_PUBKEY = new PublicKey('3TD6SWY9M1mLY2kZWJNavPLhwXvcRsWdnZLRaMzERJBw');
export const SYSTEM_PROGRAM_ID = SystemProgram.programId;
export const SYSVAR_RENT_PUBKEY = web3.SYSVAR_RENT_PUBKEY;

export const URL = process.env.ANCHOR_PROVIDER_URL as string;
if (URL === undefined) {
    throw new Error('ANCHOR_PROVIDER_URL is not defined');
}
export const CONFIRM_OPTIONS = AnchorProvider.defaultOptions();
