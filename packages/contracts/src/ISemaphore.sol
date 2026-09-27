// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// Subset of the Semaphore V4 interface that TownsquareHub uses.
/// Deployed at 0x8A1fd199516489B0Fb7153EB5f075cDAC83c693D on Base Sepolia.
interface ISemaphore {
    function createGroup() external returns (uint256);

    function addMember(uint256 groupId, uint256 identityCommitment) external;

    function addMembers(uint256 groupId, uint256[] calldata identityCommitments) external;
}
