import type { PetriNet, Transition, Arc } from '@/types/petri-net'
import type { AnalysisResult, AnalysisIssue, AnalysisDetailItem, CoverabilityGraph, CoverabilityNode, CoverabilityEdge } from '@/types/analysis'
import { IssueCodes } from '@/types/analysis'
import { computeStatistics } from './statistics'
import {
  effectiveInputLogic,
  effectiveOutputLogic,
  getInputArcs,
  getOutputArcs,
} from '@/utils/operatorSemantics'

// Maximum number of states to explore to prevent infinite loops
const MAX_STATES = 1000

// Synthetic short-circuit transition (t*) connecting the sink place back to the
// source place. This is the classic van der Aalst construction: a workflow net
// is sound iff its short-circuited net is live and bounded.
const TSTAR_ID = '__tstar__'

/**
 * Analyzes soundness of a workflow net, mirroring the semantics of the legacy
 * Java WoPeD (`AbstractQualanalysisService.isSound()`):
 *
 *   sound  ⟺  isWorkflowNet
 *             ∧ initial marking correct (source = 1 token, others = 0)
 *             ∧ short-circuited net (N + t*) is bounded
 *             ∧ no dead transitions (in N)
 *             ∧ short-circuited net (N + t*) is live
 *
 * Liveness of the short-circuited net subsumes "option to complete" and
 * "proper completion": t* is live iff the final marking is always reachable,
 * and boundedness rules out leftover tokens.
 */
export function analyzeSoundness(net: PetriNet): AnalysisResult {
  const startTime = performance.now()
  const issues: AnalysisIssue[] = []
  const statistics = computeStatistics(net)

  // Check for empty net
  if (net.places.length === 0) {
    issues.push({
      severity: 'error',
      code: IssueCodes.ST001,
      message: 'Cannot analyze soundness of an empty net',
      messageKey: 'analysis.issues.sn.emptyNet',
      affectedElements: [],
    })

    return {
      timestamp: Date.now(),
      type: 'soundness',
      valid: false,
      issues,
      statistics,
      duration: performance.now() - startTime,
    }
  }

  // ----- 1. Workflow-net property (prerequisite for soundness) -----
  const wf = checkWorkflowNetProperty(net, statistics)
  if (!wf.isWorkflowNet) {
    issues.push({
      severity: 'error',
      code: IssueCodes.SN007,
      message: 'The net is not a workflow net, so it cannot be sound.',
      messageKey: 'analysis.issues.sn.notWorkflowNet',
      affectedElements: wf.affectedElements,
      details: wf.reasons.join(' '),
      detailItems: wf.reasonItems,
    })
  }

  const sourceId = statistics.sourcePlaces.length === 1 ? statistics.sourcePlaces[0] : null
  const sinkId = statistics.sinkPlaces.length === 1 ? statistics.sinkPlaces[0] : null

  // ----- 2. Initial marking (source must carry exactly one token) -----
  if (sourceId) {
    const wronglyMarked = findWronglyMarkedPlaces(net, sourceId)
    if (wronglyMarked.length > 0) {
      issues.push({
        severity: 'error',
        code: IssueCodes.SN006,
        message: `Found ${wronglyMarked.length} place(s) with an incorrect initial marking.`,
        messageKey: 'analysis.issues.sn.wrongMarking',
        messageParams: { count: wronglyMarked.length },
        affectedElements: wronglyMarked,
        details:
          'A sound workflow net starts with exactly one token in the source place and no tokens elsewhere.',
        detailsKey: 'analysis.issues.sn.wrongMarkingDetails',
      })
    }
  }

  const initialMarking = getInitialMarking(net)

  // ----- 3.–5. Behavioral checks -----
  // Dead transitions are evaluated on the plain net N (without t*).
  const plainGraph = buildCoverabilityGraph(net, initialMarking)
  const deadTransitions = computeDeadTransitions(net, plainGraph)
  if (deadTransitions.length > 0) {
    issues.push({
      severity: 'error',
      code: IssueCodes.SN002,
      message: `Found ${deadTransitions.length} dead transition(s) that can never fire.`,
      messageKey: 'analysis.issues.sn.deadTransitions',
      messageParams: { count: deadTransitions.length },
      affectedElements: deadTransitions,
      details:
        'Dead transitions indicate unreachable parts of the workflow or modeling errors.',
      detailsKey: 'analysis.issues.sn.deadTransitionsDetails',
    })
  }

  if (sourceId && sinkId) {
    // Boundedness and liveness are evaluated on the short-circuited net N + t*.
    const shortCircuited = buildShortCircuitNet(net, sourceId, sinkId)
    const scGraph = buildCoverabilityGraph(shortCircuited, initialMarking)

    // Boundedness: any ω marking means the net is unbounded (→ unsound).
    const unboundedPlaces = findUnboundedPlaces(scGraph, net)
    if (unboundedPlaces.length > 0) {
      issues.push({
        severity: 'error',
        code: IssueCodes.SN003,
        message: `Found ${unboundedPlaces.length} unbounded place(s). The net is not bounded.`,
        messageKey: 'analysis.issues.sn.unbounded',
        messageParams: { count: unboundedPlaces.length },
        affectedElements: unboundedPlaces,
        details: 'Unbounded places are marked with ω (omega) in the coverability graph.',
        detailsKey: 'analysis.issues.sn.unboundedDetails',
      })
    }

    // Liveness of the short-circuited net.
    const transitionIds = [
      ...shortCircuited.transitions.map((t) => t.id),
      ...shortCircuited.operators.map((o) => o.id),
    ]
    const nonLive = computeNonLiveTransitions(scGraph, transitionIds)

    // t* non-live ⟺ the final marking is not always reachable (no option to complete).
    if (nonLive.has(TSTAR_ID)) {
      issues.push({
        severity: 'error',
        code: IssueCodes.SN004,
        message: 'Not all reachable states have an option to complete.',
        messageKey: 'analysis.issues.sn.noOptionToComplete',
        affectedElements: [],
        details:
          'Some execution paths can never reach the final marking (deadlock or livelock).',
        detailsKey: 'analysis.issues.sn.noOptionToCompleteDetails',
      })
    }

    // Real transitions that are not live but are not already reported as dead.
    const deadSet = new Set(deadTransitions)
    const nonLiveReal = [...nonLive].filter(
      (id) => id !== TSTAR_ID && !deadSet.has(id)
    )
    if (nonLiveReal.length > 0) {
      issues.push({
        severity: 'error',
        code: IssueCodes.SN005,
        message: `Found ${nonLiveReal.length} non-live transition(s).`,
        messageKey: 'analysis.issues.sn.nonLive',
        messageParams: { count: nonLiveReal.length },
        affectedElements: nonLiveReal,
        details:
          'A transition is live if, from every reachable marking, it can eventually fire again. Non-live transitions break soundness.',
        detailsKey: 'analysis.issues.sn.nonLiveDetails',
      })
    }
  }

  const endTime = performance.now()
  const valid = issues.filter((i) => i.severity === 'error').length === 0

  return {
    timestamp: Date.now(),
    type: 'soundness',
    valid,
    issues,
    statistics,
    duration: endTime - startTime,
  }
}

/**
 * Check the structural workflow-net property (mirrors the legacy
 * `StructuralAnalysis.isWorkflowNet()`): exactly one source place, exactly one
 * sink place, no source/sink transitions, no isolated nodes, all arc weights
 * equal to 1, and strong connectivity of the short-circuited net.
 */
function checkWorkflowNetProperty(
  net: PetriNet,
  statistics: ReturnType<typeof computeStatistics>
): {
  isWorkflowNet: boolean
  reasons: string[]
  reasonItems: AnalysisDetailItem[]
  affectedElements: string[]
} {
  const reasons: string[] = []
  const reasonItems: AnalysisDetailItem[] = []
  const affected = new Set<string>()

  const SN = 'analysis.issues.sn.'
  const add = (reason: string, key: string, params?: Record<string, string | number>) => {
    reasons.push(reason)
    reasonItems.push(params ? { key, params } : { key })
  }

  if (statistics.sourcePlaces.length !== 1) {
    add(
      `Expected exactly one source place, found ${statistics.sourcePlaces.length}.`,
      `${SN}reasonSourceCount`,
      { count: statistics.sourcePlaces.length }
    )
    statistics.sourcePlaces.forEach((id) => affected.add(id))
  }
  if (statistics.sinkPlaces.length !== 1) {
    add(
      `Expected exactly one sink place, found ${statistics.sinkPlaces.length}.`,
      `${SN}reasonSinkCount`,
      { count: statistics.sinkPlaces.length }
    )
    statistics.sinkPlaces.forEach((id) => affected.add(id))
  }
  if (statistics.sourceTransitions.length > 0) {
    add(
      `Found ${statistics.sourceTransitions.length} transition(s) without input places.`,
      `${SN}reasonSourceTransitions`,
      { count: statistics.sourceTransitions.length }
    )
    statistics.sourceTransitions.forEach((id) => affected.add(id))
  }
  if (statistics.sinkTransitions.length > 0) {
    add(
      `Found ${statistics.sinkTransitions.length} transition(s) without output places.`,
      `${SN}reasonSinkTransitions`,
      { count: statistics.sinkTransitions.length }
    )
    statistics.sinkTransitions.forEach((id) => affected.add(id))
  }

  const isolated = findIsolatedNodes(net)
  if (isolated.length > 0) {
    add(
      `Found ${isolated.length} isolated node(s).`,
      `${SN}reasonIsolated`,
      { count: isolated.length }
    )
    isolated.forEach((id) => affected.add(id))
  }

  const weightViolations = net.arcs.filter((a) => a.weight !== 1).map((a) => a.id)
  if (weightViolations.length > 0) {
    add(
      `Found ${weightViolations.length} arc(s) with weight ≠ 1.`,
      `${SN}reasonArcWeights`,
      { count: weightViolations.length }
    )
    weightViolations.forEach((id) => affected.add(id))
  }

  // Strong connectivity is only meaningful with a unique source and sink.
  const sourceId = statistics.sourcePlaces.length === 1 ? statistics.sourcePlaces[0] : null
  const sinkId = statistics.sinkPlaces.length === 1 ? statistics.sinkPlaces[0] : null
  if (sourceId && sinkId) {
    if (!isStronglyConnectedWithTStar(net, sourceId, sinkId)) {
      add(
        'The short-circuited net is not strongly connected.',
        `${SN}reasonNotStronglyConnected`
      )
    }
  }

  return {
    isWorkflowNet: reasons.length === 0,
    reasons,
    reasonItems,
    affectedElements: [...affected],
  }
}

/**
 * Build the short-circuited net N + t*, adding a transition that consumes a
 * token from the sink place and produces one in the source place.
 */
function buildShortCircuitNet(net: PetriNet, sourceId: string, sinkId: string): PetriNet {
  const tstar: Transition = { id: TSTAR_ID, name: 't*', position: { x: 0, y: 0 } }
  const inArc: Arc = {
    id: '__tstar_in__',
    sourceId: sinkId,
    targetId: TSTAR_ID,
    weight: 1,
    waypoints: [],
  }
  const outArc: Arc = {
    id: '__tstar_out__',
    sourceId: TSTAR_ID,
    targetId: sourceId,
    weight: 1,
    waypoints: [],
  }
  return {
    ...net,
    transitions: [...net.transitions, tstar],
    arcs: [...net.arcs, inArc, outArc],
  }
}

/**
 * Places whose initial marking deviates from the canonical workflow marking
 * (source place must hold exactly one token; every other place must be empty).
 */
function findWronglyMarkedPlaces(net: PetriNet, sourceId: string): string[] {
  const wrong: string[] = []
  for (const place of net.places) {
    if (place.id === sourceId) {
      if (place.tokens !== 1) wrong.push(place.id)
    } else if (place.tokens !== 0) {
      wrong.push(place.id)
    }
  }
  return wrong
}

/**
 * Transitions that never fire in the reachability/coverability graph.
 */
function computeDeadTransitions(net: PetriNet, graph: CoverabilityGraph): string[] {
  const fired = new Set(graph.edges.map((e) => e.transitionId))
  const all = [...net.transitions.map((t) => t.id), ...net.operators.map((o) => o.id)]
  return all.filter((id) => !fired.has(id))
}

/**
 * Determine non-live transitions on a coverability graph.
 * A transition is live iff, from every reachable marking, there is a path to a
 * marking in which it is enabled. Implemented as: a transition is live iff every
 * graph node can reach a node where that transition fires.
 */
function computeNonLiveTransitions(
  graph: CoverabilityGraph,
  transitionIds: string[]
): Set<string> {
  const total = graph.nodes.length
  const predecessors = new Map<string, Set<string>>()
  for (const node of graph.nodes) predecessors.set(node.id, new Set())

  const fireNodes = new Map<string, Set<string>>()
  for (const id of transitionIds) fireNodes.set(id, new Set())

  for (const edge of graph.edges) {
    predecessors.get(edge.to)?.add(edge.from)
    fireNodes.get(edge.transitionId)?.add(edge.from)
  }

  const nonLive = new Set<string>()

  for (const t of transitionIds) {
    const sources = fireNodes.get(t)!
    if (sources.size === 0) {
      nonLive.add(t)
      continue
    }

    // Backward BFS: which nodes can reach a node where t fires?
    const canReach = new Set<string>(sources)
    const queue = [...sources]
    while (queue.length > 0) {
      const current = queue.shift()!
      for (const pred of predecessors.get(current) ?? []) {
        if (!canReach.has(pred)) {
          canReach.add(pred)
          queue.push(pred)
        }
      }
    }

    if (canReach.size !== total) nonLive.add(t)
  }

  return nonLive
}

/**
 * Nodes with no incoming and no outgoing arcs.
 */
function findIsolatedNodes(net: PetriNet): string[] {
  const isolated: string[] = []
  const nodes = [
    ...net.places.map((p) => p.id),
    ...net.transitions.map((t) => t.id),
    ...net.operators.map((o) => o.id),
  ]
  for (const id of nodes) {
    const hasIncoming = net.arcs.some((arc) => arc.targetId === id)
    const hasOutgoing = net.arcs.some((arc) => arc.sourceId === id)
    if (!hasIncoming && !hasOutgoing) isolated.push(id)
  }
  return isolated
}

/**
 * Structural strong-connectivity check of the short-circuited net N + t*.
 */
function isStronglyConnectedWithTStar(
  net: PetriNet,
  sourceId: string,
  sinkId: string
): boolean {
  const nodes = [
    ...net.places.map((p) => p.id),
    ...net.transitions.map((t) => t.id),
    ...net.operators.map((o) => o.id),
    TSTAR_ID,
  ]
  if (nodes.length <= 1) return false

  const forward = new Map<string, Set<string>>()
  const backward = new Map<string, Set<string>>()
  for (const id of nodes) {
    forward.set(id, new Set())
    backward.set(id, new Set())
  }

  const addEdge = (from: string, to: string) => {
    forward.get(from)?.add(to)
    backward.get(to)?.add(from)
  }

  for (const arc of net.arcs) addEdge(arc.sourceId, arc.targetId)
  // t* edges
  addEdge(sinkId, TSTAR_ID)
  addEdge(TSTAR_ID, sourceId)

  const reachable = (adjacency: Map<string, Set<string>>): number => {
    const visited = new Set<string>()
    const queue = [nodes[0]]
    visited.add(nodes[0])
    while (queue.length > 0) {
      const current = queue.shift()!
      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) {
          visited.add(next)
          queue.push(next)
        }
      }
    }
    return visited.size
  }

  return reachable(forward) === nodes.length && reachable(backward) === nodes.length
}

/**
 * Get initial marking from net
 */
function getInitialMarking(net: PetriNet): Record<string, number> {
  const marking: Record<string, number> = {}
  for (const place of net.places) {
    if (place.tokens > 0) {
      marking[place.id] = place.tokens
    }
  }
  return marking
}

/**
 * Build coverability graph
 */
export function buildCoverabilityGraph(
  net: PetriNet,
  initialMarking: Record<string, number>
): CoverabilityGraph {
  const nodes: CoverabilityNode[] = []
  const edges: CoverabilityEdge[] = []
  const visited = new Map<string, CoverabilityNode>()

  // Find sink places for final marking check
  const sinkPlaces = net.places.filter(
    (p) => !net.arcs.some((arc) => arc.sourceId === p.id)
  )

  // Create initial node
  const initial: CoverabilityNode = {
    id: 'M0',
    marking: { ...initialMarking },
    isDeadlock: false,
    isInitial: true,
    isFinal: checkFinalMarking(initialMarking, sinkPlaces.map((p) => p.id)),
  }

  nodes.push(initial)
  visited.set(markingKey(initial.marking), initial)

  const queue = [initial]
  let stateCount = 0

  while (queue.length > 0 && stateCount < MAX_STATES) {
    const current = queue.shift()!
    stateCount++

    // Get enabled transitions
    const enabled = getEnabledTransitions(net, current.marking)

    if (enabled.length === 0) {
      current.isDeadlock = true
    }

    for (const transitionId of enabled) {
      // Get transition name (shared across all firing modes of this node)
      const transition =
        net.transitions.find((t) => t.id === transitionId) ||
        net.operators.find((o) => o.id === transitionId)

      // Each firing mode (e.g. one per XOR branch) yields its own successor.
      for (const mode of getFiringModes(net, current.marking, transitionId)) {
        const newMarking = applyFiringMode(current.marking, mode)

        // Check for omega (unboundedness)
        checkAndApplyOmega(newMarking, nodes, current)

        const key = markingKey(newMarking)
        let targetNode = visited.get(key)

        if (!targetNode) {
          targetNode = {
            id: `M${nodes.length}`,
            marking: newMarking,
            parentId: current.id,
            firedTransition: transitionId,
            isDeadlock: false,
            isInitial: false,
            isFinal: checkFinalMarking(newMarking, sinkPlaces.map((p) => p.id)),
          }
          nodes.push(targetNode)
          visited.set(key, targetNode)
          queue.push(targetNode)
        }

        edges.push({
          from: current.id,
          to: targetNode.id,
          transitionId,
          transitionName: transition?.name || transitionId,
        })
      }
    }
  }

  return {
    nodes,
    edges,
    bounded: !hasOmega(nodes),
    deadlockNodes: nodes.filter((n) => n.isDeadlock).map((n) => n.id),
    reachableFinalStates: nodes.filter((n) => n.isFinal).length,
  }
}

/**
 * Get enabled transitions for a marking
 */
function getEnabledTransitions(
  net: PetriNet,
  marking: Record<string, number | 'omega'>
): string[] {
  const enabled: string[] = []
  const allTransitions = [...net.transitions, ...net.operators]

  for (const transition of allTransitions) {
    if (isTransitionEnabled(net, marking, transition.id)) {
      enabled.push(transition.id)
    }
  }

  return enabled
}

/**
 * Whether an input place holds enough tokens to satisfy an arc under a marking.
 * Omega (unbounded) counts as always sufficient.
 */
function tokensSufficient(
  marking: Record<string, number | 'omega'>,
  arc: Arc
): boolean {
  const tokens = marking[arc.sourceId]
  if (tokens === 'omega') return true
  return (tokens ?? 0) >= arc.weight
}

/**
 * Check if a transition/operator is enabled, honouring AND/XOR input semantics.
 * AND-input requires every input place to be sufficiently marked; XOR-input
 * (XOR-join operators) only requires at least one marked input branch.
 */
function isTransitionEnabled(
  net: PetriNet,
  marking: Record<string, number | 'omega'>,
  transitionId: string
): boolean {
  const inputArcs = getInputArcs(net, transitionId)

  // Must have at least one input arc
  if (inputArcs.length === 0) return false

  if (effectiveInputLogic(net, transitionId) === 'xor') {
    return inputArcs.some((arc) => tokensSufficient(marking, arc))
  }

  return inputArcs.every((arc) => tokensSufficient(marking, arc))
}

/**
 * A concrete way an enabled transition/operator can fire: the arcs it consumes
 * from and the arcs it produces to. AND sides always use all arcs; XOR sides
 * pick exactly one arc, so a single node may expand into several firing modes
 * (e.g. an XOR-split produces one distinct successor marking per output branch).
 */
interface FiringMode {
  consume: Arc[]
  produce: Arc[]
}

/**
 * Enumerate all firing modes of an enabled transition/operator under a marking.
 *
 * This is the heart of correct XOR handling in the state space: an XOR-split
 * yields one mode per outgoing arc (⇒ one edge/successor per branch) instead of
 * flooding all branches at once like an AND-split; an XOR-join yields one mode
 * per currently marked incoming branch.
 */
function getFiringModes(
  net: PetriNet,
  marking: Record<string, number | 'omega'>,
  transitionId: string
): FiringMode[] {
  const inputArcs = getInputArcs(net, transitionId)
  const outputArcs = getOutputArcs(net, transitionId)

  const consumeOptions: Arc[][] =
    effectiveInputLogic(net, transitionId) === 'xor'
      ? inputArcs.filter((arc) => tokensSufficient(marking, arc)).map((a) => [a])
      : [inputArcs]

  const produceOptions: Arc[][] =
    effectiveOutputLogic(net, transitionId) === 'xor'
      ? outputArcs.length > 0
        ? outputArcs.map((a) => [a])
        : [[]]
      : [outputArcs]

  const modes: FiringMode[] = []
  for (const consume of consumeOptions) {
    for (const produce of produceOptions) {
      modes.push({ consume, produce })
    }
  }
  return modes
}

/**
 * Apply a single firing mode to a marking and return the resulting marking.
 */
function applyFiringMode(
  marking: Record<string, number | 'omega'>,
  mode: FiringMode
): Record<string, number | 'omega'> {
  const newMarking: Record<string, number | 'omega'> = { ...marking }

  // Remove tokens from the consumed input places
  for (const arc of mode.consume) {
    const current = newMarking[arc.sourceId]
    if (current === 'omega') continue
    const newVal = (current ?? 0) - arc.weight
    if (newVal > 0) {
      newMarking[arc.sourceId] = newVal
    } else {
      delete newMarking[arc.sourceId]
    }
  }

  // Add tokens to the produced output places
  for (const arc of mode.produce) {
    const current = newMarking[arc.targetId]
    if (current === 'omega') continue
    newMarking[arc.targetId] = ((current as number) ?? 0) + arc.weight
  }

  return newMarking
}

/**
 * Check and apply omega for unboundedness
 */
function checkAndApplyOmega(
  marking: Record<string, number | 'omega'>,
  nodes: CoverabilityNode[],
  current: CoverabilityNode
): void {
  // Find ancestor with strictly smaller marking
  let ancestor: CoverabilityNode | undefined = current

  while (ancestor) {
    const ancestorMarking = ancestor.marking
    let isSmaller = false
    let allLessOrEqual = true

    for (const placeId in marking) {
      const ancestorVal = ancestorMarking[placeId] ?? 0
      const currentVal = marking[placeId] ?? 0

      if (ancestorVal === 'omega' || currentVal === 'omega') {
        continue
      }

      if (ancestorVal < currentVal) {
        isSmaller = true
      } else if (ancestorVal > currentVal) {
        allLessOrEqual = false
        break
      }
    }

    for (const placeId in ancestorMarking) {
      if (!(placeId in marking)) {
        const ancestorVal = ancestorMarking[placeId]
        if (ancestorVal !== 'omega' && ancestorVal > 0) {
          allLessOrEqual = false
          break
        }
      }
    }

    if (allLessOrEqual && isSmaller) {
      // Apply omega for places that increased
      for (const placeId in marking) {
        const ancestorVal = ancestorMarking[placeId] ?? 0
        const currentVal = marking[placeId]

        if (
          ancestorVal !== 'omega' &&
          currentVal !== 'omega' &&
          currentVal > ancestorVal
        ) {
          marking[placeId] = 'omega'
        }
      }
      return
    }

    // Move to parent
    ancestor = ancestor.parentId
      ? nodes.find((n) => n.id === ancestor!.parentId)
      : undefined
  }
}

/**
 * Check if any node has omega
 */
function hasOmega(nodes: CoverabilityNode[]): boolean {
  for (const node of nodes) {
    for (const val of Object.values(node.marking)) {
      if (val === 'omega') return true
    }
  }
  return false
}

/**
 * Find places that become unbounded
 */
function findUnboundedPlaces(
  graph: CoverabilityGraph,
  net: PetriNet
): string[] {
  const unbounded = new Set<string>()

  for (const node of graph.nodes) {
    for (const [placeId, val] of Object.entries(node.marking)) {
      if (val === 'omega') {
        unbounded.add(placeId)
      }
    }
  }

  return [...unbounded]
}

/**
 * Check if marking is a final marking
 */
function checkFinalMarking(
  marking: Record<string, number | 'omega'>,
  sinkPlaceIds: string[]
): boolean {
  if (sinkPlaceIds.length === 0) return false

  // Check if only sink places have tokens
  for (const [placeId, tokens] of Object.entries(marking)) {
    if (tokens === 'omega') return false
    if (tokens > 0 && !sinkPlaceIds.includes(placeId)) {
      return false
    }
  }

  // Check if at least one sink place has a token
  for (const sinkId of sinkPlaceIds) {
    if (Number(marking[sinkId] ?? 0) > 0) {
      return true
    }
  }

  return false
}

/**
 * Build reachability graph (only for bounded nets — no omega abstraction).
 * Returns null if the state space exceeds maxStates, indicating unboundedness.
 */
export function buildReachabilityGraph(
  net: PetriNet,
  initialMarking: Record<string, number>,
  maxStates: number = MAX_STATES
): CoverabilityGraph | null {
  const nodes: CoverabilityNode[] = []
  const edges: CoverabilityEdge[] = []
  const visited = new Map<string, CoverabilityNode>()

  const sinkPlaces = net.places.filter(
    (p) => !net.arcs.some((arc) => arc.sourceId === p.id)
  )

  const initial: CoverabilityNode = {
    id: 'M0',
    marking: { ...initialMarking },
    isDeadlock: false,
    isInitial: true,
    isFinal: checkFinalMarking(initialMarking, sinkPlaces.map((p) => p.id)),
  }

  nodes.push(initial)
  visited.set(markingKey(initial.marking), initial)

  const queue = [initial]
  let stateCount = 0

  while (queue.length > 0) {
    if (stateCount >= maxStates) return null

    const current = queue.shift()!
    stateCount++

    const enabled = getEnabledTransitions(net, current.marking)

    if (enabled.length === 0) {
      current.isDeadlock = true
    }

    for (const transitionId of enabled) {
      const transition =
        net.transitions.find((t) => t.id === transitionId) ||
        net.operators.find((o) => o.id === transitionId)

      // Each firing mode (e.g. one per XOR branch) yields its own successor.
      for (const mode of getFiringModes(net, current.marking, transitionId)) {
        const newMarking = applyFiringMode(current.marking, mode)

        const key = markingKey(newMarking)
        let targetNode = visited.get(key)

        if (!targetNode) {
          targetNode = {
            id: `M${nodes.length}`,
            marking: newMarking,
            parentId: current.id,
            firedTransition: transitionId,
            isDeadlock: false,
            isInitial: false,
            isFinal: checkFinalMarking(newMarking, sinkPlaces.map((p) => p.id)),
          }
          nodes.push(targetNode)
          visited.set(key, targetNode)
          queue.push(targetNode)
        }

        edges.push({
          from: current.id,
          to: targetNode.id,
          transitionId,
          transitionName: transition?.name || transitionId,
        })
      }
    }
  }

  return {
    nodes,
    edges,
    bounded: true,
    deadlockNodes: nodes.filter((n) => n.isDeadlock).map((n) => n.id),
    reachableFinalStates: nodes.filter((n) => n.isFinal).length,
  }
}

/**
 * Create a unique key for a marking
 */
function markingKey(marking: Record<string, number | 'omega'>): string {
  const entries = Object.entries(marking)
    .filter(([_, v]) => v !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify(entries)
}
