import { useEffect, useState } from 'react'
import { useAuth } from '../state/authStore'
import {
  clearActiveCollaborationSession,
  connectProjectCollaboration,
  publishPresenceSelection,
  setActiveCollaborationSession,
  usePresence,
} from '../state/collaboration'
import {
  getCurrentCrdtRuntime,
  type ProjectCrdtRuntime,
  subscribeProjectCrdtRuntime,
} from '../state/crdt'
import { useEditor } from '../state/store'

/** Lifecycle-only bridge: collaboration transport and presence never enter the Project model. */
export function CollaborationBridge() {
  const entered = useAuth((state) => state.entered)
  const user = useAuth((state) => state.user)
  const selectedTaskIds = useEditor((state) => state.selectedTaskIds)
  const selectedCategoryIds = useEditor((state) => state.selectedCategoryIds)
  const selectedLinkId = useEditor((state) => state.selectedLinkId)
  const [runtime, setRuntime] = useState<ProjectCrdtRuntime | null>(() => getCurrentCrdtRuntime())

  useEffect(() => subscribeProjectCrdtRuntime((next) => setRuntime(next)), [])

  useEffect(() => {
    publishPresenceSelection({ selectedTaskIds, selectedCategoryIds, selectedLinkId })
  }, [selectedTaskIds, selectedCategoryIds, selectedLinkId])

  // 편집 권한 없이 입장(같은 본부 PM 조회 등)하면 조회 전용 — 모든 변경 차단(+WS 읽기전용).
  useEffect(() => {
    useEditor.getState().setReadOnly(!!entered && entered.canEdit === false)
  }, [entered])

  useEffect(() => {
    let cancelled = false
    clearActiveCollaborationSession()
    if (!entered || !user) return
    if (!runtime || runtime.projectId !== entered.id) {
      useEditor.getState().openCollaborativeProject(entered.id, entered.name)
      return
    }

    // 프로젝트 역할 → presence 표시 역할: 개발자·PM = 관리자, 그 외 = 사용자.
    const presenceRole =
      entered.projRole === 'developer' || entered.projRole === 'pm' || user.role === 'developer'
        ? 'admin'
        : 'user'
    void connectProjectCollaboration({
      runtime,
      projectId: entered.id,
      projectGrant: entered.token,
      user: { id: user.id, name: user.name, role: presenceRole },
    })
      .then((session) => {
        if (cancelled) {
          session.destroy()
          return
        }
        setActiveCollaborationSession(session)
        const selection = useEditor.getState()
        publishPresenceSelection({
          selectedTaskIds: selection.selectedTaskIds,
          selectedCategoryIds: selection.selectedCategoryIds,
          selectedLinkId: selection.selectedLinkId,
        })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        usePresence.setState({
          status: 'error',
          remote: [],
          error: error instanceof Error ? error.message : 'Collaboration connection failed.',
        })
      })

    return () => {
      cancelled = true
      clearActiveCollaborationSession()
    }
  }, [entered, runtime, user])

  return null
}
