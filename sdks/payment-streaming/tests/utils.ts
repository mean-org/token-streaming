import { Keypair, Transaction } from '@solana/web3.js';
import BigNumber from "bignumber.js";
import BN from "bn.js";
import base58 from 'bs58';
import * as fs from "fs-extra";

export const getDefaultKeyPair = async (): Promise<Keypair> => {
    // const id = await fs.readJSON(join(homedir(), '.config/solana/id.json'));
    // const bytes = Uint8Array.from(id);
    // return Keypair.fromSecretKey(bytes);

    return Keypair.generate();
};

export const getKeypairFromJson = (filePath: string) => {
    const secretKeyString = fs.readFileSync(filePath, { encoding: 'utf-8' });

    // Try the shorter base58 format first
    let decodedSecretKey: Uint8Array;
    try {
        decodedSecretKey = base58.decode(secretKeyString);
        return Keypair.fromSecretKey(decodedSecretKey);
    } catch (throwObject) {
        const error = throwObject as Error;
        if (!error.message.includes('Non-base58 character')) {
            throw new Error('Invalid secret key provided!');
        }
    }

    // Try the longer JSON format
    try {
        decodedSecretKey = Uint8Array.from(JSON.parse(secretKeyString));
    } catch (error) {
        throw new Error('Invalid secret key provided!');
    }

    return Keypair.fromSecretKey(decodedSecretKey);
};

export const _printSerializedTx = (tx: Transaction, requireAllSignatures = false, verifySignatures = false) => {
    console.log(tx.serialize({
        requireAllSignatures,
        verifySignatures,
    }).toString('base64'));
}

export function sleep(ms: number) {
    console.log('Sleeping for', ms / 1000, 'seconds');
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export const makeDecimal = (bn: BN, decimals: number): number => {
    return Number(bn.toString()) / Math.pow(10, decimals)
}

export const toTokenAmountBn = (amount: number | string, decimals: number) => {
    // if (!amount || !decimals) {
    //   return new BN(0);
    // }

    const multiplier = new BigNumber(10 ** decimals);
    const value = new BigNumber(amount);
    const result = value.multipliedBy(multiplier).integerValue();
    const toFixed = result.toFixed(0);
    return new BN(toFixed);
}