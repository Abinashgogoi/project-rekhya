# Project Rekhya Android Verification Agent

This is the technical-PC component of Project Rekhya. It operates the authorized visible Android workflow through ADB, Appium and a physical phone; it does not root the phone, modify the official APK, bypass OTP/CAPTCHA, reset passwords, or guess unreadable values.

## First physical setup

1. Install Android Platform Tools, Android SDK, Node.js and Appium with the UIAutomator2 driver.
2. Enable USB debugging on the phone and authorize the technical PC.
3. Insert or enable SIM 1, install the official insurance app, and confirm internet access.
4. Copy `.env.example` to `.env` outside source control and enter the dedicated technical-officer account plus the official package/activity values.
5. Run `python -m project_rekhya_agent.calibrate` once with the phone connected. Calibration captures the OEM-specific SIM-number screen and official-app element identifiers into `selector-profile.json` without recording passwords.
6. Start the local controller with `project-rekhya-agent`.

After first setup, normal operation is: connect phone, start Appium, open the hosted Project Rekhya dashboard, run Pre-flight, then use Start/Pause/Resume/Retry Pending/Stop Safely.

The agent refuses to start if ADB authorization, SIM 1, app installation, internet, cloud sign-in, evidence storage or the selector profile cannot be verified. Unknown screens and uncertain reads are preserved as evidence and marked Manual Review Required.
