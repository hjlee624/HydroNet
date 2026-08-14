@echo off
setlocal
cd /d "%~dp0"
if not defined PORT set PORT=4020
if not defined HOST set HOST=0.0.0.0

REM --- First run: install dependencies and build the client (served by the server) ---
if not exist "client\dist\index.html" (
  echo [Sequence] First run: installing dependencies and building the client...
  echo            ^(This may take a few minutes^)
  call npm --prefix client install
  call npm --prefix server install
  call npm --prefix client run build
)

REM --- Detect this PC's LAN IPv4 address ---
for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "$ip = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1 -ExpandProperty IPAddress; if ($ip) { $ip }"`) do set LAN_IP=%%i

echo.
echo Sequence backend will listen on all network interfaces (port %PORT%).
echo Local: http://127.0.0.1:%PORT%/
if defined LAN_IP echo LAN:   http://%LAN_IP%:%PORT%/
echo.
echo If another PC cannot open the LAN URL, allow TCP port %PORT% in Windows Defender Firewall:
echo   netsh advfirewall firewall add rule name="Sequence %PORT%" dir=in action=allow protocol=TCP localport=%PORT%
echo.

node "server\src\index.js"
pause
