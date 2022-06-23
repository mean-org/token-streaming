// anchor test --provider.cluster localnet --provider.wallet ~/.config/solana/id.json --detach -- --features test
import { PublicKey, Keypair, Transaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, Token } from '@solana/spl-token';
import * as anchor from '@project-serum/anchor';
import { Program, BN, AnchorError } from '@project-serum/anchor';
import { Msp } from '../target/types/msp';
import { assert, expect } from 'chai';
import node_assert from 'assert';
import {
  connection,
  payer,
  createMspSetup,
  TREASURY_TYPE_OPEN,
  TREASURY_TYPE_LOCKED,
  TREASURY_ASSOCIATED_MINT_DECIMALS,
  sleep,
  ONE_SOL,
  MSP_WITHDRAW_FEE_PCT_NUMERATOR,
  MSP_FEE_PCT_DENOMINATOR,
  StreamEvent,
  expectAnchorError,
  LATEST_IDL_FILE_VERSION
} from './setup';

describe('msp', () => {
  let program: Program<Msp>;
  let fromTokenClient: Token = new Token(connection, PublicKey.default, TOKEN_PROGRAM_ID, payer); // dummy new to make it non-null; it will be overwritten soon;

  it('Initializes the state-of-the-world', async () => {
    const provider = anchor.AnchorProvider.env();

    anchor.setProvider(provider);
    program = anchor.workspace.Msp as Program<Msp>;

    // Airdropping tokens to a payer.
    await connection.confirmTransaction(await connection.requestAirdrop(payer.publicKey, 10000000000), 'confirmed');

    // Prevent 'Error: failed to send transaction: Transaction simulation failed: Transaction leaves an account with a lower balance than rent-exempt minimum' because fee account having zero sol
    // https://discord.com/channels/428295358100013066/517163444747894795/958728019973910578
    // https://discord.com/channels/428295358100013066/749579745645166592/956262753365008465
    await connection.confirmTransaction(
      await connection.requestAirdrop(new PublicKey('3TD6SWY9M1mLY2kZWJNavPLhwXvcRsWdnZLRaMzERJBw'), 10000000000),
      'confirmed'
    );

    fromTokenClient = await Token.createMint(
      connection,
      payer,
      payer.publicKey,
      null,
      TREASURY_ASSOCIATED_MINT_DECIMALS,
      TOKEN_PROGRAM_ID
    );
  });

  //#region ADD FUNDS

  it('create treasury -> add funds (unallocated) -> create stream -> allocate (fails because the treasury is locked)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_LOCKED,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});
    await mspSetup.addFunds({ amount: 100_000_000 });

    const nowBn = new anchor.BN(Date.now() / 1000);

    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );

    const streamKeypair = Keypair.generate();

    await mspSetup.createStream({
      name: 'test_stream',
      startTs: nowBn.toNumber(),
      rateAmountUnits: 10,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 100_000_000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });

    await mspSetup.addFunds({ amount: 50_000_000 });

    await node_assert.rejects(
      async () => {
        await mspSetup.allocate({
          amount: 50_000_000,
          stream: streamKeypair.publicKey
        });
      },
      (error: AnchorError) => {
        expectAnchorError(error, 6033, undefined, 'Can not allocate funds to a stream from a locked treasury');
        return true;
      }
    );
  });

  //#endregion

  it('create treasury (locked) -> add funds -> create stream -> (fails to add, pause, close non-paused stream)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_LOCKED,
      autoClose: false,
      treasurerFromInitialBalance: 100_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 50_000_000 });

    const nowBn = new anchor.BN(Date.now() / 1000);
    const startTs = nowBn.toNumber();

    const beneficiaryKeypair = Keypair.generate();
    const streamKeypair = Keypair.generate();

    await mspSetup.createStream({
      name: 'test_stream',
      startTs,
      rateAmountUnits: 10,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 50_000_000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });

    await node_assert.rejects(
      async () => {
        await mspSetup.pauseStream({
          stream: streamKeypair.publicKey,
          initializer: treasurerKeypair.publicKey,
          initializerKeypair: treasurerKeypair
        });
      },
      (error: AnchorError) => {
        expectAnchorError(
          error,
          6031,
          'PauseOrResumeLockedStreamNotAllowed',
          'Streams in a Locked treasury can not be paused or resumed'
        );
        return true;
      }
    );

    await mspSetup.addFunds({
      amount: 10_000_000
    });

    await node_assert.rejects(
      async () => {
        await mspSetup.allocate({
          amount: 10_000_000,
          stream: streamKeypair.publicKey
        });
      },
      (error: any) => {
        expectAnchorError(error, 6033, undefined, 'Can not allocate funds to a stream from a locked treasury');
        return true;
      }
    );

    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );
    const beneficiaryFrom = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mspSetup.fromMint,
      beneficiaryKeypair.publicKey,
      true
    );
    await node_assert.rejects(
      async () => {
        await mspSetup.closeStream({
          beneficiary: beneficiaryKeypair.publicKey,
          beneficiaryFrom,
          stream: streamKeypair.publicKey
        });
      },
      (error: any) => {
        expectAnchorError(error, 6030, undefined, 'Streams in a Locked treasury can not be closed while running');
        return true;
      }
    );
  });

  it("create treasury -> add funds -> create stream (schedulled) -> withdraw (should fail because stream hasn't started yet)", async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 100_000_000 });

    const nowBn = new anchor.BN(Date.now() / 1000);
    const startTs = nowBn.addn(10).toNumber();

    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );
    const beneficiaryFrom = await mspSetup.findTreasuryFromAssociatedTokenAddress(beneficiaryKeypair.publicKey);
    const streamKeypair = Keypair.generate();

    await mspSetup.createStream({
      name: 'test_stream',
      startTs,
      rateAmountUnits: 10,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 1000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });

    await node_assert.rejects(
      async () => {
        await mspSetup.withdraw({
          amount: 1,
          beneficiaryKeypair,
          beneficiary: beneficiaryKeypair.publicKey,
          beneficiaryFrom,
          stream: streamKeypair.publicKey
        });
      },
      (error: AnchorError) => {
        expectAnchorError(error, 6029, undefined, 'Stream has not started');
        return true;
      }
    );
  });

  // TODO: Transfer filtering in ui needs rateAmountUnits and rateIntervalInSeconds to be equal to zero
  // it('create treasury -> add funds -> create stream (fails with rate_amount_units = 0 and with rate_interval_in_seconds = 0)', async () => {
  //   const treasurerKeypair = Keypair.generate();

  //   const mspSetup = await createMspSetup(
  //     fromTokenClient,
  //     treasurerKeypair,
  //     "test_treasury",
  //     TREASURY_TYPE_OPEN,
  //     false,
  //     1000_000_000,
  //     1_000_000_000,
  //   )

  //   await mspSetup.createTreasury({});
  //   await mspSetup.addFunds({amount: 100_000_000});

  //   const nowBn = new anchor.BN(Date.now() / 1000);
  //   const beneficiaryKeypair = Keypair.generate();
  //   await mspSetup.connection.confirmTransaction(
  //     await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
  //     "confirmed"
  //   );
  //   const streamKeypair = Keypair.generate();

  //   await node_assert.rejects(async () => {
  //     await mspSetup.createStream(
  //       "test_stream",
  //       nowBn.toNumber(), // startUtc
  //       0,    // rateAmountUnits
  //       1,     // rateIntervalInSeconds
  //       1000,  // allocationAssignedUnits
  //       0,     // cliffVestAmountUnits
  //       0,     // cliffVestPercent

  //       treasurerKeypair, // initializerKeypair
  //       beneficiaryKeypair.publicKey, // beneficiary
  //       streamKeypair,
  //     );
  //   },
  //     (error: anchor.ProgramError) => {
  //       console.log(error);
  //       expect(error.code).eq(6034);
  //       expect(error.msg).eq("Invalid stream rate");
  //       return true;
  //     });

  //   await node_assert.rejects(async () => {
  //     await mspSetup.createStream(
  //       "test_stream",
  //       nowBn.toNumber(), // startUtc
  //       10,    // rateAmountUnits
  //       0,     // rateIntervalInSeconds
  //       1000,  // allocationAssignedUnits
  //       0,     // cliffVestAmountUnits
  //       0,     // cliffVestPercent

  //       treasurerKeypair, // initializerKeypair
  //       beneficiaryKeypair.publicKey, // beneficiary
  //       streamKeypair,
  //     );
  //   },
  //     (error: anchor.ProgramError) => {
  //       console.log(error);
  //       expect(error.code).eq(6034);
  //       expect(error.msg).eq("Invalid stream rate");
  //       return true;
  //     });

  // });

  it('create treasury -> add funds -> create stream -> withdraw', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});
    await mspSetup.addFunds({ amount: 100_000_000 });

    const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    console.log('nowTs:', nowTs);

    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );
    const streamKeypair = Keypair.generate();

    await mspSetup.createStream({
      name: 'test_stream',
      startTs: nowBn.toNumber(),
      rateAmountUnits: 10,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 1000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });

    const beneficiaryFrom = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mspSetup.fromMint,
      beneficiaryKeypair.publicKey,
      true
    );

    await sleep(3000);
    await mspSetup.withdraw({
      amount: 10,
      beneficiaryKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      beneficiaryFrom,
      stream: streamKeypair.publicKey
    });
  });

  it('create treasury -> add funds -> create stream (100% cliff) -> withdraw', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1_000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 100_000_000 });

    const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    console.log('nowTs:', nowTs);

    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );
    const streamKeypair = Keypair.generate();

    await mspSetup.createStream({
      name: 'test_stream',
      startTs: nowBn.toNumber(),
      rateAmountUnits: 10,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 100_000_000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 1_000_000,
      initializerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });

    const beneficiaryFrom = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mspSetup.fromMint,
      beneficiaryKeypair.publicKey,
      true
    );

    await sleep(3000);
    await mspSetup.withdraw({
      amount: 100_000_000,
      beneficiaryKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      beneficiaryFrom,
      stream: streamKeypair.publicKey
    });
  });

  it('create treasury (open) -> add funds -> create stream (100% cliff so all withdrawable from start) -> withdraw -> close stream', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 300_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 300_000_000 });

    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );
    const streamKeypair = Keypair.generate();

    const beneficiaryFrom = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mspSetup.fromMint,
      beneficiaryKeypair.publicKey,
      true
    );

    const nowBn = new anchor.BN(Date.now() / 1000);

    await mspSetup.createStream({
      name: 'test_stream',
      startTs: nowBn.toNumber(),
      rateAmountUnits: 10,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 100_000_000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 1_000_000,
      initializerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });

    await sleep(3000);
    await mspSetup.withdraw({
      amount: 100_000_000,
      beneficiaryKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      beneficiaryFrom,
      stream: streamKeypair.publicKey
    });

    const preTreasurerFromAmount = new BN(
      (await connection.getTokenAccountBalance(mspSetup.treasurerFrom)).value.amount
    ).toNumber();
    expect(preTreasurerFromAmount).eq(0);

    const preTreasuryFromAmount = new BN(
      (await connection.getTokenAccountBalance(mspSetup.treasuryFrom)).value.amount
    ).toNumber();
    expect(preTreasuryFromAmount).eq(200_000_000);

    const beneficiaryFromAmount = new BN(
      (await connection.getTokenAccountBalance(beneficiaryFrom)).value.amount
    ).toNumber();
    expect(beneficiaryFromAmount).eq(99_750_000);

    await mspSetup.closeStream({
      beneficiary: beneficiaryKeypair.publicKey,
      beneficiaryFrom,
      stream: streamKeypair.publicKey
    });

    const postTreasurerFromAmount = new BN(
      (await connection.getTokenAccountBalance(mspSetup.treasurerFrom)).value.amount
    ).toNumber();
    expect(postTreasurerFromAmount).eq(0, 'incorrect amount retured to treasurer after closing a stream');

    const postTreasuryFromAmount = new BN(
      (await connection.getTokenAccountBalance(mspSetup.treasuryFrom)).value.amount
    ).toNumber();
    expect(postTreasuryFromAmount).eq(200_000_000, 'incorrect amount left in treasury after closing a stream');

    const postBeneficiaryFromAmount = new BN(
      (await connection.getTokenAccountBalance(beneficiaryFrom)).value.amount
    ).toNumber();
    expect(postBeneficiaryFromAmount).eq(99_750_000, 'incorrect amount retured to beneficiary after closing a stream');
  });

  it('create treasury -> add funds -> create stream (SCHEDULED) -> withdraw (Fails since Stream is Scheduled)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1_000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 100_000_000 });

    const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    console.log('nowTs:', nowTs);

    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );
    const streamKeypair = Keypair.generate();

    await mspSetup.createStream({
      name: 'test_stream',
      startTs: nowBn.addn(60).toNumber(), // scheduled to 1 min after created
      rateAmountUnits: 10,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 100_000_000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 1_000_000,
      initializerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });

    const beneficiaryFrom = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mspSetup.fromMint,
      beneficiaryKeypair.publicKey,
      true
    );

    await sleep(3000);

    try {
      const txId = await mspSetup.withdraw({
        amount: 100_000_000,
        beneficiaryKeypair,
        beneficiary: beneficiaryKeypair.publicKey,
        beneficiaryFrom,
        stream: streamKeypair.publicKey
      });
      console.log(txId);
    } catch (error: any) {
      assert.isNotNull(error, 'Unknown error');
      assert.isNotNull(error.code, 'Unknown error');
      expect(error.code === 6029, 'Stream already running');
    }
  });

  it('create treasury -> add funds -> create stream (100% cliff) -> withdraw (100%) -> withdraw (Fails since Stream is lack of funds)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1_000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 100_000_000 });

    const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    console.log('nowTs:', nowTs);

    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );
    const streamKeypair = Keypair.generate();

    await mspSetup.createStream({
      name: 'test_stream',
      startTs: nowBn.toNumber(),
      rateAmountUnits: 10,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 100_000_000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 1_000_000,
      initializerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });

    const beneficiaryFrom = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mspSetup.fromMint,
      beneficiaryKeypair.publicKey,
      true
    );

    await sleep(3000);
    await mspSetup.withdraw({
      amount: 100_000_000,
      beneficiaryKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      beneficiaryFrom,
      stream: streamKeypair.publicKey
    });

    // try to withdraw again fails since the stream is lack of funds and is paused
    // (withdrawable amount is zero)
    try {
      const txId = await mspSetup.withdraw({
        amount: 100_000_000,
        beneficiaryKeypair,
        beneficiary: beneficiaryKeypair.publicKey,
        beneficiaryFrom,
        stream: streamKeypair.publicKey
      });
      console.log(txId);
    } catch (error: any) {
      assert.isNotNull(error, 'Unknown error');
      assert.isNotNull(error.code, 'Unknown error');
      expect(error.code === 6028, 'Stream already running');
    }
  });

  it('create treasury -> add funds -> create stream -> add funds -> allocate -> withdraw', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});
    await mspSetup.addFunds({ amount: 100_000_000 });

    const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    console.log('nowTs:', nowTs);

    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );

    const streamKeypair = Keypair.generate();

    await mspSetup.createStream({
      name: 'test_stream',
      startTs: nowBn.toNumber(),
      rateAmountUnits: 10,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 1000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });

    await sleep(1000);

    await mspSetup.addFunds({ amount: 50_000_000 });

    await mspSetup.allocate({
      amount: 50_000_000,
      stream: streamKeypair.publicKey
    });

    const beneficiaryFrom = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mspSetup.fromMint,
      beneficiaryKeypair.publicKey,
      true
    );

    await sleep(3000);
    await mspSetup.withdraw({
      amount: 10,
      beneficiaryKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      beneficiaryFrom,
      stream: streamKeypair.publicKey
    });
  });

  it('create treasury -> add funds -> create stream -> close stream (as a beneficiary: should fail)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 100_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 100_000_000 });

    const slot = await mspSetup.connection.getSlot('finalized');
    const nowTs = (await mspSetup.connection.getBlockTime(slot)) as number;
    // const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    const startTs = nowBn.addn(10).toNumber();
    console.log('nowTs:', nowTs);

    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );

    const beneficiaryFrom = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mspSetup.fromMint,
      beneficiaryKeypair.publicKey,
      true
    );

    const streamKeypair = Keypair.generate();

    await mspSetup.createStream({
      name: 'test_stream',
      startTs,
      rateAmountUnits: 10,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 100_000_000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      initializerKeypair: beneficiaryKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });

    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );

    await sleep(3_000);

    await node_assert.rejects(
      async () => {
        await mspSetup.closeStream({
          beneficiary: beneficiaryKeypair.publicKey,
          beneficiaryFrom,
          stream: streamKeypair.publicKey,
          signers: [beneficiaryKeypair] // <-- injecting unauthorized signer
        });
      },
      (error: any) => {
        assert.ok(error.toString().includes('unknown signer'));
        return true;
      }
    );
  });

  it('create treasury -> add funds -> create stream -> close stream (as a treasurer)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 100_000_000 });

    const slot = await mspSetup.connection.getSlot('finalized');
    const nowTs = (await mspSetup.connection.getBlockTime(slot)) as number;
    // const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    const startTs = nowBn.addn(10).toNumber();
    console.log('nowTs:', nowTs);

    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(treasurerKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );

    const beneficiary = Keypair.generate().publicKey;
    const beneficiaryFrom = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mspSetup.fromMint,
      beneficiary,
      true
    );

    const streamKeypair = Keypair.generate();

    await mspSetup.createStream({
      name: 'test_stream',
      startTs,
      rateAmountUnits: 10,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 1000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      beneficiary: beneficiary,
      streamKeypair
    });

    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiary, 1_000_000_000),
      'confirmed'
    );

    await sleep(3_000);

    await mspSetup.closeStream({
      beneficiary,
      beneficiaryFrom,
      stream: streamKeypair.publicKey
    });
  });

  it('create treasury -> add funds -> create stream -> close stream (as a treasurer) -> close treasury', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'v2t4_open_2022-02-02',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({
      amount: 1_000_000
    });

    const slot = await mspSetup.connection.getSlot('finalized');
    const nowTs = (await mspSetup.connection.getBlockTime(slot)) as number;
    // const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    const startTs = nowBn.toNumber();
    console.log('nowTs:', nowTs);

    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(treasurerKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );

    const beneficiary = Keypair.generate().publicKey;
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiary, 1_000_000_000),
      'confirmed'
    );
    const beneficiaryFrom = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mspSetup.fromMint,
      beneficiary,
      true
    );

    const streamKeypair1 = Keypair.generate();

    await mspSetup.createStream({
      name: 'test_stream',
      startTs,
      rateAmountUnits: 500_000,
      rateIntervalInSeconds: 2_629_750,
      allocationAssignedUnits: 500_000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      beneficiary,
      streamKeypair: streamKeypair1
    });

    await sleep(3_000);

    await mspSetup.closeStream({
      beneficiary,
      beneficiaryFrom,
      stream: streamKeypair1.publicKey
    });

    await sleep(1_000);

    const postState = await mspSetup.getMspWorldState();
    const postStateStream = await mspSetup.program.account.stream.fetchNullable(streamKeypair1.publicKey);
    assert.isNull(postStateStream, 'Stream was not closed');
    assert.isNotNull(postState.treasuryAccountInfo, 'Treasury was closed');
    assert.isNotNull(postState.treasuryFromAccountInfo, 'Treasury associated token was closed');
  });

  it('create treasury -> add funds -> create stream -> transfer stream', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});
    await mspSetup.addFunds({ amount: 100_000_000 });

    const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    const startTs = nowBn.addn(10).toNumber();
    console.log('nowTs:', nowTs);

    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(treasurerKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );

    const beneficiaryKeypair = Keypair.generate();
    const streamKeypair = Keypair.generate();
    await mspSetup.createStream({
      name: 'test_stream',
      startTs,
      rateAmountUnits: 10,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 1000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });

    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );

    const newBeneficiaryKeypair = Keypair.generate();

    await mspSetup.transferStream({
      stream: streamKeypair.publicKey,
      beneficiary: beneficiaryKeypair.publicKey,
      beneficiaryKeypair: beneficiaryKeypair,
      newBeneficiary: newBeneficiaryKeypair.publicKey
    });
  });

  it('get stream (event)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 100_000_000 });

    const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    console.log('nowTs:', nowTs);

    const beneficiaryKeypair = Keypair.generate();
    const streamKeypair = Keypair.generate();
    const streamStartTs = nowBn.addn(1);

    await mspSetup.createStream({
      name: 'test_stream',
      startTs: streamStartTs.toNumber(),
      rateAmountUnits: 10,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 1000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });

    await sleep(3000);
    const streamEvent = await mspSetup.getStream({
      feePayerKeypair: treasurerKeypair,
      stream: streamKeypair.publicKey
    });
    const beneficiaryFromAta = await mspSetup.findTreasuryFromAssociatedTokenAddress(beneficiaryKeypair.publicKey);

    expect(streamEvent).to.exist;

    expect(streamEvent!.version).eq(2, 'incorrect version');
    expect(streamEvent!.initialized).eq(true, 'incorrect initialized');
    // console.log(streamEvent.name.length);
    // expect(streamEvent.name.length).eq("test_stream".length, "incorrect stream name lenght") // uncomment
    // expect(streamEvent.name).eq("test_stream", "incorrect stream name");
    expect(streamEvent!.name.trimEnd()).eq('test_stream', 'incorrect ???'); // TODO: remove this line and uncomment the one above
    expect(streamEvent!.treasurerAddress.toBase58()).eq(
      treasurerKeypair.publicKey.toBase58(),
      'incorrect treasurerAddress'
    );
    expect(streamEvent!.rateAmountUnits.toNumber()).eq(10, 'incorrect rateAmountUnits');
    expect(streamEvent!.rateIntervalInSeconds.toNumber()).eq(1, 'incorrect rateIntervalInSeconds');
    expect(streamEvent!.startUtc.toNumber()).eq(streamStartTs.toNumber(), 'incorrect startUtc');
    expect(streamEvent!.cliffVestAmountUnits.toNumber()).eq(0, 'incorrect cliffVestAmountUnits');
    expect(streamEvent!.cliffVestPercent.toNumber()).eq(0, 'incorrect cliffVestPercent');
    expect(streamEvent!.beneficiaryAddress.toBase58()).eq(
      beneficiaryKeypair.publicKey.toBase58(),
      'incorrect beneficiaryAddress'
    );
    expect(streamEvent!.beneficiaryAssociatedToken.toBase58()).eq(
      mspSetup.fromMint.toBase58(),
      'incorrect beneficiaryAssociatedToken (Mint)'
    );
    expect(streamEvent!.treasuryAddress.toBase58()).eq(mspSetup.treasury.toBase58(), 'incorrect treasuryAddress');
    expect(streamEvent!.allocationAssignedUnits.toNumber()).eq(1000, 'incorrect allocationAssignedUnits');
    expect(streamEvent!.allocationReservedUnits.toNumber()).eq(0, 'incorrect allocationReservedUnits');
    expect(streamEvent!.totalWithdrawalsUnits.toNumber()).eq(0, 'incorrect totalWithdrawalsUnits'); // it should be 10 afer 1 elapsed second
    expect(streamEvent!.lastWithdrawalUnits.toNumber()).eq(0, 'incorrect lastWithdrawalUnits');
    expect(streamEvent!.lastWithdrawalSlot.toNumber()).eq(0, 'incorrect lastWithdrawalSlot');
    expect(streamEvent!.lastWithdrawalBlockTime.toNumber()).eq(0, 'incorrect lastWithdrawalBlockTime');
    expect(streamEvent!.lastManualStopWithdrawableUnitsSnap.toNumber()).eq(
      0,
      'incorrect lastManualStopWithdrawableUnitsSnap'
    );
    expect(streamEvent!.lastManualStopSlot.toNumber()).eq(0, 'incorrect lastManualStopSlot');
    expect(streamEvent!.lastManualStopBlockTime.toNumber()).eq(0, 'incorrect lastManualStopBlockTime');
    expect(streamEvent!.lastManualResumeRemainingAllocationUnitsSnap.toNumber()).eq(
      0,
      'incorrect lastManualResumeRemainingAllocationUnitsSnap'
    );
    expect(streamEvent!.lastManualResumeSlot.toNumber()).eq(0, 'incorrect lastManualResumeSlot');
    expect(streamEvent!.lastManualResumeBlockTime.toNumber()).eq(0, 'incorrect lastManualResumeBlockTime');
    expect(streamEvent!.lastKnownTotalSecondsInPausedStatus.toNumber()).eq(
      0,
      'incorrect lastKnownTotalSecondsInPausedStatus'
    );
    expect(streamEvent!.lastAutoStopBlockTime.toNumber()).eq(0, 'incorrect lastAutoStopBlockTime');
    expect(streamEvent!.status).eq('Running', 'incorrect status'); // TODO
    expect(streamEvent!.isManualPause).eq(false, 'incorrect isManualPause');
    expect(streamEvent!.cliffUnits.toNumber()).eq(0, 'incorrect cliffUnits');
    expect(streamEvent!.currentBlockTime.toNumber()).gte(
      parseInt((nowBn.toNumber() / 1000).toString()),
      'incorrect currentBlockTime'
    ); //

    expect(streamEvent!.secondsSinceStart.toNumber()).gte(1, 'incorrect secondsSinceStart');
    // expect(streamEvent.estDepletionTime.toNumber()).eq(, "incorrect ???");
    // expect(streamEvent!.streamedUnitsPerSecond).eq(10, "incorrect streamedUnitsPerSecond"); // TODO: how is this different than rateAmountUnits ???

    const fundsLeft = streamEvent!.allocationAssignedUnits.sub(streamEvent!.totalWithdrawalsUnits).sub(new BN(10));

    expect(streamEvent!.fundsLeftInStream.toNumber()).gte(fundsLeft.subn(10).toNumber(), 'incorrect fundsLeftInStream');
    expect(streamEvent!.fundsLeftInStream.toNumber()).lte(fundsLeft.addn(10).toNumber(), 'incorrect fundsLeftInStream');

    expect(streamEvent!.fundsSentToBeneficiary.toNumber()).gte(0, 'incorrect fundsSentToBeneficiary'); // TODO: 'sent' here is missleading
    expect(streamEvent!.fundsSentToBeneficiary.toNumber()).lte(20, 'incorrect fundsSentToBeneficiary'); // TODO: 'sent' here is missleading

    expect(streamEvent!.withdrawableUnitsWhilePaused.toNumber()).eq(0, 'incorrect withdrawableUnitsWhilePaused');

    expect(streamEvent!.nonStopEarningUnits.toNumber()).gte(0, 'incorrect nonStopEarningUnits');
    expect(streamEvent!.nonStopEarningUnits.toNumber()).lte(20, 'incorrect nonStopEarningUnits');

    expect(streamEvent!.missedUnitsWhilePaused.toNumber()).eq(0, 'incorrect missedUnitsWhilePaused');

    expect(streamEvent!.entitledEarningsUnits.toNumber()).gte(0, 'incorrect entitledEarningsUnits');
    expect(streamEvent!.entitledEarningsUnits.toNumber()).lte(20, 'incorrect entitledEarningsUnits');

    expect(streamEvent!.withdrawableUnitsWhileRunning.toNumber()).gte(0, 'incorrect withdrawableUnitsWhileRunning');
    expect(streamEvent!.withdrawableUnitsWhileRunning.toNumber()).lte(20, 'incorrect withdrawableUnitsWhileRunning');

    expect(streamEvent!.beneficiaryRemainingAllocation.toNumber()).eq(1000, 'incorrect beneficiaryRemainingAllocation'); // same as allocation since any withdraw has been done

    expect(streamEvent!.beneficiaryWithdrawableAmount.toNumber()).gte(0, 'incorrect beneficiaryWithdrawableAmount'); // TODO: how is this different than totalWithdrawalsUnits ???
    expect(streamEvent!.beneficiaryWithdrawableAmount.toNumber()).lte(20, 'incorrect beneficiaryWithdrawableAmount');

    expect(streamEvent!.lastKnownStopBlockTime.toNumber()).eq(0, 'incorrect lastKnownStopBlockTime');
  });

  it('create treasury -> add funds -> create stream -> pause stream -> pause stream (error already paused)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 100_000_000 });

    const slot = await mspSetup.connection.getSlot('finalized');
    const nowTs = (await mspSetup.connection.getBlockTime(slot)) as number;
    // const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    console.log('nowTs:', nowTs);

    const beneficiaryKeypair = Keypair.generate();
    const streamKeypair = Keypair.generate();
    const streamStartTs = nowBn.addn(1);

    await mspSetup.createStream({
      name: 'test_stream',
      startTs: streamStartTs.toNumber(),
      rateAmountUnits: 10,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 1000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });

    await sleep(3_000);
    await mspSetup.pauseStream({
      stream: streamKeypair.publicKey,
      initializer: treasurerKeypair.publicKey,
      initializerKeypair: treasurerKeypair
    });
    await sleep(1_000);

    await node_assert.rejects(
      async () => {
        const txId = await mspSetup.pauseStream({
          stream: streamKeypair.publicKey,
          initializer: treasurerKeypair.publicKey,
          initializerKeypair: treasurerKeypair
        });
        console.log(txId);
      },
      (error: any) => {
        assert.isNotNull(error, 'Unknown error');
        assert.isNotNull(error.code, 'Unknown error');
        expect(error.code === 6025, 'Stream already paused');
        return true;
      }
    );
  });

  it('create treasury -> add funds -> create stream -> pause stream (after 3 seconds running) -> resume stream', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 100_000_000 });

    const slot = await mspSetup.connection.getSlot('finalized');
    const nowTs = (await mspSetup.connection.getBlockTime(slot)) as number;
    // const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    console.log('nowTs:', nowTs);

    const beneficiaryKeypair = Keypair.generate();
    const streamKeypair = Keypair.generate();
    const streamStartTs = nowBn.addn(1);

    await mspSetup.createStream({
      name: 'test_stream',
      startTs: streamStartTs.toNumber(),
      rateAmountUnits: 10,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 1000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });

    await sleep(3_000);
    await mspSetup.pauseStream({
      stream: streamKeypair.publicKey,
      initializer: treasurerKeypair.publicKey,
      initializerKeypair: treasurerKeypair
    });

    const preStreamEventResponse = await mspSetup.program.simulate.getStream(LATEST_IDL_FILE_VERSION, {
      accounts: { stream: streamKeypair.publicKey }
    });
    const preStateStream = preStreamEventResponse.events[0].data;
    assert.isNotNull(preStateStream, 'pre-state stream was not found');
    assert.equal(
      preStateStream.treasurerAddress.toBase58(),
      treasurerKeypair.publicKey.toBase58(),
      'stream treasurer is not valid'
    );

    const txId = await mspSetup.resumeStream({
      stream: streamKeypair.publicKey,
      initializer: treasurerKeypair.publicKey,
      initializerKeypair: treasurerKeypair
    });
    console.log(txId);
  });

  it('create treasury -> add funds -> create stream -> pause stream (after 3 seconds running) -> resume stream -> withdraw', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({
      amount: 5_000_000
    });
    const nowBn = new anchor.BN(Date.now() / 1000);
    console.log('nowTs:', nowBn.toNumber());

    await mspSetup.refreshTreasuryData({});

    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );
    // const beneficiaryFrom = await Token.getAssociatedTokenAddress(
    //   ASSOCIATED_TOKEN_PROGRAM_ID,
    //   TOKEN_PROGRAM_ID,
    //   mspSetup.fromMint,
    //   beneficiaryKeypair.publicKey,
    //   true
    // );
    const streamKeypair = Keypair.generate();
    // const streamStartTs = nowBn.addn(1);

    await mspSetup.createStream({
      name: 'test_stream',
      startTs: nowBn.toNumber(),
      rateAmountUnits: 250000,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 5_000_000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });

    await mspSetup.refreshTreasuryData({});

    await mspSetup.addFunds({
      amount: 250_000
    });

    await mspSetup.allocate({
      amount: 250_000,
      stream: streamKeypair.publicKey
    });

    await mspSetup.refreshTreasuryData({});

    // await mspSetup.addFunds(
    //   1_000_000,
    //   StreamAllocationType.AssignToSpecificStream,
    //   undefined,
    //   undefined,
    //   undefined,
    //   streamKeypair.publicKey,
    //   );

    // await mspSetup.addFunds(
    //   1_000_000,
    //   StreamAllocationType.AssignToSpecificStream,
    //   undefined,
    //   undefined,
    //   undefined,
    //   streamKeypair.publicKey,
    //   );

    await sleep(1000);
    await mspSetup.pauseStream({
      stream: streamKeypair.publicKey,
      initializer: treasurerKeypair.publicKey,
      initializerKeypair: treasurerKeypair
    });

    await mspSetup.resumeStream({
      stream: streamKeypair.publicKey,
      initializer: treasurerKeypair.publicKey,
      initializerKeypair: treasurerKeypair
    });

    // await sleep(5000);
    // await mspSetup.withdraw(8_000_000, beneficiaryKeypair, beneficiaryKeypair.publicKey, beneficiaryFrom, streamKeypair.publicKey);

    const beneficiary2Keypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiary2Keypair.publicKey, 1_000_000_000),
      'confirmed'
    );
    // const beneficiary2From = await Token.getAssociatedTokenAddress(
    //   ASSOCIATED_TOKEN_PROGRAM_ID,
    //   TOKEN_PROGRAM_ID,
    //   mspSetup.fromMint,
    //   beneficiary2Keypair.publicKey,
    //   true
    // );
    const stream2Keypair = Keypair.generate();
    // const streamStartTs = nowBn.addn(1);
    await node_assert.rejects(
      async () => {
        await mspSetup.createStream({
          name: 'test_stream',
          startTs: nowBn.toNumber(),
          rateAmountUnits: 100000,
          rateIntervalInSeconds: 1,
          allocationAssignedUnits: 500_000,
          cliffVestAmountUnits: 0,
          cliffVestPercent: 0,
          initializerKeypair: treasurerKeypair,
          beneficiary: beneficiary2Keypair.publicKey,
          streamKeypair: stream2Keypair,
          feePayedByTreasurer: true
        });
      },
      (error: AnchorError) => {
        expectAnchorError(error, 6039, undefined, 'Insufficient treasury balance');
        return true;
      }
    );

    // await mspSetup.addFunds(
    //   500_000,
    //   StreamAllocationType.AssignToSpecificStream,
    //   undefined,
    //   undefined,
    //   undefined,
    //   stream2Keypair.publicKey,
    //   );

    // // close s2
    // await mspSetup.closeStream(treasurerKeypair, beneficiary2Keypair.publicKey, beneficiary2From, stream2Keypair.publicKey, true);

    // // close s1

    // await mspSetup.closeStream(treasurerKeypair, beneficiaryKeypair.publicKey, beneficiaryFrom, streamKeypair.publicKey, false);
  });

  it('create treasury -> add funds -> create stream -> resume stream (error stream already running)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 100_000_000 });

    const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    console.log('nowTs:', nowTs);

    const beneficiaryKeypair = Keypair.generate();
    const streamKeypair = Keypair.generate();
    const streamStartTs = nowBn.addn(1);

    await mspSetup.createStream({
      name: 'test_stream',
      startTs: streamStartTs.toNumber(),
      rateAmountUnits: 10,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 1000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });

    await sleep(3_000);

    await node_assert.rejects(
      async () => {
        const txId = await mspSetup.resumeStream({
          stream: streamKeypair.publicKey,
          initializer: treasurerKeypair.publicKey,
          initializerKeypair: treasurerKeypair
        });
        console.log(txId);
      },
      (error: any) => {
        assert.isNotNull(error, 'Unknown error');
        assert.isNotNull(error.code, 'Unknown error');
        expect(error.code === 6024, 'Stream already running');
        return true;
      }
    );
  });

  it('create lock treasury -> add funds -> create stream -> pause stream (error trying to pause a lock stream)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_LOCKED,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 100_000_000 });

    const slot = await mspSetup.connection.getSlot('finalized');
    const nowTs = (await mspSetup.connection.getBlockTime(slot)) as number;
    // const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    console.log('nowTs:', nowTs);

    const beneficiaryKeypair = Keypair.generate();
    const streamKeypair = Keypair.generate();
    const streamStartTs = nowBn.addn(1);

    await mspSetup.createStream({
      name: 'test_stream',
      startTs: streamStartTs.toNumber(),
      rateAmountUnits: 10,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 1000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });

    await sleep(3_000);

    await node_assert.rejects(
      async () => {
        const txId = await mspSetup.pauseStream({
          stream: streamKeypair.publicKey,
          initializer: treasurerKeypair.publicKey,
          initializerKeypair: treasurerKeypair
        });
        console.log(txId);
      },
      (error: any) => {
        assert.isNotNull(error, 'Unknown error');
        assert.isNotNull(error.code, 'Unknown error');
        expect(error.code === 6031, 'Streams in a Lock treasury can not be paused');
        return true;
      }
    );
  });

  it('create lock treasury -> add funds -> create stream -> close stream (error trying to close a lock stream while running)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 100_000_000 });

    const slot = await mspSetup.connection.getSlot('finalized');
    const nowTs = (await mspSetup.connection.getBlockTime(slot)) as number;
    // const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    console.log('nowTs:', nowTs);

    const beneficiary = Keypair.generate().publicKey;
    const beneficiaryFrom = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mspSetup.fromMint,
      beneficiary,
      true
    );

    const streamKeypair = Keypair.generate();
    const streamStartTs = nowBn.addn(1);

    await mspSetup.createStream({
      name: 'test_stream',
      startTs: streamStartTs.toNumber(),
      rateAmountUnits: 10,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 1000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      beneficiary: beneficiary,
      streamKeypair
    });

    await sleep(3_000);

    await node_assert.rejects(
      async () => {
        const txId = await mspSetup.closeStream({
          beneficiary,
          beneficiaryFrom,
          stream: streamKeypair.publicKey
        });

        console.log(txId);
      },
      (error: any) => {
        assert.isNotNull(error, 'Unknown error');
        assert.isNotNull(error.code, 'Unknown error');
        expect(error.code === 6030, 'Streams in a Lock treasury can not be closed while running');
        return true;
      }
    );
  });

  it('create open treasury -> add funds -> create stream -> close stream (as a treasurer succeed since is paused because of lack of funds)', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 100_000_000 });

    const slot = await mspSetup.connection.getSlot('finalized');
    const nowTs = (await mspSetup.connection.getBlockTime(slot)) as number;
    // const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    const startTs = nowBn.addn(10).toNumber();
    console.log('nowTs:', nowTs);

    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(treasurerKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );

    const beneficiary = Keypair.generate().publicKey;
    const beneficiaryFrom = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mspSetup.fromMint,
      beneficiary,
      true
    );

    const streamKeypair = Keypair.generate();

    await mspSetup.createStream({
      name: 'test_stream',
      startTs,
      rateAmountUnits: 10,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 20,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      beneficiary: beneficiary,
      streamKeypair
    });

    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiary, 1_000_000_000),
      'confirmed'
    );

    await sleep(3_000);

    await mspSetup.closeStream({
      beneficiary,
      beneficiaryFrom,
      stream: streamKeypair.publicKey
    });
  });

  it('create open treasury -> add funds -> create stream -> transfer tokens -> close stream -> close treasury', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 100_000_000 });

    const slot = await mspSetup.connection.getSlot('finalized');
    const nowTs = (await mspSetup.connection.getBlockTime(slot)) as number;
    // const nowTs = Date.now() / 1000;
    const nowBn = new anchor.BN(nowTs);
    console.log('nowTs:', nowTs);

    const beneficiaryKeypair = Keypair.generate();
    const beneficiaryFrom = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mspSetup.fromMint,
      beneficiaryKeypair.publicKey,
      true
    );

    const streamKeypair = Keypair.generate();

    await mspSetup.createStream({
      name: 'test_stream',
      startTs: nowTs,
      rateAmountUnits: 10,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 1000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });

    await sleep(1_000);

    await (mspSetup.program.provider as anchor.AnchorProvider).sendAndConfirm(
      new Transaction().add(
        Token.createTransferInstruction(
          TOKEN_PROGRAM_ID,
          mspSetup.treasurerFrom,
          mspSetup.treasuryFrom,
          treasurerKeypair.publicKey,
          [],
          100_000_000
        )
      ),
      [treasurerKeypair]
    );

    const afterTransferTreasuryFromAmount = await mspSetup.getTokenAccountBalance(mspSetup.treasuryFrom);
    const afterTransferTreasuryFromBalance = afterTransferTreasuryFromAmount
      ? parseInt(afterTransferTreasuryFromAmount.amount)
      : 0;
    assert(
      afterTransferTreasuryFromBalance === 200_000_000,
      'Incorrect treasury token balance after external transfer'
    );

    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );

    await sleep(3_000);

    await mspSetup.closeStream({
      beneficiary: beneficiaryKeypair.publicKey,
      beneficiaryFrom,
      stream: streamKeypair.publicKey
    });
  });

  it('create open treasury -> add funds -> create stream (short life) -> close paused stream', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({
      amount: 1000_000_000
    });

    const slot = await mspSetup.connection.getSlot('finalized');
    const nowTs = (await mspSetup.connection.getBlockTime(slot)) as number;
    const nowBn = new anchor.BN(nowTs);
    console.log(`now: ${nowBn.toNumber()}`);

    const beneficiary = Keypair.generate().publicKey;

    await connection.confirmTransaction(await connection.requestAirdrop(beneficiary, 1_000_000_000), 'confirmed');
    const beneficiaryFrom = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mspSetup.fromMint,
      beneficiary,
      true
    );

    const streamKeypair = Keypair.generate();
    const streamStartTs = nowBn.addn(1);
    console.log(`streamStartTs: ${streamStartTs.toNumber()}`);

    await mspSetup.createStream({
      name: 'test_stream',
      startTs: streamStartTs.toNumber(),
      rateAmountUnits: 100_000_000,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 100_000_000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      beneficiary: beneficiary,
      streamKeypair,
      feePayedByTreasurer: true
    });

    // console.log();
    // const preStream = await mspSetup.getStream(treasurerKeypair, streamKeypair.publicKey);
    // console.log('preStream:',
    //   {
    //     beneficiaryAddress: preStream?.beneficiaryAddress.toBase58(),
    //     status: preStream?.status,
    //     currentBlockTime: preStream?.currentBlockTime.toNumber(),
    //     beneficiaryWithdrawableAmount_AkaVested: preStream?.beneficiaryWithdrawableAmount.toNumber(),
    //     fundsLeftInStream_AkaUnvested: preStream?.fundsLeftInStream.toNumber(),
    //     fundsSentToBeneficiary: preStream?.fundsSentToBeneficiary.toNumber(),
    //   }
    // );

    await sleep(3000); // after this all the funds allocated to the stream will be vested

    // console.log();
    const postStream = await mspSetup.getStream({ feePayerKeypair: treasurerKeypair, stream: streamKeypair.publicKey });
    // console.log('postStream:',
    //   {
    //     beneficiaryAddress: postStream?.beneficiaryAddress.toBase58(),
    //     status: postStream?.status,
    //     currentBlockTime: postStream?.currentBlockTime.toNumber(),
    //     beneficiaryWithdrawableAmount_AkaVested: postStream?.beneficiaryWithdrawableAmount.toNumber(),
    //     fundsLeftInStream_AkaUnvested: postStream?.fundsLeftInStream.toNumber(),
    //     fundsSentToBeneficiary: postStream?.fundsSentToBeneficiary.toNumber(),
    //   }
    // );

    const txId = await mspSetup.closeStream({
      beneficiary,
      beneficiaryFrom,
      stream: streamKeypair.publicKey
    });

    console.log(txId);

    expect(postStream?.status).eq('Paused');

    const treasurerFromAmount = (await connection.getTokenAccountBalance(mspSetup.treasurerFrom)).value.amount;
    // console.log('treasurerFromAmount:', treasurerFromAmount);
    expect(treasurerFromAmount).eq('0', 'invalid treasurerFromAmount after close stream');

    const beneficiaryFromAmount = (await connection.getTokenAccountBalance(beneficiaryFrom)).value.amount;
    // console.log('beneficiaryFromAmount:', beneficiaryFromAmount);
    expect(beneficiaryFromAmount).eq('100000000', 'invalid beneficiaryFromAmount after close stream');
  });

  // SPLITTING INSTRUCTIONS

  //#region ADD FUNDS

  it('create treasury -> fund treasury -> create stream -> allocate', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 100_000_000,
      treasurerLamports: ONE_SOL
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 100_000_000 });

    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );
    const streamKeypair = Keypair.generate();
    await mspSetup.createStream({
      name: 'test_stream',
      startTs: new BN(Date.now() / 1000).toNumber(),
      rateAmountUnits: 50_000_000,
      rateIntervalInSeconds: 3600,
      allocationAssignedUnits: 0,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });

    await mspSetup.allocate({
      amount: 50_000_000,
      stream: streamKeypair.publicKey
    });
  });

  it('create treasury -> fund treasury -> create stream -> allocate', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 100_000_000,
      treasurerLamports: ONE_SOL
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 100_000_000 });

    const beneficiaryKeypair = Keypair.generate();
    await mspSetup.connection.confirmTransaction(
      await connection.requestAirdrop(beneficiaryKeypair.publicKey, 1_000_000_000),
      'confirmed'
    );
    const streamKeypair = Keypair.generate();
    await mspSetup.createStream({
      name: 'test_stream',
      startTs: new BN(Date.now() / 1000).toNumber(),
      rateAmountUnits: 50_000_000,
      rateIntervalInSeconds: 3600,
      allocationAssignedUnits: 50_000_000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      streamKeypair
    });

    await node_assert.rejects(
      async () => {
        await mspSetup.allocate({
          amount: 50_000_001,
          stream: streamKeypair.publicKey
        });
      },
      (error: AnchorError) => {
        expectAnchorError(error, 6039, undefined, 'Insufficient treasury balance');
        return true;
      }
    );
  });

  //#endregion

  it('create treasury -> add funds -> create stream -> wait for auto-pause', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});
    await mspSetup.addFunds({
      amount: 1000_000_000
    });

    const beneficiaryKeypair = Keypair.generate();
    const beneficiary = beneficiaryKeypair.publicKey;
    await connection.confirmTransaction(await connection.requestAirdrop(beneficiary, 1_000_000_000), 'confirmed');
    const beneficiaryFrom = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mspSetup.fromMint,
      beneficiary,
      true
    );

    const nowBn = new anchor.BN(Date.now() / 1000);
    const streamKeypair = Keypair.generate();
    await mspSetup.createStream({
      name: 'test_stream',
      startTs: nowBn.toNumber(),
      rateAmountUnits: 2,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 5,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      beneficiary: beneficiary,
      streamKeypair,
      feePayedByTreasurer: true
    });

    const streamLifeEvents: ParsedStreamEvent[] = [];

    let elapsed = 0;
    await sleep(1000);
    elapsed++;
    let postStream = await mspSetup.getStream({
      feePayerKeypair: treasurerKeypair,
      stream: streamKeypair.publicKey,
      logRawLogs: true
    });
    // console.log(postStream);
    streamLifeEvents.push(parseStreamEvent(elapsed, '+1 sec', postStream!));

    await sleep(1000);
    elapsed++;
    postStream = await mspSetup.getStream({
      feePayerKeypair: treasurerKeypair,
      stream: streamKeypair.publicKey,
      logRawLogs: true
    });
    // console.log(postStream);
    streamLifeEvents.push(parseStreamEvent(elapsed, '+1 sec', postStream!));

    await sleep(1000);
    elapsed++;
    postStream = await mspSetup.getStream({
      feePayerKeypair: treasurerKeypair,
      stream: streamKeypair.publicKey,
      logRawLogs: true
    });
    // console.log(postStream);
    streamLifeEvents.push(parseStreamEvent(elapsed, '+1 sec', postStream!));
    // After 3 seconds streaming, the result is:
    /*
    ...
    'Program log: seconds_since_start: 3, streamed_units_since_started: 6', <-- the acual streamed units is not 6 but 5
    'Program log: status: Paused',
    'Program log: stream.allocation_assigned_units: 5',
    'Program log: stream.total_withdrawals_units: 0',
    'Program log: withdrawable: 5',
    'Program log: funds_left_in_account: 0',
    ...
    */

    await mspSetup.withdraw({
      amount: 5,
      beneficiaryKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      beneficiaryFrom,
      stream: streamKeypair.publicKey
    });
    streamLifeEvents.push(parseStreamEvent(elapsed, 'withdraw -5', postStream!));

    await sleep(1000);
    elapsed++;
    postStream = await mspSetup.getStream({
      feePayerKeypair: treasurerKeypair,
      stream: streamKeypair.publicKey,
      logRawLogs: true
    });
    // console.log(postStream);
    streamLifeEvents.push(parseStreamEvent(elapsed, '+1 sec', postStream!));

    await mspSetup.allocate({
      amount: 5,
      stream: streamKeypair.publicKey
    });
    postStream = await mspSetup.getStream({
      feePayerKeypair: treasurerKeypair,
      stream: streamKeypair.publicKey,
      logRawLogs: true
    });
    // console.log(postStream);
    streamLifeEvents.push(parseStreamEvent(elapsed, 'allocate +5', postStream!));

    await sleep(1000);
    elapsed++;
    postStream = await mspSetup.getStream({
      feePayerKeypair: treasurerKeypair,
      stream: streamKeypair.publicKey,
      logRawLogs: true
    });
    // console.log(postStream);
    streamLifeEvents.push(parseStreamEvent(elapsed, '+1 sec', postStream!));

    await sleep(1000);
    elapsed++;
    postStream = await mspSetup.getStream({
      feePayerKeypair: treasurerKeypair,
      stream: streamKeypair.publicKey,
      logRawLogs: true
    });
    // console.log(postStream);
    streamLifeEvents.push(parseStreamEvent(elapsed, '+1 sec', postStream!));

    await sleep(1000);
    elapsed++;
    postStream = await mspSetup.getStream({
      feePayerKeypair: treasurerKeypair,
      stream: streamKeypair.publicKey,
      logRawLogs: true
    });
    // console.log(postStream);
    streamLifeEvents.push(parseStreamEvent(elapsed, '+1 sec', postStream!));

    await sleep(1000);
    elapsed++;
    postStream = await mspSetup.getStream({
      feePayerKeypair: treasurerKeypair,
      stream: streamKeypair.publicKey,
      logRawLogs: true
    });
    // console.log(postStream);
    streamLifeEvents.push(parseStreamEvent(elapsed, '+1 sec', postStream!));

    console.table(streamLifeEvents);

    expect(postStream?.status).eq('Paused');

    const treasurerFromAmount = (await connection.getTokenAccountBalance(mspSetup.treasurerFrom)).value.amount;
    // console.log('treasurerFromAmount:', treasurerFromAmount);
    expect(treasurerFromAmount).eq('0', 'invalid treasurerFromAmount after close stream');

    let beneficiaryFromAmount = (await connection.getTokenAccountBalance(beneficiaryFrom)).value.amount;
    // console.log('beneficiaryFromAmount:', beneficiaryFromAmount);
    expect(beneficiaryFromAmount).eq('5', 'invalid beneficiaryFromAmount after close stream');

    await mspSetup.withdraw({
      amount: 5,
      beneficiaryKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      beneficiaryFrom,
      stream: streamKeypair.publicKey
    });
    streamLifeEvents.push(parseStreamEvent(elapsed, 'withdraw -5', postStream!));

    beneficiaryFromAmount = (await connection.getTokenAccountBalance(beneficiaryFrom)).value.amount;
    // console.log('beneficiaryFromAmount:', beneficiaryFromAmount);
    expect(beneficiaryFromAmount).eq('10', 'invalid beneficiaryFromAmount after close stream');
  });

  it('create treasury -> add funds -> create stream (fee payed from treasury) -> withdraw -> add funds -> add funds MNY-869', async () => {
    // https://meanhq.atlassian.net/browse/MNY-869

    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});
    await mspSetup.addFunds({ amount: 200_000_000 });

    const beneficiaryKeypair = Keypair.generate();
    const beneficiary = beneficiaryKeypair.publicKey;
    await connection.confirmTransaction(await connection.requestAirdrop(beneficiary, 1_000_000_000), 'confirmed');
    const beneficiaryFrom = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mspSetup.fromMint,
      beneficiary,
      true
    );

    const nowBn = new anchor.BN(Date.now() / 1000);
    const streamKeypair = Keypair.generate();
    await mspSetup.createStream({
      name: 'test_stream',
      startTs: nowBn.toNumber(),
      rateAmountUnits: 100_000_000,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 100_000_000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      beneficiary,
      streamKeypair,
      feePayedByTreasurer: true
    });

    await sleep(2000);
    await mspSetup.withdraw({
      amount: 100_000_000,
      beneficiaryKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      beneficiaryFrom,
      stream: streamKeypair.publicKey
    });
    // let withdrawFeeAmountBn = new BN(100_000_000)
    //   .mul(new BN(MSP_WITHDRAW_FEE_PCT_NUMERATOR))
    //   .div(new BN(MSP_FEE_PCT_DENOMINATOR));

    // await sleep(1000);
    await mspSetup.allocate({
      amount: 50_000_000,
      stream: streamKeypair.publicKey
    });
    // withdrawFeeAmountBn = withdrawFeeAmountBn
    //   .add(new BN(50_000_000)
    //   .mul(new BN(MSP_WITHDRAW_FEE_PCT_NUMERATOR))
    //   .div(new BN(MSP_FEE_PCT_DENOMINATOR)));

    await mspSetup.logTreasury();

    // treasuryUnallocated = 50_000_000 - 250_000 - 125_000 = 49625000
    // ┌─────────┬─────────────────────┬─────────────────┬────────────────────────┬───────────┬───────────┬──────────────┬─────────────────────────┬───────────┬───────────────┐
    // │ (index) │ treasuryUnallocated │ feePercentage01 │ badStreamMaxAllocation │ feeAmount │ badTotal  │ badRemaining │ goodStreamMaxAllocation │ goodTotal │ goodRemaining │
    // ├─────────┼─────────────────────┼─────────────────┼────────────────────────┼───────────┼───────────┼──────────────┼─────────────────────────┼───────────┼───────────────┤
    // │    0    │      100000000      │     0.0025      │        99750623        │  249376   │ 99999999  │      1       │        99750624         │ 100000000 │       0       │
    // │    1    │      50000000       │     0.0025      │        49875311        │  124688   │ 49999999  │      1       │        49875312         │ 50000000  │       0       │
    // │    2    │      99772500       │     0.0025      │        99523690        │  248809   │ 99772499  │      1       │        99523691         │ 99772500  │       0       │
    // │    3    │         100         │     0.0025      │           99           │     0     │    99     │      1       │           100           │    100    │       0       │
    // │    4    │       1000000       │     0.0025      │         997506         │   2493    │  999999   │      1       │         997507          │  1000000  │       0       │
    // │    5    │      100000001      │     0.0025      │        99750624        │  249376   │ 100000000 │      1       │        99750625         │ 100000001 │       0       │
    // │    6    │      103220001      │     0.0025      │       102962594        │  257406   │ 103220000 │      1       │        102962595        │ 103220001 │       0       │
    // │    7    │       100001        │     0.0025      │         99751          │    249    │  100000   │      1       │          99752          │  100001   │       0       │
    // │    8    │       2000000       │     0.0025      │        1995012         │   4987    │  1999999  │      1       │         1995013         │  2000000  │       0       │
    // │    9    │      49625000       │     0.0025      │        49501246        │  123753   │ 49624999  │      1       │        49501247         │ 49625000  │       0       │
    // └─────────┴─────────────────────┴─────────────────┴────────────────────────┴───────────┴───────────┴──────────────┴─────────────────────────┴───────────┴───────────────┘

    // await sleep(1000);
    await mspSetup.allocate({
      amount: 49501247,
      stream: streamKeypair.publicKey
    });

    await node_assert.rejects(
      async () => {
        await mspSetup.allocate({
          amount: 49501248,
          stream: streamKeypair.publicKey
        });
      },
      (error: AnchorError) => {
        expectAnchorError(error, 6039, undefined, 'Insufficient treasury balance');
        return true;
      }
    );
  });

  //#region WITHDRAW

  it('create treasury -> add funds -> create stream (withdraw fee payed by beneficiary) -> withdraw', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 200_000_000 });

    const preFeesFrom = await mspSetup.getTokenAccountBalance(mspSetup.feesFrom);
    const preFeesFromAtaAmount = new BN(preFeesFrom!.amount);

    const beneficiaryKeypair = Keypair.generate();
    const beneficiary = beneficiaryKeypair.publicKey;
    await connection.confirmTransaction(await connection.requestAirdrop(beneficiary, 1_000_000_000), 'confirmed');
    const beneficiaryFrom = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mspSetup.fromMint,
      beneficiary,
      true
    );

    const nowBn = new anchor.BN(Date.now() / 1000);
    const streamKeypair = Keypair.generate();
    await mspSetup.createStream({
      name: 'test_stream',
      startTs: nowBn.toNumber(),
      rateAmountUnits: 100_000_000,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 100_000_000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      beneficiary,
      streamKeypair,
      feePayedByTreasurer: false
    });

    const preState = await mspSetup.getMspWorldState();
    expect(preState.treasuryAccount!.lastKnownBalanceUnits.toNumber()).eq(200_000_000);
    expect(preState.treasuryAccount!.allocationAssignedUnits.toNumber()).eq(100_000_000);

    const preStream = await program.account.stream.fetch(streamKeypair.publicKey);
    expect(preStream.allocationAssignedUnits.toNumber()).eq(100_000_000);

    // WITHDRAW
    await sleep(2000);
    await mspSetup.withdraw({
      amount: 100_000_000,
      beneficiaryKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      beneficiaryFrom,
      stream: streamKeypair.publicKey
    });

    const postState = await mspSetup.getMspWorldState();
    expect(postState.treasuryAccount!.lastKnownBalanceUnits.toNumber()).eq(100_000_000);
    expect(postState.treasuryAccount!.allocationAssignedUnits.toNumber()).eq(0);

    const postTreasuryFrom = await mspSetup.getTokenAccountBalance(mspSetup.treasuryFrom);
    const postTreasuryFromAtaAmount = new BN(postTreasuryFrom!.amount);
    expect(postTreasuryFromAtaAmount.toNumber()).eq(100_000_000);

    const postStream = await program.account.stream.fetch(streamKeypair.publicKey);
    expect(postStream.allocationAssignedUnits.toNumber()).eq(100_000_000);
    expect(postStream.totalWithdrawalsUnits.toNumber()).eq(100_000_000);

    const postBeneficiaryFrom = await mspSetup.getTokenAccountBalance(beneficiaryFrom);
    const postBeneficiaryFromAtaAmount = new BN(postBeneficiaryFrom!.amount);
    expect(postBeneficiaryFromAtaAmount.toNumber()).eq(99_750_000, 'incorrect beneficiary token amount after withdraw');

    const postFeesFrom = await mspSetup.getTokenAccountBalance(mspSetup.feesFrom);
    const postFeesFromAtaAmount = new BN(postFeesFrom!.amount);
    const withdrawFeeAmountBn = new BN(100_000_000)
      .mul(new BN(MSP_WITHDRAW_FEE_PCT_NUMERATOR))
      .div(new BN(MSP_FEE_PCT_DENOMINATOR));

    expect(postFeesFromAtaAmount.toNumber()).eq(preFeesFromAtaAmount.add(withdrawFeeAmountBn).toNumber());
  });

  it('create treasury (withdraw fee payed by treasury) -> add funds -> create stream -> withdraw', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1000_000_000,
      treasurerLamports: 1_000_000_000
    });

    await mspSetup.createTreasury({});

    await mspSetup.addFunds({ amount: 200_000_000 });

    const preFeesFrom = await mspSetup.getTokenAccountBalance(mspSetup.feesFrom);
    const preFeesFromAtaAmount = new BN(preFeesFrom!.amount);

    const beneficiaryKeypair = Keypair.generate();
    const beneficiary = beneficiaryKeypair.publicKey;
    await connection.confirmTransaction(await connection.requestAirdrop(beneficiary, 1_000_000_000), 'confirmed');
    const beneficiaryFrom = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mspSetup.fromMint,
      beneficiary,
      true
    );

    const nowBn = new anchor.BN(Date.now() / 1000);
    const streamKeypair = Keypair.generate();
    await mspSetup.createStream({
      name: 'test_stream',
      startTs: nowBn.toNumber(), // startUtc
      rateAmountUnits: 100_000_000,
      rateIntervalInSeconds: 1,
      allocationAssignedUnits: 100_000_000,
      cliffVestAmountUnits: 0,
      cliffVestPercent: 0,
      initializerKeypair: treasurerKeypair,
      beneficiary, // beneficiary
      streamKeypair,
      feePayedByTreasurer: true
    });

    const preState = await mspSetup.getMspWorldState();
    expect(preState.treasuryAccount!.lastKnownBalanceUnits.toNumber()).eq(199_750_000);
    expect(preState.treasuryAccount!.allocationAssignedUnits.toNumber()).eq(100_000_000);
    const preStream = await program.account.stream.fetch(streamKeypair.publicKey);
    expect(preStream.allocationAssignedUnits.toNumber()).eq(100_000_000);

    // WITHDRAW
    await sleep(2000);
    await mspSetup.withdraw({
      amount: 100_000_000,
      beneficiaryKeypair,
      beneficiary: beneficiaryKeypair.publicKey,
      beneficiaryFrom,
      stream: streamKeypair.publicKey
    });

    const postState = await mspSetup.getMspWorldState();
    expect(postState.treasuryAccount!.lastKnownBalanceUnits.toNumber()).eq(99_750_000);
    expect(postState.treasuryAccount!.allocationAssignedUnits.toNumber()).eq(0);

    const postTreasuryFrom = await mspSetup.getTokenAccountBalance(mspSetup.treasuryFrom);
    const postTreasuryFromAtaAmount = new BN(postTreasuryFrom!.amount);
    expect(postTreasuryFromAtaAmount.toNumber()).eq(99_750_000);

    const postStream = await program.account.stream.fetch(streamKeypair.publicKey);
    expect(postStream.allocationAssignedUnits.toNumber()).eq(100_000_000);
    expect(postStream.totalWithdrawalsUnits.toNumber()).eq(100_000_000);

    const postBeneficiaryFrom = await mspSetup.getTokenAccountBalance(beneficiaryFrom);
    const postBeneficiaryFromAtaAmount = new BN(postBeneficiaryFrom!.amount);
    expect(postBeneficiaryFromAtaAmount.toNumber()).eq(
      100_000_000,
      'incorrect beneficiary token amount after withdraw'
    );

    const postFeesFrom = await mspSetup.getTokenAccountBalance(mspSetup.feesFrom);
    const postFeesFromAtaAmount = new BN(postFeesFrom!.amount);
    const withdrawFeeAmountBn = new BN(100_000_000)
      .mul(new BN(MSP_WITHDRAW_FEE_PCT_NUMERATOR))
      .div(new BN(MSP_FEE_PCT_DENOMINATOR));

    expect(postFeesFromAtaAmount.toNumber()).eq(preFeesFromAtaAmount.add(withdrawFeeAmountBn).toNumber());
  });

  //#endregion

  //#region UPDATE TREASURY

  // it('zzz => create treasury -> add funds -> create 2 streams -> withdraw -> update treasury data (success with right values)', async () => {

  //   const treasurerKeypair = Keypair.generate();

  //   const mspSetup = await createMspSetup(
  //     fromTokenClient,
  //     treasurerKeypair,
  //     "test_treasury",
  //     TREASURY_TYPE_OPEN,
  //     false,
  //     1000_000_000,
  //     1_000_000_000,
  //   );

  //   await mspSetup.createTreasury({});
  //   await mspSetup.addFunds(1000_000_000);

  //   const beneficiaryOneKeypair = Keypair.generate();
  //   const beneficiaryOne = beneficiaryOneKeypair.publicKey;
  //   const beneficiaryTwoKeypair = Keypair.generate();
  //   const beneficiaryTwo = beneficiaryTwoKeypair.publicKey;

  //   await connection.confirmTransaction(
  //     await connection.requestAirdrop(beneficiaryOne, 1_000_000_000),
  //     "confirmed"
  //   );

  //   await connection.confirmTransaction(
  //     await connection.requestAirdrop(beneficiaryTwo, 1_000_000_000),
  //     "confirmed"
  //   );

  //   const beneficiaryOneFrom = await Token.getAssociatedTokenAddress(
  //     ASSOCIATED_TOKEN_PROGRAM_ID,
  //     TOKEN_PROGRAM_ID,
  //     mspSetup.fromMint,
  //     beneficiaryOne,
  //     true
  //   );

  //   const beneficiaryTwoFrom = await Token.getAssociatedTokenAddress(
  //     ASSOCIATED_TOKEN_PROGRAM_ID,
  //     TOKEN_PROGRAM_ID,
  //     mspSetup.fromMint,
  //     beneficiaryTwo,
  //     true
  //   );

  //   let nowBn = new anchor.BN(Date.now() / 1000);
  //   const streamOneKeypair = Keypair.generate();
  //   const streamTwoKeypair = Keypair.generate();

  //   // FIRST STREAM
  //   await mspSetup.createStream(
  //     "test_stream_1",
  //     nowBn.toNumber(), // startUtc
  //     2,      // rateAmountUnits
  //     1,                // rateIntervalInSeconds
  //     10_000_000,      // allocationAssignedUnits
  //     0,                // cliffVestAmountUnits
  //     0,                // cliffVestPercent

  //     treasurerKeypair, // initializerKeypair
  //     beneficiaryOne,      // beneficiary
  //     streamOneKeypair,
  //     undefined,
  //     undefined,
  //     false,             // feePayedByTreasurer
  //   );

  //   // SECOND STREAM
  //   await mspSetup.createStream(
  //     "test_stream_2",
  //     nowBn.toNumber(), // startUtc
  //     500_000,      // rateAmountUnits
  //     3600,                // rateIntervalInSeconds
  //     100_000_000,      // allocationAssignedUnits
  //     0,                // cliffVestAmountUnits
  //     0,                // cliffVestPercent

  //     treasurerKeypair, // initializerKeypair
  //     beneficiaryTwo,      // beneficiary
  //     streamTwoKeypair,
  //     undefined,
  //     undefined,
  //     false,             // feePayedByTreasurer
  //   );

  //   await sleep(3_000);
  //   await mspSetup.withdraw(3, beneficiaryOneKeypair, beneficiaryOne, beneficiaryOneFrom, streamOneKeypair.publicKey);

  //   await sleep(1_000);
  //   let postStreamOne = await mspSetup.getStream(treasurerKeypair, streamOneKeypair.publicKey, false);
  //   let postStreamTwo = await mspSetup.getStream(treasurerKeypair, streamTwoKeypair.publicKey, false);

  //   assert.isNotNull(postStreamOne, "Null postStreamOne after withdraw: ERROR !!!");
  //   assert.isNotNull(postStreamTwo, "Null postStreamTwo after withdraw: ERROR !!!");

  //   let total_allocation_assigned =
  //     postStreamOne!.allocationAssignedUnits.toNumber() +
  //     postStreamOne!.totalWithdrawalsUnits.toNumber() +
  //     postStreamTwo!.allocationAssignedUnits.toNumber() +
  //     postStreamTwo!.totalWithdrawalsUnits.toNumber();

  //   let total_withdrawals_units =
  //     postStreamOne!.totalWithdrawalsUnits.toNumber() +
  //     postStreamTwo!.totalWithdrawalsUnits.toNumber();

  //   await mspSetup.updateTreasuryData(
  //     total_allocation_assigned,
  //     total_withdrawals_units,
  //     2
  //   );

  // });

  // it('zzz => create treasury -> add funds -> create 2 streams -> withdraw -> update treasury data (fails with greater values)', async () => {

  //   const treasurerKeypair = Keypair.generate();

  //   const mspSetup = await createMspSetup(
  //     fromTokenClient,
  //     treasurerKeypair,
  //     "test_treasury",
  //     TREASURY_TYPE_OPEN,
  //     false,
  //     1000_000_000,
  //     1_000_000_000,
  //   );

  //   await mspSetup.createTreasury({});
  //   await mspSetup.addFunds(1000_000_000);

  //   const beneficiaryOneKeypair = Keypair.generate();
  //   const beneficiaryOne = beneficiaryOneKeypair.publicKey;
  //   const beneficiaryTwoKeypair = Keypair.generate();
  //   const beneficiaryTwo = beneficiaryTwoKeypair.publicKey;

  //   await connection.confirmTransaction(
  //     await connection.requestAirdrop(beneficiaryOne, 1_000_000_000),
  //     "confirmed"
  //   );

  //   await connection.confirmTransaction(
  //     await connection.requestAirdrop(beneficiaryTwo, 1_000_000_000),
  //     "confirmed"
  //   );

  //   const beneficiaryOneFrom = await Token.getAssociatedTokenAddress(
  //     ASSOCIATED_TOKEN_PROGRAM_ID,
  //     TOKEN_PROGRAM_ID,
  //     mspSetup.fromMint,
  //     beneficiaryOne,
  //     true
  //   );

  //   const beneficiaryTwoFrom = await Token.getAssociatedTokenAddress(
  //     ASSOCIATED_TOKEN_PROGRAM_ID,
  //     TOKEN_PROGRAM_ID,
  //     mspSetup.fromMint,
  //     beneficiaryTwo,
  //     true
  //   );

  //   let nowBn = new anchor.BN(Date.now() / 1000);
  //   const streamOneKeypair = Keypair.generate();
  //   const streamTwoKeypair = Keypair.generate();

  //   // FIRST STREAM
  //   await mspSetup.createStream(
  //     "test_stream_1",
  //     nowBn.toNumber(), // startUtc
  //     2,      // rateAmountUnits
  //     1,                // rateIntervalInSeconds
  //     10_000_000,      // allocationAssignedUnits
  //     0,                // cliffVestAmountUnits
  //     0,                // cliffVestPercent

  //     treasurerKeypair, // initializerKeypair
  //     beneficiaryOne,      // beneficiary
  //     streamOneKeypair,
  //     undefined,
  //     undefined,
  //     false,             // feePayedByTreasurer
  //   );

  //   // SECOND STREAM
  //   await mspSetup.createStream(
  //     "test_stream_2",
  //     nowBn.toNumber(), // startUtc
  //     500_000,      // rateAmountUnits
  //     3600,                // rateIntervalInSeconds
  //     100_000_000,      // allocationAssignedUnits
  //     0,                // cliffVestAmountUnits
  //     0,                // cliffVestPercent

  //     treasurerKeypair, // initializerKeypair
  //     beneficiaryTwo,      // beneficiary
  //     streamTwoKeypair,
  //     undefined,
  //     undefined,
  //     false,             // feePayedByTreasurer
  //   );

  //   await sleep(3_000);
  //   await mspSetup.withdraw(3, beneficiaryOneKeypair, beneficiaryOne, beneficiaryOneFrom, streamOneKeypair.publicKey);

  //   await sleep(1_000);
  //   let postStreamOne = await mspSetup.getStream(treasurerKeypair, streamOneKeypair.publicKey, false);
  //   let postStreamTwo = await mspSetup.getStream(treasurerKeypair, streamTwoKeypair.publicKey, false);

  //   assert.isNotNull(postStreamOne, "Null postStreamOne after withdraw: ERROR !!!");
  //   assert.isNotNull(postStreamTwo, "Null postStreamTwo after withdraw: ERROR !!!");

  //   let total_allocation_assigned =
  //     postStreamOne!.allocationAssignedUnits.toNumber() +
  //     postStreamOne!.totalWithdrawalsUnits.toNumber() +
  //     postStreamTwo!.allocationAssignedUnits.toNumber() +
  //     postStreamTwo!.totalWithdrawalsUnits.toNumber();

  //   let total_withdrawals_units =
  //     postStreamOne!.totalWithdrawalsUnits.toNumber() +
  //     postStreamTwo!.totalWithdrawalsUnits.toNumber();

  //   await node_assert.rejects(async () => {
  //     await mspSetup.updateTreasuryData(
  //       total_allocation_assigned + 2_000_000_000,
  //       total_withdrawals_units + 1_000,
  //       2
  //     );
  //   },
  //   (error: anchor.ProgramError) => {
  //     expect(error.code).eq(6041);
  //     expect(error.msg).eq('Treasury allocation can not be greater than treasury balance');
  //     return true;
  //   });

  // });

  //#endregion
});

function parseStreamEvent(elapsed: number, action: string, event: StreamEvent): ParsedStreamEvent {
  return {
    elapsed: elapsed,
    started_ts: event.startUtc.toNumber(),
    action: action,
    current_ts: event.currentBlockTime.toNumber(),
    allocation: event.allocationAssignedUnits.toNumber(),
    rate_units: event.rateAmountUnits.toNumber(),
    rate_interval: event.rateIntervalInSeconds.toNumber(),
    cliff: event.cliffUnits.toNumber(),
    status: event.status,
    streamed: event.fundsSentToBeneficiary.toNumber(),
    missed_while_paused: event.missedUnitsWhilePaused.toNumber(),
    non_stop_earnings: event.nonStopEarningUnits.toNumber(),
    entitled_earnings: event.entitledEarningsUnits.toNumber(),
    total_withdrawals: event.totalWithdrawalsUnits.toNumber(),
    withdrawable: event.beneficiaryWithdrawableAmount.toNumber(),
    est_depletion_ts: event.estDepletionTime.toNumber(),
    last_auto_stop_ts: event.lastAutoStopBlockTime.toNumber(),
    last_known_seconds_paused: event.lastKnownTotalSecondsInPausedStatus.toNumber(),
    last_manual_resume_remaining_allocation_snap: event.lastManualResumeRemainingAllocationUnitsSnap.toNumber()
    // post_allocation: number,
  };
}

type ParsedStreamEvent = {
  elapsed: number;
  started_ts: number;
  action: string;
  current_ts: number;
  allocation: number;
  rate_units: number;
  rate_interval: number;
  cliff: number;
  status: string;
  streamed: number;
  missed_while_paused: number;
  non_stop_earnings: number;
  entitled_earnings: number;
  total_withdrawals: number;
  withdrawable: number;
  est_depletion_ts: number;
  last_auto_stop_ts: number;
  last_known_seconds_paused: number;
  last_manual_resume_remaining_allocation_snap: number;
  // post_allocation: number,
};
