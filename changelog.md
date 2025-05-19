# Changelog

All notable changes to this project are documented below.

## v1.0.0 [2025-05-19]

### Added

- Long press functionality for calendar day selection, with mobile support and improved UI.
- Color-coded stats and new `Legends` enum for attendance overview.
- Announcement indicator and styling for holidays in the calendar.

### Changed

- Weather report formatting updated to use markdown for Discord; AI model upgraded to "gemini-2.0-flash".
- Leave notification now tags `@everyone` in Discord.
- CircularTimeTracking component layout and responsiveness improved.
- Color palettes updated for better theme distinction.
- Attendance highlight colors for absences and holidays improved.
- Holiday and weekend highlight logic in attendance summary enhanced.
- Attendance update logic and history state management streamlined.
- Attendance summary calculations adjusted for accurate date handling.

---

## [2025-05-16]

### Added

- Attendance image report generation now accepts an optional date parameter.
- Auto-logout logic enhanced to include image report generation for the current date.

### Changed

- AttendanceWrapper accepts a date prop for better date management.
- Cron job timing for daily logout changed from 11:55 PM to 11:59 PM.

### Removed

- Unused `actionMessage` state in Home component.

---

## [2025-05-12]

### Added

- Text attendance report generation and queuing for image reports.
- Improved attendance image generation with a queue system.

### Changed

- Discord client global declaration and Puppeteer configuration updated.
- Imports in Discord service cleaned up.
- Dotenv configuration moved to the top of `app.config.ts` for clarity.
- Deployment script enhanced for Node.js and pnpm setup.

---

## [2025-05-11]

### Added

- Support for dark mode in attendance stats image generation.
- Attendance image generation integrated into Discord client ready event.
- Attendance subscription management improved with cleanup and logging.

### Changed

- Attendance image generation refactored for platform-specific browser configuration.

---

## [2025-05-10]

### Added

- Build script and `.gitignore` update to exclude build artifacts.
- Deployment script for elohr using pm2.

### Changed

- Attendance image retrieval now includes admin check.
- Logout report handling streamlined and type safety improved.
- Attendance event emitter enhanced with additional imports.
- Leave request functionality now integrated with Discord notifications.

### Removed

- Unused action tokens and related code.

---

## [2025-05-09]

### Added

- Cron jobs for holiday announcements, user management, and weather report generation.
- Function to retrieve Discord IDs from user IDs.

### Changed

- Weather report format uses placeholders for city, country, date, and emoji.
- Logout logic improved for unended breaks.
- Code formatting improved and new `getUsersOnLeave` function added.

---

## [2025-05-08]

### Added

- Voice channel attendance management and related commands.
- Command handlers for attendance, admin, auth, and leave.
- Holiday announcement features and status management.
- `canBreakOrResume` function and improved attendance break logic.
- Mark upcoming holidays as announced.
- Discord bot client and command registration.
- Discord command enums restored.

### Changed

- HR login interaction now uses JWT for authentication.
- Discord client initialization and event handling reorganized.
- Date handling simplified in utility functions.
- Authentication and user retrieval logic cleaned up.
- Nodemon configuration updated in `package.json`.

---

## [2025-05-07]

### Added

- Discord command implementations for attendance and holiday management.
- Additional Discord commands for HR functionalities.
- Utility functions for date normalization and calculations.
- Puppeteer for attendance stats image generation.

### Changed

- Attendance management functions refactored for clarity.
- Holiday functions refactored to use `normalizeDate` utility.
- Discord client integrated and configuration updated.
- README updated for project name and features.

---

## [Earlier]

- Initial commit and setup.
