KoPubWorld Dotum_Pro 폰트 — LAN 화면 적용 안내
================================================

HydroNet은 화면/공정표에 "KoPubWorld Dotum_Pro"를 사용합니다.
 - 제목 / 공종(工種) 이름 : Bold
 - 그 외 모든 텍스트       : Medium

[다른 PC(LAN)에서도 화면에 적용되게 하려면]
아래 OTF 파일 2개를 "정확히 이 파일명으로" 이 폴더에 넣으세요:

    KoPubWorld Dotum_Pro Medium.otf
    KoPubWorld Dotum_Pro Bold.otf
    (KoPubWorld Dotum_Pro Light.otf 는 선택 — 없어도 됨)

→ 그러면 LAN으로 접속한 모든 PC의 "화면"이 자동으로 KoPub로 표시됩니다
   (브라우저가 서버에서 폰트를 내려받음). 서버는 이 폴더를 직접 서빙하므로
   재빌드는 필요 없고, start-lan.bat(또는 node server/src/index.js)만
   다시 실행하면 됩니다.

[중요 — 도면 "출력물"의 글꼴]
브라우저가 SVG를 이미지로 래스터화(PNG/JPG/PDF)할 때는 그 PC에 "설치된"
시스템 폰트만 사용합니다. 따라서 출력물까지 KoPub로 나오게 하려면,
도면을 실제로 뽑는 PC에는 폰트를 "설치"하세요(번들만으로는 출력 미보장).

설치/번들 모두 없으면 'Malgun Gothic'으로 자동 대체됩니다.

내려받기: KoPub World 글꼴 배포처(공공누리, 무료/상업적 사용 가능)에서
"KoPubWorld체 Pro(OTF)"를 받으세요. 파일명이 다르면 위 이름으로 바꿔주세요.
