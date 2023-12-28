import {
  AccountInfo,
  ConfirmedSignaturesForAddress2Options,
  ConfirmOptions,
  Connection,
  Finality,
  GetProgramAccountsFilter,
  Keypair,
  LAMPORTS_PER_SOL,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  MemcmpFilter,
} from '@solana/web3.js';
import {
  BN,
  BorshInstructionCoder,
  Idl,
  IdlAccounts,
  Program,
  ProgramAccount,
} from '@project-serum/anchor';
import {
  CLIFF_PERCENT_DENOMINATOR,
  CLIFF_PERCENT_NUMERATOR,
  LATEST_IDL_FILE_VERSION,
  SIMULATION_PUBKEY,
} from './constants';
import {
  Category,
  ACTION_CODES,
  PaymentStreamingAccount,
  AccountType,
  Stream,
  StreamActivity,
  StreamEventData,
  StreamTemplate,
  SubCategory,
  TransactionFees,
  AccountActivity,
  ActivityRaw,
  ActivityActionCode,
  STREAM_STATUS_CODE,
} from './types';
import { IDL, Msp as Ps } from './msp_idl_005'; // point to the latest IDL
// Given an IDL type IDL we can derive Typescript types for its accounts
// using eg. IdlAccounts<IDL>['ACCOUNT_NAME']
type RawStream = IdlAccounts<Ps>['stream'];
type RawTreasury = IdlAccounts<Ps>['treasury'];
type RawStreamTemplate = IdlAccounts<Ps>['streamTemplate'];
// Events are not possible yet.
// See https://github.com/coral-xyz/anchor/issues/2050
// See https://github.com/coral-xyz/anchor/pull/2185
// type RawStreamEvent = IdlEvent<Msp>[];
import { bs58 } from '@project-serum/anchor/dist/cjs/utils/bytes';
import {
  AnchorProvider,
  Wallet,
} from '@project-serum/anchor/dist/cjs/provider';
import {
  AccountLayout,
  getMinimumBalanceForRentExemptAccount,
  createInitializeAccountInstruction,
  createTransferInstruction,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createCloseAccountInstruction,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import * as anchor from '@project-serum/anchor';
import BigNumber from 'bignumber.js';

String.prototype.toPublicKey = function (): PublicKey {
  return new PublicKey(this.toString());
};

export const createProgram = (
  connection: Connection,
  programId: string | PublicKey,
): Program<Ps> => {
  // we are not confirming transactions here
  const opts: ConfirmOptions = {
    preflightCommitment: connection.commitment,
    commitment: connection.commitment,
  };

  // dummy wallet only to configure the provider, we are not doing any signing
  const wallet: Wallet = {
    publicKey: SIMULATION_PUBKEY,
    signAllTransactions: async txs => txs,
    signTransaction: async tx => tx,
  };

  const provider = new AnchorProvider(connection, wallet, opts);

  return new Program(IDL, programId, provider);
};

export const getStream = async (
  program: Program<Ps>,
  address: PublicKey,
): Promise<Stream | null> => {
  try {
    const event = await getStreamEventData(program, address);
    if (!event) return null;

    const streamInfo = parseStreamEventData(event, address);

    return streamInfo;
  } catch (error: any) {
    console.log(error);
    return null;
  }
};

export async function getStreamEventData(
  program: Program<Ps>,
  address: PublicKey,
): Promise<StreamEventData | null> {
  try {
    const streamEventResponse = await program.simulate.getStream(
      LATEST_IDL_FILE_VERSION,
      {
        accounts: {
          stream: address,
        },
      },
    );

    if (
      !streamEventResponse ||
      !streamEventResponse.events ||
      !streamEventResponse.events.length ||
      !streamEventResponse.events[0].data
    ) {
      return null;
    }

    const event: StreamEventData = streamEventResponse.events[0].data;

    return event;
  } catch (error: any) {
    return null;
  }
}

export const getStreamCached = async (streamInfo: Stream): Promise<Stream> => {
  const timeDiff =
    streamInfo.lastRetrievedTimeInSeconds - streamInfo.lastRetrievedBlockTime;
  const blocktime = parseInt((Date.now() / 1_000).toString()) - timeDiff;

  const parsedStream = parseRawStreamAccount(
    streamInfo.data,
    streamInfo.id,
    blocktime,
  );

  parsedStream.createdBlockTime = streamInfo.createdBlockTime;

  return parsedStream;
};

export const listStreams = async (
  program: Program<Ps>,
  psAccountOwner?: PublicKey | undefined,
  psAccount?: PublicKey | undefined,
  beneficiary?: PublicKey | undefined,
  category?: Category,
  subCategory?: SubCategory,
): Promise<Stream[]> => {
  const streamInfoList: Stream[] = [];
  const accounts = await getFilteredStreamAccounts(
    program,
    psAccountOwner,
    psAccount,
    beneficiary,
    category,
    subCategory,
  );
  const slot = await program.provider.connection.getSlot();
  const blockTime = (await program.provider.connection.getBlockTime(
    slot,
  )) as number;

  for (const item of accounts) {
    if (item.account !== undefined) {
      const parsedStream = parseRawStreamAccount(
        item.account,
        item.publicKey,
        blockTime,
      );

      streamInfoList.push(parsedStream);
    }
  }

  streamInfoList.sort((a, b) => {
    if (a.createdBlockTime !== b.createdBlockTime) {
      return b.createdBlockTime - a.createdBlockTime;
    }
    return a.name !== b.name
      ? a.name.localeCompare(b.name)
      : a.id.toBase58().localeCompare(b.id.toBase58());
  });

  return streamInfoList;
};

export const listStreamsCached = async (
  streamInfoList: Stream[],
): Promise<Stream[]> => {
  const streamList: Stream[] = [];
  for (const streamInfo of streamInfoList) {
    const timeDiff =
      streamInfo.lastRetrievedTimeInSeconds - streamInfo.lastRetrievedBlockTime;
    const blockTime = parseInt((Date.now() / 1_000).toString()) - timeDiff;

    const parsedStream = parseRawStreamAccount(
      streamInfo.data,
      streamInfo.id,
      blockTime,
    );

    parsedStream.createdBlockTime = streamInfo.createdBlockTime;
    streamList.push(parsedStream);
  }

  return streamList;
};

export const listStreamActivity = async (
  program: Program<Ps>,
  address: PublicKey,
  before = '',
  limit = 10,
  commitment?: Finality | undefined,
): Promise<StreamActivity[]> => {
  let activityRaw: ActivityRaw[] = [];
  const finality = commitment !== undefined ? commitment : 'confirmed';
  const filter = { limit: limit } as ConfirmedSignaturesForAddress2Options;
  if (before) {
    filter['before'] = before;
  }
  const signatures =
    await program.provider.connection.getConfirmedSignaturesForAddress2(
      address,
      filter,
      finality,
    );
  const txs = await program.provider.connection.getParsedTransactions(
    signatures.map(s => s.signature),
    finality,
  );

  if (txs && txs.length) {
    activityRaw = await parseProgramTransactions(
      txs as ParsedTransactionWithMeta[],
      program.programId,
      undefined,
      address,
    );

    activityRaw.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));
  }

  // this mapping is kept here for backwards compatibility
  const activity = activityRaw.map(i => {
    let actionText = '';
    switch (i.action) {
      case ActivityActionCode.StreamCreated:
        actionText = i.amount?.gt(new BN(0)) ? 'deposited' : 'stream created';
        break;
      case ActivityActionCode.FundsAllocatedToStream:
        actionText = 'deposited';
        break;
      default:
        actionText = 'withdrew';
        break;
    }

    return {
      signature: i.signature,
      initializer: i.initializer?.toBase58(),
      action: actionText,
      actionCode: i.action,
      amount: i.amount ? i.amount.toString() : '',
      mint: i.mint?.toBase58(),
      blockTime: i.blockTime,
      utcDate: i.utcDate,
    } as StreamActivity;
  });

  return activity;
};

export const getAccount = async (
  program: Program<Ps>,
  address: PublicKey,
): Promise<PaymentStreamingAccount> => {
  const psAccount = await program.account.treasury.fetch(address);
  const parsedAccount = parseAccountData(psAccount, address);

  return parsedAccount;
};

export const getStreamTemplate = async (
  program: Program<Ps>,
  address: PublicKey,
): Promise<StreamTemplate> => {
  const template = await program.account.streamTemplate.fetch(address);
  return parseStreamTemplateData(template, address);
};

export const findStreamTemplateAddress = async (
  psAccount: PublicKey,
  programId: PublicKey,
): Promise<[PublicKey, number]> => {
  return anchor.web3.PublicKey.findProgramAddress(
    [anchor.utils.bytes.utf8.encode('template'), psAccount.toBuffer()],
    programId,
  );
};

export const listAccounts = async (
  program: Program<Ps>,
  owner?: PublicKey | undefined,
  excludeAutoClose?: boolean,
  category?: Category,
  subCategory?: SubCategory,
): Promise<PaymentStreamingAccount[]> => {
  const psAccounts: PaymentStreamingAccount[] = [];
  const memcmpFilters: GetProgramAccountsFilter[] = [];

  if (owner) {
    memcmpFilters.push({
      memcmp: { offset: 8 + 43, bytes: owner.toBase58() },
    });
  }

  if (excludeAutoClose) {
    memcmpFilters.push({
      memcmp: { offset: 216, bytes: bs58.encode([0]) },
    });
  }

  if (category !== undefined) {
    memcmpFilters.push({
      memcmp: { offset: 218, bytes: bs58.encode([category]) },
    });
  }

  if (subCategory !== undefined) {
    memcmpFilters.push({
      memcmp: { offset: 219, bytes: bs58.encode([subCategory]) },
    });
  }

  const accounts = await program.account.treasury.all(memcmpFilters);

  if (accounts.length) {
    for (const item of accounts) {
      if (item.account !== undefined) {
        const parsedAccount = parseAccountData(item.account, item.publicKey);
        const info = Object.assign({}, parsedAccount);

        if ((owner && owner.equals(info.owner)) || !owner) {
          psAccounts.push(info);
        }
      }
    }
  }

  const sortedAccounts = psAccounts.sort((a, b) => b.slot - a.slot);

  return sortedAccounts;
};

export const calculateFeesForAction = async (
  action: ACTION_CODES,
): Promise<TransactionFees> => {
  const txFees: TransactionFees = {
    blockchainFee: 0.0,
    mspFlatFee: 0.0,
    mspPercentFee: 0.0,
  };

  let blockchainFee = 0;

  switch (action) {
    case ACTION_CODES.CreateAccount:
    case ACTION_CODES.CreateStream: {
      blockchainFee = 15000000;
      txFees.mspFlatFee = 0.00001;
      break;
    }
    case ACTION_CODES.CreateStreamWithFunds: {
      blockchainFee = 20000000;
      txFees.mspFlatFee = 0.000035;
      break;
    }
    case ACTION_CODES.ScheduleOneTimePayment: {
      blockchainFee = 15000000;
      txFees.mspFlatFee = 0.000035;
      break;
    }
    case ACTION_CODES.AddFundsToAccount: {
      txFees.mspFlatFee = 0.000025;
      break;
    }
    case ACTION_CODES.WithdrawFromStream: {
      blockchainFee = 5000000;
      txFees.mspPercentFee = 0.25;
      break;
    }
    case ACTION_CODES.CloseStream: {
      txFees.mspFlatFee = 0.00001;
      txFees.mspPercentFee = 0.25;
      break;
    }
    case ACTION_CODES.CloseAccount: {
      txFees.mspFlatFee = 0.00001;
      break;
    }
    case ACTION_CODES.TransferStream: {
      blockchainFee = 5000;
      txFees.mspFlatFee = 0.00001;
      break;
    }
    case ACTION_CODES.WithdrawFromAccount: {
      txFees.mspPercentFee = 0.25;
      break;
    }
    default: {
      break;
    }
  }

  txFees.blockchainFee = blockchainFee / LAMPORTS_PER_SOL;

  return txFees;
};

export const calculateAllocationAmount = async (
  connection: Connection,
  psAccount: PaymentStreamingAccount,
  allocation: string | number,
) => {
  const fees = await calculateFeesForAction(ACTION_CODES.WithdrawFromStream);
  //
  const BASE_100_TO_BASE_1_MULTIPLIER = CLIFF_PERCENT_NUMERATOR;
  const feeNumerator = fees.mspPercentFee * BASE_100_TO_BASE_1_MULTIPLIER;
  const feeDenaminator = CLIFF_PERCENT_DENOMINATOR;
  const unallocatedBalance = new BN(psAccount.balance).sub(
    new BN(psAccount.allocationAssigned),
  );
  const allocationAmountBn = new BN(allocation).add(unallocatedBalance);
  const badStreamAllocationAmount = allocationAmountBn
    .mul(new BN(feeDenaminator))
    .div(new BN(feeNumerator + feeDenaminator));

  const feeAmount = badStreamAllocationAmount
    .mul(new BN(feeNumerator))
    .div(new BN(feeDenaminator));

  if (unallocatedBalance.gte(feeAmount)) {
    return badStreamAllocationAmount;
  }

  const goodStreamMaxAllocation = allocationAmountBn.sub(feeAmount);

  return goodStreamMaxAllocation;
};

export const getFilteredStreamAccounts = async (
  program: Program<Ps>,
  psAccountOwner?: PublicKey | undefined,
  psAccount?: PublicKey | undefined,
  beneficiary?: PublicKey | undefined,
  category?: Category,
  subCategory?: SubCategory,
) => {
  const accounts: ProgramAccount<RawStream>[] = [];

  // category filters
  const categoryFilters: MemcmpFilter[] = [];

  if (category !== undefined) {
    categoryFilters.push({
      memcmp: { offset: 339, bytes: bs58.encode([category]) },
    });
  }

  if (subCategory !== undefined) {
    categoryFilters.push({
      memcmp: { offset: 340, bytes: bs58.encode([subCategory]) },
    });
  }

  if (psAccount) {
    const memcmpFilters: MemcmpFilter[] = [
      { memcmp: { offset: 8 + 170, bytes: psAccount.toBase58() } },
      ...categoryFilters,
    ];
    const accs = await program.account.stream.all(memcmpFilters);

    if (accs.length) {
      accounts.push(...accs);
    }
  } else {
    if (psAccountOwner) {
      const memcmpFilters: MemcmpFilter[] = [
        { memcmp: { offset: 8 + 34, bytes: psAccountOwner.toBase58() } },
        ...categoryFilters,
      ];
      const accs = await program.account.stream.all(memcmpFilters);

      if (accs.length) {
        for (const acc of accs) {
          if (accounts.indexOf(acc) === -1) {
            accounts.push(acc);
          }
        }
      }
    }

    if (beneficiary) {
      const memcmpFilters: MemcmpFilter[] = [
        { memcmp: { offset: 8 + 106, bytes: beneficiary.toBase58() } },
        ...categoryFilters,
      ];
      const accs = await program.account.stream.all(memcmpFilters);

      if (accs.length) {
        for (const acc of accs) {
          if (accounts.indexOf(acc) === -1) {
            accounts.push(acc);
          }
        }
      }
    }
  }

  return accounts;
};

/**
 * Parses the event returned by the get_stream getter in the mps program.
 * @param event
 * @param address stream address
 * @returns Stream
 */
const parseStreamEventData = (event: StreamEventData, address: PublicKey) => {
  const nameBuffer = Buffer.from(event.name);
  const createdOnUtcInSeconds = event.createdOnUtc
    ? event.createdOnUtc.toNumber()
    : 0;

  const effectiveCreatedOnUtcInSeconds =
    createdOnUtcInSeconds > 0
      ? createdOnUtcInSeconds
      : event.startUtc.toNumber();

  const rawStream = {
    version: event.version,
    initialized: event.initialized,
    name: [].slice.call(anchor.utils.bytes.utf8.encode(event.name)),
    treasurerAddress: event.treasurerAddress,
    rateAmountUnits: event.rateAmountUnits,
    rateIntervalInSeconds: event.rateIntervalInSeconds,
    startUtc: event.startUtc,
    cliffVestAmountUnits: event.cliffVestAmountUnits,
    cliffVestPercent: event.cliffVestPercent,
    beneficiaryAddress: event.beneficiaryAddress,
    beneficiaryAssociatedToken: event.beneficiaryAssociatedToken,
    treasuryAddress: event.treasuryAddress,
    allocationAssignedUnits: event.allocationAssignedUnits,
    allocationReservedUnits: event.allocationReservedUnits,
    totalWithdrawalsUnits: event.totalWithdrawalsUnits,
    lastWithdrawalUnits: event.lastWithdrawalUnits,
    lastWithdrawalSlot: event.lastWithdrawalSlot,
    lastWithdrawalBlockTime: event.lastWithdrawalBlockTime,
    lastManualStopWithdrawableUnitsSnap:
      event.lastManualStopWithdrawableUnitsSnap,
    lastManualStopSlot: event.lastManualStopSlot,
    lastManualStopBlockTime: event.lastManualStopBlockTime,
    lastManualResumeRemainingAllocationUnitsSnap:
      event.lastManualResumeRemainingAllocationUnitsSnap,
    lastManualResumeSlot: event.lastManualResumeSlot,
    lastManualResumeBlockTime: event.lastManualResumeBlockTime,
    lastKnownTotalSecondsInPausedStatus:
      event.lastKnownTotalSecondsInPausedStatus,
    lastAutoStopBlockTime: event.lastAutoStopBlockTime,
    feePayedByTreasurer: event.feePayedByTreasurer,
    // startUtc is guaranteed to be in seconds for the getStream event
    startUtcInSeconds: event.startUtc,
    createdOnUtc: event.createdOnUtc,
    category: event.category,
    subCategory: event.subCategory,
  } as RawStream;

  let statusCode = STREAM_STATUS_CODE.Unknown;
  switch (event.status) {
    case 'Scheduled':
      statusCode = STREAM_STATUS_CODE.Scheduled;
      break;
    case 'Running':
      statusCode = STREAM_STATUS_CODE.Running;
      break;
    case 'Paused':
      statusCode = STREAM_STATUS_CODE.Paused;
      break;
    default: {
      break;
    }
  }

  const stream = {
    id: address,
    version: event.version,
    initialized: event.initialized,
    name: new TextDecoder().decode(nameBuffer).trim(),
    startUtc: new Date(event.startUtc.toNumber() * 1000).toString(), // event.startUtc is guaranteed to be in seconds
    treasurer: event.treasurerAddress,
    psAccountOwner: event.treasurerAddress,
    treasury: event.treasuryAddress,
    psAccount: event.treasuryAddress,
    beneficiary: event.beneficiaryAddress,
    mint: event.beneficiaryAssociatedToken,
    cliffVestAmount: event.cliffVestAmountUnits,
    cliffVestPercent:
      event.cliffVestPercent.toNumber() / CLIFF_PERCENT_NUMERATOR,
    allocationAssigned: event.allocationAssignedUnits,
    secondsSinceStart: event.currentBlockTime
      .sub(new BN(event.startUtc))
      .toNumber(),
    estimatedDepletionDate: new Date(
      event.estDepletionTime.toNumber() * 1000,
    ).toString(),
    rateAmount: event.rateAmountUnits,
    rateIntervalInSeconds: event.rateIntervalInSeconds.toNumber(),
    totalWithdrawalsAmount: event.totalWithdrawalsUnits,
    fundsLeftInStream: event.fundsLeftInStream,
    fundsSentToBeneficiary: event.fundsSentToBeneficiary,
    remainingAllocationAmount: event.beneficiaryRemainingAllocation,
    withdrawableAmount: event.beneficiaryWithdrawableAmount,
    streamUnitsPerSecond: getStreamUnitsPerSecond(
      rawStream.rateAmountUnits,
      rawStream.rateIntervalInSeconds,
    ),
    isManuallyPaused: event.isManualPause,
    status: event.status,
    statusCode: statusCode,
    statusName: event.status,
    lastRetrievedBlockTime: event.currentBlockTime.toNumber(),
    lastRetrievedTimeInSeconds: parseInt((Date.now() / 1_000).toString()),
    feePayedByTreasurer: event.feePayedByTreasurer,
    tokenFeePayedFromAccount: event.feePayedByTreasurer,
    createdBlockTime: effectiveCreatedOnUtcInSeconds,
    createdOnUtc: new Date(effectiveCreatedOnUtcInSeconds * 1000).toString(),
    category: event.category as Category,
    subCategory: event.subCategory as SubCategory,
    upgradeRequired: false,
    data: rawStream,
  } as Stream;

  return stream;
};

/**
 * Parses program account items
 * @param rawStream
 * @param address
 * @param blockTime
 * @returns Stream
 */
export const parseRawStreamAccount = (
  rawStream: RawStream,
  address: PublicKey,
  blockTime: number,
) => {
  const nameBuffer = Buffer.from(rawStream.name);
  const createdOnUtcInSeconds = rawStream.createdOnUtc
    ? rawStream.createdOnUtc.toNumber()
    : 0;

  const startUtcInSeconds = getStreamStartUtcInSeconds(rawStream);
  const effectiveCreatedOnUtcInSeconds =
    createdOnUtcInSeconds > 0 ? createdOnUtcInSeconds : startUtcInSeconds;

  const timeDiff = Math.round(Date.now() / 1000 - blockTime);

  const startUtc = new Date(startUtcInSeconds * 1000);
  const depletionDate = getStreamEstDepletionDate(rawStream);
  const streamStatus = getStreamStatusCode(rawStream, timeDiff);
  const streamWithdrawableAmount = getStreamWithdrawableAmount(
    rawStream,
    timeDiff,
  );

  const parsedStream = {
    id: address,
    version: rawStream.version,
    initialized: rawStream.initialized,
    name: new TextDecoder().decode(nameBuffer).trim(),
    startUtc: startUtc.toString(),
    psAccountOwner: rawStream.treasurerAddress,
    psAccount: rawStream.treasuryAddress,
    beneficiary: rawStream.beneficiaryAddress,
    mint: rawStream.beneficiaryAssociatedToken,
    cliffVestAmount: rawStream.cliffVestAmountUnits,
    cliffVestPercent:
      rawStream.cliffVestPercent.toNumber() / CLIFF_PERCENT_NUMERATOR,
    allocationAssigned: rawStream.allocationAssignedUnits,
    secondsSinceStart: blockTime - startUtcInSeconds,
    estimatedDepletionDate: depletionDate.toString(),
    rateAmount: rawStream.rateAmountUnits,
    rateIntervalInSeconds: rawStream.rateIntervalInSeconds.toNumber(),
    totalWithdrawalsAmount: rawStream.totalWithdrawalsUnits,
    fundsLeftInStream: getFundsLeftInStream(rawStream, timeDiff),
    fundsSentToBeneficiary: getFundsSentToBeneficiary(rawStream, timeDiff),
    remainingAllocationAmount: getStreamRemainingAllocation(rawStream),
    withdrawableAmount: streamWithdrawableAmount,
    streamUnitsPerSecond: getStreamUnitsPerSecond(
      rawStream.rateAmountUnits,
      rawStream.rateIntervalInSeconds,
    ),
    isManuallyPaused: isStreamManuallyPaused(rawStream),
    statusCode: streamStatus,
    statusName: STREAM_STATUS_CODE[streamStatus],
    lastRetrievedBlockTime: blockTime,
    lastRetrievedTimeInSeconds: parseInt((Date.now() / 1_000).toString()),
    feePayedByTreasurer: rawStream.feePayedByTreasurer,
    tokenFeePayedFromAccount: rawStream.feePayedByTreasurer,
    category: rawStream.category as Category,
    subCategory: rawStream.subCategory as SubCategory,
    transactionSignature: '',
    createdBlockTime:
      createdOnUtcInSeconds > 0 ? createdOnUtcInSeconds : startUtcInSeconds,
    createdOnUtc: new Date(effectiveCreatedOnUtcInSeconds * 1000).toString(),
    upgradeRequired: false,
    data: rawStream,
  } as Stream;

  return parsedStream;
};

const idls: { [fileVersion: number]: any } = {};

export async function parseProgramTransactions(
  transactions: ParsedTransactionWithMeta[],
  programId: PublicKey,
  psAccountAddress?: PublicKey,
  streamAddress?: PublicKey,
): Promise<ActivityRaw[]> {
  const parsedActivities: ActivityRaw[] = [];
  if (!transactions || transactions.length === 0) return [];

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const signature = tx.transaction.signatures[0];
    for (let j = 0; j < tx.transaction.message.instructions.length; j++) {
      const ix = tx.transaction.message.instructions[
        j
      ] as PartiallyDecodedInstruction;
      if (!ix || !ix.data) continue;

      const decodedIxData = bs58.decode(ix.data);
      const ixIdlFileVersion =
        decodedIxData.length >= 9 ? decodedIxData.subarray(8, 9)[0] : 0;
      let activity: ActivityRaw | null = null;
      if (ixIdlFileVersion > 0 && ixIdlFileVersion <= LATEST_IDL_FILE_VERSION) {
        activity = await parseProgramInstruction(
          ix,
          signature,
          tx.blockTime ?? 0,
          ixIdlFileVersion,
          programId,
          psAccountAddress,
          streamAddress,
        );
      }

      if (!activity) {
        continue;
      }
      parsedActivities.push(activity);
    }
  }

  return parsedActivities;
}

export const parseAccountData = (
  rawAccount: RawTreasury,
  accountAddress: PublicKey,
) => {
  const nameBuffer = Buffer.from(rawAccount.name);
  const psAccountCreatedUtc =
    rawAccount.createdOnUtc.toString().length > 10
      ? parseInt(rawAccount.createdOnUtc.toString().substring(0, 10))
      : rawAccount.createdOnUtc.toNumber();

  return {
    id: accountAddress,
    version: rawAccount.version,
    initialized: rawAccount.initialized,
    name: new TextDecoder().decode(nameBuffer).trim(),
    bump: rawAccount.bump,
    slot: rawAccount.slot.toNumber(),
    autoClose: rawAccount.autoClose,
    createdOnUtc: new Date(psAccountCreatedUtc * 1_000),
    accountType:
      rawAccount.treasuryType === 0 ? AccountType.Open : AccountType.Lock,
    owner: rawAccount.treasurerAddress,
    mint: rawAccount.associatedTokenAddress,
    balance: rawAccount.lastKnownBalanceUnits,
    allocationAssigned: rawAccount.allocationAssignedUnits,
    totalWithdrawals: rawAccount.totalWithdrawalsUnits,
    totalStreams: rawAccount.totalStreams.toNumber(),
    category: rawAccount.category as Category,
    subCategory: rawAccount.subCategory as SubCategory,
    data: rawAccount,
  } as PaymentStreamingAccount;
};

export const parseStreamTemplateData = (
  template: RawStreamTemplate,
  address: PublicKey,
) => {
  return {
    id: address,
    version: template.version,
    bump: template.bump,
    durationNumberOfUnits: template.durationNumberOfUnits.toNumber(),
    rateIntervalInSeconds: template.rateIntervalInSeconds.toNumber(),
    startUtc: new Date(template.startUtcInSeconds.toNumber() * 1000).toString(),
    cliffVestPercent: template.cliffVestPercent.toNumber(),
    feePayedByTreasurer: template.feePayedByTreasurer,
  } as StreamTemplate;
};

export const getStreamEstDepletionDate = (stream: RawStream) => {
  if (stream.rateIntervalInSeconds.isZero()) {
    return new Date();
  }

  const cliffUnits = getStreamCliffAmount(stream);
  const streamableUnits = stream.allocationAssignedUnits.sub(cliffUnits);

  const streamingSeconds = streamableUnits
    .mul(stream.rateIntervalInSeconds)
    .div(stream.rateAmountUnits);

  const durationSpanSeconds = streamingSeconds.add(
    stream.lastKnownTotalSecondsInPausedStatus,
  );
  const startUtcInSeconds = getStreamStartUtcInSeconds(stream);

  const depletionTimestamp =
    (startUtcInSeconds + durationSpanSeconds.toNumber()) * 1_000;
  const depletionDate = new Date(depletionTimestamp);
  if (depletionDate.toString() !== 'Invalid Date') {
    return depletionDate;
  }
  return new Date();
};

export const getStreamCliffAmount = (stream: RawStream) => {
  // Previously, cliff could be provided either as percentage or amount.
  // Currently, cliff percent is not stored in the stream, when a stream is
  // created with a cliff percent, it is converted to an absolute amount and
  // stored in stream.cliffVestAmountUnits. Legacy stream might still use
  // the percent flavor so we take care of those cases here

  if (stream.cliffVestPercent.gtn(0)) {
    return stream.cliffVestPercent
      .mul(stream.allocationAssignedUnits)
      .div(new BN(CLIFF_PERCENT_DENOMINATOR));
  }

  return stream.cliffVestAmountUnits;
};

export const getFundsLeftInStream = (stream: RawStream, timeDiff = 0) => {
  const withdrawableAmount = getStreamWithdrawableAmount(stream, timeDiff);
  const remainingAllocation = getStreamRemainingAllocation(stream);
  const fundsLeft = remainingAllocation.sub(withdrawableAmount);

  return BN.max(new BN(0), fundsLeft);
};

export const getFundsSentToBeneficiary = (stream: RawStream, timeDiff = 0) => {
  const withdrawableAmount = getStreamWithdrawableAmount(stream, timeDiff);
  const fundsSent = stream.totalWithdrawalsUnits.add(withdrawableAmount);
  return fundsSent as BN;
};

export const getStreamRemainingAllocation = (stream: RawStream) => {
  const remainingAlloc = stream.allocationAssignedUnits.sub(
    stream.totalWithdrawalsUnits,
  );
  return BN.max(new BN(0), remainingAlloc);
};

export const getStreamWithdrawableAmount = (
  stream: RawStream,
  timeDiff = 0,
) => {
  const remainingAllocation = getStreamRemainingAllocation(stream);

  if (remainingAllocation.isZero()) {
    return new BN(0);
  }

  const status = getStreamStatusCode(stream, timeDiff);

  // Check if SCHEDULED
  if (status === STREAM_STATUS_CODE.Scheduled) {
    return new BN(0);
  }

  // Check if PAUSED
  if (status === STREAM_STATUS_CODE.Paused) {
    const manuallyPaused = isStreamManuallyPaused(stream);
    const withdrawableWhilePausedAmount = manuallyPaused
      ? stream.lastManualStopWithdrawableUnitsSnap
      : remainingAllocation;

    return BN.max(new BN(0), withdrawableWhilePausedAmount);
  }

  // Check if NOT RUNNING
  if (
    stream.rateAmountUnits.isZero() ||
    stream.rateIntervalInSeconds.isZero()
  ) {
    return new BN(0);
  }

  const cliffUnits = getStreamCliffAmount(stream);
  // Get the blockchain kind of "now" given the client timeDiff
  const blocktimeRelativeNow = Math.round(Date.now() / 1_000 - timeDiff);
  const startUtcInSeconds = getStreamStartUtcInSeconds(stream);
  const secondsSinceStart = new BN(blocktimeRelativeNow - startUtcInSeconds);
  const actualStreamedSeconds = secondsSinceStart.sub(
    stream.lastKnownTotalSecondsInPausedStatus,
  );
  const actualStreamedUnits = getStreamedUnits(stream, actualStreamedSeconds);
  let actualEarnedUnits = cliffUnits.add(actualStreamedUnits);

  actualEarnedUnits = BN.max(actualEarnedUnits, stream.totalWithdrawalsUnits);
  const withdrawableUnitsWhileRunning = actualEarnedUnits.sub(
    stream.totalWithdrawalsUnits,
  );
  const withdrawable = BN.min(
    remainingAllocation,
    withdrawableUnitsWhileRunning,
  );

  return withdrawable;
};

/**
 * Mimics msp program -> `stream.get_status()`
 * @param stream Raw stream as defined in IDL
 * @param timeDiff
 */
export const getStreamStatusCode = (
  stream: RawStream,
  timeDiff: number,
): STREAM_STATUS_CODE => {
  // Get the blockchain kind of "now" given the client timeDiff
  const blocktimeRelativeNow = Date.now() / 1_000 - timeDiff;
  const startUtcInSeconds = getStreamStartUtcInSeconds(stream);

  // Scheduled
  if (startUtcInSeconds > blocktimeRelativeNow) {
    return STREAM_STATUS_CODE.Scheduled;
  }

  // Manually paused
  const manuallyPaused = isStreamManuallyPaused(stream);
  if (manuallyPaused) {
    return STREAM_STATUS_CODE.Paused;
  }

  // Running or automatically paused (ran out of funds)
  const cliffUnits = getStreamCliffAmount(stream);
  const secondsSinceStart = new BN(blocktimeRelativeNow - startUtcInSeconds);

  const actualStreamedSeconds = secondsSinceStart.sub(
    stream.lastKnownTotalSecondsInPausedStatus,
  );
  const actualStreamedUnits = getStreamedUnits(stream, actualStreamedSeconds);
  const actualEarnedUnits = cliffUnits.add(actualStreamedUnits);

  if (stream.allocationAssignedUnits.gt(actualEarnedUnits)) {
    return STREAM_STATUS_CODE.Running;
  }

  // Automatically paused (ran out of funds)
  return STREAM_STATUS_CODE.Paused;
};

export const isStreamManuallyPaused = (stream: RawStream) => {
  return (
    stream.lastManualStopBlockTime.gtn(0) &&
    stream.lastManualStopBlockTime.gt(stream.lastManualResumeBlockTime)
  );
};

export const getStreamUnitsPerSecond = (
  rateAmountUnits: number | string | BN,
  rateIntervalInSeconds: number | string | BN,
) => {
  rateIntervalInSeconds = new BN(rateIntervalInSeconds);

  if (rateIntervalInSeconds.isZero()) {
    return 0;
  }

  rateAmountUnits = new BN(rateAmountUnits);
  const streamUnitsPerSecond = new BigNumber(
    rateAmountUnits.toString(),
  ).dividedBy(rateIntervalInSeconds.toString());

  return streamUnitsPerSecond.toNumber();
};

export const getStreamStartUtcInSeconds = (stream: RawStream): number => {
  if (stream.startUtcInSeconds.gt(new BN(0))) {
    return stream.startUtcInSeconds.toNumber();
  }
  // Some legacy streams were created with startUtc in miliseconds instead
  // of seconds. In those cases we need to conver to seconds.
  if (stream.startUtc.toString().length > 10) {
    return stream.startUtc.div(new BN(1000)).toNumber();
  }
  return stream.startUtc.toNumber();
};

export const getStreamWithdrawableUnitsWhilePaused = (stream: RawStream) => {
  let withdrawableWhilePaused = new BN(0);
  const isManuallyPaused = isStreamManuallyPaused(stream);

  if (isManuallyPaused) {
    withdrawableWhilePaused = stream.lastManualStopWithdrawableUnitsSnap;
  } else {
    withdrawableWhilePaused = stream.allocationAssignedUnits.sub(
      stream.totalWithdrawalsUnits,
    );
  }

  return BN.max(new BN(0), withdrawableWhilePaused);
};

export const getStreamedUnits = (rawStream: RawStream, seconds: BN): BN => {
  if (rawStream.rateIntervalInSeconds.isZero()) return new BN(0);

  const cliffUnits = getStreamCliffAmount(rawStream);
  const streamableUnits = rawStream.allocationAssignedUnits.sub(cliffUnits);
  const streamingSeconds = streamableUnits
    .mul(rawStream.rateIntervalInSeconds)
    .div(rawStream.rateAmountUnits);

  if (seconds.gt(streamingSeconds)) return streamableUnits;

  const streamableUnitsInGivenSeconds = rawStream.rateAmountUnits
    .mul(seconds)
    .div(rawStream.rateIntervalInSeconds);

  return streamableUnitsInGivenSeconds;
};

export async function fundExistingWSolAccountInstructions(
  connection: Connection,
  owner: PublicKey,
  ownerWSolTokenAccount: PublicKey,
  payer: PublicKey,
  amountToWrapInLamports: number,
): Promise<[TransactionInstruction[], Keypair]> {
  // Allocate memory for the account
  const minimumAccountBalance = await getMinimumBalanceForRentExemptAccount(
    connection,
  );
  const newWrapAccount = Keypair.generate();

  const wrapIxs: Array<TransactionInstruction> = [
    SystemProgram.createAccount({
      fromPubkey: payer,
      newAccountPubkey: newWrapAccount.publicKey,
      lamports: minimumAccountBalance + amountToWrapInLamports,
      space: AccountLayout.span,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeAccountInstruction(
      newWrapAccount.publicKey,
      NATIVE_MINT,
      owner,
    ),
    createTransferInstruction(
      ownerWSolTokenAccount,
      newWrapAccount.publicKey,
      owner,
      amountToWrapInLamports,
      [],
    ),
    createCloseAccountInstruction(
      newWrapAccount.publicKey,
      payer,
      owner,
      [],
    ),
  ];

  return [wrapIxs, newWrapAccount];
}

export async function createAtaCreateInstructionIfNotExists(
  ataAddress: PublicKey,
  mintAddress: PublicKey,
  ownerAccountAddress: PublicKey,
  payerAddress: PublicKey,
  connection: Connection,
): Promise<TransactionInstruction | null> {
  try {
    const ata = await connection.getAccountInfo(ataAddress);
    if (!ata) {
      const [, createIx] = await createAtaCreateInstruction(
        ataAddress,
        mintAddress,
        ownerAccountAddress,
        payerAddress,
      );
      return createIx;
    }

    return null;
  } catch (err) {
    console.log('Unable to find associated account: %s', err);
    throw Error('Unable to find associated account');
  }
}

export async function createAtaCreateInstruction(
  ataAddress: PublicKey,
  mintAddress: PublicKey,
  ownerAccountAddress: PublicKey,
  payerAddress: PublicKey,
): Promise<[PublicKey, TransactionInstruction]> {
  if (ataAddress === null) {
    ataAddress = await getAssociatedTokenAddress(
      mintAddress,
      ownerAccountAddress,
    );
  }

  const ataCreateInstruction = createAssociatedTokenAccountInstruction(
    payerAddress,
    ataAddress,
    ownerAccountAddress,
    mintAddress
  );
  return [ataAddress, ataCreateInstruction];
}

export async function createWrapSolInstructions(
  connection: Connection,
  wSolAmountInLamports: number | BN | string,
  owner: PublicKey,
  ownerWSolTokenAccount: PublicKey,
  ownerWSolTokenAccountInfo: AccountInfo<Buffer> | null,
): Promise<[TransactionInstruction[], Keypair[]]> {
  const ixs: TransactionInstruction[] = [];
  const signers: Keypair[] = [];
  const wSolAmountInLamportsBn = new BN(wSolAmountInLamports);
  let ownerWSolAtaBalanceBn = new BN(0);

  if (ownerWSolTokenAccountInfo) {
    const ownerWSolAtaTokenAmount = (
      await connection.getTokenAccountBalance(ownerWSolTokenAccount)
    ).value;
    ownerWSolAtaBalanceBn = new BN(ownerWSolAtaTokenAmount.amount);
  } else {
    const ownerFromAtaCreateInstruction =
      await createAtaCreateInstructionIfNotExists(
        ownerWSolTokenAccount,
        NATIVE_MINT,
        owner,
        owner,
        connection,
      );
    if (ownerFromAtaCreateInstruction) ixs.push(ownerFromAtaCreateInstruction);
  }
  if (wSolAmountInLamportsBn.gt(ownerWSolAtaBalanceBn)) {
    const amountToWrapBn = wSolAmountInLamportsBn.sub(ownerWSolAtaBalanceBn);
    const [wrapIxs, newWrapAccount] = await fundExistingWSolAccountInstructions(
      connection,
      owner,
      ownerWSolTokenAccount,
      owner,
      amountToWrapBn.toNumber(),
    );
    ixs.push(...wrapIxs);
    signers.push(newWrapAccount);
  }

  return [ixs, signers];
}

// export async function createWrappedSolTokenAccountInstructions(
//   connection: Connection,
//   amountToWrapInLamports: number,
//   owner: PublicKey,
//   ownerWSolTokenAccount: PublicKey,
// ): Promise<[TransactionInstruction[], Keypair]> {

//   // REF: https://github.com/solana-labs/solana-program-library/blob/3eccf25ece1c373a117fc9f6e6cbeb2216d86f03/token/ts/src/instructions/syncNative.ts#L28
//   const wrapIxs = [
//     Token.createAssociatedTokenAccountInstruction(
//         payer.publicKey,
//         associatedToken,
//         owner,
//         NATIVE_MINT,
//         programId,
//         ASSOCIATED_TOKEN_PROGRAM_ID
//     ),
//     SystemProgram.transfer({
//         fromPubkey: payer.publicKey,
//         toPubkey: associatedToken,
//         lamports: amount,
//     }),
//     createSyncNativeInstruction(associatedToken, programId)
//   ];

//   return [wrapIxs, newWSolAccount];
// }

export function sleep(ms: number) {
  console.log('Sleeping for', ms / 1000, 'seconds');
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const listAccountActivity = async (
  program: Program<Ps>,
  address: PublicKey,
  before = '',
  limit = 10,
  commitment?: Finality | undefined,
): Promise<AccountActivity[]> => {
  let activityRaw: ActivityRaw[] = [];
  const finality = commitment !== undefined ? commitment : 'confirmed';
  const filter = { limit: limit } as ConfirmedSignaturesForAddress2Options;
  if (before) {
    filter['before'] = before;
  }
  const signatures =
    await program.provider.connection.getConfirmedSignaturesForAddress2(
      address,
      filter,
      finality,
    );
  const txs = await program.provider.connection.getParsedTransactions(
    signatures.map(s => s.signature),
    finality,
  );
  if (txs && txs.length) {
    activityRaw = await parseProgramTransactions(
      txs as ParsedTransactionWithMeta[],
      program.programId,
      address,
    );

    activityRaw.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));
  }

  const activity = activityRaw.map(i => {
    return {
      signature: i.signature,
      actionCode: i.action,
      initializer: i.initializer?.toBase58(),
      mint: i.mint?.toBase58(),
      blockTime: i.blockTime,
      amount: i.amount ? i.amount.toString() : '',
      beneficiary: i.beneficiary?.toBase58(),
      destination: i.destination?.toBase58(),
      template: i.template?.toBase58(),
      destinationTokenAccount: i.destinationTokenAccount?.toBase58(),
      stream: i.stream?.toBase58(),
      utcDate: i.utcDate,
    } as AccountActivity;
  });

  return activity;
};

export function toUnixTimestamp(date: Date): number {
  return Math.round(date.getTime() / 1000);
}

async function parseProgramInstruction(
  ix: PartiallyDecodedInstruction,
  transactionSignature: string,
  transactionBlockTimeInSeconds: number,
  idlFileVersion: number,
  programId: PublicKey,
  psAccountAddress?: PublicKey,
  streamAddress?: PublicKey,
): Promise<ActivityRaw | null> {
  if (!psAccountAddress && !streamAddress) {
    throw new Error('At leaset one of psAccount or stream is required');
  }

  if (!ix.programId.equals(programId)) {
    return null;
  }

  if (idlFileVersion <= 0 || idlFileVersion > LATEST_IDL_FILE_VERSION) {
    return null;
  }

  try {
    if (!idls[idlFileVersion]) {
      if (idlFileVersion === 1) {
        // TODO: to avoid this if else, find a way to do dynamic imports passign concatenated paths
        const importedIdl = await import('./msp_idl_001');
        idls[idlFileVersion] = importedIdl.IDL;
      } else if (idlFileVersion === 2) {
        const importedIdl = await import('./msp_idl_002');
        idls[idlFileVersion] = importedIdl.IDL;
      } else if (idlFileVersion === 3) {
        const importedIdl = await import('./msp_idl_003');
        idls[idlFileVersion] = importedIdl.IDL;
      } else if (idlFileVersion === 4) {
        const importedIdl = await import('./msp_idl_004');
        idls[idlFileVersion] = importedIdl.IDL;
      } else if (idlFileVersion === 5) {
        const importedIdl = await import('./msp_idl_005');
        idls[idlFileVersion] = importedIdl.IDL;
      } else {
        return null;
      }
    }

    const coder = new BorshInstructionCoder(idls[idlFileVersion] as Idl);

    const decodedIx = coder.decode(ix.data, 'base58');
    if (!decodedIx) return null;

    const accountOnlyIxs = [
      'createTreasury',
      'createTreasuryAndTemplate',
      'modifyStreamTemplate',
      'addFunds',
      'treasuryWithdraw',
      'refreshTreasuryData',
    ];

    const accountAndStreamIxs = [
      'createStream',
      'createStreamPda',
      'createStreamWithTemplate',
      'createStreamPdaWithTemplate',
      'allocate',
      'pauseStream',
      'resumeStream',
      'withdraw',
      'closeStream',
    ];

    const ixName = decodedIx.name;

    if (accountOnlyIxs.concat(accountAndStreamIxs).indexOf(ixName) === -1) {
      return null;
    }

    if (streamAddress && accountAndStreamIxs.indexOf(ixName) === -1) {
      return null;
    }

    const ixAccountMetas = ix.accounts.map(pk => {
      return { pubkey: pk, isSigner: false, isWritable: false };
    });

    const formattedIx = coder.format(decodedIx, ixAccountMetas);
    if (!formattedIx) {
      return null;
    }

    let stream: PublicKey | undefined;
    if (streamAddress) {
      stream = formattedIx?.accounts.find(a => a.name === 'Stream')?.pubkey;
      if (!stream || !stream.equals(streamAddress)) {
        return null;
      }
    }

    // mult by 1000 to add milliseconds
    const blockTime = transactionBlockTimeInSeconds * 1000;

    let action: ActivityActionCode = ActivityActionCode.Unknown;
    let initializer: PublicKey | undefined;
    let mint: PublicKey | undefined;
    let amount: BN | undefined;
    let template: PublicKey | undefined;
    let beneficiary: PublicKey | undefined;
    let destination: PublicKey | undefined;
    let destinationTokenAccount: PublicKey | undefined;
    if (
      decodedIx.name === 'createStream' ||
      decodedIx.name === 'createStreamPda' ||
      decodedIx.name === 'createStreamWithTemplate' ||
      decodedIx.name === 'createStreamPdaWithTemplate'
    ) {
      action = ActivityActionCode.StreamCreated;
      initializer = formattedIx.accounts.find(
        a => a.name === 'Treasurer',
      )?.pubkey;
      mint = formattedIx.accounts.find(
        a => a.name === 'Associated Token',
      )?.pubkey;
      template = formattedIx?.accounts.find(a => a.name === 'Template')?.pubkey;
      const parsedAmount = formattedIx.args.find(
        a => a.name === 'allocationAssignedUnits',
      )?.data;
      amount = parsedAmount ? new BN(parsedAmount) : undefined;
    } else if (decodedIx.name === 'allocate') {
      action = ActivityActionCode.FundsAllocatedToStream;
      initializer = formattedIx.accounts.find(
        a => a.name === 'Treasurer',
      )?.pubkey;
      mint = formattedIx.accounts.find(
        a => a.name === 'Associated Token',
      )?.pubkey;
      const parsedAmount = formattedIx.args.find(
        a => a.name === 'amount',
      )?.data;
      amount = parsedAmount ? new BN(parsedAmount) : undefined;
    } else if (decodedIx.name === 'withdraw') {
      action = ActivityActionCode.FundsWithdrawnFromStream;
      initializer = formattedIx.accounts.find(
        a => a.name === 'Beneficiary',
      )?.pubkey;
      mint = formattedIx.accounts.find(
        a => a.name === 'Associated Token',
      )?.pubkey;
      const parsedAmount = formattedIx.args.find(
        a => a.name === 'amount',
      )?.data;
      amount = parsedAmount ? new BN(parsedAmount) : undefined;
    } else if (decodedIx.name === 'pauseStream') {
      action = ActivityActionCode.StreamPaused;
      initializer = formattedIx.accounts.find(
        a => a.name === 'Initializer',
      )?.pubkey;
    } else if (decodedIx.name === 'resumeStream') {
      action = ActivityActionCode.StreamResumed;
      initializer = formattedIx.accounts.find(
        a => a.name === 'Initializer',
      )?.pubkey;
    } else if (decodedIx.name === 'closeStream') {
      action = ActivityActionCode.StreamClosed;
      initializer = formattedIx.accounts.find(
        a => a.name === 'Treasurer',
      )?.pubkey;
      beneficiary = formattedIx.accounts.find(
        a => a.name === 'Beneficiary',
      )?.pubkey;
    }

    if (streamAddress) {
      const activity: ActivityRaw = {
        signature: transactionSignature,
        initializer: initializer,
        blockTime,
        utcDate: new Date(blockTime).toUTCString(),
        action,
        // TODO: Here the 'amount' might not be accurate, we need to emit events instead
        amount,
        mint,
      };

      return activity;
    }

    if (decodedIx.name === 'createTreasury') {
      action = ActivityActionCode.AccountCreated;
      initializer = formattedIx?.accounts.find(
        a => a.name === 'Treasurer',
      )?.pubkey;
      mint = formattedIx?.accounts.find(
        a => a.name === 'Associated Token',
      )?.pubkey;
    } else if (decodedIx.name === 'createTreasuryAndTemplate') {
      action = ActivityActionCode.AccountCreatedWithTemplate;
      initializer = formattedIx?.accounts.find(
        a => a.name === 'Treasurer',
      )?.pubkey;
      mint = formattedIx?.accounts.find(
        a => a.name === 'Associated Token',
      )?.pubkey;
      template = formattedIx?.accounts.find(a => a.name === 'Template')?.pubkey;
    } else if (decodedIx.name === 'modifyStreamTemplate') {
      action = ActivityActionCode.StreamTemplateUpdated;
      initializer = formattedIx?.accounts.find(
        a => a.name === 'Treasurer',
      )?.pubkey;
      template = formattedIx?.accounts.find(a => a.name === 'Template')?.pubkey;
    } else if (decodedIx.name === 'createStreamWithTemplate') {
      action = ActivityActionCode.StreamCreated;
      stream = formattedIx?.accounts.find(a => a.name === 'Stream')?.pubkey;
      initializer = formattedIx?.accounts.find(
        a => a.name === 'Treasurer',
      )?.pubkey;
      template = formattedIx?.accounts.find(a => a.name === 'Template')?.pubkey;
      mint = formattedIx?.accounts.find(
        a => a.name === 'Associated Token',
      )?.pubkey;
      beneficiary = formattedIx?.accounts.find(
        a => a.name === 'Beneficiary',
      )?.pubkey;
      const parsedAmount = formattedIx?.args.find(
        a => a.name === 'allocationAssignedUnits',
      )?.data;
      amount = parsedAmount ? new BN(parsedAmount) : undefined;
    } else if (decodedIx.name === 'addFunds') {
      action = ActivityActionCode.FundsAddedToAccount;
      initializer = formattedIx?.accounts.find(
        a => a.name === 'Treasurer',
      )?.pubkey;
      mint = formattedIx?.accounts.find(
        a => a.name === 'Associated Token',
      )?.pubkey;
      const parsedAmount = formattedIx?.args.find(
        a => a.name === 'amount',
      )?.data;
      amount = parsedAmount ? new BN(parsedAmount) : undefined;
    } else if (decodedIx.name === 'treasuryWithdraw') {
      action = ActivityActionCode.FundsWithdrawnFromAccount;
      initializer = formattedIx?.accounts.find(
        a => a.name === 'Treasurer',
      )?.pubkey;
      mint = formattedIx?.accounts.find(
        a => a.name === 'Associated Token',
      )?.pubkey;
      destination = formattedIx?.accounts.find(
        a => a.name === 'Destination Authority',
      )?.pubkey;
      destinationTokenAccount = formattedIx?.accounts.find(
        a => a.name === 'Destination Token Account',
      )?.pubkey;
      const parsedAmount = formattedIx?.args.find(
        a => a.name === 'amount',
      )?.data;
      amount = parsedAmount ? new BN(parsedAmount) : undefined;
    } else if (decodedIx.name === 'refreshTreasuryData') {
      action = ActivityActionCode.AccountDataRefreshed;
      initializer = formattedIx?.accounts.find(
        a => a.name === 'Treasurer',
      )?.pubkey;
      mint = formattedIx?.accounts.find(
        a => a.name === 'Associated Token',
      )?.pubkey;
    }

    return {
      signature: transactionSignature,
      action,
      template,
      amount,
      beneficiary,
      blockTime,
      destination,
      destinationTokenAccount,
      initializer,
      mint,
      stream,
      utcDate: new Date(blockTime).toUTCString(),
    };
  } catch (error) {
    console.log(`Could not parse activity (${error})`);
    return null;
  }
}
