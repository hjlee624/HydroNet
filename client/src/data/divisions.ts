// 본부(사업 조직 단위) 목록 + 본부별 심볼(Higgsfield 생성 애셋 /divisions/<key>.png).
// 프로젝트·사용자는 하나의 본부에 속하며, 접근 권한은 같은 본부 기준으로 판정된다(개발자는 전체).
// 서버 검증용 키 목록은 server/src/auth/roles.js 의 DIVISION_KEYS 와 동일하게 유지할 것.

export interface Division {
  key: string
  label: string
  /** 본부 심볼 이미지 경로(public/divisions). 없거나 로드 실패 시 색 원 폴백. */
  icon: string
}

export const DIVISIONS: Division[] = [
  { key: 'strategy', label: '경영전략본부', icon: '/divisions/strategy.png' },
  { key: 'water-env', label: '물환경본부', icon: '/divisions/water-env.png' },
  { key: 'water-res', label: '수자원본부', icon: '/divisions/water-res.png' },
  { key: 'land', label: '국토개발본부', icon: '/divisions/land.png' },
  { key: 'railway', label: '철도본부', icon: '/divisions/railway.png' },
  { key: 'road', label: '도로본부', icon: '/divisions/road.png' },
  { key: 'plant', label: '플랜트본부', icon: '/divisions/plant.png' },
  { key: 'cm', label: 'CM', icon: '/divisions/cm.png' },
  { key: 'overseas', label: '해외사업본부', icon: '/divisions/overseas.png' },
  { key: 'bizdev', label: '사업개발실', icon: '/divisions/bizdev.png' },
  { key: 'safety', label: '안전품질관리실', icon: '/divisions/safety.png' },
]

export const divisionLabel = (key?: string): string =>
  DIVISIONS.find((d) => d.key === key)?.label ?? (key ? key : '')

export const divisionIcon = (key?: string): string =>
  DIVISIONS.find((d) => d.key === key)?.icon ?? ''
