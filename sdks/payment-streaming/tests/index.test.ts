import { assert, expect } from 'chai';
import { AnchorError, ProgramError } from '@project-serum/anchor';
import {
  Keypair,
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  Transaction,
  Signer,
  BlockheightBasedTransactionConfirmationStrategy,
} from '@solana/web3.js';

import {
  PaymentStreaming,
  sleep,
  NATIVE_SOL_MINT,
  FEE_ACCOUNT,
  SIMULATION_PUBKEY,
} from '../src';
import {
  Category,
  AccountType,
  SubCategory,
  TimeUnit,
  STREAM_STATUS_CODE,
} from '../src/types';
import { BN } from 'bn.js';
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';

console.log(`\nWorld State:`);

const PAYMENT_STREAMING_PROGRAM_ID = 'MSPdQo5ZdrPh6rU1LsvUv5nRhAnj1mj6YQEqBUq8YwZ';

const user1Wallet = loadKeypair(
  './tests/data/AUTH1btNKtuwPF2mF58YtSga5vAZ59Hg4SUKHmDF7SAn.json',
);
const user2Wallet = loadKeypair(
  './tests/data/AUTH2qMifVS3uMjmyC5C6agD4nwxwuvnfnBvFQHs5h5T.json',
);
const testPayerKey = Keypair.generate();
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

async function partialSignSendAndConfirmTransaction(
  connection: Connection,
  transaction: Transaction,
  signer: Signer
): Promise<string> {
  try {

    // Thre is a bug in solana's web3.js `sendAndConfirmRawTransaction` which
    // requieres the transaction signature thus preventing us from using that
    // method

    transaction.partialSign(signer)
    const rawTransaction = transaction.serialize();

    const signature = await connection.sendRawTransaction(rawTransaction);
    const status = (await connection.confirmTransaction({
      signature: signature,
      blockhash: transaction.recentBlockhash,
      lastValidBlockHeight: transaction.lastValidBlockHeight
    } as BlockheightBasedTransactionConfirmationStrategy)).value;

    if (status.err) {
      throw new Error(`Transaction ${signature} failed (${JSON.stringify(status)})`);
    }

    return signature;
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  before(async () => {
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
    await connection.confirmTransaction(
      {
        signature: await connection.requestAirdrop(
          testPayerKey.publicKey,
          1000 * LAMPORTS_PER_SOL,
        ),
        blockhash,
        lastValidBlockHeight,
      },
      commitment,
    );

    ps = new PaymentStreaming(connection, new PublicKey(PAYMENT_STREAMING_PROGRAM_ID), commitment);

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
      filteredVestingCategoryTreasuries.at(0)?.id.equals(vestingAccountPubKey),
    );

    const filteredDefaultCategoryTreasuries = await ps.listAccounts(
      user1Wallet.publicKey,
      false,
      Category.default,
    );
    expect(filteredDefaultCategoryTreasuries.length).eq(1);
    assert.ok(
      filteredDefaultCategoryTreasuries.at(0)?.id.equals(psAccountPubKey),
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
      filteredSeedSubCategoryTreasuries.at(0)?.id.equals(vestingAccountPubKey),
    );

    const filteredDefaultSubCategoryTreasuries = await ps.listAccounts(
      user1Wallet.publicKey,
      false,
      undefined,
      SubCategory.default,
    );
    expect(filteredDefaultSubCategoryTreasuries.length).eq(1);
    assert.ok(
      filteredDefaultSubCategoryTreasuries.at(0)?.id.equals(psAccountPubKey),
    );
    // console.log("Filter by sub-category success.");
  });

  it('Filters streams by category', async () => {
    const filteredVestingCategoryStreams = await ps.listStreams({
      psAccount: vestingAccountPubKey,
      category: Category.vesting,
    });
    expect(filteredVestingCategoryStreams.length).eq(2);
    const filteredVestingCategoryStreamsSorted =
      filteredVestingCategoryStreams.sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    expect(filteredVestingCategoryStreamsSorted.at(0)?.id.toBase58()).eq(
      vestingStream1PubKey.toBase58(),
    );
    expect(filteredVestingCategoryStreamsSorted.at(1)?.id.toBase58()).eq(
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
    expect(filteredDefaultCategoryStreams.at(0)?.id.toBase58()).eq(
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
    expect(filteredVestingSubCategoryStreamsSorted.at(0)?.id.toBase58()).eq(
      vestingStream1PubKey.toBase58(),
    );
    expect(filteredVestingSubCategoryStreamsSorted.at(1)?.id.toBase58()).eq(
      vestingStream2PubKey.toBase58(),
    );

    const filteredDefaultSubCategoryStreams = await ps.listStreams({
      psAccount: psAccountPubKey,
      subCategory: SubCategory.default,
    });
    expect(filteredDefaultSubCategoryStreams.length).eq(3);
    expect(filteredDefaultSubCategoryStreams.at(0)?.id.toBase58()).eq(
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
      {
        owner: user1Wallet.publicKey,
        feePayer: user1Wallet.publicKey,
        mint: NATIVE_SOL_MINT,
      },
      psAccountName,
      AccountType.Open,
    );
    psAccount;

    await sendTestTransaction(
      connection,
      createAccountTx,
      [user1Wallet],
    );

    // add funds to PS account
    const { transaction: addFundsToAccountTx } =
      await ps.buildAddFundsToAccountTransaction(
        {
          psAccount,
          psAccountMint: NATIVE_SOL_MINT,
          contributor: user1Wallet.publicKey,
          feePayer: user1Wallet.publicKey,
        },
        3 * LAMPORTS_PER_SOL,
      );

    await partialSignSendAndConfirmTransaction(
      connection,
      addFundsToAccountTx,
      user1Wallet
    );

    // create a stream 1
    const stream1Name = 'STREAM-1';
    const { transaction: createStream1Tx, stream: psAccountStream1 } =
      await ps.buildCreateStreamTransaction(
        {
          psAccount,
          owner: user1Wallet.publicKey,
          feePayer: user1Wallet.publicKey,
          beneficiary: user2Wallet.publicKey,
        },
        stream1Name,
        0.1 * LAMPORTS_PER_SOL,
        1,
        1 * LAMPORTS_PER_SOL,
        new Date(),
      );

    await partialSignSendAndConfirmTransaction(
      connection,
      createStream1Tx,
      user1Wallet
    );

    // create a stream 2
    const stream2Name = 'STREAM-2';
    const { transaction: createStream2Tx, stream: psAccountStream2 } =
      await ps.buildCreateStreamTransaction(
        {
          psAccount,
          owner: user1Wallet.publicKey,
          feePayer: user1Wallet.publicKey,
          beneficiary: user2Wallet.publicKey,
        },
        stream2Name,
        0.2 * LAMPORTS_PER_SOL,
        1,
        1 * LAMPORTS_PER_SOL,
        new Date(),
      );

    await partialSignSendAndConfirmTransaction(
      connection,
      createStream2Tx,
      user1Wallet
    );

    // create a stream 3
    const stream3Name = 'STREAM-3';
    const { transaction: createStream3Tx, stream: psAccountStream3 } =
      await ps.buildCreateStreamTransaction(
        {
          psAccount,
          owner: user1Wallet.publicKey,
          feePayer: user1Wallet.publicKey,
          beneficiary: user2Wallet.publicKey,
        },
        stream3Name,
        0.1 * LAMPORTS_PER_SOL,
        1,
        1 * LAMPORTS_PER_SOL,
        new Date(),
      );

    await partialSignSendAndConfirmTransaction(
      connection,
      createStream3Tx,
      user1Wallet
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
      {
        owner: user1Wallet.publicKey,
        feePayer: user1Wallet.publicKey,
        mint: NATIVE_SOL_MINT,
      },
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

    await partialSignSendAndConfirmTransaction(
      connection,
      createVestingAccountTx,
      user1Wallet
    );

    // create vesting stream 1
    const vestingStream1Name = 'VESTING-STREAM-1';
    const { transaction: createStreamTx, stream: vestingAccountStream1 } =
      await ps.buildCreateVestingStreamTransaction(
        {
          vestingAccount,
          owner: user1Wallet.publicKey,
          feePayer: user1Wallet.publicKey,
          beneficiary: user2Wallet.publicKey,
        },
        1 * LAMPORTS_PER_SOL,
        vestingStream1Name,
      );

    await partialSignSendAndConfirmTransaction(
      connection,
      createStreamTx,
      user1Wallet
    );

    // create vesting stream 2
    const vestingStream2Name = 'VESTING-STREAM-2';
    const { transaction: createStreamTx2, stream: vestingAccountStream2 } =
      await ps.buildCreateVestingStreamTransaction(
        {
          vestingAccount,
          owner: user1Wallet.publicKey,
          feePayer: user1Wallet.publicKey,
          beneficiary: user2Wallet.publicKey,
        },
        1 * LAMPORTS_PER_SOL,
        vestingStream2Name,
      );

    await partialSignSendAndConfirmTransaction(
      connection,
      createStreamTx2,
      user1Wallet
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

  it('buildStreamPaymentTransaction', async () => {
    const owner1Key = Keypair.generate();
    const beneficiary1 = Keypair.generate().publicKey;
    const token1 = await Token.createMint(
      connection,
      testPayerKey,
      testPayerKey.publicKey,
      null,
      6,
      TOKEN_PROGRAM_ID,
    );
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash(commitment);
    await connection.confirmTransaction({
      signature: await connection.requestAirdrop(
        owner1Key.publicKey,
        LAMPORTS_PER_SOL,
      ),
      blockhash,
      lastValidBlockHeight,
    });

    const owner1Token = await token1.createAssociatedTokenAccount(
      owner1Key.publicKey,
    );

    await token1.mintTo(owner1Token, testPayerKey, [], 1_000_000);

    const { transaction: streamPaymentTx } =
      await ps.buildStreamPaymentTransaction(
        {
          owner: owner1Key.publicKey,
          beneficiary: beneficiary1,
          mint: token1.publicKey,
        },
        "Bob's payment",
        1_000_000,
        86400,
        1_000_000,
        new Date(),
        false,
      );

    streamPaymentTx.partialSign(owner1Key);

    await partialSignSendAndConfirmTransaction(
      connection,
      streamPaymentTx,
      owner1Key
    );
  });

  it('Enum casting', () => {
    const scheduled = 'Scheduled';
    const scheduledEnum = STREAM_STATUS_CODE[scheduled];
    // console.log(scheduled, scheduledEnum);
    assert.equal(scheduledEnum, 0);

    const running = 'Running';
    const runningEnum = STREAM_STATUS_CODE[running];
    // console.log(running, runningEnum);
    assert.equal(runningEnum, 1);

    const paused = 'Paused';
    const pausedEnum = STREAM_STATUS_CODE[paused];
    // console.log(paused, pausedEnum);
    assert.equal(pausedEnum, 2);
  });
});
