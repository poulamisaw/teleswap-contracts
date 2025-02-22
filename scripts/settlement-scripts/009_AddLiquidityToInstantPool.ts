import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import { ethers } from "hardhat";
import { BigNumber, BigNumberish } from "ethers";
import config from 'config'
const logger = require('node-color-log');
let bitcoinNetwork = config.get("bitcoin_network")

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const {deployments, getNamedAccounts, network} = hre;
    const {deploy, log} = deployments;
    const { deployer } = await getNamedAccounts();

    const one8Dec = BigNumber.from(10).pow(8).mul(1)

    if (bitcoinNetwork == "testnet") {
        logger.color('blue').log("-------------------------------------------------")
        logger.color('blue').bold().log("Add liquidity to instant pool...")

        const teleBTC = await deployments.get("TeleBTC")
        const instantPool = await deployments.get("InstantPool")

        const teleBTCFactory = await ethers.getContractFactory("TeleBTC");
        const teleBTCInstance = await teleBTCFactory.attach(
            teleBTC.address
        );

        const instantPoolFactory = await ethers.getContractFactory("InstantPool");
        const instantPoolInstance = await instantPoolFactory.attach(
            instantPool.address
        );

        const isMinterTeleBTCTx = await teleBTCInstance.minters(deployer)

        if(!isMinterTeleBTCTx) {
            const addMinterTeleBTCTx = await teleBTCInstance.addMinter(deployer)
            await addMinterTeleBTCTx.wait(1)
        }

        const mintTeleBTCTx = await teleBTCInstance.mint(deployer, one8Dec.div(2))
        await mintTeleBTCTx.wait(1)
        console.log("mint telebtc: ", mintTeleBTCTx.hash)

        const approveTeleBTCTx = await teleBTCInstance.approve(
            instantPool.address,
            one8Dec.div(2)
        )
        await approveTeleBTCTx.wait(1)
        console.log("approve instant pool to access to telebtc: ", approveTeleBTCTx.hash)

        const addLiquiditylTx = await instantPoolInstance.addLiquidity(
            deployer,
            one8Dec.div(2)
        )

        await addLiquiditylTx.wait(1)
        console.log("add liquidity to instant pool: ", addLiquiditylTx.hash)

        logger.color('blue').log("-------------------------------------------------")
    }

};

export default func;
// func.tags = ["PriceOracle", "BitcoinTestnet"];
