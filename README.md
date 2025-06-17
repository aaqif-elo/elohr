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

Before running this project, make sure you have:

- **Node.js v22** (LTS) - The deployment script specifically installs and uses Node.js 22
- **pnpm v10.10** - Specific version required for package management
- **MongoDB** - Database (based on the MongoDB dependency in package.json)
- **Discord Bot Token** - For Discord integration
- **Chrome/Chromium browser** - Required for Puppeteer (image generation)
- **PM2** - For process management in production
- **Required environment variables** (see `.env` example)

### Additional System Dependencies (Linux/Production)

The following system packages are automatically installed by the deployment script:

- `gconf-service`, `libgbm-dev`, `libasound2` - For Puppeteer browser automation
- `chromium-browser` - Browser engine for report generation
- Various graphics and system libraries for headless browser operation

## Setup

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd elohr
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   ```

3. **Environment Configuration**
   - Copy `.env.example` to `.env`
   - Configure your database connection
   - Add Discord bot token and other required variables

4. **Database Setup**

   ```bash
   pnpm prisma generate
   pnpm prisma db push
   ```

5. **Discord Bot Setup**
   - Create a Discord application and bot
   - Add the bot to your server with required permissions
   - Configure voice channel and role settings

## Development

Start the development server:

```bash
pnpm run dev
```

The application will be available at `http://localhost:3000`

### Additional Development Commands

```bash
# Run database migrations
pnpm prisma migrate dev

# View database in Prisma Studio
pnpm prisma studio

# Run type checking
pnpm run typecheck

# Run linting
pnpm run lint
```

## Building & Deployment

Build the production version:

```bash
pnpm run build
```

Preview the production build locally:

```bash
pnpm run preview
```

### Production Deployment

The project includes deployment scripts for production environments:

```bash
# Deploy using the included script
./deploy.sh
```

The deployment script handles:

- Node.js and pnpm setup
- Dependency installation
- Database migrations
- PM2 process management
- Environment configuration

### Platform Deployment

Deploy your build according to your platform:

- **Node.js**: Use PM2 or similar process manager
- **Vercel**: Connect your repository for automatic deployments
- **Netlify**: Configure build settings for SolidStart
- **VPS/Server**: Use the included deployment script

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
2. Add tests for new features
3. Update documentation for significant changes
4. Follow the changelog format for tracking changes

## Changelog

See [changelog.md](changelog.md) for detailed version history and feature updates.

## License

MIT © [elo](https://elobyte.com)

## Support

For support and questions, please open an issue in the repository or contact the development team.
