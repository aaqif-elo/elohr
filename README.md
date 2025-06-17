# Elohr

Elohr is a comprehensive SolidStart application for managing employee leave requests, attendance tracking, and contract details. It features a modern web interface built with SolidJS, Discord bot integration for attendance management, and automated reporting capabilities.

## Features

### Core Functionality

- **Employee Management**: User authentication, profile management, and role-based access control
- **Leave Management**: Leave request submission, approval workflows, and tracking
- **Attendance Tracking**: Real-time attendance monitoring with break management
- **Holiday Management**: Holiday announcements and calendar integration
- **Contract Details**: Employee contract information and management

### Discord Integration

- **Bot Commands**: Attendance management, leave requests, and HR functions via Discord
- **Voice Channel Attendance**: Automatic attendance tracking through Discord voice channels
- **Automated Notifications**: Holiday announcements, leave notifications, and daily reports
- **Image Reports**: Automated generation of attendance statistics images

### Advanced Features

- **Weather Reports**: Daily weather updates with AI-generated content
- **Dark Mode Support**: Theme switching for better user experience
- **Mobile Responsive**: Optimized for mobile devices with touch interactions
- **Calendar Integration**: Interactive calendar with long-press functionality
- **Automated Scheduling**: Cron jobs for daily tasks and notifications

## Tech Stack

- **Frontend**: SolidJS with SolidStart framework
- **Styling**: Tailwind CSS with custom themes
- **Database**: Prisma ORM
- **Authentication**: JWT-based authentication
- **Discord Bot**: Discord.js integration
- **Image Generation**: Puppeteer for attendance reports
- **AI Integration**: Gemini 2.0 Flash for weather reports
- **Process Management**: PM2 for deployment
- **Build Tool**: Vite with custom configuration

## Prerequisites

### Development Environment (Windows)

- **Node.js v22** (LTS)
- **pnpm v10.10** - Specific version required for package management
- **MongoDB** - Database connection
- **Discord Bot Token** - For Discord integration
- **Required environment variables** (see `.env.example`)

### Production Environment (Ubuntu/Linux)

- **Ubuntu/Linux server** - The deployment script is designed for Ubuntu
- **PM2** - For process management in production
- **Chrome/Chromium browser** - Required for Puppeteer (image generation)

The following system packages are automatically installed by the deployment script:

- `gconf-service`, `libgbm-dev`, `libasound2` - For Puppeteer browser automation
- `chromium-browser` - Browser engine for report generation
- Various graphics and system libraries for headless browser operation

## Development

> **Note**: The development environment is currently set up for Windows.

Start the development server:

```bash
pnpm run dev
```

The application will be available at `http://localhost:2500`

### Additional Development Commands

```bash
# Generate Prisma client
pnpm run generate

# Build for production (Windows)
pnpm run build
```

## Building & Deployment

### Building (Windows)

Build the production version on your Windows development machine:

```bash
pnpm run build
```

This creates a `elohr.zip` file containing the built application.

### Production Deployment (Ubuntu)

> **Note**: Deployment is designed for Ubuntu/Linux servers.

The deployment process involves:

1. **Build on Windows**: Run `pnpm run build` to generate `elohr.zip`
2. **Transfer files**: Copy the following files to your Ubuntu server:
   - `elohr.zip` (generated build)
   - `deploy.sh` (deployment script)
   - `.env` (production environment variables)
3. **Deploy**: Run the deployment script on the server:
   ```bash
   chmod +x deploy.sh
   ./deploy.sh
   ```

The deployment script automatically handles:
- Stopping the previous PM2 process
- Removing old files
- Extracting the new build
- Installing Node.js v22 and pnpm v10.10 if needed
- Installing system dependencies for Puppeteer
- Installing Chrome/Chromium browser
- Installing npm dependencies
- Starting the application with PM2

### Environment Setup

1. **Development (.env for Windows)**
   ```bash
   cp .env.example .env
   # Configure for development environment
   ```

2. **Production (.env for Ubuntu)**
   - Configure production values
   - Ensure `NODE_ENV='production'`
   - Set correct `FRONTEND_URL`
   - Configure production database connection

## Key Components

- **Authentication System**: JWT-based with role management
- **Attendance Management**: Real-time tracking with break functionality
- **Leave Request System**: Workflow-based approval process
- **Discord Bot Integration**: Command handlers and event management
- **Report Generation**: Automated image and text reports
- **Calendar System**: Interactive date selection and event display

## Configuration

### Environment Variables

Key environment variables include:

- Database connection strings
- Discord bot token and server configuration
- JWT secrets and authentication settings
- API keys for external services

### Discord Bot Configuration

- Voice channel monitoring for attendance
- Role-based command permissions
- Automated cron jobs for daily tasks
- Image generation and report scheduling

## Contributing

Feel free to open issues and submit pull requests. Please:

1. Follow the existing code style and formatting
2. Update documentation for significant changes
3. Follow the changelog format for tracking changes

## Changelog

See [changelog.md](changelog.md) for detailed version history and feature updates.

## License

MIT © [elo](https://elobyte.com)

## Support

For support and questions, please open an issue in the repository or contact the development team.
