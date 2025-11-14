# 🏢 Elohr

> **A comprehensive HR management system built with SolidStart, featuring Discord bot integration and automated reporting capabilities.**

## ✨ Features

### 👥 **Employee Management**

- User authentication & role-based access control
- Profile management & contract details

![Admin Portal](https://github.com/aaqif-elo/elohr/blob/main/Screenshots/Admin%20Portal.png)

### 📋 **Attendance Tracking**

- Real-time attendance monitoring with break management
- Voice channel attendance via Discord integration
- Interactive calendar with mobile touch support

![Attendance Tracking](https://github.com/aaqif-elo/elohr/blob/main/Screenshots/Attendance%20Tracking.jpg)

### 📊 **Daily Overview & Reports**

- Automated daily attendance reports
- AI-generated weather updates
- Visual statistics and analytics

<div align="center">
  <img src="https://github.com/aaqif-elo/elohr/blob/main/Screenshots/Daily%20Attendance%20Overview.png" alt="Daily Overview" width="45%" />
  <img src="https://github.com/aaqif-elo/elohr/blob/main/Screenshots/Daily%20Reports.png" alt="Daily Reports" width="45%" />
</div>

### 🤖 **Discord Bot Integration**

- Attendance management via Discord commands
- Automated notifications & holiday announcements
- Voice channel monitoring for attendance

### 🌟 **Additional Features**

- 🎨 Dark mode support
- 📱 Mobile responsive design
- 🗓️ Holiday management
- 🔄 Automated cron jobs

## 🚀 Tech Stack

- **Frontend**: SolidJS with SolidStart framework
- **Styling**: Tailwind CSS with custom themes  
- **Database**: Prisma ORM with MongoDB
- **Authentication**: JWT-based authentication
- **Discord Bot**: Discord.js integration
- **Image Generation**: Puppeteer for attendance reports
- **AI Integration**: Gemini 2.0 Flash for weather reports
- **Process Management**: PM2 for deployment
- **Build Tool**: Vite with custom configuration

## 📋 Prerequisites

> [!IMPORTANT]
> Development environment is currently set up for **Windows**, while deployment targets **Ubuntu/Linux** servers.

### 💻 Development Environment (Windows)

- **Node.js v22** (LTS)
- **pnpm v10.10** - Specific version required for package management
- **MongoDB** - Database connection
- **Discord Bot Token** - For Discord integration
- **Required environment variables** (see `.env.example`)

### 🐧 Production Environment (Ubuntu/Linux)

- **Ubuntu/Linux server** - The deployment script is designed for Ubuntu
- **PM2** - For process management in production
- **Chrome/Chromium browser** - Required for Puppeteer (image generation)

> [!NOTE]
> The following system packages are automatically installed by the deployment script:

> - `gconf-service`, `libgbm-dev`, `libasound2` - For Puppeteer browser automation
> - `chromium-browser` - Browser engine for report generation
> - Various graphics and system libraries for headless browser operation

## 🛠️ Development

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

### 🐳 Containerized Workflow

Use the provided `Dockerfile` to build a portable image without needing a Windows host:

```bash
docker build -t elohr:latest .
```

Run the container with your environment variables (re-use `.env` or craft a dedicated file):

```bash
docker run --env-file .env -p 2500:2500 elohr:latest
```

The container installs pnpm 10.10, runs `prisma generate`, builds the SolidStart app, and starts it with `pnpm start`. Override `PORT` if you expose a different port.

## 🏗️ Building & Deployment

### 💻 Building (Windows)

Build the production version on your Windows development machine:

```bash
pnpm run build
```

> [!TIP]
> This creates a `elohr.zip` file containing the built application ready for deployment.

### 🐧 Production Deployment (Ubuntu)

> [!WARNING]
> Deployment is designed for Ubuntu/Linux servers only.

The deployment process involves:

1. **🔨 Build on Windows**: Run `pnpm run build` to generate `elohr.zip`
2. **📤 Transfer files**: Copy the following files to your Ubuntu server:
   - `elohr.zip` (generated build)
   - `deploy.sh` (deployment script)
   - `.env` (production environment variables)
3. **🚀 Deploy**: Run the deployment script on the server:

   ```bash
   chmod +x deploy.sh
   ./deploy.sh
   ```

> [!NOTE]
> The deployment script automatically handles:

> - Stopping the previous PM2 process
> - Removing old files
> - Extracting the new build
> - Installing Node.js v22 and pnpm v10.10 if needed
> - Installing system dependencies for Puppeteer
> - Installing Chrome/Chromium browser
> - Installing npm dependencies
> - Starting the application with PM2

### ⚙️ Environment Setup

1. **🛠️ Development (.env for Windows)**

   ```bash
   cp .env.example .env
   # Configure for development environment
   ```

2. **🌐 Production (.env for Ubuntu)**
   - Configure production values
   - Ensure `NODE_ENV='production'`
   - Set correct `FRONTEND_URL`
   - Configure production database connection

## 🔧 Key Components

- **🔐 Authentication System**: JWT-based with role management
- **⏰ Attendance Management**: Real-time tracking with break functionality
- **📝 Leave Request System**: Workflow-based approval process
- **🤖 Discord Bot Integration**: Command handlers and event management
- **📊 Report Generation**: Automated image and text reports
- **📅 Calendar System**: Interactive date selection and event display

## ⚙️ Configuration

### 🔐 Environment Variables

Key environment variables include:

- Database connection strings
- Discord bot token and server configuration
- JWT secrets and authentication settings
- API keys for external services

### 🤖 Discord Bot Configuration

- Voice channel monitoring for attendance
- Role-based command permissions
- Automated cron jobs for daily tasks
- Image generation and report scheduling

## 🤝 Contributing

> [!IMPORTANT]
> We welcome contributions! Please follow these guidelines:

1. 🎯 Follow the existing code style and formatting
2. 📚 Update documentation for significant changes
3. 📋 Follow the changelog format for tracking changes

## 📋 Changelog

See [changelog.md](changelog.md) for detailed version history and feature updates.

## 🚀 About Elo

<div align="center">
  <img src="https://elobyte.com/wp-content/uploads/2023/05/LogoWhiteWeb.png" alt="Elo Logo" width="200" />
</div>

Elohr is one of our showcase projects at **elo**, a boutique software development agency specializing in custom solutions for modern businesses.

### 💼 Custom Development Services

If you're impressed by Elohr and need custom software development for your business, I'd love to help! Check out [elobyte.com](https://elobyte.com/) for more details about our services.

### 🛠️ Turnkey Deployment

Don't want the hassle of setting up and maintaining Elohr yourself? We can deploy and manage this exact system for your organization, handling all the technical details so you can focus on your business.

### 🔧 Feature Extensions

Interested in additional features or integrations? We're always open to extending Elohr with:

- Slack integration alongside Discord
- Advanced reporting and analytics
- Custom workflows and automations
- Integration with your existing tools

**Get in touch**: [dev@elobyte.com](mailto:dev@elobyte.com) or reach out to me directly at [aaqif@elobyte.com](mailto:aaqif@elobyte.com)

## �� License

MIT © [elo](https://elobyte.com)

## 💬 Support

> [!NOTE]
> For support and questions, please open an issue in the repository or contact the development team.
