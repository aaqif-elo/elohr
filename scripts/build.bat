@echo off
setlocal enabledelayedexpansion

echo === Finding Prisma client file to patch ===
set "PRISMA_CLIENT_FILE="

REM Method 1: Use the direct path since we know it
if exist "node_modules\.pnpm\@prisma+client@6.7.0_prisma_eae679d1c26f2888f88f5407457fe5c5\node_modules\@prisma\client\default.js" (
    set "PRISMA_CLIENT_FILE=node_modules\.pnpm\@prisma+client@6.7.0_prisma_eae679d1c26f2888f88f5407457fe5c5\node_modules\@prisma\client\default.js"
) else (
    REM Method 2: More robust search
    echo Searching for Prisma client file...
    for /d %%d in ("node_modules\.pnpm\@prisma+client@*") do (
        if exist "%%d\node_modules\@prisma\client\default.js" (
            set "PRISMA_CLIENT_FILE=%%d\node_modules\@prisma\client\default.js"
            echo Found candidate: %%d\node_modules\@prisma\client\default.js
        )
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
xcopy /E /I node_modules\.prisma .output\server\node_modules\prisma

echo === Creating zip archive ===
cd .output
if exist ..\elohr.zip del ..\elohr.zip
where /q 7z
if %ERRORLEVEL% EQU 0 (
    7z a -tzip ..\elohr.zip *
) else (
    echo WARNING: 7-Zip not found, using fallback method
    powershell -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('$(Get-Location)', '..\elohr.zip')"
)
cd ..

echo === Build complete! ===
endlocal