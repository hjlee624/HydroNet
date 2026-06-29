@echo off
chcp 65001 >nul
title HydroNet 마일스톤 JSON 추출

rem === HydroNet 마일스톤 추출 실행기 ===
rem 같은 폴더(또는 바탕화면)의 HydroNet_추출기.html 을 브라우저로 엽니다.
rem 반드시 'HydroNet.html 로 작업하던 그 PC, 그 브라우저' 에서 실행하세요.

set "HTML=%~dp0HydroNet_추출기.html"
if not exist "%HTML%" set "HTML=%USERPROFILE%\Desktop\HydroNet_추출기.html"

if not exist "%HTML%" (
  echo.
  echo  [오류] HydroNet_추출기.html 을 찾지 못했습니다.
  echo         이 배치파일과 'HydroNet_추출기.html' 을 같은 폴더에 두고 다시 실행하세요.
  echo.
  pause
  exit /b 1
)

echo.
echo  ================================================================
echo   HydroNet 마일스톤 추출기를 엽니다.
echo  ----------------------------------------------------------------
echo   1) 반드시 'HydroNet.html 을 열던 그 브라우저'에서 열려야 합니다.
echo      (기본 브라우저가 다르면, 열린 페이지 주소를 복사해 그 브라우저에 붙여넣어 여세요.)
echo   2) 화면의 [가장 최신 프로젝트 JSON 다운로드] 버튼을 누르세요.
echo   3) 다운로드된 .json 파일을 보내주시면 됩니다.
echo  ================================================================
echo.

start "" "%HTML%"

timeout /t 3 >nul
exit /b 0
