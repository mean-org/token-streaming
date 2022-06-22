// anchor test --provider.cluster localnet --provider.wallet ~/.config/solana/id.json --detach -- --features test
import { PublicKey, Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, Token } from '@solana/spl-token';
import * as anchor from '@project-serum/anchor';
import { Program, AnchorError } from '@project-serum/anchor';
import { Msp } from '../target/types/msp';
import { expect } from 'chai';
import node_assert from 'assert';
import {
  connection,
  payer,
  createMspSetup,
  TREASURY_TYPE_OPEN,
  TREASURY_ASSOCIATED_MINT_DECIMALS,
  ONE_SOL,
  MSP_TREASURY_ACCOUNT_SIZE_IN_BYTES,
  SOLANA_MINT_ACCOUNT_SIZE_IN_BYTES,
  MSP_CREATE_TREASURY_FEE_IN_LAMPORTS,
  expectAnchorError,
  SOLANA_TOKEN_ACCOUNT_SIZE_IN_BYTES
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

  it('create treasury', async () => {
    const treasurerKeypair = Keypair.generate();

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1_000_000,
      treasurerLamports: ONE_SOL
    });

    await mspSetup.createTreasury({});
  });

  it('create treasury (fails because the treasurer has insufficient SOL to pay creation fee)', async () => {
    const treasurerKeypair = Keypair.generate();

    const treasurerLamports =
      (await connection.getMinimumBalanceForRentExemption(MSP_TREASURY_ACCOUNT_SIZE_IN_BYTES)) +
      (await connection.getMinimumBalanceForRentExemption(SOLANA_TOKEN_ACCOUNT_SIZE_IN_BYTES));
    // intentionally excluding the lamports needed to pay creation fees

    const mspSetup = await createMspSetup({
      fromTokenClient,
      treasurerKeypair,
      name: 'test_treasury',
      treasuryType: TREASURY_TYPE_OPEN,
      autoClose: false,
      treasurerFromInitialBalance: 1_000_000,
      treasurerLamports: treasurerLamports
    });

    await node_assert.rejects(
      async () => {
        await mspSetup.createTreasury({});
      },
      (error: anchor.web3.SendTransactionError) => {
        expect(error.message).contains('Error processing Instruction 0: custom program error: 0x1');
        expect(error.logs?.join('\n')).contains(
          `Transfer: insufficient lamports 0, need ${MSP_CREATE_TREASURY_FEE_IN_LAMPORTS}`
        );
        return true;
      }
    );
  });

  it('create treasury -> add funds (unallocated)', async () => {
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
  });

  it('create treasury -> add funds (unallocated)', async () => {
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
  });

  it('create treasury -> add funds -> close treasury', async () => {
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
    await mspSetup.closeTreasury({});
  });

  it('create treasury -> close treasury', async () => {
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
    await mspSetup.closeTreasury({});
  });

  //#region TREASURY WITHDRAW

  it('treasury withdraw', async () => {
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

    await mspSetup.treasuryWithdraw({
      amount: 100_000_000,
      destinationAuthority: treasurerKeypair.publicKey,
      destinationTokenAccount: mspSetup.treasurerFrom
    });

    const postState = await mspSetup.getMspWorldState();
    expect(postState.treasurerFromAccountInfo?.amount.toNumber()).eq(999_750_000);
    expect(postState.treasuryFromAccountInfo?.amount.toNumber()).eq(0);
    expect(postState.treasuryAccount?.lastKnownBalanceUnits.toNumber()).eq(0);
  });

  it('treasury withdraw half', async () => {
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

    await mspSetup.treasuryWithdraw({
      amount: 50_000_000,
      destinationAuthority: treasurerKeypair.publicKey,
      destinationTokenAccount: mspSetup.treasurerFrom
    });

    const postState = await mspSetup.getMspWorldState();
    expect(postState.treasurerFromAccountInfo?.amount.toNumber()).eq(949_875_000);
    expect(postState.treasuryFromAccountInfo?.amount.toNumber()).eq(50_000_000);
    expect(postState.treasuryAccount?.lastKnownBalanceUnits.toNumber()).eq(50_000_000);
  });

  it('treasury withdraw -> insufficient treasury balance', async () => {
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

    await node_assert.rejects(
      async () => {
        await mspSetup.treasuryWithdraw({
          amount: 100_000_001,
          destinationAuthority: treasurerKeypair.publicKey,
          destinationTokenAccount: mspSetup.treasurerFrom
        });
      },
      (error: AnchorError) => {
        expectAnchorError(error, 6039, undefined, 'Insufficient treasury balance');
        return true;
      }
    );
  });

  it('treasury withdraw -> invalid withdrawal amount', async () => {
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

    await node_assert.rejects(
      async () => {
        await mspSetup.treasuryWithdraw({
          amount: 0,
          destinationAuthority: treasurerKeypair.publicKey,
          destinationTokenAccount: mspSetup.treasurerFrom
        });
      },
      (error: AnchorError) => {
        expectAnchorError(error, 6022, undefined, 'Invalid withdrawal amount');
        return true;
      }
    );
  });

  it('treasury withdraw -> invalid treasurer', async () => {
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

    const provider: anchor.AnchorProvider = mspSetup.program.provider as anchor.AnchorProvider;
    const treasurer2From = await mspSetup.findTreasuryFromAssociatedTokenAddress(provider.wallet.publicKey);

    await node_assert.rejects(
      async () => {
        await mspSetup.treasuryWithdraw({
          amount: 100_000_000,
          destinationAuthority: provider.wallet.publicKey,
          destinationTokenAccount: treasurer2From,
          signers: [],
          treasurer: provider.wallet.publicKey,
          treasurerFrom: treasurer2From
        });
      },
      (error: AnchorError) => {
        expectAnchorError(error, 6013, undefined, 'Invalid treasurer');
        return true;
      }
    );
  });

  it('create treasury -> add funds', async () => {
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
  });

  //#endregion

  it('create treasury (solFeePayedByTreasury=true) -> close treasury', async () => {
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

    await mspSetup.createTreasury({
      solFeePayedByTreasury: true
    });

    await connection.confirmTransaction(await connection.requestAirdrop(mspSetup.treasury, 1_000_000_000), 'confirmed');

    await mspSetup.closeTreasury({});
  });

  it('create treasury (solFeePayedByTreasury=true) -> addFunds -> close treasury', async () => {
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

    await mspSetup.createTreasury({
      solFeePayedByTreasury: true
    });

    await connection.confirmTransaction(await connection.requestAirdrop(mspSetup.treasury, 1_000_000_000), 'confirmed');

    await mspSetup.addFunds({
      amount: 1_000_000
    });

    await mspSetup.closeTreasury({});
  });
});
