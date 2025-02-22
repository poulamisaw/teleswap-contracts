import { expect } from "chai";
import { deployments, ethers } from "hardhat";
import { Signer, BigNumber } from "ethers";
import { deployMockContract, MockContract } from "@ethereum-waffle/mock-contract";
import { Address } from "hardhat-deploy/types";
import { erc20 } from "../src/types/erc20";
import { Erc20__factory } from "../src/types/factories/Erc20__factory";
import {ERC20} from "../src/types/ERC20";
import {Erc20__factory} from "../src/types/factories/Erc20__factory";
import {TeleBTC} from "../src/types/TeleBTC";
import {TeleBTC__factory} from "../src/types/factories/TeleBTC__factory";
import {InstantRouter} from "../src/types/InstantRouter";
import {InstantRouter__factory} from "../src/types/factories/InstantRouter__factory";
import {InstantPool} from "../src/types/InstantPool";
import {InstantPool__factory} from "../src/types/factories/InstantPool__factory";
import {anyValue} from "@nomicfoundation/hardhat-chai-matchers/withArgs";

import { takeSnapshot, revertProvider } from "./block_utils";

describe("Instant Router", async () => {
    let snapshotId: any;

    // Constants
    let ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
    let ONE_ADDRESS = "0x0000000000000000000000000000000000000011";
    let TWO_ADDRESS = "0x0000000000000000000000000000000000000022";
    let slasherPercentageReward = 5;
    let paybackDeadline = 10; // Means 10 Bitcoin blocks
    let instantPercentageFee = 5; // Means 0.05%
    let collateralizationRatio = 200; // Means 200%

    let maxPriceDifferencePercent = 1000; // Means 10%
    let treasuaryAddress = ONE_ADDRESS;

    // Accounts
    let deployer: Signer;
    let signer1: Signer;
    let signer2: Signer;
    let deployerAddress: Address;
    let signer1Address: Address;

    // Contracts
    let collateralToken: ERC20;
    let teleBTC: TeleBTC;
    let teleBTCInstantPool: InstantPool;
    let instantRouter: InstantRouter;

    // Mock contracts
    let mockExchangeConnector: MockContract;
    let mockBitcoinRelay: MockContract;
    let mockPriceOracle: MockContract;
    let mockCollateralPool: MockContract;
    let mockCollateralPoolFactory: MockContract;

    // Parameters
    let addedLiquidity: number;

    before(async () => {
        // Sets accounts
        [deployer, signer1] = await ethers.getSigners();
        deployerAddress = await deployer.getAddress();
        signer1Address = await signer1.getAddress();

        // Mocks contracts
        const bitcoinRelay = await deployments.getArtifact(
            "IBitcoinRelay"
        );
        mockBitcoinRelay = await deployMockContract(
            deployer,
            bitcoinRelay.abi
        );

        const priceOracle = await deployments.getArtifact(
            "IPriceOracle"
        );
        mockPriceOracle = await deployMockContract(
            deployer,
            priceOracle.abi
        );

        const collateralPool = await deployments.getArtifact(
            "ICollateralPool"
        );
        mockCollateralPool = await deployMockContract(
            deployer,
            collateralPool.abi
        );

        const collateralPoolFactory = await deployments.getArtifact(
            "ICollateralPoolFactory"
        );
        mockCollateralPoolFactory = await deployMockContract(
            deployer,
            collateralPoolFactory.abi
        );

        const exchangeConnector = await deployments.getArtifact(
            "IExchangeConnector"
        );
        mockExchangeConnector = await deployMockContract(
            deployer,
            exchangeConnector.abi
        );

        // Deploys collateralToken and TeleportDAOToken contract
        const erc20Factory = new Erc20__factory(deployer);
        collateralToken = await erc20Factory.deploy(
            "TestToken",
            "TT",
            1000
        );
        const teleBTCFactory = new TeleBTC__factory(deployer);
        teleBTC = await teleBTCFactory.deploy(
            "teleBTC",
            "TBTC"
        );

        // mock finalizationParameter
        await mockBitcoinRelay.mock.finalizationParameter.returns(0);

        // Deploys instant router
        let instantRouterFactory = new InstantRouter__factory(deployer);
        instantRouter = await instantRouterFactory.deploy(
            teleBTC.address,
            mockBitcoinRelay.address,
            mockPriceOracle.address,
            mockCollateralPoolFactory.address,
            slasherPercentageReward,
            paybackDeadline,
            mockExchangeConnector.address,
            maxPriceDifferencePercent,
            treasuaryAddress
        );

        // Deploys bitcoin instant pool
        let instantPoolFactory = new InstantPool__factory(deployer);
        teleBTCInstantPool = await instantPoolFactory.deploy(
            teleBTC.address,
            instantRouter.address,
            instantPercentageFee,
            "TeleBTC-Instant-Pool",
            "TBTCIP"
        );

        // Sets bitcoin instant pool in instant router
        await instantRouter.setTeleBTCInstantPool(teleBTCInstantPool.address);

        // Adds liquidity to instant pool
        addedLiquidity = 100;
        await teleBTC.addMinter(deployerAddress)
        await teleBTC.mint(deployerAddress, 10000000);
        await teleBTC.approve(teleBTCInstantPool.address, addedLiquidity);
        await teleBTCInstantPool.addLiquidity(deployerAddress, addedLiquidity);

    });

    async function getTimestamp(): Promise<number> {
        let lastBlockNumber = await ethers.provider.getBlockNumber();
        let lastBlock = await ethers.provider.getBlock(lastBlockNumber);
        return lastBlock.timestamp;
    }

    async function mockFunctionsCollateralPoolFactory(
        isCollateral: boolean,
        collateralPool: string,
    ): Promise<void> {
        await mockCollateralPoolFactory.mock.isCollateral.returns(
            isCollateral
        );
        await mockCollateralPoolFactory.mock.getCollateralPoolByToken.returns(
            collateralPool
        );
    }

    async function mockFunctionsCollateralPool(
        collateralizationRatio: number,
        requiredCollateralPoolToken: number,
        totalCollateralToken?: number
    ): Promise<void> {
        await mockCollateralPool.mock.collateralizationRatio.returns(
            collateralizationRatio
        );
        await mockCollateralPool.mock.transferFrom.returns(
            true
        );
        await mockCollateralPool.mock.transfer.returns(
            true
        );
        await mockCollateralPool.mock.equivalentCollateralPoolToken.returns(
            requiredCollateralPoolToken
        );
        if (totalCollateralToken != undefined) {
            await mockCollateralPool.mock.equivalentCollateralToken.returns(
                totalCollateralToken
            );
        }
        await mockCollateralPool.mock.addCollateral.returns(
            true
        );
        await mockCollateralPool.mock.removeCollateral.returns(
            true
        );
    }

    async function mockFunctionsPriceOracle(
        outputAmount: number,
    ): Promise<void> {
        await mockPriceOracle.mock.equivalentOutputAmount.returns(
            outputAmount
        );
        // Adds an exchange connector to instant router
        await mockPriceOracle.mock.exchangeConnector.returns(
            mockExchangeConnector.address
        );
    }

    async function mockFunctionsBitcoinRelay(
        lastSubmittedHeight: number,
    ): Promise<void> {
        await mockBitcoinRelay.mock.lastSubmittedHeight.returns(
            lastSubmittedHeight
        );
    }

    async function mockFunctionsExchangeConnector(
        swapResult: boolean,
        amounts: Array<number>,
        inputAmount: number
    ): Promise<void> {
        await mockExchangeConnector.mock.swap.returns(
            swapResult, amounts
        );
        await mockExchangeConnector.mock.getInputAmount.returns(
            swapResult,
            inputAmount
        );
    }

    describe("#instantCCTransfer", async () => {
        // Parameters
        let loanAmount: number;
        let equivalentCollateralToken: number;
        let requiredCollateralPoolToken: number;
        let lastSubmittedHeight: number;
        let isCollateral: boolean;
        let transferFromResult: boolean;

        beforeEach(async () => {
            snapshotId = await takeSnapshot(signer1.provider);
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });

        it("Gives instant loan to user", async function () {
            // Set parameters
            loanAmount = 100;
            equivalentCollateralToken = 50; // Assumes that: 1 collateralToken = 2 teleBTC
            requiredCollateralPoolToken = equivalentCollateralToken*collateralizationRatio; // Assumes that: 1 collateralToken = 1 collateralPoolToken
            lastSubmittedHeight = 100;
            isCollateral = true;
            transferFromResult = true;

            // Mocks functions
            await mockFunctionsCollateralPoolFactory(isCollateral, mockCollateralPool.address);
            await mockFunctionsCollateralPool(collateralizationRatio, requiredCollateralPoolToken);
            await mockFunctionsPriceOracle(equivalentCollateralToken);
            await mockFunctionsBitcoinRelay(lastSubmittedHeight);

            // Gets last block timestamp
            let lastBlockTimestamp = await getTimestamp();

            // Checks that loan has been issued successfully
            await expect(
                await instantRouter.instantCCTransfer(
                    signer1Address,
                    loanAmount,
                    lastBlockTimestamp*2,
                    collateralToken.address
                )
            ).to.emit(instantRouter, "InstantTransfer").withArgs(
                deployerAddress,
                signer1Address,
                loanAmount,
                Math.floor(loanAmount*instantPercentageFee/10000), // Instant fee
                lastSubmittedHeight + paybackDeadline,
                collateralToken.address,
                requiredCollateralPoolToken,
                0
            );

            // Checks that signer1 has received loan amount
            expect(
                await teleBTC.balanceOf(signer1Address)
            ).to.equal(loanAmount);

            expect(
                await instantRouter.getLockedCollateralPoolTokenAmount(deployerAddress, 0)
            ).to.equal(requiredCollateralPoolToken);

            expect(
                await instantRouter.getUserRequestDeadline(deployerAddress, 0)
            ).to.equal(lastSubmittedHeight + paybackDeadline);
            
            await expect(
                instantRouter.getLockedCollateralPoolTokenAmount(deployerAddress, 1)
            ).to.revertedWith("InstantRouter: wrong index");

            await expect(
                instantRouter.getUserRequestDeadline(deployerAddress, 1)
            ).to.revertedWith("InstantRouter: wrong index");
            
        });

        it("Reverts instant transfer since contract is paused", async function () {

            await instantRouter.pause();

            await expect(
                instantRouter.instantCCTransfer(
                    signer1Address,
                    loanAmount,
                    0,
                    collateralToken.address
                )
            ).to.revertedWith("Pausable: paused")
        });

        it("Check unpause for instant transfer", async function () {

            await instantRouter.pause();

            await expect(
                instantRouter.instantCCTransfer(
                    signer1Address,
                    loanAmount,
                    0,
                    collateralToken.address
                )
            ).to.revertedWith("Pausable: paused")

            await instantRouter.unpause();

            await expect(
                instantRouter.instantCCTransfer(
                    signer1Address,
                    loanAmount,
                    0,
                    collateralToken.address
                )
            ).to.revertedWith("InstantRouter: deadline has passed")
        });

        it("Reverts since deadline has paased", async function () {
            // Gets last block timestamp
            let lastBlockTimestamp = await getTimestamp();

            // Checks that loan has been issued successfully
            await expect(
                instantRouter.instantCCTransfer(
                    signer1Address,
                    loanAmount,
                    lastBlockTimestamp - 1,
                    collateralToken.address
                )
            ).to.revertedWith("InstantRouter: deadline has passed")
        });

        it("Reverts since collateral is not acceptable", async function () {
            // Mocks functions
            isCollateral = false;
            await mockFunctionsCollateralPoolFactory(isCollateral, mockCollateralPool.address);

            // Gets last block timestamp
            let lastBlockTimestamp = await getTimestamp();

            // Checks that loan has been issued successfully
            await expect(
                instantRouter.instantCCTransfer(
                    signer1Address,
                    loanAmount,
                    lastBlockTimestamp*2,
                    collateralToken.address
                )
            ).to.revertedWith("InstantRouter: collateral token is not acceptable")
        });

        it("Reverts since instant pool liquidity is not enough", async function () {
            // Set parameters
            loanAmount = 200;
            equivalentCollateralToken = 50; // Assumes that: 1 collateralToken = 2 teleBTC
            requiredCollateralPoolToken = equivalentCollateralToken*collateralizationRatio; // Assumes that: 1 collateralToken = 1 collateralPoolToken
            lastSubmittedHeight = 100;
            isCollateral = true;
            transferFromResult = true;

            // Mocks functions
            await mockFunctionsCollateralPoolFactory(isCollateral, mockCollateralPool.address);
            await mockFunctionsCollateralPool(collateralizationRatio, requiredCollateralPoolToken);
            await mockFunctionsPriceOracle(equivalentCollateralToken);
            await mockFunctionsBitcoinRelay(lastSubmittedHeight);

            // Gets last block timestamp
            let lastBlockTimestamp = await getTimestamp();

            await expect(
                instantRouter.instantCCTransfer(
                    signer1Address,
                    loanAmount,
                    lastBlockTimestamp*2,
                    collateralToken.address
                )
            ).to.revertedWith("InstantPool: liquidity is not sufficient")
        });


        it("Reverts because has reached to max loan number", async function () {
            // Set parameters
            loanAmount = 4;
            equivalentCollateralToken = 50; // Assumes that: 1 collateralToken = 2 teleBTC
            requiredCollateralPoolToken = equivalentCollateralToken*collateralizationRatio; // Assumes that: 1 collateralToken = 1 collateralPoolToken
            lastSubmittedHeight = 100;
            isCollateral = true;
            transferFromResult = true;

            // Mocks functions
            await mockFunctionsCollateralPoolFactory(isCollateral, mockCollateralPool.address);
            await mockFunctionsCollateralPool(collateralizationRatio, requiredCollateralPoolToken);
            await mockFunctionsPriceOracle(equivalentCollateralToken);
            await mockFunctionsBitcoinRelay(lastSubmittedHeight);

            // Gets last block timestamp
            let lastBlockTimestamp = await getTimestamp();

            for (var i = 0; i < 10; i++) {
                await instantRouter.instantCCTransfer(
                    signer1Address,
                    loanAmount,
                    lastBlockTimestamp*2,
                    collateralToken.address
                )
            }

            // Checks that loan has been issued successfully
            await expect(
                instantRouter.instantCCTransfer(
                    signer1Address,
                    loanAmount,
                    lastBlockTimestamp*2,
                    collateralToken.address
                )
            ).to.revertedWith("InstantRouter: reached max loan number")
            
        });

    });

    describe("#instantCCExchange", async () => {

        // Parameters
        let loanAmount: number;
        let amountOut: number;
        let path: Array<string>;
        let isFixedToken: boolean;
        let equivalentCollateralToken: number;
        let requiredCollateralPoolToken: number;
        let lastSubmittedHeight: number;
        let isCollateral: boolean;
        let transferFromResult: boolean;
        let swapResult: boolean;

        beforeEach(async () => {
            snapshotId = await takeSnapshot(signer1.provider);
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });

        it("Gives loan to user and exchanges teleBTC to output token", async function () {
            // Set parameters
            loanAmount = 100;
            amountOut = 10;
            path = [teleBTC.address, collateralToken.address];
            isFixedToken = true;
            equivalentCollateralToken = 50; // Assumes that: 1 collateralToken = 2 teleBTC
            requiredCollateralPoolToken = equivalentCollateralToken*collateralizationRatio; // Assumes that: 1 collateralToken = 1 collateralPoolToken
            lastSubmittedHeight = 100;
            isCollateral = true;
            transferFromResult = true;
            swapResult = true;

            // Mocks functions
            await mockFunctionsCollateralPoolFactory(isCollateral, mockCollateralPool.address);
            await mockFunctionsCollateralPool(collateralizationRatio, requiredCollateralPoolToken);
            await mockFunctionsPriceOracle(equivalentCollateralToken);
            await mockFunctionsBitcoinRelay(lastSubmittedHeight);
            await mockFunctionsExchangeConnector(swapResult, [loanAmount, amountOut], 0);

            // Gets last block timestamp
            let lastBlockTimestamp = await getTimestamp();

            await expect(
                await instantRouter.instantCCExchange(
                    mockExchangeConnector.address,
                    signer1Address,
                    loanAmount,
                    amountOut,
                    path,
                    lastBlockTimestamp*2,
                    collateralToken.address,
                    isFixedToken
                )
            ).to.emit(instantRouter, "InstantExchange").withArgs(
                deployerAddress,
                signer1Address,
                loanAmount,
                Math.floor(loanAmount*instantPercentageFee/10000),
                amountOut,
                path,
                isFixedToken,
                lastSubmittedHeight + paybackDeadline,
                collateralToken.address,
                requiredCollateralPoolToken,
                0
            );
        });

        it("Reverts instant exchange since contract is paused", async function () {

            await instantRouter.pause();

            await expect(
                instantRouter.instantCCExchange(
                    mockExchangeConnector.address,
                    signer1Address,
                    loanAmount,
                    amountOut,
                    path,
                    0,
                    collateralToken.address,
                    isFixedToken
                )
            ).to.revertedWith("Pausable: paused")
        });

        it("Check unpause in instant exchange", async function () {

            await instantRouter.pause();

            await expect(
                instantRouter.instantCCExchange(
                    mockExchangeConnector.address,
                    signer1Address,
                    loanAmount,
                    amountOut,
                    path,
                    0,
                    collateralToken.address,
                    isFixedToken
                )
            ).to.revertedWith("Pausable: paused")

            await instantRouter.unpause();

            await expect(
                instantRouter.instantCCExchange(
                    mockExchangeConnector.address,
                    signer1Address,
                    loanAmount,
                    amountOut,
                    path,
                    0,
                    collateralToken.address,
                    isFixedToken
                )
            ).to.revertedWith("InstantRouter: deadline has passed")
        });

        it("Reverts since deadline has paased", async function () {
            // Gets last block timestamp
            let lastBlockTimestamp = await getTimestamp();

            // Checks that loan has been issued successfully
            await expect(
                instantRouter.instantCCExchange(
                    mockExchangeConnector.address,
                    signer1Address,
                    loanAmount,
                    amountOut,
                    path,
                    lastBlockTimestamp -1,
                    collateralToken.address,
                    isFixedToken
                )
            ).to.revertedWith("InstantRouter: deadline has passed")
        });

        it("Reverts since path is invalid", async function () {
            // Gets last block timestamp
            let lastBlockTimestamp = await getTimestamp();

            // Path's first token is not teleBTC
            await expect(
                instantRouter.instantCCExchange(
                    mockExchangeConnector.address,
                    signer1Address,
                    loanAmount,
                    amountOut,
                    [deployerAddress, collateralToken.address],
                    lastBlockTimestamp*2,
                    collateralToken.address,
                    isFixedToken
                )
            ).to.revertedWith("InstantRouter: path is invalid");
            
            // Path only has one token
            await expect(
                instantRouter.instantCCExchange(
                    mockExchangeConnector.address,
                    signer1Address,
                    loanAmount,
                    amountOut,
                    [teleBTC.address],
                    lastBlockTimestamp*2,
                    collateralToken.address,
                    isFixedToken
                )
            ).to.revertedWith("InstantRouter: path is invalid");
        });

        it("Reverts since instant pool liquidity is not enough", async function () {
            // Set parameters
            loanAmount = 200;
            amountOut = 10;
            path = [teleBTC.address, collateralToken.address];
            isFixedToken = true;
            equivalentCollateralToken = 50; // Assumes that: 1 collateralToken = 2 teleBTC
            requiredCollateralPoolToken = equivalentCollateralToken*collateralizationRatio; // Assumes that: 1 collateralToken = 1 collateralPoolToken
            lastSubmittedHeight = 100;
            isCollateral = true;
            transferFromResult = true;
            swapResult = true;

            // Mocks functions
            await mockFunctionsCollateralPoolFactory(isCollateral, mockCollateralPool.address);
            await mockFunctionsCollateralPool(collateralizationRatio, requiredCollateralPoolToken);
            await mockFunctionsPriceOracle(equivalentCollateralToken);
            await mockFunctionsBitcoinRelay(lastSubmittedHeight);
            await mockFunctionsExchangeConnector(swapResult, [loanAmount, amountOut], 0);

            // Gets last block timestamp
            let lastBlockTimestamp = await getTimestamp();

            await expect(
                instantRouter.instantCCExchange(
                    mockExchangeConnector.address,
                    signer1Address,
                    loanAmount,
                    amountOut,
                    path,
                    lastBlockTimestamp*2,
                    collateralToken.address,
                    isFixedToken
                )
            ).to.revertedWith("InstantPool: liquidity is not sufficient")
        });

        it("Reverts since collateral is not acceptable", async function () {
            // Mocks functions
            isCollateral = false;
            await mockFunctionsCollateralPoolFactory(isCollateral, mockCollateralPool.address);

            // Gets last block timestamp
            let lastBlockTimestamp = await getTimestamp();

            // Checks that loan has been issued successfully
            await expect(
                instantRouter.instantCCExchange(
                    mockExchangeConnector.address,
                    signer1Address,
                    loanAmount,
                    amountOut,
                    path,
                    lastBlockTimestamp*2,
                    collateralToken.address,
                    isFixedToken
                )
            ).to.revertedWith("InstantRouter: collateral token is not acceptable")
        });

        it("Reverts since swap was not successful", async function () {
            // Set parameters
            loanAmount = 100;
            amountOut = 10;
            path = [teleBTC.address, collateralToken.address];
            isFixedToken = true;
            equivalentCollateralToken = 50; // Assumes that: 1 collateralToken = 2 teleBTC
            requiredCollateralPoolToken = equivalentCollateralToken*collateralizationRatio; // Assumes that: 1 collateralToken = 1 collateralPoolToken
            lastSubmittedHeight = 100;
            isCollateral = true;
            transferFromResult = true;
            swapResult = false;

            // Mocks functions
            await mockFunctionsCollateralPoolFactory(isCollateral, mockCollateralPool.address);
            await mockFunctionsCollateralPool(collateralizationRatio, requiredCollateralPoolToken);
            await mockFunctionsPriceOracle(equivalentCollateralToken);
            await mockFunctionsBitcoinRelay(lastSubmittedHeight);
            await mockFunctionsExchangeConnector(swapResult, [], 0);

            // Gets last block timestamp
            let lastBlockTimestamp = await getTimestamp();

            await expect(
                instantRouter.instantCCExchange(
                    mockExchangeConnector.address,
                    signer1Address,
                    loanAmount,
                    amountOut,
                    path,
                    lastBlockTimestamp*2,
                    collateralToken.address,
                    isFixedToken
                )
            ).to.revertedWith("InstantRouter: exchange was not successful");
        });

    });

    describe("#payBackLoan", async () => {
        // Parameters
        let loanAmount: number;
        let equivalentCollateralToken: number;
        let requiredCollateralPoolToken: number;
        let lastSubmittedHeight: number;
        let isCollateral: boolean;
        let transferFromResult: boolean;

        beforeEach(async () => {
            snapshotId = await takeSnapshot(signer1.provider);

            // Set parameters
            loanAmount = 100;
            equivalentCollateralToken = 50; // Assumes that: 1 collateralToken = 2 teleBTC
            requiredCollateralPoolToken = equivalentCollateralToken*collateralizationRatio; // Assumes that: 1 collateralToken = 1 collateralPoolToken
            lastSubmittedHeight = 100;
            isCollateral = true;
            transferFromResult = true;

            // Mocks functions
            await mockFunctionsCollateralPoolFactory(isCollateral, mockCollateralPool.address);
            await mockFunctionsCollateralPool(collateralizationRatio, requiredCollateralPoolToken);
            await mockFunctionsPriceOracle(equivalentCollateralToken);
            await mockFunctionsBitcoinRelay(lastSubmittedHeight);
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });

        it("Paybacks a debt when user has one unpaid debt", async function () {

            // Gets last block timestamp
            let lastBlockTimestamp = await getTimestamp();

            // Creates a debt for deployer
            await instantRouter.instantCCTransfer(
                signer1Address,
                loanAmount,
                lastBlockTimestamp*2,
                collateralToken.address
            );

            // Mints teleBTC for deployer to payback loan
            await teleBTC.mint(deployerAddress, 10000000)
            let instantFee = Math.floor(loanAmount*instantPercentageFee/10000);
            await teleBTC.approve(instantRouter.address, loanAmount + instantFee)

            expect(
                await instantRouter.getUserRequestsLength(
                    deployerAddress
                )
            ).to.equal(1);
            
            // User has one unpaid loan
            expect(
                await teleBTCInstantPool.totalUnpaidLoan()
            ).to.equal(loanAmount + instantFee);

            await expect(
                await instantRouter.payBackLoan(
                    deployerAddress,
                    loanAmount + instantFee
                )
            ).to.emit(instantRouter, "PaybackLoan").withArgs(
                deployerAddress,
                loanAmount + instantFee,
                collateralToken.address,
                requiredCollateralPoolToken,
                0
            );
            
            // User doesn't have any unpaid loan
            expect(
                await instantRouter.getUserRequestsLength(
                    deployerAddress
                )
            ).to.equal(0);

            expect(
                await teleBTCInstantPool.totalUnpaidLoan()
            ).to.equal(0);
        });

        it("Paybacks a debt when user has two unpaid debts", async function () {

            // Gets last block timestamp
            let lastBlockTimestamp = await getTimestamp();

            // Adds more liquidity to instant pool
            await teleBTC.approve(teleBTCInstantPool.address, addedLiquidity);
            await teleBTCInstantPool.addLiquidity(deployerAddress, addedLiquidity);

            // Creates two debts for deployer
            await instantRouter.instantCCTransfer(
                signer1Address,
                loanAmount,
                lastBlockTimestamp*2,
                collateralToken.address
            );
            await instantRouter.instantCCTransfer(
                signer1Address,
                loanAmount,
                lastBlockTimestamp*2,
                collateralToken.address
            );

            // Mints teleBTC for deployer to payback loan
            await teleBTC.mint(deployerAddress, 10000000)
            let instantFee = Math.floor(loanAmount*instantPercentageFee/10000);
            await teleBTC.approve(instantRouter.address, loanAmount + instantFee)

            expect(
                await instantRouter.getUserRequestsLength(
                    deployerAddress
                )
            ).to.equal(2);

            expect(
                await teleBTCInstantPool.totalUnpaidLoan()
            ).to.equal((loanAmount + instantFee)*2);

            await expect(
                await instantRouter.payBackLoan(
                    deployerAddress,
                    loanAmount + instantFee
                )
            ).to.emit(instantRouter, "PaybackLoan").withArgs(
                deployerAddress,
                loanAmount + instantFee,
                collateralToken.address,
                requiredCollateralPoolToken,
                0  
            );

            // User only pays back one of debts
            expect(
                await instantRouter.getUserRequestsLength(
                    deployerAddress
                )
            ).to.equal(1);

            expect(
                await teleBTCInstantPool.totalUnpaidLoan()
            ).to.equal(loanAmount + instantFee);
        });

        it("Paybacks a debt and sends remained amount to user when user has two unpaid debts", async function () {

            // Gets last block timestamp
            let lastBlockTimestamp = await getTimestamp();

            // Adds more liquidity to instant pool
            await teleBTC.approve(teleBTCInstantPool.address, addedLiquidity);
            await teleBTCInstantPool.addLiquidity(deployerAddress, addedLiquidity);

            // Creates two debts for deployer
            await instantRouter.instantCCTransfer(
                signer1Address,
                loanAmount,
                lastBlockTimestamp*2,
                collateralToken.address
            );
            await instantRouter.instantCCTransfer(
                signer1Address,
                loanAmount,
                lastBlockTimestamp*2,
                collateralToken.address
            );

            // Mints teleBTC for deployer to payback loan
            await teleBTC.mint(deployerAddress, 10000000)
            let instantFee = Math.floor(loanAmount*instantPercentageFee/10000);
            await teleBTC.approve(instantRouter.address, loanAmount + loanAmount + instantFee);
            let deployerBalance: BigNumber;
            deployerBalance = await teleBTC.balanceOf(deployerAddress);

            expect(
                await instantRouter.getUserRequestsLength(
                    deployerAddress
                )
            ).to.equal(2);

            expect(
                await teleBTCInstantPool.totalUnpaidLoan()
            ).to.equal(loanAmount + loanAmount + instantFee);

            await expect(
                await instantRouter.payBackLoan(
                    deployerAddress,
                    loanAmount + instantFee
                )
            ).to.emit(instantRouter, "PaybackLoan").withArgs(
                deployerAddress,
                loanAmount + instantFee,
                collateralToken.address,
                requiredCollateralPoolToken,
                0
            );

            // User only pays back one of debts
            expect(
                await instantRouter.getUserRequestsLength(
                    deployerAddress
                )
            ).to.equal(1);

            expect(
                await teleBTCInstantPool.totalUnpaidLoan()
            ).to.equal(loanAmount + instantFee);

            expect(
                await teleBTC.balanceOf(deployerAddress)
            ).to.equal(deployerBalance.toNumber() - loanAmount - instantFee);
        });

        it("Paybacks debts when user has two unpaid debts", async function () {

            // Gets last block timestamp
            let lastBlockTimestamp = await getTimestamp();

            // Adds more liquidity to instant pool
            await teleBTC.approve(teleBTCInstantPool.address, addedLiquidity);
            await teleBTCInstantPool.addLiquidity(deployerAddress, addedLiquidity);

            // Creates two debts for deployer
            await instantRouter.instantCCTransfer(
                signer1Address,
                loanAmount,
                lastBlockTimestamp*2,
                collateralToken.address
            );
            await instantRouter.instantCCTransfer(
                signer1Address,
                loanAmount,
                lastBlockTimestamp*2,
                collateralToken.address
            );

            // Mints teleBTC for deployer to payback loan
            await teleBTC.mint(deployerAddress, 10000000)
            let instantFee = Math.floor(loanAmount*instantPercentageFee/10000);
            await teleBTC.approve(instantRouter.address, 2*(loanAmount + instantFee));

            expect(
                await instantRouter.getUserRequestsLength(
                    deployerAddress
                )
            ).to.equal(2);

            expect(
                await teleBTCInstantPool.totalUnpaidLoan()
            ).to.equal((loanAmount + instantFee)*2);

            await expect(
                await instantRouter.payBackLoan(
                    deployerAddress,
                    2*(loanAmount + instantFee)
                )
            ).to.emit(instantRouter, "PaybackLoan").withArgs(
                deployerAddress,
                loanAmount + instantFee,
                collateralToken.address,
                requiredCollateralPoolToken,
                1
            )

            // User only paybacks one of debts
            expect(
                await instantRouter.getUserRequestsLength(
                    deployerAddress
                )
            ).to.equal(0);

            expect(
                await teleBTCInstantPool.totalUnpaidLoan()
            ).to.equal(0);
        });

        it("Sends teleBTC back to user since payback amount is not enough", async function () {

            // Gets last block timestamp
            let lastBlockTimestamp = await getTimestamp();

            // Creates a debt for deployer
            await instantRouter.instantCCTransfer(
                signer1Address,
                loanAmount,
                lastBlockTimestamp*2,
                collateralToken.address
            );

            // Mints teleBTC for deployer to payback loan
            await teleBTC.mint(deployerAddress, 10000000);
            await teleBTC.approve(instantRouter.address, loanAmount - 1);

            let deployerBalance = await teleBTC.balanceOf(
                deployerAddress
            );

            await expect(
                await instantRouter.payBackLoan(
                    deployerAddress,
                    loanAmount - 1
                )
            ).to.not.emit(instantRouter, "PaybackLoan");

            // Checks that deployer receives its teleBTC
            expect(
                await teleBTC.balanceOf(
                    deployerAddress
                )
            ).to.equal(deployerBalance);
        });

        it("Sends teleBTC back to user since deadline has passed", async function () {

            // Gets last block timestamp
            let lastBlockTimestamp = await getTimestamp();

            // Creates a debt for deployer
            await instantRouter.instantCCTransfer(
                signer1Address,
                loanAmount,
                lastBlockTimestamp*2,
                collateralToken.address
            );

            // Mints teleBTC for deployer to payback loan
            await teleBTC.mint(deployerAddress, 10000000)
            let instantFee = Math.floor(loanAmount*instantPercentageFee/10000);
            await teleBTC.approve(instantRouter.address, loanAmount + instantFee);

            let deployerBalance = await teleBTC.balanceOf(
                deployerAddress
            );

            // Passes payback deadline
            await mockFunctionsBitcoinRelay(lastSubmittedHeight*2);

            await expect(
                await instantRouter.payBackLoan(
                    deployerAddress,
                    loanAmount + instantFee
                )
            ).to.not.emit(instantRouter, "PaybackLoan");

            // Checks that deployer receives its teleBTC
            expect(
                await teleBTC.balanceOf(
                    deployerAddress
                )
            ).to.equal(deployerBalance);
        });

    });

    describe("#slashUser", async () => {
        // Parameters
        let loanAmount: number;
        let loanAmount2: number | undefined;
        let equivalentCollateralToken: number;
        let requiredCollateralPoolToken: number;
        let requiredCollateralPoolToken2: number | undefined;
        let requiredCollateralToken: number;
        let totalCollateralToken: number;
        let lastSubmittedHeight: number;
        let isCollateral: boolean;
        let swapResult: boolean;

        beforeEach(async () => {
            snapshotId = await takeSnapshot(signer1.provider);

            // Set parameters
            loanAmount = 100;
            loanAmount2 = loanAmount;
            equivalentCollateralToken = 50; // Assumes that: 1 collateralToken = 2 teleBTC
            requiredCollateralToken = 25;
            totalCollateralToken = 100;
            requiredCollateralPoolToken = equivalentCollateralToken*collateralizationRatio; // Assumes that: 1 collateralToken = 1 collateralPoolToken
            requiredCollateralPoolToken2 = requiredCollateralPoolToken;
            lastSubmittedHeight = 100;
            isCollateral = true;
            swapResult = true;

            // Mocks functions
            await mockFunctionsCollateralPoolFactory(isCollateral, mockCollateralPool.address);
            await mockFunctionsCollateralPool(collateralizationRatio, requiredCollateralPoolToken, totalCollateralToken);
            await mockFunctionsPriceOracle(equivalentCollateralToken);
            await mockFunctionsBitcoinRelay(lastSubmittedHeight);
            await mockFunctionsExchangeConnector(swapResult, [loanAmount2 , requiredCollateralPoolToken2], requiredCollateralToken);
            await teleBTC.transfer(instantRouter.address, requiredCollateralPoolToken);
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });

        it("Slash user reverted because big gap between dex and oracle", async function () {

            // Gets last block timestamp
            let lastBlockTimestamp = await getTimestamp();

            await collateralToken.transfer(instantRouter.address, totalCollateralToken);

            // Creates a debt for deployer
            await instantRouter.instantCCTransfer(
                signer1Address,
                loanAmount,
                lastBlockTimestamp*2,
                collateralToken.address
            );

            let instantFee = Math.floor(loanAmount*instantPercentageFee/10000);

            expect(
                await instantRouter.getUserRequestsLength(
                    deployerAddress
                )
            ).to.equal(1);

            expect(
                await teleBTCInstantPool.totalUnpaidLoan()
            ).to.equal(loanAmount + instantFee);

            // Passes payback deadline
            await mockFunctionsBitcoinRelay(lastSubmittedHeight*2);

            await mockFunctionsPriceOracle(requiredCollateralToken * 12 / 100);

            await expect(
                instantRouter.slashUser(
                    deployerAddress,
                    0
                )
            ).to.be.revertedWith("InstantRouter: big gap between oracle and AMM price")

            expect(
                await instantRouter.getUserRequestsLength(
                    deployerAddress
                )
            ).to.equal(1);
        });

        it("Slashes user and pays instant loan fully", async function () {

            // Gets last block timestamp
            let lastBlockTimestamp = await getTimestamp();

            await collateralToken.transfer(instantRouter.address, totalCollateralToken);

            // Creates a debt for deployer
            await instantRouter.instantCCTransfer(
                signer1Address,
                loanAmount,
                lastBlockTimestamp*2,
                collateralToken.address
            );

            let instantFee = Math.floor(loanAmount*instantPercentageFee/10000);

            expect(
                await instantRouter.getUserRequestsLength(
                    deployerAddress
                )
            ).to.equal(1);

            expect(
                await teleBTCInstantPool.totalUnpaidLoan()
            ).to.equal(loanAmount + instantFee);

            // Passes payback deadline
            await mockFunctionsBitcoinRelay(lastSubmittedHeight*2);

            await mockFunctionsPriceOracle(requiredCollateralToken);
            
            await expect(
                await instantRouter.slashUser(
                    deployerAddress,
                    0
                )
            ).to.emit(instantRouter, "SlashUser").withArgs(
                deployerAddress, 
                collateralToken.address, 
                // the following amount is the first argument that the swap returns
                loanAmount2, 
                loanAmount + instantFee,
                deployerAddress,
                0,
                0
            )
            

            expect(
                await instantRouter.getUserRequestsLength(
                    deployerAddress
                )
            ).to.equal(0);
        });

        it("Slashes user and pays instant loan partially", async function () {

            // Gets last block timestamp
            let lastBlockTimestamp = await getTimestamp();

            await collateralToken.transfer(instantRouter.address, totalCollateralToken);

            // Creates a debt for deployer
            await instantRouter.instantCCTransfer(
                signer1Address,
                loanAmount,
                lastBlockTimestamp*2,
                collateralToken.address
            );

            let instantFee = Math.floor(loanAmount*instantPercentageFee/10000);

            expect(
                await instantRouter.getUserRequestsLength(
                    deployerAddress
                )
            ).to.equal(1);

            expect(
                await teleBTCInstantPool.totalUnpaidLoan()
            ).to.equal(loanAmount + instantFee);

            // Passes payback deadline
            await mockFunctionsBitcoinRelay(lastSubmittedHeight*2);

            await mockFunctionsExchangeConnector(
                true,
                [totalCollateralToken, totalCollateralToken],
                totalCollateralToken + 1
            )

            await mockFunctionsPriceOracle(totalCollateralToken);

            await expect(
                await instantRouter.slashUser(
                    deployerAddress,
                    0
                )
            ).to.emit(instantRouter, "SlashUser").withArgs(
                deployerAddress, 
                collateralToken.address, 
                totalCollateralToken, 
                loanAmount + instantFee,
                deployerAddress,
                0, // Slasher reward is zero
                0
            );

            expect(
                await instantRouter.getUserRequestsLength(
                    deployerAddress
                )
            ).to.equal(0);
        });

        it("Slashes user and pays instant loan partially (amount from oracle is bigger)", async function () {

            // Gets last block timestamp
            let lastBlockTimestamp = await getTimestamp();

            await collateralToken.transfer(instantRouter.address, totalCollateralToken);

            // Creates a debt for deployer
            await instantRouter.instantCCTransfer(
                signer1Address,
                loanAmount,
                lastBlockTimestamp*2,
                collateralToken.address
            );

            let instantFee = Math.floor(loanAmount*instantPercentageFee/10000);

            expect(
                await instantRouter.getUserRequestsLength(
                    deployerAddress
                )
            ).to.equal(1);

            expect(
                await teleBTCInstantPool.totalUnpaidLoan()
            ).to.equal(loanAmount + instantFee);

            // Passes payback deadline
            await mockFunctionsBitcoinRelay(lastSubmittedHeight*2);

            await mockFunctionsExchangeConnector(
                true,
                [totalCollateralToken, totalCollateralToken],
                totalCollateralToken
            )

            await mockFunctionsPriceOracle(totalCollateralToken + 1);

            await expect(
                await instantRouter.slashUser(
                    deployerAddress,
                    0
                )
            ).to.emit(instantRouter, "SlashUser")

            expect(
                await instantRouter.getUserRequestsLength(
                    deployerAddress
                )
            ).to.equal(0);
        });


        it("Slashes user and pays instant loan partially (high swap result)", async function () {

            // Gets last block timestamp
            let lastBlockTimestamp = await getTimestamp();

            await collateralToken.transfer(instantRouter.address, totalCollateralToken);

            // Creates a debt for deployer
            await instantRouter.instantCCTransfer(
                signer1Address,
                loanAmount,
                lastBlockTimestamp*2,
                collateralToken.address
            );

            let instantFee = Math.floor(loanAmount*instantPercentageFee/10000);

            expect(
                await instantRouter.getUserRequestsLength(
                    deployerAddress
                )
            ).to.equal(1);

            expect(
                await teleBTCInstantPool.totalUnpaidLoan()
            ).to.equal(loanAmount + instantFee);

            // Passes payback deadline
            await mockFunctionsBitcoinRelay(lastSubmittedHeight*2);

            await mockFunctionsExchangeConnector(
                true,
                [totalCollateralToken, 20*totalCollateralToken],
                totalCollateralToken
            )

            await mockFunctionsPriceOracle(totalCollateralToken + 1);

            await expect(
                await instantRouter.slashUser(
                    deployerAddress,
                    0
                )
            ).to.emit(instantRouter, "SlashUser")

            expect(
                await instantRouter.getUserRequestsLength(
                    deployerAddress
                )
            ).to.equal(0);
        });

        it("Reverts since request index is out of range", async function () {
            await expect(
                instantRouter.slashUser(
                    deployerAddress,
                    0
                )
            ).to.revertedWith("InstantRouter: request index does not exist");
        });

        it("Reverts since payback deadline has not passed yet", async function () {

            // Gets last block timestamp
            let lastBlockTimestamp = await getTimestamp();

            await collateralToken.transfer(instantRouter.address, totalCollateralToken);

            // Creates a debt for deployer
            await instantRouter.instantCCTransfer(
                signer1Address,
                loanAmount,
                lastBlockTimestamp*2,
                collateralToken.address
            );

            await mockFunctionsBitcoinRelay(lastSubmittedHeight);

            await expect(
                instantRouter.slashUser(
                    deployerAddress,
                    0
                )
            ).to.revertedWith("InstantRouter: deadline has not passed yet");
        });

        it("Reverts since there's a big gap between price oracle and dex", async function () {

            // Gets last block timestamp
            let lastBlockTimestamp = await getTimestamp();

            await collateralToken.transfer(instantRouter.address, totalCollateralToken);

            // Creates a debt for deployer
            await instantRouter.instantCCTransfer(
                signer1Address,
                loanAmount,
                lastBlockTimestamp*2,
                collateralToken.address
            );

            let instantFee = Math.floor(loanAmount*instantPercentageFee/10000);

            expect(
                await instantRouter.getUserRequestsLength(
                    deployerAddress
                )
            ).to.equal(1);

            expect(
                await teleBTCInstantPool.totalUnpaidLoan()
            ).to.equal(loanAmount + instantFee);

            // Passes payback deadline
            await mockFunctionsBitcoinRelay(lastSubmittedHeight*2);
            await mockFunctionsExchangeConnector(false, [], requiredCollateralToken);

            await expect(
                instantRouter.slashUser(
                    deployerAddress,
                    0
                )
            ).to.revertedWith("InstantRouter: big gap between oracle and AMM price");
        });

        it("Reverts since liquidity pool doesn't exist", async function () {

            // Gets last block timestamp
            let lastBlockTimestamp = await getTimestamp();

            await collateralToken.transfer(instantRouter.address, totalCollateralToken);

            // Creates a debt for deployer
            await instantRouter.instantCCTransfer(
                signer1Address,
                loanAmount,
                lastBlockTimestamp*2,
                collateralToken.address
            );

            let instantFee = Math.floor(loanAmount*instantPercentageFee/10000);

            expect(
                await instantRouter.getUserRequestsLength(
                    deployerAddress
                )
            ).to.equal(1);

            expect(
                await teleBTCInstantPool.totalUnpaidLoan()
            ).to.equal(loanAmount + instantFee);

            // Passes payback deadline
            await mockFunctionsBitcoinRelay(lastSubmittedHeight*2);
            await mockFunctionsExchangeConnector(false, [], 0);

            await expect(
                instantRouter.slashUser(
                    deployerAddress,
                    0
                )
            ).to.revertedWith("InstantRouter: liquidity pool doesn't exist or liquidity is not sufficient");
        });

    });

    describe("#setters", async () => {

        beforeEach(async () => {
            snapshotId = await takeSnapshot(signer1.provider);
        });

        afterEach(async () => {
            await revertProvider(signer1.provider, snapshotId);
        });

        it("Sets slasher percentage reward", async function () {
            await expect(
                await instantRouter.setSlasherPercentageReward(100)
            ).to.emit(
                instantRouter, "NewSlasherPercentageReward"
            ).withArgs(slasherPercentageReward, 100);

            expect(
                await instantRouter.slasherPercentageReward()
            ).to.equal(100);
        })

        it("Reverts since slasher percentage reward is greater than 100", async function () {
            expect(
                instantRouter.setSlasherPercentageReward(101)
            ).to.revertedWith("InstantRouter: wrong slasher percentage reward");
        })

        it("Sets payback deadline", async function () {
            await mockBitcoinRelay.mock.finalizationParameter.returns(1);

            await expect(
                instantRouter.setPaybackDeadline(4)
            ).to.emit(
                instantRouter, "NewPaybackDeadline"
            ).withArgs(paybackDeadline, 4);

            expect(
                await instantRouter.paybackDeadline()
            ).to.equal(4);
        })

        it("Fixes payback deadline", async function () {
            await mockBitcoinRelay.mock.finalizationParameter.returns(10);

            await expect(
                await instantRouter.fixPaybackDeadline()
            ).to.emit(
                instantRouter, "NewPaybackDeadline"
            ).withArgs(paybackDeadline, 21);

            expect(
                await instantRouter.paybackDeadline()
            ).to.equal(21);
        })

        it("can't Fix payback deadline if finalizationParameter is greater than current payback deadline", async function () {
            await instantRouter.setPaybackDeadline(9);
            await mockBitcoinRelay.mock.finalizationParameter.returns(10);

            await expect(
                instantRouter.fixPaybackDeadline()
            ).to.revertedWith("InstantRouter: finalization parameter is not greater than payback deadline");
        })

        it("Reverts since payback deadline is lower than relay finalization parameter", async function () {
            await mockBitcoinRelay.mock.finalizationParameter.returns(2);

            await expect(
                instantRouter.setPaybackDeadline(1)
            ).to.revertedWith("InstantRouter: wrong payback deadline");
        })

        it("Sets relay, lockers, instant router, teleBTC and treasury", async function () {
            await expect(
                await instantRouter.setRelay(ONE_ADDRESS)
            ).to.emit(
                instantRouter, "NewRelay"
            ).withArgs(mockBitcoinRelay.address, ONE_ADDRESS);

            expect(
                await instantRouter.relay()
            ).to.equal(ONE_ADDRESS);

            await expect(
                await instantRouter.setTeleBTC(ONE_ADDRESS)
            ).to.emit(
                instantRouter, "NewTeleBTC"
            ).withArgs(teleBTC.address, ONE_ADDRESS);

            expect(
                await instantRouter.teleBTC()
            ).to.equal(ONE_ADDRESS);

            await expect(
                await instantRouter.setCollateralPoolFactory(ONE_ADDRESS)
            ).to.emit(
                instantRouter, "NewCollateralPoolFactory"
            ).withArgs(mockCollateralPoolFactory.address, ONE_ADDRESS);

            expect(
                await instantRouter.collateralPoolFactory()
            ).to.equal(ONE_ADDRESS);

            await expect(
                await instantRouter.setPriceOracle(ONE_ADDRESS)
            ).to.emit(
                instantRouter, "NewPriceOracle"
            ).withArgs(mockPriceOracle.address, ONE_ADDRESS);

            expect(
                await instantRouter.priceOracle()
            ).to.equal(ONE_ADDRESS);

            await expect(
                await instantRouter.setDefaultExchangeConnector(ONE_ADDRESS)
            ).to.emit(
                instantRouter, "NewDefaultExchangeConnector"
            ).withArgs(mockExchangeConnector.address, ONE_ADDRESS);

            expect(
                await instantRouter.defaultExchangeConnector()
            ).to.equal(ONE_ADDRESS);

            await expect(
                await instantRouter.setTeleBTCInstantPool(ONE_ADDRESS)
            ).to.emit(
                instantRouter, "NewTeleBTCInstantPool"
            ).withArgs(teleBTCInstantPool.address, ONE_ADDRESS);

            expect(
                await instantRouter.teleBTCInstantPool()
            ).to.equal(ONE_ADDRESS);


            await expect(
                await instantRouter.setTreasuaryAddress(TWO_ADDRESS)
            ).to.emit(
                instantRouter, "NewTreasuaryAddress"
            ).withArgs(ONE_ADDRESS, TWO_ADDRESS);

            expect(
                await instantRouter.treasuaryAddress()
            ).to.equal(TWO_ADDRESS);


            await expect(
                await instantRouter.setMaxPriceDifferencePercent(2 * maxPriceDifferencePercent)
            ).to.emit(
                instantRouter, "NewMaxPriceDifferencePercent"
            ).withArgs(maxPriceDifferencePercent, 2 * maxPriceDifferencePercent);

            expect(
                await instantRouter.maxPriceDifferencePercent()
            ).to.equal(2 * maxPriceDifferencePercent);

        })

        it("Reverts since given address is zero", async function () {
            await expect(
                instantRouter.setRelay(ZERO_ADDRESS)
            ).to.revertedWith("InstantRouter: zero address");

            await expect(
                instantRouter.setTeleBTC(ZERO_ADDRESS)
            ).to.revertedWith("InstantRouter: zero address");

            await expect(
                instantRouter.setPriceOracle(ZERO_ADDRESS)
            ).to.revertedWith("InstantRouter: zero address");

            await expect(
                instantRouter.setTeleBTC(ZERO_ADDRESS)
            ).to.revertedWith("InstantRouter: zero address");

            await expect(
                instantRouter.setTeleBTCInstantPool(ZERO_ADDRESS)
            ).to.revertedWith("InstantRouter: zero address");


            await expect(
                instantRouter.setDefaultExchangeConnector(ZERO_ADDRESS)
            ).to.revertedWith("InstantRouter: zero address");

            await expect(
                instantRouter.setCollateralPoolFactory(ZERO_ADDRESS)
            ).to.revertedWith("InstantRouter: zero address");

            await expect(
                instantRouter.setTreasuaryAddress(ZERO_ADDRESS)
            ).to.revertedWith("InstantRouter: zero address");
        })

        it("Reverted because non-owner account is calling ", async function () {

            let instantRouterSigner1 = await instantRouter.connect(signer1);

            await expect(
                instantRouterSigner1.setRelay(ONE_ADDRESS)
            ).to.be.revertedWith("Ownable: caller is not the owner");

            await expect(
                instantRouterSigner1.setTeleBTC(ONE_ADDRESS)
            ).to.be.revertedWith("Ownable: caller is not the owner")

            await expect(
                instantRouterSigner1.setCollateralPoolFactory(ONE_ADDRESS)
            ).to.be.revertedWith("Ownable: caller is not the owner")

            await expect(
                instantRouterSigner1.setPriceOracle(ONE_ADDRESS)
            ).to.be.revertedWith("Ownable: caller is not the owner")

            await expect(
                instantRouterSigner1.setDefaultExchangeConnector(ONE_ADDRESS)
            ).to.be.revertedWith("Ownable: caller is not the owner")

            await expect(
                instantRouterSigner1.setTeleBTCInstantPool(ONE_ADDRESS)
            ).to.be.revertedWith("Ownable: caller is not the owner")

            await expect(
                instantRouterSigner1.setTreasuaryAddress(TWO_ADDRESS)
            ).to.be.revertedWith("Ownable: caller is not the owner")


            await expect(
                instantRouterSigner1.setMaxPriceDifferencePercent(2 * maxPriceDifferencePercent)
            ).to.be.revertedWith("Ownable: caller is not the owner")

            await expect(
                instantRouterSigner1.setPaybackDeadline(2 * maxPriceDifferencePercent)
            ).to.be.revertedWith("Ownable: caller is not the owner")

            await expect(
                instantRouterSigner1.setSlasherPercentageReward(2 * maxPriceDifferencePercent)
            ).to.be.revertedWith("Ownable: caller is not the owner")

            await expect(
                instantRouterSigner1.pause()
            ).to.be.revertedWith("Ownable: caller is not the owner")

            await expect(
                instantRouterSigner1.unpause()
            ).to.be.revertedWith("Ownable: caller is not the owner")

            await expect(
                instantRouterSigner1.renounceOwnership()
            ).to.be.revertedWith("Ownable: caller is not the owner")

            await instantRouter.renounceOwnership()

        })

    });

});