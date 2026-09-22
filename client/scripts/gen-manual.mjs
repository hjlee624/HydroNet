// Sequence 사용자·관리자 매뉴얼 PDF 생성기.
//   node client/scripts/gen-manual.mjs
// jsPDF(node) + 맑은고딕(맑은 고딕 Semilight 임베드) + SHOTS/*.png 스크린샷.
//
// ⚠ 스크린샷 재촬영 필요(2026-09-22). SHOTS/ 는 .gitignore 대상(개인 캡처)이라 저장소에
// 없고, 지금 로컬에 있는 8장은 본문보다 낡았다:
//   01_로그인.png · 01_사용자 등록.png · 02_프로젝트 선택.png
//     → 진입 화면이 2026-09-12~14 에 전면 재디자인됨(완전히 다른 화면).
//   05_예정공정표.png · 06_시공 마일스톤.png
//     → 보기 막대의 패널 접기 칩, 우측 [도면 제목] 칸이 없던 시절.
//   03·04_도면 선택.png · 07_CRDT.png → 대체로 유효하나 함께 확인할 것.
// 또한 11~12장(건설사업관리 모듈 · AI 검토)은 아직 그림 없이 글로만 되어 있다.
import fs from 'node:fs'
import { jsPDF } from 'jspdf'

const ROOT = 'D:/2026/PROGRAM/Sequence'
const SHOTS = `${ROOT}/SHOTS`
const OUT = `${ROOT}/Sequence_사용자매뉴얼.pdf`
const DATE = '2026-09-22'

const FONT = 'C:/Windows/Fonts/malgunsl.ttf' // 맑은 고딕 Semilight(임베드 크기 절감)
const ORANGE = [0xfa, 0x51, 0x11]
const INK = [0x22, 0x22, 0x22]
const SLATE = [0x5c, 0x53, 0x46]
const STEEL = [0x85, 0x7a, 0x68]

const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
doc.addFileToVFS('malgun.ttf', fs.readFileSync(FONT).toString('base64'))
doc.addFont('malgun.ttf', 'malgun', 'normal')
doc.setFont('malgun', 'normal')

const PW = 210
const PH = 297
const M = 18
const CW = PW - M * 2
let y = M

function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}
function setColor(c) {
  doc.setTextColor(c[0], c[1], c[2])
}
function ensure(h) {
  if (y + h > PH - M) {
    doc.addPage()
    y = M
  }
}
function heading(num, text, opts = {}) {
  // newPage(기본 true): 이 번호를 새 페이지 최상단에서 시작. false면 이전 섹션과 같은 페이지에 이어붙임.
  const newPage = opts.newPage !== false
  if (newPage) {
    if (y > M) {
      doc.addPage()
      y = M
    }
    y += 2 // 페이지 상단 여백
  } else {
    y += 6 // 같은 페이지 내 이전 섹션과의 간격
    ensure(16)
  }
  doc.setFontSize(15)
  setColor(ORANGE)
  doc.text(`${num}. ${text}`, M, y)
  y += 2.5
  doc.setDrawColor(ORANGE[0], ORANGE[1], ORANGE[2])
  doc.setLineWidth(0.5)
  doc.line(M, y, M + CW, y)
  y += 6
  setColor(INK)
}
function sub(text) {
  ensure(9)
  y += 1.5
  doc.setFontSize(11.5)
  setColor(ORANGE)
  doc.text(text, M, y)
  y += 5.2
  setColor(INK)
}
function para(text, opts = {}) {
  const size = opts.size ?? 10
  const color = opts.color ?? INK
  const lh = opts.lh ?? 5.1
  const indent = opts.indent ?? 0
  doc.setFontSize(size)
  setColor(color)
  for (const ln of doc.splitTextToSize(text, CW - indent)) {
    ensure(lh)
    doc.text(ln, M + indent, y)
    y += lh
  }
}
function bullet(text) {
  const size = 10
  const lh = 5.1
  doc.setFontSize(size)
  setColor(INK)
  const lines = doc.splitTextToSize(text, CW - 6)
  lines.forEach((ln, i) => {
    ensure(lh)
    if (i === 0) {
      setColor(ORANGE)
      doc.text('•', M + 1, y)
      setColor(INK)
    }
    doc.text(ln, M + 6, y)
    y += lh
  })
}
function gap(h = 3) {
  y += h
}
function image(file, caption, opts = {}) {
  const buf = fs.readFileSync(`${SHOTS}/${file}`)
  const { w, h } = pngSize(buf)
  const targetW = opts.maxW ? Math.min(CW, opts.maxW) : CW
  let iw = targetW
  let ih = (targetW * h) / w
  const maxH = PH - M * 2 - 10
  if (ih > maxH) {
    ih = maxH
    iw = (ih * w) / h
  }
  ensure(ih + (caption ? 7 : 0) + 4)
  const x = M + (CW - iw) / 2
  // 이미지 테두리(옅게)
  doc.setDrawColor(0xd9, 0xcf, 0xbc)
  doc.setLineWidth(0.3)
  doc.rect(x, y, iw, ih)
  doc.addImage(`data:image/png;base64,${buf.toString('base64')}`, 'PNG', x, y, iw, ih, undefined, 'FAST')
  y += ih + 2
  if (caption) {
    doc.setFontSize(8.5)
    setColor(STEEL)
    doc.text(caption, PW / 2, y + 2.5, { align: 'center' })
    y += 6.5
    setColor(INK)
  }
  gap(4)
}

// ── 표지 ──────────────────────────────────────────────────────────────────────
doc.setFillColor(0xfb, 0xf1, 0xdf)
doc.rect(0, 0, PW, PH, 'F')
doc.setFontSize(46)
setColor(ORANGE)
doc.text('Sequence', PW / 2, 95, { align: 'center' })
doc.setFontSize(16)
setColor(INK)
doc.text('건설 공정표 관리 시스템', PW / 2, 110, { align: 'center' })
doc.setFontSize(22)
setColor(INK)
doc.text('사용자 · 관리자 매뉴얼', PW / 2, 140, { align: 'center' })
doc.setFontSize(12)
setColor(SLATE)
doc.text('로그인 · 프로젝트 선택부터 공정표 작성 · 도면 출력까지', PW / 2, 152, { align: 'center' })
doc.setDrawColor(ORANGE[0], ORANGE[1], ORANGE[2])
doc.setLineWidth(0.8)
doc.line(PW / 2 - 30, 160, PW / 2 + 30, 160)
doc.setFontSize(10.5)
setColor(STEEL)
doc.text(`대상: 사용자 · 관리자(PM)    ·    ${DATE}`, PW / 2, 255, { align: 'center' })
doc.text('수력부 이현중 (0532)', PW / 2, 263, { align: 'center' })

// ── 본문 시작 ─────────────────────────────────────────────────────────────────
doc.addPage()
y = M

sub('이 매뉴얼에 대하여')
para(
  'Sequence 는 도로·교량·터널·하천·상하수도·항만·철도·단지·수자원(댐) 등 토목 전 분야의 예정공정표와 시공 마일스톤(공정표)을 작성하고, 일정을 자동 계산하며, 도면으로 출력하는 협업 프로그램입니다. 본 매뉴얼은 사용자와 관리자(PM) 관점에서 처음 로그인부터 도면 출력까지의 전 과정을 안내합니다.',
  { lh: 7.2 },
)
gap(2)
bullet('사용자 — 본인에게 배정된 프로젝트에 입장하여 공정표를 작성·편집합니다.')
bullet('관리자(PM) — 소속 본부의 프로젝트를 관리하고, 담당 프로젝트를 편집합니다.')
bullet('본부(조직) 단위로 프로젝트가 나뉘며, 같은 본부의 프로젝트만 보이고 입장할 수 있습니다.')
gap(4)

sub('접속 주소')
para('웹 브라우저(크롬 권장)에서 아래 주소로 접속합니다. 사내망 전용이며, 아이디는 전화번호·비밀번호로 로그인합니다.', { lh: 6.2 })
gap(1)
para('http://10.12.29.180:4020', { size: 13, color: ORANGE, lh: 7 })
gap(2)

heading(1, '로그인 · 계정 등록')
para('아이디는 전화번호(010-0000-0000), 비밀번호로 로그인합니다. 계정이 없으면 로그인 화면의 [사용자 등록]으로 직접 만들 수 있습니다.')
image('01_로그인.png', '[그림 1] 로그인 화면 — 아이디(전화번호) · 비밀번호')
sub('사용자 등록 (로그인 화면 → 사용자 등록)')
bullet('역할 선택 — 사용자 또는 관리자(PM).')
bullet('본부 선택, 이름, 전화번호(아이디), 비밀번호를 입력합니다.')
bullet('비밀번호는 8~12자이고, 영문·숫자·특수기호(!@#$%^&*) 중 2종 이상을 섞어야 합니다.')
bullet('사용자로 등록하면 즉시 로그인할 수 있습니다.')
bullet('관리자(PM)로 등록하면 개발자 승인 후 로그인할 수 있습니다(승인 요청이 개발자에게 전달됩니다).')
bullet('로그인에 5회 실패하면 잠기고, [비밀번호 초기화 요청]이 관리자에게 전달됩니다(관리자가 새 비밀번호를 직접 지정).')
bullet('구 정책(숫자 4자리)으로 만든 계정은 다음 로그인 때 새 비밀번호로 변경해야 합니다.')
gap(1)
image('01_사용자 등록.png', '[그림 2] 사용자 등록 — 역할(사용자/관리자) · 본부 · 이름 · 전화번호 · 비밀번호', { maxW: 82 })

heading(2, '프로젝트 선택')
para('로그인하면 소속 본부의 프로젝트가 카드로 나타납니다. 카드에는 본부 심볼과 역할, 편집 가능 여부가 표시됩니다. 입장할 프로젝트를 클릭하세요.')
image('02_프로젝트 선택.png', '[그림 3] 프로젝트 선택 대시보드 — 본부별 프로젝트 카드')
sub('권한 안내')
bullet('사용자 — 소속 본부의 프로젝트를 볼 수 있으나, 본인에게 배정된 프로젝트만 입장·편집할 수 있습니다.')
bullet('관리자(PM) — 소속 본부의 모든 프로젝트에 입장할 수 있고, 담당(배정된) 프로젝트만 편집할 수 있습니다. 담당이 아닌 프로젝트는 조회 전용으로 열립니다.')
bullet('자물쇠(🔒) 표시가 있는 프로젝트는 입장 시 접속코드가 필요할 수 있습니다(접속코드가 없으면 바로 입장).')
bullet('미할당 프로젝트 카드는 클릭되지 않으며 “미할당”으로 표시됩니다. 입장이 필요하면 관리자에게 배정을 요청하세요.')

heading(3, '새 도면 만들기 (템플릿에서 시작)')
para('프로젝트에 입장한 뒤 상단의 [＋ 새 도면]을 누르면 3단계로 공정표 템플릿을 고를 수 있습니다. 유형만 고르면 표준 공종·공정이 자동으로 세팅되어 빈 화면에서 시작하는 것보다 훨씬 수월합니다.')
gap(1)
bullet('1단계 — 도면 유형: 타당성조사 · 기본설계 · 실시설계 · 시공 중 선택(상단 검색 가능).')
bullet('2단계 — 시설물 유형: 도로·교량·터널·하천·상하수도·항만·철도·단지·지반·댐 등에서 선택(검색 가능).')
bullet('3단계 — 공정표 미리보기: 총 공기·공종 수·주요 마일스톤을 확인하고 [이 템플릿으로 시작]을 누릅니다.')
image('03_도면 선택.png', '[그림 4] 새 도면 1단계 — 도면 유형 선택')
image('04_도면 선택.png', '[그림 5] 새 도면 3단계 — 공정표(샘플) 미리보기 후 시작')
para('주의: 새 도면을 만들면 현재 작업이 템플릿으로 교체됩니다. 저장하지 않은 변경이 있으면 먼저 저장하세요.', { color: SLATE, size: 9.5 })

heading(4, '화면 구성 한눈에 보기')
para('작성 화면은 네 영역으로 구성됩니다. 상단 도구막대, 좌측 공종 구성, 가운데 도면(공정표), 우측 속성 패널이며, 맨 아래에 착수·준공·총 공기 등 요약이 표시됩니다.')
image('05_예정공정표.png', '[그림 6] 작성 화면 — 좌측 공종 구성 / 가운데 도면 / 우측 속성 패널')
bullet('상단 도구막대 — ＋새 도면, 저장, 불러오기, 실행취소/다시실행, 연쇄 자동, 일정 정렬, 재계산, 시운전, 배율, 도움말, 전체 화면, 도면 출력.')
bullet('시트 탭 — [예정공정표] / [시공 마일스톤] 을 전환하며 작업합니다(설계 단계 사업).')
bullet('보기 막대 — 필터(주공정만/마일스톤만/이름 검색), 패널 접기, 색상(공정색/주공정 강조), 단축키 안내.')
bullet('하단 요약 — 착수·준공 날짜, 총 공기(개월/일), 공정·마일스톤·연결·주공정 개수.')
bullet('맨 왼쪽 모듈 레일 — 대시보드·공정관리·진척·실적 등 모듈을 오갑니다. 레일 위쪽 «/» 로 접으면 아이콘만 남습니다.')
sub('화면이 좁게 느껴질 때 — 패널 접기')
para('정보가 많아 도면이 답답하면 세 군데를 접어 도면 폭을 넓힐 수 있습니다. 접은 상태는 이 PC 에 기억되어 다음에 열 때도 그대로입니다.')
bullet('모듈 레일 — 레일 위쪽 «(접기) / »(펼치기). 접어도 아이콘이 남아 모듈 이동은 그대로 됩니다.')
bullet('좌측 공종 구성 — 보기 막대의 [☰ 공종 구성] 칩. 주황색이면 펼쳐진 상태입니다.')
bullet('우측 속성 패널 — 보기 막대의 [⚙ 속성] 칩.')
bullet('셋을 모두 접으면 1600px 화면 기준 도면 영역이 약 850px 에서 1544px 로 넓어집니다.')

heading(5, '공종 · 공정 작성 및 편집')
sub('좌측 “공종 구성”에서 추가')
bullet('[＋ 공종] 으로 공종(레인)을 추가하고, 각 공종의 [＋ 공정] · [＋ 마일스톤] 으로 항목을 추가합니다.')
bullet('공종·공정 이름을 더블클릭하면 그 자리에서 이름을 수정합니다(Enter 적용 · Esc 취소).')
bullet('각 항목의 스위치로 도면 표시 ON/OFF, ↑ ↓ 로 순서 변경, ✕ 로 삭제합니다.')
sub('가운데 도면에서 막대 조작')
bullet('막대를 좌우로 드래그 = 일정(시작일) 변경. 오늘 이전 날짜로도 자유롭게 이동할 수 있습니다.')
bullet('막대를 위/아래로 드래그 = 줄(행) 배치. 다른 막대 줄에 겹치면 같은 줄로 합쳐져 한 패키지를 한 줄로(예: 굴착→성토→포장) 표현합니다.')
bullet('막대를 선택하면 양 끝 핸들이 나타나며, 끝을 드래그해 기간을 조절합니다.')
bullet('막대의 앞·뒤 끝점(●)을 다른 공정으로 드래그하면 선행–후행(화살표)이 연결됩니다. 끝점 조합에 따라 FS·SS·FF·SF 가 자동 결정됩니다.')
bullet('빈 레인을 더블클릭하면 그 위치에 새 공정이 바로 생깁니다. 막대·마일스톤을 더블클릭하면 이름을 즉시 편집합니다.')
sub('일정 자동 계산')
bullet('연쇄 자동 — 선행 공정이 바뀌면 후행 공정이 자동으로 뒤로 밀립니다.')
bullet('일정 정렬 — 연결을 위반하는 공정만 정렬. 재계산 — 전체를 최조기 일정으로 재배치. 변경 내역이 팝업으로 표시됩니다.')
bullet('주공정(Critical Path)은 빨간색으로 강조되어 전체 공기를 좌우하는 핵심 경로를 보여줍니다.')
image('06_시공 마일스톤.png', '[그림 7] 시공 마일스톤 시트 — 공종·세부공종·연결·주공정')
para('상단 [예정공정표 공정 함께 표시] 를 켜면 예정공정표의 공정을 마일스톤 도면에 함께 볼 수 있습니다.', { color: SLATE, size: 9.5 })

heading(6, '공정 속성 (우측 패널)')
para('도면에서 공정(막대)이나 마일스톤을 클릭하면 우측 [공정 속성] 탭에서 세부 항목을 편집할 수 있습니다.')
bullet('이름 · 소속 공종 · 세부공종(선택) · 시작일 · 기간(일).')
bullet('마일스톤(◆)으로 표시 토글, DUMMY(가상·연결) 공정 토글.')
bullet('주공정(CP) — 자동(CPM)/지정/제외 선택. 여유(Float)와 주공정 여부가 함께 표시됩니다.')
bullet('색상 — 색을 고르고 5×2 즐겨찾기 팔레트(최대 10)에 저장·적용할 수 있습니다.')

heading(7, '도면 · 용지 설정 (우측 “도면·프로젝트” 탭)', { newPage: false })
bullet('도면 제목 — 공정표(시트)마다 따로 정합니다. 예정공정표와 시공 마일스톤에 서로 다른 제목을 달 수 있고, 비워 두면 사업명으로 그립니다.')
bullet('프로젝트 착수일(Day 0) — 공정표의 기준 날짜.')
bullet('용지 규격(A4~A0) · 방향(가로/세로), 글자 크기 조절.')
bullet('[용지 비율 + 화면 전체 맞춤] — 읽기 좋은 범위에서 용지 비율을 맞춘 뒤 전체 시트를 화면에 표시합니다.')
bullet('표시 옵션 — 주공정 강조, 행 구분선(가로 격자), 공정명을 왼쪽 표(공종 하위)에 표시.')
bullet('공사기간 구분선 — 연도/월 구분선 표시 및 두께 조절.')

heading(8, '실시간 협업')
para('같은 프로젝트에 여러 명이 동시에 접속해 함께 작업할 수 있습니다. 다른 참여자가 선택하거나 편집 중인 위치에 그 사람의 이름과 역할(관리자/사용자) 배지가 실시간으로 표시됩니다.')
image('07_CRDT.png', '[그림 8] 실시간 협업 — 다른 참여자의 이름·역할 배지 표시')
bullet('편집 권한이 없는 프로젝트(관리자의 비담당 프로젝트 등)는 상단에 “조회 전용” 배너가 뜨며 편집이 제한됩니다.')

heading(9, '저장 · 불러오기')
para('저장은 두 갈래입니다. 서버에 접속해 있으면 편집이 자동으로 서버에 기록되고, 그와 별개로 원하면 작업 파일(.json)을 손으로 백업합니다.')
sub('서버 자동 저장 (협업 프로젝트)')
bullet('편집 내용은 자동으로 서버에 기록됩니다. 상단 저장 칩이 [서버 동기화 완료 · 시:분] 이면 서버가 기록을 확정한 것입니다.')
bullet('[전송 대기…] 는 아직 확정 전, [연결 끊김] · [동기화 오류] · [로컬만 저장] 은 서버에 남지 않은 상태입니다 — 이때는 .json 백업을 받아 두세요.')
bullet('저장 칩 → [⏱ 서버 버전에서 복구…] 에서 지난 버전을 목록·미리보기로 확인하고 되돌릴 수 있습니다(자동 복구는 하지 않습니다).')
sub('파일 백업 (.json)')
bullet('상단 [저장](또는 Ctrl+S)으로 작업 파일(.json)을 원하는 위치에 내려받습니다. 이것은 자동이 아닙니다.')
bullet('상단 [불러오기]로 저장한 .json 파일을 열 수 있습니다(협업 중이면 현재 프로젝트에 반영됩니다).')
bullet('화면 아래 ⚠ [서버 미연결 — 로컬 모드] 배지가 떠 있으면 협업 프로젝트가 아니라 이 PC 에만 남습니다. 반드시 .json 으로 백업하세요.')

heading(10, '도면 출력', { newPage: false })
para('완성한 공정표는 상단 오른쪽 빨간색 [도면 출력] 버튼으로 내보냅니다.')
bullet('형식 — SVG · PNG · JPG · PDF · DXF.')
bullet('용지 A4~A0, 가로/세로, 출력 해상도(DPI) 설정. PNG 배경 투명 지원.')
bullet('[전체 화면]으로 패널을 숨겨 출력 전 미리보기를 할 수 있습니다(Esc 종료).')

heading(11, '건설사업관리 모듈 (왼쪽 레일)')
para('왼쪽 레일에는 공정표 말고도 사업을 관리하는 모듈이 함께 있습니다. 8개 묶음(개요 / 공정 / 사업비 / 자원 / 품질·안전 / 문서·계약 / 준공 / 관리)으로 나뉩니다.')
bullet('대시보드 — 사업 전체 현황을 한 장으로 봅니다.')
bullet('공정관리 — 이 매뉴얼이 지금까지 다룬 공정표 작성 화면입니다.')
bullet('진척·실적 — 실적을 입력하면 계획 대비 진척과 EVM(SPI · CPI) 지표가 계산됩니다.')
bullet('프로젝트 예산 · 공사 사업비 · 인력·장비 · 품질·검측 · 안전관리 · 문서·도면 · 인허가 · 시운전 · 리스크·이슈 — 항목을 표로 기록합니다.')
bullet('변경이력·확정본 — 누가 언제 무엇을 왜 바꿨는지 남고, 확정본(baseline)을 박제해 현재 공정표와 비교합니다.')
bullet('보고서 — 위 기록을 자동으로 모아 출력합니다.')
sub('기록을 공정에 묶기 (앵커)')
para('각 기록에는 “어느 공정의 이야기인지”를 지정할 수 있습니다. 묶어 두면 공정표에서 그 공정을 볼 때 관련 기록이 함께 보이고, 반대로 기록에서 공정을 찾아갈 수 있습니다. 공정이 삭제되면 그 기록은 고아로 표시되어 조용히 사라지지 않습니다.')

heading(12, 'AI 검토 요청 · 반영', { newPage: false })
para('작성한 공정표를 외부 AI 에게 검토시키고, 돌아온 의견을 다시 공정표에 반영할 수 있습니다.')
bullet('내보내기 — 공정표를 검토 요청서(.md)로 내려받아 사용하는 AI 서비스에 그대로 붙여넣습니다.')
bullet('반영 — AI 가 돌려준 검토본(.md)을 다시 올리면, 검증을 통과한 기간 변경만 한 번에 반영됩니다.')
bullet('반영하지 못한 항목은 사유와 함께 목록으로 보여 줍니다. 말없이 넘어가지 않습니다.')
bullet('반영은 실행취소(Ctrl+Z) 한 번으로 통째로 되돌릴 수 있습니다.')
para('주의: 공정표에는 사업명·공정명이 들어 있습니다. 외부 AI 서비스에 올리기 전에 사내 정보 취급 기준을 확인하세요.', { color: SLATE, size: 9.5 })

heading(13, '관리자(PM) 가이드', { newPage: false })
sub('새 프로젝트 만들기')
bullet('프로젝트 선택 화면의 [＋ 새 프로젝트]로 생성합니다. 관리자는 본인 소속 본부로 자동 지정됩니다.')
bullet('접속코드는 선택 사항입니다. 비우면 배정된 인원이 코드 없이 바로 입장합니다.')
sub('멤버 관리 · 담당 지정')
bullet('프로젝트 카드의 인원(👥) 버튼으로 참여 인원을 보고, 사용자·관리자를 추가/삭제합니다.')
bullet('프로젝트에 배정(멤버 추가)된 사람만 그 프로젝트를 편집할 수 있습니다(담당). 배정하지 않으면 같은 본부라도 조회만 가능합니다.')
sub('권한 요약')
bullet('관리자 — 소속 본부 전 프로젝트 입장(담당은 편집, 그 외 조회 전용), 프로젝트 생성·멤버 관리.')
bullet('사용자 — 배정된 프로젝트만 입장·편집.')

heading(14, '자주 묻는 질문 · 팁', { newPage: false })
bullet('로그인이 안 돼요 — 아이디는 전화번호(010########)입니다. 관리자로 등록한 경우 개발자 승인 후 로그인됩니다.')
bullet('프로젝트가 안 보여요 — 본인 본부의 프로젝트만 표시됩니다. 입장하려면 해당 프로젝트에 배정(멤버 추가)되어 있어야 합니다.')
bullet('편집이 안 돼요 — 상단에 “조회 전용” 배너가 있으면 편집 권한이 없는 것입니다. 담당(배정) 요청을 관리자에게 하세요.')
bullet('막대를 왼쪽 끝까지 못 옮겼는데 — 이제 프로젝트 착수일 이전(더 이른 날짜)으로도 자유롭게 이동됩니다. 필요하면 우측에서 착수일을 조정하세요.')
bullet('글자가 잘려요 — 우측 [도면·프로젝트] 탭에서 글자 크기를 조절하거나 [여백 없이 시트에 맞추기]를 사용하세요.')
bullet('저장을 깜빡했어요 — 서버에 접속해 있으면 편집은 자동으로 서버에 기록됩니다(저장 칩이 [서버 동기화 완료]인지 확인). 다만 .json 파일 백업은 자동이 아니니, 서버 미연결 배지가 떠 있을 때는 반드시 [저장](Ctrl+S)하세요.')
bullet('화면에 정보가 너무 많아요 — 보기 막대의 [☰ 공종 구성] · [⚙ 속성] 칩과 왼쪽 레일의 « 로 접으면 도면이 두 배 가까이 넓어집니다.')
bullet('두 공정표 제목이 똑같아요 — 우측 [도면·프로젝트] 탭의 [도면 제목]은 공정표마다 따로 정합니다. 시트를 바꾼 뒤 각각 입력하세요.')

// 페이지 번호 푸터(표지 제외)
const total = doc.getNumberOfPages()
for (let p = 2; p <= total; p++) {
  doc.setPage(p)
  doc.setFontSize(8.5)
  setColor(STEEL)
  doc.text('Sequence 사용자 · 관리자 매뉴얼', M, PH - 8)
  doc.text(`${p - 1}`, PW - M, PH - 8, { align: 'right' })
}

fs.writeFileSync(OUT, Buffer.from(doc.output('arraybuffer')))
const kb = Math.round(fs.statSync(OUT).size / 1024)
console.log(`생성: ${OUT} (${kb} KB, ${total} 페이지)`)
