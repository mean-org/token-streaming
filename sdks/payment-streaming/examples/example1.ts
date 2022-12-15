/*

How to use:

1. start a `solana-test-validator` while cloning the
necessary account from devnet:

solana-test-validator -r\
  --clone MSPdQo5ZdrPh6rU1LsvUv5nRhAnj1mj6YQEqBUq8YwZ\
  --clone 5KRiDycCTp4HrHBJc15pjbPYquVbKYcHduJKeZieUXtD\
  --clone 3TD6SWY9M1mLY2kZWJNavPLhwXvcRsWdnZLRaMzERJBw\
  --clone 3KmMEv7A8R3MMhScQceXBQe69qLmnFfxSM3q8HyzkrSx\
  --url devnet

2. Run this script:
npx ts-node examples/example1.ts

*/

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  PaymentStreaming,
  PAYMENT_STREAMING_PROGRAM_ID_DEVNET,
  AccountType,
  NATIVE_SOL_MINT,
  PaymentStreamingAccount,
  Stream,
} from '../src';

const rpcUrl = 'http://localhost:8899';
const connection = new Connection(rpcUrl, 'confirmed');
const psClient = new PaymentStreaming(
  connection,
  PAYMENT_STREAMING_PROGRAM_ID_DEVNET,
  'confirmed',
);

const ownerKey = Keypair.generate();
const owner = ownerKey.publicKey;
const beneficiary1 = Keypair.generate().publicKey;
const beneficiary2 = Keypair.generate().publicKey;
console.log(`owner: ${owner}`);
console.log(`beneficiary1: ${beneficiary1}`);
console.log(`beneficiary2: ${beneficiary2}`);

// When the native SOL mint is used, the client will automatically wrap to WSOL
const mint = NATIVE_SOL_MINT;

async function runExample(): Promise<void> {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();

  await connection.confirmTransaction({
    signature: await connection.requestAirdrop(owner, 1_000_000_000),
    blockhash,
    lastValidBlockHeight,
  });

  // Create the Payment Streaming account
  console.log('\nCreating Payment Streaming account...');
  const { transaction: createAccountTx, psAccount } =
    await psClient.buildCreateAccountTransaction(
      {
        owner: owner, // authority over the newly created account
        mint: mint, // mint that will be streamed out of this account
      },
      'Airdrop', // name (label for the new account)
      AccountType.Open, // type (account type)
      true, // solFeePayedFromAccount (whether SOL protocol fees will be
      // payed from the new account SOL balance or by the payer account)
    );
  // Send transaction and wait for confirmation
  createAccountTx.partialSign(ownerKey);
  const createAccountTxId = await connection.sendRawTransaction(
    createAccountTx.serialize(),
  );
  await connection.confirmTransaction({
    signature: createAccountTxId,
    blockhash,
    lastValidBlockHeight,
  });

  // add funds to the Payment Streaming account
  console.log('\nAdding funds to the Payment Streaming account...');
  const { transaction: addFundsTx } =
    await psClient.buildAddFundsToAccountTransaction(
      {
        psAccount: psAccount,
        psAccountMint: mint,
        contributor: owner, // account authorizing the funds to be added
      }, // account paying for rent and SOL protocol fees
      500_000_000,
    );
  // Send transaction and wait for confirmation
  addFundsTx.partialSign(ownerKey);
  const addFundsTxId = await connection.sendRawTransaction(
    addFundsTx.serialize(),
  );
  await connection.confirmTransaction({
    signature: addFundsTxId,
    blockhash,
    lastValidBlockHeight,
  });

  // create stream 1
  console.log('\nCreating stream 1...');
  const { transaction: createStream1Tx, stream: stream1 } =
    await psClient.buildCreateStreamTransaction(
      {
        psAccount: psAccount,
        owner: owner, // owner of the cointaining PS account
        beneficiary: beneficiary1,
      },
      'Airdrop for Alice', // name
      1000, // rateAmount
      1, // rateIntervalInSeconds
      1_000_000, // allocationAssigned
      new Date(), // startUtc
    );

  // Send createStream1Tx and wait for confirmation
  createStream1Tx.partialSign(ownerKey);
  const createStream1TxId = await connection.sendRawTransaction(
    createStream1Tx.serialize(),
  );
  await connection.confirmTransaction({
    signature: createStream1TxId,
    blockhash,
    lastValidBlockHeight,
  });

  // create stream 2
  console.log('\nCreating stream 2...');
  const { transaction: createStream2Tx } =
    await psClient.buildCreateStreamTransaction(
      {
        psAccount: psAccount,
        owner: owner, // owner of the cointaining PS account
        beneficiary: beneficiary1,
      },
      'Airdrop for Bob', // name
      1000, // rateAmount
      1, // rateIntervalInSeconds
      300_000, // allocationAssigned
      new Date(), // startUtc
    );

  // Send createStream2Tx and wait for confirmation
  createStream2Tx.partialSign(ownerKey);
  const createStream2TxId = await connection.sendRawTransaction(
    createStream2Tx.serialize(),
  );
  await connection.confirmTransaction({
    signature: createStream2TxId,
    blockhash,
    lastValidBlockHeight,
  });

  // List payment streaming accounts
  console.log('\nListing Payment Streaming accounts...');
  const accounts = await psClient.listAccounts(owner);
  console.log(accounts.map(prettifyAccount));

  // List streams
  console.log('\nListing streams...');
  const streams = await psClient.listStreams({
    psAccount: psAccount,
  });
  console.log(streams.map(prettifyStream));

  // Get a single stream
  console.log('\nGetting stream1...');
  const stream1Fetched = await psClient.getStream(stream1);
  console.log(prettifyStream(stream1Fetched!));

  // List stream activity
  console.log('\nGetting stream1 activity...');
  const stream1Activity = await psClient.listStreamActivity(stream1);
  console.log(stream1Activity);
}

runExample().then().catch();

function prettifyAccount(account: PaymentStreamingAccount) {
  return {
    id: new PublicKey(account.id).toBase58(),
    name: account.name,
    autoClose: account.autoClose,
    createdOnUtc: account.createdOnUtc,
    AccountType: AccountType[account.accountType],
    owner: account.owner.toBase58(),
    mint: account.mint.toBase58(),
    balance: account.balance.toString(),
    allocationAsigned: account.allocationAssigned.toString(),
    totalWithdrawals: account.totalWithdrawals.toString(),
    totalStreams: account.totalStreams.toString(),
  };
}

function prettifyStream(stream: Stream) {
  return {
    id: stream.id.toBase58(),
    name: stream.name,
    startUtc: stream.startUtc,
    psAccountOwner: stream.psAccountOwner.toBase58(),
    psAccount: stream.psAccount.toBase58(),
    beneficiary: stream.psAccount.toBase58(),
    mint: stream.mint.toBase58(),
    cliffVestAmount: stream.cliffVestAmount.toString(),
    cliffVestPercent: stream.cliffVestPercent,
    allocationAssigned: stream.allocationAssigned.toString(),
    rateAmount: stream.rateAmount.toString(),
    rateIntervalInSeconds: stream.rateIntervalInSeconds,
    totalWithdrawalsAmount: stream.totalWithdrawalsAmount.toString(),
    fundsLeftInStream: stream.fundsLeftInStream.toString(),
    fundsSentToBeneficiary: stream.fundsSentToBeneficiary.toString(),
    remainingAllocationAmount: stream.remainingAllocationAmount.toString(),
    withdrawableAmount: stream.withdrawableAmount.toString(),
    streamUnitsPerSecond: stream.streamUnitsPerSecond,
    isManuallyPaused: stream.isManuallyPaused.toString(),
    statusCode: stream.statusCode,
    statusName: stream.statusName,
    tokenFeePayedFromAccount: stream.tokenFeePayedFromAccount,
    createdOnUtc: stream.createdOnUtc,
  };
}
