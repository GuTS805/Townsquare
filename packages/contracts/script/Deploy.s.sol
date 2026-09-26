// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {TownsquareHub} from "../src/TownsquareHub.sol";
import {ISemaphore} from "../src/ISemaphore.sol";

// forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
contract Deploy is Script {
    function run() external returns (TownsquareHub hub) {
        uint256 pk = vm.envUint("RELAYER_PRIVATE_KEY");
        address semaphore = vm.envOr("SEMAPHORE_ADDRESS", address(0x8A1fd199516489B0Fb7153EB5f075cDAC83c693D));
        address relayer = vm.addr(pk);

        vm.startBroadcast(pk);
        hub = new TownsquareHub(ISemaphore(semaphore), relayer);
        vm.stopBroadcast();

        console.log("TownsquareHub", address(hub));
        console.log("relayer", relayer);
    }
}
