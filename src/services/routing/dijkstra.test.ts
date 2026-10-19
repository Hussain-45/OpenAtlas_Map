import { describe, expect, it } from 'vitest'
import {
  aStarShortestPath,
  bidirectionalAStarShortestPath,
  dijkstraShortestPath,
  FLAG_DRIVE,
  FLAG_ONEWAY,
  FLAG_WALK,
  type GraphCSRView,
} from './dijkstra'
import { OfflineDelhiRoutingProvider } from './offlineDelhiRouting'

describe('Dijkstra and A* Algorithm Verification Suite', () => {
  // Helper to build a micro CSR graph
  function buildMicroGraph(nodes: [number, number][], edges: {
    u: number
    v: number
    weight: number
    flags: number
  }[]): GraphCSRView {
    const nodeCount = nodes.length
    const deg = new Uint16Array(nodeCount)
    for (const e of edges) {
      deg[e.u]++
    }

    const offsets = new Uint32Array(nodeCount + 1)
    for (let i = 0; i < nodeCount; i++) {
      offsets[i + 1] = offsets[i] + deg[i]
    }

    const totalEdges = offsets[nodeCount]
    const targets = new Uint32Array(totalEdges)
    const weights = new Uint16Array(totalEdges)
    const edgeFlags = new Uint16Array(totalEdges)

    const cur = new Uint32Array(offsets)
    for (const e of edges) {
      const p = cur[e.u]++
      targets[p] = e.v
      weights[p] = e.weight
      edgeFlags[p] = e.flags
    }

    const nodeCoords = new Int32Array(nodeCount * 2)
    for (let i = 0; i < nodeCount; i++) {
      nodeCoords[i * 2] = Math.round(nodes[i][0] * 100000)
      nodeCoords[i * 2 + 1] = Math.round(nodes[i][1] * 100000)
    }

    return {
      nodeCount,
      offsets,
      targets,
      weights,
      edgeFlags,
      nodeCoords,
    }
  }

  // 1. Known Shortest Path
  it('correctly discovers a known shortest path on a triangle graph with shortcut', () => {
    // Triangle: 0 -> 1 (cost 100), 0 -> 2 (cost 30), 2 -> 1 (cost 40). Shortest: 0 -> 2 -> 1 (cost 70)
    // Coordinates set within ~15m so heuristic h <= edge weight (admissible)
    const graph = buildMicroGraph(
      [
        [77.20000, 28.60000], // Node 0
        [77.20015, 28.60000], // Node 1 (~14.6m away)
        [77.20008, 28.60005], // Node 2 (~9.5m away)
      ],
      [
        { u: 0, v: 1, weight: 100, flags: FLAG_DRIVE },
        { u: 0, v: 2, weight: 30, flags: FLAG_DRIVE },
        { u: 2, v: 1, weight: 40, flags: FLAG_DRIVE },
      ]
    )

    const dijkstraRes = dijkstraShortestPath(graph, 0, 1, 'driving')
    const aStarRes = aStarShortestPath(graph, 0, 1, 'driving')

    expect(dijkstraRes.found).toBe(true)
    expect(dijkstraRes.totalCostMeters).toBe(70)
    expect(dijkstraRes.pathNodes).toEqual([0, 2, 1])

    expect(aStarRes.found).toBe(true)
    expect(aStarRes.totalCostMeters).toBe(70)
    expect(aStarRes.pathNodes).toEqual([0, 2, 1])
  })

  // 2. Equal-Cost Alternatives
  it('handles equal-cost alternative routes consistently', () => {
    // Diamond: 0 -> 1 -> 3 (cost 50 + 50 = 100), 0 -> 2 -> 3 (cost 50 + 50 = 100)
    const graph = buildMicroGraph(
      [
        [77.20, 28.60],
        [77.21, 28.61],
        [77.21, 28.59],
        [77.22, 28.60],
      ],
      [
        { u: 0, v: 1, weight: 50, flags: FLAG_DRIVE },
        { u: 1, v: 3, weight: 50, flags: FLAG_DRIVE },
        { u: 0, v: 2, weight: 50, flags: FLAG_DRIVE },
        { u: 2, v: 3, weight: 50, flags: FLAG_DRIVE },
      ]
    )

    const dijkstraRes = dijkstraShortestPath(graph, 0, 3, 'driving')
    const aStarRes = aStarShortestPath(graph, 0, 3, 'driving')

    expect(dijkstraRes.found).toBe(true)
    expect(dijkstraRes.totalCostMeters).toBe(100)
    expect([[0, 1, 3], [0, 2, 3]]).toContainEqual(dijkstraRes.pathNodes)

    expect(aStarRes.found).toBe(true)
    expect(aStarRes.totalCostMeters).toBe(100)
    expect([[0, 1, 3], [0, 2, 3]]).toContainEqual(aStarRes.pathNodes)
  })

  // 3. Directed Edges
  it('strictly respects directed edges and prevents traversal against flow', () => {
    // 0 -> 1 exists, 1 -> 0 does not
    const graph = buildMicroGraph(
      [
        [77.20, 28.60],
        [77.21, 28.60],
      ],
      [
        { u: 0, v: 1, weight: 50, flags: FLAG_DRIVE },
      ]
    )

    const forward = dijkstraShortestPath(graph, 0, 1, 'driving')
    expect(forward.found).toBe(true)
    expect(forward.totalCostMeters).toBe(50)

    const reverse = dijkstraShortestPath(graph, 1, 0, 'driving')
    expect(reverse.found).toBe(false)
    expect(reverse.error).toContain('No path exists')
  })

  // 4. One-Way Streets with Mode Specific Restrictions
  it('enforces one-way vehicle prohibition while permitting pedestrian passage', () => {
    // Edge 0 -> 1 has FLAG_DRIVE and FLAG_WALK
    // Reverse edge 1 -> 0 only has FLAG_WALK (driving forbidden by oneway)
    const graph = buildMicroGraph(
      [
        [77.20, 28.60],
        [77.21, 28.60],
      ],
      [
        { u: 0, v: 1, weight: 50, flags: FLAG_DRIVE | FLAG_WALK | FLAG_ONEWAY },
        { u: 1, v: 0, weight: 50, flags: FLAG_WALK }, // reversed pedestrian edge
      ]
    )

    // Driving reverse should fail
    const driveReverse = dijkstraShortestPath(graph, 1, 0, 'driving')
    expect(driveReverse.found).toBe(false)

    // Walking reverse should succeed
    const walkReverse = dijkstraShortestPath(graph, 1, 0, 'walking')
    expect(walkReverse.found).toBe(true)
    expect(walkReverse.totalCostMeters).toBe(50)
    expect(walkReverse.pathNodes).toEqual([1, 0])
  })

  // 5. Unreachable Targets
  it('correctly reports unreachable target in disconnected component', () => {
    const graph = buildMicroGraph(
      [
        [77.20, 28.60],
        [77.21, 28.60],
        [77.25, 28.65], // disconnected
      ],
      [
        { u: 0, v: 1, weight: 50, flags: FLAG_DRIVE },
      ]
    )

    const result = dijkstraShortestPath(graph, 0, 2, 'driving')
    expect(result.found).toBe(false)
    expect(result.totalCostMeters).toBe(Infinity)
    expect(result.error).toContain('No path exists from node 0 to node 2')
  })

  // 6. Invalid Endpoints
  it('rejects invalid endpoint node indices with descriptive error', () => {
    const graph = buildMicroGraph(
      [
        [77.20, 28.60],
        [77.21, 28.60],
      ],
      [
        { u: 0, v: 1, weight: 50, flags: FLAG_DRIVE },
      ]
    )

    const negStart = dijkstraShortestPath(graph, -1, 1, 'driving')
    expect(negStart.found).toBe(false)
    expect(negStart.error).toContain('Invalid start node ID: -1')

    const outTarget = dijkstraShortestPath(graph, 0, 999, 'driving')
    expect(outTarget.found).toBe(false)
    expect(outTarget.error).toContain('Invalid target node ID: 999')
  })

  // 7. Non-Negative Weights & Stale Queue Entries
  it('handles graphs with varying edge costs and stale queue updates correctly', () => {
    // 0 -> 1 (cost 100)
    // 0 -> 2 (cost 10)
    // 2 -> 3 (cost 10)
    // 3 -> 1 (cost 10)
    // Total cost to 1: 30 via (0 -> 2 -> 3 -> 1), rather than 100 via (0 -> 1)
    const graph = buildMicroGraph(
      [
        [77.20, 28.60],
        [77.21, 28.60],
        [77.20, 28.61],
        [77.21, 28.61],
      ],
      [
        { u: 0, v: 1, weight: 100, flags: FLAG_DRIVE },
        { u: 0, v: 2, weight: 10, flags: FLAG_DRIVE },
        { u: 2, v: 3, weight: 10, flags: FLAG_DRIVE },
        { u: 3, v: 1, weight: 10, flags: FLAG_DRIVE },
      ]
    )

    const dijkstraRes = dijkstraShortestPath(graph, 0, 1, 'driving')
    expect(dijkstraRes.found).toBe(true)
    expect(dijkstraRes.totalCostMeters).toBe(30)
    expect(dijkstraRes.pathNodes).toEqual([0, 2, 3, 1])
  })

  // 8. Equivalence on Real Delhi Road Graph Sample
  it('demonstrates exact route cost equivalence between Dijkstra and A* on Delhi road network', async () => {
    const provider = new OfflineDelhiRoutingProvider()
    const graph = await provider.ensureGraphLoaded()

    // Pick two well-defined landmarks in Delhi
    // Connaught Place: [77.2195, 28.6315]
    // India Gate: [77.2295, 28.6129]
    const snapCP = graph.snap(77.2195, 28.6315, 'driving')
    const snapIG = graph.snap(77.2295, 28.6129, 'driving')

    const dijkstraRes = dijkstraShortestPath(graph, snapCP.nodeId, snapIG.nodeId, 'driving')
    const aStarRes = aStarShortestPath(graph, snapCP.nodeId, snapIG.nodeId, 'driving')

    expect(dijkstraRes.found).toBe(true)
    expect(aStarRes.found).toBe(true)

    // Route costs in meters must match identically
    expect(dijkstraRes.totalCostMeters).toBe(aStarRes.totalCostMeters)

    // A* should expand fewer or equal vertices compared to Dijkstra
    expect(aStarRes.expandedVertices).toBeLessThanOrEqual(dijkstraRes.expandedVertices)
  })

  // 9. Bidirectional A* Verification
  it('demonstrates bidirectional A* on Delhi road network finding matching optimal route cost', async () => {
    const provider = new OfflineDelhiRoutingProvider()
    const graph = await provider.ensureGraphLoaded()

    const snapCP = graph.snap(77.2195, 28.6315, 'driving')
    const snapIG = graph.snap(77.2295, 28.6129, 'driving')

    const dijkstraRes = dijkstraShortestPath(graph, snapCP.nodeId, snapIG.nodeId, 'driving')
    const biAStarRes = bidirectionalAStarShortestPath(graph, snapCP.nodeId, snapIG.nodeId, 'driving')

    expect(biAStarRes.found).toBe(true)
    // Verify cost matches Dijkstra within 1% or exact
    expect(Math.abs(biAStarRes.totalCostMeters - dijkstraRes.totalCostMeters)).toBeLessThanOrEqual(5)
  })
})
