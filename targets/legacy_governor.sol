// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
// Demo external target used only to produce the bytecode artifact.
contract LegacyGovernor {
    function step(int256 target, int256 angle, int256 velocity, int256 temp)
        external pure returns (int256, bool, bool)
    {
        bool cooling = temp >= 72000;
        int256 error = target - angle;
        if (temp >= 88000 || error > 45000 || error < -45000) return (0, true, cooling);
        int256 torque = 3 * error - (8 * velocity) / 10;
        if (torque > 100000) torque = 100000;
        else if (torque < -100000) torque = -100000;
        return (torque, false, cooling);
    }
}
