// how to run: 
// cargo test-bpf -- --nocapture
// #![cfg(feature = "test-bpf")]

use std::println;
use {
    anchor_client::{
        solana_sdk::{
            account::Account,
            commitment_config::CommitmentConfig,
            pubkey::Pubkey,
            signature::{Keypair, Signer},
            sysvar::rent,
            transaction::Transaction,
        },
        Client, Cluster,
    },
    solana_program_test::{tokio, ProgramTest},
    std::rc::Rc,
};

use anchor_lang::prelude::Clock;
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token;
use anchor_spl::token;
use msp::{
    enums::TreasuryType,
    instruction::{AddFunds, Allocate, CreateStream, CreateTreasury},
    instructions::fee_treasury,
    stream::Stream,
    categories::Category,
    categories::SubCategory,
};
use solana_program::program_pack::Pack;
use solana_program_test::ProgramTestContext;
use spl_token::native_mint;
use std::convert::TryInto;

#[tokio::test]
async fn create_treasury_test_1() {
    let mut pt = ProgramTest::new("msp", msp::id(), None);
    let (treasurer, treasurer_account) = user_account();
    let (beneficiary, _) = user_account();
    
    let slot = 0_u64;
    let (treasury_pubkey,treasury_token_mint,treasury_token_account) = treasury_accounts(treasurer.pubkey(), slot);
    let (treasurer_token, treasurer_token_account) = treasurer_accounts(treasury_token_mint, treasurer.pubkey());
    let (fee_pubkey, fee_account, fees_token) = fee(&treasury_token_mint);

    pt.add_account(fee_pubkey, fee_account);
    pt.add_account(treasurer.pubkey(), treasurer_account);
    pt.add_account(treasurer_token, treasurer_token_account);
    pt.set_compute_max_units(200_000); // maximum number of instructions allowed

    let mut context = pt.start_with_context().await;
    let mut clock = context.banks_client.get_sysvar::<Clock>().await.unwrap();

    let client = Client::new_with_options(
        Cluster::Debug,
        Rc::new(Keypair::new()),
        CommitmentConfig::processed(),
    );
    let program = client.program(msp::id());

    create_treasury(
        &mut context,
        &program,
        CreateTreasury {
            _idl_file_version: msp::constants::IDL_FILE_VERSION,
            slot,
            name: "test treasury".to_string(),
            treasury_type: TreasuryType::Opened as u8,
            auto_close: false,
            sol_fee_payed_by_treasury: true,
            category: Category::Default,
            sub_category: SubCategory::Default,
        },
        &treasurer,
        &treasury_pubkey,
        &treasury_token_account,
        &treasury_token_mint,
        &fee_pubkey,
    )
    .await;

    add_funds(
        &mut context,
        &program,
        AddFunds {
            _idl_file_version: msp::constants::IDL_FILE_VERSION,
            amount: 1000,
        },
        &treasurer,
        &treasurer_token,
        &treasury_pubkey,
        &treasury_token_mint,
        &treasury_token_account,
        &fee_pubkey,
        &fees_token,
    )
    .await;

    let (stream, stream_key) = create_stream(
        &mut context,
        &program,
        CreateStream {
            _idl_file_version: msp::constants::IDL_FILE_VERSION,
            name: "test stream".to_string(),
            start_utc: 0,
            rate_amount_units: 5,
            rate_interval_in_seconds: 2,
            allocation_assigned_units: 6,
            cliff_vest_amount_units: 0,
            cliff_vest_percent: 0,
            fee_payed_by_treasurer: true,
        },
        &treasurer,
        &treasury_pubkey,
        &treasury_token_account,
        &treasury_token_mint,
        &beneficiary.pubkey(),
        &fee_pubkey,
        &fees_token,
    )
    .await;
    println!(
        "stream:\nversion: {}, treasurer: {}, start_ts: {}",
        stream.version, stream.treasurer_address, stream.start_utc
    );
    assert_eq!(stream.version, 2, "incorrect version");
    assert_eq!(stream.rate_amount_units, 5, "incorrect rate amount");
    assert_eq!(
        stream.rate_interval_in_seconds, 2,
        "incorrect rate interval"
    );
    assert_eq!(
        stream.allocation_assigned_units, 6,
        "incorrect stream allocation"
    );
    let seconds_since_start = (clock.unix_timestamp as u64)
        .checked_sub(stream.start_utc)
        .unwrap();
    let withdrawable = stream
        .get_beneficiary_withdrawable_amount(seconds_since_start)
        .unwrap();
    assert_eq!(withdrawable, 0, "incorrect withdrawable amount");
    let status = stream.get_status(clock.unix_timestamp as u64).unwrap();
    assert_eq!(
        status,
        msp::enums::StreamStatus::Running,
        "incorrect status"
    );

    // fast forward +1
    clock.unix_timestamp = clock.unix_timestamp.checked_add(1).unwrap();
    context.set_sysvar(&clock);

    assert_eq!(
        stream.allocation_assigned_units, 6,
        "incorrect stream allocation"
    );
    let withdrawable = stream
        .get_beneficiary_withdrawable_amount(clock.unix_timestamp as u64)
        .unwrap();
    assert_eq!(withdrawable, 2, "incorrect withdrawable amount");
    let status = stream.get_status(clock.unix_timestamp as u64).unwrap();
    assert_eq!(
        status,
        msp::enums::StreamStatus::Running,
        "incorrect status"
    );

    // fast forward +2
    clock.unix_timestamp = clock.unix_timestamp.checked_add(1).unwrap();
    context.set_sysvar(&clock);

    assert_eq!(
        stream.allocation_assigned_units, 6,
        "incorrect stream allocation"
    );
    let mut withdrawable = stream
        .get_beneficiary_withdrawable_amount(clock.unix_timestamp as u64)
        .unwrap();
    assert_eq!(withdrawable, 6, "incorrect withdrawable amount");
    let status = stream.get_status(clock.unix_timestamp as u64).unwrap();
    assert_eq!(
        status,
        msp::enums::StreamStatus::Paused,
        "incorrect status"
    );

    allocate(
        &mut context,
        &program,
        Allocate {
            _idl_file_version: msp::constants::IDL_FILE_VERSION,
            amount: 4,
        },
        &treasurer,
        &treasury_pubkey,
        stream_key.pubkey(),
        &treasury_token_account,
        &treasury_token_mint,
        &fee_pubkey,
        &fees_token,
    )
    .await;

    let stream = &mut fetch_stream(&context, stream_key.pubkey()).await;
    assert_eq!(
        stream.allocation_assigned_units, 10,
        "incorrect stream allocation"
    );
    withdrawable = stream
        .get_beneficiary_withdrawable_amount(clock.unix_timestamp as u64)
        .unwrap();
    // this is a caveat of our convention for calculationg streamed units at any given point
    assert_eq!(withdrawable, 5, "incorrect withdrawable amount");
    let status = stream.get_status(clock.unix_timestamp as u64).unwrap();
    assert_eq!(
        status,
        msp::enums::StreamStatus::Running,
        "incorrect status"
    );

    // fast forward +3
    clock.unix_timestamp = clock.unix_timestamp.checked_add(1).unwrap();
    context.set_sysvar(&clock);

    assert_eq!(
        stream.allocation_assigned_units, 10,
        "incorrect stream allocation"
    );
    withdrawable = stream
        .get_beneficiary_withdrawable_amount(clock.unix_timestamp as u64)
        .unwrap();
    assert_eq!(withdrawable, 7, "incorrect withdrawable amount");
    let status = stream.get_status(clock.unix_timestamp as u64).unwrap();
    assert_eq!(
        status,
        msp::enums::StreamStatus::Running,
        "incorrect status"
    );

    // fast forward +4
    clock.unix_timestamp = clock.unix_timestamp.checked_add(1).unwrap();
    context.set_sysvar(&clock);

    assert_eq!(
        stream.allocation_assigned_units, 10,
        "incorrect stream allocation"
    );
    withdrawable = stream
        .get_beneficiary_withdrawable_amount(clock.unix_timestamp as u64)
        .unwrap();
    assert_eq!(withdrawable, 10, "incorrect withdrawable amount");
    let status = stream.get_status(clock.unix_timestamp as u64).unwrap();
    assert_eq!(status, msp::enums::StreamStatus::Paused, "incorrect status");
}

#[tokio::test]
async fn create_treasury_test_2() {
    let mut pt = ProgramTest::new("msp", msp::id(), None);
    let (treasurer, treasurer_account) = user_account();
    let (beneficiary, _) = user_account();
    
    let slot = 0_u64;
    let (treasury_pubkey,treasury_token_mint,treasury_token_account) = treasury_accounts(treasurer.pubkey(), slot);
    let (treasurer_token, treasurer_token_account) = treasurer_accounts(treasury_token_mint, treasurer.pubkey());
    let (fee_pubkey, fee_account, fees_token) = fee(&treasury_token_mint);

    pt.add_account(fee_pubkey, fee_account);
    pt.add_account(treasurer.pubkey(), treasurer_account);
    pt.add_account(treasurer_token, treasurer_token_account);
    pt.set_compute_max_units(200_000); // maximum number of instructions allowed

    let mut context = pt.start_with_context().await;
    let mut clock = context.banks_client.get_sysvar::<Clock>().await.unwrap();

    let client = Client::new_with_options(
        Cluster::Debug,
        Rc::new(Keypair::new()),
        CommitmentConfig::processed(),
    );
    let program = client.program(msp::id());

    create_treasury(
        &mut context,
        &program,
        CreateTreasury {
            _idl_file_version: msp::constants::IDL_FILE_VERSION,
            slot,
            name: "test treasury".to_string(),
            treasury_type: TreasuryType::Opened as u8,
            auto_close: false,
            sol_fee_payed_by_treasury: true,
            category: Category::Default,
            sub_category: SubCategory::Default,
        },
        &treasurer,
        &treasury_pubkey,
        &treasury_token_account,
        &treasury_token_mint,
        &fee_pubkey,
    )
    .await;

    add_funds(
        &mut context,
        &program,
        AddFunds {
            _idl_file_version: msp::constants::IDL_FILE_VERSION,
            amount: 1000,
        },
        &treasurer,
        &treasurer_token,
        &treasury_pubkey,
        &treasury_token_mint,
        &treasury_token_account,
        &fee_pubkey,
        &fees_token,
    )
    .await;

    let (stream, stream_key) = create_stream(
        &mut context,
        &program,
        CreateStream {
            _idl_file_version: msp::constants::IDL_FILE_VERSION,
            name: "test stream".to_string(),
            start_utc: 0,
            rate_amount_units: 5,
            rate_interval_in_seconds: 2,
            allocation_assigned_units: 6,
            cliff_vest_amount_units: 0,
            cliff_vest_percent: 0,
            fee_payed_by_treasurer: true,
        },
        &treasurer,
        &treasury_pubkey,
        &treasury_token_account,
        &treasury_token_mint,
        &beneficiary.pubkey(),
        &fee_pubkey,
        &fees_token,
    )
    .await;
    println!(
        "stream:\nversion: {}, treasurer: {}, start_ts: {}",
        stream.version, stream.treasurer_address, stream.start_utc
    );
    assert_eq!(stream.version, 2, "incorrect version");
    assert_eq!(stream.rate_amount_units, 5, "incorrect rate amount");
    assert_eq!(
        stream.rate_interval_in_seconds, 2,
        "incorrect rate interval"
    );
    assert_eq!(
        stream.allocation_assigned_units, 6,
        "incorrect stream allocation"
    );
    let seconds_since_start = (clock.unix_timestamp as u64)
        .checked_sub(stream.start_utc)
        .unwrap();
    let withdrawable = stream
        .get_beneficiary_withdrawable_amount(seconds_since_start)
        .unwrap();
    assert_eq!(withdrawable, 0, "incorrect withdrawable amount");
    let status = stream.get_status(clock.unix_timestamp as u64).unwrap();
    assert_eq!(
        status,
        msp::enums::StreamStatus::Running,
        "incorrect status"
    );

    // fast forward +1
    clock.unix_timestamp = clock.unix_timestamp.checked_add(1).unwrap();
    context.set_sysvar(&clock);

    assert_eq!(
        stream.allocation_assigned_units, 6,
        "incorrect stream allocation"
    );
    let withdrawable = stream
        .get_beneficiary_withdrawable_amount(clock.unix_timestamp as u64)
        .unwrap();
    assert_eq!(withdrawable, 2, "incorrect withdrawable amount");
    let status = stream.get_status(clock.unix_timestamp as u64).unwrap();
    assert_eq!(
        status,
        msp::enums::StreamStatus::Running,
        "incorrect status"
    );

    // fast forward +2
    clock.unix_timestamp = clock.unix_timestamp.checked_add(1).unwrap();
    context.set_sysvar(&clock);

    assert_eq!(
        stream.allocation_assigned_units, 6,
        "incorrect stream allocation"
    );
    let withdrawable = stream
        .get_beneficiary_withdrawable_amount(clock.unix_timestamp as u64)
        .unwrap();
    assert_eq!(withdrawable, 6, "incorrect withdrawable amount");
    let status = stream.get_status(clock.unix_timestamp as u64).unwrap();
    assert_eq!(
        status,
        msp::enums::StreamStatus::Paused,
        "incorrect status"
    );

    // fast forward +3
    clock.unix_timestamp = clock.unix_timestamp.checked_add(1).unwrap();
    context.set_sysvar(&clock);
    let status = stream.get_status(clock.unix_timestamp as u64).unwrap();
    assert_eq!(status, msp::enums::StreamStatus::Paused, "incorrect status");

    assert_eq!(
        stream.allocation_assigned_units, 6,
        "incorrect stream allocation"
    );
    let mut withdrawable = stream
        .get_beneficiary_withdrawable_amount(clock.unix_timestamp as u64)
        .unwrap();
    assert_eq!(withdrawable, 6, "incorrect withdrawable amount");

    allocate(
        &mut context,
        &program,
        Allocate {
            _idl_file_version: msp::constants::IDL_FILE_VERSION,
            amount: 4,
        },
        &treasurer,
        &treasury_pubkey,
        stream_key.pubkey(),
        &treasury_token_account,
        &treasury_token_mint,
        &fee_pubkey,
        &fees_token,
    )
    .await;

    let stream = &mut fetch_stream(&context, stream_key.pubkey()).await;
    assert_eq!(
        stream.allocation_assigned_units, 10,
        "incorrect stream allocation"
    );
    withdrawable = stream
        .get_beneficiary_withdrawable_amount(clock.unix_timestamp as u64)
        .unwrap();
    // this is a caveat of our convention for calculationg streamed units at any given point
    assert_eq!(withdrawable, 5, "incorrect withdrawable amount");
    let status = stream.get_status(clock.unix_timestamp as u64).unwrap();
    assert_eq!(
        status,
        msp::enums::StreamStatus::Running,
        "incorrect status"
    );

    // fast forward +4
    clock.unix_timestamp = clock.unix_timestamp.checked_add(1).unwrap();
    context.set_sysvar(&clock);

    assert_eq!(
        stream.allocation_assigned_units, 10,
        "incorrect stream allocation"
    );
    withdrawable = stream
        .get_beneficiary_withdrawable_amount(clock.unix_timestamp as u64)
        .unwrap();
    assert_eq!(withdrawable, 7, "incorrect withdrawable amount");
    let status = stream.get_status(clock.unix_timestamp as u64).unwrap();
    assert_eq!(
        status,
        msp::enums::StreamStatus::Running,
        "incorrect status"
    );

    // fast forward +5
    clock.unix_timestamp = clock.unix_timestamp.checked_add(1).unwrap();
    context.set_sysvar(&clock);

    assert_eq!(
        stream.allocation_assigned_units, 10,
        "incorrect stream allocation"
    );
    withdrawable = stream
        .get_beneficiary_withdrawable_amount(clock.unix_timestamp as u64)
        .unwrap();
    assert_eq!(withdrawable, 10, "incorrect withdrawable amount");
    let status = stream.get_status(clock.unix_timestamp as u64).unwrap();
    assert_eq!(status, msp::enums::StreamStatus::Paused, "incorrect status");
}

#[tokio::test]
async fn create_treasury_test_3() {
    let mut pt = ProgramTest::new("msp", msp::id(), None);
    let (treasurer, treasurer_account) = user_account();
    let (beneficiary, _) = user_account();
    
    let slot = 0_u64;
    let (treasury_pubkey,treasury_token_mint,treasury_token_account) = treasury_accounts(treasurer.pubkey(), slot);
    let (treasurer_token, treasurer_token_account) = treasurer_accounts(treasury_token_mint, treasurer.pubkey());
    let (fee_pubkey, fee_account, fees_token) = fee(&treasury_token_mint);

    pt.add_account(fee_pubkey, fee_account);
    pt.add_account(treasurer.pubkey(), treasurer_account);
    pt.add_account(treasurer_token, treasurer_token_account);
    pt.set_compute_max_units(200_000); // maximum number of instructions allowed

    let mut context = pt.start_with_context().await;
    let mut clock = context.banks_client.get_sysvar::<Clock>().await.unwrap();

    let client = Client::new_with_options(
        Cluster::Debug,
        Rc::new(Keypair::new()),
        CommitmentConfig::processed(),
    );
    let program = client.program(msp::id());

    create_treasury(
        &mut context,
        &program,
        CreateTreasury {
            _idl_file_version: msp::constants::IDL_FILE_VERSION,
            slot,
            name: "test treasury".to_string(),
            treasury_type: TreasuryType::Opened as u8,
            auto_close: false,
            sol_fee_payed_by_treasury: true,
            category: Category::Default,
            sub_category: SubCategory::Default,
        },
        &treasurer,
        &treasury_pubkey,
        &treasury_token_account,
        &treasury_token_mint,
        &fee_pubkey,
    )
    .await;

    add_funds(
        &mut context,
        &program,
        AddFunds {
            _idl_file_version: msp::constants::IDL_FILE_VERSION,
            amount: 1000,
        },
        &treasurer,
        &treasurer_token,
        &treasury_pubkey,
        &treasury_token_mint,
        &treasury_token_account,
        &fee_pubkey,
        &fees_token,
    )
    .await;

    let (stream, stream_key) = create_stream(
        &mut context,
        &program,
        CreateStream {
            _idl_file_version: msp::constants::IDL_FILE_VERSION,
            name: "test stream".to_string(),
            start_utc: 0,
            rate_amount_units: 4,
            rate_interval_in_seconds: 2,
            allocation_assigned_units: 8,
            cliff_vest_amount_units: 0,
            cliff_vest_percent: 0,
            fee_payed_by_treasurer: true,
        },
        &treasurer,
        &treasury_pubkey,
        &treasury_token_account,
        &treasury_token_mint,
        &beneficiary.pubkey(),
        &fee_pubkey,
        &fees_token,
    )
    .await;
    println!(
        "stream:\nversion: {}, treasurer: {}, start_ts: {}",
        stream.version, stream.treasurer_address, stream.start_utc
    );
    assert_eq!(stream.version, 2, "incorrect version");
    assert_eq!(stream.rate_amount_units, 4, "incorrect rate amount");
    assert_eq!(
        stream.rate_interval_in_seconds, 2,
        "incorrect rate interval"
    );
    assert_eq!(
        stream.allocation_assigned_units, 8,
        "incorrect stream allocation"
    );
    let seconds_since_start = (clock.unix_timestamp as u64)
        .checked_sub(stream.start_utc)
        .unwrap();
    let withdrawable = stream
        .get_beneficiary_withdrawable_amount(seconds_since_start)
        .unwrap();
    assert_eq!(withdrawable, 0, "incorrect withdrawable amount");
    let status = stream.get_status(clock.unix_timestamp as u64).unwrap();
    assert_eq!(
        status,
        msp::enums::StreamStatus::Running,
        "incorrect status"
    );

    // fast forward +1
    clock.unix_timestamp = clock.unix_timestamp.checked_add(1).unwrap(); 
    context.set_sysvar(&clock);

    assert_eq!(
        stream.allocation_assigned_units, 8,
        "incorrect stream allocation"
    );
    let withdrawable = stream
        .get_beneficiary_withdrawable_amount(clock.unix_timestamp as u64)
        .unwrap();
    assert_eq!(withdrawable, 2, "incorrect withdrawable amount");
    let status = stream.get_status(clock.unix_timestamp as u64).unwrap();
    assert_eq!(
        status,
        msp::enums::StreamStatus::Running,
        "incorrect status"
    );

    // fast forward +2
    clock.unix_timestamp = clock.unix_timestamp.checked_add(1).unwrap(); 
    context.set_sysvar(&clock);

    assert_eq!(
        stream.allocation_assigned_units, 8,
        "incorrect stream allocation"
    );
    let withdrawable = stream
        .get_beneficiary_withdrawable_amount(clock.unix_timestamp as u64)
        .unwrap();
    assert_eq!(withdrawable, 4, "incorrect withdrawable amount");
    let status = stream.get_status(clock.unix_timestamp as u64).unwrap();
    assert_eq!(
        status,
        msp::enums::StreamStatus::Running,
        "incorrect status"
    );

    // fast forward +4
    clock.unix_timestamp = clock.unix_timestamp.checked_add(2).unwrap();
    context.set_sysvar(&clock);
    let status = stream.get_status(clock.unix_timestamp as u64).unwrap();
    assert_eq!(status, msp::enums::StreamStatus::Paused, "incorrect status");

    assert_eq!(
        stream.allocation_assigned_units, 8,
        "incorrect stream allocation"
    );
    let mut withdrawable = stream
        .get_beneficiary_withdrawable_amount(clock.unix_timestamp as u64)
        .unwrap();
    assert_eq!(withdrawable, 8, "incorrect withdrawable amount");

    allocate(
        &mut context,
        &program,
        Allocate {
            _idl_file_version: msp::constants::IDL_FILE_VERSION,
            amount: 4,
        },
        &treasurer,
        &treasury_pubkey,
        stream_key.pubkey(),
        &treasury_token_account,
        &treasury_token_mint,
        &fee_pubkey,
        &fees_token,
    )
    .await;

    let stream = &mut fetch_stream(&context, stream_key.pubkey()).await;
    assert_eq!(
        stream.allocation_assigned_units, 12,
        "incorrect stream allocation"
    );
    withdrawable = stream
        .get_beneficiary_withdrawable_amount(clock.unix_timestamp as u64)
        .unwrap();
    assert_eq!(withdrawable, 8, "incorrect withdrawable amount");
    let status = stream.get_status(clock.unix_timestamp as u64).unwrap();
    assert_eq!(
        status,
        msp::enums::StreamStatus::Running,
        "incorrect status"
    );

    // fast forward +5
    clock.unix_timestamp = clock.unix_timestamp.checked_add(1).unwrap();
    context.set_sysvar(&clock);

    assert_eq!(
        stream.allocation_assigned_units, 12,
        "incorrect stream allocation"
    );
    withdrawable = stream
        .get_beneficiary_withdrawable_amount(clock.unix_timestamp as u64)
        .unwrap();
    assert_eq!(withdrawable, 10, "incorrect withdrawable amount");
    let status = stream.get_status(clock.unix_timestamp as u64).unwrap();
    assert_eq!(
        status,
        msp::enums::StreamStatus::Running,
        "incorrect status"
    );

    // fast forward +6
    clock.unix_timestamp = clock.unix_timestamp.checked_add(1).unwrap();
    context.set_sysvar(&clock);

    assert_eq!(
        stream.allocation_assigned_units, 12,
        "incorrect stream allocation"
    );
    withdrawable = stream
        .get_beneficiary_withdrawable_amount(clock.unix_timestamp as u64)
        .unwrap();
    assert_eq!(withdrawable, 12, "incorrect withdrawable amount");
    let status = stream.get_status(clock.unix_timestamp as u64).unwrap();
    assert_eq!(status, msp::enums::StreamStatus::Paused, "incorrect status");
}

async fn create_treasury(
    context: &mut ProgramTestContext,
    program: &anchor_client::Program,
    parameters: CreateTreasury,
    treasurer: &Keypair,
    treasury_pubkey: &Pubkey,
    treasury_token_account: &Pubkey,
    treasury_token_mint: &Pubkey,
    fee_pubkey: &Pubkey,
) {
    let create_treasury_ix = program
        .request()
        .accounts(msp::accounts::CreateTreasuryAccounts {
            payer: context.payer.pubkey(),
            treasurer: treasurer.pubkey(),
            treasury: treasury_pubkey.key(),
            treasury_token: treasury_token_account.clone(),
            associated_token: treasury_token_mint.clone(),
            fee_treasury: fee_pubkey.key(),
            associated_token_program: associated_token::ID,
            token_program: token::ID,
            system_program: system_program::ID,
            rent: rent::ID,
        })
        .args(parameters)
        .instructions()
        .unwrap()
        .pop()
        .unwrap();

    let create_treasury_tx = Transaction::new_signed_with_payer(
        &[create_treasury_ix],
        Some(&context.payer.pubkey()),
        &[&context.payer, &treasurer],
        context.last_blockhash,
    );

    context
        .banks_client
        .process_transaction(create_treasury_tx)
        .await
        .unwrap();
}

async fn create_stream(
    context: &mut ProgramTestContext,
    program: &anchor_client::Program,
    parameters: CreateStream,
    treasurer: &Keypair,
    treasury_pubkey: &Pubkey,
    treasury_token_account: &Pubkey,
    treasury_token_mint: &Pubkey,
    beneficiary_pubkey: &Pubkey,
    fee_pubkey: &Pubkey,
    fees_token: &Pubkey,
) -> (Stream, Keypair) {
    let stream_key = Keypair::new();
    let create_stream_ix = program
        .request()
        .accounts(msp::accounts::CreateStreamAccounts {
            payer: context.payer.pubkey(),
            treasurer: treasurer.pubkey(),
            treasury: treasury_pubkey.key(),
            treasury_token: treasury_token_account.clone(),
            associated_token: treasury_token_mint.clone(),
            beneficiary: beneficiary_pubkey.key(),
            stream: stream_key.pubkey(),
            fee_treasury: fee_pubkey.key(),
            fee_treasury_token: fees_token.clone(),
            associated_token_program: associated_token::ID,
            token_program: token::ID,
            system_program: system_program::ID,
            rent: rent::ID,
        })
        .args(parameters)
        .instructions()
        .unwrap()
        .pop()
        .unwrap();

    let crate_stream_tx = Transaction::new_signed_with_payer(
        &[create_stream_ix],
        Some(&context.payer.pubkey()),
        &[&context.payer, &treasurer, &stream_key],
        context.last_blockhash,
    );
    context
        .banks_client
        .process_transaction(crate_stream_tx)
        .await
        .unwrap();

    let stream = fetch_stream(context, stream_key.pubkey()).await;
    (stream, stream_key)
}

async fn allocate(
    context: &mut ProgramTestContext,
    program: &anchor_client::Program,
    parameters: Allocate,
    treasurer: &Keypair,
    treasury_pubkey: &Pubkey,
    stream_pubkey: Pubkey,
    treasury_token_account: &Pubkey,
    treasury_token_mint: &Pubkey,
    fee_pubkey: &Pubkey,
    fees_token: &Pubkey,
) {
    let allocate_ix = program
        .request()
        .accounts(msp::accounts::AllocateAccounts {
            payer: context.payer.pubkey(),
            treasurer: treasurer.pubkey(),
            treasury: treasury_pubkey.key(),
            treasury_token: treasury_token_account.key(),
            associated_token: treasury_token_mint.key(),
            stream: stream_pubkey.key(),
            fee_treasury: fee_pubkey.key(),
            fee_treasury_token: fees_token.key(),
            associated_token_program: associated_token::ID,
            token_program: token::ID,
            system_program: system_program::ID,
            rent: rent::ID,
        })
        .args(parameters)
        .instructions()
        .unwrap()
        .pop()
        .unwrap();

    let allocate_tx = Transaction::new_signed_with_payer(
        &[allocate_ix],
        Some(&context.payer.pubkey()),
        &[&context.payer, &treasurer],
        context.last_blockhash,
    );
    context
        .banks_client
        .process_transaction(allocate_tx)
        .await
        .unwrap();
}

async fn add_funds(
    context: &mut ProgramTestContext,
    program: &anchor_client::Program,
    parameters: AddFunds,
    treasurer: &Keypair,
    treasurer_token: &Pubkey,
    treasury_pubkey: &Pubkey,
    treasury_token_mint: &Pubkey,
    treasury_token_account: &Pubkey,
    fee_pubkey: &Pubkey,
    fees_token: &Pubkey,
) {
    let add_funds_to_treasury_ix = program
        .request()
        .accounts(msp::accounts::AddFundsAccounts {
            payer: context.payer.pubkey(),
            contributor: treasurer.pubkey(),
            contributor_token: treasurer_token.clone(),
            treasury: treasury_pubkey.key(),
            treasury_token: treasury_token_account.clone(),
            associated_token: treasury_token_mint.clone(),
            fee_treasury: fee_pubkey.key(),
            fee_treasury_token: fees_token.clone(),
            associated_token_program: associated_token::ID,
            token_program: token::ID,
            system_program: system_program::ID,
            rent: rent::ID,
        })
        .args(parameters)
        .instructions()
        .unwrap()
        .pop()
        .unwrap();

    let transaction = Transaction::new_signed_with_payer(
        &[add_funds_to_treasury_ix],
        Some(&context.payer.pubkey()),
        &[&context.payer, &treasurer],
        context.last_blockhash,
    );

    context
        .banks_client
        .process_transaction(transaction)
        .await
        .unwrap();
}

fn user_account() -> (Keypair, Account) {
    let user = Keypair::new();
    let account = {
        Account {
            lamports: 1,
            owner: system_program::ID,
            ..Account::default()
        }
    };
    (user, account)
}

fn treasury_accounts(treasurer: Pubkey, slot: u64) -> (Pubkey, Pubkey, Pubkey) {
    let treasury_token_mint = native_mint::id();
    let (treasury_pubkey, bump_seed) =
        Pubkey::find_program_address(&[treasurer.as_ref(), &slot.to_le_bytes()], &msp::id());
    println!(
        "treasury_pubkey: {}, bump_seed: {}",
        treasury_pubkey, bump_seed
    );
    let treasury_token_account =
        associated_token::get_associated_token_address(&treasury_pubkey, &treasury_token_mint);
    println!("treasury_token_account: {}", treasury_token_account);
    (
        treasury_pubkey,
        treasury_token_mint,
        treasury_token_account,
    )
}

fn treasurer_accounts(treasury_token_mint: Pubkey, treasurer: Pubkey) -> (Pubkey, Account) {
    let treasurer_token =
        associated_token::get_associated_token_address(&treasurer, &treasury_token_mint);
    let dst: &mut [u8] = &mut [0; spl_token::state::Account::LEN];
    let _ = &spl_token::state::Account {
        mint: treasury_token_mint,
        owner: treasurer,
        amount: 1000,
        // delegate: COption<Pubkey>,
        state: spl_token::state::AccountState::Initialized,
        // If is_some, this is a native token, and the value logs the rent-exempt reserve. An Account
        // is required to be rent-exempt, so the value is used by the Processor to ensure that wrapped
        // SOL accounts do not drop below this threshold.
        // is_native: COption<u64>,
        // The amount delegated
        // delegated_amount: u64,
        // Optional authority to close the account.
        // close_authority: COption<Pubkey>,
        ..spl_token::state::Account::default()
    }
    .pack_into_slice(dst);
    let treasurer_token_account = {
        let mut data = Vec::new();
        data.extend_from_slice(dst);
        Account {
            lamports: 1,
            data: data,
            owner: token::ID,
            ..Account::default()
        }
    };
    (treasurer_token, treasurer_token_account)
}

fn fee(treasury_token_mint: &Pubkey) -> (Pubkey, Account, Pubkey) {
    let fee_pubkey = fee_treasury::ID;
    let fee_account = {
        let fee_data = Vec::new();
        Account {
            lamports: 1,
            data: fee_data,
            owner: system_program::ID,
            ..Account::default()
        }
    };
    let fees_token =
        associated_token::get_associated_token_address(&fee_pubkey, &treasury_token_mint);

    (fee_pubkey, fee_account, fees_token)
}

async fn fetch_stream(context: &ProgramTestContext, stream_pubkey: Pubkey) -> msp::stream::Stream {
    let mut bank_copy = context.banks_client.clone();
    let stream_account = bank_copy.get_account(stream_pubkey).await.unwrap().unwrap();
    let stream_data_u8: [u8; 500] = stream_account.data.try_into().unwrap();
    let mut slice: &[u8] = &stream_data_u8;
    let stream_des = msp::stream::Stream::try_deserialize(&mut slice).unwrap();
    stream_des
}
