/**
 * Solana
 */
import {
  AccountInfo,
  Commitment,
  Connection,
  Finality,
  Keypair,
  PublicKey,
  Signer,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT as NATIVE_WSOL_MINT,
  Token,
  TOKEN_PROGRAM_ID,
  u64,
} from '@solana/spl-token';
import { BN, Program } from '@project-serum/anchor';

import { Msp as Ps } from './msp_idl_005';

/**
 * MSP
 */
import {
  Category,
  ListStreamParams,
  PaymentStreamingAccount,
  AccountType,
  Stream,
  StreamEventData,
  StreamTemplate,
  STREAM_STATUS,
  SubCategory,
  TimeUnit,
  VestingAccountActivity,
  VestingAccountActivityRaw,
  StreamActivityRaw,
  StreamActivity,
} from './types';
import {
  calculateAllocationAmount,
  createProgram,
  createWrapSolInstructions,
  findStreamTemplateAddress,
  getAccount,
  getStream,
  getStreamCached,
  getStreamEventData,
  getStreamTemplate,
  listAccounts,
  listStreamActivity,
  listStreams,
  listStreamsCached,
  listVestingAccountActivity,
  toUnixTimestamp,
} from './utils';
import {
  WARNING_TYPES,
  PAYMENT_STREAMING_PROGRAM_ID,
  NATIVE_SOL_MINT,
  CLIFF_PERCENT_NUMERATOR,
  CLIFF_PERCENT_DENOMINATOR,
} from './constants';

import * as instructions from './instructions';

/**
 * TS Client to interact with the Payment Streaming (PS) program.
 */
export class PaymentStreaming {
  private connection: Connection;
  private program: Program<Ps>;
  private blockhashCommitment: Commitment;

  /**
   * Creates a Payment Streaming client
   *
   * @param connection Connectin to use
   * @param programId Payment Streaming program ID. By default is the mainnet ID
   * @param blockhashCommitment Commitment used to fetch the latest `blockhash`
   * and corresponding `lastValidBlockHeight`
   */
  constructor(
    connection: Connection,
    programId = PAYMENT_STREAMING_PROGRAM_ID,
    blockhashCommitment?: Commitment,
  ) {
    this.connection = connection;
    this.blockhashCommitment = blockhashCommitment ?? 'confirmed';
    this.program = createProgram(this.connection, programId);
  }

  public async getStream(id: PublicKey): Promise<Stream | null> {
    return getStream(this.program, id);
  }

  public async getStreamRaw(id: PublicKey): Promise<StreamEventData | null> {
    return getStreamEventData(this.program, id);
  }

  public async refreshStream(
    streamInfo: any,
    hardUpdate = false,
  ): Promise<any> {
    const copyStreamInfo = Object.assign({}, streamInfo);

    if (hardUpdate) {
      const streamId =
        typeof copyStreamInfo.id === 'string'
          ? new PublicKey(copyStreamInfo.id)
          : (copyStreamInfo.id as PublicKey);

      return getStream(this.program, streamId);
    }

    return getStreamCached(copyStreamInfo);
  }

  public async listStreams({
    treasurer,
    psAccountOwner,
    treasury,
    psAccount,
    beneficiary,
    category = undefined,
    subCategory = undefined,
  }: ListStreamParams): Promise<Stream[]> {
    return listStreams(
      this.program,
      psAccountOwner || treasurer,
      psAccount || treasury,
      beneficiary,
      category,
      subCategory,
    );
  }

  public async refreshStreams(
    streamInfoList: Stream[],
    psAccountOwner?: PublicKey | undefined,
    psAccount?: PublicKey | undefined,
    beneficiary?: PublicKey | undefined,
    hardUpdate = false,
  ): Promise<Stream[]> {
    if (hardUpdate) {
      await listStreams(this.program, psAccountOwner, psAccount, beneficiary);
    }

    return listStreamsCached(streamInfoList);
  }

  /**
   *
   * @param id The address of the stream
   * @param before The signature to start searching backwards from.
   * @param limit The max amount of elements to retrieve
   * @param commitment Commitment to query the stream activity
   * @returns
   */
  public async listStreamActivity(
    id: PublicKey,
    before: string = '',
    limit = 10,
    commitment?: Finality | undefined,
  ): Promise<StreamActivityRaw[] | StreamActivity[]> {
    const accountInfo = await this.connection.getAccountInfo(id, commitment);

    if (!accountInfo) {
      throw Error('Stream not found');
    }

    return listStreamActivity(this.program, id, before, limit, commitment);
  }

  public async getAccount(
    id: PublicKey,
    commitment?: Commitment | undefined,
  ): Promise<PaymentStreamingAccount> {
    const accountInfo = await this.program.account.treasury.getAccountInfo(
      id,
      commitment,
    );

    if (!accountInfo) {
      throw Error('Payment Streaming account not found');
    }

    return getAccount(this.program, id);
  }

  public async listAccounts(
    owner: PublicKey | undefined,
    excludeAutoClose?: boolean,
    category?: Category,
    subCategory?: SubCategory,
  ): Promise<PaymentStreamingAccount[]> {
    return listAccounts(
      this.program,
      owner,
      excludeAutoClose,
      category,
      subCategory,
    );
  }

  public async getStreamTemplate(
    psAccount: PublicKey,
  ): Promise<StreamTemplate> {
    const [template] = await findStreamTemplateAddress(
      psAccount,
      this.program.programId,
    );
    return getStreamTemplate(this.program, template);
  }

  private async prepareTransaction(
    transaction: Transaction,
    feePayer: PublicKey,
  ) {
    transaction.feePayer = feePayer;
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash(this.blockhashCommitment);
    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;
  }

  private async createTransaction(
    instructions: TransactionInstruction[],
    feePayer: PublicKey,
    partialSigners?: Signer[],
  ): Promise<Transaction> {
    const transaction = new Transaction().add(...instructions);

    await this.prepareTransaction(transaction, feePayer);

    if (partialSigners?.length) {
      transaction.partialSign(...partialSigners);
    }

    return transaction;
  }

  /**
   * Contructs a transaction to perform a simple transfer of tokens to a
   * beneficiary using the Token program.
   *
   * @param sender - The account providing the tokens to transfer
   * @param feePayer - Account paying rent and protocol SOL fees
   * @param beneficiary - The beneficiary receiving the tokens
   * @param mint - The token mint to be sent. Pass the special
   * {@link NATIVE_SOL_MINT} here to crate a System program native SOL transfer
   * @param amount - The token amount to be sent
   */
  public async buildTransferTransaction(
    sender: PublicKey,
    feePayer: PublicKey,
    beneficiary: PublicKey,
    mint: PublicKey,
    amount: string | number, // Allow both types for compatibility
  ): Promise<Transaction> {
    const ixs: TransactionInstruction[] = [];
    const amountBN = new BN(amount);

    if (mint.equals(NATIVE_SOL_MINT)) {
      ixs.push(
        SystemProgram.transfer({
          fromPubkey: sender,
          toPubkey: beneficiary,
          lamports: BigInt(amountBN.toString()),
        }),
      );
    } else {
      const senderToken = await Token.getAssociatedTokenAddress(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        mint,
        sender,
        true,
      );

      const senderTokenInfo = await this.connection.getAccountInfo(senderToken);
      if (!senderTokenInfo) {
        throw Error('Sender token account not found');
      }

      let beneficiaryToken = beneficiary;
      const beneficiaryAccountInfo = await this.connection.getAccountInfo(
        beneficiary,
      );

      if (
        !beneficiaryAccountInfo ||
        !beneficiaryAccountInfo.owner.equals(TOKEN_PROGRAM_ID)
      ) {
        beneficiaryToken = await Token.getAssociatedTokenAddress(
          ASSOCIATED_TOKEN_PROGRAM_ID,
          TOKEN_PROGRAM_ID,
          mint,
          beneficiary,
          true,
        );

        const beneficiaryTokenAccountInfo =
          await this.connection.getAccountInfo(beneficiaryToken);

        if (!beneficiaryTokenAccountInfo) {
          ixs.push(
            Token.createAssociatedTokenAccountInstruction(
              ASSOCIATED_TOKEN_PROGRAM_ID,
              TOKEN_PROGRAM_ID,
              mint,
              beneficiaryToken,
              beneficiary,
              sender,
            ),
          );
        }
      } else {
        // At this point the beneficiaryToken is either a mint or a token account
        // Let's make sure it is a token account of the passed mint
        const tokenClient: Token = new Token(
          this.connection,
          mint,
          TOKEN_PROGRAM_ID,
          Keypair.generate(),
        );
        try {
          const beneficiaryTokenInfo = await tokenClient.getAccountInfo(
            beneficiaryToken,
          );
          if (!beneficiaryTokenInfo)
            throw Error('Reciever is not a token account');
        } catch (error) {
          throw Error('Reciever is not a token account');
        }
      }

      ixs.push(
        Token.createTransferInstruction(
          TOKEN_PROGRAM_ID,
          senderToken,
          beneficiaryToken,
          sender,
          [],
          new u64(amountBN.toString()),
        ),
      );
    }

    const tx = this.createTransaction(ixs, feePayer);
    return tx;
  }

  /**
   * Returns a transaction for scheduling a transfer as a stream without rate.
   *
   * @param owner - The account providing the tokens to transfer
   * @param feePayer - Account paying rent and protocol SOL fees
   * @param beneficiary - The account receiving the tokens
   * @param mint - The token mint to be sent
   * @param amount - The token amount to be allocated to the stream
   * @param startUtc - The date on which the transfer will be executed
   * @param streamName - The name of the transfer
   * @param tokenFeePayedByOwner - If true, the protocol token fees will be paid by the
   * {@link owner}, otherwise by the {@link beneficiary} at withdraw time
   */
  public async buildScheduleTransferTransaction(
    owner: PublicKey,
    feePayer: PublicKey,
    beneficiary: PublicKey,
    mint: PublicKey,
    amount: string | number,
    startUtc?: Date,
    streamName?: string,
    tokenFeePayedByOwner = false,
  ): Promise<{
    transaction: Transaction;
    stream: PublicKey;
  }> {
    let autoWSol = false;
    if (mint.equals(NATIVE_SOL_MINT)) {
      mint = NATIVE_WSOL_MINT;
      autoWSol = true;
    }

    const ixs: TransactionInstruction[] = [];
    const txSigners: Signer[] = [];

    const ownerToken = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mint,
      owner,
      true,
    );

    const ownerTokenInfo = await this.connection.getAccountInfo(ownerToken);
    await this.ensureAutoWrapSolInstructions(
      autoWSol,
      amount,
      owner,
      ownerToken,
      ownerTokenInfo,
      ixs,
      txSigners,
    );

    // Add create PS account instruction
    const {
      instruction: createAccountIx,
      psAccount: psAccount,
      psAccountToken: psAccountToken,
    } = await instructions.buildCreateAccountInstruction(
      this.program,
      {
        owner,
        feePayer,
        mint,
      },
      streamName ? `${streamName} (account)` : streamName,
      AccountType.Open,
      true,
      false,
    );
    ixs.push(createAccountIx);

    // Add add funds instruction
    const { instruction: addFundsIx, feeAccountToken } =
      await instructions.buildAddFundsInstruction(
        this.program,
        {
          psAccount,
          psAccountMint: mint,
          contributor: owner,
          feePayer: owner,
          psAccountToken,
          contributorToken: ownerToken,
        },
        new BN(amount),
      );
    ixs.push(addFundsIx);

    // Add CreateStream instruction since the OTP is scheduled
    const now = new Date();
    const start =
      !startUtc || startUtc.getTime() < now.getTime() ? now : startUtc;
    const startUtcInSeconds = Math.round(start.getTime() / 1000);

    const {
      instruction: createStreamIx,
      stream,
      streamKey,
    } = await instructions.buildCreateStreamInstruction(
      this.program,
      {
        psAccount,
        psAccountMint: mint,
        owner,
        feePayer,
        beneficiary,
        feeAccountToken
      },
      streamName ?? '',
      new BN(0),
      new BN(0),
      new BN(amount),
      new BN(startUtcInSeconds),
      new BN(amount),
      new BN(0),
      tokenFeePayedByOwner,
      false,
    );
    ixs.push(createStreamIx);
    if (streamKey) txSigners.push(streamKey);

    const tx = await this.createTransaction(ixs, feePayer, txSigners);
    return { transaction: tx, stream };
  }

  /**
   * Constructs a transaction to create a recurring payment at a given rate to
   * start immediately or scheduled.
   *
   * @param owner - The account providing the tokens to stream
   * @param feePayer - Account paying rent and protocol SOL fees
   * @param beneficiary - The account receiving the tokens
   * @param mint - The token mint to be sent
   * @param streamName - The name of the transfer.
   * @param rateAmount - Token amount that will be streamed in every
   * {@link rateIntervalInSeconds} period
   * @param rateIntervalInSeconds - Period of time in seconds in which the
   * {@link rateAmount} will be streamed progressively second by second
   * @param allocationAssigned - The token amount to be allocated to the stream
   * @param startUtc - The date and time on which the transfer will be executed
   * @param tokenFeePayedByOwner - If true, the protocol token fees will be
   * paid from {@link psAccountToken} and deposited upfront by the owner. If
   * false, the beneficiary will paid the token fees at withdraw time
   */
  public async buildStreamPaymentTransaction(
    owner: PublicKey,
    feePayer: PublicKey,
    beneficiary: PublicKey,
    mint: PublicKey,
    streamName: string,
    rateAmount: string | number,
    rateIntervalInSeconds: number,
    allocationAssigned: string | number,
    startUtc?: Date,
    tokenFeePayedByOwner = false,
  ): Promise<{
    transaction: Transaction;
    psAccount: PublicKey;
    psAccountToken: PublicKey;
    stream: PublicKey;
  }> {
    if (owner.equals(beneficiary)) {
      throw Error('Beneficiary can not be the same account owner');
    }

    let autoWSol = false;
    if (mint.equals(NATIVE_SOL_MINT)) {
      mint = NATIVE_WSOL_MINT;
      autoWSol = true;
    }

    const ixs: TransactionInstruction[] = [];
    const txSigners: Signer[] = [];

    // Add create PS account instruction
    const {
      instruction: createAccountIx,
      psAccount,
      psAccountToken,
    } = await instructions.buildCreateAccountInstruction(
      this.program,
      {
        owner,
        feePayer,
        mint,
      },
      streamName ? `${streamName} (account)` : streamName,
      AccountType.Open,
      true,
      false,
    );
    ixs.push(createAccountIx);

    // Get the PS account owner token account
    const ownerToken = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mint,
      owner,
      true,
    );

    const ownerTokenInfo = await this.connection.getAccountInfo(ownerToken);

    await this.ensureAutoWrapSolInstructions(
      autoWSol,
      new BN(allocationAssigned),
      owner,
      ownerToken,
      ownerTokenInfo,
      ixs,
      txSigners,
    );

    // add AddFunds instruction
    const { instruction: addFundsIx } =
      await instructions.buildAddFundsInstruction(
        this.program,
        {
          psAccount,
          psAccountMint: mint,
          psAccountToken,
          contributor: owner,
          feePayer,
        },
        new BN(allocationAssigned),
      );
    ixs.push(addFundsIx);

    // Add CreateStream instruction
    const now = new Date();
    const start = !startUtc || startUtc.getTime() < Date.now() ? now : startUtc;
    const startUtcInSeconds = Math.round(start.getTime() / 1000);
    const {
      instruction: createStreamIx,
      stream,
      streamKey,
    } = await instructions.buildCreateStreamInstruction(
      this.program,
      {
        psAccount,
        psAccountMint: mint,
        owner,
        beneficiary,
        feePayer,
      },
      streamName ?? '',
      new BN(startUtcInSeconds),
      new BN(rateAmount),
      new BN(rateIntervalInSeconds),
      new BN(allocationAssigned),
      new BN(0),
      new BN(0),
      tokenFeePayedByOwner,
      false,
    );
    ixs.push(createStreamIx);
    if (streamKey) txSigners.push(streamKey);

    const tx = await this.createTransaction(ixs, feePayer, txSigners);
    return { transaction: tx, psAccount, psAccountToken, stream };
  }

  /**
   * Constructs a transaction for creating a PS account.
   *
   * @param owner - Owner of the new account
   * @param feePayer - Account paying rent and protocol SOL fees
   * @param mint - Mint that will be streamed out of this account
   * @param name - Name for the new account
   * @param type - Either Open or Lock. Under locked accounts, once a stream
   * starts it cannot be paused or closed, they will run until out of funds
   * @param solFeePayedFromAccount
   * @param category
   * @param subCategory
   * @returns
   */
  public async buildCreateAccountTransaction(
    owner: PublicKey,
    feePayer: PublicKey,
    mint: PublicKey,
    name: string,
    type: AccountType,
    solFeePayedFromAccount = false,
    category: Category = Category.default,
    subCategory: SubCategory = SubCategory.default,
  ): Promise<{
    transaction: Transaction;
    psAccount: PublicKey;
    psAccountToken: PublicKey;
  }> {
    if (mint.equals(NATIVE_SOL_MINT)) {
      mint = NATIVE_WSOL_MINT;
    }

    // Add create PS account instruction
    const {
      instruction: createAccountIx,
      psAccount,
      psAccountToken,
    } = await instructions.buildCreateAccountInstruction(
      this.program,
      {
        owner,
        feePayer,
        mint,
      },
      name || '',
      type,
      false,
      solFeePayedFromAccount,
      category,
      subCategory,
    );

    const tx = await this.createTransaction([createAccountIx], feePayer);
    return { transaction: tx, psAccount, psAccountToken };
  }

  /**
   * Constructs a transaction for creating a stream under a PS account.
   *
   * @param psAccount - The PS account under the new stream will be created
   * @param owner - Owner of the PS account
   * @param feePayer - Account paying rent and protocol SOL fees
   * @param beneficiary - Destination account authorized to withdraw streamed
   * tokens
   * @param streamName - A name for the new stream
   * @param rateAmount - Token amount that will be streamed in every
   * {@link rateIntervalInSeconds} period
   * @param rateIntervalInSeconds - Period of time in seconds in which the
   * {@link rateAmount} will be streamed progressively second by second
   * @param allocationAssigned - Total token amount allocated to the new stream
   * out of the containing PS account's unallocated balance
   * @param startUtc - Date and time when the stream will start
   * @param cliffVestAmount - Token amount that is immediatelly withdrawable
   * by the {@link beneficiary} as soon as the stream starts. When
   * {@link cliffVestPercent} is greater than zero, this value will be ignored
   * @param cliffVestPercent - The 0-100 percentage of
   * {@link allocationAssigned} that is immediatelly withdrawable by the
   * {@link beneficiary} as soon as the stream starts. It takes precedence over
   * {@link cliffVestAmount}, i.e. when this value is greater than zero,
   * {@link cliffVestAmount} will be ignored
   * @param tokenFeePayedFromAccount - If true, the protocol token fees will be
   * paid from the PS account ATA and deposited upfront during stream
   * creation or allocation. If false, the beneficiary will pay for token fees
   * at withdraw time
   * @param usePda - If true, the new stream will be created at an address
   * derived from the program
   */
  public async buildCreateStreamTransaction(
    psAccount: PublicKey,
    owner: PublicKey,
    feePayer: PublicKey,
    beneficiary: PublicKey,
    streamName: string,
    rateAmount: number | string,
    rateIntervalInSeconds: number,
    allocationAssigned: number | string,
    startUtc?: Date,
    cliffVestAmount: number | string = 0,
    cliffVestPercent: number = 0,
    tokenFeePayedFromAccount: boolean = false,
    usePda: boolean = false,
  ): Promise<{ transaction: Transaction; stream: PublicKey }> {
    if (owner.equals(beneficiary)) {
      throw Error('Beneficiary can not be the same as the account owner');
    }

    if (cliffVestPercent < 0 || cliffVestPercent > 100) {
      throw Error('Invalid cliffVestPercent');
    }

    const psAccountInfo = await getAccount(this.program, psAccount);
    if (!psAccountInfo) {
      throw Error('Payment Streaming account not found');
    }

    const psAccountMint = new PublicKey(psAccountInfo.mint);

    const cliffVestPercentValue = Math.round(
      cliffVestPercent * CLIFF_PERCENT_NUMERATOR,
    );
    const now = new Date();
    const startDate =
      startUtc && startUtc.getTime() >= now.getTime() ? startUtc : now;
    const startUnixTimestamp = toUnixTimestamp(startDate);

    const {
      instruction: createStreamIx,
      streamKey,
      stream,
    } = await instructions.buildCreateStreamInstruction(
      this.program,
      { psAccount, psAccountMint, owner, feePayer, beneficiary },
      streamName,
      new BN(rateAmount),
      new BN(rateIntervalInSeconds),
      new BN(allocationAssigned),
      new BN(startUnixTimestamp),
      new BN(cliffVestAmount),
      new BN(cliffVestPercentValue),
      tokenFeePayedFromAccount,
      usePda,
    );

    const tx = await this.createTransaction(
      [createStreamIx],
      feePayer,
      streamKey ? [streamKey] : undefined,
    );
    return {
      transaction: tx,
      stream: stream,
    };
  }

  /**
   * Constructs a transaction to create vesting contract account together with a
   * configuration account (template) for creating vesting streams.
   *
   * @param owner - Owner of the vesting contract account
   * @param feePayer - Account paying rent and protocol SOL fees
   * @param mint - Mint that will be vested
   * @param name - Name for the vesting contract account
   * @param type - Either Open or Lock. Under locked accounts, once a stream
   * starts it cannot be paused or closed, they will run until out of funds
   * @param solFeePayedFromAccount - If true, protocol SOL fees will be payed
   * from the newly created account, otherwise from the {@link feePayer} account
   * @param numberOfIntervals - Number of intervals of duration
   * {@link rateIntervalInSeconds} in which the allocation assigned will be
   * streamed
   * @param intervalUnit - Duration of each interval (E.g. for 1 minute
   *  intervals pass {@link TimeUnit.Minute}, for 1 hour intervals pass
   * {@link TimeUnit.Hour} and so on). See {@link TimeUnit} enum
   * @param fundingAmount - The token amount to fund the newly creawted
   * vesting account if a value greater than 0 is provided
   * @param vestingCategory - Category for the vesting contract account
   * @param startUtc - The vesting contract start date
   * @param cliffVestPercent - When a vesting stream is created using this
   * template, this is the 0-100 percentage of the allocation assigned to the
   * stream that is immediatelly withdrawable by the beneficiary as soon as the
   * vesting stream starts
   * @param tokenFeePayedFromAccount - If true, the protocol token fees will be
   * paid from PS account ATA and deposited upfront during stream
   * creation or allocation. If false, the beneficiary will pay for token fees
   * at withdraw time
   */
  public async buildCreateVestingAccountTransaction(
    owner: PublicKey,
    feePayer: PublicKey,
    mint: PublicKey,
    name: string,
    type: AccountType,
    solFeePayedFromAccount: boolean,
    numberOfIntervals: number,
    intervalUnit: TimeUnit,
    fundingAmount: string | number,
    vestingCategory: SubCategory,
    startUtc?: Date,
    cliffVestPercent = 0,
    tokenFeePayedFromAccount: boolean = false,
  ): Promise<{
    transaction: Transaction;
    vestingAccount: PublicKey;
    vestingAccountToken: PublicKey;
    template: PublicKey;
  }> {
    // convert interval unit to seconds
    const rateIntervalInSeconds: number = intervalUnit as number;

    let autoWSol = false;
    if (mint.equals(NATIVE_SOL_MINT)) {
      mint = NATIVE_WSOL_MINT;
      autoWSol = true;
    }

    const ixs: TransactionInstruction[] = [];
    const txSigners: Signer[] = [];

    const cliffVestPercentValue = cliffVestPercent
      ? cliffVestPercent * CLIFF_PERCENT_NUMERATOR
      : 0;
    const now = new Date();
    const startDate =
      startUtc && startUtc.getTime() >= now.getTime() ? startUtc : now;
    const startTs = toUnixTimestamp(startDate);

    const {
      instruction: createAccountAndTemplateInstruction,
      psAccount,
      psAccountToken,
      template,
    } = await instructions.buildCreateAccountAndTemplateInstruction(
      this.program,
      { owner, mint, feePayer },
      name,
      type,
      solFeePayedFromAccount,
      {
        rateIntervalInSeconds: new BN(rateIntervalInSeconds),
        numberOfIntervals: new BN(numberOfIntervals),
        startTs: new BN(startTs),
        cliffVestPercent: new BN(cliffVestPercentValue),
        tokenFeePayedFromAccount,
      },
      Category.vesting,
      vestingCategory,
    );
    ixs.push(createAccountAndTemplateInstruction);

    const fundingAmountBN = new BN(fundingAmount);
    if (fundingAmountBN.gtn(0)) {
      const ownerToken = await Token.getAssociatedTokenAddress(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        mint,
        owner,
        true,
      );

      const ownerTokenInfo = await this.connection.getAccountInfo(
        ownerToken,
        'recent',
      );

      await this.ensureAutoWrapSolInstructions(
        autoWSol,
        fundingAmount,
        owner,
        ownerToken,
        ownerTokenInfo,
        ixs,
        txSigners,
      );

      // add AddFunds instruction
      const { instruction: addFundsToVestingAccountIx } =
        await instructions.buildAddFundsInstruction(
          this.program,
          {
            psAccount,
            psAccountToken,
            psAccountMint: mint,
            contributor: owner,
            contributorToken: ownerToken,
            feePayer,
          },
          fundingAmountBN,
        );
      ixs.push(addFundsToVestingAccountIx);
    }

    const tx = await this.createTransaction(ixs, feePayer, txSigners);
    return {
      transaction: tx,
      vestingAccount: psAccount,
      vestingAccountToken: psAccountToken,
      template,
    };
  }

  /**
   * Constructs a transaction for updating values of vesting account
   * template if no streams have been created yet.
   */
  public async buildUpdateVestingAccountTemplate(
    owner: PublicKey,
    feePayer: PublicKey,
    vestingAccount: PublicKey,
    numberOfIntervals?: number,
    intervalUnit?: TimeUnit,
    startUtc?: Date,
    cliffVestPercent?: number,
    tokenFeePayedFromAccount?: boolean,
  ): Promise<{
    transaction: Transaction;
  }> {
    const psAccountInfo = await getAccount(this.program, vestingAccount);

    if (!psAccountInfo) {
      throw Error('Payment Streaming account not found');
    }

    // Get the template
    const [template] = await findStreamTemplateAddress(
      vestingAccount,
      this.program.programId,
    );
    const templateInfo = await getStreamTemplate(this.program, template);
    if (!templateInfo) {
      throw Error('Template account not found');
    }

    if (psAccountInfo.totalStreams > 0) {
      throw Error(
        'Cannot modify vesting account after streams have been created',
      );
    }

    if (numberOfIntervals && !intervalUnit) {
      throw Error('Interval unit is required');
    }

    if (intervalUnit && !numberOfIntervals) {
      throw Error('Number of intervals is required');
    }

    let newRateIntervalInSeconds: number = templateInfo.rateIntervalInSeconds;
    let newNumberOfIntervals: number = templateInfo.durationNumberOfUnits;
    if (numberOfIntervals && intervalUnit) {
      newRateIntervalInSeconds = intervalUnit as number;
      newNumberOfIntervals = numberOfIntervals;
    }

    const newClifPercentValue =
      cliffVestPercent !== undefined
        ? cliffVestPercent * CLIFF_PERCENT_NUMERATOR
        : templateInfo.cliffVestPercent;

    let newStartTs: number = toUnixTimestamp(new Date(templateInfo.startUtc));
    if (startUtc) {
      const now = new Date();
      const startDate = startUtc.getTime() >= now.getTime() ? startUtc : now;
      newStartTs = toUnixTimestamp(startDate);
    }

    const newTokenFeePayedFromVestingAccount =
      tokenFeePayedFromAccount !== undefined
        ? tokenFeePayedFromAccount
        : templateInfo.feePayedByTreasurer;

    const { instruction: updateTemplateInstruction } =
      await instructions.buildUpdateStreamTemplateInstruction(
        this.program,
        { psAccount: vestingAccount, template, owner, feePayer },
        new BN(newRateIntervalInSeconds),
        new BN(newNumberOfIntervals),
        new BN(newStartTs),
        new BN(newClifPercentValue),
        newTokenFeePayedFromVestingAccount,
      );

    const tx = await this.createTransaction(
      [updateTemplateInstruction],
      feePayer,
    );
    return { transaction: tx };
  }

  /**
   *
   * @param vestingAccount - The vesting account
   * @param before The signature to start searching backwards from.
   * @param limit The max amount of elements to retrieve
   * @param commitment Commitment to query the vesting account activity
   * @returns
   */
  public async listVestingAccountActivity(
    vestingAccount: PublicKey,
    before: string,
    limit = 10,
    commitment?: Finality | undefined,
  ): Promise<VestingAccountActivity[] | VestingAccountActivityRaw[]> {
    const accountInfo = await this.connection.getAccountInfo(
      vestingAccount,
      commitment,
    );

    if (!accountInfo) {
      throw Error("Vesting account doesn't exists");
    }

    return listVestingAccountActivity(
      this.program,
      vestingAccount,
      before,
      limit,
      commitment,
    );
  }

  /**
   * Gets the flowing rate of a vesting contract.
   * @param vestingAccount - The address of the vesting contract account
   * @param onlyRunning - If true, only running streams will be accounted
   */
  public async getVestingAccountFlowRate(
    vestingAccount: PublicKey,
    onlyRunning = true,
  ): Promise<{
    rateAmount: BN;
    intervalUnit: TimeUnit;
    totalAllocation: BN;
  }> {
    const psAccountInfo = await getAccount(this.program, vestingAccount);

    if (!psAccountInfo) {
      throw Error('Vesting account not found');
    }

    // Get the template
    const [templateAddress] = await findStreamTemplateAddress(
      vestingAccount,
      this.program.programId,
    );
    const templateInfo = await getStreamTemplate(this.program, templateAddress);
    if (!templateInfo) {
      throw Error('Stream template not found');
    }

    if (psAccountInfo.totalStreams === 0) {
      return {
        rateAmount: new BN(0),
        intervalUnit: templateInfo.rateIntervalInSeconds as TimeUnit,
        totalAllocation: new BN(0),
      };
    }

    const streams = await listStreams(
      this.program,
      undefined,
      vestingAccount,
      undefined,
      Category.vesting,
    );

    let totalAllocation = new BN(0);
    let streamRate = new BN(0);

    for (const stream of streams) {
      totalAllocation = totalAllocation.add(stream.allocationAssigned);
      switch (stream.status) {
        case STREAM_STATUS.Paused:
        case STREAM_STATUS.Scheduled:
          if (onlyRunning) continue;
      }
      if (stream.remainingAllocationAmount.lten(0)) {
        // all streamed
        continue;
      }

      const percentDenominator = new BN(CLIFF_PERCENT_DENOMINATOR);
      const allocationTotal = new BN(stream.allocationAssigned);
      const cliffAmount = allocationTotal
        .mul(new BN(templateInfo.cliffVestPercent))
        .div(percentDenominator);
      const allocationAfterCliff = allocationTotal.sub(cliffAmount);
      const rateAmount = allocationAfterCliff.div(
        new BN(templateInfo.durationNumberOfUnits),
      );

      streamRate = streamRate.add(rateAmount);
    }

    return {
      rateAmount: streamRate,
      intervalUnit: templateInfo.rateIntervalInSeconds as TimeUnit,
      totalAllocation: totalAllocation,
    };
  }

  /**
   *
   * Creates a vesting stream based on the vesting contract template.
   *
   * @param vestingAccount - The vesting account under the new stream will be
   * created
   * @param owner - Owner of the PS account
   * @param feePayer - Account paying rent and protocol SOL fees
   * @param beneficiary - Destination account authorized to withdraw streamed
   * tokens
   * @param streamName - A name for the new stream
   * @param allocationAssigned - Total token amount allocated to the new stream
   * out of the containing vesting account's unallocated balance
   */
  public async buildCreateVestingStreamTransaction(
    vestingAccount: PublicKey,
    owner: PublicKey,
    feePayer: PublicKey,
    beneficiary: PublicKey,
    allocationAssigned: string | number,
    streamName = '',
    usePda: boolean = false,
  ): Promise<{
    transaction: Transaction;
    stream: PublicKey;
    template: PublicKey;
  }> {
    if (owner.equals(beneficiary)) {
      throw Error('Beneficiary can not be the same as owner');
    }

    const psAccountInfo = await getAccount(this.program, vestingAccount);

    if (!psAccountInfo) {
      throw Error('Payment Streaming account not found');
    }
    const psAccountMint = new PublicKey(psAccountInfo.mint);
    // Get the template
    const [template] = await findStreamTemplateAddress(
      vestingAccount,
      this.program.programId,
    );
    const templateInfo = await getStreamTemplate(this.program, template);
    if (!templateInfo) {
      throw Error("Stream template doesn't exist");
    }

    const {
      instruction: createStreamIx,
      streamKey,
      stream,
    } = await instructions.buildCreateStreamWithTemplateInstruction(
      this.program,
      {
        psAccount: vestingAccount,
        psAccountMint,
        template,
        owner,
        feePayer,
        beneficiary,
      },
      new BN(allocationAssigned),
      streamName,
      usePda,
    );

    const tx = await this.createTransaction(
      [createStreamIx],
      feePayer,
      streamKey ? [streamKey] : undefined,
    );
    return {
      transaction: tx,
      stream: stream,
      template: template,
    };
  }

  /**
   * Constructs a transaction to add funds to a PS account. The funds are
   * added as unallocated balance.
   *
   * @param psAccount - The PS account to add funds to
   * @param psAccountMint - Mint of the PS account
   * @param contributor - The account providing the funds
   * @param feePayer - Account paying rent and protocol SOL fees
   * @param amount - Token amount to add
   */
  public async buildAddFundsToAccountTransaction(
    psAccount: PublicKey,
    psAccountMint: PublicKey,
    contributor: PublicKey,
    feePayer: PublicKey,
    amount: string | number,
  ): Promise<{
    transaction: Transaction;
  }> {
    if (!amount) {
      throw Error('Amount should be greater than 0');
    }

    let autoWSol = false;
    if (psAccountMint.equals(NATIVE_SOL_MINT)) {
      psAccountMint = NATIVE_WSOL_MINT;
      autoWSol = true;
    }

    const contributorToken = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      psAccountMint,
      contributor,
      true,
    );

    const contributorTokenInfo = await this.connection.getAccountInfo(
      contributorToken,
      'recent',
    );

    const ixs: TransactionInstruction[] = [];
    const txSigners: Signer[] = [];

    await this.ensureAutoWrapSolInstructions(
      autoWSol,
      amount,
      contributor,
      contributorToken,
      contributorTokenInfo,
      ixs,
      txSigners,
    );

    const psAccountToken = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      psAccountMint,
      psAccount,
      true,
    );

    const { instruction: createAddFundsInstruction } =
      await instructions.buildAddFundsInstruction(
        this.program,
        {
          psAccount,
          psAccountMint,
          psAccountToken,
          contributor,
          contributorToken,
          feePayer,
        },
        new BN(amount),
      );
    ixs.push(createAddFundsInstruction);

    const tx = await this.createTransaction(ixs, feePayer, txSigners);
    return {
      transaction: tx,
    };
  }

  /**
   * Constructs a transaction to allocate funds to a stream from the PS
   * account unallocated balance
   *
   * @param psAccount - The PS account containing the stream
   * @param owner - Owner of the new account
   * @param feePayer - Account paying rent and protocol SOL fees
   * @param stream - Stream to allocate funds to
   * @param amount - Token amount to allocate
   */
  public async buildAllocateFundsToStreamTransaction(
    psAccount: PublicKey,
    owner: PublicKey,
    feePayer: PublicKey,
    stream: PublicKey,
    amount: string | number,
  ): Promise<{ transaction: Transaction }> {
    if (!amount) {
      throw Error('Amount must be greater than 0');
    }

    const psAccountInfo = await getAccount(this.program, psAccount);

    if (!psAccountInfo) {
      throw Error('Payment Streaming account not found');
    }

    if (!psAccountInfo.owner.equals(owner)) {
      throw Error('Invalid account owner');
    }

    const streamInfo = (await this.getStream(stream)) as Stream;

    if (!streamInfo) {
      throw Error('Stream account not found');
    }

    if (!psAccountInfo.mint.equals(streamInfo.mint)) {
      throw Error('Invalid stream mint');
    }

    const psAccountToken = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      psAccountInfo.mint,
      psAccount,
      true,
    );

    const { instruction: allocateFundsToStreamInstruction } =
      await instructions.buildAllocateFundsToStreamInstruction(
        this.program,
        {
          psAccount,
          psAccountMint: psAccountInfo.mint,
          psAccountToken,
          owner,
          feePayer,
          stream,
        },
        new BN(amount),
      );

    const tx = await this.createTransaction(
      [allocateFundsToStreamInstruction],
      feePayer,
    );
    return {
      transaction: tx,
    };
  }

  /**
   * Constructs a transaction which does both: adding funds to a PS account
   * and allocating the funds to the specified stream.
   *
   * @param psAccount
   * @param owner
   * @param feePayer
   * @param stream
   * @param amount
   * @param autoWSol - Whether a wrap SOL instruction should be included in
   * the transaction if necessary
   */
  public async buildFundStreamTransaction(
    psAccount: PublicKey,
    owner: PublicKey,
    feePayer: PublicKey,
    stream: PublicKey,
    amount: string | number,
    autoWSol = false,
  ): Promise<{ transaction: Transaction }> {
    const ixs: TransactionInstruction[] = [];
    const txSigners: Signer[] = [];
    const amountBN = new BN(amount || 0);

    if (!amount || amountBN.isZero()) {
      throw Error('Amount must be greater than 0');
    }

    const psAccountInfo = await getAccount(this.program, psAccount);

    if (!psAccountInfo) {
      throw Error('Payment Streaming account not found');
    }

    const streamInfo = (await this.getStream(stream)) as Stream;

    if (!streamInfo) {
      throw Error('Stream account not found');
    }

    if (!psAccountInfo.mint.equals(streamInfo.mint)) {
      throw Error('Invalid stream mint');
    }

    const ownerToken = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      psAccountInfo.mint,
      owner,
      true,
    );

    const ownerTokenInfo = await this.connection.getAccountInfo(ownerToken);
    await this.ensureAutoWrapSolInstructions(
      autoWSol,
      amount,
      owner,
      ownerToken,
      ownerTokenInfo,
      ixs,
      txSigners,
    );

    // add AddFunds intruction
    const { instruction: addFundsInstruction, psAccountToken } =
      await instructions.buildAddFundsInstruction(
        this.program,
        {
          psAccount,
          psAccountMint: psAccountInfo.mint,
          contributor: owner,
          contributorToken: ownerToken,
          feePayer,
        },
        new BN(amount),
      );
    ixs.push(addFundsInstruction);

    // calculate fee if are payed from the PS account to deduct it from the amount
    let allocationAmountBn = new BN(amount);

    if (streamInfo.tokenFeePayedFromAccount) {
      allocationAmountBn = await calculateAllocationAmount(
        this.program.provider.connection,
        psAccountInfo,
        amount,
      );
    }

    // add allocate instruction
    const { instruction: allocateInstruction } =
      await instructions.buildAllocateFundsToStreamInstruction(
        this.program,
        {
          psAccount,
          psAccountMint: psAccountInfo.mint,
          psAccountToken,
          owner,
          feePayer,
          stream,
        },
        allocationAmountBn,
      );
    ixs.push(allocateInstruction);

    const tx = await this.createTransaction(ixs, feePayer);
    return {
      transaction: tx,
    };
  }

  /**
   * Constructs a transaction to withdraw funds from a Payment Streaming
   * account.
   *
   * @param psAccount - The PS account to withdraw funds from
   * @param feePayer - Account paying rent and protocol SOL fees
   * @param destination - Owner of the associated token account where the
   * withdrawn funds will be deposited
   * @param amount - Token amount to withdraw
   * @param autoWSol - Whether a wrap SOL instruction should be included in
   * the transaction if necessary
   */
  public async buildWithdrawFromAccountTransaction(
    psAccount: PublicKey,
    feePayer: PublicKey,
    destination: PublicKey,
    amount: number | string,
    autoWSol = false,
  ): Promise<{ transaction: Transaction }> {
    const amountBn = new BN(amount);
    if (!amountBn.gt(new BN(0))) {
      throw Error('Amount to withdraw must be positive');
    }
    const psAccountInfo = await getAccount(this.program, psAccount);

    if (!psAccountInfo) {
      throw Error('Payment Streaming account not found');
    }

    const ixs: TransactionInstruction[] = [];

    const { instruction: withdrawFromAccountInstruction, destinationToken } =
      await instructions.buildWithdrawFromAccountInstruction(
        this.program,
        {
          psAccount,
          psAccountMint: psAccountInfo.mint,
          owner: psAccountInfo.owner,
          feePayer,
          destination,
        },
        amountBn,
      );
    ixs.push(withdrawFromAccountInstruction);

    if (
      autoWSol &&
      psAccountInfo.mint.equals(NATIVE_WSOL_MINT) &&
      destination.equals(psAccountInfo.owner) // the ata authority needs to be signer for the unwrap to work
    ) {
      const closeWSolIx = Token.createCloseAccountInstruction(
        TOKEN_PROGRAM_ID,
        destinationToken,
        destination,
        destination,
        [],
      );
      ixs.push(closeWSolIx);
    }

    const tx = await this.createTransaction(ixs, feePayer);
    return {
      transaction: tx,
    };
  }

  public async buildRefreshAccountDataTransaction(
    psAccount: PublicKey,
    feePayer: PublicKey,
  ): Promise<{ transaction: Transaction }> {
    const psAccountInfo = await getAccount(this.program, psAccount);

    if (!psAccountInfo) {
      throw Error('Payment Streaming account not found');
    }

    const { instruction: refreshAccountDataInstruction } =
      await instructions.buildRefreshAccountDataInstruction(this.program, {
        psAccount,
        psAccountMint: psAccountInfo.mint,
      });

    const tx = await this.createTransaction(
      [refreshAccountDataInstruction],
      feePayer,
    );
    return {
      transaction: tx,
    };
  }

  /**
   * Constructs a transaction to close a Payment Streaming account.
   *
   * @param psAccount - The PS account to withdraw funds from
   * @param feePayer - Account paying rent and protocol SOL fees
   * @param destination - Owner of the associated token account where the
   * remaining funds will be deposited
   * @param autoWSol - Whether a wrap SOL instruction should be included in
   * the transaction if necessary
   */
  public async buildCloseAccountTransaction(
    psAccount: PublicKey,
    feePayer: PublicKey,
    destination: PublicKey,
    autoWSol = false,
  ): Promise<{ transaction: Transaction }> {
    const psAccountInfo = await getAccount(this.program, psAccount);

    if (!psAccountInfo) {
      throw Error('Payment Streaming account not found');
    }

    // just send any mint to close an account without a mint set
    const psAccountMint = psAccountInfo.mint.equals(PublicKey.default)
      ? new PublicKey(NATIVE_WSOL_MINT)
      : psAccountInfo.mint;

    const destinationToken = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      psAccountMint,
      destination,
      true,
    );

    const ixs: TransactionInstruction[] = [];

    const { instruction: closeAccountInstruction } =
      await instructions.buildCloseFromAccountInstruction(this.program, {
        psAccount,
        psAccountMint,
        owner: psAccountInfo.owner,
        feePayer,
        destination,
      });
    ixs.push(closeAccountInstruction);

    if (
      autoWSol &&
      psAccountMint.equals(NATIVE_WSOL_MINT) &&
      destination.equals(psAccountInfo.owner) // the ata authority needs to be signer for the unwrap to work
    ) {
      const closeWSolIx = Token.createCloseAccountInstruction(
        TOKEN_PROGRAM_ID,
        destinationToken,
        destination,
        destination,
        [],
      );
      ixs.push(closeWSolIx);
    }

    const tx = await this.createTransaction(ixs, feePayer);
    return {
      transaction: tx,
    };
  }

  /**
   * Constructs a transaction to withdraw funds from a stream.
   *
   * @param stream - The stream to withdraw fund from
   * @param feePayer - Account paying rent and protocol SOL fees
   * @param amount - The token amount to withdraw
   * @param autoWSol - Whether a wrap SOL instruction should be included in
   * the transaction if necessary
   */
  public async buildWithdrawFromStreamTransaction(
    stream: PublicKey,
    feePayer: PublicKey,
    amount: number | string,
    autoWSol = false,
  ): Promise<{ transaction: Transaction }> {
    if (!amount) {
      throw Error('Amount should be greater than 0');
    }

    const streamInfo = (await this.getStream(stream)) as Stream;

    if (!streamInfo) {
      throw Error("Stream doesn't exist");
    }

    if (streamInfo.status === STREAM_STATUS.Scheduled) {
      throw Error('Stream has not started');
    }

    if (streamInfo.withdrawableAmount.isZero()) {
      throw Error('Stream withdrawable amount is zero');
    }

    const beneficiary = streamInfo.beneficiary;
    // Check for the beneficiary associated token account
    const psAccountMint = streamInfo.mint;
    const beneficiaryToken = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      psAccountMint,
      beneficiary,
      true,
    );

    const psAccount = streamInfo.psAccount;
    const ixs: TransactionInstruction[] = [];

    const { instruction: withdrawFromStreamInstruction } =
      await instructions.buildWithdrawFromStreamInstruction(
        this.program,
        {
          psAccount,
          psAccountMint,
          stream,
          beneficiary,
          beneficiaryToken,
          feePayer,
        },
        new BN(amount),
      );
    ixs.push(withdrawFromStreamInstruction);

    // unwrap all on exit
    if (autoWSol && psAccountMint.equals(NATIVE_WSOL_MINT)) {
      const closeWSolIx = Token.createCloseAccountInstruction(
        TOKEN_PROGRAM_ID,
        beneficiaryToken,
        beneficiary,
        beneficiary,
        [],
      );
      ixs.push(closeWSolIx);
    }

    const tx = await this.createTransaction(ixs, feePayer);
    return {
      transaction: tx,
    };
  }

  /**
   * Constructs a transaction to pause a stream
   *
   * @param stream - The stream to be paused
   * @param owner - The owner of the Payment Streaming account containing
   * the stream that will be paused
   * @param feePayer - Account paying rent and protocol SOL fees
   */
  public async buildPauseStreamTransaction(
    stream: PublicKey,
    owner: PublicKey,
    feePayer: PublicKey,
  ): Promise<{ transaction: Transaction }> {
    const streamInfo = (await this.getStream(stream)) as Stream;

    if (!streamInfo) {
      throw Error('Stream not found');
    }

    const psAccount = streamInfo.psAccount;
    const psAccountInfo = await this.getAccount(psAccount);

    if (!psAccountInfo) {
      throw Error('Payment Streaming account nof found');
    }

    const { instruction: pauseStreamInstruction } =
      await instructions.buildPauseStreamInstruction(this.program, {
        psAccount,
        owner,
        stream,
      });

    const tx = await this.createTransaction([pauseStreamInstruction], feePayer);
    return {
      transaction: tx,
    };
  }

  /**
   * Constructs a transaction to resume a stream
   *
   * @param stream - The stream to be resumed
   * @param owner - The owner of the Payment Streaming account containing
   * the stream that will be resume
   * @param feePayer - Account paying rent and protocol SOL fees
   */
  public async buildResumeStreamTransaction(
    stream: PublicKey,
    owner: PublicKey,
    feePayer: PublicKey,
  ): Promise<{ transaction: Transaction }> {
    const streamInfo = (await this.getStream(stream)) as Stream;

    if (!streamInfo) {
      throw Error('Stream not found');
    }

    const psAccount = streamInfo.psAccount;
    const psAccountInfo = await this.getAccount(psAccount);

    if (!psAccountInfo) {
      throw Error('Payment Streaming account not found');
    }

    const { instruction: resumeStreamInstruction } =
      await instructions.buildResumeStreamInstruction(this.program, {
        psAccount,
        owner,
        stream,
      });

    const tx = await this.createTransaction(
      [resumeStreamInstruction],
      feePayer,
    );
    return {
      transaction: tx,
    };
  }

  /**
   * Constructs a transaction to transfer a stream
   *
   * @param stream - The stream to be transferred
   * @param beneficiary - Current beneficiary of the stream
   * @param newBeneficiary - New beneficiary for the stream
   * @param feePayer - Account paying rent and protocol SOL fees
   */
  public async buildTransferStreamTransaction(
    stream: PublicKey,
    beneficiary: PublicKey,
    newBeneficiary: PublicKey,
    feePayer: PublicKey,
  ): Promise<{ transaction: Transaction }> {
    const streamInfo = (await this.getStream(stream)) as Stream;

    if (!streamInfo) {
      throw Error('Stream not found');
    }

    const beneficiaryAddress = streamInfo.beneficiary;

    if (!beneficiary.equals(beneficiaryAddress)) {
      throw Error('Unauthorized beneficiary');
    }

    const { instruction: transferStreamInstruction } =
      await instructions.buildTransferStreamInstruction(this.program, {
        stream,
        beneficiary,
        newBeneficiary,
      });

    const tx = await this.createTransaction(
      [transferStreamInstruction],
      feePayer,
    );
    return {
      transaction: tx,
    };
  }

  /**
   * Constructs a transaction to close a stream
   *
   * @param stream - The stream to be transferred
   * @param feePayer - Account paying rent and protocol SOL fees
   * @param destination - Account where the remaining funds will be deposited
   * @param autoWSol - Whether a wrap SOL instruction should be included in
   * the transaction if necessary
   * @param autoCloseAccount - If true, an instruction will be included in
   * the resulting transaction to close the containing PS account
   */
  public async buildCloseStreamTransaction(
    stream: PublicKey,
    feePayer: PublicKey,
    autoCloseAccount = false,
    destination?: PublicKey,
    autoWSol = false,
  ): Promise<{ transaction: Transaction }> {
    const streamInfo = (await this.getStream(stream)) as Stream;

    if (!streamInfo) {
      throw Error('Stream not found');
    }

    const psAccount = streamInfo.psAccount;
    const psAccountInfo = await getAccount(this.program, psAccount);

    if (!psAccountInfo) {
      throw Error('Payment Streaming account not found');
    }

    if (!streamInfo.mint.equals(psAccountInfo.mint)) {
      throw Error('Invalid stream mint');
    }

    const owner = streamInfo.psAccountOwner;
    const beneficiary = streamInfo.beneficiary;
    const psAccountMint = streamInfo.mint;
    const ixs: TransactionInstruction[] = [];

    const { instruction: closeStreamInstruction } =
      await instructions.buildCloseStreamInstruction(this.program, {
        psAccount,
        psAccountMint,
        owner,
        stream,
        beneficiary,
        feePayer,
      });
    ixs.push(closeStreamInstruction);

    if (autoCloseAccount && destination) {
      const { instruction: closeAccountInstruction, destinationToken } =
        await instructions.buildCloseFromAccountInstruction(this.program, {
          psAccount,
          psAccountMint,
          owner,
          feePayer,
          destination,
        });
      ixs.push(closeAccountInstruction);

      // unwrap all on exit and only if destination is also a signer
      if (
        autoWSol &&
        psAccountMint.equals(NATIVE_WSOL_MINT) &&
        destination.equals(owner)
      ) {
        const closeWSolIx = Token.createCloseAccountInstruction(
          TOKEN_PROGRAM_ID,
          destinationToken,
          destination,
          destination,
          [],
        );
        ixs.push(closeWSolIx);
      }
    }

    const tx = await this.createTransaction(ixs, feePayer);
    return {
      transaction: tx,
    };
  }

  //#region UTILS

  private async ensureAutoWrapSolInstructions(
    autoWSol: boolean,
    amountInLamports: number | string | BN,
    owner: PublicKey,
    ownerWSolTokenAccount: PublicKey,
    ownerWSolTokenAccountInfo: AccountInfo<Buffer> | null,
    instructions: TransactionInstruction[],
    signers: Signer[],
  ) {
    if (autoWSol) {
      const [wrapSolIxs, wrapSolSigners] = await createWrapSolInstructions(
        this.connection,
        amountInLamports,
        owner,
        ownerWSolTokenAccount,
        ownerWSolTokenAccountInfo,
      );
      if (wrapSolIxs && wrapSolIxs.length > 0) {
        instructions.push(...wrapSolIxs);
        if (wrapSolSigners && wrapSolSigners.length > 0)
          signers.push(...wrapSolSigners);
      }
    } else {
      if (!ownerWSolTokenAccountInfo) {
        throw Error('Sender token account not found');
      }
    }
  }

  /**
   * Validates the given address
   * @param address Solana public address
   * @returns one of the WARNING_TYPES as result
   */
  public async checkAddressForWarnings(
    address: string,
  ): Promise<WARNING_TYPES> {
    let pkAddress: PublicKey;
    //check the address validity
    try {
      pkAddress = new PublicKey(address);
    } catch (error) {
      console.warn(`Invalid Solana address: ${address}`);
      return WARNING_TYPES.INVALID_ADDRESS;
    }

    //check address PDA
    const isAddressOnCurve = PublicKey.isOnCurve(pkAddress);
    if (isAddressOnCurve) {
      return WARNING_TYPES.WARNING;
    }

    //check address exists and owned by system program
    try {
      const accountInfo = await this.connection.getAccountInfo(pkAddress);
      if (!accountInfo || !accountInfo.owner.equals(SystemProgram.programId)) {
        return WARNING_TYPES.WARNING;
      }
    } catch (error) {
      return WARNING_TYPES.WARNING;
    }

    return WARNING_TYPES.NO_WARNING;
  }

  //#endregion
}
