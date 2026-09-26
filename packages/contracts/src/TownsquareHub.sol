// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ISemaphore} from "./ISemaphore.sol";

/// Owns one Semaphore group per conversation and records what auditors need:
/// gate nullifiers, contiguous log anchors and the final result hash.
contract TownsquareHub {
    enum Gate {
        InviteCode,
        AnonAadhaar
    }

    struct Conversation {
        uint256 groupId;
        bytes32 configHash;
        Gate gate;
        bytes32 codeRoot;
        uint64 nextSeq;
        uint64 batches;
        bytes32 finalResultHash;
        bool closed;
        bool exists;
    }

    ISemaphore public immutable semaphore;
    address public owner;
    address public relayer;
    uint256 public conversationCount;

    mapping(uint256 => Conversation) public conversations;
    mapping(uint256 => mapping(uint256 => bool)) public gateNullifierUsed;

    event Created(uint256 indexed id, uint256 groupId, bytes32 configHash, Gate gate, bytes32 codeRoot);
    event MemberAdded(uint256 indexed id, uint256 commitment, uint256 gateNullifier, bytes32 proofHash);
    event BatchAnchored(uint256 indexed id, uint64 batch, bytes32 root, uint64 fromSeq, uint64 toSeq, bytes32 head);
    event Closed(uint256 indexed id, bytes32 finalResultHash);
    event RelayerChanged(address indexed previous, address indexed current);
    event OwnerChanged(address indexed previous, address indexed current);

    error NotOwner();
    error NotRelayer();
    error UnknownConversation();
    error ConversationClosed();
    error NullifierUsed();
    error NonContiguousBatch();
    error EmptyBatch();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    modifier open(uint256 id) {
        Conversation storage c = conversations[id];
        if (!c.exists) revert UnknownConversation();
        if (c.closed) revert ConversationClosed();
        _;
    }

    constructor(ISemaphore semaphore_, address relayer_) {
        if (address(semaphore_) == address(0) || relayer_ == address(0)) revert ZeroAddress();
        semaphore = semaphore_;
        owner = msg.sender;
        relayer = relayer_;
    }

    function createConversation(bytes32 configHash, Gate gate, bytes32 codeRoot)
        external
        onlyRelayer
        returns (uint256 id)
    {
        id = ++conversationCount;
        uint256 groupId = semaphore.createGroup();
        conversations[id] = Conversation({
            groupId: groupId,
            configHash: configHash,
            gate: gate,
            codeRoot: codeRoot,
            nextSeq: 1,
            batches: 0,
            finalResultHash: bytes32(0),
            closed: false,
            exists: true
        });
        emit Created(id, groupId, configHash, gate, codeRoot);
    }

    function addMember(uint256 id, uint256 commitment, uint256 gateNullifier, bytes32 proofHash)
        external
        onlyRelayer
        open(id)
    {
        if (gateNullifierUsed[id][gateNullifier]) revert NullifierUsed();
        gateNullifierUsed[id][gateNullifier] = true;
        semaphore.addMember(conversations[id].groupId, commitment);
        emit MemberAdded(id, commitment, gateNullifier, proofHash);
    }

    function anchor(uint256 id, bytes32 root, uint64 fromSeq, uint64 toSeq, bytes32 head)
        external
        onlyRelayer
        open(id)
    {
        Conversation storage c = conversations[id];
        if (fromSeq != c.nextSeq) revert NonContiguousBatch();
        if (toSeq < fromSeq) revert EmptyBatch();
        c.nextSeq = toSeq + 1;
        uint64 batch = ++c.batches;
        emit BatchAnchored(id, batch, root, fromSeq, toSeq, head);
    }

    function close(uint256 id, bytes32 finalResultHash) external onlyRelayer open(id) {
        Conversation storage c = conversations[id];
        c.closed = true;
        c.finalResultHash = finalResultHash;
        emit Closed(id, finalResultHash);
    }

    function setRelayer(address r) external onlyOwner {
        if (r == address(0)) revert ZeroAddress();
        emit RelayerChanged(relayer, r);
        relayer = r;
    }

    function transferOwnership(address o) external onlyOwner {
        if (o == address(0)) revert ZeroAddress();
        emit OwnerChanged(owner, o);
        owner = o;
    }
}
