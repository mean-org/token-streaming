import * as chai from 'chai';
import { assert, expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);
import { AnchorError, Program, ProgramError } from '@project-serum/anchor';
import {
  Keypair,
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  Transaction,
  Signer,
  BlockheightBasedTransactionConfirmationStrategy,
  TransactionBlockhashCtor,
  TransactionInstruction,
} from '@solana/web3.js';
import fs from 'fs';
import * as instructions from '../src/instructions';

import {
  PaymentStreaming,
  sleep,
  NATIVE_SOL_MINT,
  FEE_ACCOUNT,
  SIMULATION_PUBKEY,
  Ps,
  createProgram,
  toUnixTimestamp,
} from '../src';
import {
  Category,
  AccountType,
  SubCategory,
  TimeUnit,
  STREAM_STATUS_CODE,
  ActivityActionCode,
} from '../src/types';
import BN from 'bn.js';
import { Token, TOKEN_PROGRAM_ID, u64 } from '@solana/spl-token';
import { ASSOCIATED_PROGRAM_ID } from '@project-serum/anchor/dist/cjs/utils/token';

const ZERO_BN = new BN(0);

console.log(`\nWorld State:`);

const PAYMENT_STREAMING_PROGRAM_ID =
  'MSPdQo5ZdrPh6rU1LsvUv5nRhAnj1mj6YQEqBUq8YwZ';

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
let psProgram: Program<Ps>;
let token: Token;

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

    token = await Token.createMint(
      connection,
      testPayerKey,
      testPayerKey.publicKey,
      null,
      6,
      TOKEN_PROGRAM_ID,
    );

    ps = new PaymentStreaming(
      connection,
      new PublicKey(PAYMENT_STREAMING_PROGRAM_ID),
      commitment,
    );
    psProgram = createProgram(connection, PAYMENT_STREAMING_PROGRAM_ID);

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

  it('Transfers tokens (direct transfer)', async () => {
    const actors = await setupTestActors({
      connection: connection,
      ownerTokenAmount: new BN(1000),
    });

    const { transaction: transferTx } = await ps.buildTransferTransaction(
      {
        sender: actors.owner,
        feePayer: actors.owner,
        beneficiary: actors.beneficiary,
        mint: actors.mint,
      },
      1000,
    );

    await partialSignSendAndConfirmTransaction(
      connection,
      transferTx,
      actors.ownerKey,
    );

    const beneficiaryTokenInfo = await actors.token.getAccountInfo(
      actors.beneficiaryToken,
    );
    assert.exists(beneficiaryTokenInfo);
    assert.equal(beneficiaryTokenInfo.amount.toString(), '1000');
  });

  it('Transfers SOL (direct transfer)', async () => {
    const owner1Key = Keypair.generate();
    const beneficiary1 = Keypair.generate().publicKey;

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

    // for this test we need to send an amount >= minimum rent so we cover
    // for rent exemption
    const minRent = await connection.getMinimumBalanceForRentExemption(0);
    const { transaction: transferTx } = await ps.buildTransferTransaction(
      {
        sender: owner1Key.publicKey,
        beneficiary: beneficiary1,
        mint: NATIVE_SOL_MINT,
      },
      minRent,
    );

    await partialSignSendAndConfirmTransaction(
      connection,
      transferTx,
      owner1Key,
    );

    const beneficiaryAccountInfo = await connection.getAccountInfo(
      beneficiary1,
    );
    assert.exists(beneficiaryAccountInfo);
    assert.equal(
      beneficiaryAccountInfo?.lamports.toString(),
      minRent.toString(),
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

    await sendTestTransaction(connection, createAccountTx, [user1Wallet]);

    // add funds to PS account
    const { transaction: addFundsToAccountTx } =
      await ps.buildAddFundsToAccountTransaction(
        {
          psAccount,
          psAccountMint: NATIVE_SOL_MINT,
          contributor: user1Wallet.publicKey,
          feePayer: user1Wallet.publicKey,
        },
        4 * LAMPORTS_PER_SOL,
      );

    await partialSignSendAndConfirmTransaction(
      connection,
      addFundsToAccountTx,
      user1Wallet,
    );

    // create a stream 1
    const stream1Name = 'STREAM-1';
    const { transaction: createStream1Tx, stream: stream1 } =
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
      user1Wallet,
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
      user1Wallet,
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
      user1Wallet,
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
      stream1,
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

  it('Withdraws from account (to owner)', async () => {
    // Prepare
    const { ownerKey, psAccount, ownerToken, token } = await setupAccount({
      connection,
      ownerInitialAmount: 1000,
      accountInitialAmount: 1000,
    });

    // Act
    const { transaction: withdrawFromAccountTx } =
      await ps.buildWithdrawFromAccountTransaction(
        {
          psAccount: psAccount,
          destination: ownerKey.publicKey,
        },
        300,
      );
    await partialSignSendAndConfirmTransaction(
      connection,
      withdrawFromAccountTx,
      ownerKey,
    );

    // Assert
    const account = await psProgram.account.treasury.fetch(psAccount);
    assert.exists(account);
    assert.equal(account.lastKnownBalanceUnits.toString(), '700');

    const ownerTokenInfo = await token.getAccountInfo(ownerToken);
    assert.exists(ownerTokenInfo);
    assert.equal(ownerTokenInfo.amount.toString(), '300');
  });

  it('Withdraws from account (to destination)', async () => {
    // Prepare
    const { ownerKey, psAccount, token } = await setupAccount({
      connection,
      ownerInitialAmount: 1000,
      accountInitialAmount: 1000,
    });

    const destination = Keypair.generate().publicKey;

    // Act
    const { transaction: withdrawFromAccountTx } =
      await ps.buildWithdrawFromAccountTransaction(
        {
          psAccount: psAccount,
          destination: destination,
        },
        300,
      );
    await partialSignSendAndConfirmTransaction(
      connection,
      withdrawFromAccountTx,
      ownerKey,
    );

    // Assert
    const account = await psProgram.account.treasury.fetch(psAccount);
    assert.exists(account);
    assert.equal(account.lastKnownBalanceUnits.toString(), '700');

    const destinationTokenInfo = await token.getOrCreateAssociatedAccountInfo(
      destination,
    );
    assert.exists(destinationTokenInfo);
    assert.equal(destinationTokenInfo.amount.toString(), '300');
  });

  it('Refreshes account data', async () => {
    // Prepare
    const { ownerKey, psAccount, psAccountToken, token } = await setupAccount({
      connection,
      ownerInitialAmount: 1000,
      accountInitialAmount: 1000,
    });

    // Act
    await token.mintTo(psAccountToken, testPayerKey, [], 300);
    let account = await psProgram.account.treasury.fetch(psAccount);
    assert.exists(account);
    assert.equal(account.lastKnownBalanceUnits.toString(), '1000');

    const { transaction: refreshAccountTx } =
      await ps.buildRefreshAccountDataTransaction({
        psAccount: psAccount,
        feePayer: ownerKey.publicKey,
      });
    await partialSignSendAndConfirmTransaction(
      connection,
      refreshAccountTx,
      ownerKey,
    );

    // Assert
    account = await psProgram.account.treasury.fetch(psAccount);
    assert.exists(account);
    assert.equal(account.lastKnownBalanceUnits.toString(), '1300');
  });

  it('Closes an account (send funds to owner)', async () => {
    // Prepare
    const { ownerKey, psAccount, ownerToken, token } = await setupAccount({
      connection,
      ownerInitialAmount: 1000,
      accountInitialAmount: 1000,
    });

    // Act
    const { transaction: closeAccountTx } =
      await ps.buildCloseAccountTransaction({
        psAccount: psAccount,
      });
    await partialSignSendAndConfirmTransaction(
      connection,
      closeAccountTx,
      ownerKey,
    );

    // Assert
    await expect(
      psProgram.account.treasury.fetch(psAccount),
    ).to.be.rejectedWith(`Account does not exist ${psAccount}`);

    const ownerTokenInfo = await token.getAccountInfo(ownerToken);
    assert.exists(ownerTokenInfo);
    assert.equal(ownerTokenInfo.amount.toString(), '1000');
  });

  it('Closes an account (send funds to destination)', async () => {
    // Prepare
    const { ownerKey, psAccount, token } = await setupAccount({
      connection,
      ownerInitialAmount: 1000,
      accountInitialAmount: 1000,
    });

    const destination = Keypair.generate().publicKey;

    // Act
    const { transaction: withdrawFromAccountTx } =
      await ps.buildCloseAccountTransaction({
        psAccount: psAccount,
        destination: destination,
      });
    await partialSignSendAndConfirmTransaction(
      connection,
      withdrawFromAccountTx,
      ownerKey,
    );

    // Assert
    await expect(
      psProgram.account.treasury.fetch(psAccount),
    ).to.be.rejectedWith(`Account does not exist ${psAccount}`);

    const destinationTokenInfo = await token.getOrCreateAssociatedAccountInfo(
      destination,
    );
    assert.exists(destinationTokenInfo);
    assert.equal(destinationTokenInfo.amount.toString(), '1000');
  });

  it('Allocates funds to a stream', async () => {
    // Prepare
    const { ownerKey, psAccount, beneficiary, stream } = await setupAccount({
      connection,
      ownerInitialAmount: 1500,
      accountInitialAmount: 1500,
      streamRateAmount: 1000,
      streamRateInterval: 1,
      streamAllocation: 1000,
    });

    // Act
    const { transaction: allocateToStreamTx } =
      await ps.buildAllocateFundsToStreamTransaction(
        {
          psAccount: psAccount,
          owner: ownerKey.publicKey,
          stream: stream,
        },
        500,
      );
    await partialSignSendAndConfirmTransaction(
      connection,
      allocateToStreamTx,
      ownerKey,
    );

    // Assert
    const streamAccount = await psProgram.account.stream.fetch(stream);
    assert.exists(streamAccount);
    assert.equal(
      streamAccount.treasurerAddress.toBase58(),
      ownerKey.publicKey.toBase58(),
    );
    assert.equal(
      streamAccount.beneficiaryAddress.toBase58(),
      beneficiary.toBase58(),
    );
    assert.equal(streamAccount.allocationAssignedUnits.toString(), '1500');
  });

  it('Funds a stream (add funds to account + allocate to stream)', async () => {
    // Prepare
    const { ownerKey, psAccount, beneficiary, stream } = await setupAccount({
      connection,
      ownerInitialAmount: 1500,
      accountInitialAmount: 1000,
      streamRateAmount: 1000,
      streamRateInterval: 1,
      streamAllocation: 1000,
    });

    // Act
    const { transaction: allocateToStreamTx } =
      await ps.buildFundStreamTransaction(
        {
          psAccount: psAccount,
          owner: ownerKey.publicKey,
          stream: stream,
        },
        500,
      );
    await partialSignSendAndConfirmTransaction(
      connection,
      allocateToStreamTx,
      ownerKey,
    );

    // Assert
    const streamAccount = await psProgram.account.stream.fetch(stream);
    assert.exists(streamAccount);
    assert.equal(
      streamAccount.treasurerAddress.toBase58(),
      ownerKey.publicKey.toBase58(),
    );
    assert.equal(
      streamAccount.beneficiaryAddress.toBase58(),
      beneficiary.toBase58(),
    );
    assert.equal(streamAccount.allocationAssignedUnits.toString(), '1500');
  });

  it('Fails to allocate to account with zero amount', async () => {
    await expect(
      ps.buildAllocateFundsToStreamTransaction(
        {
          psAccount: psAccountPubKey,
          owner: user1Wallet.publicKey,
          stream: psAccountStream1PubKey,
        },
        0,
      ),
    ).to.be.rejectedWith('Amount must be greater than 0');
  });

  it('Fails to allocate to account with wrong owner', async () => {
    await expect(
      ps.buildAllocateFundsToStreamTransaction(
        {
          psAccount: psAccountPubKey,
          owner: Keypair.generate().publicKey,
          stream: psAccountStream1PubKey,
        },
        1,
      ),
    ).to.be.rejectedWith('Invalid account owner');
  });

  it('Fails to allocate to non existing stream', async () => {
    await expect(
      ps.buildAllocateFundsToStreamTransaction(
        {
          psAccount: psAccountPubKey,
          owner: user1Wallet.publicKey,
          stream: Keypair.generate().publicKey,
        },
        1,
      ),
    ).to.be.rejectedWith('Stream account not found');
  });

  it('Streams a payment', async () => {
    const { ownerKey, beneficiary, mint } = await setupTestActors({
      connection,
      ownerLamports: LAMPORTS_PER_SOL,
      ownerTokenAmount: 1_000_000,
    });

    const { transaction: streamPaymentTx } =
      await ps.buildStreamPaymentTransaction(
        {
          owner: ownerKey.publicKey,
          beneficiary: beneficiary,
          mint: mint,
        },
        "Bob's payment",
        1_000_000,
        86400,
        1_000_000,
        new Date(),
        false,
      );

    await partialSignSendAndConfirmTransaction(
      connection,
      streamPaymentTx,
      ownerKey,
    );
  });

  it('Streams a SOL payment', async () => {
    const { ownerKey, beneficiary } = await setupTestActors({
      connection,
      ownerLamports: LAMPORTS_PER_SOL,
    });

    const { transaction: streamPaymentTx } =
      await ps.buildStreamPaymentTransaction(
        {
          owner: ownerKey.publicKey,
          beneficiary: beneficiary,
          mint: NATIVE_SOL_MINT,
        },
        "Bob's payment",
        1_000_000,
        86400,
        1_000_000,
        new Date(),
        false,
      );

    await partialSignSendAndConfirmTransaction(
      connection,
      streamPaymentTx,
      ownerKey,
    );
  });

  it('Schedules a transfer', async () => {
    const { ownerKey, beneficiary, mint } = await setupTestActors({
      connection: connection,
      ownerTokenAmount: new BN(1000),
    });

    const startDate = new Date(2050, 1, 1);

    const { transaction: transferTx, stream } =
      await ps.buildScheduleTransferTransaction(
        {
          owner: ownerKey.publicKey,
          beneficiary: beneficiary,
          mint: mint,
        },
        1000,
        startDate,
      );

    await partialSignSendAndConfirmTransaction(
      connection,
      transferTx,
      ownerKey,
    );

    const streamAccount = await psProgram.account.stream.fetch(stream);
    assert.exists(streamAccount);
    assert.equal(
      streamAccount.treasurerAddress.toBase58(),
      ownerKey.publicKey.toBase58(),
    );
    assert.equal(
      streamAccount.beneficiaryAddress.toBase58(),
      beneficiary.toBase58(),
    );
    assert.equal(streamAccount.allocationAssignedUnits.toString(), '1000');
    assert.equal(streamAccount.startUtc.toNumber(), toUnixTimestamp(startDate));
  });

  it('Schedules a SOL transfer', async () => {
    const { ownerKey, beneficiary } = await setupTestActors({
      connection: connection,
      ownerTokenAmount: new BN(1000),
    });

    const startDate = new Date(2050, 1, 1);

    const { transaction: transferTx, stream } =
      await ps.buildScheduleTransferTransaction(
        {
          owner: ownerKey.publicKey,
          beneficiary: beneficiary,
          mint: NATIVE_SOL_MINT,
        },
        1000,
        startDate,
      );

    await partialSignSendAndConfirmTransaction(
      connection,
      transferTx,
      ownerKey,
    );

    const streamAccount = await psProgram.account.stream.fetch(stream);
    assert.exists(streamAccount);
    assert.equal(
      streamAccount.treasurerAddress.toBase58(),
      ownerKey.publicKey.toBase58(),
    );
    assert.equal(
      streamAccount.beneficiaryAddress.toBase58(),
      beneficiary.toBase58(),
    );
    assert.equal(streamAccount.allocationAssignedUnits.toString(), '1000');
    assert.equal(streamAccount.startUtc.toNumber(), toUnixTimestamp(startDate));
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
      new Date(2040, 1, 1),
      10, // 10 %
    );

    await partialSignSendAndConfirmTransaction(
      connection,
      createVestingAccountTx,
      user1Wallet,
    );

    const parsedVestingAccount = await psProgram.account.treasury.fetch(
      vestingAccount,
    );
    assert.exists(parsedVestingAccount);
    assert.equal(parsedVestingAccount.treasuryType, AccountType.Open);
    assert.equal(parsedVestingAccount.category, Category.vesting);
    assert.equal(parsedVestingAccount.subCategory, SubCategory.seed);
    assert.equal(parsedVestingAccount.allocationAssignedUnits.toString(), '0');
    assert.equal(
      parsedVestingAccount.lastKnownBalanceUnits.toString(),
      (10 * LAMPORTS_PER_SOL).toString(),
    );

    let parsedVestingTemplate = await psProgram.account.streamTemplate.fetch(
      vestingAccountTemplate,
    );
    assert.exists(parsedVestingTemplate);
    assert.equal(parsedVestingTemplate.durationNumberOfUnits.toString(), '12');
    assert.equal(parsedVestingTemplate.rateIntervalInSeconds.toString(), '60');

    // update vesting account template
    const { transaction: updateVestinTx } =
      await ps.buildUpdateVestingTemplateTransaction(
        {
          owner: user1Wallet.publicKey,
          vestingAccount: vestingAccount,
        },
        6,
        TimeUnit.Hour,
        new Date(2050, 1, 1),
      );

    await partialSignSendAndConfirmTransaction(
      connection,
      updateVestinTx,
      user1Wallet,
    );

    parsedVestingTemplate = await psProgram.account.streamTemplate.fetch(
      vestingAccountTemplate,
    );
    assert.exists(parsedVestingTemplate);
    assert.equal(parsedVestingTemplate.durationNumberOfUnits.toString(), '6');
    assert.equal(
      parsedVestingTemplate.rateIntervalInSeconds.toString(),
      '3600',
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
      user1Wallet,
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
      user1Wallet,
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

    // list vesting activity
    const activity = await ps.listVestingAccountActivity(vestingAccount);
    assert.exists(activity);
    assert.isNotEmpty(activity);
    assert.equal(
      activity.filter(a => a.actionCode === ActivityActionCode.AccountCreated)
        .length,
      0,
    );
    assert.equal(
      activity.filter(
        a => a.actionCode === ActivityActionCode.AccountCreatedWithTemplate,
      ).length,
      1,
    );
    assert.equal(
      activity.filter(
        a => a.actionCode === ActivityActionCode.FundsAddedToAccount,
      ).length,
      1,
    );
    assert.equal(
      activity.filter(a => a.actionCode === ActivityActionCode.StreamCreated)
        .length,
      2,
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

//#region UTILS

async function partialSignSendAndConfirmTransaction(
  connection: Connection,
  transaction: Transaction,
  signer: Signer,
): Promise<string> {
  try {
    // Thre is a bug in solana's web3.js `sendAndConfirmRawTransaction` which
    // requieres the transaction signature thus preventing us from using that
    // method

    transaction.partialSign(signer);
    const rawTransaction = transaction.serialize();

    const signature = await connection.sendRawTransaction(rawTransaction);
    const status = (
      await connection.confirmTransaction({
        signature: signature,
        blockhash: transaction.recentBlockhash,
        lastValidBlockHeight: transaction.lastValidBlockHeight,
      } as BlockheightBasedTransactionConfirmationStrategy)
    ).value;

    if (status.err) {
      throw new Error(
        `Transaction ${signature} failed (${JSON.stringify(status)})`,
      );
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
        fs.readFileSync(filePath, {
          encoding: 'utf-8',
        }),
      ),
    ),
  );
}

type TestActors = {
  readonly owner: PublicKey;
  readonly ownerKey: Keypair;
  readonly ownerToken: PublicKey;
  readonly beneficiary: PublicKey;
  readonly beneficiaryKey: Keypair;
  readonly beneficiaryToken: PublicKey;
  readonly token: Token;
  readonly mint: PublicKey;
};

async function setupTestActors({
  connection,
  ownerLamports = LAMPORTS_PER_SOL,
  ownerTokenAmount,
  beneficiaryLamports = LAMPORTS_PER_SOL,
  beneficiaryTokenAmount,
}: {
  connection: Connection;
  ownerLamports?: number;
  ownerTokenAmount?: number | BN;
  beneficiaryLamports?: number;
  beneficiaryTokenAmount?: number | BN;
}): Promise<TestActors> {
  ownerTokenAmount = ownerTokenAmount ? new BN(ownerTokenAmount) : undefined;
  beneficiaryTokenAmount = beneficiaryTokenAmount
    ? new BN(beneficiaryTokenAmount)
    : undefined;

  const ownerKey = Keypair.generate();
  const beneficiaryKey = Keypair.generate();
  let ownerToken: PublicKey | undefined;
  let beneficiaryToken: PublicKey | undefined;

  if (
    !ownerLamports &&
    !ownerTokenAmount &&
    !beneficiaryLamports &&
    !beneficiaryTokenAmount
  ) {
    return {
      owner: ownerKey.publicKey,
      ownerKey,
      ownerToken: await Token.getAssociatedTokenAddress(
        ASSOCIATED_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        token.publicKey,
        ownerKey.publicKey,
        false,
      ),
      beneficiary: beneficiaryKey.publicKey,
      beneficiaryKey,
      beneficiaryToken: await Token.getAssociatedTokenAddress(
        ASSOCIATED_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        token.publicKey,
        beneficiaryKey.publicKey,
        false,
      ),
      token,
      mint: token.publicKey,
    };
  }

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash(commitment);

  if (ownerLamports > 0) {
    await connection.confirmTransaction({
      signature: await connection.requestAirdrop(
        ownerKey.publicKey,
        ownerLamports,
      ),
      blockhash,
      lastValidBlockHeight,
    });
  }

  if (ownerTokenAmount) {
    ownerToken = await token.createAssociatedTokenAccount(ownerKey.publicKey);
    if (ownerTokenAmount.gt(ZERO_BN)) {
      await token.mintTo(
        ownerToken,
        testPayerKey,
        [],
        new u64(ownerTokenAmount.toString()),
      );
    }
  }

  if (beneficiaryLamports > 0) {
    await connection.confirmTransaction({
      signature: await connection.requestAirdrop(
        beneficiaryKey.publicKey,
        beneficiaryLamports,
      ),
      blockhash,
      lastValidBlockHeight,
    });
  }

  if (beneficiaryTokenAmount) {
    beneficiaryToken = await token.createAssociatedTokenAccount(
      ownerKey.publicKey,
    );
    if (beneficiaryTokenAmount.gt(ZERO_BN)) {
      await token.mintTo(
        beneficiaryToken,
        testPayerKey,
        [],
        new u64(beneficiaryTokenAmount.toString()),
      );
    }
  }

  return {
    owner: ownerKey.publicKey,
    ownerKey,
    ownerToken:
      ownerToken ||
      (await Token.getAssociatedTokenAddress(
        ASSOCIATED_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        token.publicKey,
        ownerKey.publicKey,
        false,
      )),
    beneficiary: beneficiaryKey.publicKey,
    beneficiaryKey,
    beneficiaryToken:
      beneficiaryToken ||
      (await Token.getAssociatedTokenAddress(
        ASSOCIATED_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        token.publicKey,
        beneficiaryKey.publicKey,
        false,
      )),
    token,
    mint: token.publicKey,
  };
}

type AccountSetup = {
  readonly psAccount: PublicKey;
  psAccountToken: PublicKey;
  readonly stream: PublicKey;
} & TestActors;

async function setupAccount({
  connection,
  ownerInitialAmount = 0,
  accountInitialAmount = 0,
  streamRateAmount,
  streamRateInterval,
  streamAllocation,
}: {
  connection: Connection;
  ownerInitialAmount: number | BN;
  accountInitialAmount: number | BN;
  streamRateAmount?: number | BN;
  streamRateInterval?: number | BN;
  streamAllocation?: number | BN;
}): Promise<AccountSetup> {
  const {
    owner,
    ownerKey,
    ownerToken,
    beneficiary,
    beneficiaryKey,
    beneficiaryToken,
    mint,
  } = await setupTestActors({
    connection,
    ownerLamports: LAMPORTS_PER_SOL,
    ownerTokenAmount: ownerInitialAmount,
  });

  const {
    instruction: createAccountIx,
    psAccount,
    psAccountToken,
  } = await instructions.buildCreateAccountInstruction(
    psProgram,
    {
      owner: ownerKey.publicKey,
      feePayer: ownerKey.publicKey,
      mint: mint,
    },
    '',
    AccountType.Open,
    false,
    false,
  );
  const { instruction: addFundsIx, feeAccountToken } =
    await instructions.buildAddFundsInstruction(
      psProgram,
      {
        psAccount: psAccount,
        psAccountToken: psAccountToken,
        psAccountMint: mint,
        contributor: ownerKey.publicKey,
        contributorToken: ownerToken,
        feePayer: ownerKey.publicKey,
      },
      new BN(accountInitialAmount),
    );

  const tx = new Transaction().add(createAccountIx, addFundsIx);
  tx.feePayer = ownerKey.publicKey;
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash(commitment);
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;

  let stream: PublicKey | undefined = undefined;

  if (streamRateAmount && streamRateInterval && streamAllocation) {
    const { instruction: createStreamIx, stream: createdStream } =
      await instructions.buildCreateStreamInstruction(
        psProgram,
        {
          psAccount: psAccount,
          psAccountToken: psAccountToken,
          psAccountMint: mint,
          owner: ownerKey.publicKey,
          beneficiary: beneficiary,
          feePayer: ownerKey.publicKey,
          feeAccountToken: feeAccountToken,
        },
        '',
        new BN(streamRateAmount),
        new BN(streamRateInterval),
        new BN(streamAllocation),
        new BN(toUnixTimestamp(new Date())),
        ZERO_BN,
        ZERO_BN,
        false,
        true,
      );
    stream = createdStream;
    tx.add(createStreamIx);
  }

  await partialSignSendAndConfirmTransaction(connection, tx, ownerKey);

  return {
    psAccount,
    psAccountToken,
    stream: stream || PublicKey.default,
    owner,
    ownerKey,
    ownerToken,
    beneficiary,
    beneficiaryKey,
    beneficiaryToken,
    token,
    mint,
  };
}

//#endregion
