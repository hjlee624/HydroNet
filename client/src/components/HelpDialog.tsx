// Help / usage guide. A reference of the main features, mouse interactions and
// keyboard shortcuts, shown in the shared animated Modal (Esc / × to close).

import type { ReactNode } from 'react'
import { Modal } from './Modal'

function K({ children }: { children: ReactNode }) {
  return <kbd className="help-kbd">{children}</kbd>
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="도움말 · 사용 방법"
      sub="HydroNet — 댐·양수발전 시공/시운전 마일스톤 공정표"
      width={640}
      onClose={onClose}
    >
      <div className="help">
        <section className="help-sec">
          <h3>한눈에</h3>
          <p>
            왼쪽에서 <b>공종·공정</b>을 구성하고, 가운데 도면에서 바를 드래그해 일정을 잡고
            끝점을 이어 <b>선행–후행(화살표)</b>을 연결합니다. 의존 관계에 따라 전체 공기와
            <b> 주공정(Critical Path)</b>이 실시간 계산되며, 오른쪽 패널에서 세부 속성을, 상단에서
            계산·배율·출력을 다룹니다.
          </p>
        </section>

        <section className="help-sec">
          <h3>도면 위 마우스 조작</h3>
          <ul>
            <li><b>바 이동 · 순서 변경</b> — 공정 바를 드래그(좌우=일정 변경, 위/아래=순서 변경·다른 공종으로 이동). 놓일 위치에 점선 안내선이 표시되고, 사이드바 순서도 함께 바뀝니다</li>
            <li><b>기간 조절</b> — 바를 선택하면 양 끝에 나타나는 핸들을 드래그</li>
            <li><b>연결(화살표)</b> — 바 선택 후 오른쪽 끝의 <b>●</b>를 다른 공정으로 드래그</li>
            <li><b>선택</b> — 바·마일스톤(◆)·화살표를 클릭</li>
            <li><b>이름 바로 편집</b> — 바·마일스톤을 <b>더블클릭</b>하면 그 자리에서 이름 입력(<K>Enter</K> 적용·<K>Esc</K> 취소)</li>
            <li><b>공정 빠른 추가</b> — 빈 레인(공종 영역)을 <b>더블클릭</b>하면 그 위치에 30일짜리 공정이 생기고 바로 이름 입력</li>
            <li><b>글자 편집</b> — 도면의 <b>아무 글자나 클릭</b>하면 그 텍스트(제목·공종·공정·마일스톤·축 등)의 <b>글꼴·크기(pt)·색</b>을 오른쪽에서 조정</li>
            <li><b>CI 로고</b> — 우측 하단. 도면 위 좌하단 모서리 핸들로 크기 조절, 오른쪽 패널 ◀▶ 로 순서 변경</li>
            <li><b>우기 밴드</b> — 양 끝을 드래그해 일(日) 단위로 조절(모든 연도 동시 변동)</li>
          </ul>
        </section>

        <section className="help-sec">
          <h3>캔버스 도구 (포토샵식)</h3>
          <ul>
            <li><K>Z</K> <b>줌 모드</b> — 마우스 휠로 <b>커서 위치 기준</b> 확대/축소</li>
            <li><K>H</K> <b>이동 모드</b> — 화면을 드래그해 스크롤</li>
            <li><K>V</K> 또는 <K>Esc</K> — 일반 편집 모드로 복귀 (현재 모드는 화면 상단 배지로 표시)</li>
            <li>상단 <b>배율</b> 슬라이더·숫자 입력으로 차트 전체를 균일 확대/축소</li>
          </ul>
        </section>

        <section className="help-sec">
          <h3>보기 막대 (차트 위 · 필터·색상·모드)</h3>
          <ul>
            <li><b>필터</b> — <b>주공정만</b> / <b>마일스톤만</b> 칩, <b>이름 검색</b>으로 복잡한 도면에서 원하는 항목만 추림(왼쪽 목록도 같이 추려짐). <b>필터 해제</b>로 전체 복귀</li>
            <li><b>색상</b> — <b>공종색</b>(레인별 색) 또는 <b>주공정 강조</b>(주공정만 빨강·나머지는 회색으로 흐리게)</li>
            <li><b>오늘 선</b> — 시작일 기준 ‘오늘’ 위치에 세로 점선 표시(화면 전용 · 출력에는 안 나옴)</li>
            <li><b>보기 모드</b> — <b>간단</b>(자주 쓰는 기능만) / <b>전문가</b>(모든 기능). 간단 모드에선 일정 정렬·재계산·SVG/DXF·고DPI·주공정 지정 등 고급 항목이 숨겨짐</li>
          </ul>
        </section>

        <section className="help-sec">
          <h3>왼쪽 — 공종 구성</h3>
          <ul>
            <li><b>＋ 공종 / ＋ 공정 / ＋ 마일스톤</b> 으로 항목 추가</li>
            <li><b>순서 · 공종 이동</b> — 공정·마일스톤을 <b>드래그</b>: 같은 공종 안에서 원하는 위치(행 사이)에 놓아 순서 변경, 다른 공종 위에 놓으면 소속 이동. 도면(막대)도 같은 순서로 함께 움직임</li>
            <li><b>표시 ON/OFF</b> — 각 공종·공정 옆 스위치로 도면에 보일 항목만 켜고 끔(맨 위 <b>전체</b> 스위치 포함). 끈 항목은 목록엔 흐리게 남고 도면·출력에서만 빠짐</li>
            <li><b>접기 ▸/▾</b> — 목록만 접음(도면 레인은 항상 그대로 표시)</li>
            <li><b>↑ ↓</b> — 공종 순서 변경</li>
          </ul>
        </section>

        <section className="help-sec">
          <h3>오른쪽 — 공정 속성</h3>
          <ul>
            <li><b>세부공종</b> — 입력하면 도면 좌측 공종명 아래에 세부공종 행으로 묶여 표시</li>
            <li><b>주공정(CP)</b> — <b>자동(CPM)·지정·제외</b> 선택. 주공정은 빨간 바·확대된 빨강 마일스톤·빨강 라벨로 강조</li>
            <li><b>색상 + 즐겨찾기 팔레트</b> — 색을 고르고, 색상/종료일 아래 5×2 팔레트(최대 10)에 ＋ 로 저장·클릭 적용·우클릭 삭제</li>
            <li><b>마일스톤(◆)</b> 토글, 시작일·기간, 주공정 여부·여유(Float) 표시</li>
            <li>선택 해제 상태에선 <b>도면·용지·표시 옵션·제목/CI·우기</b> 설정</li>
          </ul>
        </section>

        <section className="help-sec">
          <h3>일정 계산 · 출력</h3>
          <ul>
            <li><b>연쇄 자동</b> — 선행 공정이 바뀌면 후행 공정이 자동으로 뒤로 이동</li>
            <li><b>일정 정렬</b> — 연결을 위반하는 공정만 뒤로 정렬 · <b>재계산</b> — 전체를 최조기로 재배치. 두 경우 <b>무엇이 바뀌었는지 변경 내역 팝업</b> 표시</li>
            <li><b>도면 출력</b> — SVG·PNG·JPG·PDF, 용지 A4~A0, 가로/세로, <b>DPI 96~600</b>(A4~A2는 600 원본), PNG 배경 투명</li>
            <li><b>전체 화면</b> — 패널을 숨겨 출력 전 미리보기(<K>Esc</K> 종료)</li>
            <li><b>새 도면(템플릿)</b> — 상단 <b>＋ 새 도면</b>에서 댐·양수발전·간단 마일스톤·빈 프로젝트 템플릿을 골라 시작</li>
            <li><b>임시저장 · 불러오기</b> — 작업 내용은 파일명=마일스톤 이름으로 자동 저장. 상단 <b>불러오기</b>로 껐다 켠 뒤 복구</li>
          </ul>
        </section>

        <section className="help-sec">
          <h3>단축키</h3>
          <table className="help-keys">
            <tbody>
              <tr><td><K>Ctrl</K>+<K>S</K></td><td>저장</td></tr>
              <tr><td><K>Ctrl</K>+<K>Z</K> / <K>Ctrl</K>+<K>Y</K></td><td>실행 취소 / 다시 실행</td></tr>
              <tr><td><K>Delete</K> / <K>Backspace</K></td><td>선택한 공정·연결 삭제</td></tr>
              <tr><td><K>Z</K> / <K>H</K></td><td>줌 모드 / 이동 모드</td></tr>
              <tr><td><K>V</K> / <K>Esc</K></td><td>편집 모드 복귀 (Esc는 연결 드래그·줌/이동도 해제)</td></tr>
            </tbody>
          </table>
          <p className="note" style={{ marginTop: 10 }}>
            저장은 자동(서버 또는 브라우저)으로도 이뤄집니다. 글꼴이 화면·출력에 그대로 나오려면
            출력 PC에 KoPubWorld Dotum_Pro 글꼴 설치를 권장합니다.
          </p>
        </section>
      </div>
    </Modal>
  )
}
