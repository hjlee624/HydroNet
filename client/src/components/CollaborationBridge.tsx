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

  useEffect(() => {
    let cancelled = false
    clearActiveCollaborationSession()
    if (!entered || !user) return
    if (!runtime || runtime.projectId !== entered.id) {
      useEditor.getState().openCollaborativeProject(entered.id, entered.name)
      return
    }

    void connectProjectCollaboration({
      runtime,
      projectId: entered.id,
      projectGrant: entered.token,
      user,
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
