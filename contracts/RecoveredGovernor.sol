// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Demo reconstruction. Angles, temperature and PWM use millidegrees / milliunits.
contract RecoveredGovernor {
    function step(int256 target, int256 angle, int256 velocity, int256 temp)
        external pure returns (int256 pwm, bool estop, bool cooling)
    {
        cooling = temp >= 72000;
        int256 error = target - angle;
        if (temp >= 88000 || error > 45000 || error < -45000) return (0, true, cooling);
        pwm = 3 * error - (8 * velocity) / 10;
        if (pwm > 100000) pwm = 100000;
        if (pwm < -100000) pwm = -100000;
    }
}
