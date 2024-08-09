#!/bin/bash

################################################################################
#
# A script to run the sdk integration tests. The steps are:
# 
# 1. Start local validator
# 2. Deploy Payment Streaming program locally
# 3. Run the tests/coverage
#
# Usage:
#
# ./run-tests.sh
#
# Run this script from within the sdk package directory in which it is located.
# The anchor cli must be installed.
#
# cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked
#
################################################################################

set -e

PS_PID="MSPdQo5ZdrPh6rU1LsvUv5nRhAnj1mj6YQEqBUq8YwZ"
PACKAGE_DIR="sdks/payment-streaming"



echo
echo "Building program..."
cd ../..
anchor build -- --features test
cd $PACKAGE_DIR
echo

echo
echo "Starting local validator..."
# solana-test-validator --reset --quiet ----bpf-program $PS_PID ./target/deploy/msp.so &
# VALIDATOR_PID=$!
solana-test-validator\
    --reset\
    --quiet\
    --url localhost\
    --bpf-program $PS_PID ../../target/deploy/msp.so\
    --account CTB7VoBn6wXEE4bHkkmJZjPDWD8n8ytz61Yvtffar5Lm ./tests/data/ps-account-CTB7VoBn6wXEE4bHkkmJZjPDWD8n8ytz61Yvtffar5Lm.json\
    --account 5B97W6fGmSJ96YLxzCUSqYgv6THCRsXrrc96XsT9Lyex ./tests/data/ps-account-stream1-5B97W6fGmSJ96YLxzCUSqYgv6THCRsXrrc96XsT9Lyex.json\
    --account 8w9HbLF99gp7urc9Pra6r6VrcDKsnwDeXwaqxBgmsTxL ./tests/data/ps-account-stream2-8w9HbLF99gp7urc9Pra6r6VrcDKsnwDeXwaqxBgmsTxL.json\
    --account HTDxQon5FNFfYyu7zP7G2QZwLhNrx6zBmTiBH18Dy1XB ./tests/data/ps-account-stream3-HTDxQon5FNFfYyu7zP7G2QZwLhNrx6zBmTiBH18Dy1XB.json\
    --account BacrASSTD71zHsDvE8ifKZRhN4LZwuhryAF9LaCSe5kL ./tests/data/ps-account-token-BacrASSTD71zHsDvE8ifKZRhN4LZwuhryAF9LaCSe5kL.json\
    --account 2cw7ChGDenY7b4jKWvJKn2DeAbRfUyttEbZuaygtAykg ./tests/data/vesting-account-2cw7ChGDenY7b4jKWvJKn2DeAbRfUyttEbZuaygtAykg.json\
    --account JBonFtSeFAEqJzcAK44fS6umQt2d3GVajnG1yaA7bCHf ./tests/data/vesting-account-stream1-JBonFtSeFAEqJzcAK44fS6umQt2d3GVajnG1yaA7bCHf.json\
    --account 4hEwdEdV1LUd4xYo1NGPxFpcT3wJvWyJSEVLB9EQ5vmL ./tests/data/vesting-account-stream2-4hEwdEdV1LUd4xYo1NGPxFpcT3wJvWyJSEVLB9EQ5vmL.json\
    --account 2vARitHbGPkJJyxCrH93JPakQiof9pPizzcD9Z6DJBre ./tests/data/vesting-account-template-2vARitHbGPkJJyxCrH93JPakQiof9pPizzcD9Z6DJBre.json\
    --account A8Xq5znzCZB6fomRn39f1jFzaHjjfnwy2YML6vhejNwU ./tests/data/vesting-account-token-A8Xq5znzCZB6fomRn39f1jFzaHjjfnwy2YML6vhejNwU.json &
VALIDATOR_PID=$!
echo
echo ">>>>>>>>>>>>>>>  VALIDATOR PID: $VALIDATOR_PID <<<<<<<<<<<<<<<<<<<<<"
echo
sleep 6
echo


# echo
# echo "deploying program..."
# solana program deploy\
#     --program-id target/deploy/msp-keypair.json\
#     --url localhost\
#         target/deploy/msp.so
# echo

# ENABLE OPTIONALLY FOR DEBUGGING
# echo
# echo "deploying IDL..."
# pwd
# cd ../..
# pwd
# anchor idl init --provider.cluster localnet --filepath target/idl/msp.json $PS_PID
# cd $PACKAGE_DIR
# echo

echo
echo "CLI version"
solana --version
echo

echo
echo "Running tests..."
yarn test-coverage
echo

echo
echo "Stopping local validator..."
kill $VALIDATOR_PID
echo

echo
echo "Cleaning local validator data dir..."
rm -r ./test-ledger
echo

# account { id: CTB7VoBn6wXEE4bHkkmJZjPDWD8n8ytz61Yvtffar5Lm, name: PS-ACCOUNT-1670498258078, cat: default }
#     ├──token { id: BacrASSTD71zHsDvE8ifKZRhN4LZwuhryAF9LaCSe5kL }
#     ├──stream { id: 5B97W6fGmSJ96YLxzCUSqYgv6THCRsXrrc96XsT9Lyex, name: STREAM-1, cat: default }
#     ├──stream { id: 8w9HbLF99gp7urc9Pra6r6VrcDKsnwDeXwaqxBgmsTxL, name: STREAM-2, cat: default }
#     ├──stream { id: HTDxQon5FNFfYyu7zP7G2QZwLhNrx6zBmTiBH18Dy1XB, name: STREAM-3, cat: default }
#   account { id: 2cw7ChGDenY7b4jKWvJKn2DeAbRfUyttEbZuaygtAykg, name: VESTING-ACCOUNT-1670498260435, cat: vesting }
#     ├──token { id: A8Xq5znzCZB6fomRn39f1jFzaHjjfnwy2YML6vhejNwU }
#     ├──template { id: 2vARitHbGPkJJyxCrH93JPakQiof9pPizzcD9Z6DJBre }
#     ├──stream { id: JBonFtSeFAEqJzcAK44fS6umQt2d3GVajnG1yaA7bCHf, name: VESTING-STREAM-1, cat: vesting }
#     ├──stream { id: 4hEwdEdV1LUd4xYo1NGPxFpcT3wJvWyJSEVLB9EQ5vmL, name: VESTING-STREAM-2, cat: vesting }

# solana account CTB7VoBn6wXEE4bHkkmJZjPDWD8n8ytz61Yvtffar5Lm --output-file ps-account-CTB7VoBn6wXEE4bHkkmJZjPDWD8n8ytz61Yvtffar5Lm.json --output json
# solana account BacrASSTD71zHsDvE8ifKZRhN4LZwuhryAF9LaCSe5kL --output-file ps-account-token-BacrASSTD71zHsDvE8ifKZRhN4LZwuhryAF9LaCSe5kL.json --output json
# solana account 5B97W6fGmSJ96YLxzCUSqYgv6THCRsXrrc96XsT9Lyex --output-file ps-account-stream1-5B97W6fGmSJ96YLxzCUSqYgv6THCRsXrrc96XsT9Lyex.json --output json
# solana account 8w9HbLF99gp7urc9Pra6r6VrcDKsnwDeXwaqxBgmsTxL --output-file ps-account-stream2-8w9HbLF99gp7urc9Pra6r6VrcDKsnwDeXwaqxBgmsTxL.json --output json
# solana account HTDxQon5FNFfYyu7zP7G2QZwLhNrx6zBmTiBH18Dy1XB --output-file ps-account-stream3-HTDxQon5FNFfYyu7zP7G2QZwLhNrx6zBmTiBH18Dy1XB.json --output json

# solana account 2cw7ChGDenY7b4jKWvJKn2DeAbRfUyttEbZuaygtAykg --output-file vesting-account-2cw7ChGDenY7b4jKWvJKn2DeAbRfUyttEbZuaygtAykg.json --output json
# solana account A8Xq5znzCZB6fomRn39f1jFzaHjjfnwy2YML6vhejNwU --output-file vesting-account-token-A8Xq5znzCZB6fomRn39f1jFzaHjjfnwy2YML6vhejNwU.json --output json
# solana account 2vARitHbGPkJJyxCrH93JPakQiof9pPizzcD9Z6DJBre --output-file vesting-account-template-2vARitHbGPkJJyxCrH93JPakQiof9pPizzcD9Z6DJBre.json --output json
# solana account JBonFtSeFAEqJzcAK44fS6umQt2d3GVajnG1yaA7bCHf --output-file vesting-account-stream1-JBonFtSeFAEqJzcAK44fS6umQt2d3GVajnG1yaA7bCHf.json --output json
# solana account 4hEwdEdV1LUd4xYo1NGPxFpcT3wJvWyJSEVLB9EQ5vmL --output-file vesting-account-stream2-4hEwdEdV1LUd4xYo1NGPxFpcT3wJvWyJSEVLB9EQ5vmL.json --output json
