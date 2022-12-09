import { assert, expect } from 'chai';
import { AnchorError, Program, ProgramError } from '@project-serum/anchor';
import {
  Keypair,
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  sendAndConfirmRawTransaction,
  sendAndConfirmTransaction,
  Transaction,
  Signer,
} from '@solana/web3.js';

import {
  Ps,
  PaymentStreaming,
  getStreamUnitsPerSecond,
  createProgram,
  sleep,
  NATIVE_SOL_MINT,
  CLIFF_PERCENT_DENOMINATOR,
  FEE_ACCOUNT,
  SIMULATION_PUBKEY,
} from '../src';
import {
  Category,
  AccountType,
  STREAM_STATUS,
  SubCategory,
  TimeUnit,
} from '../src/types';
import { BN } from 'bn.js';
import { toTokenAmountBn } from './utils';

interface LooseObject {
  [key: string]: any;
}

console.log(`\nWorld State:`);

const user1Wallet = loadKeypair(
  './tests/data/AUTH1btNKtuwPF2mF58YtSga5vAZ59Hg4SUKHmDF7SAn.json',
);
const user2Wallet = loadKeypair(
  './tests/data/AUTH2qMifVS3uMjmyC5C6agD4nwxwuvnfnBvFQHs5h5T.json',
);
console.log(`  wallet1: ${user1Wallet.publicKey}`);
console.log(`  wallet2: ${user2Wallet.publicKey}`);
console.log();

const psAccountPubKey = new PublicKey(
  'CTB7VoBn6wXEE4bHkkmJZjPDWD8n8ytz61Yvtffar5Lm',
);
const psAccountTokenPubKey = new PublicKey(
  'BacrASSTD71zHsDvE8ifKZRhN4LZwuhryAF9LaCSe5kL',
);
const psAccountStream1PubKey = new PublicKey(
  '5B97W6fGmSJ96YLxzCUSqYgv6THCRsXrrc96XsT9Lyex',
);
const psAccountStream2PubKey = new PublicKey(
  '8w9HbLF99gp7urc9Pra6r6VrcDKsnwDeXwaqxBgmsTxL',
);
const psAccountStream3PubKey = new PublicKey(
  'HTDxQon5FNFfYyu7zP7G2QZwLhNrx6zBmTiBH18Dy1XB',
);

const vestingAccountPubKey = new PublicKey(
  '2cw7ChGDenY7b4jKWvJKn2DeAbRfUyttEbZuaygtAykg',
);
const vestingAccountTokenPubKey = new PublicKey(
  'A8Xq5znzCZB6fomRn39f1jFzaHjjfnwy2YML6vhejNwU',
);
const vestingAccountTemplatePubKey = new PublicKey(
  '2vARitHbGPkJJyxCrH93JPakQiof9pPizzcD9Z6DJBre',
);
const vestingStream1PubKey = new PublicKey(
  'JBonFtSeFAEqJzcAK44fS6umQt2d3GVajnG1yaA7bCHf',
);
const vestingStream2PubKey = new PublicKey(
  '4hEwdEdV1LUd4xYo1NGPxFpcT3wJvWyJSEVLB9EQ5vmL',
);

console.log(`  account { id: ${psAccountPubKey}, name: , cat: default }`);
console.log(`    ├──token { id: ${psAccountTokenPubKey} }`);
const stream1Name = 'STREAM-1';
console.log(
  `    ├──stream { id: ${psAccountStream1PubKey}, name: ${stream1Name}, cat: default }`,
);
const stream2Name = 'STREAM-2';
console.log(
  `    ├──stream { id: ${psAccountStream2PubKey}, name: ${stream2Name}, cat: default }`,
);
const stream3Name = 'STREAM-3';
console.log(
  `    ├──stream { id: ${psAccountStream3PubKey}, name: ${stream3Name}, cat: default }`,
);
const vestingAccountName = `VESTING-ACCOUNT-${Date.now()}`;
console.log(
  `  account { id: ${vestingAccountPubKey}, name: ${vestingAccountName}, cat: vesting }`,
);
console.log(`    ├──token { id: ${vestingAccountTokenPubKey} }`);
console.log(`    ├──template { id: ${vestingAccountTemplatePubKey} }`);
const vestingStream1Name = 'VESTING-STREAM-1';
console.log(
  `    ├──stream { id: ${vestingStream1PubKey}, name: ${vestingStream1Name}, cat: vesting }`,
);
const vestingStream2Name = 'VESTING-STREAM-2';
console.log(
  `    ├──stream { id: ${vestingStream2PubKey}, name: ${vestingStream2Name}, cat: vesting }`,
);

const endpoint = 'http://127.0.0.1:8899';
// const endpoint = clusterApiUrl('devnet');
const commitment = 'confirmed';
let ps: PaymentStreaming;

async function sendRawTestTransaction(
  connection: Connection,
  tx: Buffer,
): Promise<string> {
  try {
    return await sendAndConfirmRawTransaction(connection, tx, {
      commitment,
    });
  } catch (error) {
    // console.log('error');
    // console.log(error);
    // console.log();

    const e = error as ProgramError;

    if (e.logs) {
      const anchorError = AnchorError.parse(e.logs);
      // console.log('anchorError');
      // console.log(anchorError);
      // console.log();

      if (anchorError) {
        // console.log(anchorError.error);
        throw anchorError;
      }
    }
    throw error;
  }
}

async function sendTestTransaction(
  connection: Connection,
  tx: Transaction,
  signers: Signer[],
): Promise<string> {
  try {
    return await sendAndConfirmTransaction(connection, tx, signers, {
      commitment: commitment,
    });
  } catch (error) {
    // console.log('error');
    // console.log(error);
    // console.log();

    const e = error as ProgramError;

    if (e.logs) {
      const anchorError = AnchorError.parse(e.logs);
      // console.log('anchorError');
      // console.log(anchorError);
      // console.log();

      if (anchorError) {
        // console.log(anchorError.error);
        throw anchorError;
      }
    }
    throw error;
  }
}

function printObj(label: string, obj: any) {
  console.log(`${label}: ${JSON.stringify(obj, null, 2)}\n`);
}

function loadKeypair(filePath: string): Keypair {
  return Keypair.fromSecretKey(
    Buffer.from(
      JSON.parse(
        require('fs').readFileSync(filePath, {
          encoding: 'utf-8',
        }),
      ),
    ),
  );
}

describe('PS Tests\n', async () => {
  let connection: Connection;
  let program: Program<Ps>;
  const programId = 'MSPdQo5ZdrPh6rU1LsvUv5nRhAnj1mj6YQEqBUq8YwZ';
  let debugObject: LooseObject;

  before(async () => {
    debugObject = {};
    connection = new Connection(endpoint, commitment);

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash(commitment);

    // airdrop some rent sol to the fee account
    await connection.confirmTransaction(
      {
        signature: await connection.requestAirdrop(
          FEE_ACCOUNT,
          LAMPORTS_PER_SOL,
        ),
        blockhash,
        lastValidBlockHeight,
      },
      commitment,
    );
    // airdrop some rent sol to the read on-chain data account
    await connection.confirmTransaction(
      {
        signature: await connection.requestAirdrop(
          SIMULATION_PUBKEY,
          LAMPORTS_PER_SOL,
        ),
        blockhash,
        lastValidBlockHeight,
      },
      commitment,
    );
    await connection.confirmTransaction(
      {
        signature: await connection.requestAirdrop(
          user1Wallet.publicKey,
          20 * LAMPORTS_PER_SOL,
        ),
        blockhash,
        lastValidBlockHeight,
      },
      commitment,
    );
    await connection.confirmTransaction(
      {
        signature: await connection.requestAirdrop(
          user2Wallet.publicKey,
          20 * LAMPORTS_PER_SOL,
        ),
        blockhash,
        lastValidBlockHeight,
      },
      commitment,
    );

    program = createProgram(connection, programId);
    ps = new PaymentStreaming(connection, new PublicKey(programId), commitment);

    console.log();
    await sleep(20000);
  });

  it('Fetches stream', async () => {
    const stream = await ps.getStream(psAccountStream1PubKey);
    // console.log(`vestingStream1: ${JSON.stringify(vestingStream1, null, 2)}\n`);
    assert.exists(stream);
    assert.equal(stream?.name, 'STREAM-1');
    assert.equal(stream?.rateAmount.toString(), '100000000');
    assert.equal(stream?.rateIntervalInSeconds.toString(), '1');
    assert.equal(
      stream?.allocationAssigned.toString(),
      LAMPORTS_PER_SOL.toString(),
    );
    assert.equal(stream?.category, Category.default);
  });

  it('Fetches stream (created from template)', async () => {
    const vestingStream1 = await ps.getStream(vestingStream1PubKey);
    // console.log(`vestingStream1: ${JSON.stringify(vestingStream1, null, 2)}\n`);
    assert.exists(vestingStream1);
    assert.equal(vestingStream1?.name, 'VESTING-STREAM-1');
    // cliff = 10%(1 SOL) = 100_000_000
    // allocation - cliff = 900_000_000
    // number of intervals = 12
    // rateAmoun = 900_000_000 / 12 = 75_000_000
    assert.equal(vestingStream1?.rateAmount.toString(), '75000000');
    assert.equal(vestingStream1?.category, Category.vesting);
  });

  it('Fetches vesting template', async () => {
    const vestingTemplate = await ps.getStreamTemplate(vestingAccountPubKey);
    assert.exists(vestingTemplate);
    assert.equal(vestingTemplate.cliffVestPercent.toString(), '100000');
    assert.equal(vestingTemplate.rateIntervalInSeconds.toString(), '60');
    assert.equal(vestingTemplate.durationNumberOfUnits.toString(), '12');
    assert.equal(vestingTemplate.feePayedByTreasurer, false);
    // console.log(`Template: ${JSON.stringify(vestingTemplate, null, 2)}\n`);
  });

  it('Filters accounts by category', async () => {
    const filteredVestingCategoryTreasuries = await ps.listAccounts(
      user1Wallet.publicKey,
      false,
      Category.vesting,
    );
    expect(filteredVestingCategoryTreasuries.length).eq(1);
    assert.ok(
      filteredVestingCategoryTreasuries.at(0)!.id.equals(vestingAccountPubKey),
    );

    const filteredDefaultCategoryTreasuries = await ps.listAccounts(
      user1Wallet.publicKey,
      false,
      Category.default,
    );
    expect(filteredDefaultCategoryTreasuries.length).eq(1);
    assert.ok(
      filteredDefaultCategoryTreasuries.at(0)!.id.equals(psAccountPubKey),
    );
  });

  it('Filters treasuries by sub-category', async () => {
    // 18.
    // console.log("Filtering treasuries by sub-category");
    const filteredSeedSubCategoryTreasuries = await ps.listAccounts(
      user1Wallet.publicKey,
      false,
      undefined,
      SubCategory.seed,
    );
    expect(filteredSeedSubCategoryTreasuries.length).eq(1);
    assert.ok(
      filteredSeedSubCategoryTreasuries.at(0)!.id.equals(vestingAccountPubKey),
    );

    const filteredDefaultSubCategoryTreasuries = await ps.listAccounts(
      user1Wallet.publicKey,
      false,
      undefined,
      SubCategory.default,
    );
    expect(filteredDefaultSubCategoryTreasuries.length).eq(1);
    assert.ok(
      filteredDefaultSubCategoryTreasuries.at(0)!.id.equals(psAccountPubKey),
    );
    // console.log("Filter by sub-category success.");
  });

  it('Filters streams by category', async () => {
    const filteredVestingCategoryStreams = await ps.listStreams({
      psAccount: vestingAccountPubKey,
      category: Category.vesting,
    });
    const streamIds = filteredVestingCategoryStreams.map(s => s.id.toBase58());
    // console.log(filteredVestingCategoryStreams);
    expect(filteredVestingCategoryStreams.length).eq(2);
    const filteredVestingCategoryStreamsSorted =
      filteredVestingCategoryStreams.sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    expect(filteredVestingCategoryStreamsSorted.at(0)!.id.toBase58()).eq(
      vestingStream1PubKey.toBase58(),
    );
    expect(filteredVestingCategoryStreamsSorted.at(1)!.id.toBase58()).eq(
      vestingStream2PubKey.toBase58(),
    );

    const filteredDefaultCategoryStreams = await ps.listStreams({
      psAccount: psAccountPubKey,
      category: Category.default,
    });
    expect(filteredDefaultCategoryStreams.length).eq(3);
    // assert sorting stability
    // console.log(filteredDefaultCategoryStreams.map(s => s.id.toBase58() + ' - ' + s.createdBlockTime.toString()));
    // Reustls should be sorted like this:
    // [
    //   '8w9HbLF99gp7urc9Pra6r6VrcDKsnwDeXwaqxBgmsTxL - 1670498259', <-- STREAM2 (first bc it has equial creation block as STREAM3, so name is used)
    //   'HTDxQon5FNFfYyu7zP7G2QZwLhNrx6zBmTiBH18Dy1XB - 1670498259', <-- STREAM3 (second bc it has equial creation block as STREAM3, so name is used)
    //   '5B97W6fGmSJ96YLxzCUSqYgv6THCRsXrrc96XsT9Lyex - 1670498258' <-- STREAM1 (last bc it has the oldest creation block)
    // ]
    expect(filteredDefaultCategoryStreams.at(0)!.id.toBase58()).eq(
      psAccountStream2PubKey.toBase58(),
    );
  });

  it('Filters streams by sub-category', async () => {
    const filteredVestingSubCategoryStreams = await ps.listStreams({
      psAccount: vestingAccountPubKey,
      subCategory: SubCategory.seed,
    });
    expect(filteredVestingSubCategoryStreams.length).eq(2);
    const filteredVestingSubCategoryStreamsSorted =
      filteredVestingSubCategoryStreams.sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    expect(filteredVestingSubCategoryStreamsSorted.at(0)!.id.toBase58()).eq(
      vestingStream1PubKey.toBase58(),
    );
    expect(filteredVestingSubCategoryStreamsSorted.at(1)!.id.toBase58()).eq(
      vestingStream2PubKey.toBase58(),
    );

    const filteredDefaultSubCategoryStreams = await ps.listStreams({
      psAccount: psAccountPubKey,
      subCategory: SubCategory.default,
    });
    expect(filteredDefaultSubCategoryStreams.length).eq(3);
    expect(filteredDefaultSubCategoryStreams.at(0)!.id.toBase58()).eq(
      psAccountStream2PubKey.toBase58(),
    );
  });

  it('Gets vesting account flow rate', async () => {
    const {
      rateAmount: rate,
      intervalUnit: unit,
      totalAllocation,
    } = await ps.getVestingAccountFlowRate(vestingAccountPubKey, false);
    assert.equal(
      rate.toString(),
      '150000000',
      'incorrect vesting account flow rate',
    );
    assert.equal(unit, TimeUnit.Minute);
    assert.equal(
      totalAllocation.toString(),
      new BN(2 * LAMPORTS_PER_SOL).toString(),
    );
  });

  it('Creates a PS account + add funds + creates 3 streams', async () => {
    // create a regular PS account
    const psAccountName = `PS-ACCOUNT-${Date.now()}`;
    const {
      transaction: createAccountTx,
      psAccount,
      psAccountToken,
    } = await ps.buildCreateAccountTransaction(
      user1Wallet.publicKey,
      user1Wallet.publicKey,
      NATIVE_SOL_MINT,
      psAccountName,
      AccountType.Open,
    );
    psAccount;

    const createAccountTxId = await sendTestTransaction(
      connection,
      createAccountTx,
      [user1Wallet],
    );

    // add funds to PS account
    const { transaction: addFundsToAccountTx } =
      await ps.buildAddFundsToAccountTransaction(
        psAccount,
        NATIVE_SOL_MINT,
        user1Wallet.publicKey,
        user1Wallet.publicKey,
        3 * LAMPORTS_PER_SOL,
      );
    addFundsToAccountTx.partialSign(user1Wallet);
    const addFundsToAccountTxb64 = addFundsToAccountTx.serialize({
      verifySignatures: true,
    });
    const addFundsToAccountTxId = await sendRawTestTransaction(
      connection,
      addFundsToAccountTxb64,
    );

    // create a stream 1
    const stream1Name = 'STREAM-1';
    const { transaction: createStream1Tx, stream: psAccountStream1 } =
      await ps.buildCreateStreamTransaction(
        psAccount,
        user1Wallet.publicKey,
        user1Wallet.publicKey,
        user2Wallet.publicKey,
        stream1Name,
        0.1 * LAMPORTS_PER_SOL,
        1,
        1 * LAMPORTS_PER_SOL,
        new Date(),
      );

    createStream1Tx.partialSign(user1Wallet);
    const createStream1Txb64 = createStream1Tx.serialize({
      verifySignatures: true,
    });
    const createStream1TxId = await sendAndConfirmRawTransaction(
      connection,
      createStream1Txb64,
      { commitment: commitment },
    );

    // create a stream 2
    const stream2Name = 'STREAM-2';
    const { transaction: createStream2Tx, stream: psAccountStream2 } =
      await ps.buildCreateStreamTransaction(
        psAccount,
        user1Wallet.publicKey,
        user1Wallet.publicKey,
        user2Wallet.publicKey,
        stream2Name,
        0.2 * LAMPORTS_PER_SOL,
        1,
        1 * LAMPORTS_PER_SOL,
        new Date(),
      );

    createStream2Tx.partialSign(user1Wallet);
    const createStream2Txb64 = createStream2Tx.serialize({
      verifySignatures: true,
    });
    const createStream2TxId = await sendAndConfirmRawTransaction(
      connection,
      createStream2Txb64,
      { commitment: commitment },
    );

    // create a stream 3
    const stream3Name = 'STREAM-3';
    const { transaction: createStream3Tx, stream: psAccountStream3 } =
      await ps.buildCreateStreamTransaction(
        psAccount,
        user1Wallet.publicKey,
        user1Wallet.publicKey,
        user2Wallet.publicKey,
        stream3Name,
        0.1 * LAMPORTS_PER_SOL,
        1,
        1 * LAMPORTS_PER_SOL,
        new Date(),
      );

    createStream3Tx.partialSign(user1Wallet);
    const createStream3Txb64 = createStream3Tx.serialize({
      verifySignatures: true,
    });
    const createStream3TxId = await sendAndConfirmRawTransaction(
      connection,
      createStream3Txb64,
      { commitment: commitment },
    );

    const [
      psAccountInfo,
      psAccountTokenInfo,
      psAccountStream1Info,
      psAccountStream2Info,
      psAccountStream3Info,
    ] = await connection.getMultipleAccountsInfo([
      psAccount,
      psAccountToken,
      psAccountStream1,
      psAccountStream2,
      psAccountStream3,
    ]);

    assert.exists(psAccountInfo);
    assert.equal(psAccountInfo?.data.length, 300);

    assert.exists(psAccountTokenInfo);
    assert.equal(psAccountTokenInfo?.data.length, 165);

    assert.exists(psAccountStream1Info);
    assert.equal(psAccountStream1Info?.data.length, 500);

    assert.exists(psAccountStream2Info);
    assert.equal(psAccountStream2Info?.data.length, 500);

    assert.exists(psAccountStream3Info);
    assert.equal(psAccountStream3Info?.data.length, 500);
  });

  it('Creates a vesting account + template + add funds + creates 2 streams', async () => {
    // create a vesting account
    const vestingAccountName = `VESTING-ACCOUNT-${Date.now()}`;
    const {
      transaction: createVestingAccountTx,
      vestingAccount,
      vestingAccountToken,
      template: vestingAccountTemplate,
    } = await ps.buildCreateVestingAccountTransaction(
      user1Wallet.publicKey,
      user1Wallet.publicKey,
      NATIVE_SOL_MINT,
      vestingAccountName,
      AccountType.Open,
      false,
      12,
      TimeUnit.Minute,
      10 * LAMPORTS_PER_SOL,
      SubCategory.seed,
      new Date(),
      10, // 10 %
    );
    createVestingAccountTx.partialSign(user1Wallet);
    const createVestingAccountTxb64 = createVestingAccountTx.serialize({
      verifySignatures: true,
    });
    const createVestingAccountTxId = await sendAndConfirmRawTransaction(
      connection,
      createVestingAccountTxb64,
      { commitment: commitment },
    );

    // create vesting stream 1
    const vestingStream1Name = 'VESTING-STREAM-1';
    const { transaction: createStreamTx, stream: vestingAccountStream1 } =
      await ps.buildCreateVestingStreamWithTemplateTransaction(
        vestingAccount,
        user1Wallet.publicKey,
        user1Wallet.publicKey,
        user2Wallet.publicKey,
        1 * LAMPORTS_PER_SOL,
        vestingStream1Name,
      );
    createStreamTx.partialSign(user1Wallet);
    const createStreamTxSerialized = createStreamTx.serialize({
      verifySignatures: true,
    });
    const createStreamTxId = await sendRawTestTransaction(
      connection,
      createStreamTxSerialized,
    );

    // create vesting stream 2
    const vestingStream2Name = 'VESTING-STREAM-2';
    const { transaction: createStreamTx2, stream: vestingAccountStream2 } =
      await ps.buildCreateVestingStreamWithTemplateTransaction(
        vestingAccount,
        user1Wallet.publicKey,
        user1Wallet.publicKey,
        user2Wallet.publicKey,
        1 * LAMPORTS_PER_SOL,
        vestingStream2Name,
      );
    createStreamTx2.partialSign(user1Wallet);
    const createStreamTx2Serialized = createStreamTx2.serialize({
      verifySignatures: true,
    });
    const createStreamTx2Id = await sendRawTestTransaction(
      connection,
      createStreamTx2Serialized,
    );

    const [
      vestingAccountInfo,
      vestingAccountTokenInfo,
      vestingAccountTemplateInfo,
      vestingAccountStream1Info,
      vestingAccountStream2Info,
    ] = await connection.getMultipleAccountsInfo([
      vestingAccount,
      vestingAccountToken,
      vestingAccountTemplate,
      vestingAccountStream1,
      vestingAccountStream2,
    ]);

    assert.exists(vestingAccountInfo);
    assert.equal(vestingAccountInfo?.data.length, 300);

    assert.exists(vestingAccountTokenInfo);
    assert.equal(vestingAccountTokenInfo?.data.length, 165);

    assert.exists(vestingAccountTemplateInfo);
    assert.equal(vestingAccountTemplateInfo?.data.length, 200);

    assert.exists(vestingAccountStream1Info);
    assert.equal(vestingAccountStream1Info?.data.length, 500);

    assert.exists(vestingAccountStream2Info);
    assert.equal(vestingAccountStream2Info?.data.length, 500);
  });

  xit('Test stream running', async () => {
    const strmId = new PublicKey(
      'FEsT4HG1WG24sb785x9WvrnFPZuG4ic8fvg28aKKzFn1',
    );
    const strmId2 = new PublicKey(
      '4tA5bz8Ky3fAjyycvmNUFciUGgtS1qWZpnN8ii6MguRB',
    );
    const data = await ps.getStream(strmId);
    console.log(data);
    const data2 = await ps.getStreamRaw(strmId2);
    console.log(data2);
    const data4 = await ps.listStreams({
      treasurer: new PublicKey('468Z5p52439dAqjLzBm2FCNxvDSnpbMsNx85b7Kmz3TQ'),
      commitment: commitment,
    });
    console.log(data4);
  });

  it('Enum casting', () => {
    const scheduled = 'Scheduled';
    const scheduledEnum = STREAM_STATUS[scheduled];
    // console.log(scheduled, scheduledEnum);
    assert.equal(scheduledEnum, 1);

    const running = 'Running';
    const runningEnum = STREAM_STATUS[running];
    // console.log(running, runningEnum);
    assert.equal(runningEnum, 2);

    const paused = 'Paused';
    const pausedEnum = STREAM_STATUS[paused];
    // console.log(paused, pausedEnum);
    assert.equal(pausedEnum, 3);
  });

  xit('BN & Bignumber', async () => {
    const strmId = new PublicKey(
      '7uGiMnnnJdr28DPsCioeKLSF5uJjWP3wxYFGVmK3SEJh',
    );
    const stream = await ps.getStreamRaw(strmId);
    if (!stream) throw new Error(`Stream ${strmId} was not found`);

    const slot = await program.provider.connection.getSlot('finalized');
    const blockTime = (await program.provider.connection.getBlockTime(
      slot,
    )) as number;
    const timeDiff = Math.round(Date.now() / 1_000 - blockTime);

    let startUtcInSeconds = 0;
    if (stream.startUtc.gt(new BN(0))) {
      startUtcInSeconds = stream.startUtc.toNumber();
      console.log('startUtcInSeconds:1', startUtcInSeconds);
    }
    if (stream.startUtc.toString().length > 10) {
      startUtcInSeconds = parseInt(stream.startUtc.toString().substr(0, 10));
      console.log('startUtcInSeconds:2', startUtcInSeconds);
    }
    const result = stream.startUtc.toNumber();
    console.log('startUtcInSeconds:3', result);

    const totalSecondsPaused =
      stream.lastKnownTotalSecondsInPausedStatus.toString().length >= 10
        ? parseInt(
            (
              stream.lastKnownTotalSecondsInPausedStatus.toNumber() / 1_000
            ).toString(),
          )
        : stream.lastKnownTotalSecondsInPausedStatus.toNumber();

    let cliffUnits = new BN(0);
    if (stream.cliffVestPercent.gtn(0)) {
      const cliffVestPercent = stream.cliffVestPercent;
      const allocationAssignedUnits = stream.allocationAssignedUnits;
      cliffUnits = new BN(cliffVestPercent)
        .mul(allocationAssignedUnits)
        .div(new BN(CLIFF_PERCENT_DENOMINATOR));
      console.log('cliff:', cliffUnits.toString());
    }

    const secondsSinceStart = timeDiff - startUtcInSeconds;
    const streamedUnitsPerSecond = getStreamUnitsPerSecond(
      stream.rateAmountUnits,
      stream.rateIntervalInSeconds,
    );
    const mult = streamedUnitsPerSecond * secondsSinceStart;
    const nonStopEarningUnits = cliffUnits.add(new BN(mult));
    const missedEarningUnitsWhilePaused =
      streamedUnitsPerSecond * totalSecondsPaused;

    console.log(
      'nonStopEarningUnits and more: ',
      nonStopEarningUnits.toString(),
      missedEarningUnitsWhilePaused.toString(),
    );
  });

  // xit('Cliff calculation limit', () => {
  //   const PERCENT_DENOMINATOR = 1_000_000;
  //   const rateAmount = "29207750000000";
  //   const allocationAssigned = "368940000000000";
  //   const cliffMul = new BigNumber(rateAmount).multipliedBy(new BigNumber(allocationAssigned));
  //   console.log(`effective_cliff_units multiplied: ${cliffMul.toFixed(0)}, length: ${cliffMul.toFixed(0).length}`);
  //   const cliff = cliffMul.dividedBy(new BigNumber(PERCENT_DENOMINATOR));
  //   console.log(`effective_cliff_units final result: ${cliff.toFixed(0)}, length: ${cliff.toFixed(0).length}`);

  //   const cliffMulBn = new BN(rateAmount).mul(new BN(allocationAssigned));
  //   console.log(`multiplied: ${cliffMulBn.toString()}, length: ${cliffMulBn.toString().length}`);
  //   const cliffBn = cliffMulBn.div(new BN(PERCENT_DENOMINATOR));
  //   console.log(`final result: ${cliffBn.toString()}, length: ${cliffBn.toString().length}`);
  // });

  xit('Withdraw VC funds from 12-decimals token', async () => {
    const decimals = 12;
    const fundingAmount = 1_000_000;
    const fundingAmountRaw = toTokenAmountBn(fundingAmount, decimals);
    const streamPk = new PublicKey(
      '78BH68vvd5B2WKpWckiSaohko8T8jwnYTFeW1QAx5DK7',
    );

    console.log('Withdrawing from stream1');
    const { transaction: withdrawStreamTx } =
      await ps.buildWithdrawFromAccountTransaction(
        user1Wallet.publicKey,
        user1Wallet.publicKey,
        streamPk,
        fundingAmountRaw.toString(),
      );
    const withdrawStreamTxId = await sendAndConfirmTransaction(
      connection,
      withdrawStreamTx,
      [user1Wallet],
      { commitment: commitment },
    );
    console.log(
      `Withdraw from stream1 success. TX_ID: ${withdrawStreamTxId}\n`,
    );
  });

  xit('Create VC for 12-decimals token', async () => {
    const decimals = 12;
    const fundingAmount = 1_000_000;
    const fundingAmountRaw = toTokenAmountBn(fundingAmount, decimals);
    const mintWith12Decimals = new PublicKey(
      'Dma8Hv94ByVHMXDU8ioh6iW3P1gWTYk6PerAnGCtZMpv',
    );

    console.log('Creating a vesting treasury');
    const {
      transaction: createVestingTreasuryTx,
      vestingAccount: vestingAccount,
    } = await ps.buildCreateVestingAccountTransaction(
      user1Wallet.publicKey,
      user1Wallet.publicKey,
      mintWith12Decimals,
      `${decimals}D CreateVestingTreasury ${Date.now()}`.slice(0, 32),
      AccountType.Open,
      false,
      12,
      TimeUnit.Minute,
      fundingAmountRaw.toString(),
      SubCategory.seed,
      new Date(),
    );
    createVestingTreasuryTx.partialSign(user1Wallet);
    const createVestingTreasuryTxSerialized = createVestingTreasuryTx.serialize(
      { verifySignatures: true },
    );
    console.log(createVestingTreasuryTxSerialized.toString('base64'));
    const createVestingTreasuryTxId = await sendAndConfirmRawTransaction(
      connection,
      createVestingTreasuryTxSerialized,
      { commitment: commitment },
    );
    console.log(
      `Created a vesting treasury: ${vestingAccount.toBase58()} TX_ID: ${createVestingTreasuryTxId}\n`,
    );

    console.log('Adding funds to the treasury');
    const { transaction: addFundsTx } =
      await ps.buildAddFundsToAccountTransaction(
        user1Wallet.publicKey,
        user1Wallet.publicKey,
        vestingAccount,
        mintWith12Decimals,
        fundingAmountRaw.toString(),
      );
    addFundsTx.partialSign(user1Wallet);
    const addFundsTxSerialized = addFundsTx.serialize({
      verifySignatures: true,
    });
    console.log(addFundsTxSerialized.toString('base64'));
    const addFundsTxId = await sendAndConfirmRawTransaction(
      connection,
      addFundsTxSerialized,
      { commitment: commitment },
    );
    console.log(`Funds added TX_ID: ${addFundsTxId}\n`);

    console.log('Creating vesting stream...');
    const { transaction: createStreamTx, stream } =
      await ps.buildCreateVestingStreamWithTemplateTransaction(
        user1Wallet.publicKey,
        user1Wallet.publicKey,
        vestingAccount,
        user2Wallet.publicKey,
        fundingAmountRaw.toString(),
        `${decimals}D StreamWithTemplate at ${Date.now()}`.slice(0, 30),
      );
    createStreamTx.partialSign(user1Wallet);
    const createStreamTxSerialized = createStreamTx.serialize({
      verifySignatures: true,
    });
    console.log(createStreamTxSerialized.toString('base64'));
    const createStreamTxId = await sendAndConfirmRawTransaction(
      connection,
      createStreamTxSerialized,
      { commitment: commitment },
    );
    console.log(
      `Stream created: ${stream.toBase58()} TX_ID: ${createStreamTxId}\n`,
    );
  });

  xit('Create VC Stream for 12-decimals token', async () => {
    const decimals = 12;
    const fundingAmount = 368.94;
    const fundingAmountRaw = toTokenAmountBn(fundingAmount, decimals);
    const treasury = new PublicKey(
      'CRNkS5tdh5w4DubU1jX7XDAMjLYnxYgw6Ey1Hfs35Sx5',
    );

    console.log('Creating vesting stream...');
    const { transaction: createStreamTx, stream } =
      await ps.buildCreateVestingStreamWithTemplateTransaction(
        user1Wallet.publicKey,
        user1Wallet.publicKey,
        treasury,
        user2Wallet.publicKey,
        fundingAmountRaw.toString(),
        `${decimals}D StreamWithTemplate at ${Date.now()}`.slice(0, 30),
      );
    createStreamTx.partialSign(user1Wallet);
    const createStreamTxSerialized = createStreamTx.serialize({
      verifySignatures: true,
    });
    console.log(createStreamTxSerialized.toString('base64'));
    const createStreamTxId = await sendAndConfirmRawTransaction(
      connection,
      createStreamTxSerialized,
      { commitment: commitment },
    );
    console.log(
      `Stream created: ${stream.toBase58()} TX_ID: ${createStreamTxId}\n`,
    );
  });

  xit('Create VC for 9-decimals token', async () => {
    const decimals = 9;
    const fundingAmount = 1_000_000;
    const fundingAmountRaw = toTokenAmountBn(fundingAmount, decimals);
    const mintWith12Decimals = new PublicKey(
      'G1QahEecVmBhYibu8ZxPRqBSZQNYF8PRAXBLZpuVzRk9',
    );

    console.log('Creating a vesting treasury');
    const { transaction: createVestingTreasuryTx, vestingAccount: treasury } =
      await ps.buildCreateVestingAccountTransaction(
        user1Wallet.publicKey,
        user1Wallet.publicKey,
        mintWith12Decimals,
        `MSP createVestingTreasury ${Date.now()}`.slice(0, 32),
        AccountType.Open,
        false,
        12,
        TimeUnit.Minute,
        fundingAmountRaw.toString(),
        SubCategory.seed,
        new Date(),
      );
    createVestingTreasuryTx.partialSign(user1Wallet);
    const createVestingTreasuryTxSerialized = createVestingTreasuryTx.serialize(
      { verifySignatures: true },
    );
    console.log(createVestingTreasuryTxSerialized.toString('base64'));
    const createVestingTreasuryTxId = await sendAndConfirmRawTransaction(
      connection,
      createVestingTreasuryTxSerialized,
      { commitment: commitment },
    );
    console.log(
      `Created a vesting treasury: ${treasury.toBase58()} TX_ID: ${createVestingTreasuryTxId}\n`,
    );

    console.log('Adding funds to the treasury');
    const { transaction: addFundsTx } =
      await ps.buildAddFundsToAccountTransaction(
        user1Wallet.publicKey,
        user1Wallet.publicKey,
        treasury,
        mintWith12Decimals,
        fundingAmountRaw.toString(),
      );
    addFundsTx.partialSign(user1Wallet);
    const addFundsTxSerialized = addFundsTx.serialize({
      verifySignatures: true,
    });
    console.log(addFundsTxSerialized.toString('base64'));
    const addFundsTxId = await sendAndConfirmRawTransaction(
      connection,
      addFundsTxSerialized,
      { commitment: commitment },
    );
    console.log(`Funds added TX_ID: ${addFundsTxId}\n`);

    console.log('Creating vesting stream...');
    const { transaction: createStreamTx, stream } =
      await ps.buildCreateVestingStreamWithTemplateTransaction(
        user1Wallet.publicKey,
        user1Wallet.publicKey,
        treasury,
        user2Wallet.publicKey,
        fundingAmountRaw.toString(),
        `MSP StreamWithTemplate at ${Date.now()}`.slice(0, 32),
      );
    createStreamTx.partialSign(user1Wallet);
    const createStreamTxSerialized = createStreamTx.serialize({
      verifySignatures: true,
    });
    const createStreamTxId = await sendAndConfirmRawTransaction(
      connection,
      createStreamTxSerialized,
      { commitment: commitment },
    );
    console.log(
      `Stream created: ${stream.toBase58()} TX_ID: ${createStreamTxId}\n`,
    );
  });

  xit('Creates different category treasuries and streams (vesting and non-vesting)', async () => {
    /**
     * 1. Create a vesting treasury and fund with 10 SOL
     * 2. Add funds (2 SOL) to the vesting treasury
     * 3. Fetch the vesting treasury template
     * 4. Modify the vesting treasury template
     * 5. Fetch the vesting treasury template after modification
     * 6. Create vesting stream: vesting_stream_1 (allocate 1 SOL)
     * 7. Create vesting stream: vesting_stream_2 (allocate 1 SOL)
     * 8. Withdraw 1 SOL from vesting treasury
     * 9. Sleep 5 seconds
     * 10. Allocate funds to vesting_stream_1 (0.00000025 * LAMPORTS_PER_SOL = 250 lamports)
     * 11. Pause vesting_stream_1
     * 12. Sleep 5 seconds and resume vesting_stream_1
     * 13. Refresh vesting treasury balance
     * 14. Create non-vesting treasury
     * 15. Add funds to non-vesting treasury (1 SOL)
     * 16. Create non-vesting stream (allocate 1 SOL)
     * 17. Filter treasuries by category
     * 18. Filter treasuries by sub-category
     * 19. Filter streams by category
     * 20. Filter streams by sub-category
     * 21. Get vesting treasury activities
     * 22. Get vesting stream activities
     * 23. Sleep 10
     * 24. Get vesting treasury flow rate
     * 25. Close vesting_test_1
     */
    // // 4.
    // console.log('Mofify template data');
    // const { transaction: modifyTx } =
    //   await ps.buildUpdateVestingAccountTemplate(
    //     user1Wallet.publicKey,
    //     user1Wallet.publicKey,
    //     vestingTreasury,
    //     10,
    //     TimeUnit.Minute,
    //     undefined,
    //     10,
    //     undefined,
    //   );
    // modifyTx.partialSign(user1Wallet);
    // const modifyTxSerialized = modifyTx.serialize({ verifySignatures: true });
    // const modifyTxId = await sendRawTestTransaction(
    //   connection,
    //   modifyTxSerialized,
    // );
    // console.log(`Template modified ${modifyTxId} \n`);
    // // 8.
    // console.log('Withdraw from treasury');
    // const { transaction: withdrawTx } =
    //   await ps.buildWithdrawFromAccountTransaction(
    //     user1Wallet.publicKey,
    //     user1Wallet.publicKey,
    //     vestingTreasury,
    //     LAMPORTS_PER_SOL,
    //   );
    // withdrawTx.partialSign(user1Wallet);
    // const withdrawTxSerialized = withdrawTx.serialize({
    //   verifySignatures: true,
    // });
    // await sendRawTestTransaction(connection, withdrawTxSerialized);
    // console.log('Withdrew from treasury success\n');
    // // 9.
    // await sleep(5000);
    // console.log('Withdrawing from stream1');
    // const { transaction: withdrawStreamTx } =
    //   await ps.buildWithdrawFromStreamTransaction(
    //     user2Wallet.publicKey,
    //     vestingStream1,
    //     0.00000025 * LAMPORTS_PER_SOL,
    //   );
    // await sendAndConfirmTransaction(
    //   connection,
    //   withdrawStreamTx,
    //   [user2Wallet],
    //   { commitment: commitment },
    // );
    // console.log('Withdraw from stream1 success.\n');
    // // 10.
    // console.log('Allocate funds to test_stream_1');
    // const { transaction: allocateStreamTx } =
    //   await ps.buildAllocateFundsToStreamTransaction(
    //     user1Wallet.publicKey,
    //     user1Wallet.publicKey,
    //     vestingTreasury,
    //     vestingStream1,
    //     3 * LAMPORTS_PER_SOL,
    //   );
    // await sendTestTransaction(connection, allocateStreamTx, [user1Wallet]);
    // console.log('Allocate to stream1 success\n');
    // // 11.
    // console.log('Pausing test_stream_1');
    // const { transaction: pauseStreamTx } = await ps.buildPauseStreamTransaction(
    //   user1Wallet.publicKey,
    //   user1Wallet.publicKey,
    //   vestingStream1,
    // );
    // await sendTestTransaction(connection, pauseStreamTx, [user1Wallet]);
    // console.log('Pause stream1 success.\n');
    // // 12.
    // await sleep(5000);
    // console.log('Resume test_stream_1');
    // const { transaction: resumeStreamTx } =
    //   await ps.buildResumeStreamTransaction(
    //     user1Wallet.publicKey,
    //     user1Wallet.publicKey,
    //     vestingStream1,
    //   );
    // await sendTestTransaction(connection, resumeStreamTx, [user1Wallet]);
    // console.log('Resume stream1 success.\n');
    // // 13.
    // console.log('Refresh vesting treasury balance');
    // const { transaction: refreshStreamTx } =
    //   await ps.buildRefreshAccountDataTransaction(
    //     user1Wallet.publicKey,
    //     vestingTreasury,
    //   );
    // await sendTestTransaction(connection, refreshStreamTx, [user1Wallet]);
    // console.log('Treasury refresh success.\n');
    // 21.
    // console.log("Getting vesting treasury activities");
    // const vestingTreasuryActivities = await msp.listVestingTreasuryActivity(vestingTreasury, createNonVestingTreasuryTx, 20, commitment);
    // console.log(JSON.stringify(vestingTreasuryActivities, null, 2) + '\n');
    // // 22.
    // console.log("Getting vesting stream activities");
    // const vestingStreawActivities = await msp.listStreamActivity(vestingStream1, createNonVestingTreasuryTx, 10, commitment);
    // console.log(JSON.stringify(vestingStreawActivities, null, 2) + '\n');
    // 23.
    // await sleep(10_000);
    // 25.
    // console.log('Close vesting_stream_1');
    // const { transaction: closeStreamTx } = await ps.buildCloseStreamTransaction(
    //   vestingStream1,
    //   user1Wallet.publicKey,
    //   false,
    //   user1Wallet.publicKey,
    //   true,
    // );
    // await sendAndConfirmTransaction(connection, closeStreamTx, [user1Wallet], {
    //   commitment: commitment,
    // });
    // console.log('Close vesting_stream_1 success.\n');
  });

  // xit('MSP > listStreams > select stream using filter and get info', async () => {
  //   const targetStreamAddress = 'Cx14kzEJJqUsXYdKS6BcXGGM4Mtn6m3VbRpr3o1FifdK';
  //   try {
  //     console.log("Get list of streams...");
  //     const accounts = await getFilteredStreamAccounts(
  //       program,
  //       userWalletAddress,
  //       undefined,
  //       userWalletAddress,
  //       Category.default,
  //     );
  //     console.log("Selecting stream:", targetStreamAddress);
  //     expect(accounts.length).not.eq(0);

  //     const item = accounts.find(a => a.publicKey.toString() === targetStreamAddress);
  //     expect(item).not.be.undefined;
  //     expect(item.publicKey.toBase58()).equal(targetStreamAddress);
  //     expect(item.account).not.be.undefined;

  //     // To hold the value of the withdrawable amount
  //     let streamWithdrawableAmount = new BN(0);

  //     if (item) {
  //       if (item.account !== undefined) {
  //         const slot = await program.provider.connection.getSlot('finalized');
  //         const blockTime = (await program.provider.connection.getBlockTime(slot)) as number;
  //         const stream = item.account;
  //         const address = item.publicKey;
  //         const nameBuffer = Buffer.from(stream.name);
  //         const createdOnUtcInSeconds = stream.createdOnUtc
  //           ? stream.createdOnUtc.toNumber()
  //           : 0;
  //         const startUtcInSeconds = getStreamStartUtcInSeconds(stream);
  //         const effectiveCreatedOnUtcInSeconds = createdOnUtcInSeconds > 0
  //           ? createdOnUtcInSeconds
  //           : startUtcInSeconds;
  //         const timeDiff = Math.round((Date.now() / 1_000) - blockTime);
  //         const startUtc = new Date(startUtcInSeconds * 1000);
  //         const depletionDate = getStreamEstDepletionDate(stream);
  //         const status = getStreamStatus(stream, timeDiff);
  //         // const streamMissedEarningUnitsWhilePaused = getStreamMissedEarningUnitsWhilePaused(stream);
  //         const remainingAllocation = getStreamRemainingAllocation(stream);
  //         const manuallyPaused = isStreamManuallyPaused(stream);
  //         const cliffAmount = getStreamCliffAmount(stream);
  //         const streamUnitsPerSecond = getStreamUnitsPerSecond(stream);

  //         debugObject = {
  //           id: address.toBase58(),
  //           version: stream.version,
  //           name: new TextDecoder().decode(nameBuffer),
  //           startUtc: startUtc.toString(),
  //           secondsSinceStart: blockTime - startUtcInSeconds,
  //           cliffVestPercent: stream.cliffVestPercent.toNumber() / 10_000,
  //           cliffVestAmount: cliffAmount.toString(),
  //           allocationAssigned: stream.allocationAssignedUnits.toString(),
  //           estimatedDepletionDate: depletionDate.toString(),
  //           rateAmount: stream.rateAmountUnits.toString(),
  //           rateIntervalInSeconds: stream.rateIntervalInSeconds.toNumber(),
  //           totalWithdrawalsAmount: stream.totalWithdrawalsUnits.toString(),
  //           remainingAllocation: remainingAllocation.toString(),
  //           status: `${STREAM_STATUS[status]} = ${status}`,
  //           manuallyPaused: manuallyPaused,
  //           streamUnitsPerSecond: streamUnitsPerSecond,
  //         };

  //         // Continue evaluating if there is remaining allocation
  //         if (remainingAllocation.gtn(0)) {
  //           // Continue evaluating if the stream is not scheduled
  //           if (status !== STREAM_STATUS.Scheduled) {

  //             if (status === STREAM_STATUS.Paused) {  // Check if PAUSED
  //               const manuallyPaused = isStreamManuallyPaused(stream);
  //               const withdrawableWhilePausedAmount = manuallyPaused
  //                 ? stream.lastManualStopWithdrawableUnitsSnap
  //                 : remainingAllocation;
  //               streamWithdrawableAmount = BN.max(new BN(0), withdrawableWhilePausedAmount);
  //             } else if (stream.rateAmountUnits.isZero() ||
  //               stream.rateIntervalInSeconds.isZero()) {  // Check if NOT RUNNING
  //               streamWithdrawableAmount = new BN(0);
  //             } else {
  //               const blocktimeRelativeNow = Math.round((Date.now() / 1_000) - timeDiff);
  //               const startUtcInSeconds = getStreamStartUtcInSeconds(stream);
  //               const timeSinceStart = blocktimeRelativeNow - startUtcInSeconds;

  //               const cliffAmount2 = new BigNumber(cliffAmount.toString());
  //               const unitsSinceStart = new BigNumber(streamUnitsPerSecond * timeSinceStart);
  //               const nonStopEarningUnits2 = cliffAmount2.plus(unitsSinceStart).toString();

  //               const nonStopEarningUnits = new BN(nonStopEarningUnits2);
  //               const totalSecondsPaused = stream.lastKnownTotalSecondsInPausedStatus.toString().length >= 10
  //                 ? parseInt((stream.lastKnownTotalSecondsInPausedStatus.toNumber() / 1_000).toString())
  //                 : stream.lastKnownTotalSecondsInPausedStatus.toNumber();
  //               const missedEarningUnitsWhilePaused = streamUnitsPerSecond * totalSecondsPaused;
  //               let entitledEarnings = nonStopEarningUnits;

  //               if (nonStopEarningUnits.gten(missedEarningUnitsWhilePaused)) {
  //                 entitledEarnings = nonStopEarningUnits.subn(missedEarningUnitsWhilePaused);
  //               }

  //               let withdrawableUnitsWhileRunning = entitledEarnings;

  //               if (entitledEarnings.gte(stream.totalWithdrawalsUnits)) {
  //                 withdrawableUnitsWhileRunning = entitledEarnings.sub(stream.totalWithdrawalsUnits);
  //               }

  //               const withdrawableAmount = BN.min(remainingAllocation, withdrawableUnitsWhileRunning);

  //               streamWithdrawableAmount = BN.max(new BN(0), withdrawableAmount);

  //               debugObject.startUtcInSeconds = startUtcInSeconds;
  //               debugObject.timeSinceStart = timeSinceStart;
  //               debugObject.nonStopEarningUnits = nonStopEarningUnits.toString();
  //               debugObject.missedEarningUnitsWhilePaused = missedEarningUnitsWhilePaused.toString();
  //               debugObject.withdrawableUnitsWhileRunning = withdrawableUnitsWhileRunning.toString();
  //             }

  //           }
  //         }

  //         debugObject.withdrawableAmount = streamWithdrawableAmount.toString();  // last
  //         console.table(debugObject);

  //       }
  //     }

  //     console.log("Selecting stream and get info success.");

  //   } catch (error) {
  //     console.error(error);
  //     expect(true).eq(false);
  //   }
  // });
});
