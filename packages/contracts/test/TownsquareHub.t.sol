// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {TownsquareHub} from "../src/TownsquareHub.sol";
import {ISemaphore} from "../src/ISemaphore.sol";

contract MockSemaphore is ISemaphore {
    uint256 public groupCounter;
    mapping(uint256 => address) public admins;
    mapping(uint256 => uint256[]) public members;

    function createGroup() external returns (uint256 id) {
        id = groupCounter++;
        admins[id] = msg.sender;
    }

    function addMember(uint256 groupId, uint256 commitment) external {
        require(admins[groupId] == msg.sender, "not admin");
        members[groupId].push(commitment);
    }

    function size(uint256 groupId) external view returns (uint256) {
        return members[groupId].length;
    }
}

contract TownsquareHubTest is Test {
    MockSemaphore semaphore;
    TownsquareHub hub;
    address relayer = makeAddr("relayer");
    address stranger = makeAddr("stranger");

    bytes32 constant CONFIG = keccak256("config");
    bytes32 constant CODE_ROOT = keccak256("codes");

    event Created(uint256 indexed id, uint256 groupId, bytes32 configHash, TownsquareHub.Gate gate, bytes32 codeRoot);
    event MemberAdded(uint256 indexed id, uint256 commitment, uint256 gateNullifier, bytes32 proofHash);
    event BatchAnchored(uint256 indexed id, uint64 batch, bytes32 root, uint64 fromSeq, uint64 toSeq, bytes32 head);
    event Closed(uint256 indexed id, bytes32 finalResultHash);

    function setUp() public {
        semaphore = new MockSemaphore();
        hub = new TownsquareHub(semaphore, relayer);
    }

    function _create() internal returns (uint256) {
        vm.prank(relayer);
        return hub.createConversation(CONFIG, TownsquareHub.Gate.InviteCode, CODE_ROOT);
    }

    function test_createConversation_makesHubGroupAdmin() public {
        vm.expectEmit(true, false, false, true);
        emit Created(1, 0, CONFIG, TownsquareHub.Gate.InviteCode, CODE_ROOT);
        uint256 id = _create();

        assertEq(id, 1);
        (uint256 groupId, bytes32 configHash,, bytes32 codeRoot, uint64 nextSeq,,, bool closed,) = hub.conversations(id);
        assertEq(semaphore.admins(groupId), address(hub));
        assertEq(configHash, CONFIG);
        assertEq(codeRoot, CODE_ROOT);
        assertEq(nextSeq, 1);
        assertFalse(closed);
    }

    function test_onlyRelayerCanWrite() public {
        uint256 id = _create();
        vm.startPrank(stranger);
        vm.expectRevert(TownsquareHub.NotRelayer.selector);
        hub.createConversation(CONFIG, TownsquareHub.Gate.AnonAadhaar, bytes32(0));
        vm.expectRevert(TownsquareHub.NotRelayer.selector);
        hub.addMember(id, 1, 1, bytes32(0));
        vm.expectRevert(TownsquareHub.NotRelayer.selector);
        hub.anchor(id, bytes32(0), 1, 1, bytes32(0));
        vm.expectRevert(TownsquareHub.NotRelayer.selector);
        hub.close(id, bytes32(0));
        vm.stopPrank();
    }

    function test_addMember_recordsNullifierAndAddsToGroup() public {
        uint256 id = _create();
        vm.expectEmit(true, false, false, true);
        emit MemberAdded(id, 111, 7, keccak256("proof"));
        vm.prank(relayer);
        hub.addMember(id, 111, 7, keccak256("proof"));

        assertTrue(hub.gateNullifierUsed(id, 7));
        (uint256 groupId,,,,,,,,) = hub.conversations(id);
        assertEq(semaphore.size(groupId), 1);
    }

    function test_addMember_revertsOnNullifierReuse() public {
        uint256 id = _create();
        vm.startPrank(relayer);
        hub.addMember(id, 111, 7, bytes32(0));
        vm.expectRevert(TownsquareHub.NullifierUsed.selector);
        hub.addMember(id, 222, 7, bytes32(0));
        vm.stopPrank();
    }

    function test_nullifiersAreScopedPerConversation() public {
        uint256 a = _create();
        uint256 b = _create();
        vm.startPrank(relayer);
        hub.addMember(a, 111, 7, bytes32(0));
        hub.addMember(b, 111, 7, bytes32(0));
        vm.stopPrank();
        assertTrue(hub.gateNullifierUsed(b, 7));
    }

    function test_addMember_unknownConversation() public {
        vm.prank(relayer);
        vm.expectRevert(TownsquareHub.UnknownConversation.selector);
        hub.addMember(42, 1, 1, bytes32(0));
    }

    function test_anchor_mustBeContiguous() public {
        uint256 id = _create();
        vm.startPrank(relayer);

        vm.expectRevert(TownsquareHub.NonContiguousBatch.selector);
        hub.anchor(id, keccak256("r"), 2, 5, keccak256("h"));

        vm.expectEmit(true, false, false, true);
        emit BatchAnchored(id, 1, keccak256("r1"), 1, 4, keccak256("h4"));
        hub.anchor(id, keccak256("r1"), 1, 4, keccak256("h4"));

        // no gaps, no rewrites
        vm.expectRevert(TownsquareHub.NonContiguousBatch.selector);
        hub.anchor(id, keccak256("r"), 1, 4, keccak256("h"));
        vm.expectRevert(TownsquareHub.NonContiguousBatch.selector);
        hub.anchor(id, keccak256("r"), 6, 8, keccak256("h"));

        vm.expectEmit(true, false, false, true);
        emit BatchAnchored(id, 2, keccak256("r2"), 5, 5, keccak256("h5"));
        hub.anchor(id, keccak256("r2"), 5, 5, keccak256("h5"));
        vm.stopPrank();

        (,,,, uint64 nextSeq, uint64 batches,,,) = hub.conversations(id);
        assertEq(nextSeq, 6);
        assertEq(batches, 2);
    }

    function test_anchor_rejectsEmptyRange() public {
        uint256 id = _create();
        vm.prank(relayer);
        vm.expectRevert(TownsquareHub.EmptyBatch.selector);
        hub.anchor(id, bytes32(0), 1, 0, bytes32(0));
    }

    function test_close_sealsConversation() public {
        uint256 id = _create();
        bytes32 result = keccak256("result");
        vm.startPrank(relayer);
        vm.expectEmit(true, false, false, true);
        emit Closed(id, result);
        hub.close(id, result);

        vm.expectRevert(TownsquareHub.ConversationClosed.selector);
        hub.addMember(id, 1, 1, bytes32(0));
        vm.expectRevert(TownsquareHub.ConversationClosed.selector);
        hub.anchor(id, bytes32(0), 1, 1, bytes32(0));
        vm.expectRevert(TownsquareHub.ConversationClosed.selector);
        hub.close(id, keccak256("other"));
        vm.stopPrank();

        (,,,,,, bytes32 finalResultHash, bool closed,) = hub.conversations(id);
        assertTrue(closed);
        assertEq(finalResultHash, result);
    }

    function test_setRelayer_onlyOwner() public {
        address next = makeAddr("next");
        vm.prank(stranger);
        vm.expectRevert(TownsquareHub.NotOwner.selector);
        hub.setRelayer(next);

        hub.setRelayer(next);
        assertEq(hub.relayer(), next);

        vm.prank(relayer);
        vm.expectRevert(TownsquareHub.NotRelayer.selector);
        hub.createConversation(CONFIG, TownsquareHub.Gate.InviteCode, CODE_ROOT);
    }

    function test_rejectsZeroAddresses() public {
        vm.expectRevert(TownsquareHub.ZeroAddress.selector);
        new TownsquareHub(semaphore, address(0));
        vm.expectRevert(TownsquareHub.ZeroAddress.selector);
        hub.setRelayer(address(0));
    }

    function testFuzz_anchorSequence(uint8 n, uint8 step) public {
        n = uint8(bound(n, 1, 20));
        step = uint8(bound(step, 1, 50));
        uint256 id = _create();
        uint64 from = 1;
        vm.startPrank(relayer);
        for (uint256 i = 0; i < n; i++) {
            uint64 to = from + step - 1;
            hub.anchor(id, bytes32(i), from, to, bytes32(i));
            from = to + 1;
        }
        vm.stopPrank();
        (,,,, uint64 nextSeq, uint64 batches,,,) = hub.conversations(id);
        assertEq(nextSeq, from);
        assertEq(batches, n);
    }
}
