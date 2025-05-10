@echo off
setlocal enabledelayedexpansion

echo === Finding Prisma client file to patch ===
set "PRISMA_CLIENT_FILE="

REM Method 1: Use the direct path since we know it
if exist "node_modules\.pnpm\@prisma+client@6.7.0_prisma_eae679d1c26f2888f88f5407457fe5c5\node_modules\@prisma\client\default.js" (
    set "PRISMA_CLIENT_FILE=node_modules\.pnpm\@prisma+client@6.7.0_prisma_eae679d1c26f2888f88f5407457fe5c5\node_modules\@prisma\client\default.js"
) else (
    REM Method 2: More precise for loop pattern
    for /r "node_modules\.pnpm" %%f in (@prisma+client*\node_modules\@prisma\client\default.js) do (
        set "PRISMA_CLIENT_FILE=%%f"
    )
)

if not defined PRISMA_CLIENT_FILE (
    echo ERROR: Could not find Prisma client file
    exit /b 1
)

echo Found Prisma client file: !PRISMA_CLIENT_FILE!

echo === Backing up and patching Prisma client file ===
copy "!PRISMA_CLIENT_FILE!" "!PRISMA_CLIENT_FILE!.bak"
powershell -Command "(Get-Content '!PRISMA_CLIENT_FILE!') -replace \"require\('\.prisma/client/default'\)\", \"require('../../prisma/client/default')\" | Set-Content '!PRISMA_CLIENT_FILE!'"

echo === Cleaning previous build ===
if exist .output rmdir /s /q .output
if exist elohr.zip del elohr.zip

echo === Building with vinxi ===
call vinxi build

echo === Restoring original Prisma client file ===
copy "!PRISMA_CLIENT_FILE!.bak" "!PRISMA_CLIENT_FILE!"
del "!PRISMA_CLIENT_FILE!.bak"

echo === Copying required files ===
copy pnpm-workspace.yaml .output\server\pnpm-workspace.yaml
copy .env .output\.env
xcopy /E /I node_modules\.prisma .output\server\node_modules\.prisma

echo === Creating zip archive ===
cd .output
tar -cf ..\elohr.zip *
cd ..

echo === Build complete! ===
endlocal