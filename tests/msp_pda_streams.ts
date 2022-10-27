// anchor test --provider.cluster localnet --provider.wallet ~/.config/solana/id.json --detach -- --features test
// node_modules/.bin/ts-mocha -p ./tsconfig.json -t 1000000 tests/msp_treasury_add_funds_stream.ts
import { PublicKey, Keypair, Connection, Transaction, sendAndConfirmRawTransaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, Token } from '@solana/spl-token';
import * as anchor from '@project-serum/anchor';
import { Program, AnchorError, workspace, BN, IdlAccounts } from '@project-serum/anchor';
import { Msp } from '../target/types/msp';
import { expect } from 'chai';
import node_assert from 'assert';
import { bs58 } from '@project-serum/anchor/dist/cjs/utils/bytes';
import { Category, SubCategory } from '../ts/src/types';
import { CONFIRM_OPTIONS, DECIMALS, LATEST_IDL_FILE_VERSION, MSP_FEES_PUBKEY, SYSTEM_PROGRAM_ID, SYSVAR_RENT_PUBKEY, TREASURY_TYPE_OPEN, URL } from './constants';


const connection = new Connection(URL, CONFIRM_OPTIONS.commitment);
const payer = Keypair.generate();
let FEES_FROM = PublicKey.default;

describe('msp-pda-streams', () => {

    const wallet = new anchor.Wallet(payer);
    const provider = new anchor.AnchorProvider(connection, wallet, CONFIRM_OPTIONS);
    anchor.setProvider(provider);
    const program = workspace.Msp as Program<Msp>;

    // Implementation from Anchor examples
    // Configure the client to use the local cluster.
    // anchor.setProvider(anchor.AnchorProvider.env());
    // const program = anchor.workspace.Msp as Program<Msp>;

    let fromTokenClient: Token = new Token(connection, PublicKey.default, TOKEN_PROGRAM_ID, payer); // dummy new to make it non-null; it will be overwritten soon;

    it('Initializes the state-of-the-world', async () => {
        // Airdropping tokens to a payer.
        await connection.confirmTransaction(await connection.requestAirdrop(payer.publicKey, 100_000_0000_000), 'confirmed');

        // Prevent 'Error: failed to send transaction: Transaction simulation failed: Transaction leaves an account with a lower balance than rent-exempt minimum' because fee account having zero sol
        // https://discord.com/channels/428295358100013066/517163444747894795/958728019973910578
        // https://discord.com/channels/428295358100013066/749579745645166592/956262753365008465
        await connection.confirmTransaction(
            await connection.requestAirdrop(MSP_FEES_PUBKEY, 1_000_000_000),
            'confirmed'
        );

        fromTokenClient = await Token.createMint(
            connection,
            payer,
            payer.publicKey,
            null,
            DECIMALS,
            TOKEN_PROGRAM_ID
        );

        FEES_FROM = await Token.getAssociatedTokenAddress(
            ASSOCIATED_TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID,
            fromTokenClient.publicKey,
            MSP_FEES_PUBKEY,
            true
        );
    });

    it('create treasury -> add funds -> create random keypair stream', async () => {

        const {
            treasurerKey,
            treasurerFrom,
        } = await prepareTreasurer({ fromTokenClient, initialTokenBalance: 1000_000_000 });


        const {
            treasury,
            treasuryBump,
            treasuryFrom,
            treasurySlot,
        } = await prepareTreasury({ program, fromTokenClient, treasurerKey });

        const contextInfo: { [id: string]: string } = {};
        contextInfo['payer'] = payer.publicKey.toBase58();
        contextInfo['program'] = program.programId.toBase58();
        contextInfo['fromMint'] = fromTokenClient.publicKey.toBase58();
        contextInfo['treasurer'] = treasurerKey.publicKey.toBase58();
        contextInfo['treasurerFrom'] = treasurerFrom.toBase58();
        contextInfo['treasury'] = treasury.toBase58();
        contextInfo['treasuryFrom'] = treasuryFrom.toBase58();
        contextInfo['feesFrom'] = FEES_FROM.toBase58();
        contextInfo['treasurySlot'] = treasurySlot.toString();

        try {
            let txId = await program.methods
                .createTreasury(
                    LATEST_IDL_FILE_VERSION,
                    new anchor.BN(treasurySlot),
                    "test_treasury",
                    TREASURY_TYPE_OPEN,
                    false,
                    false,
                    { [Category[Category.default]]: {} },
                    { [SubCategory[SubCategory.default]]: {} }
                )
                .accounts({
                    payer: treasurerKey.publicKey,
                    treasurer: treasurerKey.publicKey,
                    treasury: treasury,
                    treasuryToken: treasuryFrom,
                    associatedToken: fromTokenClient.publicKey,
                    feeTreasury: MSP_FEES_PUBKEY,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SYSTEM_PROGRAM_ID,
                    rent: SYSVAR_RENT_PUBKEY
                })
                .signers([treasurerKey])
                .rpc();

            contextInfo['CREATE TREASURY TX'] = getTxUrl(txId);

            txId = await program.methods
                .addFunds(LATEST_IDL_FILE_VERSION, new BN(100_000_000))
                .accounts({
                    payer: treasurerKey.publicKey,
                    contributor: treasurerKey.publicKey,
                    contributorToken: treasurerFrom,
                    treasury: treasury,
                    treasuryToken: treasuryFrom,
                    associatedToken: fromTokenClient.publicKey,
                    feeTreasury: MSP_FEES_PUBKEY,
                    feeTreasuryToken: FEES_FROM,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SYSTEM_PROGRAM_ID,
                    rent: SYSVAR_RENT_PUBKEY
                })
                .signers([treasurerKey])
                .rpc();

            contextInfo['ADD FUNDS TX'] = getTxUrl(txId);

            const {
                beneficiaryKey,
                streamKey,
                nowBn,
            } = await prepareStream({
                treasury,
                programId: program.programId,
            })

            contextInfo['beneficiary'] = beneficiaryKey.publicKey.toBase58();
            contextInfo['stream'] = streamKey.publicKey.toBase58();
            contextInfo['nowBn'] = nowBn.toString();

            txId = await program.methods
                .createStream(
                    LATEST_IDL_FILE_VERSION,
                    "test random keypair stream",
                    nowBn,
                    new BN(10),
                    new BN(1),
                    new BN(1000),
                    new BN(0),
                    new BN(0),
                    true,
                )
                .accounts({
                    payer: treasurerKey.publicKey,
                    treasurer: treasurerKey.publicKey,
                    treasury: treasury,
                    treasuryToken: treasuryFrom,
                    associatedToken: fromTokenClient.publicKey,
                    beneficiary: beneficiaryKey.publicKey,
                    stream: streamKey.publicKey,
                    feeTreasury: MSP_FEES_PUBKEY,
                    feeTreasuryToken: FEES_FROM,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SYSTEM_PROGRAM_ID,
                    rent: SYSVAR_RENT_PUBKEY
                })
                .signers([payer, treasurerKey, streamKey])
                .rpc();

            contextInfo['CREATE PDA STREAM TX'] = getTxUrl(txId);
        } catch (error) {
            console.log(error);
            console.table(contextInfo);
            throw error;
        }

    });

    it('create treasury -> add funds -> create PDA stream', async () => {

        const {
            treasurerKey,
            treasurerFrom,
        } = await prepareTreasurer({ fromTokenClient, initialTokenBalance: 1000_000_000 });


        const {
            treasury,
            treasuryBump,
            treasuryFrom,
            treasurySlot,
        } = await prepareTreasury({ program, fromTokenClient, treasurerKey });

        const contextInfo: { [id: string]: string } = {};
        contextInfo['payer'] = payer.publicKey.toBase58();
        contextInfo['program'] = program.programId.toBase58();
        contextInfo['fromMint'] = fromTokenClient.publicKey.toBase58();
        contextInfo['treasurer'] = treasurerKey.publicKey.toBase58();
        contextInfo['treasurerFrom'] = treasurerFrom.toBase58();
        contextInfo['treasury'] = treasury.toBase58();
        contextInfo['treasuryFrom'] = treasuryFrom.toBase58();
        contextInfo['feesFrom'] = FEES_FROM.toBase58();
        contextInfo['treasurySlot'] = treasurySlot.toString();

        try {
            let txId = await program.methods
                .createTreasury(
                    LATEST_IDL_FILE_VERSION,
                    new anchor.BN(treasurySlot),
                    "test_treasury",
                    TREASURY_TYPE_OPEN,
                    false,
                    false,
                    { [Category[Category.default]]: {} },
                    { [SubCategory[SubCategory.default]]: {} }
                )
                .accounts({
                    payer: treasurerKey.publicKey,
                    treasurer: treasurerKey.publicKey,
                    treasury: treasury,
                    treasuryToken: treasuryFrom,
                    associatedToken: fromTokenClient.publicKey,
                    feeTreasury: MSP_FEES_PUBKEY,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SYSTEM_PROGRAM_ID,
                    rent: SYSVAR_RENT_PUBKEY
                })
                .signers([treasurerKey])
                .rpc();

            contextInfo['CREATE TREASURY TX'] = getTxUrl(txId);

            txId = await program.methods
                .addFunds(LATEST_IDL_FILE_VERSION, new BN(100_000_000))
                .accounts({
                    payer: treasurerKey.publicKey,
                    contributor: treasurerKey.publicKey,
                    contributorToken: treasurerFrom,
                    treasury: treasury,
                    treasuryToken: treasuryFrom,
                    associatedToken: fromTokenClient.publicKey,
                    feeTreasury: MSP_FEES_PUBKEY,
                    feeTreasuryToken: FEES_FROM,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SYSTEM_PROGRAM_ID,
                    rent: SYSVAR_RENT_PUBKEY
                })
                .signers([treasurerKey])
                .rpc();

            contextInfo['ADD FUNDS TX'] = getTxUrl(txId);

            const {
                beneficiaryKey,
                stream,
                streamBump,
                streamPdaSeed,
                nowBn,
            } = await preparePdaStream({
                treasury,
                programId: program.programId,
            })

            contextInfo['beneficiary'] = beneficiaryKey.publicKey.toBase58();
            contextInfo['stream'] = stream.toBase58();
            contextInfo['streamBump'] = streamBump.toString();
            contextInfo['streamPdaSeed'] = streamPdaSeed.toBase58();
            contextInfo['nowBn'] = nowBn.toString();

            txId = await program.methods
                .createStreamPda(
                    LATEST_IDL_FILE_VERSION,
                    "test pda stream",
                    nowBn,
                    new BN(10),
                    new BN(1),
                    new BN(1000),
                    new BN(0),
                    new BN(0),
                    true,
                    streamPdaSeed
                )
                .accounts({
                    payer: treasurerKey.publicKey,
                    treasurer: treasurerKey.publicKey,
                    treasury: treasury,
                    treasuryToken: treasuryFrom,
                    associatedToken: fromTokenClient.publicKey,
                    beneficiary: beneficiaryKey.publicKey,
                    stream: stream,
                    feeTreasury: MSP_FEES_PUBKEY,
                    feeTreasuryToken: FEES_FROM,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SYSTEM_PROGRAM_ID,
                    rent: SYSVAR_RENT_PUBKEY
                })
                .signers([payer, treasurerKey])
                .rpc();

            contextInfo['CREATE PDA STREAM TX'] = getTxUrl(txId);
        } catch (error) {
            console.log(error);
            console.table(contextInfo);
            throw error;
        }

    });

    /**
     * This test is not intended to be run by CI/CD workflows but only on local.
     * To run locally, remove the `x` from `xit`
     */
    xit('stream PDA address space', async () => {

        const {
            treasurerKey,
            treasurerFrom,
        } = await prepareTreasurer({ fromTokenClient, initialSolBalance: 1000_000_000_000, initialTokenBalance: 1000_000_000 });


        const {
            treasury,
            treasuryBump,
            treasuryFrom,
            treasurySlot,
        } = await prepareTreasury({ program, fromTokenClient, treasurerKey });

        const contextInfo: { [id: string]: string } = {};
        contextInfo['payer'] = payer.publicKey.toBase58();
        contextInfo['program'] = program.programId.toBase58();
        contextInfo['fromMint'] = fromTokenClient.publicKey.toBase58();
        contextInfo['treasurer'] = treasurerKey.publicKey.toBase58();
        contextInfo['treasurerFrom'] = treasurerFrom.toBase58();
        contextInfo['treasury'] = treasury.toBase58();
        contextInfo['treasuryFrom'] = treasuryFrom.toBase58();
        contextInfo['feesFrom'] = FEES_FROM.toBase58();
        contextInfo['treasurySlot'] = treasurySlot.toString();

        try {
            let txId = await program.methods
                .createTreasury(
                    LATEST_IDL_FILE_VERSION,
                    new anchor.BN(treasurySlot),
                    "test_treasury",
                    TREASURY_TYPE_OPEN,
                    false,
                    false,
                    { [Category[Category.default]]: {} },
                    { [SubCategory[SubCategory.default]]: {} }
                )
                .accounts({
                    payer: treasurerKey.publicKey,
                    treasurer: treasurerKey.publicKey,
                    treasury: treasury,
                    treasuryToken: treasuryFrom,
                    associatedToken: fromTokenClient.publicKey,
                    feeTreasury: MSP_FEES_PUBKEY,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SYSTEM_PROGRAM_ID,
                    rent: SYSVAR_RENT_PUBKEY
                })
                .signers([treasurerKey])
                .rpc();

            contextInfo['CREATE TREASURY TX'] = getTxUrl(txId);

            txId = await program.methods
                .addFunds(LATEST_IDL_FILE_VERSION, new BN(100_000_000))
                .accounts({
                    payer: treasurerKey.publicKey,
                    contributor: treasurerKey.publicKey,
                    contributorToken: treasurerFrom,
                    treasury: treasury,
                    treasuryToken: treasuryFrom,
                    associatedToken: fromTokenClient.publicKey,
                    feeTreasury: MSP_FEES_PUBKEY,
                    feeTreasuryToken: FEES_FROM,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SYSTEM_PROGRAM_ID,
                    rent: SYSVAR_RENT_PUBKEY
                })
                .signers([treasurerKey])
                .rpc();

            contextInfo['ADD FUNDS TX'] = getTxUrl(txId);

            for (let i = 0; i < 10_000; i++) {

                const {
                    beneficiaryKey,
                    stream,
                    streamBump,
                    streamPdaSeed,
                    nowBn,
                } = await preparePdaStream({
                    treasury,
                    programId: program.programId,
                })

                // contextInfo['last beneficiary'] = beneficiaryKey.publicKey.toBase58();
                // contextInfo['last stream'] = stream.toBase58();
                // contextInfo['last streamBump'] = streamBump.toString();
                // contextInfo['last streamPdaSeed'] = streamPdaSeed.toBase58();
                // contextInfo['last nowBn'] = nowBn.toString();

                const ix1 = await program.methods
                    .createStreamPda(
                        LATEST_IDL_FILE_VERSION,
                        "test pda stream",
                        nowBn,
                        new BN(10),
                        new BN(1),
                        new BN(1000),
                        new BN(0),
                        new BN(0),
                        true,
                        streamPdaSeed
                    )
                    .accounts({
                        payer: treasurerKey.publicKey,
                        treasurer: treasurerKey.publicKey,
                        treasury: treasury,
                        treasuryToken: treasuryFrom,
                        associatedToken: fromTokenClient.publicKey,
                        beneficiary: beneficiaryKey.publicKey,
                        stream: stream,
                        feeTreasury: MSP_FEES_PUBKEY,
                        feeTreasuryToken: FEES_FROM,
                        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        systemProgram: SYSTEM_PROGRAM_ID,
                        rent: SYSVAR_RENT_PUBKEY
                    })
                    .instruction();

                const {
                    beneficiaryKey: beneficiaryKey2,
                    stream: stream2,
                    streamBump: streamBump2,
                    streamPdaSeed: streamPdaSeed2,
                    nowBn: nowBn2,
                } = await preparePdaStream({
                    treasury,
                    programId: program.programId,
                })
                const ix2 = await program.methods
                    .createStreamPda(
                        LATEST_IDL_FILE_VERSION,
                        "test pda stream 2",
                        nowBn,
                        new BN(10),
                        new BN(1),
                        new BN(1000),
                        new BN(0),
                        new BN(0),
                        true,
                        streamPdaSeed2
                    )
                    .accounts({
                        payer: treasurerKey.publicKey,
                        treasurer: treasurerKey.publicKey,
                        treasury: treasury,
                        treasuryToken: treasuryFrom,
                        associatedToken: fromTokenClient.publicKey,
                        beneficiary: beneficiaryKey2.publicKey,
                        stream: stream2,
                        feeTreasury: MSP_FEES_PUBKEY,
                        feeTreasuryToken: FEES_FROM,
                        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        systemProgram: SYSTEM_PROGRAM_ID,
                        rent: SYSVAR_RENT_PUBKEY
                    })
                    .instruction();

                const {
                    beneficiaryKey: beneficiaryKey3,
                    stream: stream3,
                    streamBump: streamBump3,
                    streamPdaSeed: streamPdaSeed3,
                    nowBn: nowBn3,
                } = await preparePdaStream({
                    treasury,
                    programId: program.programId,
                })
                const ix3 = await program.methods
                    .createStreamPda(
                        LATEST_IDL_FILE_VERSION,
                        "test pda stream 3",
                        nowBn,
                        new BN(10),
                        new BN(1),
                        new BN(1000),
                        new BN(0),
                        new BN(0),
                        true,
                        streamPdaSeed3
                    )
                    .accounts({
                        payer: treasurerKey.publicKey,
                        treasurer: treasurerKey.publicKey,
                        treasury: treasury,
                        treasuryToken: treasuryFrom,
                        associatedToken: fromTokenClient.publicKey,
                        beneficiary: beneficiaryKey3.publicKey,
                        stream: stream3,
                        feeTreasury: MSP_FEES_PUBKEY,
                        feeTreasuryToken: FEES_FROM,
                        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        systemProgram: SYSTEM_PROGRAM_ID,
                        rent: SYSVAR_RENT_PUBKEY
                    })
                    .instruction();

                const tx = new Transaction({})
                    .add(ix1)
                    .add(ix2)
                    .add(ix3);

                tx.feePayer = payer.publicKey;
                tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
                const txId = await sendAndConfirmTransaction(connection, tx, [payer, treasurerKey], { commitment: 'confirmed' });
                const createPdaStreamTxUrl = getTxUrl(txId);
                console.log(`${(i + 1) * 3}. CREATE PDA STREAM: ${createPdaStreamTxUrl}`);
                // contextInfo['LAST CREATE PDA STREAM TX'] = createPdaStreamTxUrl;
            }
        } catch (error) {
            console.log(error);
            console.table(contextInfo);
            throw error;
        }
    });

    it('create treasury and stream template -> add funds -> create random keypair stream with template', async () => {

        const {
            treasurerKey,
            treasurerFrom,
        } = await prepareTreasurer({ fromTokenClient, initialTokenBalance: 1000_000_000 });


        const {
            treasury,
            treasuryBump,
            treasuryFrom,
            treasurySlot,
        } = await prepareTreasury({ program, fromTokenClient, treasurerKey });

        const [template, templateBump] = await anchor.web3.PublicKey.findProgramAddress(
          [anchor.utils.bytes.utf8.encode('template'), treasury.toBuffer()],
          program.programId
        );

        const contextInfo: { [id: string]: string } = {};
        contextInfo['payer'] = payer.publicKey.toBase58();
        contextInfo['program'] = program.programId.toBase58();
        contextInfo['fromMint'] = fromTokenClient.publicKey.toBase58();
        contextInfo['treasurer'] = treasurerKey.publicKey.toBase58();
        contextInfo['treasurerFrom'] = treasurerFrom.toBase58();
        contextInfo['treasury'] = treasury.toBase58();
        contextInfo['treasuryFrom'] = treasuryFrom.toBase58();
        contextInfo['feesFrom'] = FEES_FROM.toBase58();
        contextInfo['treasurySlot'] = treasurySlot.toString();
        contextInfo['template'] = template.toBase58();
        contextInfo['templateBump'] = templateBump.toString();

        try {

            const nowBn = new anchor.BN(Math.round(Date.now() / 1000));
            
            let txId = await program.methods
                .createTreasuryAndTemplate(
                    LATEST_IDL_FILE_VERSION,
                    "test treasury with template",
                    TREASURY_TYPE_OPEN,
                    false,
                    false,
                    { [Category[Category.default]]: {} },
                    { [SubCategory[SubCategory.default]]: {} },
                    nowBn,
                    new BN(1),
                    new BN(100),
                    new BN(0),
                    true,
                    new anchor.BN(treasurySlot),
                )
                .accounts({
                    payer: treasurerKey.publicKey,
                    treasurer: treasurerKey.publicKey,
                    treasury: treasury,
                    treasuryToken: treasuryFrom,
                    template: template,
                    associatedToken: fromTokenClient.publicKey,
                    feeTreasury: MSP_FEES_PUBKEY,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SYSTEM_PROGRAM_ID,
                    rent: SYSVAR_RENT_PUBKEY
                })
                .signers([treasurerKey])
                .rpc();

            contextInfo['CREATE TREASURY TX'] = getTxUrl(txId);

            txId = await program.methods
                .addFunds(LATEST_IDL_FILE_VERSION, new BN(100_000_000))
                .accounts({
                    payer: treasurerKey.publicKey,
                    contributor: treasurerKey.publicKey,
                    contributorToken: treasurerFrom,
                    treasury: treasury,
                    treasuryToken: treasuryFrom,
                    associatedToken: fromTokenClient.publicKey,
                    feeTreasury: MSP_FEES_PUBKEY,
                    feeTreasuryToken: FEES_FROM,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SYSTEM_PROGRAM_ID,
                    rent: SYSVAR_RENT_PUBKEY
                })
                .signers([treasurerKey])
                .rpc();

            contextInfo['ADD FUNDS TX'] = getTxUrl(txId);

            const {
                beneficiaryKey,
                streamKey,
                nowBn: _a,
            } = await prepareStream({
                treasury,
                programId: program.programId,
            })

            contextInfo['beneficiary'] = beneficiaryKey.publicKey.toBase58();
            contextInfo['stream'] = streamKey.publicKey.toBase58();
            contextInfo['template'] = template.toBase58();
            contextInfo['templateBump'] = templateBump.toString();
            contextInfo['nowBn'] = nowBn.toString();

            txId = await program.methods
                .createStreamWithTemplate(
                    LATEST_IDL_FILE_VERSION,
                    "test pda stream with template",
                    new BN(1000),
                )
                .accounts({
                    payer: treasurerKey.publicKey,
                    treasurer: treasurerKey.publicKey,
                    treasury: treasury,
                    treasuryToken: treasuryFrom,
                    associatedToken: fromTokenClient.publicKey,
                    beneficiary: beneficiaryKey.publicKey,
                    template: template,
                    stream: streamKey.publicKey,
                    feeTreasury: MSP_FEES_PUBKEY,
                    feeTreasuryToken: FEES_FROM,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SYSTEM_PROGRAM_ID,
                    rent: SYSVAR_RENT_PUBKEY
                })
                .signers([payer, treasurerKey, streamKey])
                .rpc();

            contextInfo['CREATE PDA STREAM TX'] = getTxUrl(txId);
        } catch (error) {
            console.log(error);
            console.table(contextInfo);
            throw error;
        }

    });

    it('create treasury and stream template -> add funds -> create PDA stream with template', async () => {

        const {
            treasurerKey,
            treasurerFrom,
        } = await prepareTreasurer({ fromTokenClient, initialTokenBalance: 1000_000_000 });

        const {
            treasury,
            treasuryBump,
            treasuryFrom,
            treasurySlot,
        } = await prepareTreasury({ program, fromTokenClient, treasurerKey });

        const [template, templateBump] = await anchor.web3.PublicKey.findProgramAddress(
          [anchor.utils.bytes.utf8.encode('template'), treasury.toBuffer()],
          program.programId
        );

        const contextInfo: { [id: string]: string } = {};
        contextInfo['payer'] = payer.publicKey.toBase58();
        contextInfo['program'] = program.programId.toBase58();
        contextInfo['fromMint'] = fromTokenClient.publicKey.toBase58();
        contextInfo['treasurer'] = treasurerKey.publicKey.toBase58();
        contextInfo['treasurerFrom'] = treasurerFrom.toBase58();
        contextInfo['treasury'] = treasury.toBase58();
        contextInfo['treasuryFrom'] = treasuryFrom.toBase58();
        contextInfo['feesFrom'] = FEES_FROM.toBase58();
        contextInfo['treasurySlot'] = treasurySlot.toString();
        contextInfo['template'] = template.toBase58();
        contextInfo['templateBump'] = templateBump.toString();

        try {

            const nowBn = new anchor.BN(Math.round(Date.now() / 1000));
            
            let txId = await program.methods
                .createTreasuryAndTemplate(
                    LATEST_IDL_FILE_VERSION,
                    "test treasury with template",
                    TREASURY_TYPE_OPEN,
                    false,
                    false,
                    { [Category[Category.default]]: {} },
                    { [SubCategory[SubCategory.default]]: {} },
                    nowBn,
                    new BN(1),
                    new BN(100),
                    new BN(0),
                    true,
                    new anchor.BN(treasurySlot),
                )
                .accounts({
                    payer: treasurerKey.publicKey,
                    treasurer: treasurerKey.publicKey,
                    treasury: treasury,
                    treasuryToken: treasuryFrom,
                    template: template,
                    associatedToken: fromTokenClient.publicKey,
                    feeTreasury: MSP_FEES_PUBKEY,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SYSTEM_PROGRAM_ID,
                    rent: SYSVAR_RENT_PUBKEY
                })
                .signers([treasurerKey])
                .rpc();

            contextInfo['CREATE TREASURY TX'] = getTxUrl(txId);

            txId = await program.methods
                .addFunds(LATEST_IDL_FILE_VERSION, new BN(100_000_000))
                .accounts({
                    payer: treasurerKey.publicKey,
                    contributor: treasurerKey.publicKey,
                    contributorToken: treasurerFrom,
                    treasury: treasury,
                    treasuryToken: treasuryFrom,
                    associatedToken: fromTokenClient.publicKey,
                    feeTreasury: MSP_FEES_PUBKEY,
                    feeTreasuryToken: FEES_FROM,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SYSTEM_PROGRAM_ID,
                    rent: SYSVAR_RENT_PUBKEY
                })
                .signers([treasurerKey])
                .rpc();

            contextInfo['ADD FUNDS TX'] = getTxUrl(txId);

            const {
                beneficiaryKey,
                stream,
                streamBump,
                streamPdaSeed,
                nowBn: _a,
            } = await preparePdaStream({
                treasury,
                programId: program.programId,
            })

            contextInfo['beneficiary'] = beneficiaryKey.publicKey.toBase58();
            contextInfo['stream'] = stream.toBase58();
            contextInfo['streamBump'] = streamBump.toString();
            contextInfo['streamPdaSeed'] = streamPdaSeed.toBase58();
            contextInfo['template'] = template.toBase58();
            contextInfo['templateBump'] = templateBump.toString();
            contextInfo['nowBn'] = nowBn.toString();

            txId = await program.methods
                .createStreamPdaWithTemplate(
                    LATEST_IDL_FILE_VERSION,
                    "test pda stream with template",
                    new BN(1000),
                    streamPdaSeed
                )
                .accounts({
                    payer: treasurerKey.publicKey,
                    treasurer: treasurerKey.publicKey,
                    treasury: treasury,
                    treasuryToken: treasuryFrom,
                    associatedToken: fromTokenClient.publicKey,
                    beneficiary: beneficiaryKey.publicKey,
                    template: template,
                    stream: stream,
                    feeTreasury: MSP_FEES_PUBKEY,
                    feeTreasuryToken: FEES_FROM,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SYSTEM_PROGRAM_ID,
                    rent: SYSVAR_RENT_PUBKEY
                })
                .signers([payer, treasurerKey])
                .rpc();

            contextInfo['CREATE PDA STREAM TX'] = getTxUrl(txId);
        } catch (error) {
            console.log(error);
            console.table(contextInfo);
            throw error;
        }

    });

    /**
     * This test is not intended to be run by CI/CD workflows but only on local
     * To run locally, remove the `x` from `xit`
     */
    xit('stream PDA address space with template', async () => {

        const {
            treasurerKey,
            treasurerFrom,
        } = await prepareTreasurer({ fromTokenClient, initialSolBalance: 1000_000_000_000, initialTokenBalance: 1000_000_000 });

        const {
            treasury,
            treasuryBump,
            treasuryFrom,
            treasurySlot,
        } = await prepareTreasury({ program, fromTokenClient, treasurerKey });

        const [template, templateBump] = await anchor.web3.PublicKey.findProgramAddress(
          [anchor.utils.bytes.utf8.encode('template'), treasury.toBuffer()],
          program.programId
        );

        const contextInfo: { [id: string]: string } = {};
        contextInfo['payer'] = payer.publicKey.toBase58();
        contextInfo['program'] = program.programId.toBase58();
        contextInfo['fromMint'] = fromTokenClient.publicKey.toBase58();
        contextInfo['treasurer'] = treasurerKey.publicKey.toBase58();
        contextInfo['treasurerFrom'] = treasurerFrom.toBase58();
        contextInfo['treasury'] = treasury.toBase58();
        contextInfo['treasuryFrom'] = treasuryFrom.toBase58();
        contextInfo['feesFrom'] = FEES_FROM.toBase58();
        contextInfo['treasurySlot'] = treasurySlot.toString();
        contextInfo['template'] = template.toBase58();
        contextInfo['templateBump'] = templateBump.toString();

        try {

            const nowBn = new anchor.BN(Math.round(Date.now() / 1000));

            let txId = await program.methods
                .createTreasuryAndTemplate(
                    LATEST_IDL_FILE_VERSION,
                    "test treasury with template",
                    TREASURY_TYPE_OPEN,
                    false,
                    false,
                    { [Category[Category.default]]: {} },
                    { [SubCategory[SubCategory.default]]: {} },
                    nowBn,
                    new BN(1),
                    new BN(100),
                    new BN(0),
                    true,
                    new anchor.BN(treasurySlot),
                )
                .accounts({
                    payer: treasurerKey.publicKey,
                    treasurer: treasurerKey.publicKey,
                    treasury: treasury,
                    treasuryToken: treasuryFrom,
                    template: template,
                    associatedToken: fromTokenClient.publicKey,
                    feeTreasury: MSP_FEES_PUBKEY,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SYSTEM_PROGRAM_ID,
                    rent: SYSVAR_RENT_PUBKEY
                })
                .signers([treasurerKey])
                .rpc();

            contextInfo['CREATE TREASURY TX'] = getTxUrl(txId);

            txId = await program.methods
                .addFunds(LATEST_IDL_FILE_VERSION, new BN(100_000_000))
                .accounts({
                    payer: treasurerKey.publicKey,
                    contributor: treasurerKey.publicKey,
                    contributorToken: treasurerFrom,
                    treasury: treasury,
                    treasuryToken: treasuryFrom,
                    associatedToken: fromTokenClient.publicKey,
                    feeTreasury: MSP_FEES_PUBKEY,
                    feeTreasuryToken: FEES_FROM,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SYSTEM_PROGRAM_ID,
                    rent: SYSVAR_RENT_PUBKEY
                })
                .signers([treasurerKey])
                .rpc();

            contextInfo['ADD FUNDS TX'] = getTxUrl(txId);

            for (let i = 0; i < 100; i++) {

                const {
                    beneficiaryKey,
                    stream,
                    streamBump,
                    streamPdaSeed,
                    nowBn,
                } = await preparePdaStream({
                    treasury,
                    programId: program.programId,
                })

                // contextInfo['last beneficiary'] = beneficiaryKey.publicKey.toBase58();
                // contextInfo['last stream'] = stream.toBase58();
                // contextInfo['last streamBump'] = streamBump.toString();
                // contextInfo['last streamPdaSeed'] = streamPdaSeed.toBase58();
                // contextInfo['last nowBn'] = nowBn.toString();

                const ix1 = await program.methods
                    .createStreamPdaWithTemplate(
                        LATEST_IDL_FILE_VERSION,
                        "test pda stream with template",
                        new BN(1000),
                        streamPdaSeed
                    )
                    .accounts({
                        payer: treasurerKey.publicKey,
                        treasurer: treasurerKey.publicKey,
                        treasury: treasury,
                        treasuryToken: treasuryFrom,
                        template: template,
                        associatedToken: fromTokenClient.publicKey,
                        beneficiary: beneficiaryKey.publicKey,
                        stream: stream,
                        feeTreasury: MSP_FEES_PUBKEY,
                        feeTreasuryToken: FEES_FROM,
                        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        systemProgram: SYSTEM_PROGRAM_ID,
                        rent: SYSVAR_RENT_PUBKEY
                    })
                    .instruction();

                const {
                    beneficiaryKey: beneficiaryKey2,
                    stream: stream2,
                    streamBump: streamBump2,
                    streamPdaSeed: streamPdaSeed2,
                    nowBn: nowBn2,
                } = await preparePdaStream({
                    treasury,
                    programId: program.programId,
                })
                const ix2 = await program.methods
                    .createStreamPdaWithTemplate(
                        LATEST_IDL_FILE_VERSION,
                        "test pda stream with template 2",
                        new BN(1000),
                        streamPdaSeed2
                    )
                    .accounts({
                        payer: treasurerKey.publicKey,
                        treasurer: treasurerKey.publicKey,
                        treasury: treasury,
                        treasuryToken: treasuryFrom,
                        template: template,
                        associatedToken: fromTokenClient.publicKey,
                        beneficiary: beneficiaryKey2.publicKey,
                        stream: stream2,
                        feeTreasury: MSP_FEES_PUBKEY,
                        feeTreasuryToken: FEES_FROM,
                        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        systemProgram: SYSTEM_PROGRAM_ID,
                        rent: SYSVAR_RENT_PUBKEY
                    })
                    .instruction();

                const {
                    beneficiaryKey: beneficiaryKey3,
                    stream: stream3,
                    streamBump: streamBump3,
                    streamPdaSeed: streamPdaSeed3,
                    nowBn: nowBn3,
                } = await preparePdaStream({
                    treasury,
                    programId: program.programId,
                })
                const ix3 = await program.methods
                    .createStreamPdaWithTemplate(
                        LATEST_IDL_FILE_VERSION,
                        "test pda stream with template 3",
                        new BN(1000),
                        streamPdaSeed3
                    )
                    .accounts({
                        payer: treasurerKey.publicKey,
                        treasurer: treasurerKey.publicKey,
                        treasury: treasury,
                        treasuryToken: treasuryFrom,
                        template: template,
                        associatedToken: fromTokenClient.publicKey,
                        beneficiary: beneficiaryKey3.publicKey,
                        stream: stream3,
                        feeTreasury: MSP_FEES_PUBKEY,
                        feeTreasuryToken: FEES_FROM,
                        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        systemProgram: SYSTEM_PROGRAM_ID,
                        rent: SYSVAR_RENT_PUBKEY
                    })
                    .instruction();

                const tx = new Transaction({})
                    .add(ix1)
                    .add(ix2)
                    .add(ix3);

                tx.feePayer = payer.publicKey;
                tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
                const txId = await sendAndConfirmTransaction(connection, tx, [payer, treasurerKey], { commitment: 'confirmed' });
                const createPdaStreamTxUrl = getTxUrl(txId);
                console.log(`${(i + 1) * 3}. CREATE PDA STREAM: ${createPdaStreamTxUrl}`);
                // contextInfo['LAST CREATE PDA STREAM TX'] = createPdaStreamTxUrl;
            }
        } catch (error) {
            console.log(error);
            console.table(contextInfo);
            throw error;
        }
    });

});

async function prepareTreasurer(p: {
    fromTokenClient: Token,
    initialSolBalance?: number,
    initialTokenBalance?: number,
}): Promise<{
    treasurerKey: Keypair,
    treasurer: PublicKey,
    treasurerFrom: PublicKey,
}> {
    const initialSolBalance = p.initialSolBalance ?? 1_000_000_000;
    const initialTokenBalance = p.initialTokenBalance ?? 10 ** DECIMALS;

    const treasurerKey = Keypair.generate();
    await connection.confirmTransaction(await connection.requestAirdrop(treasurerKey.publicKey, initialSolBalance), 'confirmed');
    const treasurerFromAccountInfo = await p.fromTokenClient.getOrCreateAssociatedAccountInfo(treasurerKey.publicKey);
    const treasurerFrom = treasurerFromAccountInfo.address;
    await p.fromTokenClient.mintTo(treasurerFrom, payer, [], initialTokenBalance);

    return {
        treasurerKey,
        treasurer: treasurerKey.publicKey,
        treasurerFrom
    };
}

async function prepareTreasury(p: {
    program: Program<Msp>,
    fromTokenClient: Token,
    treasurerKey: Keypair
}): Promise<{
    treasury: PublicKey,
    treasuryBump: number,
    treasuryFrom: PublicKey,
    treasurySlot: number,
}> {
    const treasurySlot = await p.program.provider.connection.getSlot('confirmed');
    const [treasury, treasuryBump] = await anchor.web3.PublicKey.findProgramAddress(
        [p.treasurerKey.publicKey.toBuffer(), new BN(treasurySlot).toBuffer('le', 8)],
        p.program.programId
    );
    const treasuryFrom = await Token.getAssociatedTokenAddress(
        ASSOCIATED_TOKEN_PROGRAM_ID, // associatedProgramId
        TOKEN_PROGRAM_ID, // programId
        p.fromTokenClient.publicKey, // mint
        treasury, // owner
        true // allowOwnerOffCurve
    );

    return {
        treasury,
        treasuryBump,
        treasuryFrom,
        treasurySlot
    };
}

async function prepareStream(p: {
    treasury: PublicKey,
    programId: PublicKey,
    beneficiaryInitialSolBalance?: number
}): Promise<{
    beneficiaryKey: Keypair,
    streamKey: Keypair,
    nowBn: BN,
}> {
    const nowBn = new anchor.BN(Math.round(Date.now() / 1000));

    const beneficiaryKey = Keypair.generate();
    if (p.beneficiaryInitialSolBalance && p.beneficiaryInitialSolBalance > 0) {
        await connection.confirmTransaction(
            await connection.requestAirdrop(beneficiaryKey.publicKey, p.beneficiaryInitialSolBalance),
            'confirmed'
        );
    }

    const streamKey = Keypair.generate();

    return {
        beneficiaryKey,
        streamKey,
        nowBn
    };
}

async function preparePdaStream(p: {
    treasury: PublicKey,
    programId: PublicKey,
    beneficiaryInitialSolBalance?: number,
}): Promise<{
    beneficiaryKey: Keypair,
    stream: PublicKey,
    streamBump: number,
    nowBn: BN,
    streamPdaSeed: PublicKey,
}> {
    const nowBn = new anchor.BN(Math.round(Date.now() / 1000));

    const beneficiaryKey = Keypair.generate();
    if (p.beneficiaryInitialSolBalance && p.beneficiaryInitialSolBalance > 0) {
        await connection.confirmTransaction(
            await connection.requestAirdrop(beneficiaryKey.publicKey, p.beneficiaryInitialSolBalance),
            'confirmed'
        );
    }

    const streamPdaSeed = Keypair.generate().publicKey;

    const [stream, streamBump] = await anchor.web3.PublicKey.findProgramAddress(
        // [Buffer.from(anchor.utils.bytes.utf8.encode('stream')), this.treasury.toBuffer(), streamPdaSeed.toBuffer()],
        [Buffer.from('stream'), p.treasury.toBuffer(), streamPdaSeed.toBuffer()],
        p.programId
    );

    return {
        beneficiaryKey,
        stream,
        streamBump,
        nowBn,
        streamPdaSeed
    };
}

function getTxUrl(txId: string) {
    return `https://explorer.solana.com/tx/${txId}/?cluster=custom&customUrl=${URL}`;
}