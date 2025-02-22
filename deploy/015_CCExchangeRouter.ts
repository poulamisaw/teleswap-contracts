import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import config from 'config'
import { BigNumber } from 'ethers';
import verify from "../helper-functions"

require('dotenv').config({path:"../config/temp.env"});

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, network } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    let theBlockHeight = process.env.BLOCK_HEIGHT;
    let theBlockHeightStr = theBlockHeight as string
    let blockHeightBigNumber = BigNumber.from(theBlockHeightStr)

    const protocolPercentageFee = config.get("cc_exchange.protocol_percentage_fee")
    const chainID = config.get("chain_id")
    const bitcoin_network = config.get("bitcoin_network")
    const treasuryAddress = config.get("treasury")
    const bitcoinRelay = config.get("bitcoin_relay");
    
    const lockersProxy = await deployments.get("LockersProxy")
    const teleBTC = await deployments.get("TeleBTC")

    const deployedContract = await deploy("CCExchangeRouter", {
        from: deployer,
        log: true,
        skipIfAlreadyDeployed: true,
        args: [
            blockHeightBigNumber,
            protocolPercentageFee,
            chainID,
            lockersProxy.address,
            bitcoinRelay,
            teleBTC.address,
            treasuryAddress
        ],
    });

    if (network.name != "hardhat" && process.env.ETHERSCAN_API_KEY && process.env.VERIFY_OPTION == "1") {
        await verify(deployedContract.address, [
            blockHeightBigNumber,
            protocolPercentageFee,
            chainID,
            lockersProxy.address,
            bitcoinRelay,
            teleBTC.address,
            treasuryAddress
        ], "contracts/routers/CCExchangeRouter.sol:CCExchangeRouter")
    }
};

export default func;
func.tags = ["CCExchangeRouter"];
