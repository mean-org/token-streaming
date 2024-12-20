import {
  Connection,
  Keypair,
  PublicKey,
  Signer,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import BN from 'bn.js';
import BigNumber from 'bignumber.js';
import {
  createAssociatedTokenAccountIdempotent,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token';

const FAILED_TO_FIND_ACCOUNT = 'Failed to find account';
const INVALID_ACCOUNT_OWNER = 'Invalid account owner';

export const toBuffer = (arr: Buffer | Uint8Array | Array<number>): Buffer => {
  if (Buffer.isBuffer(arr)) {
    return arr;
  } else if (arr instanceof Uint8Array) {
    return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  } else {
    return Buffer.from(arr);
  }
};

export const getDefaultKeyPair = async (): Promise<Keypair> => {
  // const id = await fs.readJSON(join(homedir(), '.config/solana/id.json'));
  // const bytes = Uint8Array.from(id);
  // return Keypair.fromSecretKey(bytes);

  return Keypair.generate();
};

export const _printSerializedTx = (
  tx: Transaction,
  requireAllSignatures = false,
  verifySignatures = false,
) => {
  console.log(
    tx
      .serialize({
        requireAllSignatures,
        verifySignatures,
      })
      .toString('base64'),
  );
};

export function sleep(ms: number) {
  console.log('Sleeping for', ms / 1000, 'seconds');
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const makeDecimal = (bn: BN, decimals: number): number => {
  return Number(bn.toString()) / Math.pow(10, decimals);
};

export const toTokenAmountBn = (amount: number | string, decimals: number) => {
  // if (!amount || !decimals) {
  //   return new BN(0);
  // }

  const multiplier = new BigNumber(10 ** decimals);
  const value = new BigNumber(amount);
  const result = value.multipliedBy(multiplier).integerValue();
  const toFixed = result.toFixed(0);
  return new BN(toFixed);
};

/**
 * Retrieve the associated account or create one if not found.
 *
 * This account may then be used as a transfer destination
 *
 * @param connection A solana connection to use
 * @param feePayer Payer of fees
 * @param mint token Public key of the mint to be user to retrieve token account for
 * @param destinationOwner User account that will own the new account
 * @return The new associated account
 */
export const getOrCreateAssociatedAccountInfo = async (
  connection: Connection,
  feePayer: Signer,
  mint: PublicKey,
  destinationOwner: PublicKey,
  allowOwnerOffCurve?: boolean,
) => {
  const associatedAddress = await getAssociatedTokenAddress(
    mint,
    destinationOwner,
    allowOwnerOffCurve,
  );

  // This is the optimum logic, considering TX fee, client-side computation,
  // RPC roundtrips and guaranteed idempotent.
  // Sadly we can't do this atomically;
  try {
    return await getAccount(connection, associatedAddress);
  } catch (err: any) {
    // INVALID_ACCOUNT_OWNER can be possible if the associatedAddress has
    // already been received some lamports (= became system accounts).
    // Assuming program derived addressing is safe, this is the only case
    // for the INVALID_ACCOUNT_OWNER in this code-path
    if (
      err.message === FAILED_TO_FIND_ACCOUNT ||
      err.message === INVALID_ACCOUNT_OWNER
    ) {
      // as this isn't atomic, it's possible others can create associated
      // accounts meanwhile
      try {
        await createAssociatedTokenAccountIdempotent(
          connection,
          feePayer,
          mint,
          destinationOwner,
        );
      } catch (err) {
        // ignore all errors; for now there is no API compatible way to
        // selectively ignore the expected instruction error if the
        // associated account is existing already.
      }

      // Now this should always succeed
      return await getAccount(connection, associatedAddress);
    } else {
      throw err;
    }
  }
};

export const serializeTx = (tx: Transaction | VersionedTransaction) => {
  let base64Tx = '';
  const isVersioned = 'version' in tx ? true : false;

  if (isVersioned) {
    const encodedTx = tx.serialize();
    const asBuffer = toBuffer(encodedTx);
    base64Tx = asBuffer.toString('base64');
  } else {
    base64Tx = tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString('base64');
  }

  console.log('encodedTx:', base64Tx);
  return base64Tx;
};
